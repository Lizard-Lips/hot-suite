// Delivery QC end to end: a ProRes master with PCM audio against a spec with a
// loudness target, the QC report, saved specs, and the hand-off to the
// Loudness Analyser. Headless Chromium can't decode ProRes or AAC, so every
// loudness reading here comes from the PCM reader.
const { chromium } = require('playwright'); const fs=require('fs'); const {execSync}=require('child_process');
const {GEN,ok,done,tool}=require('./_lib');
(async () => {
  const ref={}; fs.readFileSync(GEN+'loud_ref.txt','utf8').trim().split('\n').forEach(l=>{ const [f,i]=l.split(/\s+/); ref[f]=+i; });
  const target=ref['UK_LIZ_Master_16x9_6.mov'].toFixed(1);
  const b=await chromium.launch(); const ctx=await b.newContext({acceptDownloads:true}); const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(tool('index.html')); await p.waitForTimeout(1000); await p.keyboard.press('3');
  const Q=s=>'#panel-speccheck '+s;
  await p.evaluate(t=>{ const r=document.getElementById('panel-speccheck'); r.querySelector('.tabs button[data-m="paste"]').click();
    r.querySelector('#spec-paste').value='Master: 640x360, 25fps, Apple ProRes 422 HQ, QuickTime MOV, 48kHz stereo, '+t+' LUFS, true peak -1 dBTP';
    r.querySelector('#read-btn').click(); }, target);
  await p.waitForTimeout(700);
  const nRules=await p.evaluate(()=>document.querySelectorAll('#panel-speccheck #rules-body .rule').length);
  ok('spec read, true peak included', nRules===8 && await p.evaluate(()=>[...document.querySelectorAll('#panel-speccheck #rules-body select')].some(s=>s.value==='True peak')), nRules+' rules');
  await p.fill(Q('#spec-name'),'Test master'); await p.click(Q('#save-spec')); await p.waitForTimeout(150);
  ok('spec saved', /Saved/.test(await p.textContent(Q('#save-note'))));
  await (await p.$(Q('#assets-input'))).setInputFiles([GEN+'UK_LIZ_Master_16x9_6.mov', GEN+'loud_pcm_s24le.mov']); await p.waitForTimeout(300);
  await p.click(Q('#run-btn'));
  await p.waitForFunction(()=>!document.querySelector('#panel-speccheck #p-report').classList.contains('hidden'),{timeout:120000});
  const rows=await p.evaluate(()=>[...document.querySelectorAll('#panel-speccheck .res-row')].map(r=>{ r.click(); const d=document.getElementById('det-'+r.dataset.k);
    return { name:r.querySelector('.name').textContent, v:(r.textContent.match(/PASS|FAIL|ERR/)||[''])[0], loud:(d.querySelector('.loud')||{}).textContent||'',
             cont:([...d.children].find(x=>/^Container/.test(x.textContent))||{}).textContent||'' }; }));
  const m=rows.find(r=>/Master/.test(r.name)), o=rows.find(r=>/s24le/.test(r.name));
  ok('the master passes', m.v==='PASS', m.v);
  ok('a QuickTime file reads as MOV', /=\s*MOV\s*MOV/.test(m.cont), m.cont.replace(/\s+/g,' '));
  ok('loudness read from the master\u2019s PCM, as ffmpeg measures it', new RegExp(target.replace('-','\\-')+' LUFS integrated').test(m.loud) && /read from the file/.test(m.loud), m.loud.replace(/\s+/g,' ').slice(0,70));
  ok('the wrong file fails', o.v==='FAIL');
  const [dl]=await Promise.all([p.waitForEvent('download',{timeout:60000}), p.click(Q('#pdf-btn'))]);
  await dl.saveAs('/tmp/dqc_test.pdf'); const txt=execSync('pdftotext -layout /tmp/dqc_test.pdf -').toString();
  ok('QC report: named for the spec, verdicts, loudness, failure detail', dl.suggestedFilename().startsWith('Delivery_QC_Test_master_') &&
     /Delivery QC — Test master/.test(txt) && /PASS\s+UK_LIZ_Master/.test(txt) && /FAIL\s+loud_pcm_s24le/.test(txt) && txt.includes(target) && /64x36/.test(txt), dl.suggestedFilename());
  await p.evaluate(()=>{ const d=[...document.querySelectorAll('#panel-speccheck .detail')].find(x=>/Master/.test(x.previousElementSibling.textContent)); d.querySelector('button.open-loud').click(); });
  await p.waitForFunction(()=>document.querySelector('#panel-loudness #results').classList.contains('visible'),{timeout:60000}).catch(()=>{});
  const la=await p.evaluate(()=>({ on:document.getElementById('host-loudness').classList.contains('active'), lufs:document.querySelector('#panel-loudness #m-lufs').textContent }));
  ok('Loudness Analyser opens on the ProRes master and agrees', la.on && la.lufs===target, la.lufs);
  await p.reload(); await p.waitForTimeout(900); await p.keyboard.press('3');
  await p.click(Q('[data-load="Test master"]')); await p.waitForTimeout(300);
  ok('saved spec survives a reload and loads ready for files', await p.evaluate(()=>document.querySelectorAll('#panel-speccheck #rules-body .rule').length)===nRules &&
     !(await p.evaluate(()=>document.querySelector('#panel-speccheck #p-files').classList.contains('hidden'))));
  const [ex]=await Promise.all([p.waitForEvent('download'), p.click(Q('#export-btn'))]); await ex.saveAs('/tmp/specs_test.json');
  const js=JSON.parse(fs.readFileSync('/tmp/specs_test.json','utf8')); js.specs['From Amsterdam']=js.specs['Test master']; fs.writeFileSync('/tmp/specs_test2.json',JSON.stringify(js));
  await (await p.$(Q('#import-input'))).setInputFiles('/tmp/specs_test2.json'); await p.waitForTimeout(300);
  ok('export, then import on another machine', (await p.evaluate(()=>[...document.querySelectorAll('#panel-speccheck [data-load]')].map(b=>b.textContent))).includes('From Amsterdam'));
  ok('no page errors', !errs.length, errs.slice(0,3).join(' | '));
  await done(b);
})().catch(e=>{ console.error('ERR', e.message); process.exit(1); });
