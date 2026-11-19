const { chromium } = require('playwright');
const {GEN,ok:_ok,tool}=require('./_lib'); const URL=tool('tool_speccheck.html');
async function page(b){ const p=await b.newPage({viewport:{width:1300,height:1000}});
  p._errs=[]; p.on('pageerror',e=>p._errs.push(e.message)); await p.goto(URL); await p.waitForTimeout(600); return p; }
async function spec(p,txt){ await p.click('.tabs button[data-m="paste"]'); await p.fill('#spec-paste',txt); await p.click('#read-btn'); await p.waitForTimeout(600); }
async function tick(p,id,val,tolId){ await p.evaluate(([id,val,tolId])=>{ if(tolId&&val!=null){const t=document.getElementById(tolId); t.value=val; t.dispatchEvent(new Event('input',{bubbles:true}));}
  const c=document.getElementById(id); c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true})); },[id,val,tolId]); await p.waitForTimeout(150); }
async function run(p,files,wait){ await (await p.$('#assets-input')).setInputFiles(files); await p.waitForTimeout(400);
  await p.evaluate(()=>document.getElementById('run-btn').click()); await p.waitForTimeout(wait||15000);
  return p.evaluate(()=>({sum:document.getElementById('summary').textContent.replace(/\s+/g,' ').trim(),
    rows:[...document.querySelectorAll('#res-body .res-row')].map(r=>{ const k=r.getAttribute('data-k'); const d=document.getElementById('det-'+k);
      return {name:r.querySelector('.name').textContent, v:(r.textContent.match(/(PASS|FAIL|ERR)/)||[''])[0],
              det:d?[...d.querySelectorAll(':scope > div')].map(x=>x.textContent.replace(/\s+/g,' ').trim()):[]}; })})); }
const R=GEN; let fails=0;
function expect(label, cond, detail){ if(!cond) fails++; console.log((cond?'  ok   ':'  FAIL ')+label+(detail?'   '+detail:'')); }
(async () => {
  const b=await chromium.launch();
  // Spec Checker end to end: batch verdicts, filename rule, content checks,
  // loudness, audio sync, effective DPI and optional specs.
  // 1 — batch: spec rules + filename builder + black frames + clipping + unreadable
  let p=await page(b);
  await spec(p,'640x360, 25fps');
  await p.fill('#fname-example','UK_LIZ_Basking_16x9_3'); await p.click('#fname-build'); await p.waitForTimeout(300);
  await p.click('#fname-apply'); await p.waitForTimeout(200);
  await tick(p,'ck-black');
  let r=await run(p,[R+'UK_LIZ_Basking_16x9_3.webm',R+'UK_LIZ_WrongSize_16x9_3.webm',R+'UK_LIZ_BlackHead_16x9_3.webm',R+'garbage.mp4'],30000);
  const v=n=>(r.rows.find(x=>x.name.indexOf(n)>=0)||{}).v;
  console.log('1. batch  ['+r.sum+']');
  expect('clean file passes', v('Basking')==='PASS', v('Basking'));
  expect('wrong size fails', v('WrongSize')==='FAIL', v('WrongSize'));
  expect('black head fails', v('BlackHead')==='FAIL', (r.rows.find(x=>x.name.indexOf('BlackHead')>=0).det.find(d=>/Black frames/.test(d))||'').slice(0,80));
  expect('garbage is unreadable, not a pass', v('garbage')==='ERR', v('garbage'));
  expect('filename rule ran', r.rows.some(x=>x.det.some(d=>/^Filename/.test(d))));
  expect('no page errors', !p._errs.length, p._errs.join(' | ')); await p.close();
  // 2 — loudness measured against a target
  p=await page(b); await spec(p,'-27 LUFS');
  r=await run(p,[R+'UK_LIZ_Basking_16x9_3.webm'],15000);
  const ld=(r.rows[0]||{det:[]}).det.find(d=>/^Loudness/.test(d))||'';
  console.log('2. loudness'); expect('measured because the spec asks, and passes -27 within 0.5 LU', r.rows[0]&&r.rows[0].v==='PASS', ld);
  expect('no page errors', !p._errs.length, p._errs.join(' | ')); await p.close();
  // 3 — audio sync against a reference: one right answer, measured exactly,
  //     across sample rates; and nothing to line up on says so, not a guess
  p=await page(b); await spec(p,'640x360');
  await tick(p,'ck-sync'); await (await p.$('#ref-input')).setInputFiles(R+'sync_ref.wav'); await p.waitForTimeout(2500);
  r=await run(p,[R+'sync_ok.webm',R+'sync_late.webm'],20000);
  const sync=n=>((r.rows.find(x=>x.name.indexOf(n)>=0)||{det:[]}).det.find(d=>/^Audio sync/.test(d))||'').replace(/\s+/g,' ');
  console.log('3. audio sync');
  expect('in sync passes, measured as 0', v('sync_ok')==='PASS' && /[+-]0 ms/.test(sync('sync_ok')), sync('sync_ok'));
  expect('400ms late fails, measured as 400', v('sync_late')==='FAIL' && /out by 400 ms/.test(sync('sync_late')), sync('sync_late'));
  expect('no page errors', !p._errs.length, p._errs.join(' | ')); await p.close();
  p=await page(b); await spec(p,'320x180');
  await tick(p,'ck-sync'); await (await p.$('#ref-input')).setInputFiles(R+'loud_steps.wav'); await p.waitForTimeout(3000);
  r=await run(p,[R+'sync_steps_late150.webm'],40000);
  expect('40 seconds, 48k reference against a 44.1k decode: still 150', /out by 150 ms/.test(sync('steps')), sync('steps'));
  await p.close();
  p=await page(b); await spec(p,'640x360');
  await tick(p,'ck-sync'); await (await p.$('#ref-input')).setInputFiles(R+'ref.wav'); await p.waitForTimeout(2500);
  r=await run(p,[R+'UK_LIZ_Basking_16x9_3.webm'],15000);
  expect('a steady tone says it can\u2019t tell, instead of guessing', /can.t tell/.test(sync('Basking')) && v('Basking')!=='FAIL', sync('Basking'));
  expect('no page errors', !p._errs.length, p._errs.join(' | ')); await p.close();
  // 4 — effective DPI: the function decoupled from the page global
  p=await page(b); await spec(p,'Physical size 210x297mm, 300 DPI');
  r=await run(p,[R+'A4_nodensity.png'],8000);
  const dp=(r.rows[0]||{det:[]}).det.find(d=>/^DPI/.test(d))||'';
  console.log('4. effective DPI'); expect('A4 at 2480x3508 reads as 300 dpi', r.rows[0]&&/300/.test(dp), dp);
  expect('no page errors', !p._errs.length, p._errs.join(' | ')); await p.close();
  // 4b — clipping: flat mid-grey passes, a test pattern with pure black/white fails
  p=await page(b); await spec(p,'640x360'); await tick(p,'ck-levels');
  r=await run(p,[R+'grey_ok.webm',R+'UK_LIZ_Basking_16x9_3.webm'],15000);
  console.log('4b. clipping');
  expect('flat grey passes', (r.rows.find(x=>x.name==='grey_ok.webm')||{}).v==='PASS');
  expect('test pattern with pure black/white fails', (r.rows.find(x=>x.name.indexOf('Basking')>=0)||{}).v==='FAIL');
  await p.close();
  // 5 — optional specs through the parser and comparison
  p=await page(b);
  const o=await p.evaluate(()=>{ const rs=extractRules('ProRes 422 HQ or DNxHD, MOV/MP4');
    const c=rs.find(r=>r.field==='Video codec'), k=rs.find(r=>r.field==='Container');
    return {c:c&&c.op+' '+c.value, k:k&&k.op+' '+k.value,
            pass:compare(c,'DNxHD',{}).verdict, fail:compare(c,'H.264',{}).verdict}; });
  console.log('5. optional specs');
  expect('codec alternatives', o.c==='is one of ProRes 422 HQ, DNxHD', o.c);
  expect('container alternatives', o.k==='is one of MOV, MP4', o.k);
  expect('DNxHD passes, H.264 fails', o.pass==='pass'&&o.fail==='fail', o.pass+'/'+o.fail);
  await p.close();
  console.log('\n'+(fails? fails+' FAILED':'ALL PASSED'));
  await b.close(); process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
