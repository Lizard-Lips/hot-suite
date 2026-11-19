// The built hub. Tools run inside scoped panels here, which has broken things
// before, so each one is exercised in place, not just opened.
const { chromium } = require('playwright'); const fs=require('fs');
const {GEN,FIX,ok,done,tool}=require('./_lib');
(async () => {
  const b=await chromium.launch();
  const ctx=await b.newContext({acceptDownloads:true, viewport:{width:1400,height:1000}}); const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(tool('index.html')); await p.waitForTimeout(900);
  const keys=await p.evaluate(()=>[...document.querySelectorAll('.nav-item')].map(n=>n.getAttribute('data-tool')));
  let opened=0;
  for(const k of keys){ await p.click('.nav-item[data-tool="'+k+'"]'); await p.waitForTimeout(160);
    if(await p.evaluate(key=>document.getElementById('host-'+key).classList.contains('active'),k)) opened++; }
  ok('all '+keys.length+' tools open', opened===keys.length, keys.join(', '));
  const go=async k=>{ await p.click('.nav-item[data-tool="'+k+'"]'); await p.waitForTimeout(300); };
  const q=(k,s)=>'#panel-'+k+' '+s;
  // Cut Logger: generate the CSV from the transitions fixture
  await go('cutlogger'); await (await p.$(q('cutlogger','#file-input'))).setInputFiles(FIX+'transitions.xml'); await p.waitForTimeout(1200);
  await p.evaluate(()=>{ const a=document.querySelector('#panel-cutlogger #opt-all'); a.checked=true; a.dispatchEvent(new Event('change',{bubbles:true}));
                         const d=document.querySelector('#panel-cutlogger #opt-dedup'); d.checked=false; d.dispatchEvent(new Event('change',{bubbles:true})); });
  const [dl]=await Promise.all([p.waitForEvent('download'), p.evaluate(()=>document.querySelector('#panel-cutlogger #generate-btn').click())]);
  await dl.saveAs('/tmp/_hub.csv'); const csv=fs.readFileSync('/tmp/_hub.csv','utf8');
  ok('Cut Logger CSV has 6 rows, none unresolved', csv.trim().split('\n').length===7 && !/\?\?:/.test(csv));
  // PDF and Excel load their libraries on demand — check that works from inside a panel
  for (const [btn,ext] of [['#pdf-btn','pdf'],['#xlsx-btn','xlsx']]) {
    const [dd]=await Promise.all([p.waitForEvent('download',{timeout:60000}), p.evaluate(b=>document.querySelector('#panel-cutlogger '+b).click(), btn)]);
    const f='/tmp/_hub.'+ext; await dd.saveAs(f);
    const head=fs.readFileSync(f).subarray(0,4).toString('latin1');
    ok('Cut Logger '+ext.toUpperCase()+' from inside the suite', ext==='pdf' ? head==='%PDF' : head==='PK\u0003\u0004', dd.suggestedFilename());
  }
  // Spec Checker: a real batch
  await go('speccheck');
  await p.evaluate(()=>{ const r=document.getElementById('panel-speccheck'); r.querySelector('.tabs button[data-m="paste"]').click();
    const t=r.querySelector('#spec-paste'); t.value='640x360, 25fps'; t.dispatchEvent(new Event('input',{bubbles:true})); r.querySelector('#read-btn').click(); });
  await p.waitForTimeout(700);
  await (await p.$(q('speccheck','#assets-input'))).setInputFiles([GEN+'UK_LIZ_Basking_16x9_3.webm',GEN+'UK_LIZ_WrongSize_16x9_3.webm',GEN+'garbage.mp4']);
  await p.waitForTimeout(400); await p.evaluate(()=>document.querySelector('#panel-speccheck #run-btn').click()); await p.waitForTimeout(12000);
  const sum=await p.evaluate(()=>document.querySelector('#panel-speccheck #summary').textContent.replace(/\s+/g,' '));
  ok('Spec Checker: 1 pass, 1 fail, 1 unreadable', /1 pass/.test(sum)&&/1 fail/.test(sum)&&/1 unreadable/.test(sum), sum);
  // Preset Builder: download a preset
  await go('presetbuilder');
  await p.evaluate(()=>{ const r=document.getElementById('panel-presetbuilder'); r.querySelector('.tabs button[data-m="paste"]').click();
    const t=r.querySelector('#spec-paste'); t.value='1080x1920, 25fps progressive, ProRes 422'; t.dispatchEvent(new Event('input',{bubbles:true})); r.querySelector('#read-btn').click(); });
  await p.waitForTimeout(900);
  const [d2]=await Promise.all([p.waitForEvent('download'), p.evaluate(()=>document.querySelector('#panel-presetbuilder #dl-btn').click())]);
  ok('Preset Builder downloads a preset', /\.epr$/.test(d2.suggestedFilename()), d2.suggestedFilename());
  // Sub Sync: SRT loads with its cue count
  await go('subsync'); const fi=await p.$$(q('subsync','input[type=file]')); await fi[0].setInputFiles(GEN+'bom.srt'); await p.waitForTimeout(600);
  const fn=await p.evaluate(()=>document.querySelector('#panel-subsync #srt-fn').textContent);
  ok('Sub Sync reads all 3 cues', /3 subtitles/.test(fn), fn);
  // ── the shell: keys, dropping files, nothing loaded up front ──
  const p2=await ctx.newPage(); const reqs=[]; p2.on('request',r=>{ if(/\.js(\?|$)/.test(r.url()) && !r.url().startsWith('file:')) reqs.push(r.url()); });
  await p2.goto(tool('index.html')); await p2.waitForTimeout(1500);
  ok('no libraries load with the page', reqs.length===0, reqs.join(', '));
  const active=()=>p2.evaluate(()=>{ const h=document.querySelector('.tool-host.active'); return h?h.id.replace('host-',''):'home'; });
  await p2.keyboard.press('3'); ok('pressing 3 opens the third tool', await active()==='speccheck', await active());
  await p2.keyboard.press('Escape'); ok('esc returns to the start', await active()==='home');
  const drop=(name,text,sel)=>p2.evaluate(([name,text,sel])=>{ const dt=new DataTransfer(); dt.items.add(new File([text],name));
    const ev=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}); document.querySelector(sel).dispatchEvent(ev); return ev.defaultPrevented; },[name,text,sel]);
  await drop('cut.xml', fs.readFileSync(FIX+'transitions.xml','utf8'), '#landing'); await p2.waitForTimeout(1200);
  ok('an .xml dropped on the start screen opens in Cut Logger', await active()==='cutlogger' && await p2.evaluate(()=>document.querySelector('#panel-cutlogger #dl-row').classList.contains('visible')));
  await p2.keyboard.press('Escape');
  await drop('clip.mp4','x','#landing'); await p2.waitForTimeout(300);
  ok('a video opens in the Loudness Analyser', await active()==='loudness' && /clip\.mp4/.test(await p2.evaluate(()=>document.querySelector('#panel-loudness #file-name').textContent)));
  await p2.keyboard.press('Escape');
  await drop('spec.pdf','x','#landing'); await p2.waitForTimeout(300);
  const choices=await p2.evaluate(()=>[...document.querySelectorAll('#ask button')].map(b=>b.textContent.trim()));
  ok('a spec sheet asks which tool', choices.length===2 && /delivery qc/.test(choices[0]) && /preset builder/.test(choices[1]), choices.join(' | '));
  await p2.keyboard.press('5'); ok('and a number picks one', await active()==='presetbuilder');
  ok('Shot Logger is out of the kit', !(await p2.evaluate(()=>!!document.getElementById('host-shotlogger'))));
  await p2.keyboard.press('Escape'); await drop('notes.xyz','x','#landing'); await p2.waitForTimeout(200);
  ok('an unknown file gets a plain answer', /nothing here opens \.xyz/.test(await p2.evaluate(()=>document.getElementById('ask').textContent)));
  await p2.keyboard.press('2');
  const prevented=await drop('stray.xml','x','#panel-loudness main'); await p2.waitForTimeout(200);
  ok('a stray drop no longer makes the browser leave the page', prevented && /doesn.t take \.xml/.test(await p2.evaluate(()=>document.getElementById('toast').textContent)));
  ok('no page errors anywhere', !errs.length, errs.slice(0,3).join(' | '));
  await done(b);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
