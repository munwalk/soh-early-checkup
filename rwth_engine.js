/* rwth_engine.js — RWTH 판정 엔진. SDU(sdu_engine.js)와 모델·q(t)·λ를 공유하지 않아요.
   출처: rwth_ridge_web/rwth_web_independent_validated_config.json (단계별 Ridge 5채널, 팀원 index.html의 판정식 그대로)
   입력: 충전 시작부터 10초 간격 CSV (time_s=0, 10, 20, …). 1분(7행)부터 판정하고, 30분(181행)까지 있으면 모든 단계를 봐요.
   원시 → 10초 보간은 학습 전처리 코드가 확인되지 않아 하지 않아요. */
(function(root){
const DT=10,CH=['voltage_V','current_A','charge_Ah','energy_Wh','temperature_C'];

/* CSV → 행 배열 [V, I, dQ, dE, temp]. 형식만 검사하고, 값의 크기로 판정을 막지는 않아요(입력 허용 범위가 배포 설정에 없어요). */
function parse(text){
  text=String(text).replace(/^﻿/,'');const L=text.trim().split(/\r?\n/).filter(x=>x.trim());
  if(L.length<2)throw new Error('데이터가 비어 있어요.');
  const h=L[0].split(',').map(s=>s.trim().replace(/^"|"$/g,''));
  if(h.includes('Zustand'))throw new Error('RWTH 원시 형식(TBA_Zyk)은 아직 지원하지 않아요. '+['time_s',...CH].join(', ')+' 열로 바꿔 주세요.');
  const need=['time_s',...CH],miss=need.filter(c=>!h.includes(c)),dup=need.filter(c=>h.indexOf(c)!==h.lastIndexOf(c));
  if(miss.length)throw new Error('필요한 열이 없어요: '+miss.join(', '));
  if(dup.length)throw new Error('같은 이름의 열이 두 번 있어요: '+dup.join(', '));
  const ix=need.map(c=>h.indexOf(c)),rows=[];
  for(let i=1;i<L.length;i++){const p=L[i].split(',');
    if(p.length!==h.length)throw new Error(`${i+1}번째 줄의 열 개수(${p.length})가 첫 줄(${h.length})과 달라요.`);
    const v=ix.map(k=>p[k]===undefined||p[k].trim()===''?NaN:Number(p[k]));
    if(v.some(x=>!Number.isFinite(x)))throw new Error(`${i+1}번째 줄에 비어 있거나 숫자가 아닌 값이 있어요.`);
    if(Math.abs(v[0]-(i-1)*DT)>1e-5)throw new Error(`time_s는 0, 10, 20, …초여야 해요. ${i+1}번째 줄이 ${v[0]}초예요. (원시 기록의 보간은 아직 지원하지 않아요)`);
    rows.push(v);}
  if(rows.length<7)throw new Error(`첫 단계(1분)를 보려면 7행(0–60초)이 필요해요. 지금 ${rows.length}행이에요.`);
  const q0=rows[0][3],e0=rows[0][4];                              // 기준점: 충전 시작 dQ=dE=0 (학습 입력이 시작점 기준 변화량이라서)
  const c={t:[],V:[],I:[],dQ:[],dE:[],temp:[]};
  for(const r of rows){c.t.push(r[0]);c.V.push(r[1]);c.I.push(r[2]);c.dQ.push(r[3]-q0);c.dE.push(r[4]-e0);c.temp.push(r[5]);}
  c.zeroed=Math.abs(q0)>1e-6||Math.abs(e0)>1e-6;
  return c;}

/* 특징: 앞 n행을 시간 순서대로 [V, I, dQ, dE, temp, V, I, …]로 펼쳐요 (time-major) */
function features(c,n){const f=[];for(let i=0;i<n;i++)f.push(c.V[i],c.I[i],c.dQ[i],c.dE[i],c.temp[i]);return f;}
function predictStage(M,stage,c){const m=M[stage],n=stage*60/DT+1,f=features(c,n);
  if(f.length!==m.coef.length)throw new Error(`${stage}분 모델 특징 길이가 맞지 않아요.`);
  let p=m.intercept;for(let i=0;i<f.length;i++)p+=m.coef[i]*(f[i]-m.mean[i])/m.scale[i];
  return p;}

const gradeOf=s=>s>=70?'A':(s>=60?'B':'C');

/* 단계 판정: [예측 − λ·q(t), 예측 + λ·q(t)]가 한 등급 안이면 확정, 아니면 다음 단계.
   30분에도 못 정하면 정밀검사, 기록이 다음 단계보다 짧으면 측정 연장(기록을 더 받아야 해요). */
function judge(c,M,cfg,alpha){
  const lam=cfg.lambda[alpha.toFixed(2)];if(lam==null)throw new Error('RWTH에서 지원하지 않는 α예요.');
  const steps=[];let done=null,next=null;
  for(const st of cfg.stages){
    const n=st*60/DT+1;
    if(done){steps.push({stage:st,reached:false});continue;}
    if(c.V.length<n){steps.push({stage:st,reached:false,missing:true,rows:n});if(!next)next={stage:st,rows:n};continue;}
    const p=predictStage(M,st,c),q=cfg.q[st],need=lam*q,lo=p-need,hi=p+need,g=gradeOf(p);
    const nb=Math.abs(p-60)<Math.abs(p-70)?60:70,ok=gradeOf(lo)===g&&gradeOf(hi)===g;
    const s={stage:st,soh:p,q,need,lo,hi,nb,near:Math.abs(p-nb),ok,grade:g,reached:true};
    steps.push(s);if(ok)done=s;}
  const out={alpha,lambda:lam,steps},last=steps.filter(s=>s.reached).pop();
  Object.assign(out,{soh:last.soh,q:last.q,need:last.need,lo:last.lo,hi:last.hi,grade:last.grade,near:last.near,nb:last.nb});
  if(done)Object.assign(out,{decision:'auto',stage:done.stage,minutes:done.stage});
  else if(next)Object.assign(out,{decision:'extend',stage:null,minutes:null,measured:last.stage,next:next.stage,nextRows:next.rows});
  else Object.assign(out,{decision:'precise',stage:null,minutes:cfg.unresolvedMin});
  return out;}

const API={parse,features,predictStage,judge,gradeOf,DT,CH};
if(typeof module!=='undefined'&&module.exports)module.exports=API;else root.RWTH=API;
})(typeof window!=='undefined'?window:globalThis);
