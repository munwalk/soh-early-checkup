/* app.js (frontend_replay) — frontend_final + 실시간 재생 모드 버튼(replay.js). 판정 계산은 frontend_final과 같아요.
   frontend_final — frontend_v7 + 경계거리별 관측 오판율(misgrade_data.js) + 성능 수치를 "웹 배포 모델(이 화면의 판정)"과 "연구 실험 결과(보고서, 500회 반복)"로 나눠 표시.
   모델 계산·판정 규칙은 v7과 같아요(RWTH 그대로, SDU 실시간 dV/dt LGBM·q(t)·λ·α 8–12%).
   frontend_v7 — frontend_v6_SDU_실시간모델적용 + 판정서 오류 수정, 예시의 실제 측정 SOH 복원.
   v6_SDU_실시간모델적용: SDU를 미래 데이터 참조 없는 dV/dt 모델(새 q(t)·λ, α 8–12%)로 교체.
   frontend_v6 — frontend_v5 + 보고서 2.5·2.6 맞춤: 단계별 판정 그래프(판정 구간이 좁아지며 확정되는 과정), 판정서 인쇄,
   등급선 2%p 안쪽 확정은 "경계 근처"로 표시, α 옆에 정밀검사 비율, 자세히 보기 맨 위 한 줄 요약.
   v5: 단계 순서 애니메이션(카드·자세히 보기에서 측정 단계가 시간 순서대로 켜져요).
   아래는 v4 설명이에요.
   frontend_v4 — frontend_v3 + 설계 문서 맞춤.
   v3와 다른 점: 예측 SOH가 검증 범위 밖이면 자동 확정 대신 정밀검사, SDU 정밀검사 365분(실제 완전 충·방전 시간),
   결과 위에 전수 완전 충·방전 대비 절감 시간, RWTH 설명을 "경계거리 > 안전거리"로 통일.
   RWTH는 rwth_engine.js + rwth_model.js(rwth_ridge_web 배포 설정: 단계별 Ridge, q(t), α별 λ), SDU는 sdu_engine.js + sdu_model.js(처음 고를 때 불러옴)를 따로 써요.
   모든 처리는 브라우저 안에서만 해요. */
const gradeOf=s=>s>=70?'A':(s>=60?'B':'C');

/* 예측 SOH가 검증 범위 밖인데 자동 확정이 나오면, 확정하지 않고 그 단계에서 멈춰 정밀검사로 보내요(설계 문서 2.6절).
   입력값의 크기로 막는 게 아니라 검증한 예측 범위만 봐요. 확정 전(연장·정밀검사)이면 주의 문구만 붙여요. */
function outOfRange(res,lo,hi,cfg,say){
  if(!(res.soh<lo||res.soh>hi))return res;
  if(res.decision==='auto')return Object.assign(res,{decision:'precise',oor:true,oorStage:res.stage,stage:null,minutes:res.stage+cfg.fullTestMin});
  res.warning=say;return res;}

/* ===== RWTH (rwth_engine.js) — 1·2·5·10·30분 단계 판정. 기록이 짧으면 있는 단계까지만 봐요 ===== */
function predictRWTH(c){const r=RWTH.judge(c,RWTH_MODELS,RWTH_CFG,S.alpha);
  const res=Object.assign({status:'ok',ds:'rwth'},r);
  const [lo,hi]=RWTH_CFG.evalRange;
  return outOfRange(res,lo,hi,RWTH_CFG,`예측 SOH가 검증 범위(${lo}–${hi}%) 밖이에요. 이 범위 밖은 판정 신뢰도를 주장할 수 없어요.`);}

/* ===== SDU (sdu_engine.js) — 60분 전체 CSV를 받아 5·10·30·60분 단계 판정을 재현해요 ===== */
function predictSDU(c){const r=SDU.judge(c,SDU_MODELS,SDU_CFG,S.alpha);
  const res=Object.assign({status:'ok',ds:'sdu'},r);
  const [lo,hi]=SDU_CFG.socRange;
  return outOfRange(res,lo,hi,SDU_CFG,`예측 SOH가 평가 데이터 범위(${lo}–${hi}%) 밖이에요. 이 범위 밖은 검증되지 않았어요.`);}
const OOR=e=>{const [lo,hi]=e.ds==='sdu'?SDU_CFG.socRange:RWTH_CFG.evalRange;return`${lo}–${hi}%`;};
let sduLoading=null;
function loadSDU(){if(typeof SDU_MODELS!=='undefined')return Promise.resolve();
  return sduLoading||(sduLoading=new Promise((ok,no)=>{const s=document.createElement('script');s.src='sdu_model.js?v=causal20261029';
    s.onload=ok;s.onerror=()=>{sduLoading=null;no(new Error('SDU 모델 파일(sdu_model.js)을 불러오지 못했어요.'));};document.head.appendChild(s);}));}


/* ===== 화면 ===== */
const SAY={A:'다시 써도 괜찮아요',B:'가벼운 용도로 쓸 수 있어요',C:'재활용으로 보내 주세요'};
const ORDER={R:0,E:1,A:2,B:3,C:4,X:5};
const S={ds:'rwth',store:{rwth:[],sdu:[]},rows:[],filter:'all',sel:null,seen:new Set(),alpha:RWTH_CFG.defaultAlpha,alphaBy:{rwth:RWTH_CFG.defaultAlpha,sdu:0.10}};
const DC=()=>S.ds==='sdu'?SDU_CFG:RWTH_CFG;   // 지금 고른 데이터셋의 설정
const $=s=>document.querySelector(s),f1=x=>x.toFixed(1),pct=(x,d=1)=>(x*100).toFixed(d)+'%';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=n=>`<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const P=v=>Math.max(0,Math.min(100,(v-50)/30*100));   // 성능 50–80% → 막대 0–100%
const BAND=e=>e.ds==='sdu'?'오차 범위 ±q':'판정 구간 ±λq';  // SDU의 ±q(t)는 실측 포함률이 90%에 못 미쳐서 '90%'라고 부르지 않아요. RWTH는 확정에 쓰는 구간을 그대로 보여요
let uid=0;

/* 다른 데이터셋 파일을 올렸을 때 알려 주기 */
function hint(text){const h=String(text).replace(/^﻿/,'').split(/\r?\n/,1)[0];
  if(S.ds==='rwth'&&/charge_Ah_from_10s|dvdt/i.test(h))return' SDU 기록 같아요. 위에서 SDU를 골라 주세요.';
  if(S.ds==='sdu'&&/energy_Wh/.test(h))return' RWTH 기록 같아요. 위에서 RWTH를 골라 주세요.';
  return'';}
function addCsv(name,text,truth){const old=S.rows.find(r=>r.name===name),row={id:old?old.id:++uid,name,truth:truth??null,ds:S.ds};
  try{row.curve=(S.ds==='sdu'?SDU:RWTH).parse(text);}
  catch(e){row.error=e.message+hint(text);}
  if(old)S.rows[S.rows.indexOf(old)]=row;else S.rows.push(row);
  S.seen.delete(row.id);return row;}
function evalRow(r){if(r.error)return{status:'error',msg:r.error};return r.ds==='sdu'?predictSDU(r.curve):predictRWTH(r.curve);}
function view(e){
  if(e.status==='ok'){const C=e.ds==='sdu'?SDU_CFG:RWTH_CFG,last=C.stages[C.stages.length-1];
    if(e.oor)return{k:'R',tag:'정밀검사',say:'정밀검사가 필요해요',note:`${e.oorStage}분 예측 ${f1(e.soh)}%가 검증 범위(${OOR(e)}) 밖이라 자동 확정하지 않아요. 용량시험(+${C.fullTestMin}분)으로 정해요.`};
    if(e.decision==='precise')return{k:'R',tag:'정밀검사',say:'정밀검사가 필요해요',note:`${last}분까지 재도 등급선에 가까워요. 용량시험(+${C.fullTestMin}분)으로 정해요.`};
    if(e.decision==='extend')return{k:'E',tag:'측정 연장',say:'조금 더 재 볼게요',note:`${e.measured}분까지는 등급선에 가까워요. ${e.next}분 기록(${e.nextRows}행)을 올려 주세요.`};
    return{k:e.grade,tag:e.grade+'등급',say:SAY[e.grade],note:`${e.stage}분 단계에서 확정`};}
  return{k:'X',tag:'파일 오류',say:'파일을 읽지 못했어요',note:e.msg};}

/* 배터리 모양: 남은 성능만큼 차오름 */
function cell(e,anim){
  if(e.status!=='ok')return'<span class="cell empty" aria-hidden="true"></span>';
  const c=P;   // 50–80% 구간을 확대해서 오차 범위가 잘 보이게
  return`<span class="cell-wrap${anim?' anim':''}" style="--lo:${c(e.lo)}%;--w:${c(e.hi)-c(e.lo)}%;--x:${c(e.soh)}%" role="img" aria-label="남은 성능 ${f1(e.soh)}%, ${BAND(e)} ${f1(e.lo)}–${f1(e.hi)}%">
    <span class="cell"><span class="cell-in"><span class="cell-fill"></span><span class="cell-band"></span><span class="cell-x"></span><i class="cell-t" style="left:33.333%"></i><i class="cell-t" style="left:66.667%"></i></span></span>
    <span class="cell-scale"><span style="left:0">50%</span><span style="left:33.333%">60%</span><span style="left:66.667%">70%</span><span style="left:100%">80%+</span></span></span>`;}

/* 자세히 보기의 막대: C(50–60) · B(60–70) · A(70–80) 위에 오차 범위와 예측값 */
function gauge(e,k){
  const lo=P(e.lo),hi=P(e.hi);
  return`<span class="gauge anim" style="--x:${P(e.soh)}%;--lo:${lo}%;--w:${Math.max(1.5,hi-lo)}%;--c:var(--${k})" role="img" aria-label="예측 성능 ${f1(e.soh)}%, ${BAND(e)} ${f1(e.lo)}–${f1(e.hi)}%">
    <span class="g-track"><i class="g-seg" style="left:0"></i><i class="g-seg" style="left:33.333%"></i><i class="g-seg" style="left:66.667%"></i><i class="g-band"></i><i class="g-dot"></i></span>
    <span class="g-scale"><span style="left:0">50%</span><b class="g-gl" style="left:16.667%;color:var(--C-ink)">C</b><span style="left:33.333%">60%</span><b class="g-gl" style="left:50%;color:var(--B-ink)">B</b><span style="left:66.667%">70%</span><b class="g-gl" style="left:83.333%;color:var(--A-ink)">A</b><span style="left:100%">80%+</span></span></span>`;}

/* 선 그래프. dt=점 간격(초), t0=첫 점 시각(초), ticks=눈금(분), marks=세로 점선(분) */
let gid=0;
function chart(arr,{min,max,color,label,unit,dp,dt=10,t0=0,ticks=[0,2,4,6,8,10],marks=[]}){const W=480,H=170,L=34,R=8,T=30,B=22,id='cg'+(++gid);
  const span=dt*(arr.length-1)+t0,X=s=>L+(W-L-R)*s/span,Xi=i=>X(t0+i*dt),Y=v=>T+(max-Math.max(min,Math.min(max,v)))*(H-T-B)/(max-min);
  const pts=arr.map((v,i)=>Xi(i).toFixed(1)+','+Y(v).toFixed(1)).join(' '),end=Math.round(span/60);
  let o=`<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${label} 그래프"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".18"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <text x="0" y="13" class="c-t">${label}</text><text x="${W}" y="13" text-anchor="end" class="c-v" fill="${color}">${end}분 ${arr[arr.length-1].toFixed(dp)} ${unit}</text>`;
  [min,(min+max)/2,max].forEach(v=>o+=`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" class="c-g"/><text x="${L-6}" y="${Y(v)+3.5}" text-anchor="end" class="c-a">${+v.toFixed(2)}</text>`);
  marks.forEach(m=>o+=`<line x1="${X(m*60)}" x2="${X(m*60)}" y1="${T-6}" y2="${H-B}" class="c-m"/>`);
  o+=`<polygon points="${Xi(0)},${Y(min)} ${pts} ${Xi(arr.length-1)},${Y(min)}" fill="url(#${id})"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  ticks.forEach(m=>o+=`<text x="${X(m*60)}" y="${H-4}" text-anchor="${m?'middle':'start'}" class="c-a">${m}분</text>`);
  return o+'</svg>';}
const nice=(a,pad)=>{let mn=Math.min(...a),mx=Math.max(...a);const p=(mx-mn)*pad||Math.abs(mx)*.01||1;return[mn-p,mx+p];};

/* ===== v6 ===== */
const USE={A:'ESS 등 재사용',B:'저부하 용도 재사용',C:'재활용·금속 회수'};   // 보고서 1.4절 처리 방향
/* 등급선에서 2%p 안쪽으로 확정되면 "경계 근처". 보고서 그림 2-9에서 오판이 몰린 구간이에요(RWTH는 2%p 초과에서 오판 0%).
   안전거리 배수로 정하지 않은 건, RWTH는 α 6% 이상에서 λ=0이라 안전거리가 0이 되기 때문이에요. */
const NEAR=2;
const isNear=e=>e.status==='ok'&&e.decision==='auto'&&e.near<=NEAR;
const atStep=e=>{const got=e.steps.filter(s=>s.reached),at=e.decision==='auto'?e.stage:(e.oor?e.oorStage:got[got.length-1].stage);return e.steps.find(s=>s.stage===at);};
/* 보고서 2.5절 결과 표시 예시처럼 한 줄로: 등급(처리 방향) · 예측 SOH(오차 범위 ±q) · 경계거리 vs 안전거리 · 처리 */
function sumLine(e){const C=e.ds==='sdu'?SDU_CFG:RWTH_CFG,s=atStep(e);
  const pr=`${s.stage}분 예측 SOH ${f1(s.soh)}% (오차 범위 ${f1(s.soh-s.q)}–${f1(s.soh+s.q)}%)`,dist=`경계거리 ${s.near.toFixed(2)}%p ${s.ok?'>':'≤'} 안전거리 ${s.need.toFixed(2)}%p`;
  if(e.decision==='auto'){const m=mgShort(misgradeOf(e));return`${e.grade}등급(${USE[e.grade]}) · ${pr} · ${dist} · ${e.stage}분에 확정${m?' · '+m:''}`;}
  if(e.oor)return`정밀검사 · ${pr} · 검증 범위(${OOR(e)}) 밖 · 용량시험 +${C.fullTestMin}분`;
  if(e.decision==='extend')return`측정 연장 · ${pr} · ${dist} · ${e.next}분 기록 필요`;
  return`정밀검사 · ${pr} · ${dist} · 용량시험 +${C.fullTestMin}분`;}

/* 경계거리별 관측 오판율 (misgrade_data.js). 셀 단위 5겹 교차검증 예측에 웹의 q(t)·λ를 그대로 적용해,
   확정 시점 경계거리 구간별로 센 값이에요. 개별 배터리의 오판 확률이 아니라 같은 구간에서 확정된 배터리 집단의 비율이에요.
   웹 배포 모델과는 다른(교차검증) 모델로 센 값이라 따로 표시해요. 사례가 셀 5개·20건 미만이면 "사례 부족"으로 보여 줘요. */
const MG_BINS=[[1,'≤1','1%p 이하'],[2,'1–2','1–2%p'],[4,'2–4','2–4%p'],[6,'4–6','4–6%p'],[Infinity,'>6','6%p 초과']];
function misgradeOf(e){if(typeof MISGRADE==='undefined'||e.status!=='ok'||e.decision!=='auto')return null;
  const A=MISGRADE[e.ds]?.byAlpha?.[e.alpha.toFixed(2)];if(!A)return null;
  const s=atStep(e),k=MG_BINS.find(([hi])=>s.near<=hi),b=A.bins.find(x=>x.bin===k[1]);
  return b?Object.assign({label:k[2]},b):null;}
const nf=x=>x.toLocaleString();
const mgPct=(k,n)=>!n?'–':(k?(k/n*100).toFixed(k/n<.01?2:1)+'%':'0%');
/* 한 줄 요약·판정서용 짧은 문구 */
function mgShort(m){if(!m)return'';
  return m.enough?`같은 경계거리(${m.label})에서 관측된 오판율 상향 ${mgPct(m.up,m.n)} · 하향 ${mgPct(m.down,m.n)} (${nf(m.n)}건)`
    :`같은 경계거리(${m.label})에서 관측된 오판율은 사례 부족(${nf(m.n)}건 · ${m.cells}셀)`;}
/* 자세히 보기 상자 */
function mgBox(e){const m=misgradeOf(e);if(!m)return'';
  const body=m.enough?`<div class="mg"><div><span>실제보다 높게 (상향 오판)</span><b>${mgPct(m.up,m.n)}</b><em>${nf(m.up)} / ${nf(m.n)}건</em></div><div><span>실제보다 낮게 (부당 하향)</span><b>${mgPct(m.down,m.n)}</b><em>${nf(m.down)} / ${nf(m.n)}건</em></div></div>`
    :`<p class="mg-few">${icon('alert')}사례 부족이에요. 이 구간에서 확정된 배터리가 ${nf(m.n)}건(${m.cells}셀)뿐이라 비율을 보여 주지 않아요. 참고로 그중 ${m.up+m.down}건이 실제 등급과 달랐어요(상향 ${m.up} · 하향 ${m.down}). (표시 기준: 5셀 이상, 20건 이상)</p>`;
  return box('같은 경계거리에서 관측된 오판율',`<p class="small" style="margin:0 0 var(--s4)">이 배터리는 등급선에서 ${atStep(e).near.toFixed(2)}%p 떨어진 곳에서 확정됐어요. 같은 α(${Math.round(e.alpha*100)}%)·같은 경계거리 구간(${m.label})에서 확정된 배터리 ${nf(m.n)}건(${m.cells}셀) 중 실제 등급과 달랐던 비율이에요.</p>${body}
    <p class="small">셀 단위 5겹 교차검증 예측에 이 화면과 같은 q(t)·λ를 적용해 센 값이에요(${e.ds==='sdu'?'SDU 86셀':'RWTH 48셀'}). 이 배터리 하나의 오판 확률이 아니고, 웹 배포 모델과 같은 모델로 센 값도 아니에요.${m.enough&&!m.up&&!m.down?' 0건이어도 오판이 없다는 보장은 아니에요.':''}</p>`);}

/* 단계별 판정 그래프: 가로 = 측정 단계, 세로 = SOH. 단계마다 예측 SOH(점), 판정 구간 ±λ·q(t)(진한 막대), 오차 범위 ±q(t)(연한 막대).
   판정 구간이 등급선(60·70%)에 닿지 않으면 그 단계에서 확정해요. 실제로 재지 않은 단계는 그리지 않아요. */
function stageChart(e){const C=e.ds==='sdu'?SDU_CFG:RWTH_CFG,got=e.steps.filter(s=>s.reached),n=C.stages.length;
  const W=480,H=244,L=38,R=34,T=22,B=30,X=i=>L+(W-L-R)*(i+.5)/n;
  const lo=Math.min(58,...got.map(s=>s.soh-Math.max(s.q,s.need))),hi=Math.max(72,...got.map(s=>s.soh+Math.max(s.q,s.need)));
  const mn=Math.floor((lo-1)/5)*5,mx=Math.ceil((hi+1)/5)*5;
  const Y=v=>T+(mx-Math.max(mn,Math.min(mx,v)))*(H-T-B)/(mx-mn);
  const done=e.decision==='auto'?e.stage:(e.oor?e.oorStage:null),fin=e.decision==='precise'&&!e.oor?got[got.length-1].stage:null;
  let o=`<svg viewBox="0 0 ${W} ${H}" class="chart sc-chart" role="img" aria-label="단계별 판정 그래프. ${esc(sumLine(e))}">`;
  /* 등급 구간: 아주 옅은 배경 + 오른쪽 여백에 등급 글자 */
  [[70,1e3,'A'],[60,70,'B'],[-1e3,60,'C']].forEach(([a,b,k])=>{const y1=Y(Math.min(b,mx)),y2=Y(Math.max(a,mn));if(y2-y1<2)return;
    o+=`<rect x="${L}" y="${y1}" width="${W-L-R}" height="${y2-y1}" class="z z-${k}"/>`;
    if(y2-y1>14)o+=`<text x="${W-R+10}" y="${(y1+y2)/2+4}" class="z-l" style="fill:var(--${k}-ink)">${k}</text>`;});
  for(let v=mn;v<=mx;v+=5){const bd=v===60||v===70;
    o+=`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" class="${bd?'sc-bd':'sc-gl'}"/><text x="${L-8}" y="${Y(v)+4}" text-anchor="end" class="c-a${bd?' sc-bdl':''}">${v}</text>`;}
  /* 단계 사이를 잇는 선 */
  if(got.length>1)o+=`<polyline points="${got.map(s=>X(C.stages.indexOf(s.stage))+','+Y(s.soh)).join(' ')}" class="sc-path"/>`;
  let j=0;
  e.steps.forEach((s,i)=>{const x=X(i);
    o+=`<text x="${x}" y="${H-8}" text-anchor="middle" class="sc-x${s.reached?'':' sc-off'}">${s.stage}분</text>`;
    if(!s.reached){o+=`<text x="${x}" y="${(T+H-B)/2+4}" text-anchor="middle" class="sc-x sc-off">${s.missing?'기록 없음':'–'}</text>`;return;}
    const tag=s.stage===done?(e.oor?['범위 밖','R']:['확정',s.grade]):(s.stage===fin?['정밀검사','R']:null);
    const col=s.stage===done&&!e.oor?`var(--${s.grade})`:'var(--sub)',y=Y(s.soh),yq=Y(s.soh+s.q),yq2=Y(s.soh-s.q),yn=Y(s.soh+s.need),yn2=Y(s.soh-s.need);
    o+=`<g class="sc-st" style="--i:${j++}"><rect x="${x-11}" y="${yq}" width="22" height="${Math.max(2,yq2-yq)}" rx="11" class="sc-q"/>`;
    if(s.need>0)o+=`<g style="stroke:${col}" class="sc-n"><line x1="${x}" x2="${x}" y1="${yn}" y2="${yn2}"/><line x1="${x-7}" x2="${x+7}" y1="${yn}" y2="${yn}"/><line x1="${x-7}" x2="${x+7}" y1="${yn2}" y2="${yn2}"/></g>`;
    o+=`<circle cx="${x}" cy="${y}" r="5.5" class="sc-p" style="fill:${col}"/><text x="${x+16}" y="${y+4}" class="sc-v">${f1(s.soh)}</text>`;
    if(tag){const ty=Math.max(T-6,Math.min(yq,yn)-10);o+=`<text x="${x}" y="${ty}" text-anchor="middle" class="sc-tag" style="fill:var(--${tag[1]}-ink)">${tag[0]}</text>`;}
    o+='</g>';});
  o+='</svg>';
  return o+`<p class="sc-leg"><span><i class="lg-p"></i>예측 SOH</span><span><i class="lg-n"></i>판정 구간 ±λ·q(t)</span><span><i class="lg-q"></i>오차 범위 ±q(t)</span></p>
    <p class="small">판정 구간이 등급선(60·70%)에 닿지 않으면 그 단계에서 확정해요. 측정이 길어지면 대체로 q(t)가 줄어 구간이 좁아져요.${e.lambda===0?' 지금 α에서는 λ=0이라 판정 구간 폭이 0이에요. 예측값이 등급선 위에만 있지 않으면 바로 확정해요.':''}</p>`;}

/* 판정서: 배터리 하나의 결과를 A4 한 장으로. 브라우저 인쇄 창에서 PDF로 저장할 수 있어요 */
function sheetHTML(r,e,v){const C=e.ds==='sdu'?SDU_CFG:RWTH_CFG,sdu=e.ds==='sdu',now=new Date(),z=x=>String(x).padStart(2,'0');
  const when=`${now.getFullYear()}-${z(now.getMonth()+1)}-${z(now.getDate())} ${z(now.getHours())}:${z(now.getMinutes())}`;
  const res=e.decision==='auto'?`${e.grade}등급 · ${USE[e.grade]}`:v.tag;
  const time=e.minutes!=null?`${e.minutes}분 (모두 완전 충·방전하면 ${C.fullTestMin}분)`:'측정 중';
  const cov=sdu?(C.coverage?Object.values(C.coverage):null):C.stageMetrics.map(s=>s.coverage);   // SDU 포함률은 11-11 독립 18셀 1,729건으로 계산
  const rows=e.steps.filter(s=>s.reached||s.missing).map(s=>s.reached?`<tr><td>${s.stage}분</td><td>${f1(s.soh)}%</td><td>${f1(s.soh-s.q)}–${f1(s.soh+s.q)}%</td><td>${s.near.toFixed(2)}%p</td><td>${s.need.toFixed(2)}%p</td><td>${s.ok?(e.oor&&s.stage===e.oorStage?'범위 밖 → 정밀검사':'확정'):'다음 단계'}</td></tr>`
    :`<tr><td>${s.stage}분</td><td colspan="4">기록 없음 (${s.rows}행 필요)</td><td>측정 연장</td></tr>`).join('')
    +(e.decision==='precise'?`<tr><td>+${C.fullTestMin}분</td><td colspan="4">용량시험(완전 충·방전)</td><td>정밀검사</td></tr>`:'');
  return`<article class="ps">
    <header class="ps-h"><h1>배터리 재사용 등급 판정서</h1><p>판정 일시 ${when} · 연구용 시연 결과이며 법정 인증 등급이 아니에요</p></header>
    <table class="ps-t"><tbody>
      <tr><th>파일</th><td>${esc(r.name)}</td></tr>
      <tr><th>데이터 · 모델</th><td>${sdu?'SDU 공개 데이터 · 단계별 LightGBM(시드 5개 평균) · 5·10·30·60분':'RWTH 공개 데이터 · 단계별 Ridge · 1·2·5·10·30분'}</td></tr>
      <tr><th>판정 기준</th><td>허용 오판 한도 α ${Math.round(e.alpha*100)}% · λ ${e.lambda} · 등급 경계 60·70% · 안전거리 = λ × q(t)</td></tr>
      <tr><th>판정 결과</th><td><b>${res}</b>${isNear(e)?' (등급선 2%p 안쪽에서 확정, 경계 근처)':''}</td></tr>
      <tr><th>요약</th><td>${esc(sumLine(e))}</td></tr>
      ${misgradeOf(e)?`<tr><th>관측 오판율</th><td>${esc(mgShort(misgradeOf(e)))}<br><small>셀 단위 5겹 교차검증 예측에 같은 q(t)·λ를 적용해 센 집단 비율이에요. 이 배터리 하나의 오판 확률이 아니에요.</small></td></tr>`:''}
      <tr><th>검사 시간</th><td>${time}</td></tr>
      ${r.truth!=null?`<tr><th>실제 측정값(예시)</th><td>${f1(r.truth)}% · ${gradeOf(r.truth)}등급</td></tr>`:''}
    </tbody></table>
    <h2>단계별 판정</h2>
    <table class="ps-t ps-s"><thead><tr><th>단계</th><th>예측 SOH</th><th>오차 범위</th><th>등급선 거리</th><th>안전거리</th><th>결과</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="ps-c">${stageChart(e)}</div>
    <h2>읽을 때 주의</h2>
    <ul>
      <li>α는 판정 묶음 전체의 허용 위험 목표예요. 이 배터리 하나의 오판 확률이 아니에요.</li>
      <li>오차 범위 ±q(t)는 90%를 목표로 정했지만, ${cov?`독립 평가에서 실제값을 담은 비율은 ${pct(Math.min(...cov),0)}–${pct(Math.max(...cov),0)}였어요`:'이 모델에서 실제값을 담은 비율은 아직 계산하지 않았어요. 90% 보장 범위로 읽으면 안 돼요'}.</li>
      <li>실험실에서 열화시킨 셀 데이터로 만든 판정 기준이에요. 실제 회수 배터리 팩에서는 검증하지 않았어요.</li>
      <li>학습 데이터와 같은 조건(정해진 방전 뒤 충전 시작)의 기록에만 적용해요. 시작 상태가 다르면 판정을 믿을 수 없어요.</li>
    </ul></article>`;}
function printSheet(id){const r=S.rows.find(x=>x.id===id);if(!r)return;const e=evalRow(r);if(e.status!=='ok')return;
  let p=$('#printArea');if(!p){p=document.createElement('div');p.id='printArea';document.body.appendChild(p);}
  p.innerHTML=sheetHTML(r,e,view(e));window.print();}

/* ----- 첫 화면 ----- */
function renderTrust(){
  if(S.ds==='sdu'){
    $('#trust').innerHTML=`<b>${icon('check')}</b>웹 배포 모델 · SDU 실시간 dV/dt LightGBM · 독립 18셀 평가`; 
    $('#trust').title=SDU_CFG.trust;return;}
  const C=RWTH_CFG,m=C.stageMetrics[0];
  $('#trust').innerHTML=`<b>${icon('check')}</b>웹 배포 모델 · RWTH 단계별 Ridge · 미학습 ${C.cells.test}셀 ${m.stage}분 RMSE ${m.rmse.toFixed(2)}%p`;
  $('#trust').title=RWTH_WARN;
}
const RWTH_WARN='학습에 안 쓴 셀로 한 테스트는 유한한 표본의 근거예요. 배터리 안전을 공식으로 보장하지 않아요. 48셀 전체로 다시 학습한 모델은 검증 범위 밖이에요.';
const AT=a=>DC().alphaTable.find(x=>Math.abs(x.alpha-a)<1e-9);
function renderAlpha(){const C=DC(),t=AT(S.alpha).test,lam=C.lambda[S.alpha.toFixed(2)];
  $('#alpha').innerHTML=`<div class="alpha-row"><span class="alpha-l" id="alphaL">허용 위험 α</span>
    <div class="seg" role="radiogroup" aria-labelledby="alphaL">${C.alphas.map(a=>`<button type="button" role="radio" aria-checked="${a===S.alpha}" data-alpha="${a}">${Math.round(a*100)}%</button>`).join('')}</div></div>
    <p class="alpha-s">웹 배포 모델 독립 평가: 오판 ${pct(t.misgrade,2)} · 정밀검사 ${pct(t.precise,1)} · 평균 ${Math.round(t.minutes)}분${S.ds==='rwth'&&lam===0?` <span class="alpha-tag" title="λ=0: 오차 여유 없이 예측값만으로 대부분 1분에 확정해요">안전거리 없음</span>`:''}</p>
    <p class="alpha-n">α는 연구용 목표값이에요. 실제 오판률을 보장하지 않아요.</p>`;}
function renderInfo(){if(S.ds==='sdu')renderSduInfo();else renderRwthInfo();renderPerf();}
function renderRwthInfo(){if(!$('#rwthStats'))return;   // v4: RWTH 검증 결과 표는 화면에서 뺐어요
  const C=RWTH_CFG,t0=C.alphaTable[0].test,[lo,hi]=C.evalRange,cov=C.stageMetrics.map(s=>s.coverage);
  $('#rwthStats').innerHTML=`<h3 class="st-h">RWTH 검증 결과</h3>
    <div class="st-grid">
      <div class="st-card"><h4>α별 결과 (독립 테스트 ${t0.cells}셀 · ${lo}–${hi}% 샘플 ${t0.samples}개)</h4>
        <table class="checks"><thead><tr><th>α</th><th>λ</th><th>오판</th><th>정밀검사</th><th>평균 시간</th></tr></thead><tbody>
        ${C.alphaTable.map(a=>`<tr${a.alpha===S.alpha?' class="on"':''}><td>${Math.round(a.alpha*100)}%</td><td>${a.lambda}</td><td>${pct(a.test.misgrade,1)}</td><td>${pct(a.test.precise)}</td><td>${f1(a.test.minutes)}분</td></tr>`).join('')}</tbody></table>
        <p class="small">α는 허용 위험 목표예요. 배터리 하나하나의 안전을 보장하지 않아요. α 6% 이상은 보정 셀에서 λ=0이 골라져서, 오차 여유 없이 예측값만으로 1분에 확정해요. 테스트 ${t0.samples}개에서는 틀린 판정이 없었지만 표본이 작아요. 정밀검사로 가면 ${C.stages[C.stages.length-1]}분 + ${C.fullTestMin}분 = ${C.unresolvedMin}분이에요.</p></div>
      <div class="st-card"><h4>단계별 예측 오차 (독립 테스트 ${C.stageMetrics[0].n}개)</h4>
        <table class="checks"><thead><tr><th>단계</th><th>q(t)</th><th>RMSE</th><th>MAE</th><th>±q 포함률</th></tr></thead><tbody>
        ${C.stageMetrics.map(s=>`<tr><td>${s.stage}분</td><td>±${C.q[s.stage].toFixed(2)}</td><td>${s.rmse.toFixed(2)}</td><td>${s.mae.toFixed(2)}</td><td>${pct(s.coverage)}</td></tr>`).join('')}</tbody></table>
        <p class="small">q(t)는 90%를 목표로 shape 셀에서 구한 오차 폭이에요. 독립 테스트에서 ±q(t)가 실제값을 담은 비율은 ${pct(Math.min(...cov),0)}–${pct(Math.max(...cov),0)}였어요. 그래서 "90% 범위"라고 부르지 않아요.</p></div>
    </div>
    <div class="st-warn">${icon('alert')}<p><b>셀 분할 학습 ${C.cells.train} · shape ${C.cells.shape} · 보정 ${C.cells.calibration} · 테스트 ${C.cells.test}.</b> ${RWTH_WARN} 예측 SOH가 ${lo}–${hi}% 밖이면 판정 신뢰도를 주장할 수 없어요.</p></div>`;}
function renderSduInfo(){
  $('#sduSupported').innerHTML=SDU_CFG.supported.map(s=>`<li>${esc(s)}</li>`).join('');
  // v7의 SDU 검증 표는 성능 수치 영역(renderPerf)으로 옮겼어요
}

/* ----- 성능 수치: 웹 배포 모델과 연구 실험 결과를 따로 보여 줘요 -----
   웹 배포 모델 = 이 화면이 실제로 쓰는 판정 묶음. 배터리를 한 번 나눠 만들고, 학습·보정에 안 쓴 셀로 평가했어요.
   연구 실험 = 최종보고서 수치. 배터리를 500번 다시 나눠 매번 λ를 새로 고른 평균이에요(α 10%). 두 수치는 만든 방법이 달라 직접 비교하지 않아요. */
const RESEARCH={
  rwth:{model:'Ridge',rows:[['평균 검사시간','1.5분'],['완전 충·방전(104분) 대비','−98.5%'],['실제 오판율','2.8%'],['정밀검사 비율','0.3%']],
    note:'RWTH 48셀을 오차 계산 20% · 기준 선택 40% · 평가 40%로 500번 다시 나눠 평균 낸 값이에요.'},
  sdu:{model:'LightGBM',rows:[['평균 검사시간','37.7분'],['완전 충·방전(365분) 대비','−89.7%'],['실제 오판율','3.1–4.0%'],['정밀검사 비율','6.81%']],
    note:'SDU 86셀을 같은 방식으로 500번 다시 나눈 평균이에요. 오판율은 보고서에 적힌 SDU 범위예요. 이 화면의 SDU 모델(실시간 dV/dt 전처리로 다시 학습)과는 전처리와 분할이 달라요.'}};
function renderPerf(){const el=$('#perf');if(!el)return;
  const sdu=S.ds==='sdu',C=DC(),a=AT(S.alpha),t=a.test,R=RESEARCH[S.ds],cut=1-t.minutes/C.fullTestMin;
  const n=sdu?`독립 평가 ${t.cells}셀 · ${t.samples.toLocaleString()}개`:`독립 평가 ${t.cells}셀 · ${t.samples}개`;
  el.innerHTML=`<h3 class="st-h">성능 수치</h3>
    <p class="pf-lead">이 화면이 쓰는 <b>웹 배포 모델</b>의 평가 결과와, 보고서의 <b>연구 실험 결과</b>는 만든 방법이 달라요. 서로 직접 비교하지 마세요.</p>
    <div class="st-grid">
      <div class="st-card pf-web"><span class="pf-tag web">웹 배포 모델 · 이 화면의 판정</span>
        <h4>${sdu?'SDU 실시간 dV/dt LightGBM':'RWTH 단계별 Ridge'} · α ${Math.round(S.alpha*100)}% · λ ${a.lambda}</h4>
        <p class="pf-sub">${n} (학습·보정에 안 쓴 셀)</p>
        <dl class="pf-kv">
          <div><dt>평균 검사시간</dt><dd>${f1(t.minutes)}분</dd></div>
          <div><dt>완전 충·방전(${C.fullTestMin}분) 대비</dt><dd>${cut>=0?'−':'+'}${(Math.abs(cut)*100).toFixed(1)}%</dd></div>
          <div><dt>실제 오판율</dt><dd>${pct(t.misgrade,2)}</dd></div>
          <div><dt>정밀검사 비율</dt><dd>${pct(t.precise,1)}</dd></div></dl>
        <details class="pf-more"><summary>α별로 보기${icon('down')}</summary>
          <table class="checks"><thead><tr><th>α</th><th>λ</th><th>오판</th><th>정밀검사</th><th>평균 시간</th></tr></thead><tbody>
          ${C.alphaTable.map(x=>`<tr${x.alpha===S.alpha?' class="on"':''}><td>${Math.round(x.alpha*100)}%</td><td>${x.lambda}</td><td>${pct(x.test.misgrade,2)}</td><td>${pct(x.test.precise)}</td><td>${f1(x.test.minutes)}분</td></tr>`).join('')}</tbody></table>
          <p class="small">단계별 q(t): ${C.stages.map(st=>`${st}분 ±${C.q[st].toFixed(2)}`).join(' · ')} (%p)</p></details>
        <p class="small">${sdu?'평균 시간은 정밀검사를 60분 + 365분으로 잡아 다시 계산했어요. α 5–7%는 λ를 고르지 못해 자동 판정을 제공하지 않아요.':`평가 표본이 ${t.samples}개로 작아요. α 6% 이상은 λ=0이라 예측값만으로 대부분 1분에 확정해요.`}</p></div>
      <div class="st-card pf-lab"><span class="pf-tag lab">연구 실험 결과 · 최종보고서</span>
        <h4>${sdu?'SDU':'RWTH'} ${R.model} · α 10% · 500회 반복 재분할 평균</h4>
        <p class="pf-sub">이 화면의 판정에는 쓰이지 않는 참고 수치예요</p>
        <dl class="pf-kv">${R.rows.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
        <p class="small">${R.note}</p></div>
    </div>
    ${(()=>{const A=typeof MISGRADE!=='undefined'&&MISGRADE[S.ds].byAlpha[S.alpha.toFixed(2)];if(!A)return'';const sm=A.summary;
      return`<div class="st-card pf-cv"><span class="pf-tag cv">교차검증 · 경계거리별 관측 오판율</span>
        <h4>${sdu?'SDU 86셀':'RWTH 48셀'} 셀 단위 5겹 교차검증 · 이 화면과 같은 q(t)·λ · α ${Math.round(S.alpha*100)}%</h4>
        <p class="pf-sub">확정 ${nf(sm.confirmed)}건 · 정밀검사 ${nf(sm.precise)}건${sm.preciseOutOfRange?` (범위 밖 ${sm.preciseOutOfRange})`:''} · 확정 중 오판 ${(sm.misgradeRate*100).toFixed(2)}%</p>
        <table class="checks"><thead><tr><th>확정 시 경계거리</th><th>확정</th><th>셀</th><th>상향 오판</th><th>부당 하향</th></tr></thead><tbody>
        ${A.bins.map((b,i)=>`<tr><td>${MG_BINS[i][2]}</td><td>${nf(b.n)}</td><td>${b.cells}</td>${b.n?(b.enough?`<td>${mgPct(b.up,b.n)} (${b.up})</td><td>${mgPct(b.down,b.n)} (${b.down})</td>`:`<td colspan="2" class="mg-na">사례 부족 · 오판 ${b.up+b.down}건 (상향 ${b.up} · 하향 ${b.down})</td>`):'<td colspan="2" class="mg-na">이 구간에서 확정된 배터리 없음</td>'}</tr>`).join('')}</tbody></table>
        <p class="small">웹 배포 모델의 독립 평가와도, 보고서의 500회 반복 실험과도 다른 별도 실험이에요. 각 배터리의 자세히 보기에는 그 배터리가 확정된 구간의 값이 나와요.</p></div>`;})()}
    <div class="st-warn">${icon('alert')}<p>${sdu?'<b>검증 범위:</b> 60분 CSV를 받아 5·10·30·60분 단계마다 그 시점까지의 데이터만 써서 예측해요. 원시 기록의 10초 재보간과 실시간 장비 연결은 없어요. 실제 회수 배터리·팩에서는 검증하지 않았어요.':'<b>검증 범위:</b> '+RWTH_WARN+' 예측 SOH가 48–83% 밖이면 자동 확정하지 않아요.'}</p></div>`;}

/* ----- 결과 ----- */
function cardHTML({r,e,v}){const anim=!S.seen.has(r.id);
  return`<li class="card k-${v.k}${anim&&e.status==='ok'?' seq':''}" style="--done:${e.status==='ok'?seqLen(e):0}"><button class="card-hit" data-open="${r.id}" aria-haspopup="dialog">
    <span class="card-top"><span class="badge b-${v.k}">${v.tag}</span>${isNear(e)?`<span class="near-chip" title="등급선에서 ${NEAR}%p 안쪽으로 확정됐어요">${icon('alert')}경계 근처</span>`:''}<span class="card-name">${esc(r.name)}</span></span>
    <b class="card-say">${v.say}</b>
    <span class="card-meter">${cell(e,anim)}<span class="card-pct">${e.status==='ok'?`<b>${f1(e.soh)}<small>%</small></b><span class="ci"><em>${BAND(e)}</em>${f1(e.lo)}–${f1(e.hi)}%</span>`:''}</span></span>
    ${e.status==='ok'?stepsMini(e,anim):''}
    ${v.note?`<span class="card-note">${esc(v.note)}</span>`:''}
  </button><button class="card-del" data-del="${r.id}" aria-label="${esc(r.name)} 지우기" title="지우기">${icon('x')}</button></li>`;}
/* 카드 아래 단계 표시: RWTH 1·2·5·10·30분, SDU 5·10·30·60분 중 어디서 확정됐는지 */
/* v5: 측정한 단계(reached)만 순서대로 켜요. --i는 몇 번째로 켜질지, 건너뛴 단계는 처음부터 흐리게 둬요.
   seqLen은 켜지는 칸 수(정밀검사 칸 포함)라서, 판정 문구는 그 다음에 나타나요. */
const seqLen=e=>e.steps.filter(s=>s.reached).length+(e.decision==='precise'?1:0);
function stepsMini(e,anim){const last=e.steps[e.steps.length-1].stage;
  const say=e.decision==='auto'?e.stage+'분에 확정':(e.decision==='extend'?`${e.measured}분까지 측정, ${e.next}분 기록 필요`:(e.oor?e.oorStage+'분 예측이 검증 범위 밖':last+'분까지 미확정'));
  let i=0;
  return`<span class="steps" aria-label="${say}">${e.steps.map(s=>{
  const c=!s.reached?'skip':(s.ok?'ok':'no');return`<span class="step ${c}"${s.reached?` style="--i:${i++}"`:''}>${s.stage}분</span>`;}).join('')}${e.decision==='precise'?`<span class="step pre" style="--i:${i}">정밀검사</span>`:''}</span>`;}

/* 판정별로 묶어서, 묶음 사이에 점선 */
const GROUP={R:'정밀검사',E:'측정 연장',A:'A등급',B:'B등급',C:'C등급',X:'판정 불가'};
function groups(list){const ks=[...new Set(list.map(x=>x.v.k))];
  return ks.map(k=>{const xs=list.filter(x=>x.v.k===k);
    return`<section class="grp">${ks.length>1?`<h3 class="grp-h"><span class="dot d-${k}" aria-hidden="true"></span>${GROUP[k]}<b>${xs.length}</b></h3>`:''}<ul class="cards">${xs.map(cardHTML).join('')}</ul></section>`;}).join('');}

function renderResults(){const sec=$('#results'),n=S.rows.length;
  if(!n){sec.innerHTML=`<div class="wrap"><div class="res-head"><div><h2 id="resTitle">검진 결과</h2></div></div><button class="empty-res" style="width:100%" data-pick>올린 파일이 없어요. 눌러서 파일을 골라 주세요.</button></div>`;return;}
  const ev=S.rows.map(r=>{const e=evalRow(r);return{r,e,v:view(e)};});
  const cnt={R:0,E:0,A:0,B:0,C:0,X:0};ev.forEach(x=>cnt[x.v.k]++);
  if(S.filter!=='all'&&!cnt[S.filter])S.filter='all';
  const list=ev.filter(x=>S.filter==='all'||x.v.k===S.filter).sort((a,b)=>ORDER[a.v.k]-ORDER[b.v.k]);
  const exOnly=S.rows.every(r=>r.example),sdu=S.ds==='sdu';
  const pill=(k,label)=>cnt[k]||k==='all'?`<button class="pill${S.filter===k?' on':''}" data-f="${k}" aria-pressed="${S.filter===k}">${k==='all'?'':`<span class="dot d-${k}" aria-hidden="true"></span>`}${label}<b>${k==='all'?n:cnt[k]}</b></button>`:'';
  const nearN=ev.filter(x=>isNear(x.e)).length,C=DC(),done=ev.filter(x=>x.e.status==='ok'&&x.e.minutes!=null),full=done.length*C.fullTestMin,spent=done.reduce((s,x)=>s+x.e.minutes,0);
  const save=done.length?`<p class="small">판정을 마친 ${done.length}개 · 검사 시간 ${f1(spent)}분 · 모두 완전 충·방전(${C.fullTestMin}분)했다면 ${full}분 → <b>${full-spent>=0?f1(full-spent)+'분 절감':f1(spent-full)+'분 더 걸림'} (${pct((full-spent)/full,0)})</b>${cnt.E?` · 측정 연장 ${cnt.E}개는 빼고 셌어요`:''}${nearN?` · 등급선 ${NEAR}%p 안쪽 확정 ${nearN}개`:''}</p>`:'';
  const sub=exOnly?(sdu?`SDU 독립 테스트 셀의 실제 기록 ${S.rows.length}개예요. 내 파일을 올리면 예시는 사라져요.`:`학습에 안 쓴 RWTH 시험 셀의 실제 기록 ${RWTH_EXAMPLES.length}개예요. 내 파일을 올리면 예시는 사라져요.`):'카드를 누르면 자세히 볼 수 있어요.';
  sec.innerHTML=`<div class="wrap">
    <div class="res-head"><div>
      <h2 id="resTitle">검진 결과<span class="ex ds-tag">${sdu?'SDU':'RWTH'} · α ${Math.round(S.alpha*100)}%</span>${exOnly?'<span class="ex">예시</span>':''}</h2>
      <p>${sub}</p>${save}</div>
      <div class="res-act"><button class="btn btn-soft btn-sm" data-pick>${icon('plus')}파일 추가</button></div></div>
    ${Object.values(cnt).filter(Boolean).length>1?`<div class="sum" role="group" aria-label="결과 걸러 보기">${pill('all','전체')}${pill('R','정밀검사')}${pill('E','측정 연장')}${pill('A','A등급')}${pill('B','B등급')}${pill('C','C등급')}${pill('X','판정 불가')}</div>`:''}
    ${groups(list)}
    <button class="add" data-pick>${icon('plus')}파일 더 올리기</button>
  </div>`;
  ev.forEach(x=>S.seen.add(x.r.id));}

/* ----- 자세히 보기 ----- */
const box=(title,body,cls='')=>`<section class="d-box ${cls}">${title?`<h3>${title}</h3>`:''}${body}</section>`;
function truthBox(r,e){if(r.truth==null)return'';const gr=gradeOf(r.truth),same=gr===e.grade,ok=e.decision!=='auto'||same;
  const wait=e.decision==='extend'?'아직 측정 중이라 판정 전이에요':'정밀검사로 보낸 건 틀린 판정이 아니에요';
  return box('실제 측정값과 비교',`<div class="cmp"><div><span>실제 용량시험</span><b>${f1(r.truth)}%</b><em>${gr}등급</em></div><div><span>모델 예측</span><b>${f1(e.soh)}%</b><em>${e.grade}등급</em></div></div><p class="${ok?'res-ok':'res-no'}">${icon(ok?'check':'alert')}${e.decision!=='auto'?wait:(same?'판정이 맞았어요':'판정이 틀렸어요')}</p>`);}
function drawerSDU(r,e,v){
  const auto=e.decision==='auto';
  let b=box('',`<div class="d-big"><div><span>남은 성능${auto?` · ${e.stage}분 예측`:' · 60분 예측'}</span><b>${f1(e.soh)}<small>%</small></b></div><div class="d-range">오차 범위 ±${f1(e.q)}<b>${f1(e.lo)}–${f1(e.hi)}%</b></div></div>${gauge(e,v.k)}<p class="d-sum">${esc(sumLine(e))}</p>${isNear(e)?`<p class="d-near">${icon('alert')}등급선에서 ${NEAR}%p 안쪽으로 확정됐어요. 경계 근처에서는 판정 위험이 커질 수 있으니 주의하세요.</p>`:''}`);
  const msg=auto?`등급선까지 거리가 안전거리보다 멀어서 ${e.stage}분에 확정했어요.`
    :(e.oor?`${e.oorStage}분에 확정 조건은 넘었지만, 예측 ${f1(e.soh)}%가 평가 데이터 범위(${OOR(e)}) 밖이라 정밀검사(+${SDU_CFG.fullTestMin}분)로 보내요.`
    :`60분까지 재도 안전거리 안이라 정밀검사(+${SDU_CFG.fullTestMin}분)로 보내요.`);
  const ok=auto||e.oor,at=auto?e.stage:(e.oor?e.oorStage:60);
  b+=box('왜 이렇게 판정했나요?',`<div class="why"><div><span>${e.nb}% 선까지 거리</span><b>${e.near.toFixed(2)}</b></div><span class="why-op">${ok?'&gt;':'≤'}</span><div><span>안전거리 λ·q(${at}분)</span><b>${e.need.toFixed(2)}</b></div></div>
    <p class="why-r ${auto?'ok':'no'}">${icon(auto?'check':'alert')}${msg}</p>
    <table class="checks stage-t seq"><thead><tr><th>단계</th><th>예측</th><th>등급선 거리</th><th>안전거리 ${e.lambda}×q</th><th>결과</th></tr></thead><tbody>
    ${e.steps.filter(s=>s.reached).map((s,i)=>`<tr style="--i:${i}"><td>${s.stage}분</td><td>${f1(s.soh)}%</td><td>${s.near.toFixed(2)}</td><td>${s.need.toFixed(2)}</td><td>${s.ok?'<span class="st ok">확정</span>':'<span class="st na">다음 단계</span>'}</td></tr>`).join('')}
    ${auto?'':`<tr style="--i:${e.steps.filter(s=>s.reached).length}"><td>+${SDU_CFG.fullTestMin}분</td><td colspan="3">용량시험${e.oor?' (검증 범위 밖)':''}</td><td><span class="st no">정밀검사</span></td></tr>`}</tbody></table>
    <p class="small">총 검사 시간 ${e.minutes}분 · α ${Math.round(e.alpha*100)}% · λ ${e.lambda}</p>`);
  b+=box('단계별 판정 과정',stageChart(e));
  b+=mgBox(e);
  b+=truthBox(r,e);
  if(e.warning)b+=box('주의',`<p>${e.warning}</p>`,'d-warn');
  b+=box('이 결과를 읽을 때',`<ul class="caveat">
    <li>60분 CSV를 입력받되 각 단계의 마지막 dV/dt를 후진차분으로 계산합니다. 미래 10초 전압을 참조하지 않아요. 진짜 스트리밍 수신 기능은 제공하지 않습니다.</li>
    <li>q(t)는 90%를 목표로 구한 오차 폭이지만, 독립 18셀 평가에서 ±q(t)가 실제값을 담은 비율은 ${pct(Math.min(...Object.values(SDU_CFG.coverage)),0)}–${pct(Math.max(...Object.values(SDU_CFG.coverage)),0)}였어요. 90% 보장 범위로 읽으면 안 돼요.</li>
    <li>입력값이 학습 조건 안인지는 검사하지 않았어요. 판정 가능 범위가 아직 검증되지 않았어요.</li></ul>`,'d-soft');
  const c=r.curve,stg=SDU_CFG.stages,o={dt:10,t0:10,ticks:[0,10,20,30,40,50,60],marks:stg.slice(0,-1)};
  const [vl,vh]=nice(c.V,.08),[tl,th]=nice(c.temp,.15);
  b+=`<details class="d-box more"><summary>측정값 자세히 보기${icon('down')}</summary>
    <p class="small" style="margin:0 0 var(--s4)">점선은 5·10·30분 단계예요. dV/dt는 ${c.dVdtFromFile?'파일에 있는 값을 썼어요.':'파일에 없어서 전압에서 계산했어요.'}</p>
    ${chart(c.V,Object.assign({min:vl,max:vh,color:'oklch(0.57 0.2 258)',label:'전압',unit:'V',dp:3},o))}
    ${chart(c.I,Object.assign({min:0,max:Math.max(1.4,...c.I),color:'oklch(0.66 0.16 60)',label:'전류',unit:'A',dp:3},o))}
    ${chart(c.temp,Object.assign({min:tl,max:th,color:'oklch(0.64 0.19 28)',label:'온도',unit:'°C',dp:1},o))}
    ${chart(c.dVdt,Object.assign({min:Math.min(0,...c.dVdt),max:Math.max(...c.dVdt),color:'oklch(0.58 0.2 320)',label:'dV/dt',unit:'mV/min',dp:1},o))}</details>`;
  return b;}
/* RWTH: 엔진은 "[예측 ± λ·q(t)]가 한 등급 안"으로 확정해요. 이건 "가장 가까운 등급선까지 거리 > λ·q(t)"와 같아서
   (등급선에 딱 걸치는 경우만 빼고) 설명은 SDU·설계 문서처럼 경계거리와 안전거리로 해요. */
function drawerRWTH(r,e,v){const C=RWTH_CFG,last=C.stages[C.stages.length-1],auto=e.decision==='auto',done=e.steps.filter(s=>s.reached);
  const at=auto?e.stage:(e.oor?e.oorStage:done[done.length-1].stage),ok=auto||e.oor;
  let b=box('',`<div class="d-big"><div><span>남은 성능 · ${at}분 예측</span><b>${f1(e.soh)}<small>%</small></b></div><div class="d-range">판정 구간 ±${e.need.toFixed(2)}<b>${f1(e.lo)}–${f1(e.hi)}%</b></div></div>${gauge(e,v.k)}<p class="d-sum">${esc(sumLine(e))}</p>${isNear(e)?`<p class="d-near">${icon('alert')}등급선에서 ${NEAR}%p 안쪽으로 확정됐어요. 경계 근처에서는 판정 위험이 커질 수 있으니 주의하세요.</p>`:''}`);
  const msg=auto?`등급선까지 거리가 안전거리보다 멀어서 ${e.stage}분에 ${e.grade}등급으로 확정했어요.`
    :(e.oor?`${e.oorStage}분에 확정 조건은 넘었지만, 예측 ${f1(e.soh)}%가 검증 범위(${OOR(e)}) 밖이라 정밀검사(+${C.fullTestMin}분)로 보내요.`
    :(e.decision==='extend'?`${e.measured}분까지는 등급선 ${e.nb}%까지 거리가 안전거리 이하예요. ${e.next}분까지 기록(${e.nextRows}행)을 더 올려 주세요.`
    :`${last}분까지 재도 등급선 ${e.nb}%까지 거리가 안전거리 이하라 정밀검사(+${C.fullTestMin}분)로 보내요.`));
  b+=box('왜 이렇게 판정했나요?',`<div class="why"><div><span>${e.nb}% 선까지 거리</span><b>${e.near.toFixed(2)}</b></div><span class="why-op">${ok?'&gt;':'≤'}</span><div><span>안전거리 λ·q(${at}분)</span><b>${e.need.toFixed(2)}</b></div></div>
    <p class="why-r ${auto?'ok':'no'}">${icon(auto?'check':'alert')}${msg}</p>
    <table class="checks stage-t seq"><thead><tr><th>단계</th><th>예측</th><th>등급선 거리</th><th>안전거리 ${e.lambda}×q</th><th>결과</th></tr></thead><tbody>
    ${e.steps.filter(s=>s.reached||s.missing).map((s,i)=>s.reached?`<tr style="--i:${i}"><td>${s.stage}분</td><td>${f1(s.soh)}%</td><td>${s.near.toFixed(2)}</td><td>${s.need.toFixed(2)}</td><td>${s.ok?'<span class="st ok">확정</span>':'<span class="st na">다음 단계</span>'}</td></tr>`
      :`<tr style="--i:${i}"><td>${s.stage}분</td><td colspan="3">기록 없음 (${s.rows}행 필요)</td><td><span class="st na">측정 연장</span></td></tr>`).join('')}
    ${e.decision==='precise'?`<tr style="--i:${e.steps.filter(s=>s.reached||s.missing).length}"><td>+${C.fullTestMin}분</td><td colspan="3">용량시험${e.oor?' (검증 범위 밖)':''}</td><td><span class="st no">정밀검사</span></td></tr>`:''}</tbody></table>
    <p class="small">${e.minutes!=null?`총 검사 시간 ${e.minutes}분 · `:''}α ${Math.round(e.alpha*100)}% · λ ${e.lambda}</p>`);
  b+=box('단계별 판정 과정',stageChart(e));
  b+=mgBox(e);
  b+=truthBox(r,e);
  if(e.warning)b+=box('주의',`<p>${e.warning}</p>`,'d-warn');
  const covs=C.stageMetrics.map(s=>s.coverage);
  b+=box('이 결과를 읽을 때',`<ul class="caveat">
    ${e.lambda===0?'<li>지금 α에서는 λ=0이라 안전거리가 0이에요. 오차 여유 없이 예측값만으로 등급을 정했어요.</li>':''}
    <li>q(t)는 90%를 목표로 구한 오차 폭이지만, 독립 테스트에서 ±q(t)가 실제값을 담은 비율은 ${pct(Math.min(...covs),0)}–${pct(Math.max(...covs),0)}였어요.</li>
    <li>입력값이 학습 조건 안인지는 검사하지 않았어요. 배포 설정에 판정 가능 범위가 없어요.</li>
    ${r.curve.zeroed?'<li>charge_Ah·energy_Wh 첫 값이 0이 아니라서, 첫 값을 빼서 충전 시작 기준 변화량으로 썼어요.</li>':''}</ul>`,'d-soft');
  const c=r.curve,end=(c.V.length-1)/6,step=end>=10?5:1,ticks=[];for(let m=0;m<=end+1e-9;m+=step)ticks.push(m);
  const o={dt:10,t0:0,ticks,marks:C.stages.filter(s=>s<end)};
  const [vl,vh]=nice(c.V,.08),[tl,th]=nice(c.temp,.15);
  b+=`<details class="d-box more"><summary>측정값 자세히 보기${icon('down')}</summary>
    <p class="small" style="margin:0 0 var(--s4)">점선은 ${C.stages.filter(s=>s<end).join('·')}분 단계예요. 각 단계는 그 시점까지의 값만 써요.</p>
    ${chart(c.V,Object.assign({min:vl,max:vh,color:'oklch(0.57 0.2 258)',label:'전압',unit:'V',dp:3},o))}
    ${chart(c.I,Object.assign({min:Math.min(0,...c.I),max:Math.max(4.5,...c.I),color:'oklch(0.66 0.16 60)',label:'전류',unit:'A',dp:2},o))}
    ${chart(c.temp,Object.assign({min:tl,max:th,color:'oklch(0.64 0.19 28)',label:'온도',unit:'°C',dp:1},o))}</details>`;
  return b;}
function drawerHTML(r,e,v){
  let b='';
  if(e.status==='ok')b+=e.ds==='sdu'?drawerSDU(r,e,v):drawerRWTH(r,e,v);
  if(e.status==='error')b+=box('파일을 읽지 못했어요',`<p>${esc(e.msg)}</p>`,'d-warn');
  return`<header class="d-head"><div class="d-id"><span class="badge b-${v.k}">${v.tag}</span><p class="d-say" id="dTitle">${v.say}</p><p class="d-name">${esc(r.name)}</p></div>${e.status==='ok'?`<button class="btn btn-main btn-sm d-print" data-replay="${r.id}">${icon('play')}실시간 재생</button><button class="btn btn-soft btn-sm d-print" data-print="${r.id}">${icon('print')}판정서</button>`:''}<button class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></header><div class="d-scroll">${b}</div>`;}

function openDrawer(id){const r=S.rows.find(x=>x.id===id);if(!r)return;const e=evalRow(r),dr=$('#drawer');
  S.sel=id;dr.innerHTML=drawerHTML(r,e,view(e));dr.hidden=false;$('#scrim').hidden=false;
  void dr.offsetWidth;document.body.classList.add('drawer-open');dr.querySelector('[data-close]').focus();}
function closeDrawer(){if(S.sel==null)return;const id=S.sel;S.sel=null;document.body.classList.remove('drawer-open');
  setTimeout(()=>{if(S.sel==null){$('#drawer').hidden=true;$('#scrim').hidden=true;}},380);
  const b=document.querySelector(`[data-open="${id}"]`);if(b)b.focus({preventScroll:true});}

/* ----- 데이터셋 바꾸기: 결과 목록도 데이터셋마다 따로 둬요 ----- */
const SCENE_MIN={rwth:30,sdu:60};
/* SDU 예시: 10개 중 6개만 보여 줘요 (α 10% 기준 A 5분·10분, B 60분 2개, C 30분, 정밀검사 1개) */
/* 예시의 실제 SOH(용량시험 측정값). 모델과 상관없는 정답이라 새 모델에서도 그대로 써요. 예전 sdu_model.js의 같은 CSV에서 옮겨 왔어요 */
const SDU_TRUTH={"SDU_BID04_cycle1_sample248.csv":81.04035949707031,"SDU_BID07_cycle276_sample537.csv":67.72543334960938,"SDU_BID09_cycle251_sample735.csv":56.51179122924805,"SDU_BID50_cycle1621_sample4065.csv":54.31044769287109,"SDU_BID12_cycle1_sample887.csv":79.11229705810547,"SDU_BID18_cycle61_sample1354.csv":72.09208679199219,"SDU_BID25_cycle76_sample1719.csv":74.04739379882812,"SDU_BID37_cycle111_sample2572.csv":66.85440063476562,"SDU_BID38_cycle276_sample2655.csv":58.31533050537109,"SDU_BID39_cycle1_sample2668.csv":80.8973159790039};
const SDU_PICK=['SDU_BID04_cycle1_sample248.csv','SDU_BID18_cycle61_sample1354.csv','SDU_BID07_cycle276_sample537.csv',
  'SDU_BID37_cycle111_sample2572.csv','SDU_BID09_cycle251_sample735.csv','SDU_BID50_cycle1621_sample4065.csv'];
const DROP_SUB={rwth:'1–30분 · 10초 간격 기록 · 여러 개도 돼요',sdu:'60분 · 10초 간격 360행 기록 · 여러 개도 돼요'};
async function setDs(ds){if(ds===S.ds&&document.body.dataset.ds===ds)return;
  if(ds==='sdu'){try{document.body.classList.add('loading');await loadSDU();}catch(e){toast(e.message);return;}finally{document.body.classList.remove('loading');}}
  closeDrawer();S.store[S.ds]=S.rows;S.alphaBy[S.ds]=S.alpha;S.ds=ds;S.rows=S.store[ds];S.alpha=S.alphaBy[ds];S.filter='all';S.seen.clear();
  document.body.dataset.ds=ds;document.querySelectorAll('.ds [data-ds]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.ds===ds)));
  $('#dropSub').textContent=DROP_SUB[ds];
  try{localStorage.setItem('bg-ds',ds);}catch(_){}
  if(ds==='sdu'&&!S.rows.length)SDU_EXAMPLES.filter(x=>SDU_PICK.includes(x.name)).forEach(x=>{addCsv(x.name,x.csv,SDU_TRUTH[x.name]??null).example=true;});
  renderInfo();renderTrust();renderAlpha();renderResults();}

/* ----- 동작 ----- */
let toastT;
function toast(msg){const t=$('#toast');t.innerHTML=icon('alert')+msg;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),3200);}
function load(fs){fs=fs.filter(f=>/\.csv$/i.test(f.name)||f.type==='text/csv');if(!fs.length){toast('CSV 파일만 올릴 수 있어요');return;}
  if(S.rows.every(r=>r.example))S.rows=[];   // 내 파일이 들어오면 예시는 치움
  let n=0;fs.forEach(f=>{const rd=new FileReader();rd.onload=()=>{addCsv(f.name,String(rd.result),null);
    if(++n===fs.length){S.filter='all';renderResults();$('#results').scrollIntoView({block:'start'});}};rd.readAsText(f);});}

document.addEventListener('click',ev=>{const t=ev.target.closest('[data-pick],[data-f],[data-del],[data-open],[data-print],[data-close],.ds [data-ds],[data-alpha]');if(!t)return;
  if(t.hasAttribute('data-pick'))$('#fileIn').click();
  else if(t.matches('.ds [data-ds]'))setDs(t.dataset.ds);
  else if(t.dataset.alpha){S.alpha=Number(t.dataset.alpha);renderAlpha();renderInfo();S.seen.clear();renderResults();$('#alpha [aria-checked="true"]').focus();}
  else if(t.dataset.f){const f=t.dataset.f;S.filter=f==='all'||S.filter===f?'all':f;renderResults();const b=document.querySelector(`[data-f="${S.filter}"]`);if(b)b.focus({preventScroll:true});}
  else if(t.dataset.del){const id=+t.dataset.del;S.rows=S.rows.filter(r=>r.id!==id);S.seen.delete(id);if(S.sel===id)closeDrawer();renderResults();}
  else if(t.dataset.open)openDrawer(+t.dataset.open);
  else if(t.dataset.print)printSheet(+t.dataset.print);
  else if(t.hasAttribute('data-close'))closeDrawer();});
document.addEventListener('keydown',ev=>{
  const rg=ev.target.closest&&ev.target.closest('#alpha .seg');
  if(rg&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(ev.key)){ev.preventDefault();const as=DC().alphas,i=as.indexOf(S.alpha),d=ev.key==='ArrowLeft'||ev.key==='ArrowUp'?-1:1;
    const nb=rg.querySelectorAll('button')[(i+d+as.length)%as.length];if(nb)nb.click();return;}
  if(S.sel==null)return;
  if(ev.key==='Escape'){closeDrawer();return;}
  if(ev.key==='Tab'){const f=[...$('#drawer').querySelectorAll('button,a[href],summary,[tabindex]:not([tabindex="-1"])')];if(!f.length)return;
    const a=f[0],z=f[f.length-1];if(ev.shiftKey&&document.activeElement===a){ev.preventDefault();z.focus();}else if(!ev.shiftKey&&document.activeElement===z){ev.preventDefault();a.focus();}}});
$('#fileIn').onchange=e=>{load([...e.target.files]);e.target.value='';};
const drop=$('#drop');
window.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('hot');});
window.addEventListener('dragleave',e=>{if(!e.relatedTarget)drop.classList.remove('hot');});
window.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('hot');load([...e.dataTransfer.files]);});

RWTH_EXAMPLES.forEach(x=>{addCsv(x.name,x.csv,x.truth).example=true;});
renderRwthInfo();renderPerf();renderTrust();renderAlpha();renderResults();
if(location.hash!=='#rwth')setDs('sdu');   // v4: 접속하면 SDU부터 보여 줘요 (주소 끝에 #rwth를 붙이면 RWTH부터)

/* ----- 충전하는 자동차: 충전 시간을 몇 초로 보여 줌(RWTH 10분, SDU 60분), 마우스를 올리거나 파일을 끌어 오면 빨라짐 ----- */
(function(){const sc=$('#scene');if(!sc)return;
  const segs=[...sc.querySelectorAll('.sc-seg')],pill=$('#scenePill');let min=0,hold=0;
  const paint=()=>{const full=SCENE_MIN[S.ds];min=Math.min(min,full);segs.forEach((s,i)=>s.classList.toggle('on',min>=(i+1)*full/4||(i===0&&min>0)));
    pill.textContent=min>=full?'검진 준비 완료!':`충전 ${Math.floor(min)}분째`;};
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){min=7.5;paint();return;}
  const tick=()=>{const full=SCENE_MIN[S.ds],fast=drop.matches(':hover')||drop.classList.contains('hot');sc.classList.toggle('fast',fast);
    if(min>=full){if(--hold<=0){min=0;sc.classList.remove('full');}}
    else{min=Math.min(full,min+(fast?1:.5)*full/10);if(min>=full){hold=fast?5:6;sc.classList.add('full');}}
    paint();setTimeout(tick,fast?180:450);};
  paint();tick();})();
