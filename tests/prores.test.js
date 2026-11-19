// ProRes flavours. Each is a different codec: a Proxy or LT file must not pass
// a "ProRes 422" spec. Real encodes of every flavour, against every common way
// a spec names one.
const { chromium } = require('playwright');
const {GEN,ok,done,tool}=require('./_lib');
const FILES=['proxy','lt','standard','hq','4444','4444xq'];
const READS={proxy:'ProRes 422 Proxy',lt:'ProRes 422 LT',standard:'ProRes 422',hq:'ProRes 422 HQ','4444':'ProRes 4444','4444xq':'ProRes 4444 XQ'};
const CASES=[['Apple ProRes 422 Proxy',['proxy']],['ProRes LT',['lt']],['ProRes 422 LT',['lt']],['Apple ProRes 422',['standard']],
  ['ProRes 422 HQ',['hq']],['ProRes HQ',['hq']],['ProRes 4444',['4444']],['ProRes 4444 XQ',['4444xq']],
  ['Deliver as ProRes',FILES],['ProRes 422 HQ or ProRes 4444',['hq','4444']],['H.264',[]]];
(async () => {
  const b=await chromium.launch(); const p=await b.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(tool('tool_speccheck.html')); await p.waitForTimeout(500);
  await p.click('.tabs button[data-m="paste"]'); await p.fill('#spec-paste','640x360'); await p.click('#read-btn'); await p.waitForTimeout(400);
  const reads={};
  console.log('each file reads as its own flavour');
  for (const n of FILES){ await (await p.$('#assets-input')).setInputFiles(GEN+'prores_'+n+'.mov'); await p.waitForTimeout(200);
    reads[n]=await p.evaluate(async()=>(await analyseOne(queue[0]))['Video codec']); ok(n, reads[n]===READS[n], reads[n]); }
  console.log('each spec passes exactly the right files');
  for (const [spec,should] of CASES){
    const r=await p.evaluate(([spec,reads])=>{ const rule=extractRules(spec).find(x=>x.field==='Video codec'); if(!rule) return null;
      const o={}; for(const k in reads) o[k]=compare(rule,reads[k],{}).verdict; return o; },[spec,reads]);
    const passed=r?FILES.filter(n=>r[n]==='pass'):null;
    ok('"'+spec+'"', r && JSON.stringify(passed)===JSON.stringify(should) && !FILES.some(n=>r[n]==='flag'), r?('passes '+(passed.join(', ')||'none')):'no codec rule');
  }
  ok('no page errors', !errs.length, errs.join(' | '));
  await done(b);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
