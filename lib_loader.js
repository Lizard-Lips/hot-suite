// ═══════════════════════════════════════════════════════════════════════════
// LIBRARIES — fetched the first time something needs them, never with the page.
// Opening the suite used to download every reader (PDF, Word, Excel, media,
// zip, OCR) whichever tool you wanted. Edit here; sync_engine.py copies this
// into each tool that uses it.
// ═══════════════════════════════════════════════════════════════════════════
var LL_LIBS = {
  pdfjs:     { url:"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", what:"the PDF reader",
               has:function(){ return !!window.pdfjsLib; },
               ready:function(){ window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; } },
  mammoth:   { url:"https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js", what:"the Word reader",
               has:function(){ return !!window.mammoth; } },
  xlsx:      { url:"https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js", what:"the Excel reader",
               has:function(){ return !!window.XLSX; } },
  mediainfo: { url:"https://cdn.jsdelivr.net/npm/mediainfo.js@0.3.1/dist/umd/index.min.js", what:"the media reader",
               has:function(){ return !!(window.MediaInfo||window.mediaInfoFactory); } },
  jszip:     { url:"https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", what:"the zip tools",
               has:function(){ return !!window.JSZip; } },
  tesseract: { url:"https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js", what:"the text reader",
               has:function(){ return !!window.Tesseract; } },
  jspdf:     { url:"https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", what:"the PDF tools",
               has:function(){ return !!(window.jspdf && window.jspdf.jsPDF); } },
  autotable: { url:"https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js", what:"the PDF tools",
               needs:"jspdf", has:function(){ return !!(window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable); } },
  exceljs:   { url:"https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js", what:"the Excel tools",
               has:function(){ return !!window.ExcelJS; } }
};
function needLib(name){
  var lib=LL_LIBS[name], cache=window.__llLibs||(window.__llLibs={});
  function ready(){ if(lib.ready) lib.ready(); }
  if(lib.has()){ ready(); return Promise.resolve(); }
  // load what it depends on first (once), then itself
  if(lib.needs && !LL_LIBS[lib.needs].has()) return needLib(lib.needs).then(function(){ return needLib(name); });
  if(!cache[name]) cache[name]=new Promise(function(res,rej){
    var s=document.createElement("script"); s.src=lib.url;
    s.onload=function(){ res(); };
    // a failed load isn't remembered, so trying again after reconnecting works
    s.onerror=function(){ delete cache[name]; rej(new Error("couldn't load "+lib.what+" \u2014 check your internet connection and try again")); };
    document.head.appendChild(s);
  });
  return cache[name].then(ready);
}

// The standard PDF fonts can't draw Ł, ș, ț and so on, so names from Polish or
// Romanian deliveries would come out as garbage. DejaVu covers them.
var LL_FONTS = {
  regular:"https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf",
  bold:   "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf"
};
function llFont(which){
  var cache=window.__llFonts||(window.__llFonts={});
  if(cache[which]) return cache[which];
  var fail=function(){ delete cache[which]; throw new Error("couldn't load the PDF font \u2014 check your internet connection and try again"); };
  cache[which]=fetch(LL_FONTS[which]).then(function(r){ if(!r.ok) fail(); return r.arrayBuffer(); }, fail).then(function(ab){
    var bytes=new Uint8Array(ab), bin="";
    for(var i=0;i<bytes.length;i+=0x8000) bin+=String.fromCharCode.apply(null, bytes.subarray(i,i+0x8000));
    return btoa(bin);
  });
  return cache[which];
}
// A PDF ready for tables, with fonts that can draw any European name.
async function newPdf(opts){
  await needLib("autotable");
  var f=await Promise.all([llFont("regular"), llFont("bold")]);
  var doc=new window.jspdf.jsPDF(opts||{orientation:"landscape", unit:"pt", format:"a4"});
  doc.addFileToVFS("DejaVuSans.ttf", f[0]);      doc.addFont("DejaVuSans.ttf","DejaVu","normal");
  doc.addFileToVFS("DejaVuSans-Bold.ttf", f[1]); doc.addFont("DejaVuSans-Bold.ttf","DejaVu","bold");
  return doc;
}
function saveBlob(blob, name){
  var url=URL.createObjectURL(blob), a=document.createElement("a");
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
}
