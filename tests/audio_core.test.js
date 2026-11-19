// The loudness meter against ffmpeg's ebur128, on test signals and on
// QuickTime masters in every PCM layout. No browser needed.
const fs=require('fs'), vm=require('vm'), path=require('path');
const {ROOT,GEN,ok}=require('./_lib');
const ctx={ window:{}, console, Map, Math, Float32Array, Float64Array, Uint8Array, DataView, Promise };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT,'audio_core.js'),'utf8'), ctx);
function readWav(p){
  const b=fs.readFileSync(p), dv=new DataView(b.buffer,b.byteOffset,b.byteLength); let o=12, fmt, data;
  while(o<b.length-8){ const id=b.toString('ascii',o,o+4), sz=dv.getUint32(o+4,true);
    if(id==='fmt ') fmt={tag:dv.getUint16(o+8,true),ch:dv.getUint16(o+10,true),sr:dv.getUint32(o+12,true),bits:dv.getUint16(o+22,true)};
    if(id==='data') data={off:o+8,len:sz}; o+=8+sz+(sz&1); }
  const bps=fmt.bits/8, n=Math.floor(data.len/(bps*fmt.ch)), ch=[...Array(fmt.ch)].map(()=>new Float32Array(n));
  for(let f=0,q=data.off;f<n;f++) for(let c=0;c<fmt.ch;c++,q+=bps){ let v;
    if(fmt.bits===32&&(fmt.tag===3||fmt.tag===0xFFFE)) v=dv.getFloat32(q,true); else if(bps===2) v=dv.getInt16(q,true)/32768;
    else { let x=b[q]|(b[q+1]<<8)|(b[q+2]<<16); if(x&0x800000) x-=0x1000000; v=x/8388608; } ch[c][f]=v; }
  return { sampleRate:fmt.sr, numberOfChannels:fmt.ch, length:n, getChannelData:c=>ch[c] };
}
(async()=>{
  const ref={}; fs.readFileSync(GEN+'loud_ref.txt','utf8').trim().split('\n').forEach(l=>{ const [f,i,lr,p]=l.split(/\s+/); ref[f]=[+i,+lr,+p]; });
  for(const f of Object.keys(ref)){
    // every file goes through the same path the tools use; WAV and AIFF are read directly
    const r = await ctx.measureFileLoudness(new File([fs.readFileSync(GEN+f)], f));
    if(r.source!=='pcm') ok(f+' read directly, not decoded', false, r.source);
    const [ri,rl,rp]=ref[f];
    const tp = f==='loud_isp.wav' ? Math.abs(r.truePeak-(-6.02))<=0.1 : Math.abs(r.truePeak-rp)<=0.2;
    ok(f.padEnd(26)+' matches ffmpeg', Math.abs(r.integrated-ri)<=0.1 && Math.abs(r.lra-rl)<=0.2 && tp,
       'I '+r.integrated.toFixed(1)+' / '+ri+', LRA '+r.lra.toFixed(1)+' / '+rl+', TP '+r.truePeak.toFixed(1)+' / '+(f==='loud_isp.wav'?'-6.02 exact':rp)+(r.note?'  ('+r.note+')':''));
  }
  // a file with no PCM audio says so instead of measuring nothing
  const none=await ctx.pcmTracks(new File([fs.readFileSync(GEN+'good.mp4')],'good.mp4'));
  ok('an H.264 file without audio has no PCM tracks', none.length===0);
  const {done}=require('./_lib'); done({close:async()=>{}});
})().catch(e=>{ console.error(e); process.exit(1); });
