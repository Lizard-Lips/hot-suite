// Cut Logger: transition-covered clips, frame 0, sequence start timecode,
// drop-frame against a brute-force reference, and mixed frame rates.
const { chromium } = require('playwright'); const fs=require('fs');
const {FIX,ok,done,tool}=require('./_lib');
function bruteDF(n,tb){ const drop=tb===30?2:4; let h=0,m=0,s=0,f=0;
  for(let i=0;i<n;i++){ f++; if(f===tb){ f=0; s++; if(s===60){ s=0; m++; if(m===60){m=0;h++;} if(m%10) f=drop; } } }
  const p=x=>String(x).padStart(2,'0'); return p(h)+':'+p(m)+':'+p(s)+';'+p(f); }
(async () => {
  const b=await chromium.launch(); const p=await b.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(tool('tool_cutlogger.html')); await p.waitForTimeout(400);
  const parse=f=>p.evaluate(t=>parseXML(t).map(x=>({n:x.filename,si:x.srcIn,so:x.srcOut,qi:x.seqIn,qo:x.seqOut,dur:x.duration,note:x.noteText})), fs.readFileSync(FIX+f,'utf8'));
  console.log('transitions and frame 0');
  let r=await parse('transitions.xml'); const g=n=>r.find(x=>x.n===n)||{};
  ok('no unresolved rows', !r.some(x=>/\?\?/.test(x.qi)));
  ok('clip at frame 0 with tail dissolve', g('A_head.mov').qi==='00:00:00:00' && g('A_head.mov').qo==='00:00:04:10', g('A_head.mov').qi+'-'+g('A_head.mov').qo);
  ok('dissolves both ends', g('B_dissolves_both.mov').qi==='00:00:04:00' && g('B_dissolves_both.mov').qo==='00:00:08:10');
  ok('audio-only crossfades both ends', g('M_music_xfade_both.wav').qi==='00:00:01:15' && g('M_music_xfade_both.wav').qo==='00:00:06:10');
  console.log('timecode');
  r=await parse('seq_start_10h.xml');  ok('sequence start 10:00:00:00 applied', r[0].qi==='10:00:05:00', r[0].qi);
  r=await parse('drop_frame.xml');     ok('29.97 DF source and sequence', r[0].si==='00:01:00;02' && r[0].qi==='01:00:00;00', r[0].si+' | '+r[0].qi);
  r=await parse('mixed_rate.xml');     ok('23.976 source in 25fps sequence', r[0].si==='01:00:00:00' && r[0].so==='01:00:04:00', r[0].si+'-'+r[0].so);
  console.log('footage at a different rate from the sequence (modelled on a real export)');
  // Rebuilt from a real Premiere sheet: 24fps sequence, clips conformed to 24,
  // footage at 50, 29.97 DF and 24. The bug: in/out counted at the file's rate.
  r=await parse('premiere_conformed.xml'); const c=n=>r.find(x=>x.n===n)||{};
  ok('50fps footage: 7 min on screen is 7 min of source', c('Gameplay_50fps_A.mov').si==='10:30:00:00' && c('Gameplay_50fps_A.mov').so==='10:37:00:00', c('Gameplay_50fps_A.mov').si+'–'+c('Gameplay_50fps_A.mov').so);
  ok('50fps footage, short clip', c('Capture_50fps_B.mov').so==='00:00:12:17', c('Capture_50fps_B.mov').so);
  ok('29.97 DF footage', c('Trailer_2997DF_C.mov').si==='00:47:34;05' && c('Trailer_2997DF_C.mov').so==='00:51:11;08', c('Trailer_2997DF_C.mov').si+'–'+c('Trailer_2997DF_C.mov').so);
  ok('footage at the sequence rate unchanged', c('Native_24fps_D.mov').si==='01:00:02:00' && c('Native_24fps_D.mov').so==='01:00:12:00');
  // the check that would have caught it: source length matches screen length
  const secs=(tc,rate)=>{ const m=tc.match(/(\d+):(\d+):(\d+)[:;](\d+)/); return +m[1]*3600+ +m[2]*60+ +m[3]+ +m[4]/rate; };
  const rates={'Gameplay_50fps_A.mov':50,'Capture_50fps_B.mov':50,'Trailer_2997DF_C.mov':29.97,'Native_24fps_D.mov':24};
  const off=r.filter(x=>{ const fr=rates[x.n]; let src=secs(x.so,fr)-secs(x.si,fr);
    if(fr===29.97){ src*=1; } return Math.abs(src-secs(x.dur,24))>0.1; }).map(x=>x.n);
  ok('every source duration matches its screen duration', !off.length, off.join(', '));
  console.log('rate conversion edge cases');
  r=await parse('rate_edges.xml'); const e=n=>r.find(x=>x.n===n)||{};
  ok('clip with no rate of its own falls back to the sequence rate', e('NoClipRate_50fps.mov').si==='01:00:00:00' && e('NoClipRate_50fps.mov').so==='01:00:10:00', e('NoClipRate_50fps.mov').so);
  ok('file with no timecode: plain in/out', e('NoTimecode_graphic.mov').si==='00:00:01:00' && e('NoTimecode_graphic.mov').so==='00:00:06:00');
  // 43,200 frames at 23.976 reads 00:30:00:00 in 23.976 timecode but lasts
  // 30m 1.8s of real time; 29.97 drop-frame follows the real clock.
  ok('23.976 timeline, 29.97 DF footage, converted through real time', e('NTSC_2997DF.mov').so==='01:30:01;24', e('NTSC_2997DF.mov').so);
  console.log('drop-frame reference');
  const pts=[[30,[0,29,30,1799,1800,1801,3597,3598,17981,17982,17983,107891,107892,200000]],[60,[3599,3600,35963,35964,215784]]];
  let bad=0, n=0;
  for(const [tb,list] of pts){ const got=await p.evaluate(([tb,l])=>l.map(x=>framesToTC(x,tb,true)),[tb,list]);
    list.forEach((x,i)=>{ n++; if(got[i]!==bruteDF(x,tb)){ bad++; console.log('     '+tb+' frame '+x+': '+got[i]+' want '+bruteDF(x,tb)); } }); }
  ok('all '+n+' drop-frame values match brute force', !bad);
  ok('no page errors', !errs.length, errs.join(' | '));
  await done(b);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
