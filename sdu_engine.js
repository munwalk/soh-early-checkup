/* sdu_engine.js — SDU 판정 엔진. RWTH(rwth_engine.js·rwth_model.js)와 모델·q(t)·λ를 공유하지 않아요.
   출처: sdu_data/SDU_WEB_FINAL_9to12_WITH_TREES.json (battexp/models.py hand_features 이식, LGBM 5시드 평균)
   입력: 이미 10초 격자로 가공된 60분 Step12 충전 CSV (t=10…3600초, 360행). 원시 → 10초 보간은 원본 코드가 확인되지 않아 하지 않아요.
   검증용 변경: 각 단계의 dVdt는 해당 시점까지의 전압만으로 다시 계산합니다.
   중요: 새 인과적 전처리로 다시 학습한 모델 및 보정된 q(t)·λ를 사용합니다.
   CSV 입력은 여전히 전체 60분을 요구하므로 진정한 실시간 스트리밍 인터페이스는 아닙니다. */
(function(root){
const DT=10,N=360,CH=['V','I','temp','dQ','dVdt'];

/* CSV → 5채널. 형식만 검사하고, 값의 크기로 판정을 막지는 않아요(입력 허용 범위는 아직 검증 전이에요). */
const COLS={time:['time_s'],V:['voltage_V'],I:['current_A'],temp:['temperature_C'],dQ:['charge_Ah_from_10s','charge_Ah'],dVdt:['dvdt_mV_min','dVdt_mV_min']};
function parse(text){
  text=String(text).replace(/^﻿/,'');const L=text.trim().split(/\r?\n/).filter(x=>x.trim());
  if(L.length<2)throw new Error('데이터가 비어 있어요.');
  const h=L[0].split(',').map(s=>s.trim()),col=k=>COLS[k].map(c=>h.indexOf(c)).find(i=>i>=0);
  const need=['time','V','I','temp','dQ'],ix={};
  for(const k of need){ix[k]=col(k);}
  const miss=need.filter(k=>ix[k]==null).map(k=>COLS[k].join(' 또는 '));
  if(miss.length)throw new Error('필요한 열이 없어요: '+miss.join(', '));
  ix.dVdt=col('dVdt');
  const rows=[];
  for(let i=1;i<L.length;i++){const p=L[i].split(',');const r={};
    for(const k of Object.keys(ix))if(ix[k]!=null)r[k]=p[ix[k]]===undefined||p[ix[k]].trim()===''?NaN:Number(p[ix[k]]);
    rows.push(r);}
  if(rows.some(r=>Object.values(r).some(v=>!Number.isFinite(v))))throw new Error('비어 있거나 숫자가 아닌 값이 있어요.');
  if(rows.length!==N)throw new Error(`60분 전체 기록(10초 간격 ${N}행)이 필요해요. 지금 ${rows.length}행이에요.`);
  for(let i=0;i<N;i++)if(Math.abs(rows[i].time-(i+1)*DT)>0.5)
    throw new Error(`time_s는 10, 20, …, 3600초여야 해요. ${i+2}번째 줄이 ${rows[i].time}초예요. (원시 기록의 보간은 아직 지원하지 않아요)`);
  const c={};for(const k of ['V','I','temp','dQ'])c[k]=rows.map(r=>r[k]);
  const q0=c.dQ[0];c.dQ=c.dQ.map(x=>x-q0);                       // 기준점: dQ(10초)=0
  c.dVdtFromFile=ix.dVdt!=null;
  c.dVdt=c.dVdtFromFile?rows.map(r=>r.dVdt):gradient(c.V).map(g=>g*60000);
  for(const k of CH)c[k]=c[k].map(Math.fround);                  // 학습 배열(X_curve.npy)이 float32라서 맞춰요. 안 하면 전류 특징이 분기값에 걸려 예측이 어긋나요
  return c;}

/* np.gradient(V, 10): 처음은 전진, 끝은 후진, 안쪽은 중앙 차분 */
function gradient(v){const n=v.length,g=new Array(n);
  g[0]=(v[1]-v[0])/DT;g[n-1]=(v[n-1]-v[n-2])/DT;
  for(let i=1;i<n-1;i++)g[i]=(v[i+1]-v[i-1])/(2*DT);return g;}

/* hand_features: 채널마다 13개 × 5채널 + 정전류 끝 위치 = 66개.
   Python(SDU_LTT_alpha5_12_final_500.ipynb)은 numpy float32로 계산하고 결과도 float32로 바꿔요. 그대로 따라 해야
   분기값 바로 옆 특징(특히 거의 일정한 전류의 표준편차)이 같은 쪽으로 가요. 그래서 덧셈마다 float32로 반올림하고,
   합계는 numpy와 같은 pairwise 방식(8개 묶음, 128개 단위로 반씩 나눔)으로 더해요. */
const fr=Math.fround;
function pwSum(a,lo,n){                                            // numpy pairwise_sum_FLOAT
  if(n<8){let s=0;for(let i=0;i<n;i++)s=fr(s+a[lo+i]);return s;}
  if(n<=128){const r=a.slice(lo,lo+8);let i=8;
    for(;i<n-(n%8);i+=8)for(let k=0;k<8;k++)r[k]=fr(r[k]+a[lo+i+k]);
    let s=fr(fr(fr(r[0]+r[1])+fr(r[2]+r[3]))+fr(fr(r[4]+r[5])+fr(r[6]+r[7])));
    for(;i<n;i++)s=fr(s+a[lo+i]);return s;}
  let n2=Math.floor(n/2);n2-=n2%8;return fr(pwSum(a,lo,n2)+pwSum(a,lo+n2,n-n2));}
const mean32=a=>fr(pwSum(a,0,a.length)/a.length);
const std32=(a,m)=>fr(Math.sqrt(fr(pwSum(a.map(v=>{const z=fr(v-m);return fr(z*z);}),0,a.length)/a.length)));
function chanFeats(x){const L=x.length;let mn=Infinity,mx=-Infinity;for(const v of x){if(v<mn)mn=v;if(v>mx)mx=v;}
  const m=mean32(x),qi=[1,2,3].map(k=>Math.floor((L-1)*k/4));        // np.linspace(0,L-1,5).astype(int)[1:-1]
  const d=[];let dmx=0;for(let i=1;i<L;i++){const z=fr(x[i]-x[i-1]);d.push(z);if(Math.abs(z)>dmx)dmx=Math.abs(z);}
  const dm=mean32(d);
  return[x[0],x[L-1],m,std32(x,m),mn,mx,fr(fr(x[L-1]-x[0])/Math.max(L-1,1)),x[qi[0]],x[qi[1]],x[qi[2]],dm,std32(d,dm),dmx];}
function features(c,n){const f=[];for(const k of CH)f.push(...chanFeats(c[k].slice(0,n).map(fr)));
  const I=c.I.slice(0,n).map(fr),thr=fr(fr(0.95)*Math.max(...I.map(Math.abs)));let cc=I.findIndex(v=>Math.abs(v)<thr);
  f.push(cc<0?n:cc);return f;}

/* 검증용 미래참조 없는 단계 특징: 시점 n까지의 V만으로 dVdt를 재계산합니다.
   FULL CSV 안의 dVdt 채널을 사용하지 않아도 되고, n+1 시점 전압값은 접근하지 않습니다.
   주의: 훈련/보정 값의 유효성을 자동 보장하지 않습니다. */
function streamingFeatures(c,n){
  if(n<2 || n>c.V.length)throw new Error('측정된 구간이 부족합니다.');
  // 학습에 사용한 causal_stage()와 동일: 마지막 1개 dVdt만 후진차분으로 교체.
  // 앞선 포인트의 원본 dVdt는 현재 시점 이전 데이터만 참조함.
  const last=fr(fr(fr(c.V[n-1]-c.V[n-2])/fr(10))*fr(60000));
  const dv=c.dVdt.slice(0,n);dv[n-1]=last;
  return features({...c,dVdt:dv},n);
}

/* 압축 트리: 노드 i가 내부면 f[i]>=0이고 t[i]가 분기값, 잎이면 f[i]=-1이고 t[i]가 잎 값 */
function tree(t,f){let i=0;while(t.f[i]>=0)i=f[t.f[i]]<=t.t[i]?t.l[i]:t.r[i];return t.t[i];}
function predictStage(M,stage,f){const seeds=M[stage];let s=0;
  for(const forest of seeds){let p=0;for(const t of forest)p+=tree(t,f);s+=p;}
  return s/seeds.length;}

const gradeOf=s=>s>=70?'A':(s>=60?'B':'C');

/* 단계 판정: 등급선(60·70)까지 거리 > λ·q(t)면 확정, 아니면 다음 단계, 60분에도 못 정하면 정밀검사(+fullTestMin분, v4는 365분) */
function judge(c,M,cfg,alpha){
  const lam=cfg.lambda[alpha.toFixed(2)];if(lam==null)throw new Error('SDU에서 지원하지 않는 α예요.');
  const steps=[];let done=null;
  for(const st of cfg.stages){
    const f=streamingFeatures(c,st*6),p=predictStage(M,st,f),q=cfg.q[st];
    const nb=Math.abs(p-60)<Math.abs(p-70)?60:70,d=Math.min(Math.abs(p-60),Math.abs(p-70)),need=lam*q,ok=d>need;
    steps.push({stage:st,soh:p,q,lo:p-q,hi:p+q,nb,near:d,need,ok,grade:gradeOf(p),reached:!done});
    if(ok&&!done)done=steps[steps.length-1];}
  const out={alpha,lambda:lam,steps};
  if(done)Object.assign(out,{decision:'auto',stage:done.stage,minutes:done.stage,soh:done.soh,q:done.q,lo:done.lo,hi:done.hi,grade:done.grade,near:done.near,need:done.need,nb:done.nb});
  else{const last=steps[steps.length-1];Object.assign(out,{decision:'precise',stage:null,minutes:cfg.stages[cfg.stages.length-1]+cfg.fullTestMin,soh:last.soh,q:last.q,lo:last.lo,hi:last.hi,grade:last.grade,near:last.near,need:last.need,nb:last.nb});}
  return out;}

const API={parse,gradient,features,streamingFeatures,predictStage,judge,gradeOf,N,DT};
if(typeof module!=='undefined'&&module.exports)module.exports=API;else root.SDU=API;
})(typeof window!=='undefined'?window:globalThis);
