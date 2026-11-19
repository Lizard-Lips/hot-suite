// Sub Sync: byte-order mark, multi-line cues preserved, corrections re-wrapped.
const { chromium } = require('playwright'); const fs=require('fs');
const {GEN,ok,done,tool}=require('./_lib');
(async () => {
  const b=await chromium.launch(); const p=await b.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(tool('tool_subsync.html')); await p.waitForTimeout(400);
  const txt=fs.readFileSync(GEN+'bom.srt','utf8');
  const r=await p.evaluate(t=>{ const c=parseSRT(t); cues=c; discrepancies=[]; manualEdits={};
    const untouched=buildSRT();
    discrepancies=[{cueIdx:0,decision:'accept',corrected:"I did not know that it was you.",editedText:null}];
    return {n:c.length, first:c[0]&&c[0].text, untouched, corrected:buildSRT()}; }, txt);
  ok('byte-order mark: first cue kept', r.n===3 && /didn't know/.test(r.first), r.n+' cues');
  ok('untouched export keeps two-line cues', /I didn't know\nthat was you\./.test(r.untouched) && /Two lines\nagain here\./.test(r.untouched));
  ok('correction re-wrapped to original layout', /I did not know\nthat it was you\./.test(r.corrected));
  ok('no page errors', !errs.length, errs.join(' | '));
  await done(b);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
