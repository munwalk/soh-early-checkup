/* verify_sdu_holdout.js — 독립 테스트 18셀 1,729건으로 웹 SDU 판정 엔진(sdu_engine.js + sdu_model.js)을 자동 검증해요.
   화면 업로드 없이, 가공 곡선 X_curve.npy를 직접 읽어 엔진에 넣고 Python 결과와 비교해요.

   실행 (battery-grader 폴더에서):
     node frontend_v3/tools/verify_sdu_holdout.js --npy <X_curve.npy> --trace <SDU_DEPLOY_HOLDOUT_TRACE_ALPHA10.csv>
   선택:
     --trace-a 0.09=<csv>      α별 Python trace가 더 있으면 (열 형식은 ALPHA10 trace와 같게). 여러 번 써도 돼요
     --stage-preds <csv>       Python 단계별 예측(sample_id + 5·10·30·60분 예측 열)이 있으면 4단계 전부 비교
     --row-of <csv>            X_curve 행 번호가 sample_id와 다를 때: sample_id,row 대응표
     --out <폴더>              불일치 목록 CSV를 저장할 곳 (기본: 저장 안 함)
     --py-features <csv>       tools/dump_py_features.py 결과. 특징·트리·모델 중 어디서 달라지는지 진단

   기준값:
     α=10%     → trace의 샘플별 상태·확정 단계·등급·예측값(확정 건만 예측값이 있어요)
     α=9·11·12% → 샘플별 Python 결과가 없으면 배포 JSON의 독립 테스트 요약값(오판·정밀검사 건수, 평균 시간)과 비교
   입력은 sdu_engine.parse()와 같게 float32로 맞추고, dVdt는 배열에 저장된 값을 그대로 써요. */
const fs=require('fs'),path=require('path');
const SDU=require('../sdu_engine.js'),{SDU_CFG,SDU_MODELS,SDU_EXAMPLES}=require('../sdu_model.js');
const CH=['V','I','temp','dQ','dVdt'],TOL=1e-6;

/* ----- 인자 ----- */
const args={traceA:{}};
for(let i=2;i<process.argv.length;i++){const k=process.argv[i],v=process.argv[++i];
  if(k==='--npy')args.npy=v;else if(k==='--trace')args.traceA['0.10']=v;else if(k==='--trace-a'){const [a,p]=v.split('=');args.traceA[Number(a).toFixed(2)]=p;}
  else if(k==='--stage-preds')args.stagePreds=v;else if(k==='--py-features')args.pyFeatures=v;else if(k==='--row-of')args.rowOf=v;else if(k==='--out')args.out=v;
  else{console.error('모르는 인자:',k);process.exit(2);}}
if(!args.npy||!args.traceA['0.10']){console.error('필수: --npy <X_curve.npy> --trace <SDU_DEPLOY_HOLDOUT_TRACE_ALPHA10.csv>');process.exit(2);}

/* ----- .npy 읽기 (float32/float64, C 순서) ----- */
function readNpy(p){const b=fs.readFileSync(p);
  if(b.toString('latin1',1,6)!=='NUMPY')throw new Error('.npy 파일이 아니에요: '+p);
  const major=b[6],hl=major===1?b.readUInt16LE(8):b.readUInt32LE(8),h0=major===1?10:12,hdr=b.toString('latin1',h0,h0+hl);
  const descr=/'descr':\s*'([^']+)'/.exec(hdr)[1],fortran=/'fortran_order':\s*True/.test(hdr),shape=/'shape':\s*\(([^)]*)\)/.exec(hdr)[1].split(',').map(s=>s.trim()).filter(Boolean).map(Number);
  if(fortran)throw new Error('fortran_order 배열은 지원하지 않아요');
  const off=h0+hl,buf=b.buffer.slice(b.byteOffset+off,b.byteOffset+b.length);
  const data=descr==='<f4'?new Float32Array(buf):descr==='<f8'?new Float64Array(buf):null;
  if(!data)throw new Error('지원하지 않는 dtype: '+descr);
  return{shape,data,descr};}
const X=readNpy(args.npy);
if(X.shape.length!==3)throw new Error('X_curve 모양이 3차원이 아니에요: '+X.shape);
/* (N,360,5)와 (N,5,360) 둘 다 받아요 */
const [NR,A1,A2]=X.shape,tLast=A1===360&&A2===5;if(!tLast&&!(A1===5&&A2===360))throw new Error('X_curve 모양이 (N,360,5)나 (N,5,360)이 아니에요: '+X.shape);
function curveAt(row){if(row<0||row>=NR)throw new Error('X_curve에 없는 행: '+row);const c={},base=row*1800;
  CH.forEach((k,j)=>{const a=new Array(360);for(let t=0;t<360;t++)a[t]=Math.fround(X.data[base+(tLast?t*5+j:j*360+t)]);c[k]=a;});
  return c;}

/* ----- CSV ----- */
function readCsv(p){const L=fs.readFileSync(p,'utf8').replace(/^﻿/,'').trim().split(/\r?\n/),h=L[0].split(',').map(s=>s.trim());
  return L.slice(1).map(l=>{const v=l.split(',');return Object.fromEntries(h.map((k,i)=>[k,v[i]===undefined?'':v[i].trim()]));});}
const num=s=>s===''||s==null?null:Number(s);
const rowOf=new Map();if(args.rowOf)for(const r of readCsv(args.rowOf))rowOf.set(Number(r.sample_id),Number(r.row));
const ROW=id=>rowOf.size?rowOf.get(id):id;

/* ----- 행 번호 확인: 시연 CSV 10개(X_curve에서 그대로 꺼낸 값)가 그 sample_id 행과 같은지 ----- */
let mapOk=0,mapMax=0;
for(const ex of SDU_EXAMPLES){const id=Number(/sample(\d+)/.exec(ex.name)[1]),c=SDU.parse(ex.csv);let d=0;
  try{const x=curveAt(ROW(id));for(const k of CH)for(let t=0;t<360;t++)d=Math.max(d,Math.abs(x[k][t]-c[k][t])/Math.max(1,Math.abs(c[k][t])));}catch(e){d=Infinity;}
  mapMax=Math.max(mapMax,d);if(d<1e-6)mapOk++;}
console.log(`행 대응 확인: 시연 CSV ${mapOk}/${SDU_EXAMPLES.length}개가 X_curve[sample_id 행]과 일치 (최대 상대 차이 ${mapMax.toExponential(2)})`);
if(mapOk<SDU_EXAMPLES.length)console.log('  ⚠ 행 번호가 sample_id와 다를 수 있어요. --row-of 로 대응표를 주세요.');

/* ----- 엔진 실행: 샘플마다 4단계 예측 한 번, α마다 판정 ----- */
const trace10=readCsv(args.traceA['0.10']),ids=trace10.map(r=>Number(r.sample_id)),truth=new Map(trace10.map(r=>[Number(r.sample_id),Number(r.soh)]));
const t0=Date.now(),web=new Map();
for(const id of ids){const c=curveAt(ROW(id)),byA={};for(const a of SDU_CFG.alphas)byA[a.toFixed(2)]=SDU.judge(c,SDU_MODELS,SDU_CFG,a);web.set(id,byA);}
console.log(`엔진 실행: ${ids.length}건 × α ${SDU_CFG.alphas.length}개, ${((Date.now()-t0)/1000).toFixed(1)}초\n`);

/* ----- 샘플별 비교 ----- */
const mism=[],rows=[];
function cmpTrace(aKey,tr){const st={n:0,pred:{ok:0,bad:0,max:0,n:0},stage:{ok:0,bad:0},grade:{ok:0,bad:0},precise:{ok:0,bad:0}};
  for(const r of tr){const id=Number(r.sample_id),w=web.get(id)&&web.get(id)[aKey];if(!w){mism.push({alpha:aKey,id,item:'없음',py:'trace에만 있음',js:''});continue;}st.n++;
    const pyPre=r.status==='precise',jsPre=w.decision==='precise';
    (pyPre===jsPre?st.precise.ok++:(st.precise.bad++,mism.push({alpha:aKey,id,item:'정밀검사',py:r.status,js:w.decision})));
    const ps=pyPre?null:num(r.stage),js=jsPre?null:w.stage;
    (ps===js?st.stage.ok++:(st.stage.bad++,mism.push({alpha:aKey,id,item:'확정 단계',py:ps,js})));
    const pg=pyPre?'정밀':r.grade_pred,jg=jsPre?'정밀':w.grade;
    (pg===jg?st.grade.ok++:(st.grade.bad++,mism.push({alpha:aKey,id,item:'등급',py:pg,js:jg})));
    const pp=num(r.pred);
    if(pp!=null){st.pred.n++;const s=pyPre?null:w.steps.find(x=>x.stage===ps),e=s?Math.abs(s.soh-pp):Infinity;st.pred.max=Math.max(st.pred.max,e);
      (e<=TOL?st.pred.ok++:(st.pred.bad++,mism.push({alpha:aKey,id,item:'SOH 예측',py:pp,js:s?s.soh:''})));}}
  return st;}
const perSample={};for(const [a,p] of Object.entries(args.traceA))perSample[a]=cmpTrace(a,a==='0.10'?trace10:readCsv(p));

/* 단계별 예측 4개 전부 (Python 단계별 예측 파일이 있을 때) */
let stagePred=null;
if(args.stagePreds){const sp=readCsv(args.stagePreds),h=Object.keys(sp[0]),colOf={};
  for(const s of SDU_CFG.stages){colOf[s]=h.find(k=>new RegExp(`(^|[^0-9])${s}(min)?($|[^0-9])`).test(k)&&/pred|soh|p_?/.test(k)&&k!=='sample_id');}
  stagePred={};for(const s of SDU_CFG.stages)stagePred[s]={ok:0,bad:0,max:0,col:colOf[s]};
  for(const r of sp){const id=Number(r.sample_id),w=web.get(id);if(!w)continue;const steps=w['0.10'].steps;
    for(const s of SDU_CFG.stages){if(!colOf[s])continue;const e=Math.abs(steps.find(x=>x.stage===s).soh-Number(r[colOf[s]]));const o=stagePred[s];o.max=Math.max(o.max,e);
      (e<=TOL?o.ok++:(o.bad++,mism.push({alpha:'단계'+s,id,item:'단계 예측',py:r[colOf[s]],js:steps.find(x=>x.stage===s).soh})));}}}

/* ----- 요약값 비교 (모든 α): 배포 JSON 독립 테스트 값 ----- */
function summary(aKey){let mis=0,pre=0,time=0;
  for(const id of ids){const w=web.get(id)[aKey],tg=SDU.gradeOf(truth.get(id));
    if(w.decision==='precise'){pre++;time+=60+SDU_CFG.fullTestMin;}else{time+=w.stage;if(w.grade!==tg)mis++;}}
  return{mis,pre,time:time/ids.length};}

/* ----- 출력 ----- */
const pad=(s,n)=>{s=String(s);const w=[...s].reduce((x,c)=>x+(c.charCodeAt(0)>0x2e80?2:1),0);return s+' '.repeat(Math.max(0,n-w));};
const line=c=>console.log('| '+c.map((x,i)=>pad(x,[6,12,14,8,8,16][i]||10)).join(' | ')+' |');
console.log('## 1. 샘플별 비교 (Python trace 기준)\n');
line(['α','비교 항목','기준 건수','일치','불일치','최대 예측 오차']);line(['---','---','---','---','---','---']);
for(const a of SDU_CFG.alphas.map(x=>x.toFixed(2))){const s=perSample[a],A=Math.round(Number(a)*100)+'%';
  if(!s){line([A,'(전체)','샘플별 기준 없음','—','—','—']);continue;}
  line([A,'SOH 예측',s.pred.n+' (확정 건)',s.pred.ok,s.pred.bad,s.pred.max.toExponential(2)]);
  line([A,'확정 단계',s.n,s.stage.ok,s.stage.bad,'']);line([A,'등급',s.n,s.grade.ok,s.grade.bad,'']);line([A,'정밀검사 여부',s.n,s.precise.ok,s.precise.bad,'']);}
if(stagePred){console.log('\n## 1-1. 단계별 SOH 예측 (Python 단계별 예측 기준, α와 무관)\n');line(['단계','열 이름','기준 건수','일치','불일치','최대 예측 오차']);line(['---','---','---','---','---','---']);
  for(const s of SDU_CFG.stages){const o=stagePred[s];line([s+'분',o.col||'(열 없음)',o.ok+o.bad,o.ok,o.bad,o.col?o.max.toExponential(2):'—']);}}
console.log('\n## 2. 요약값 비교 (배포 JSON 독립 테스트 값 기준, 1,729건)\n');
line(['α','항목','Python','웹 JS','일치','']);line(['---','---','---','---','---','']);
for(const at of SDU_CFG.alphaTable){const a=at.alpha.toFixed(2),A=Math.round(at.alpha*100)+'%',js=summary(a),py=at.test,n=py.samples;
  const pm=Math.round(py.misgrade*n),pp=Math.round(py.precise*n);
  line([A,'오판 건수',pm,js.mis,pm===js.mis?'예':'아니오','']);line([A,'정밀검사 건수',pp,js.pre,pp===js.pre?'예':'아니오','']);
  line([A,'평균 시간(분)',py.minutes.toFixed(4),js.time.toFixed(4),Math.abs(py.minutes-js.time)<1e-3?'예':'차이 '+Math.abs(py.minutes-js.time).toFixed(4),'']);}
/* 같은 α의 Python trace가 있으면 trace로 직접 센 요약값과도 비교 (배포 JSON 요약값과 trace는 sample 5888 한 건, 5분 차이가 있어요) */
for(const [a,p] of Object.entries(args.traceA)){const tr=a==='0.10'?trace10:readCsv(p),js=summary(a),A=Math.round(Number(a)*100)+'%';let mis=0,pre=0,time=0;
  for(const r of tr){if(r.status==='precise'){pre++;time+=60+SDU_CFG.fullTestMin;}else{time+=Number(r.stage);if(r.grade_pred!==SDU.gradeOf(Number(r.soh)))mis++;}}
  time/=tr.length;
  line([A,'오판 (trace)',mis,js.mis,mis===js.mis?'예':'아니오','']);line([A,'정밀 (trace)',pre,js.pre,pre===js.pre?'예':'아니오','']);
  line([A,'시간 (trace)',time.toFixed(4),js.time.toFixed(4),Math.abs(time-js.time)<1e-9?'예':'차이 '+Math.abs(time-js.time).toFixed(4),'']);}
if(ids.length!==SDU_CFG.alphaTable[0].test.samples)console.log(`\n⚠ trace 건수(${ids.length})가 배포 JSON 독립 테스트 건수(${SDU_CFG.alphaTable[0].test.samples})와 달라서 요약값 비교는 참고만 하세요.`);

/* ----- 원인 진단 (--py-features: tools/dump_py_features.py 결과) -----
   ① 특징: Python hand_features vs JS features 66개를 그대로 비교 → 어느 특징부터 다른지
   ② 트리: 같은 Python 특징을 JS 트리 탐색에 넣은 값 vs Python이 JSON 트리를 따라간 값 → JS 트리 탐색 확인
   ③ 모델: Python JSON 트리 예측 vs trace 예측(확정 단계) → trace를 만든 모델과 배포 JSON이 같은지 */
if(args.pyFeatures){
  const FN=[];for(const k of CH)for(const s of ['first','last','mean','std','min','max','slope','q1','mid','q3','d_mean','d_std','d_absmax'])FN.push(k+'.'+s);FN.push('cc_end');
  const tr=new Map(trace10.map(r=>[Number(r.sample_id),r]));
  const per=FN.map(()=>({n:0,max:0})),diag={rows:0,featSame:0,firstDiff:{},tree:{n:0,max:0},model:{n:0,bad:0,max:0,ids:[]},js:{n:0,max:0}};
  for(const r of readCsv(args.pyFeatures)){const id=Number(r.sample_id),st=Number(r.stage),pf=FN.map((_,i)=>Number(r['f'+i])),pj=Number(r.pred_json);diag.rows++;
    const jf=SDU.features(curveAt(ROW(id)),st*6);let first=-1;
    jf.forEach((v,i)=>{if(v!==pf[i]){per[i].n++;per[i].max=Math.max(per[i].max,Math.abs(v-pf[i]));if(first<0)first=i;}});
    if(first<0)diag.featSame++;else diag.firstDiff[FN[first]]=(diag.firstDiff[FN[first]]||0)+1;
    const tj=SDU.predictStage(SDU_MODELS,st,pf);diag.tree.n++;diag.tree.max=Math.max(diag.tree.max,Math.abs(tj-pj));
    const jp=SDU.predictStage(SDU_MODELS,st,jf);diag.js.n++;diag.js.max=Math.max(diag.js.max,Math.abs(jp-pj));
    const t=tr.get(id);if(t&&t.status==='confirmed'&&Number(t.stage)===st){const e=Math.abs(pj-Number(t.pred));diag.model.n++;diag.model.max=Math.max(diag.model.max,e);if(e>TOL){diag.model.bad++;diag.model.ids.push(id);}}}
  console.log('\n## 3. 원인 진단 (Python 특징·JSON 트리 기준)\n');
  console.log(`① 특징 66개 완전 일치: ${diag.featSame}/${diag.rows}행`);
  const dif=per.map((p,i)=>({name:FN[i],...p})).filter(p=>p.n).sort((a,b)=>b.n-a.n);
  if(dif.length){console.log('   다른 특징 (행 수 · 최대 차이):');dif.slice(0,12).forEach(p=>console.log(`   - ${p.name}: ${p.n}행 · ${p.max.toExponential(2)}`));
    console.log('   처음 달라지는 특징:',JSON.stringify(diag.firstDiff));}
  console.log(`② 같은 특징으로 JS 트리 vs Python 트리: 최대 차이 ${diag.tree.max.toExponential(2)} (${diag.tree.n}행)`);
  console.log(`   JS 특징+JS 트리 vs Python 특징+Python 트리: 최대 차이 ${diag.js.max.toExponential(2)}`);
  console.log(`③ Python JSON 트리 vs trace 예측(확정 단계): ${diag.model.n}건 중 불일치 ${diag.model.bad}건, 최대 ${diag.model.max.toExponential(2)}${diag.model.ids.length?' · 예: '+diag.model.ids.slice(0,8).join(' '):''}`);
  const featOk=diag.featSame===diag.rows,treeOk=diag.tree.max<=TOL;
  console.log('\n진단:',!treeOk?'JS 트리 탐색이 Python과 달라요 → sdu_model.js 변환/탐색 확인'
    :!featOk?'JS 특징 계산이 Python과 달라요 → 위 특징부터 고치면 돼요'
    :diag.model.bad?'JS = Python(배포 JSON 트리)이에요. 남은 차이는 trace를 만든 모델과 배포 JSON이 달라서 생긴 거예요 (JS 문제 아님)'
    :'특징·트리·모델 모두 일치해요');}

/* ----- 4. 웹 구현 검증 (배포 JSON 기준) -----
   --py-features에 1,729건 × 4단계가 다 있으면, Python이 JSON 트리로 낸 단계별 예측(pred_json)에
   배포 JSON의 q(t)·λ와 판정 규칙을 여기서 따로 적용해 α 4개 모두 샘플별 기준값을 만들고 JS 판정과 비교해요.
   이 결과가 웹 통과/실패를 정해요. trace와의 차이(1·2절)는 연구 재현성 기록으로만 남겨요. */
let web4=null;
if(args.pyFeatures){
  const pj=new Map();for(const r of readCsv(args.pyFeatures)){const id=Number(r.sample_id);if(!pj.has(id))pj.set(id,{});pj.get(id)[Number(r.stage)]=Number(r.pred_json);}
  const full=ids.filter(id=>pj.has(id)&&SDU_CFG.stages.every(s=>Number.isFinite(pj.get(id)[s])));
  web4={covered:full.length,total:ids.length,alpha:{},mism:[]};
  for(const a of SDU_CFG.alphas){const key=a.toFixed(2),lam=SDU_CFG.lambda[key],o={pred:{n:0,bad:0,max:0},stage:{n:0,bad:0},grade:{n:0,bad:0},precise:{n:0,bad:0}};
    for(const id of full){const p=pj.get(id),w=web.get(id)[key];
      let st=null;for(const s of SDU_CFG.stages){if(Math.min(Math.abs(p[s]-60),Math.abs(p[s]-70))>lam*SDU_CFG.q[s]){st=s;break;}}
      const pyG=st==null?'정밀':SDU.gradeOf(p[st]),jsG=w.decision==='precise'?'정밀':w.grade;
      for(const s of SDU_CFG.stages){const e=Math.abs(w.steps.find(x=>x.stage===s).soh-p[s]);o.pred.n++;o.pred.max=Math.max(o.pred.max,e);if(e>TOL){o.pred.bad++;web4.mism.push({alpha:key,id,item:s+'분 SOH 예측',py:p[s],js:w.steps.find(x=>x.stage===s).soh});}}
      o.stage.n++;if(st!==w.stage){o.stage.bad++;web4.mism.push({alpha:key,id,item:'확정 단계',py:st,js:w.stage});}
      o.grade.n++;if(pyG!==jsG){o.grade.bad++;web4.mism.push({alpha:key,id,item:'등급',py:pyG,js:jsG});}
      o.precise.n++;if((st==null)!==(w.decision==='precise')){o.precise.bad++;web4.mism.push({alpha:key,id,item:'정밀검사',py:st==null,js:w.decision==='precise'});}}
    web4.alpha[key]=o;}
  console.log('\n## 4. 웹 구현 검증 (배포 JSON 기준 Python vs JS) — 통과/실패를 이 표로 정해요\n');
  console.log(`기준 범위: ${full.length}/${ids.length}건 × ${SDU_CFG.stages.length}단계${full.length<ids.length?'  ⚠ 전체가 아니에요. dump_py_features.py --ids 에 trace CSV를 주세요':''}\n`);
  line(['α','비교 항목','비교 건수','일치','불일치','최대 예측 오차']);line(['---','---','---','---','---','---']);
  for(const [key,o] of Object.entries(web4.alpha)){const A=Math.round(Number(key)*100)+'%';
    line([A,'SOH 예측(4단계)',o.pred.n,o.pred.n-o.pred.bad,o.pred.bad,o.pred.max.toExponential(2)]);
    for(const [k,lb] of [['stage','확정 단계'],['grade','등급'],['precise','정밀검사 여부']])line([A,lb,o[k].n,o[k].n-o[k].bad,o[k].bad,'']);}}

/* ----- 연구 재현성 기록: trace와 확정 단계가 다른 사례 (예: sample 5888) ----- */
const stageCases=mism.filter(m=>m.alpha==='0.10'&&m.item==='확정 단계').map(m=>{const w=web.get(m.id)['0.10'];
  return{id:m.id,py:m.py,js:m.js,steps:w.steps.map(s=>({stage:s.stage,soh:s.soh,need:s.need,margin:s.near-s.need}))};});
if(stageCases.length){console.log('\n## 5. 연구 재현성 기록 — trace와 확정 단계가 다른 사례 (α=10%)\n');
  for(const c of stageCases){console.log(`sample ${c.id}: trace ${c.py}분 확정 / 배포 JSON·웹 ${c.js}분 확정`);
    c.steps.forEach(s=>console.log(`   ${String(s.stage).padStart(2)}분 예측 ${s.soh.toFixed(6)} · 임계 λq ${s.need.toFixed(6)} · 여유 ${s.margin>=0?'+':''}${s.margin.toFixed(6)}`));}}

const traceBad=mism.length,webBad=web4?web4.mism.length:null,webFull=web4&&web4.covered===web4.total;
console.log('\n## 결론\n');
if(web4)console.log(`웹 구현 검증 (배포 JSON 기준): ${webFull&&webBad===0?'통과':'미통과'} — 불일치 ${webBad}건${webFull?'':' · 기준 범위가 전체가 아님'}`);
else console.log('웹 구현 검증 (배포 JSON 기준): 미실행 — --py-features 에 1,729건 전체 결과를 주세요');
console.log(`연구 재현성 (기존 trace 기준): 샘플별 불일치 ${traceBad}건${traceBad?' — 기록용. 배포 JSON 검증 통과가 기존 실험 결과의 완전 재현을 뜻하지는 않아요':''}`);
if(traceBad){console.log('trace 불일치 처음 10건:');mism.slice(0,10).forEach(m=>console.log(`  α ${m.alpha} · sample ${m.id} · ${m.item}: trace ${m.py} / JS ${m.js}`));}
if(args.out){fs.mkdirSync(args.out,{recursive:true});
  const csv=(f,rows)=>{fs.writeFileSync(path.join(args.out,f),'alpha,sample_id,item,python,js\n'+rows.map(m=>[m.alpha,m.id,m.item,m.py,m.js].join(',')).join('\n')+'\n');return path.join(args.out,f);};
  console.log('trace 기준 불일치:',csv('sdu_holdout_mismatch.csv',mism));
  if(web4)console.log('배포 JSON 기준 불일치:',csv('sdu_web_json_mismatch.csv',web4.mism));
  if(stageCases.length){fs.writeFileSync(path.join(args.out,'sdu_stage_cases.json'),JSON.stringify(stageCases,null,1));console.log('확정 단계 사례:',path.join(args.out,'sdu_stage_cases.json'));}}
/* 종료 코드: 배포 JSON 기준 결과가 있으면 그것만으로(웹 구현 검증), 없으면 trace 기준으로 정해요 */
process.exit(web4?(webFull&&webBad===0?0:1):(traceBad?1:0));
