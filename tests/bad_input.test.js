// Every tool, fed junk: empty files, wrong types, random bytes, hostile text.
// Each must say something specific and never crash, hang, pass, or run script.
const { chromium } = require('playwright');
const {GEN,FIX,ok,done,tool}=require('./_lib');
(async () => {
  const b=await chromium.launch();
  async function t(page, act, read, wait){
    const ctx=await b.newContext({acceptDownloads:true}); const p=await ctx.newPage();
    const errs=[]; p.on('pageerror',e=>errs.push(e.message));
    await p.goto(tool(page)); await p.waitForTimeout(500);
    try{ await act(p); }catch(e){ errs.push('driver: '+e.message.split('\n')[0]); }
    await p.waitForTimeout(wait||1500);
    const shown=await p.evaluate(read).catch(()=>''); const xss=await p.evaluate(()=>!!window.__xss);
    await ctx.close(); return {shown:String(shown||''),errs,xss};
  }
  const leaf=re=>new Function('return [...document.querySelectorAll("*")].filter(e=>!e.children.length && e.offsetParent!==null && '+re+'.test(e.textContent)).map(e=>e.textContent.trim())[0]||""');
  const up=(sel,f)=>async p=>{ await (await p.$(sel)).setInputFiles(f); };
  console.log('Cut Logger');
  for(const f of ['empty.xml','junk.xml']){ const r=await t('tool_cutlogger.html',up('#file-input',GEN+f),leaf('/invalid xml/i'));
    ok(f+' → invalid XML', /invalid xml/i.test(r.shown) && !r.errs.length, r.shown); }
  let r=await t('tool_cutlogger.html',up('#file-input',FIX+'hostile.xml'),()=>document.body.innerText.indexOf('onerror')>=0);
  ok('hostile clip name shown as text, not run', !r.xss && !r.errs.length);
  console.log('Sub Sync');
  for(const f of ['empty.srt','notsrt.srt']){ const r=await t('tool_subsync.html', async p=>{ const i=await p.$$('input[type=file]'); await i[0].setInputFiles(GEN+f); },
      ()=>document.getElementById('srt-fn').textContent);
    ok(f+' → no subtitles found', /no subtitles found/i.test(r.shown) && !r.errs.length, r.shown); }
  console.log('Loudness');
  for(const f of ['empty.wav','garbage.wav']){ const r=await t('tool_loudness.html', async p=>{ await up('input[type=file]',GEN+f)(p); await p.waitForTimeout(600);
      await p.evaluate(()=>document.getElementById('analyse-btn').click()); }, leaf('/couldn.t decode/i'), 8000);
    ok(f+' → visible decode error', /couldn.t decode/i.test(r.shown) && !r.errs.length, r.shown.slice(0,60)); }
  console.log('Shot Logger');
  r=await t('tool_shotlogger.html', async p=>{ await up('input[type=file]',GEN+'garbage.mp4')(p); await p.waitForTimeout(600);
      await p.evaluate(()=>document.getElementById('analyse-btn').click()); },
    ()=>(document.getElementById('load-error')||{}).textContent+' | button '+(document.getElementById('analyse-btn').classList.contains('visible')?'back':'hidden'), 6000);
  ok('garbage.mp4 → error and button restored', /couldn.t decode/i.test(r.shown) && /button back/.test(r.shown) && !r.errs.length, r.shown.slice(0,70));
  console.log('Spec Checker');
  r=await t('tool_speccheck.html', async p=>{ await p.click('.tabs button[data-m="paste"]'); await p.fill('#spec-paste','1920x1080, 25fps');
      await p.click('#read-btn'); await p.waitForTimeout(500); await up('#assets-input',GEN+'garbage.mp4')(p); await p.waitForTimeout(300);
      await p.evaluate(()=>document.getElementById('run-btn').click()); },
    ()=>document.getElementById('summary').textContent.replace(/\s+/g,' '), 8000);
  ok('garbage.mp4 → unreadable, not passed', /0 pass/.test(r.shown) && /unreadable/.test(r.shown) && !r.errs.length, r.shown);
  r=await t('tool_speccheck.html', async p=>{ await p.click('.tabs button[data-m="paste"]'); await p.fill('#spec-paste','1920x1080 <img src=x onerror="window.__xss=1">'); await p.click('#read-btn'); }, ()=>'');
  ok('hostile spec text not run', !r.xss && !r.errs.length);
  console.log('Preset Builder');
  r=await t('tool_presetbuilder.html', async p=>{ await p.click('.tabs button[data-m="paste"]'); await p.fill('#spec-paste','please make it look nice'); await p.click('#read-btn'); },
    ()=>(document.querySelector('.skip-hd')||{}).textContent+' | download '+(!document.getElementById('p-out').classList.contains('hidden')));
  ok('nonsense spec → refuses, no download', /Nothing to build/.test(r.shown) && /download false/.test(r.shown), r.shown);
  r=await t('tool_presetbuilder.html', async p=>{ await p.click('.tabs button[data-m="paste"]'); await p.fill('#spec-paste','Codec: ProRes 422 <img src=x onerror="window.__xss=1">'); await p.click('#read-btn'); }, ()=>'');
  ok('hostile spec quoted, not run', !r.xss && !r.errs.length);
  await done(b);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
