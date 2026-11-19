// ═══════════════════════════════════════════════════════════════════════════
// SPEC ENGINE — the one source of truth.
// Spec parsing, media analysis, rule comparison, filename rules, loudness,
// frame scanning and audio comparison. Shared by Spec Checker, Preset Builder
// and the monday app. Edit it here; sync_engine.py copies it into each tool.
// It must not reference anything belonging to a page.
// ═══════════════════════════════════════════════════════════════════════════

async function readSpecFile(file){
  var name = file.name.toLowerCase();
  if (name.endsWith(".txt") || name.endsWith(".csv")) {
    return await file.text();
  }
  if (name.endsWith(".pdf")) {
    await needLib("pdfjs");
    var buf = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({data:buf}).promise;
    var out = [];
    for (var i=1;i<=pdf.numPages;i++){
      var page = await pdf.getPage(i);
      var tc = await page.getTextContent();
      out.push(tc.items.map(function(it){return it.str;}).join(" "));
    }
    return out.join("\n");
  }
  if (name.endsWith(".docx")) {
    await needLib("mammoth");
    var ab = await file.arrayBuffer();
    var res = await mammoth.extractRawText({arrayBuffer:ab});
    return res.value;
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    await needLib("xlsx");
    var ab2 = await file.arrayBuffer();
    var wb = XLSX.read(ab2, {type:"array"});
    var txt = [];
    wb.SheetNames.forEach(function(sn){
      txt.push(XLSX.utils.sheet_to_csv(wb.Sheets[sn]));
    });
    return txt.join("\n");
  }
  throw new Error("Unsupported spec format");
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — pattern-match rules from spec text
// ─────────────────────────────────────────────────────────────────────────────
function extractRules(text){
  var t = " " + text.replace(/\s+/g," ") + " ";
  var low = t.toLowerCase();
  var found = [];
  function add(field, op, value, conf){ found.push({field:field, op:op, value:String(value), enabled:true, conf:conf||"hi"}); }
  function has(field){ return found.some(function(r){return r.field===field;}); }

  // Resolution — explicit WxH in PIXELS. Guard against physical sizes (mm/in/cm)
  // being mistaken for a pixel resolution, e.g. "297x420mm" is A3, not pixels.
  var mRes = t.match(/(\d{3,5})\s?[x×]\s?(\d{3,5})(?!\s?(?:mm|cm|in\b|inch|"))/i);
  if (mRes) add("Resolution","=", mRes[1]+"x"+mRes[2], "hi");
  else {
    if (/\b(3840\s?[x×]\s?2160|\buhd\b|\b4k\b|2160p)\b/i.test(t)) add("Resolution","=","3840x2160","lo");
    else if (/\b(1920\s?[x×]\s?1080|1080[pi]|full ?hd|\bhd\b)\b/i.test(t)) add("Resolution","=","1920x1080","lo");
    else if (/\b(1280\s?[x×]\s?720|720p)\b/i.test(t)) add("Resolution","=","1280x720","lo");
  }

  // Frame rate
  var mFps = t.match(/(\d{2}(?:\.\d{1,3})?)\s?(?:fps|f\/s|frames?\s?\/?\s?s|p)\b(?!\w)/i);
  // guard: a number immediately followed by "-bit"/"bit" is bit depth, not fps
  if (mFps && /\d\s?-?\s?bit/i.test(mFps[0])) mFps = null;
  if (mFps && parseFloat(mFps[1])>=15 && parseFloat(mFps[1])<=120) add("Frame rate","=", parseFloat(mFps[1]), "hi");
  else if (/\bpal\b/i.test(t)) add("Frame rate","=","25","lo");
  else if (/\bntsc\b/i.test(t)) add("Frame rate","=","29.97","lo");
  else {
    var mFps2 = t.match(/\b(23\.976|24|25|29\.97|30|50|59\.94|60)\s?(?:hz|fps|p)\b/i);
    if (mFps2) add("Frame rate","=", mFps2[1], "lo");
  }

  // ── alternatives: "H.264 or H.265", "MP4/MOV", "ProRes 422 or DNxHD" ──
  // A spec that offers a choice becomes one "is one of" rule rather than a
  // single value that would wrongly fail half the deliverables.
  var altCodec = t.match(/\b((?:h\.?26[45]|hevc|avc|prores(?:\s?4{3}\d|\s?422(?:\s?hq)?)?|dnx(?:hd|hr)|xdcam)(?:\s*(?:or|\/|,)\s*(?:h\.?26[45]|hevc|avc|prores(?:\s?4{3}\d|\s?422(?:\s?hq)?)?|dnx(?:hd|hr)|xdcam))+)\b/i);
  if (altCodec && !has("Video codec")) {
    var parts = altCodec[1].split(/\s*(?:\bor\b|\/|,)\s*/i).map(function(x){return x.trim();}).filter(Boolean);
    if (parts.length>1) add("Video codec","is one of", parts.join(", "), "hi");
  }
  var altCont = t.match(/\b((?:mp4|mov|mxf|quicktime)(?:\s*(?:or|\/|,)\s*(?:mp4|mov|mxf|quicktime))+)\b/i);
  if (altCont) {
    var cparts = altCont[1].split(/\s*(?:\bor\b|\/|,)\s*/i)
        .map(function(x){ x=x.trim().toLowerCase(); return (x==="quicktime"?"mov":x).toUpperCase(); });
    if (cparts.length>1) add("Container","is one of", cparts.join(", "), "hi");
  }

  // Video codec
  var codecs = [
    [/prores\s?(4444(?:\s?xq)?|422\s?(?:hq|lt|proxy)?|422)/i, function(m){return "ProRes "+m[1].toUpperCase().replace(/\s+/g," ");}],
    [/\b(h\.?264|avc)\b/i, function(){return "H.264";}],
    [/\b(h\.?265|hevc)\b/i, function(){return "H.265";}],
    [/\bdnxhr\s?(hqx|hq|sq|lb|444)?/i, function(m){return "DNxHR"+(m[1]?" "+m[1].toUpperCase():"");}],
    [/\bdnxhd\b/i, function(){return "DNxHD";}],
    [/\bxdcam\b/i, function(){return "XDCAM";}]
  ];
  if(!has("Video codec")){
    for (var c=0;c<codecs.length;c++){ var mm=t.match(codecs[c][0]); if(mm){ add("Video codec","=", codecs[c][1](mm), "hi"); break; } }
  }

  // Container
  var mCont = t.match(/\b(mp4|mov|mxf|quicktime)\b/i);
  if (mCont && !has("Container")){ var cv=mCont[1].toLowerCase(); if(cv==="quicktime")cv="mov"; add("Container","=", cv.toUpperCase(), "hi"); }

  // Scan type
  if (/\b1080i\b|interlac/i.test(t)) add("Scan","=","Interlaced","lo");
  else if (/\b1080p\b|progressive/i.test(t)) add("Scan","=","Progressive","lo");

  // Aspect ratio
  var mAsp = t.match(/\b(16\s?:\s?9|4\s?:\s?3|2\.39\s?:\s?1|2\.35\s?:\s?1|1\.85\s?:\s?1)\b/);
  if (mAsp) add("Aspect ratio","=", mAsp[1].replace(/\s/g,""), "hi");

  // Bit depth
  var mBd = t.match(/\b(8|10|12)\s?-?\s?bit\b/i);
  if (mBd) add("Bit depth","=", mBd[1]+"-bit", "hi");

  // Chroma subsampling
  var mCh = t.match(/\b(4\s?:\s?2\s?:\s?0|4\s?:\s?2\s?:\s?2|4\s?:\s?4\s?:\s?4)\b/);
  if (mCh) add("Chroma","=", mCh[1].replace(/\s/g,""), "hi");

  // Audio codec (with common profiles)
  if (/\bpcm\b/i.test(t) || /\blpcm\b/i.test(t)) add("Audio codec","=","PCM","hi");
  else if (/\baac\b/i.test(t)) add("Audio codec","=", /\baac\s?-?lc\b/i.test(t)?"AAC LC":"AAC", "hi");
  else if (/\bac-?3\b|\bdolby\s?digital\b/i.test(t)) add("Audio codec","=","AC-3","hi");
  else if (/\bmp3\b/i.test(t)) add("Audio codec","=","MP3","hi");
  else if (/\bflac\b/i.test(t)) add("Audio codec","=","FLAC","hi");
  else if (/\bwav\b/i.test(t) && !has("Container")) add("Audio codec","=","PCM","lo");

  // Audio channels
  if (/\b7\.1\b/.test(t)) add("Audio channels","=","8","lo");
  else if (/\b5\.1\b/.test(t)) add("Audio channels","=","6","lo");
  else if (/\bstereo\b|\b2\.0\b|\b2\s?ch\b|\b2\s?channels?\b/i.test(t)) add("Audio channels","=","2","hi");
  else if (/\bmono\b|\b1\s?ch\b|\b1\s?channel\b/i.test(t)) add("Audio channels","=","1","hi");

  // Sample rate
  var mSr = t.match(/\b(48|44\.1|96|88\.2|192)\s?k?hz\b/i);
  if (mSr) add("Sample rate","=", (parseFloat(mSr[1])*1000), "hi");

  // Audio bit depth (distinct from video bit depth — needs audio context)
  var mAbd = t.match(/\b(16|24|32)\s?-?\s?bit\b(?=[^.]*(?:audio|pcm|wav|sample))/i)
          || (/\b(pcm|wav)\b/i.test(t) ? t.match(/\b(16|24|32)\s?-?\s?bit\b/i) : null);
  if (mAbd) add("Audio bit depth","=", mAbd[1]+"-bit", "lo");

  // Audio bitrate (kbps — compressed audio)
  var mAbr = t.match(/(\d{2,3})\s?kb(?:it)?(?:ps|\/s)\b/i);
  if (mAbr) add("Audio bitrate","≥", mAbr[1]+" kbps", "lo");

  // Audio track count ("2 audio tracks")
  var mAtc = t.match(/\b(\d)\s?(?:audio\s?tracks?|discrete\s?tracks?)\b/i);
  if (mAtc) add("Audio tracks","=", mAtc[1], "lo");

  // ── STATIC / PRINT specs ──
  // DPI / PPI ("300dpi", "300 ppi", "at least 150dpi")
  var mDpi = t.match(/(\d{2,4})\s?(?:dpi|ppi)\b/i);
  if (mDpi) add("DPI","≥", mDpi[1], "hi");

  // Colour space (print vs digital — the most common delivery failure)
  if (/\bcmyk\b/i.test(t)) add("Colour space","=","CMYK","hi");
  else if (/\b(srgb|adobe\s?rgb|rgb)\b/i.test(t)) add("Colour space","=","RGB","hi");
  else if (/\b(greyscale|grayscale|mono(chrome)?)\b/i.test(t)) add("Colour space","=","Greyscale","lo");

  // Physical dimensions (mm or inches) — e.g. "6000x3000mm", "A3", "48 sheet"
  var mMm = t.match(/(\d{2,5})\s?[x×]\s?(\d{2,5})\s?mm\b/i);
  if (mMm) add("Physical size mm","=", mMm[1]+"x"+mMm[2]+" mm", "hi");
  else {
    var mIn = t.match(/(\d{1,3}(?:\.\d)?)\s?[x×]\s?(\d{1,3}(?:\.\d)?)\s?(?:in|inch(?:es)?|")\b/i);
    if (mIn) add("Physical size","=", mIn[1]+"x"+mIn[2]+" in", "hi");
    else {
      // common paper sizes → mm
      var paper = {A0:"841x1189",A1:"594x841",A2:"420x594",A3:"297x420",A4:"210x297",A5:"148x210"};
      var mPaper = t.match(/\bA([0-5])\b/);
      if (mPaper && paper["A"+mPaper[1]]) add("Physical size mm","=", paper["A"+mPaper[1]]+" mm", "lo");
    }
  }

  // File size ceiling ("max 5MB", "under 2 MB", "no larger than 500KB")
  var mFs = t.match(/(?:max(?:imum)?|under|no larger than|less than|≤|<)\s?(\d{1,4}(?:\.\d)?)\s?(mb|kb)\b/i);
  if (mFs) add("File size","≤", mFs[1]+" "+mFs[2].toUpperCase(), "hi");

  // Bleed ("3mm bleed", "5 mm bleed all round")
  var mBleed = t.match(/(\d{1,2}(?:\.\d)?)\s?mm\s?bleed\b/i);
  if (mBleed) add("Bleed","=", mBleed[1]+" mm", "lo");

  // Video bit rate
  var mBr = t.match(/(\d{1,4})\s?(?:mb(?:it)?(?:ps|\/s)|mbps)\b/i);
  if (mBr) add("Video bitrate","≥", mBr[1]+" Mbps", "lo");

  // Loudness
  var mLuf = t.match(/(-?\d{1,2}(?:\.\d)?)\s?(?:lufs|lkfs)\b/i);
  if (mLuf) add("Loudness","=", mLuf[1]+" LUFS", "hi");
  var mTp = t.match(/(-\d{1,2}(?:\.\d)?)\s?dbtp\b/i) || t.match(/true\s?peak[^\d-]{0,24}(-\d{1,2}(?:\.\d)?)/i);
  if (mTp) add("True peak","\u2264", mTp[1]+" dBTP", "hi");

  // ProRes, named the same way the file side names it. Also catches specs the
  // patterns above miss — "ProRes LT", or a bare "deliver as ProRes".
  found.forEach(function(r){
    if (r.field !== "Video codec") return;
    if (r.op === "is one of") {
      r.value = r.value.split(/\s*,\s*/).map(function(v){ return canonicalProRes(v) || v.trim(); }).join(", ");
    } else {
      var c = canonicalProRes(r.value); if (c) r.value = c;
    }
  });
  if (!found.some(function(r){ return r.field === "Video codec"; })) {
    var pm = t.match(/(?:apple\s+)?pro\s?res(?:\s*(?:422|4444))?(?:\s*(?:hq|lt|proxy|xq))?/i);
    if (pm) found.push({field:"Video codec", op:"=", value:canonicalProRes(pm[0]), enabled:true, conf:"hi"});
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — render editable checklist
// ─────────────────────────────────────────────────────────────────────────────
var FIELDS = ["Resolution","Frame rate","Video codec","Container","Scan","Aspect ratio","Bit depth","Chroma","Video bitrate","Audio codec","Audio channels","Audio layout","Sample rate","Audio bit depth","Audio bitrate","Audio tracks","Loudness","Duration","DPI","Colour space","Physical size","Physical size mm","File size","Compression","Bleed"];
var OPS = ["=","≥","≤","is one of"];
if(FIELDS.indexOf("Filename")<0) FIELDS.unshift("Filename");
if(OPS.indexOf("matches")<0) OPS.push("matches");
if(FIELDS.indexOf("True peak")<0) FIELDS.push("True peak");
["Colour primaries","Transfer","Matrix","Colour range"].forEach(function(f){
  if(FIELDS.indexOf(f)<0) FIELDS.push(f); });

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — analyse asset with MediaInfo, normalise to comparable fields
// ─────────────────────────────────────────────────────────────────────────────
function readChunk(file){
  return function(chunkSize, offset){
    return new Promise(function(resolve, reject){
      var r = new FileReader();
      r.onload = function(e){ resolve(new Uint8Array(e.target.result)); };
      r.onerror = function(e){ reject(e); };
      r.readAsArrayBuffer(file.slice(offset, offset+chunkSize));
    });
  };
}

function normaliseStillFormat(f, file){
  f=String(f||"").toLowerCase();
  if(/jpeg|jpg/.test(f)) return "JPEG";
  if(/png/.test(f)) return "PNG";
  if(/tiff/.test(f)) return "TIFF";
  if(/webp/.test(f)) return "WEBP";
  if(/gif/.test(f)) return "GIF";
  return (file.name.split(".").pop()||f).toUpperCase();
}
function normaliseColourSpace(cs){
  cs=String(cs).toUpperCase();
  if(/YUVK|CMYK/.test(cs)) return "CMYK";
  if(/RGBA?/.test(cs)) return "RGB";
  if(/Y{1,3}|GREY|GRAY/.test(cs) && !/RGB/.test(cs)) return "Greyscale";
  return cs;
}

// Read pixel density. Checks JFIF APP0, EXIF APP1, PNG pHYs and TIFF IFD.
// Returns {dpi, from} or {absent:true} when the file simply carries no density
// (very common for web/video-derived images) so the UI can say so precisely.
function readDensity(b, name){
  try{
    if (b[0]===0xFF && b[1]===0xD8) {   // ── JPEG ──
      var i=2, jfifSeen=false;
      while(i < b.length-4){
        if(b[i]!==0xFF){ i++; continue; }
        var marker=b[i+1], seglen=(b[i+2]<<8)|b[i+3];
        // JFIF APP0: units 1=inch, 2=cm, 0=aspect ratio only (no real DPI)
        if(marker===0xE0 && b[i+4]===0x4A && b[i+5]===0x46 && b[i+6]===0x49 && b[i+7]===0x46){
          jfifSeen=true;
          var units=b[i+11], xd=(b[i+12]<<8)|b[i+13];
          if(xd>0){
            if(units===1) return {dpi:xd, from:"JFIF"};
            if(units===2) return {dpi:xd*2.54, from:"JFIF (cm)"};
          }
        }
        // EXIF APP1: XResolution (0x011A) + ResolutionUnit (0x0128) in a TIFF IFD
        if(marker===0xE1 && b[i+4]===0x45 && b[i+5]===0x78 && b[i+6]===0x69 && b[i+7]===0x66){
          var ex=readTiffResolution(b, i+10);
          if(ex && ex.dpi) return {dpi:ex.dpi, from:"EXIF"};
        }
        if(marker===0xDA) break;
        if(seglen<=0) break;
        i += 2+seglen;
      }
      return {absent:true, note: jfifSeen ? "JPEG carries no real density (JFIF units = aspect ratio only)" : "no density metadata in the JPEG"};
    }
    if (b[0]===0x89 && b[1]===0x50) {   // ── PNG ──
      var j=8;
      while(j < b.length-12){
        var ln=(b[j]<<24)|(b[j+1]<<16)|(b[j+2]<<8)|b[j+3];
        var t=String.fromCharCode(b[j+4],b[j+5],b[j+6],b[j+7]);
        if(t==="pHYs"){
          var px=(b[j+8]<<24)|(b[j+9]<<16)|(b[j+10]<<8)|b[j+11];
          var unit=b[j+16];
          if(unit===1 && px>0) return {dpi: px*0.0254, from:"pHYs"};
        }
        if(t==="IEND") break;
        if(ln<0) break;
        j += 12+ln;
      }
      return {absent:true, note:"PNG has no pHYs density chunk"};
    }
    // ── TIFF (II / MM byte order) ──
    if ((b[0]===0x49&&b[1]===0x49) || (b[0]===0x4D&&b[1]===0x4D)) {
      var tf=readTiffResolution(b, 0);
      if(tf && tf.dpi) return {dpi:tf.dpi, from:"TIFF"};
      return {absent:true, note:"TIFF has no resolution tags"};
    }
  }catch(e){}
  return {absent:true, note:"no density metadata found"};
}

// Parse XResolution/ResolutionUnit out of a TIFF header at `base`.
function readTiffResolution(b, base){
  try{
    var le = (b[base]===0x49 && b[base+1]===0x49);
    function u16(o){ return le ? (b[o]|(b[o+1]<<8)) : ((b[o]<<8)|b[o+1]); }
    function u32(o){ return le ? (b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24)>>>0)
                              : (((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0); }
    var ifdOff = u32(base+4);
    var ifd = base + ifdOff;
    var count = u16(ifd);
    var xres=null, unit=2;   // default unit = inch
    for(var k=0;k<count;k++){
      var e = ifd+2+k*12;
      var tag = u16(e), type = u16(e+2), valOff = u32(e+8);
      if(tag===0x011A && type===5){          // XResolution, RATIONAL
        var ro = base+valOff;
        var num=u32(ro), den=u32(ro+4);
        if(den) xres = num/den;
      }
      if(tag===0x0128 && type===3) unit = u16(e+8);  // ResolutionUnit: 2=inch, 3=cm
    }
    if(xres){
      if(unit===3) return {dpi: xres*2.54};
      return {dpi: xres};
    }
  }catch(e){}
  return null;
}

// JPEG with 4 components in the SOF marker is CMYK. Returns true/false/null.
function detectCMYK(b, name){
  try{
    if (b[0]===0xFF && b[1]===0xD8){
      var i=2;
      while(i < b.length-4){
        if(b[i]!==0xFF){ i++; continue; }
        var marker=b[i+1], seglen=(b[i+2]<<8)|b[i+3];
        if(marker===0xC0||marker===0xC1||marker===0xC2||marker===0xC9||marker===0xCA){
          return b[i+9]===4;
        }
        if(marker===0xDA) break;
        if(seglen<=0) break;
        i += 2+seglen;
      }
    }
  }catch(e){}
  return null;
}

// Work out the real pixels-per-inch the asset delivers across the physical size
// the spec asks for. This is the print-relevant number when the file carries no
// embedded density, which is very common.
function effectiveDPI(assetInfo){
  if(!assetInfo || !assetInfo["Resolution"]) return null;
  var wh = assetInfo["Resolution"].split("x").map(Number);
  if(!wh[0] || !wh[1]) return null;
  // find a physical size among the enabled rules
  // The rule list travels with the asset (set by whichever tool is checking),
  // so the engine never reaches for a page variable that may not exist.
  var ruleList = (assetInfo && assetInfo._rules) || [];
  var sizeRule = ruleList.filter(function(r){
    return r.enabled && (r.field==="Physical size mm" || r.field==="Physical size");
  })[0];
  if(!sizeRule) return null;
  var m = String(sizeRule.value).match(/([\d.]+)\s*[x×]\s*([\d.]+)/);
  if(!m) return null;
  var isMM = /mm/i.test(sizeRule.value);
  var wUnit = parseFloat(m[1]), hUnit = parseFloat(m[2]);
  var wIn = isMM ? wUnit/25.4 : wUnit;
  var hIn = isMM ? hUnit/25.4 : hUnit;
  if(!wIn || !hIn) return null;
  // match orientation to the asset so we don't understate the result
  var assetLandscape = wh[0] >= wh[1], sizeLandscape = wIn >= hIn;
  if(assetLandscape !== sizeLandscape){ var t=wIn; wIn=hIn; hIn=t; }
  // the limiting axis decides the effective dpi
  var dpiW = wh[0]/wIn, dpiH = wh[1]/hIn;
  var dpi = Math.min(dpiW, dpiH);
  return { dpi: dpi, px: wh[0]+"x"+wh[1],
           sizeLabel: isMM ? (Math.round(wIn*25.4)+"x"+Math.round(hIn*25.4)+"mm")
                           : ((Math.round(wIn*10)/10)+"x"+(Math.round(hIn*10)/10)+"in") };
}

function fmtBytes(n){
  if(n<1024) return n+" B";
  if(n<1024*1024) return (Math.round(n/1024*10)/10)+" KB";
  return (Math.round(n/(1024*1024)*10)/10)+" MB";
}

function track(result, type){
  var tr = (result && result.media && result.media.track) || [];
  return tr.filter(function(t){return (t["@type"]||t.type)===type;})[0] || {};
}

function normaliseMediaInfo(result, file){
  var gen = track(result,"General"), vid = track(result,"Video"), aud = track(result,"Audio");
  var out = { _type:"av", _raw:result };
  // resolution
  if (vid.Width && vid.Height) out["Resolution"] = Math.round(vid.Width)+"x"+Math.round(vid.Height);
  // frame rate
  if (vid.FrameRate) out["Frame rate"] = parseFloat(vid.FrameRate);
  // video codec
  var vcodec = vid.Format || vid.CodecID || "";
  if (vid.Format_Profile && /prores/i.test(vcodec)) vcodec = "ProRes "+vid.Format_Profile;
  if (vcodec) out["Video codec"] = normaliseCodec(vcodec, vid);
  // container
  if (gen.Format) out["Container"] = normaliseContainer(gen.Format, file, gen);
  // scan
  if (vid.ScanType) out["Scan"] = vid.ScanType;
  // aspect
  if (vid.DisplayAspectRatio) out["Aspect ratio"] = normaliseAspect(vid.DisplayAspectRatio);
  // bit depth
  if (vid.BitDepth) out["Bit depth"] = vid.BitDepth+"-bit";
  // chroma
  if (vid.ChromaSubsampling) out["Chroma"] = vid.ChromaSubsampling;
  // ── AUDIO (comprehensive) ──
  // audio codec (with profile for compressed formats)
  if (aud.Format) out["Audio codec"] = normaliseAudioCodec(aud.Format, aud);
  // channels
  if (aud.Channels) out["Audio channels"] = String(aud.Channels);
  // channel layout (e.g. "L R", "L R C LFE Ls Rs")
  if (aud.ChannelLayout) out["Audio layout"] = normaliseLayout(aud.ChannelLayout, aud.Channels);
  // sample rate (Hz)
  if (aud.SamplingRate) out["Sample rate"] = String(Math.round(aud.SamplingRate));
  // audio bit depth (PCM etc.)
  if (aud.BitDepth) out["Audio bit depth"] = aud.BitDepth+"-bit";
  // audio bitrate (kbps for compressed)
  if (aud.BitRate) out["Audio bitrate"] = Math.round(aud.BitRate/1000)+" kbps";
  // video bitrate
  if (vid.BitRate) out["Video bitrate"] = (Math.round(vid.BitRate/1e6*10)/10)+" Mbps";
  // track counts — useful for "must have N audio tracks" specs
  if (gen.AudioCount) out["Audio tracks"] = String(gen.AudioCount);
  // duration
  if (gen.Duration) out["Duration"] = fmtDuration(gen.Duration);
  // Loudness genuinely can't be read from the container. Mark it explicitly
  // so the report explains *why* rather than a bare "not readable".
  out["_loudnessUnmeasurable"] = true;
  return out;
}

// ── ProRes flavours ─────────────────────────────────────────────────────────
// One definition, used for both the spec and the file, so the two sides can't
// name the same codec differently. Each flavour is a different codec: a Proxy
// or LT file is not a "ProRes 422" delivery. A spec that names no flavour
// ("deliver as ProRes") comes out as plain "ProRes" and accepts any of them.
function canonicalProRes(s){
  s = String(s || "");
  if (!/pro\s?res/i.test(s)) return null;
  if (/4444\s*xq|\bxq\b/i.test(s)) return "ProRes 4444 XQ";
  if (/4444/.test(s))               return "ProRes 4444";
  if (/proxy/i.test(s))             return "ProRes 422 Proxy";
  if (/\blt\b/i.test(s))            return "ProRes 422 LT";
  if (/\bhq\b/i.test(s))            return "ProRes 422 HQ";
  if (/422/.test(s))                return "ProRes 422";
  return "ProRes";
}
// Codec equality: ProRes compared by flavour, a bare "ProRes" accepting any.
function codecMatches(want, got){
  var w = canonicalProRes(want), g = canonicalProRes(got);
  if (w || g) return !!(w && g) && (w === "ProRes" || w === g);
  return String(want).toLowerCase().replace(/[\s.-]/g,"") === String(got).toLowerCase().replace(/[\s.-]/g,"");
}

function normaliseCodec(c, vid){
  c = String(c);
  if (/prores/i.test(c)) return canonicalProRes(c);
  if (/avc|h\.?264/i.test(c)) return "H.264";
  if (/hevc|h\.?265/i.test(c)) return "H.265";
  if (/dnxhr/i.test(c)) return "DNxHR";
  if (/dnxhd|vc-3/i.test(c)) return "DNxHD";
  return c;
}
function normaliseContainer(f, file, gen){
  f = String(f).toLowerCase();
  // MediaInfo calls a QuickTime file "MPEG-4" and says QuickTime in its profile
  if (gen && (/quicktime/i.test(gen.Format_Profile||"") || /^qt/i.test(String(gen.CodecID||"")))) return "MOV";
  if (/quicktime|mov/.test(f)) return "MOV";
  if (/mpeg-4|mp4/.test(f)) return "MP4";
  if (/mxf/.test(f)) return "MXF";
  var ext=(file.name.split(".").pop()||"").toUpperCase();
  return f.toUpperCase()||ext;
}
function normaliseAudioCodec(f, aud){
  f=String(f).toLowerCase();
  if (/pcm/.test(f)) return "PCM";
  if (/aac/.test(f)) {
    var prof = aud && aud.Format_AdditionalFeatures ? " "+aud.Format_AdditionalFeatures : "";
    return "AAC"+prof;  // e.g. "AAC LC"
  }
  if (/mp3|mpeg audio/.test(f)) return "MP3";
  if (/ac-3|ac3|dolby/.test(f)) return "AC-3";
  if (/flac/.test(f)) return "FLAC";
  if (/alac/.test(f)) return "ALAC";
  return f.toUpperCase();
}
function normaliseLayout(layout, channels){
  var l = String(layout).toUpperCase().replace(/\s+/g," ").trim();
  // Common friendly names
  if (/^L R$/.test(l)) return "Stereo (L R)";
  if (/^C$|^M$/.test(l) || channels==1) return "Mono";
  if (/LFE/.test(l) && String(channels)==="6") return "5.1 ("+l+")";
  if (/LFE/.test(l) && String(channels)==="8") return "7.1 ("+l+")";
  return l;
}
function normaliseAspect(a){
  a=parseFloat(a);
  if (Math.abs(a-1.7778)<0.02) return "16:9";
  if (Math.abs(a-1.3333)<0.02) return "4:3";
  if (Math.abs(a-2.39)<0.03) return "2.39:1";
  if (Math.abs(a-1.85)<0.02) return "1.85:1";
  return a.toFixed(2)+":1";
}
function fmtDuration(sec){
  sec=Math.round(parseFloat(sec)); var h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
  return (h?h+"h ":"")+(m?m+"m ":"")+s+"s";
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARE — rule vs detected
// ─────────────────────────────────────────────────────────────────────────────
// Fields that only mean something for time-based media.
var AV_ONLY = ["Frame rate","Video codec","Scan","Video bitrate","Audio codec","Audio channels",
               "Audio layout","Sample rate","Audio bit depth","Audio bitrate","Audio tracks",
               "Loudness","Duration"];
// Fields that only mean something for stills.
var STILL_ONLY = ["DPI","Physical size","Physical size mm","Bleed"];

function compare(rule, got, assetInfo){
  var isStatic = assetInfo && assetInfo._type==="static";
  // Skip rules that can't apply to this asset type — clearer than a false flag.
  if (isStatic && AV_ONLY.indexOf(rule.field)>=0)
    return {verdict:"na", got:"—", note:"not applicable to a still"};
  if (!isStatic && assetInfo && STILL_ONLY.indexOf(rule.field)>=0)
    return {verdict:"na", got:"—", note:"not applicable to video/audio"};

  if (rule.field==="Audio sync" || rule.field==="Audio loudness match") {
    if (assetInfo && assetInfo._audioCmpNote)
      return {verdict:"flag", got:"\u2014", note:assetInfo._audioCmpNote};
    var ac = assetInfo && assetInfo._audioCmp;
    if (!ac) return {verdict:"flag", got:"\u2014", note:"not compared"};
    var tol = parseFloat(String(rule.value).replace(/[^\d.]/g,"")) ;
    if (rule.field==="Audio sync") {
      if (isNaN(tol)) tol = 20;                       // ms, a sensible default
      var off = Math.abs(ac.offsetMs);
      if (ac.confidence < 0.05)
        return {verdict:"flag", got:got, note:"couldn't align confidently \u2014 the audio may be different material"};
      if (ac.ambiguous)
        return {verdict:"flag", got:"\u2014", note:"can\u2019t tell \u2014 the reference has nothing distinct to line up against (a steady tone, silence or a loop)"};
      return {verdict: off<=tol ? "pass" : "fail", got:got,
              note: off<=tol ? null : "out by "+Math.round(off)+" ms against the reference"};
    }
    if (isNaN(tol)) tol = 1;                          // LU
    if (ac.levelDiff===null) return {verdict:"flag", got:got, note:"level not measurable"};
    var dl = Math.abs(ac.levelDiff);
    return {verdict: dl<=tol ? "pass" : "fail", got:got,
            note: dl<=tol ? null : "level differs by "+(Math.round(dl*10)/10)+" LU"};
  }
  if (rule.field==="Picture clipping") {
    if (assetInfo && assetInfo._levelNote)
      return {verdict:"flag", got:"\u2014", note:"couldn't scan \u2014 "+assetInfo._levelNote};
    var L = assetInfo && assetInfo._levels;
    if (!L) return {verdict:"flag", got:"\u2014", note:"not scanned"};
    // "legal" / "broadcast" means nothing significant crushed or clipped.
    var strict = /legal|broadcast|safe/i.test(String(rule.value));
    var lim = parseFloat(String(rule.value).match(/([\d.]+)\s*%/) ? RegExp.$1 : "2");
    if (strict || !isNaN(lim)) {
      var bad=[];
      if (L.pctCrushed > lim) bad.push(L.pctCrushed.toFixed(1)+"% crushed to black");
      if (L.pctClipped > lim) bad.push(L.pctClipped.toFixed(1)+"% clipped to white");
      if (bad.length) return {verdict:"fail", got:got, note:bad.join(", ")+
        " \u2014 measured on the decoded picture; a scope would also catch illegal code values"};
      return {verdict:"pass", got:got};
    }
    return {verdict:"flag", got:got, note:"no threshold set"};
  }
  if (rule.field==="Black frames") {
    if (assetInfo && assetInfo._blackNote)
      return {verdict:"flag", got:"\u2014", note:"couldn't scan \u2014 "+assetInfo._blackNote};
    if (got===undefined || got===null || got==="")
      return {verdict:"flag", got:"\u2014", note:"not scanned"};
    var wantNone = /^(none|0|no)$/i.test(String(rule.value).trim());
    var found = got!=="none";
    if (wantNone) {
      if (!found) return {verdict:"pass", got:"none found"};
      var rs=(assetInfo&&assetInfo._blackRanges)||[];
      return {verdict:"fail", got:got,
              note: rs.length ? "black at "+rs.slice(0,3).map(function(r){
                       return r[0]===r[1] ? fmtT(r[0]) : fmtT(r[0])+"\u2013"+fmtT(r[1]); }).join(", ")
                       +(rs.length>3?" (+"+(rs.length-3)+" more)":"") : null};
    }
    return {verdict: found ? "pass" : "fail", got:got};
  }
  if (got===undefined || got===null || got==="") {
    // DPI: embedded density is often absent or meaningless. What actually matters
    // for print is whether there are enough pixels for the required physical
    // size — so derive an effective DPI from the spec's size when we have one.
    if (rule.field==="DPI" && assetInfo && assetInfo._dpiAbsent) {
      var eff = effectiveDPI(assetInfo);
      if (eff) {
        var need = parseFloat(rule.value);
        var verdict = isNaN(need) ? "flag" : (eff.dpi >= need-1 ? "pass" : "fail");
        return { verdict: verdict, got: Math.round(eff.dpi)+" effective",
                 note: "no embedded DPI; "+eff.px+"px across "+eff.sizeLabel };
      }
      return { verdict:"flag", got:"—",
               note: assetInfo._dpiAbsentNote+" — add a physical size to the spec so effective DPI can be checked" };
    }
    // Physical size can only be derived from pixels + embedded density. Without
    // density there's no intrinsic physical size — the effective DPI row covers it.
    if ((rule.field==="Physical size" || rule.field==="Physical size mm") && assetInfo && assetInfo._dpiAbsent)
      return {verdict:"na", got:"—", note:"no embedded density, so the file has no fixed physical size — see the DPI row"};
    // Bleed can't be verified from file metadata — it's a layout property, not
    // something stored in the file. Say so plainly instead of a vague flag.
    if (rule.field==="Bleed")
      return {verdict:"na", got:"—", note:"not in file metadata — check the artwork layout"};
    // Loudness is genuinely unmeasurable from a container — say so specifically.
    if (rule.field==="Loudness" && assetInfo && assetInfo._loudnessNote)
      return {verdict:"flag", got:"—", note:"couldn't measure — "+assetInfo._loudnessNote};
    if (rule.field==="Loudness" && assetInfo && assetInfo._loudnessUnmeasurable)
      return {verdict:"flag", got:"—", note:"not measured"};
    return {verdict:"flag", got:"—", note:"not readable"};
  }
  var exp = rule.value.trim();
  var g = String(got).trim();
  // numeric-aware
  var expNum = parseFloat(exp), gNum = parseFloat(g);
  var bothNum = !isNaN(expNum) && !isNaN(gNum) && /^[-\d.]+/.test(exp) && /^[-\d.]+/.test(g);
  // Unit-aware sizes: normalise MB/KB/B to bytes so "≤ 5 MB" vs "272.9 KB" works.
  function toBytes(s){
    var m=String(s).match(/([\d.]+)\s*(mb|kb|b)\b/i);
    if(!m) return null;
    var v=parseFloat(m[1]), u=m[2].toLowerCase();
    return u==="mb" ? v*1024*1024 : u==="kb" ? v*1024 : v;
  }
  var expB=toBytes(exp), gB=toBytes(g);
  if(expB!==null && gB!==null){ expNum=expB; gNum=gB; bothNum=true; }
  // Physical size "297x420 mm" — compare both axes with a small tolerance
  var expDim=String(exp).match(/([\d.]+)\s*[x×]\s*([\d.]+)/);
  var gDim=String(g).match(/([\d.]+)\s*[x×]\s*([\d.]+)/);
  if(expDim && gDim && /mm|in/.test(exp)){
    var sizeTol = /mm/.test(exp) ? 2 : 0.1;   // 2mm or 0.1in slack
    var okW=Math.abs(parseFloat(expDim[1])-parseFloat(gDim[1]))<=sizeTol;
    var okH=Math.abs(parseFloat(expDim[2])-parseFloat(gDim[2]))<=sizeTol;
    if(okW&&okH) return {verdict:"pass", got:g};
    // allow swapped orientation as a flag rather than a hard fail
    if(Math.abs(parseFloat(expDim[1])-parseFloat(gDim[2]))<=tol && Math.abs(parseFloat(expDim[2])-parseFloat(gDim[1]))<=tol)
      return {verdict:"flag", got:g, note:"right size, rotated"};
    return {verdict:"fail", got:g};
  }

  function eqLoose(a,b){
    return a.toLowerCase().replace(/[\s-]/g,"") === b.toLowerCase().replace(/[\s-]/g,"");
  }

  if (rule.field==="Video codec" && (rule.op==="=" || rule.op==="is one of" || rule.op==="\u2208")) {
    var wants = rule.op==="=" ? [exp] : exp.split(/\s*(?:,|\||\bor\b|\/)\s*/i).filter(Boolean);
    var ok = wants.some(function(w){ return codecMatches(w, g); });
    return {verdict: ok ? "pass" : "fail", got:g,
            note: ok ? null : (wants.length>1 ? "none of: "+wants.join(", ") : null)};
  }
  if (rule.op==="=") {
    // Loudness is a measurement, not a declared value — broadcast delivery
    // normally allows ±0.5 LU, so exact equality is the wrong test.
    if (rule.field==="Loudness" && bothNum)
      return {verdict: Math.abs(expNum-gNum)<=0.5 ? "pass" : "fail", got:g};
    if (bothNum) {
      if (Math.abs(expNum-gNum) < 0.05) return {verdict:"pass", got:g};
      // frame-rate friendliness: 23.976≈24 etc handled by tolerance only
      return {verdict:"fail", got:g};
    }
    if (eqLoose(exp,g)) return {verdict:"pass", got:g};
    // partial contains (e.g. "ProRes 422 HQ" vs "ProRes 422")
    if (g.toLowerCase().indexOf(exp.toLowerCase())>=0 || exp.toLowerCase().indexOf(g.toLowerCase())>=0)
      return {verdict:"flag", got:g, note:"close match"};
    return {verdict:"fail", got:g};
  }
  if (rule.op==="≥") { if(bothNum) return {verdict: gNum>=expNum?"pass":"fail", got:g}; }
  if (rule.op==="≤") { if(bothNum) return {verdict: gNum<=expNum?"pass":"fail", got:g}; }
  if (rule.op==="is one of" || rule.op==="\u2208") {
    // "H.264 or H.265", "MP4, MOV" — any one of them is acceptable
    var opts = exp.split(/\s*(?:,|\||\bor\b|\/)\s*/i).map(function(x){return x.trim();}).filter(Boolean);
    var hit = opts.some(function(o){
      if (eqLoose(o,g)) return true;
      return g.toLowerCase().indexOf(o.toLowerCase())>=0 || o.toLowerCase().indexOf(g.toLowerCase())>=0;
    });
    return {verdict: hit ? "pass" : "fail", got:g,
            note: hit ? null : "none of: "+opts.join(", ")};
  }
  return {verdict:"flag", got:g, note:"uncompared"};
}

function ratioOf(res){
  if(!res) return null;
  var wh=String(res).split("x").map(Number);
  if(!wh[0]||!wh[1]) return null;
  return wh[0]/wh[1];
}
function checkFilename(fileName, pattern, info){
  var base=String(fileName).replace(/\.[^.]+$/,"");
  var segs=base.split("_");
  var pats=String(pattern||"").trim().split("_").filter(function(x){return x!=="";});
  if(!pats.length) return {verdict:"flag",got:base,note:"no pattern set"};
  if(segs.length!==pats.length)
    return {verdict:"fail",got:segs.length+" parts",
            note:"expected "+pats.length+" parts separated by _"};
  var probs=[], lies=[];
  for(var i=0;i<pats.length;i++){
    var pt=pats[i], sg=segs[i], n=i+1;
    if(pt==="*") continue;
    if(pt==="{ratio}"){
      var m2=String(sg).match(/^(\d+)x(\d+)$/i);
      if(!m2){ probs.push("part "+n+" should be a format like 9x16 or 960x1200, got \u201C"+sg+"\u201D"); continue; }
      var w=+m2[1], h=+m2[2];
      var res=info&&info["Resolution"];
      // Small numbers are a ratio (9x16, 1x1). Big numbers are the actual
      // pixel size (960x1200, 1200x628) and must match exactly.
      if(w>=100||h>=100){
        if(res && res.toLowerCase()!==(w+"x"+h).toLowerCase())
          lies.push("name says "+sg+" but the file is "+res);
      }else{
        var actual=ratioOf(res);
        if(actual!==null && Math.abs(actual-(w/h))>0.02)
          lies.push("name says "+sg+" but the file is "+res);
      }
      continue;
    }
    if(pt==="{dur}"){
      // Stills carry NA here rather than a number — nothing to check.
      if(/^na$/i.test(sg)) continue;
      var wantS=parseFloat(sg);
      if(isNaN(wantS)){ probs.push("part "+n+" should be a length in seconds or NA, got \u201C"+sg+"\u201D"); continue; }
      var actS=info&&info._durSec;
      if(typeof actS==="number" && !isNaN(actS) && Math.abs(actS-wantS)>0.75)
        lies.push("name says "+sg+"s but the file runs "+(Math.round(actS*10)/10)+"s");
      continue;
    }
    if(pt==="{name}"){
      if(!/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(sg))
        probs.push("part "+n+" should be PascalCase with hyphens only, got \u201C"+sg+"\u201D");
      else if(!/^[A-Z]/.test(sg))
        probs.push("part "+n+" should start with a capital, got \u201C"+sg+"\u201D");
      continue;
    }
    var alt=pt.match(/^\[(.+)\]$/);
    if(alt){
      var opts=alt[1].split("|").map(function(x){return x.trim().toLowerCase();});
      if(opts.indexOf(sg.toLowerCase())<0)
        probs.push("part "+n+" should be one of "+alt[1]+", got \u201C"+sg+"\u201D");
      continue;
    }
    if(pt.toLowerCase()!==sg.toLowerCase())
      probs.push("part "+n+" should be \u201C"+pt+"\u201D, got \u201C"+sg+"\u201D");
  }
  if(lies.length) return {verdict:"fail",got:base,note:"name doesn't match the file",
                          problems:lies, kind:"mismatch"};
  if(probs.length){
    // If most parts are wrong this isn't a naming slip, it's the wrong file.
    // Different problem, different action — so say that instead of listing
    // every correction.
    var wrongFile = probs.length > Math.max(2, Math.floor(pats.length/2));
    return {verdict:"fail", got:base,
            note: wrongFile
              ? "doesn't match the convention at all ("+probs.length+" of "+pats.length+" parts) \u2014 likely the wrong file"
              : probs.length+" of "+pats.length+" parts wrong",
            problems:probs, kind: wrongFile ? "wrongfile" : "naming"};
  }
  return {verdict:"pass",got:base};
}

// ── ONE MediaInfo instance for the whole run ──
// Creating a factory per file would reload ~4MB of WASM each time; at batch
// sizes that dominates the runtime. So we build it once and reuse it.
var _mi=null;
async function getMI(){
  if(_mi) return _mi;
  await needLib("mediainfo");
  var ns=window.MediaInfo||window.mediaInfoFactory;
  var factory=(typeof ns==="function")?ns:(ns&&(ns.mediaInfoFactory||ns.default));
  if(typeof factory!=="function") throw new Error("MediaInfo failed to load");
  _mi=await factory({format:"object",locateFile:function(p){
    return "https://cdn.jsdelivr.net/npm/mediainfo.js@0.3.1/dist/"+p; }});
  return _mi;
}
function isStill(file){
  return /^image\//.test(file.type)||/\.(jpe?g|png|tiff?|webp|gif|bmp)$/i.test(file.name);
}
// Analyse one file with the shared instance.
async function analyseOne(file){
  var mi=await getMI();
  var result=await mi.analyzeData(function(){return file.size;}, readChunk(file));
  if(!isStill(file)) {
    var out=normaliseMediaInfo(result,file);
    out["File size"]=fmtBytes(file.size);
    // Colour space and compression aren't always declared for video. Surface
    // them when they are, rather than guessing from the codec.
    var vt=track(result,"Video");
    var cs=vt.colour_primaries||vt.ColorSpace;
    if(cs && !out["Colour space"]) out["Colour space"]=String(cs);
    // Colour tagging, when the file carries it. Untagged files report nothing
    // rather than a guess.
    if(vt.colour_primaries) out["Colour primaries"]=String(vt.colour_primaries);
    if(vt.transfer_characteristics) out["Transfer"]=String(vt.transfer_characteristics);
    if(vt.matrix_coefficients) out["Matrix"]=String(vt.matrix_coefficients);
    if(vt.colour_range) out["Colour range"]=String(vt.colour_range);
    if(vt.Compression_Mode && !out["Compression"]) out["Compression"]=vt.Compression_Mode;
    // raw seconds, for checking a duration claimed in the filename
    var g=track(result,"General");
    var d=parseFloat(g.Duration);
    if(!isNaN(d)) out._durSec=d;
    return out;
  }
  // stills: MediaInfo for the basics, header bytes for density/CMYK
  var gen=track(result,"General"), img=track(result,"Image");
  var o={_type:"static"};
  if(img.Width&&img.Height) o["Resolution"]=Math.round(img.Width)+"x"+Math.round(img.Height);
  if(gen.Format||img.Format) o["Container"]=normaliseStillFormat(gen.Format||img.Format,file);
  if(img.BitDepth) o["Bit depth"]=img.BitDepth+"-bit";
  if(img.ColorSpace) o["Colour space"]=normaliseColourSpace(img.ColorSpace);
  if(img.ChromaSubsampling) o["Chroma"]=img.ChromaSubsampling;
  if(img.Compression_Mode) o["Compression"]=img.Compression_Mode;
  // stills have no declared aspect ratio, so derive it from the dimensions
  if(o["Resolution"]){
    var whA=o["Resolution"].split("x").map(Number);
    if(whA[0]&&whA[1]) o["Aspect ratio"]=normaliseAspect(whA[0]/whA[1]);
  }
  // only the head of the file is needed for density markers
  var head=new Uint8Array(await file.slice(0,Math.min(file.size,524288)).arrayBuffer());
  var dens=readDensity(head,file.name);
  if(dens&&dens.dpi){
    o["DPI"]=String(Math.round(dens.dpi));
    if(o["Resolution"]){
      var wh=o["Resolution"].split("x").map(Number);
      var wIn=wh[0]/dens.dpi,hIn=wh[1]/dens.dpi;
      o["Physical size"]=(Math.round(wIn*10)/10)+"x"+(Math.round(hIn*10)/10)+" in";
      o["Physical size mm"]=Math.round(wIn*25.4)+"x"+Math.round(hIn*25.4)+" mm";
    }
  } else { o._dpiAbsent=true; o._dpiAbsentNote=(dens&&dens.note)||"no density metadata"; }
  var c=detectCMYK(head,file.name);
  if(c!==null) o["Colour space"]=c?"CMYK":(o["Colour space"]||"RGB");
  o["File size"]=fmtBytes(file.size); o._fileSizeBytes=file.size;
  return o;
}


// A file is only checkable if MediaInfo found a real stream in it. Corrupt or
// non-media files come back with a General track and a file size and nothing
// else — and every rule then reads "not readable", which used to add up to
// zero failures and a PASS.
function hasMediaStream(info){
  if(!info) return false;
  if(info._type==="static") return !!info["Resolution"];
  var tracks = (info._raw && info._raw.media && info._raw.media.track) || [];
  return tracks.some(function(t){ return /^(Video|Audio|Image)$/.test(t["@type"]); });
}





// ─────────────────────────────────────────────────────────────────────────────
// LOUDNESS — measured by audio_core.js. QuickTime masters with PCM audio
// (ProRes, typically) are read straight from the file, so they work too.
// ─────────────────────────────────────────────────────────────────────────────
async function measureLoudness(file, onProgress){
  var r=await measureFileLoudness(file, onProgress);
  if(!isFinite(r.integrated)) throw new Error("no audible audio to measure");
  r.lufs=r.integrated;      // older callers read .lufs
  return r;
}


// ─────────────────────────────────────────────────────────────────────────────
// BLACK FRAME DETECTION
// Nothing in a file's header says whether it opens on black, so this decodes
// frames and measures them. Samples densely at the head and tail (where black
// actually matters for delivery) and more sparsely through the middle.
// Only works for codecs the browser can decode — ProRes and MXF will refuse.
// ─────────────────────────────────────────────────────────────────────────────
var BLACK_LUMA = 16;      // mean luma at or below this counts as black (8-bit)
var BLACK_EDGE = 1.5;     // seconds sampled densely at each end
var BLACK_STEP = 0.25;    // sampling interval at the ends
var BLACK_MID_SAMPLES = 24;

function frameStats(ctx, w, h){
  var d = ctx.getImageData(0,0,w,h).data;
  var sum=0, n=0, mn=255, mx=0, at0=0, at255=0;
  for(var i=0;i<d.length;i+=16){
    var y = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
    sum+=y; n++;
    if(y<mn)mn=y; if(y>mx)mx=y;
    // Clipping means the picture has run out of headroom, not that a colour is
    // saturated — a pure red (255,0,0) is legitimate. So require the whole
    // pixel to be at the rail.
    if(d[i]<=2 && d[i+1]<=2 && d[i+2]<=2) at0++;
    if(d[i]>=253 && d[i+1]>=253 && d[i+2]>=253) at255++;
  }
  return { mean:n?sum/n:0, min:mn, max:mx, n:n, at0:at0, at255:at255 };
}

// One decode pass, both answers. Decoding is the expensive part, so black
// detection and level measurement share it.
async function scanVideo(file, onProgress){
  if(!/\.(mp4|m4v|webm|ogg|mov)$/i.test(file.name))
    throw new Error("browser can't decode this format");
  var url = URL.createObjectURL(file);
  var v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  try{
    await new Promise(function(res, rej){
      v.onloadeddata = res;
      v.onerror = function(){ rej(new Error("browser couldn't decode the video")); };
      setTimeout(function(){ rej(new Error("timed out opening the video")); }, 15000);
    });
    var dur = v.duration;
    if(!isFinite(dur) || dur<=0) throw new Error("no readable duration");

    var cw = 160, ch = Math.max(2, Math.round(160 * (v.videoHeight/v.videoWidth || 0.5625)));
    var cv = document.createElement("canvas"); cv.width=cw; cv.height=ch;
    var cx = cv.getContext("2d", {willReadFrequently:true});

    var times = [];
    for(var t=0; t<Math.min(BLACK_EDGE, dur); t+=BLACK_STEP) times.push(t);
    for(var t2=Math.max(0, dur-BLACK_EDGE); t2<dur; t2+=BLACK_STEP) times.push(t2);
    for(var k=1;k<BLACK_MID_SAMPLES;k++) times.push(dur*k/BLACK_MID_SAMPLES);
    times = times.filter(function(x,i,a){ return x<dur && a.indexOf(x)===i; })
                 .sort(function(a,b){return a-b;});

    var black=[], tot=0, c0=0, c255=0, gMin=255, gMax=0, meanSum=0;
    for(var i=0;i<times.length;i++){
      if(onProgress) onProgress(i+1, times.length);
      await seekTo(v, times[i]);
      cx.drawImage(v, 0, 0, cw, ch);
      var f = frameStats(cx, cw, ch);
      if(f.mean <= BLACK_LUMA) black.push(times[i]);
      tot+=f.n; c0+=f.at0; c255+=f.at255;
      if(f.min<gMin)gMin=f.min; if(f.max>gMax)gMax=f.max;
      meanSum+=f.mean;
    }
    return {
      duration: dur, total: times.length,
      black: black, ranges: groupTimes(black, BLACK_STEP*1.6),
      levels: { minLuma:Math.round(gMin), maxLuma:Math.round(gMax),
                meanLuma:Math.round(meanSum/Math.max(1,times.length)),
                pctCrushed: tot? (c0/tot*100) : 0,
                pctClipped: tot? (c255/tot*100) : 0 }
    };
  } finally {
    try{ v.pause(); v.removeAttribute("src"); v.load(); }catch(e){}
    URL.revokeObjectURL(url);
  }
}
function seekTo(v, t){
  return new Promise(function(res, rej){
    var done=false;
    v.onseeked = function(){ if(!done){ done=true; res(); } };
    setTimeout(function(){ if(!done){ done=true; res(); } }, 3000);
    try{ v.currentTime = t; }catch(e){ rej(e); }
  });
}
function groupTimes(times, gap){
  if(!times.length) return [];
  var out=[], start=times[0], prev=times[0];
  times.slice(1).forEach(function(t){
    if(t-prev > gap){ out.push([start,prev]); start=t; }
    prev=t;
  });
  out.push([start,prev]);
  return out;
}
function fmtT(s){
  var m=Math.floor(s/60), sec=(s%60);
  return (m?m+"m ":"")+sec.toFixed(1)+"s";
}


// ─────────────────────────────────────────────────────────────────────────────
// AUDIO COMPARISON
// Checks a file's own audio against an approved reference (a WAV). Two
// questions: is it in sync, and is it at the same level. Sync is found by
// cross-correlating loudness envelopes rather than raw samples — far cheaper,
// and immune to phase and codec differences between a master and an encode.
// ─────────────────────────────────────────────────────────────────────────────
var ENV_RATE = 200;        // envelope samples per second
var MAX_LAG_S = 5;         // how far out of sync we'll look
var SYNC_MIN_MARGIN = 0.01; // the best alignment must beat any other this clearly

function toEnvelope(buf){
  // Exactly ENV_RATE points per second at any sample rate. Rounding the step to
  // whole samples (221 at 44.1kHz, against an exact 240 at 48kHz) made one file's
  // envelope run 0.23% slow, which drifts 90ms over 40 seconds.
  var rate = buf.sampleRate, per = rate / ENV_RATE;
  var chans = Math.min(2, buf.numberOfChannels);
  var n = Math.floor(buf.length / per);
  var env = new Float32Array(n);
  var data = [];
  for(var c=0;c<chans;c++) data.push(buf.getChannelData(c));
  for(var i=0;i<n;i++){
    var a0=Math.round(i*per), a1=Math.round((i+1)*per), s=0;
    // every sample counts: skipping some made the shape depend on the rate too
    for(var j=a0;j<a1;j++){
      var v=0;
      for(var c2=0;c2<chans;c2++) v += data[c2][j]||0;
      s += v*v;
    }
    env[i] = Math.sqrt(s/(a1-a0));
  }
  return env;
}
function normalise(a){
  var m=0; for(var i=0;i<a.length;i++) if(a[i]>m) m=a[i];
  if(!m) return a;
  var o=new Float32Array(a.length);
  for(var j=0;j<a.length;j++) o[j]=a[j]/m;
  return o;
}
// Best alignment of b against a, searched over ±MAX_LAG_S.
// Properly normalised: dividing by the overlap count alone rewards large lags
// where only a few samples happen to coincide, which pulls the answer miles out.
function bestLag(a, b){
  a=normalise(a); b=normalise(b);
  var maxLag = Math.round(MAX_LAG_S * ENV_RATE);
  var len = Math.min(a.length, b.length);
  if(len < ENV_RATE) return {score:0, lag:0, margin:0};
  var scores=[], best={score:-Infinity, lag:0};
  for(var lag=-maxLag; lag<=maxLag; lag++){
    var dot=0, ea=0, eb=0, n=0;
    for(var i=0;i<len;i++){
      var j=i+lag;
      if(j<0 || j>=b.length) continue;
      var x=a[i], y=b[j];
      dot += x*y; ea += x*x; eb += y*y; n++;
    }
    // insist on a real overlap, otherwise a sliver can win on noise alone
    if(n < len*0.5) continue;
    var denom = Math.sqrt(ea*eb);
    var sc = denom ? dot/denom : 0;
    scores.push([lag, sc]);
    if(sc > best.score) best={score:sc, lag:lag};
  }
  // How clearly the best alignment beats any other more than 100ms away. A
  // steady tone, silence or a loop matches itself equally well anywhere, so
  // its "best" offset is arbitrary and mustn't be reported as a measurement.
  var runnerUp=-Infinity, away=Math.round(ENV_RATE/10);
  scores.forEach(function(p){ if(Math.abs(p[0]-best.lag)>away && p[1]>runnerUp) runnerUp=p[1]; });
  best.margin = isFinite(runnerUp) ? best.score-runnerUp : 1;
  return best;
}

function decodeAudio(file){ return decodeAudioFile(file); }
async function compareAudio(assetFile, refBuffer, refEnv){
  var buf;
  try{ buf = await decodeAudioFile(assetFile); }
  catch(e){ throw new Error("couldn't read this file's audio"); }
  var env = toEnvelope(buf);
  var fit = bestLag(refEnv, env);
  var offsetMs = (fit.lag / ENV_RATE) * 1000;
  // level difference, measured the same way loudness is
  var lufsA=null, lufsB=null;
  try{ lufsA = measureBuffer(buf).integrated; lufsB = measureBuffer(refBuffer).integrated; }catch(e){}
  return {
    offsetMs: offsetMs,
    confidence: fit.score,
    margin: fit.margin,
    ambiguous: fit.margin < SYNC_MIN_MARGIN,
    levelDiff: (isFinite(lufsA)&&isFinite(lufsB)) ? (lufsA-lufsB) : null,
    durationDiff: buf.duration - refBuffer.duration
  };
}
