// ═══════════════════════════════════════════════════════════════════════════
// AUDIO CORE — loudness measurement, and getting audio out of files.
// Shared by Delivery QC, the Loudness Analyser and the monday app. Edit it here;
// sync_engine.py copies it into each.
//
// Loudness follows ITU-R BS.1770-4 and EBU R128: K-weighting, gated 400ms blocks
// for integrated loudness, 3s short-term blocks for loudness range (EBU Tech
// 3342), and 4x oversampled true peak. The meter takes audio in pieces, so a
// long master is measured as it streams in rather than held in memory whole.
//
// Uncompressed audio is read straight out of the file: QuickTime (ProRes
// masters, typically), WAV, BWF, RF64 and AIFF. No decoding, no resampling, and
// only the audio bytes are touched, so a multi-gigabyte master costs what its
// audio costs. Compressed audio (AAC, MP3) is decoded by the browser.
// ═══════════════════════════════════════════════════════════════════════════

// K-weighting filter coefficients for a sample rate (libebur128's designs).
function kWeighting(sr){
  var f0=1681.974450955533, G=3.999843853973347, Q=0.7071752369554196, K=Math.tan(Math.PI*f0/sr);
  var Vh=Math.pow(10,G/20), Vb=Math.pow(Vh,0.4996667741545416), a0=1+K/Q+K*K;
  var s={b0:(Vh+Vb*K/Q+K*K)/a0, b1:2*(K*K-Vh)/a0, b2:(Vh-Vb*K/Q+K*K)/a0, a1:2*(K*K-1)/a0, a2:(1-K/Q+K*K)/a0};
  f0=38.13547087602444; Q=0.5003270373238773; K=Math.tan(Math.PI*f0/sr);
  var d=1+K/Q+K*K;
  var h={b0:1, b1:-2, b2:1, a1:2*(K*K-1)/d, a2:(1-K/Q+K*K)/d};
  return {s:s, h:h};
}

// 4x interpolation filter for true peak: windowed sinc, 48 taps as 4 phases of 12.
var TP_PHASES=(function(){
  var L=48, mid=(L-1)/2, h=[], p, k, n;
  for(n=0;n<L;n++){
    var t=(n-mid)/4, s=t===0?1:Math.sin(Math.PI*t)/(Math.PI*t);
    h.push(s*(0.5-0.5*Math.cos(2*Math.PI*(n+0.5)/L)));
  }
  var ph=[];
  for(p=0;p<4;p++){
    var c=new Float64Array(12), sum=0;
    for(k=0;k<12;k++){ c[k]=h[p+4*k]; sum+=c[k]; }
    for(k=0;k<12;k++) c[k]/=sum;
    ph.push(c);
  }
  return ph;
})();

function LoudnessMeter(sampleRate){
  this.sr=sampleRate;
  this.subLen=Math.round(sampleRate/10);       // 100ms sub-blocks
  this.pow=[];                                  // channel-weighted mean square per sub-block
  this.tp=0; this.sp=0; this.frames=0;
  this.k=kWeighting(sampleRate);
}
LoudnessMeter.prototype.channel=function(gain){ return new MeterChannel(this, gain); };

function MeterChannel(m, gain){
  this.m=m; this.g=gain;
  this.s1=0; this.s2=0; this.s3=0; this.s4=0;  // shelf state
  this.h1=0; this.h2=0; this.h3=0; this.h4=0;  // high-pass state
  this.acc=0; this.n=0; this.idx=0; this.count=0;
  this.hist=new Float64Array(12); this.hp=0;   // last 12 input samples, for true peak
}
MeterChannel.prototype.push=function(x){
  var m=this.m, s=m.k.s, h=m.k.h, sub=m.subLen, g=this.g, pow=m.pow, ph=TP_PHASES;
  var s1=this.s1,s2=this.s2,s3=this.s3,s4=this.s4,h1=this.h1,h2=this.h2,h3=this.h3,h4=this.h4;
  var acc=this.acc, n=this.n, idx=this.idx, hist=this.hist, hp=this.hp;
  var tp=m.tp, sp=m.sp;
  for(var i=0;i<x.length;i++){
    var v=x[i];
    // K-weighting: high shelf, then high pass
    var y=s.b0*v+s.b1*s1+s.b2*s2-s.a1*s3-s.a2*s4; s2=s1; s1=v; s4=s3; s3=y;
    var z=h.b0*y+h.b1*h1+h.b2*h2-h.a1*h3-h.a2*h4; h2=h1; h1=y; h4=h3; h3=z;
    acc+=z*z;
    if(++n===sub){ pow[idx]=(pow[idx]||0)+g*acc/sub; idx++; acc=0; n=0; }
    // peaks
    hist[hp]=v; hp=(hp+1)%12;
    var a=v<0?-v:v;
    if(a>sp) sp=a;
    if(a>=tp*0.5){               // only samples near the running peak can hide a higher one
      for(var p=0;p<4;p++){
        var c=ph[p], o=0;
        for(var k=0;k<12;k++) o+=c[k]*hist[(hp-1-k+24)%12];
        if(o<0) o=-o;
        if(o>tp) tp=o;
      }
      if(a>tp) tp=a;
    }
  }
  this.s1=s1;this.s2=s2;this.s3=s3;this.s4=s4;this.h1=h1;this.h2=h2;this.h3=h3;this.h4=h4;
  this.acc=acc; this.n=n; this.idx=idx; this.hp=hp; this.count+=x.length;
  m.tp=tp; m.sp=sp; if(this.count>m.frames) m.frames=this.count;
};

LoudnessMeter.prototype.result=function(){
  var pow=this.pow, n=pow.length, i;
  for(i=0;i<n;i++) if(pow[i]===undefined) pow[i]=0;
  function lufs(p){ return -0.691+10*Math.log10(p); }
  function mean(a){ var t=0; for(var j=0;j<a.length;j++) t+=a[j]; return a.length?t/a.length:0; }
  // integrated: 400ms blocks every 100ms, absolute gate -70, relative gate -10
  var blocks=[], run=0;
  for(i=0;i<n;i++){ run+=pow[i]; if(i>=4) run-=pow[i-4]; if(i>=3) blocks.push(run/4); }
  var abs=blocks.filter(function(p){ return lufs(p)>-70; });
  var integrated=-Infinity;
  if(abs.length){
    var rel=lufs(mean(abs))-10;
    var gated=abs.filter(function(p){ return lufs(p)>rel; });
    if(gated.length) integrated=lufs(mean(gated));
  }
  // short-term: 3s blocks every 100ms; range per EBU Tech 3342
  var st=[]; run=0;
  for(i=0;i<n;i++){ run+=pow[i]; if(i>=30) run-=pow[i-30]; if(i>=29) st.push(run/30); }
  var stMax=-Infinity; st.forEach(function(p){ var l=lufs(p); if(l>stMax) stMax=l; });
  var lra=0, sa=st.filter(function(p){ return lufs(p)>-70; });
  if(sa.length){
    var relS=lufs(mean(sa))-20;
    var sg=sa.filter(function(p){ return lufs(p)>relS; }).map(lufs).sort(function(a,b){ return a-b; });
    if(sg.length>1) lra=sg[Math.round((sg.length-1)*0.95)]-sg[Math.round((sg.length-1)*0.10)];
  }
  return { integrated:integrated, lra:lra, stMax:stMax,
           truePeak:20*Math.log10(this.tp||1e-10), samplePeak:20*Math.log10(this.sp||1e-10),
           duration:this.frames/this.sr };
};

// Which channels make up the programme, and how much each counts (BS.1770).
// 5.1 is measured as 5.1. Any other layout wider than stereo — an 8-channel
// broadcast master with stems after the mix, say — is measured as its first
// two channels, the stereo mix, and says so.
function programmeChannels(count){
  if(count<=2) return { use: count===1?[0]:[0,1], gains: count===1?[1]:[1,1], note:null };
  if(count===6) return { use:[0,1,2,4,5], gains:[1,1,1,1.41,1.41], note:"5.1, LFE excluded" };
  return { use:[0,1], gains:[1,1], note:"channels 1\u20132 measured as the stereo mix" };
}

// ── QuickTime / MP4 audio tracks ──
function fourcc(dv,o){ return String.fromCharCode(dv.getUint8(o),dv.getUint8(o+1),dv.getUint8(o+2),dv.getUint8(o+3)); }
function boxesIn(dv,start,end){
  var out=[], o=start;
  while(o+8<=end){
    var size=dv.getUint32(o), type=fourcc(dv,o+4), hdr=8;
    if(size===1){ size=dv.getUint32(o+8)*4294967296+dv.getUint32(o+12); hdr=16; }
    else if(size===0) size=end-o;
    if(size<hdr||o+size>end) break;
    out.push({type:type, body:o+hdr, end:o+size});
    o+=size;
  }
  return out;
}
function boxPath(dv,box,path){
  for(var i=0;i<path.length && box;i++){
    var kids=boxesIn(dv,box.body,box.end), next=null;
    for(var j=0;j<kids.length;j++) if(kids[j].type===path[i]){ next=kids[j]; break; }
    box=next;
  }
  return box;
}
async function bytesAt(file,off,len){ return new Uint8Array(await file.slice(off,off+len).arrayBuffer()); }

// The uncompressed audio tracks in a QuickTime-family file, with where every
// chunk of audio sits. Returns [] when there are none (AAC in an MP4, say).
async function pcmTracks(file){
  var off=0, moov=null, guard=0;
  while(off+8<=file.size && guard++<100000){
    var hb=await bytesAt(file,off,16), hv=new DataView(hb.buffer);
    if(hb.length<8) break;
    var size=hv.getUint32(0), type=fourcc(hv,4);
    if(size===1) size=hv.getUint32(8)*4294967296+hv.getUint32(12); else if(size===0) size=file.size-off;
    if(size<8) break;
    if(type==="moov"){ moov={off:off,size:size}; break; }
    off+=size;
  }
  if(!moov || moov.size>512*1024*1024) return [];
  var mb=await bytesAt(file,moov.off,moov.size), dv=new DataView(mb.buffer);
  var top={body:8, end:mb.length}, tracks=[];
  boxesIn(dv,top.body,top.end).filter(function(b){ return b.type==="trak"; }).forEach(function(trak){
    var mdia=boxPath(dv,trak,["mdia"]); if(!mdia) return;
    var hdlr=boxPath(dv,mdia,["hdlr"]); if(!hdlr || fourcc(dv,hdlr.body+8)!=="soun") return;
    var stbl=boxPath(dv,mdia,["minf","stbl"]); if(!stbl) return;
    var stsd=boxPath(dv,stbl,["stsd"]); if(!stsd) return;
    var E=stsd.body+8, fmt=fourcc(dv,E+4), ver=dv.getUint16(E+16);
    var t={format:fmt};
    if(ver===2){
      t.rate=dv.getFloat64(E+40); t.channels=dv.getUint32(E+48); t.bits=dv.getUint32(E+56);
      var flags=dv.getUint32(E+60);
      t.float=!!(flags&1); t.little=!(flags&2); t.signed=!!(flags&4);
      if(fmt!=="lpcm") t.unsupported=true;
    } else {
      t.channels=dv.getUint16(E+24); t.bits=dv.getUint16(E+26); t.rate=dv.getUint32(E+32)/65536;
      t.little=(fmt==="sowt"); t.signed=(fmt!=="raw "); t.float=(fmt==="fl32"||fmt==="fl64");
      if(fmt==="in24") t.bits=24; if(fmt==="in32"||fmt==="fl32") t.bits=32; if(fmt==="fl64") t.bits=64;
      if(["sowt","twos","in24","in32","fl32","fl64","raw ","NONE"].indexOf(fmt)<0) t.unsupported=true;
      // 24/32-bit and float are big-endian unless an 'enda' atom says otherwise
      if(/in24|in32|fl32|fl64/.test(fmt)){
        for(var q=E+36;q<Math.min(stsd.end-6,E+256);q++)
          if(dv.getUint8(q)===101&&dv.getUint8(q+1)===110&&dv.getUint8(q+2)===100&&dv.getUint8(q+3)===97){ t.little=dv.getUint16(q+4)===1; break; }
      }
    }
    if(t.unsupported || !t.channels || !t.rate || [8,16,24,32,64].indexOf(t.bits)<0) return;
    t.bytesPerFrame=t.channels*t.bits/8;
    // chunk table
    var stsc=boxPath(dv,stbl,["stsc"]), stco=boxPath(dv,stbl,["stco"]), co64=boxPath(dv,stbl,["co64"]);
    if(!stsc || !(stco||co64)) return;
    var offs=[], cb=stco||co64, cn=dv.getUint32(cb.body+4);
    for(var i=0;i<cn;i++) offs.push(stco ? dv.getUint32(cb.body+8+i*4)
                                          : dv.getUint32(cb.body+8+i*8)*4294967296+dv.getUint32(cb.body+12+i*8));
    var sn=dv.getUint32(stsc.body+4), runs=[];
    for(i=0;i<sn;i++) runs.push([dv.getUint32(stsc.body+8+i*12), dv.getUint32(stsc.body+12+i*12)]);
    t.chunks=[]; t.frames=0;
    for(i=0;i<cn;i++){
      var per=0;
      for(var r=0;r<runs.length;r++) if(runs[r][0]<=i+1) per=runs[r][1];
      t.chunks.push([offs[i], per]); t.frames+=per;
    }
    t.duration=t.frames/t.rate;
    tracks.push(t);
  });
  return tracks;
}

// WAV, BWF and RF64: one data chunk of interleaved PCM, read in 1MB pieces.
// The browser would resample on decode, which costs accuracy at the top of the
// spectrum, exactly where K-weighting boosts.
function pieces(t, start, bytes){
  var per=Math.max(1, Math.floor(1048576/t.bytesPerFrame)), total=Math.floor(bytes/t.bytesPerFrame);
  t.chunks=[]; t.frames=total;
  for(var f=0; f<total; f+=per) t.chunks.push([start+f*t.bytesPerFrame, Math.min(per, total-f)]);
  t.duration=total/t.rate; return t;
}
async function wavTrack(file){
  var h=await bytesAt(file,0,12); if(h.length<12) return null;
  var hv=new DataView(h.buffer), id=fourcc(hv,0);
  if(!/^(RIFF|RF64|BW64)$/.test(id) || fourcc(hv,8)!=="WAVE") return null;
  var off=12, fmt=null, data=null, big=null, guard=0;
  while(off+8<=file.size && guard++<10000){
    var c=await bytesAt(file,off,8), dv=new DataView(c.buffer), cid=fourcc(dv,0), size=dv.getUint32(4,true);
    if(cid==="ds64"){ var d=new DataView((await bytesAt(file,off+8,16)).buffer); big=d.getUint32(8,true)+d.getUint32(12,true)*4294967296; }
    else if(cid==="fmt "){
      var fv=new DataView((await bytesAt(file,off+8,Math.min(size,40))).buffer);
      fmt={tag:fv.getUint16(0,true), ch:fv.getUint16(2,true), rate:fv.getUint32(4,true), bits:fv.getUint16(14,true)};
      if(fmt.tag===0xFFFE && size>=26) fmt.tag=fv.getUint16(24,true);     // extensible: the real format is in the sub-format
    }
    else if(cid==="data"){ data={off:off+8, size:(size===0xFFFFFFFF && big!=null) ? big : size}; break; }
    off+=8+size+(size&1);
  }
  if(!fmt || !data || (fmt.tag!==1 && fmt.tag!==3) || [8,16,24,32,64].indexOf(fmt.bits)<0) return null;
  var t={format:"wav", rate:fmt.rate, channels:fmt.ch, bits:fmt.bits, little:true, float:fmt.tag===3, signed:fmt.bits>8};
  t.bytesPerFrame=t.channels*t.bits/8;
  return pieces(t, data.off, Math.min(data.size, file.size-data.off));
}
async function aiffTrack(file){
  var h=await bytesAt(file,0,12); if(h.length<12) return null;
  var hv=new DataView(h.buffer), form=fourcc(hv,8);
  if(fourcc(hv,0)!=="FORM" || (form!=="AIFF" && form!=="AIFC")) return null;
  var off=12, t=null, ssnd=null, guard=0;
  while(off+8<=file.size && guard++<10000){
    var c=await bytesAt(file,off,8), dv=new DataView(c.buffer), cid=fourcc(dv,0), size=dv.getUint32(4);
    if(cid==="COMM"){
      var b=await bytesAt(file,off+8,Math.min(size,22)), v=new DataView(b.buffer);
      var ex=((b[8]&0x7f)<<8|b[9])-16383, man=v.getUint32(10)*4294967296+v.getUint32(14);
      var comp=form==="AIFC" && size>=22 ? fourcc(v,18) : "NONE";
      t={format:"aiff", channels:v.getUint16(0), bits:v.getUint16(6), rate:man*Math.pow(2,ex-63),
         little:comp==="sowt", float:/^fl(32|64)$/i.test(comp), signed:true};
      if(!/^(NONE|twos|sowt|fl32|FL32|fl64|FL64)$/.test(comp)) return null;
    }
    else if(cid==="SSND"){ var sv=new DataView((await bytesAt(file,off+8,8)).buffer); ssnd={off:off+16+sv.getUint32(0), size:size-8-sv.getUint32(0)}; }
    off+=8+size+(size&1);
  }
  if(!t || !ssnd || [8,16,24,32,64].indexOf(t.bits)<0) return null;
  t.bytesPerFrame=t.channels*t.bits/8;
  return pieces(t, ssnd.off, Math.min(ssnd.size, file.size-ssnd.off));
}
// Where a file's programme audio can be read without decoding, if it can.
async function pcmSource(file){
  var n=file.name, t=null;
  try{
    if(/\.(mov|mp4|m4v|m4a|qt)$/i.test(n)) return programmeTracks(await pcmTracks(file));
    if(/\.(wav|wave|bwf|rf64)$/i.test(n)) t=await wavTrack(file);
    else if(/\.(aif|aiff|aifc)$/i.test(n)) t=await aiffTrack(file);
  }catch(e){ return null; }
  return t ? programmeTracks([t]) : null;
}

function pcmToChannels(bytes,t,frames){
  var ch=t.channels, bps=t.bits/8, out=[], c;
  for(c=0;c<ch;c++) out.push(new Float32Array(frames));
  var dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), le=t.little, o=0;
  for(var f=0;f<frames;f++){
    for(c=0;c<ch;c++,o+=bps){
      var v;
      if(t.float) v = bps===4 ? dv.getFloat32(o,le) : dv.getFloat64(o,le);
      else if(bps===2) v = dv.getInt16(o,le)/32768;
      else if(bps===3){
        var iv = le ? (bytes[o]|(bytes[o+1]<<8)|(bytes[o+2]<<16)) : ((bytes[o]<<16)|(bytes[o+1]<<8)|bytes[o+2]);
        if(iv&0x800000) iv-=0x1000000; v=iv/8388608;
      }
      else if(bps===4) v = dv.getInt32(o,le)/2147483648;
      else v = t.signed ? ((bytes[o]<<24)>>24)/128 : (bytes[o]-128)/128;
      out[c][f]=v;
    }
  }
  return out;
}
async function eachPcmChunk(file,t,fn,onProgress){
  for(var i=0;i<t.chunks.length;i++){
    var frames=t.chunks[i][1], len=frames*t.bytesPerFrame;
    if(!len) continue;
    var b=await bytesAt(file,t.chunks[i][0],len);
    if(b.length<len) frames=Math.floor(b.length/t.bytesPerFrame);
    fn(pcmToChannels(b,t,frames));
    if(onProgress && i%64===0) onProgress(i/t.chunks.length);
  }
}

// The audio that makes up the programme, from whichever tracks carry it: one
// stereo (or 5.1, or wider) track, or a pair of mono tracks as left and right.
function programmeTracks(tracks){
  if(!tracks.length) return null;
  var a=tracks[0];
  if(a.channels===1 && tracks.length>1 && tracks[1].channels===1 && tracks[1].rate===a.rate)
    return { parts:[[a,0,1],[tracks[1],0,1]], rate:a.rate, note:"tracks 1\u20132 measured as stereo" };
  var pc=programmeChannels(a.channels);
  return { parts:pc.use.map(function(c,i){ return [a,c,pc.gains[i]]; }), rate:a.rate, note:pc.note };
}

function decodeWithBrowser(file){
  return file.arrayBuffer().then(function(ab){
    var ctx=new (window.AudioContext||window.webkitAudioContext)();
    return ctx.decodeAudioData(ab).then(function(buf){ try{ctx.close();}catch(e){} return buf; },
                                         function(e){ try{ctx.close();}catch(_){} throw e; });
  });
}

// Measure a whole file. QuickTime-family files with PCM audio stream straight
// through the meter; anything else is decoded by the browser first.
async function measureFileLoudness(file, onProgress){
  var prog=await pcmSource(file);
  if(prog){
      var meter=new LoudnessMeter(prog.rate);
      // each track is read once, feeding all of its programme channels
      var byTrack=new Map();
      prog.parts.forEach(function(p){ if(!byTrack.has(p[0])) byTrack.set(p[0],[]); byTrack.get(p[0]).push([p[1], meter.channel(p[2])]); });
      var done=0, total=prog.parts.length;
      for(var entry of byTrack){
        var feeds=entry[1];
        await eachPcmChunk(file, entry[0], function(chs){ feeds.forEach(function(f){ f[1].push(chs[f[0]]); }); },
                           onProgress ? function(x){ onProgress((done+x*feeds.length)/total); } : null);
        done+=feeds.length;
      }
      var r=meter.result(); r.source="pcm"; r.note=prog.note; return r;
  }
  var buf=await decodeWithBrowser(file);
  var res=measureBuffer(buf); res.source="decoded"; return res;
}

// Measure audio already in memory (an AudioBuffer, or anything shaped like one).
function measureBuffer(buf){
  var m=new LoudnessMeter(buf.sampleRate), pc=programmeChannels(buf.numberOfChannels);
  pc.use.forEach(function(c,i){ m.channel(pc.gains[i]).push(buf.getChannelData(c)); });
  var r=m.result(); r.note=pc.note; return r;
}

// The whole of a file's audio in memory, for analysis that needs all of it at
// once. QuickTime PCM is read directly; anything else is decoded by the browser.
var FULL_AUDIO_LIMIT_S=20*60;
async function decodeAudioFile(file){
  var prog=await pcmSource(file);
  if(prog){
      var t0=prog.parts[0][0];
      if(t0.duration>FULL_AUDIO_LIMIT_S)
        throw new Error("this file runs over 20 minutes \u2014 too long to analyse in full here. Delivery QC measures loudness on long masters.");
      var pair=prog.parts.length===2 && prog.parts[0][0]!==prog.parts[1][0];
      var srcs=pair ? [prog.parts[0][0],prog.parts[1][0]] : [t0];
      var chans=[];
      for(var s=0;s<srcs.length;s++){
        var t=srcs[s], data=[], o=0;
        for(var c=0;c<t.channels;c++) data.push(new Float32Array(t.frames));
        await eachPcmChunk(file,t,function(chs){ for(var c=0;c<chs.length;c++) data[c].set(chs[c],o); o+=chs[0].length; });
        data.forEach(function(d){ chans.push(o<d.length ? d.subarray(0,o) : d); });
      }
      var rate=prog.rate;
      return { sampleRate:rate, numberOfChannels:chans.length, length:chans[0].length, duration:chans[0].length/rate,
               getChannelData:function(c){ return chans[c]; }, _pcm:true, _bits:t0.bits };
  }
  return decodeWithBrowser(file);
}
