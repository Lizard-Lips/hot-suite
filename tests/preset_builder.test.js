// Preset Builder regression: scan, frame rate, quoting, refusals and output
// minimality. Checks the value WRITTEN INTO THE .epr, not just what's on screen.
const { chromium } = require('playwright'); const fs=require('fs'); const path=require('path');
const TOOL='file://'+path.resolve(__dirname,'..',process.env.TOOL||'tool_presetbuilder.html');
const TICKS=254016000000; let fails=0;
const ok=(label,cond,detail)=>{ if(!cond) fails++; console.log((cond?'  ok   ':'  FAIL ')+label+(detail?'   '+detail:'')); };
async function make(b,spec){
  const ctx=await b.newContext({acceptDownloads:true}); const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(TOOL); await p.waitForTimeout(400);
  await p.click('.tabs button[data-m="paste"]'); await p.fill('#spec-paste',spec);
  await p.click('#read-btn'); await p.waitForTimeout(700);
  const ui=await p.evaluate(()=>({
    rows:Object.fromEntries([...document.querySelectorAll('.chg-row')].map(r=>[r.children[0].textContent,[r.children[1].textContent,r.children[2].textContent]])),
    refuse:(document.querySelector('.skip-hd')||{}).textContent||'',
    dl:!document.getElementById('p-out').classList.contains('hidden') }));
  let epr=null;
  if(ui.dl){ const [d]=await Promise.all([p.waitForEvent('download'),p.click('#dl-btn')]); const f='/tmp/_pb.epr'; await d.saveAs(f); epr=fs.readFileSync(f,'utf8'); }
  await ctx.close(); return {ui,epr,errs};
}
function val(epr,id){ const k=(epr.match(/<ExporterParam\b[\s\S]*?<\/ExporterParam>/g)||[]).find(q=>q.indexOf('<ParamIdentifier>'+id+'</ParamIdentifier>')>=0);
  const m=k&&k.match(/<ParamValue>([^<]*)<\/ParamValue>/); return m?m[1]:null; }
(async () => {
  const b=await chromium.launch();
  console.log('scan and field order');
  for (const [spec,want,label] of [
    ['1080i25 upper field first, ProRes 422 HQ',1,'named upper'],['1080i, 25fps, ProRes 422 HQ',1,'interlaced, order assumed'],
    ['Interlaced, lower field first, ProRes 422',2,'lower'],['1920x1080 50i TFF ProRes 422 HQ',1,'TFF'],
    ['1080p50, ProRes 422',0,'1080p50'],['1080x1920, 25fps progressive, ProRes 422',0,'progressive'],
    ['Please deliver 1920x1080 ProRes 422 HQ at 25p.',0,'prose 25p'],['1080x1080, ProRes 422',0,'silent → progressive']]) {
    const r=await make(b,spec); ok(label, r.epr && +val(r.epr,'ADBEVideoFieldType')===want, 'field='+(r.epr&&val(r.epr,'ADBEVideoFieldType')));
  }
  console.log('frame rate');
  for (const [spec,want,label] of [
    ['1080i25, ProRes 422 HQ',25,'1080i25'],['1080i50, ProRes 422 HQ',25,'1080i50 fields'],['1080i/29.97, ProRes 422 HQ',29.97,'1080i/29.97'],
    ['1080i59.94, ProRes 422 HQ',29.97,'59.94 fields'],['1080p50, ProRes 422',50,'1080p50'],['1080p23.976, ProRes 422',23.976,'23.976'],
    ['1080x1920, 30fps progressive, ProRes 422',30,'explicit 30fps'],['1080x1080, ProRes 422',25,'silent → 25']]) {
    const r=await make(b,spec); const f=r.epr?Math.round(TICKS/+val(r.epr,'ADBEVideoFPS')*1000)/1000:null;
    ok(label, f!==null && Math.abs(f-want)<0.01, f+'fps');
  }
  console.log('codec, resolution, quoting');
  let r=await make(b,'DELIVERY SPEC\nVideo: 1080 x 1920\nFrame rate: 25fps progressive\nCodec: Apple ProRes 422 LT\nWrapper: QuickTime .mov\nAudio: 48kHz, stereo');
  ok('ProRes 422 LT written as apcs', r.epr && +val(r.epr,'ADBEVideoCodec')===1634755443);
  ok('resolution 1080x1920', r.epr && val(r.epr,'ADBEVideoWidth')==='1080' && val(r.epr,'ADBEVideoHeight')==='1920');
  ok('quotes the spec line for codec', (r.ui.rows['Codec']||[])[1]==='\u201CCodec: Apple ProRes 422 LT\u201D', (r.ui.rows['Codec']||[])[1]);
  ok('no page errors', !r.errs.length, r.errs.join(' | '));
  console.log('refusals');
  r=await make(b,'please make it look nice'); ok('nothing usable → refuses, no download', /Nothing to build/.test(r.ui.refuse) && !r.ui.dl);
  r=await make(b,'1920x1080, 25fps, H.264, MP4'); ok('H.264 → refuses, no download', /Can.t make/.test(r.ui.refuse) && !r.ui.dl);
  console.log('output minimality');
  const tpl=fs.readFileSync(path.resolve(__dirname,'fixtures','CLEARCAST_PRORES.epr'),'utf8');
  r=await make(b,'1920x1080, ProRes 422 HQ, 25fps, progressive');
  const a=tpl.split('\n'), c=r.epr.split('\n'); const diff=a.filter((l,i)=>l!==c[i]).length;
  ok('same line count as the template', a.length===c.length, a.length+' vs '+c.length);
  ok('only name, id and field order differ', diff===3, diff+' lines differ');
  console.log('\n'+(fails? fails+' FAILED':'ALL PASSED')); await b.close(); process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
