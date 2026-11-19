// Cut Logger downloads: the series switch, columns, and the PDF / Excel / CSV
// files themselves — opened and read back, not just generated.
const { chromium } = require('playwright'); const fs=require('fs'); const {execSync}=require('child_process');
const {FIX,ok,done,tool}=require('./_lib');
async function load(b, file){
  const ctx=await b.newContext({acceptDownloads:true, viewport:{width:1300,height:1100}}); const p=await ctx.newPage();
  p._errs=[]; p.on('pageerror',e=>p._errs.push(e.message));
  await p.goto(tool('tool_cutlogger.html')); await p.waitForTimeout(500);
  await (await p.$('#file-input')).setInputFiles(FIX+file); await p.waitForTimeout(1200);
  return p;
}
async function grab(p, btn, out){
  const [d]=await Promise.all([p.waitForEvent('download',{timeout:60000}), p.click(btn)]);
  await d.saveAs(out); return d.suggestedFilename();
}
const cols=p=>p.evaluate(()=>[...document.querySelectorAll('#col-tags .tag')].map(t=>t.textContent+(t.classList.contains('locked')?'(locked)':t.classList.contains('active')?'':'(off)')));
(async () => {
  const b=await chromium.launch();
  console.log('not a series');
  let p=await load(b,'promo_not_series.xml');
  ok('series switch off', !(await p.evaluate(()=>document.getElementById('opt-episodic').checked)));
  ok('duration not taken as an episode', !(await p.evaluate(()=>!!episodePattern)));
  ok('Episode column locked out', (await cols(p)).includes('Episode(locked)'));
  let name=await grab(p,'#generate-btn','/tmp/_cl.csv'); const csv=fs.readFileSync('/tmp/_cl.csv','utf8');
  ok('CSV has no Episode column', !/Episode/.test(csv.split('\n')[0]), csv.split('\n')[0]);
  ok('programme timecode includes the 10:00:00:00 start', /10:00:00:00/.test(csv));
  ok('file named after the sequence', name==='Autumn_Promo_Range_Timecodes.csv', name);
  ok('no page errors', !p._errs.length, p._errs.join(' | '));
  await p.context().close();

  console.log('series, with Polish and Romanian names');
  p=await load(b,'series_unicode.xml');
  ok('series switch on by itself', await p.evaluate(()=>document.getElementById('opt-episodic').checked));
  ok('Episode column available', (await cols(p)).includes('Episode'));
  // switching it off removes the column; on again brings it back
  await p.click('label:has(#opt-episodic)'); await p.waitForTimeout(200);
  ok('switching off locks the Episode column', (await cols(p)).includes('Episode(locked)'));
  await p.click('label:has(#opt-episodic)'); await p.waitForTimeout(200);
  await p.evaluate(()=>{ const t=[...document.querySelectorAll('#ep-sample span')].filter(s=>/\d/.test(s.textContent)); if(t[0]) t[0].click(); });
  await p.waitForTimeout(300);
  ok('picking the code again restores it', !!(await p.evaluate(()=>!!episodePattern)));

  name=await grab(p,'#xlsx-btn','/tmp/_cl.xlsx');
  const x=JSON.parse(execSync(`python3 -c "
import openpyxl,json
wb=openpyxl.load_workbook('/tmp/_cl.xlsx'); ws=wb.active
hdr=[c.value for c in ws[4]]
rows=[[c.value for c in r] for r in ws.iter_rows(min_row=5,values_only=False)]
print(json.dumps({'title':ws['A1'].value,'meta':ws['A2'].value,'hdr':hdr,'freeze':ws.freeze_panes,'filter':ws.auto_filter.ref,
 'font':ws['A5'].font.name,'tcType':type(ws.cell(5,hdr.index('Source in')+1).value).__name__,
 'names':[ws.cell(r,hdr.index('Filename')+1).value for r in range(5,ws.max_row+1)],
 'eps':[ws.cell(r,hdr.index('Episode')+1).value for r in range(5,ws.max_row+1)] if 'Episode' in hdr else []}))
"`).toString());
  console.log('   Excel: "'+x.title+'"  |  '+x.hdr.join(', '));
  ok('header row frozen', x.freeze==='A5', x.freeze);
  ok('filter on the header row', /^A4:/.test(x.filter||''), x.filter);
  ok('Arial throughout', x.font==='Arial', x.font);
  ok('timecodes stored as text', x.tcType==='str', x.tcType);
  ok('Polish and Romanian names intact', x.names.some(n=>n.indexOf('Łódź')>=0) && x.names.some(n=>n.indexOf('Ștefan_și_Țara')>=0));
  ok('episodes read', JSON.stringify([...new Set(x.eps)])==='["101","102"]'||[...new Set(x.eps)].length===2, JSON.stringify([...new Set(x.eps)]));

  name=await grab(p,'#pdf-btn','/tmp/_cl.pdf');
  const txt=execSync('pdftotext -layout /tmp/_cl.pdf -').toString();
  console.log('   PDF:  '+name+'  ('+execSync('pdfinfo /tmp/_cl.pdf | grep Pages').toString().trim()+')');
  ok('title and column headings present, unwrapped', /Ślepnąc — Clearance/.test(txt) && /Filename/.test(txt) && /Programme in/.test(txt) && /Programme out/.test(txt) && /Source out/.test(txt));
  ok('plain filename', name==='Slepnac-Clearance_Timecodes.pdf' || name==='Slepnac_-_Clearance_Timecodes.pdf', name);
  ok('grouped by episode', /S01 Ep1/.test(txt) && /S01 Ep2/.test(txt) && !/Episode S01/.test(txt));
  ok('Ł, ł, ś, ș, ț render correctly', ['Łódź','Kraków','Ștefan','Țara','świt'].every(w=>txt.indexOf(w)>=0),
     ['Łódź','Kraków','Ștefan','Țara','świt'].filter(w=>txt.indexOf(w)<0).join(','));
  ok('no page errors', !p._errs.length, p._errs.join(' | '));
  await p.context().close();

  console.log('CSV safety');
  // names that Excel would read as formulas must arrive as text
  p=await load(b,'formula_names.xml');
  await grab(p,'#generate-btn','/tmp/_inj.csv');
  const cells=fs.readFileSync('/tmp/_inj.csv','utf8').trim().split('\n').slice(1).map(l=>l.split('","')[1]);
  ok('formula-like names neutralised', cells.filter(c=>/^[=+\-@]/.test(c)).length===0 && cells.filter(c=>/^'[=+\-@]/.test(c)).length===4, cells.join(' | '));
  ok('ordinary names untouched', cells.includes('Normal_clip.mov'));

  console.log('offline');
  let blocked=true;
  await p.context().route(/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/, r => blocked ? r.abort() : r.continue());
  await p.click('#pdf-btn'); await p.waitForTimeout(3000);
  const st=await p.evaluate(()=>({m:document.getElementById('status').textContent, en:![...document.querySelectorAll('.dl-btn')].some(x=>x.disabled)}));
  ok('plain message, buttons usable', /check your internet connection/.test(st.m) && st.en, st.m);
  blocked=false;
  const [rd]=await Promise.all([p.waitForEvent('download',{timeout:60000}), p.click('#pdf-btn')]);
  ok('works again once back online', /\.pdf$/.test(rd.suggestedFilename()));
  await done(b);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
