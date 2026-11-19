// Shared helpers for the test suite.
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const GEN=path.join(__dirname,'fixtures','generated')+path.sep;
const FIX=path.join(__dirname,'fixtures')+path.sep;
let fails=0;
function ok(label,cond,detail){ if(!cond) fails++; console.log((cond?'  ok   ':'  FAIL ')+label+(detail!==undefined&&detail!==''?'   '+detail:'')); }
function done(b){ console.log('\n'+(fails? fails+' FAILED':'ALL PASSED')); return b.close().then(()=>process.exit(fails?1:0)); }
const tool=name=>'file://'+path.join(ROOT,name);
module.exports={ROOT,GEN,FIX,ok,done,tool};
