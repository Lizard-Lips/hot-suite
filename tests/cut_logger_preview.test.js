// Cut Logger shows the log before you download it: the same rows and columns
// as the files, with rows it couldn't place marked.
const { chromium } = require('playwright'); const fs=require('fs');
const {FIX,ok,done,tool}=require('./_lib');
(async () => {
  const b=await chromium.launch(); const ctx=await b.newContext({acceptDownloads:true}); const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(tool('index.html')); await p.waitForTimeout(800); await p.keyboard.press('1');
  const C=s=>'#panel-cutlogger '+s;
  await (await p.$(C('#file-input'))).setInputFiles(FIX+'transitions.xml'); await p.waitForTimeout(1000);
  const view=()=>p.evaluate(()=>({ head:[...document.querySelectorAll('#panel-cutlogger #preview-table th')].map(t=>t.textContent).filter(Boolean),
    rows:[...document.querySelectorAll('#panel-cutlogger #preview-table tbody tr')].map(r=>[...r.cells].map(c=>c.textContent)),
    marked:document.querySelectorAll('#panel-cutlogger #preview-table tr.bad').length, count:document.querySelector('#panel-cutlogger #preview-count').textContent }));
  let v=await view();
  const [dl]=await Promise.all([p.waitForEvent('download'), p.click(C('#generate-btn'))]); await dl.saveAs('/tmp/pv.csv');
  const csv=fs.readFileSync('/tmp/pv.csv','utf8').trim().split(/\r?\n/);
  ok('the log is on screen once the XML loads', v.rows.length>0, v.count);
  ok('same rows as the download', v.rows.length===csv.length-1, v.rows.length+' on screen, '+(csv.length-1)+' in the CSV');
  ok('same columns as the download', JSON.stringify(v.head)===JSON.stringify(csv[0].split(',').map(s=>s.replace(/^"|"$/g,''))), v.head.join(', '));
  ok('a clean timeline has nothing marked', v.marked===0 && !/need checking/.test(v.count));
  const before=v.head.includes('Duration');
  await p.evaluate(()=>{ const t=[...document.querySelectorAll('#panel-cutlogger .tag')].find(e=>e.textContent.trim()==='Duration'); t.click(); });
  await p.waitForTimeout(150); v=await view();
  ok('untick a column and it leaves the table', before && !v.head.includes('Duration'), v.head.join(', '));
  // the same edit with its transitions removed: clips under them can't be placed
  const xml=fs.readFileSync(FIX+'transitions.xml','utf8').replace(/<transitionitem>[\s\S]*?<\/transitionitem>/g,'');
  fs.writeFileSync('/tmp/untransitioned.xml', xml);
  await (await p.$(C('#file-input'))).setInputFiles('/tmp/untransitioned.xml'); await p.waitForTimeout(1000);
  v=await view();
  ok('rows it couldn\u2019t place are marked and counted', v.marked>0 && new RegExp(v.marked+' need checking').test(v.count) &&
     v.rows.filter(r=>r[0]==='!').length===v.marked, v.count);
  ok('no page errors', !errs.length, errs.slice(0,3).join(' | '));
  await done(b);
})().catch(e=>{ console.error('ERR', e.message); process.exit(1); });
