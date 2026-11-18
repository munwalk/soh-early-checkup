/* replay.js (frontend_replay) — 실시간 재생 모드 (전시용)
   기록된 충전 CSV를 10초 간격 한 줄씩 흘려 넣으면서, 단계 시점(RWTH 1·2·5·10·30분, SDU 5·10·30·60분)이 되면
   "그때까지 들어온 줄만" 잘라 판정 엔진에 넣어요. 확정되면 그 자리에서 충전을 멈춰요.
   실제 장비 연결이 아니라 기록을 다시 흘려 보는 재생이에요. 판정 규칙(q(t)·λ·검증 범위)은 app.js와 같아요.
   - 한 개 재생: 자세히 보기의 [실시간 재생]
   - 모두 재생: 검진 결과의 [모두 실시간 재생] — 여러 배터리가 같이 충전되다가 각자 확정 시점에 멈춰요 */
(function(root){
'use strict';
const gradeOfR=s=>s>=70?'A':(s>=60?'B':'C');
const cfgOf=ds=>ds==='sdu'?SDU_CFG:RWTH_CFG;
const rangeOf=ds=>ds==='sdu'?SDU_CFG.socRange:RWTH_CFG.evalRange;
/* 줄 수 ↔ 시간. RWTH는 0초부터(1분 = 7줄), SDU는 10초부터(5분 = 30줄) */
const kOfStage=(ds,st)=>ds==='sdu'?st*6:st*6+1;
const secOfRow=(ds,i)=>ds==='sdu'?(i+1)*10:i*10;          // i번째 줄(0부터)의 시각
const secOfK=(ds,k)=>k<=0?0:secOfRow(ds,k-1);               // k줄 받았을 때의 시각
const KEYS={rwth:['t','V','I','dQ','dE','temp'],sdu:['V','I','temp','dQ','dVdt']};
const cut=(ds,c,k)=>{const o={};for(const key of KEYS[ds])if(c[key])o[key]=c[key].slice(0,k);return o;};

/* 단계 판정: 앞 k줄만 엔진에 넘겨요. 확정 규칙은 엔진(judge)과 같아요 */
function stageAt(ds,c,st,alpha){
  const C=cfgOf(ds),k=kOfStage(ds,st),s=cut(ds,c,k),lam=C.lambda[alpha.toFixed(2)],q=C.q[st],need=lam*q;
  const p=ds==='sdu'?SDU.predictStage(SDU_MODELS,st,SDU.streamingFeatures(s,k)):RWTH.predictStage(RWTH_MODELS,st,s);
  const g=gradeOfR(p),nb=Math.abs(p-60)<Math.abs(p-70)?60:70,near=Math.min(Math.abs(p-60),Math.abs(p-70));
  const ok=ds==='sdu'?near>need:(gradeOfR(p-need)===g&&gradeOfR(p+need)===g);
  const [lo,hi]=rangeOf(ds);
  return{stage:st,k,soh:p,q,need,near,nb,ok,oor:ok&&(p<lo||p>hi),grade:g};}

/* 배터리 한 개의 재생 상태. advance(k)로 줄을 더 받아요 */
function lane(ds,row,alpha){return{ds,row,alpha,c:row.curve,total:row.curve.V.length,k:0,ev:[],end:null};}
function advance(L,k){
  if(L.end)return false;const C=cfgOf(L.ds);let changed=false;L.k=Math.min(k,L.total);
  for(const st of C.stages){if(L.end)break;if(L.ev.some(e=>e.stage===st))continue;
    const need=kOfStage(L.ds,st);if(need>L.k)break;
    const e=stageAt(L.ds,L.c,st,L.alpha);L.ev.push(e);changed=true;
    const last=st===C.stages[C.stages.length-1];
    if(e.oor)L.end={type:'oor',stage:st,k:need,minutes:st+C.fullTestMin,soh:e.soh};
    else if(e.ok)L.end={type:'auto',stage:st,k:need,minutes:st,grade:e.grade,soh:e.soh};
    else if(last)L.end={type:'precise',stage:st,k:need,minutes:L.ds==='sdu'?st+C.fullTestMin:C.unresolvedMin,soh:e.soh};}
  if(!L.end&&L.k>=L.total){const nx=C.stages.find(st=>kOfStage(L.ds,st)>L.total);
    if(nx!=null){L.end={type:'extend',k:L.total,next:nx,minutes:null};changed=true;}}
  return changed;}
/* 끝까지 한 번에 (검증용) */
function runAll(ds,row,alpha){const L=lane(ds,row,alpha);advance(L,L.total);return L;}

const API={stageAt,lane,advance,runAll,kOfStage,secOfK,secOfRow};
if(typeof module!=='undefined'&&module.exports){module.exports=API;return;}
root.REPLAY=API;

/* ================= 화면 ================= */
const $=s=>document.querySelector(s);
const ic=n=>`<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const ex=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const f1=x=>x.toFixed(1),f2=x=>x.toFixed(2);
const clock=sec=>`${Math.floor(sec/60)}분 ${String(Math.round(sec%60)).padStart(2,'0')}초`;
const RATE={rwth:6,sdu:10};          // ×1에서 1초에 넣는 줄 수 (RWTH 30분 ≈ 30초, SDU 60분 ≈ 36초)
const HOLD=0.9;                       // 단계 시점마다 판정을 보여 주려고 잠깐 멈추는 시간(초, ×1 기준)
const VAX={rwth:[3.45,3.95],sdu:[3.55,4.25]};   // 전압 축은 고정 (앞으로 올 값을 미리 보지 않게)
const USE={A:'ESS 등 재사용',B:'저부하 용도 재사용',C:'재활용·금속 회수'};
let P=null,lastFocus=null;

function shell(){let el=$('#rp');if(el)return el;
  el=document.createElement('div');el.id='rp';el.hidden=true;
  el.innerHTML=`<div class="rp-scrim" data-rp-close></div><section class="rp" role="dialog" aria-modal="true" aria-labelledby="rpTitle"></section>`;
  document.body.appendChild(el);return el;}

function endText(L){const C=cfgOf(L.ds),e=L.end;if(!e)return null;
  if(e.type==='auto')return{k:e.grade,tag:`${e.grade}등급 확정`,big:`${e.stage}분에 ${e.grade}등급 확정 · 충전 중단`,sub:`${USE[e.grade]} · 예측 ${f1(e.soh)}% · 완전 충·방전(${C.fullTestMin}분) 대비 ${C.fullTestMin-e.stage}분 절약`};
  if(e.type==='oor')return{k:'R',tag:'정밀검사',big:`${e.stage}분 예측이 검증 범위 밖 → 정밀검사`,sub:`예측 ${f1(e.soh)}%가 ${rangeOf(L.ds).join('–')}% 밖이라 자동 확정하지 않아요 · 용량시험 +${C.fullTestMin}분`};
  if(e.type==='precise')return{k:'R',tag:'정밀검사',big:`${e.stage}분까지 확정 못 함 → 정밀검사`,sub:`끝까지 등급선에 가까워요 · 용량시험 +${C.fullTestMin}분으로 정해요`};
  return{k:'E',tag:'기록 끝',big:`기록이 끝났어요 · ${e.next}분 기록 필요`,sub:'이 파일은 다음 단계까지 기록이 없어요'};}

/* ---------- 한 개 재생 ---------- */
const CW=640,CH=250,CL=46,CR=18,CT=30,CB=30;
function single(L){const ds=L.ds,C=cfgOf(ds),D=C.stages[C.stages.length-1]*60,[v0,v1]=VAX[ds];
  const X=s=>CL+(CW-CL-CR)*s/D,Y=v=>CT+(v1-Math.max(v0,Math.min(v1,v)))*(CH-CT-CB)/(v1-v0);
  let g=`<svg viewBox="0 0 ${CW} ${CH}" class="rp-chart" role="img" aria-label="충전 전압 그래프">`;
  for(let i=0;i<=4;i++){const v=v0+(v1-v0)*i/4;g+=`<line x1="${CL}" x2="${CW-CR}" y1="${Y(v)}" y2="${Y(v)}" class="c-g"/><text x="${CL-6}" y="${Y(v)+4}" text-anchor="end" class="c-a">${v.toFixed(2)}</text>`;}
  let lx=-1e9;C.stages.forEach(st=>{const x=X(st*60),lab=x-lx>=30;if(lab)lx=x;g+=`<line x1="${x}" x2="${x}" y1="${CT-8}" y2="${CH-CB}" class="rp-sl"/>${lab?`<text x="${x}" y="${CT-12}" text-anchor="middle" class="rp-slt">${st}분</text>`:''}`;});
  g+=`<text x="${CL}" y="${CH-8}" class="c-a">0분</text><text x="${CW-CR}" y="${CH-8}" text-anchor="end" class="c-a">${D/60}분</text><text x="0" y="13" class="c-t">충전 전압 (V)</text>`;
  g+=`<g id="rpSkip"></g><polyline id="rpLine" class="rp-line" points=""/><g id="rpDots"></g><circle id="rpHead" r="6" class="rp-head" cx="${CL}" cy="${CH-CB}" opacity="0"/></svg>`;
  const chips=C.stages.map(st=>`<li class="rp-chip" data-st="${st}"><b>${st}분</b><span>대기</span></li>`).join('');
  const lam=C.lambda[L.alpha.toFixed(2)];
  return`<header class="rp-h"><div><p class="rp-k">실시간 재생 · ${ds==='sdu'?'SDU':'RWTH'} · α ${Math.round(L.alpha*100)}% · λ ${lam}</p><h2 id="rpTitle">${ex(L.row.name)}</h2></div>${ctrls()}</header>
    <div class="rp-now"><div class="rp-clock"><span>충전 시간</span><b id="rpClock">0분 00초</b></div>
      <div class="rp-meas"><span>전압 <b id="rpV">–</b> V</span><span>전류 <b id="rpI">–</b> A</span><span>온도 <b id="rpT">–</b> °C</span></div>
      <p class="rp-state" id="rpState" aria-live="polite"><i class="rp-led"></i>충전 시작 전</p></div>
    <div class="rp-plot">${g}</div>
    <ol class="rp-chips">${chips}</ol>
    <div class="rp-res" id="rpRes" hidden></div>
    <p class="rp-note">${lam===0?'지금 α에서는 λ=0이라 안전거리가 0이에요. 첫 단계에서 대부분 바로 확정돼요. ':''}기록된 충전 데이터를 실시간처럼 흘려 넣은 재생이에요. 각 단계는 그때까지 들어온 데이터만 보고 판정해요. 실제 장비와 연결한 화면은 아니에요.</p>`;}

function paintSingle(L,stageNew){const ds=L.ds,C=cfgOf(ds),D=C.stages[C.stages.length-1]*60,[v0,v1]=VAX[ds],c=L.c;
  const X=s=>CL+(CW-CL-CR)*s/D,Y=v=>CT+(v1-Math.max(v0,Math.min(v1,v)))*(CH-CT-CB)/(v1-v0);
  const k=L.end?Math.min(L.k,L.end.k):L.k,sec=secOfK(ds,k);
  const pts=[];for(let i=0;i<k;i++)pts.push(X(secOfRow(ds,i)).toFixed(1)+','+Y(c.V[i]).toFixed(1));
  $('#rpLine').setAttribute('points',pts.join(' '));
  const h=$('#rpHead');if(k>0){h.setAttribute('cx',X(secOfRow(ds,k-1)));h.setAttribute('cy',Y(c.V[k-1]));h.setAttribute('opacity',L.end?0:1);}
  $('#rpClock').textContent=clock(sec);
  if(k>0){$('#rpV').textContent=c.V[k-1].toFixed(3);$('#rpI').textContent=c.I[k-1].toFixed(2);$('#rpT').textContent=c.temp[k-1].toFixed(1);}
  /* 단계 점과 칩 */
  $('#rpDots').innerHTML=L.ev.map(e=>{const i=e.k-1,col=e.ok&&!e.oor?`var(--${e.grade})`:'var(--sub)';
    return`<circle cx="${X(secOfRow(ds,i))}" cy="${Y(c.V[i])}" r="6.5" style="fill:${col}" class="rp-dot"/>`;}).join('');
  C.stages.forEach(st=>{const li=document.querySelector(`.rp-chip[data-st="${st}"]`),e=L.ev.find(x=>x.stage===st);if(!li)return;
    let cls='',body='대기';
    if(e){const op=e.ok?'&gt;':'≤';
      body=`<em>예측 ${f1(e.soh)}%</em><small>${e.nb}% 선까지 ${f2(e.near)} ${op} 안전거리 ${f2(e.need)}</small>`+(e.oor?'<strong>범위 밖 → 정밀검사</strong>':(e.ok?`<strong>${e.grade}등급 확정 · 충전 중단</strong>`:(st===C.stages[C.stages.length-1]?'<strong>확정 못 함 → 정밀검사</strong>':'<strong>다음 단계로</strong>')));
      cls=e.oor||(!e.ok&&st===C.stages[C.stages.length-1])?'no':(e.ok?'ok rg-'+e.grade:'wait');}
    else if(L.end)cls='off',body=L.end.type==='extend'?'기록 없음':'측정 안 함';
    else if(P&&P.judging===st)cls='now',body='판정 중…';
    li.className='rp-chip '+cls;li.querySelector('span')?li.querySelector('span').outerHTML=`<span>${body}</span>`:li.insertAdjacentHTML('beforeend',`<span>${body}</span>`);});
  /* 상태 줄 */
  const st=$('#rpState');
  if(L.end){const t=endText(L);st.className='rp-state end k-'+t.k;st.innerHTML=`<i class="rp-led"></i>${t.big}`;}
  else if(P&&P.judging!=null){st.className='rp-state judge';st.innerHTML=`<i class="rp-led"></i>${P.judging}분 데이터로 판정 중…`;}
  else if(k>0){const nx=C.stages.find(s=>!L.ev.some(e=>e.stage===s));st.className='rp-state run';st.innerHTML=`<i class="rp-led"></i>충전 중 · 다음 판정 ${nx}분`;}
  /* 끝: 측정하지 않은 구간 표시 + 결과 상자 */
  if(L.end&&!P.endPainted){P.endPainted=true;const x=X(sec);
    const left=D-sec,lbl=L.end.type==='auto'?`여기서 충전 중단 · 남은 ${Math.round(left/60)}분은 측정 안 함`:(L.end.type==='oor'?'여기서 멈추고 정밀검사로':'');
    $('#rpSkip').innerHTML=(left>0?`<rect x="${x}" y="${CT-8}" width="${X(D)-x}" height="${CH-CB-CT+8}" class="rp-skip"/>`:'')
      +`<line x1="${x}" x2="${x}" y1="${CT-8}" y2="${CH-CB}" class="rp-stop"/>`+(lbl&&left>0?`<text x="${Math.min(x+10,CW-CR-4)}" y="${CT+14}" class="rp-skipt" text-anchor="${x>CW*0.62?'end':'start'}" ${x>CW*0.62?`dx="-20"`:''}>${lbl}</text>`:'');
    const t=endText(L),r=$('#rpRes'),tr=L.row.truth;
    r.className='rp-res k-'+t.k;r.hidden=false;
    r.innerHTML=`<span class="badge b-${t.k}">${t.tag}</span><b>${t.big}</b><p>${t.sub}</p>${tr!=null?`<p class="rp-truth">실제 용량시험 ${f1(tr)}% · ${gradeOfR(tr)}등급${L.end.type==='auto'?(gradeOfR(tr)===L.end.grade?' · 판정이 맞았어요':' · 판정이 틀렸어요'):''}</p>`:''}`;}
  if(stageNew&&L.ev.length){const e=L.ev[L.ev.length-1];announce(`${e.stage}분 판정: 예측 ${f1(e.soh)}%, ${e.oor?'검증 범위 밖':(e.ok?e.grade+'등급 확정':'다음 단계로')}`);}}

/* ---------- 모두 재생 ---------- */
function multi(lanes,ds,alpha){const C=cfgOf(ds),D=C.stages[C.stages.length-1]*60;
  let lp=-1e9,lp0=-1e9;const ticks=C.stages.map(st=>{const p=st*60/D*100;lp0=lp;const lab=p-lp>=6;if(lab)lp=p;return`<i class="rp-tk" style="left:${p}%">${lab?`<em${p-lp0<10&&lp0>-1?' class="nb"':''}>${st}분</em>`:''}</i>`;}).join('');
  return`<header class="rp-h"><div><p class="rp-k">실시간 재생 · ${ds==='sdu'?'SDU':'RWTH'} · α ${Math.round(alpha*100)}% · λ ${C.lambda[alpha.toFixed(2)]} · ${lanes.length}개 동시 충전</p><h2 id="rpTitle">모두 실시간 재생</h2></div>${ctrls()}</header>
    <div class="rp-now"><div class="rp-clock"><span>충전 시간</span><b id="rpClock">0분 00초</b></div>
      <div class="rp-cnt" id="rpCnt"></div>
      <p class="rp-state" id="rpState" aria-live="polite"><i class="rp-led"></i>충전 시작 전</p></div>
    <div class="rp-lanes"><div class="rp-ln rp-axis"><span></span><span class="rp-tr rp-trx">${ticks}</span><span></span></div>
    ${lanes.map((L,i)=>`<div class="rp-ln" data-ln="${i}"><span class="rp-nm" title="${ex(L.row.name)}">${ex(L.row.name.replace(/\.csv$/i,''))}</span><span class="rp-tr">${C.stages.map(st=>`<i class="rp-tg" style="left:${st*60/D*100}%"></i>`).join('')}<i class="rp-fill"></i><i class="rp-mk"></i></span><span class="rp-st">대기</span></div>`).join('')}</div>
    <div class="rp-res" id="rpRes" hidden></div>
    <p class="rp-note">기록된 충전 데이터를 실시간처럼 흘려 넣은 재생이에요. 각 배터리는 단계 시점마다 그때까지 들어온 데이터만 보고 판정하고, 확정되면 그 자리에서 충전을 멈춰요. 실제 장비와 연결한 화면은 아니에요.</p>`;}

function paintMulti(stageNew){const ds=P.ds,C=cfgOf(ds),D=C.stages[C.stages.length-1]*60,sec=secOfK(ds,P.k);
  $('#rpClock').textContent=clock(sec);
  let run=0,done=0,pre=0,ext=0;
  P.lanes.forEach((L,i)=>{const el=document.querySelector(`[data-ln="${i}"]`);if(!el)return;
    const k=L.end?L.end.k:L.k,s=secOfK(ds,k),fill=el.querySelector('.rp-fill'),mk=el.querySelector('.rp-mk'),stx=el.querySelector('.rp-st');
    fill.style.width=(s/D*100)+'%';mk.style.left=(s/D*100)+'%';
    if(L.end){const t=endText(L);el.className='rp-ln end k-'+t.k;
      stx.innerHTML=L.end.type==='auto'?`<b>${L.end.grade}</b> ${L.end.stage}분 확정`:(L.end.type==='extend'?'기록 끝':(L.end.type==='oor'?`정밀검사 <small>${L.end.stage}분 범위 밖</small>`:'정밀검사'));
      if(L.end.type==='auto')done++;else if(L.end.type==='extend')ext++;else pre++;}
    else{run++;const last=L.ev[L.ev.length-1];el.className='rp-ln run'+(P.judging!=null?' judge':'');
      stx.textContent=P.judging!=null&&k>=kOfStage(ds,P.judging)?`${P.judging}분 판정 중`:(last?`${last.stage}분 미확정 · 계속`:'충전 중');}});
  $('#rpCnt').innerHTML=`<span class="c-run">측정 중 <b>${run}</b></span><span class="c-ok">확정 <b>${done}</b></span><span class="c-pre">정밀검사 <b>${pre}</b></span>${ext?`<span>기록 끝 <b>${ext}</b></span>`:''}`;
  const st=$('#rpState');
  if(!run){st.className='rp-state end';st.innerHTML=`<i class="rp-led"></i>모든 배터리 판정 끝`;}
  else if(P.judging!=null){st.className='rp-state judge';st.innerHTML=`<i class="rp-led"></i>${P.judging}분 데이터로 판정 중…`;}
  else if(P.k>0){st.className='rp-state run';st.innerHTML=`<i class="rp-led"></i>충전 중 · ${run}개 측정 중`;}
  if(!run&&!P.endPainted){P.endPainted=true;
    const fin=P.lanes.filter(L=>L.end.minutes!=null),spent=fin.reduce((a,L)=>a+L.end.minutes,0),full=fin.length*C.fullTestMin;
    const byStage=C.stages.map(s=>[s,P.lanes.filter(L=>L.end.type==='auto'&&L.end.stage===s).length]).filter(x=>x[1]);
    const r=$('#rpRes');r.className='rp-res k-ok';r.hidden=false;
    r.innerHTML=`<b>${P.lanes.length}개 중 ${done}개 자동 확정${pre?` · ${pre}개 정밀검사`:''}</b>
      <p>${byStage.map(([s,n])=>`${s}분 확정 ${n}개`).join(' · ')||'자동 확정 없음'}</p>
      <p>검사 시간 합계 ${f1(spent)}분 · 모두 완전 충·방전(${C.fullTestMin}분)했다면 ${full}분 → <b>${f1(full-spent)}분 절약 (${Math.round((full-spent)/full*100)}%)</b>${ext?` · 기록 끝 ${ext}개는 빼고 셌어요`:''}</p>`;}
  if(stageNew!=null){const n=P.lanes.filter(L=>L.end&&L.end.stage===stageNew&&L.end.type==='auto').length;announce(`${stageNew}분 판정: ${n}개 확정, ${run}개 계속 측정`);}}

/* ---------- 재생 제어 ---------- */
function ctrls(){return`<div class="rp-ctl"><button class="btn btn-main btn-sm" data-rp-play>${ic('pause')}<span>일시정지</span></button>
  <button class="icon-btn" data-rp-restart aria-label="처음부터" title="처음부터">${ic('restart')}</button>
  <div class="seg rp-spd" role="radiogroup" aria-label="재생 속도">${[1,2,4].map(s=>`<button type="button" role="radio" aria-checked="${s===1}" data-rp-speed="${s}">×${s}</button>`).join('')}</div>
  <button class="icon-btn" data-rp-close aria-label="닫기">${ic('x')}</button></div>`;}
let liveT;function announce(t){clearTimeout(liveT);liveT=setTimeout(()=>{const s=$('#rpLive');if(s)s.textContent=t;},50);}

function open(mode,rows){
  const ds=S.ds,alpha=S.alpha,ok=rows.filter(r=>!r.error);
  if(!ok.length){if(typeof toast==='function')toast('재생할 수 있는 기록이 없어요');return;}
  if(typeof closeDrawer==='function')closeDrawer();
  lastFocus=document.activeElement;
  const lanes=ok.map(r=>lane(ds,r,alpha)),el=shell(),box=el.querySelector('.rp');
  box.className='rp '+(mode==='one'?'rp-one':'rp-all');
  box.innerHTML=(mode==='one'?single(lanes[0]):multi(lanes,ds,alpha))+'<p class="sr" id="rpLive" aria-live="polite"></p>';
  el.hidden=false;document.body.classList.add('rp-open');
  P={mode,ds,alpha,lanes,k:0,kf:0,speed:1,playing:true,hold:0,judging:null,last:0,raf:0,endPainted:false,
     max:Math.max(...lanes.map(L=>L.total)),stops:[...new Set(cfgOf(ds).stages.map(st=>kOfStage(ds,st)))]};
  paint(null);setTimeout(()=>{const b=box.querySelector('[data-rp-play]');if(b)b.focus();},30);
  P.raf=requestAnimationFrame(t=>{P.last=t;P.raf=requestAnimationFrame(frame);});}
function close(){if(!P)return;cancelAnimationFrame(P.raf);P=null;const el=$('#rp');if(el)el.hidden=true;document.body.classList.remove('rp-open');
  if(lastFocus&&lastFocus.focus)lastFocus.focus({preventScroll:true});}
function paint(stageNew){if(P.mode==='one')paintSingle(P.lanes[0],stageNew!=null);else paintMulti(stageNew);}
const allDone=()=>P.lanes.every(L=>L.end);
function frame(t){if(!P)return;const dt=Math.min(.1,(t-P.last)/1000);P.last=t;
  if(!P.playing){P.raf=requestAnimationFrame(frame);return;}
  if(P.hold>0){P.hold-=dt;if(P.hold<=0){const st=P.judging;P.judging=null;
      P.lanes.forEach(L=>advance(L,P.k));paint(st);if(allDone())return finish();}
    P.raf=requestAnimationFrame(frame);return;}
  P.kf+=dt*RATE[P.ds]*P.speed;let k=Math.min(P.max,Math.floor(P.kf));
  /* 단계 시점은 건너뛰지 않아요: 거기서 멈추고 판정을 보여 줘요 */
  const stop=P.stops.find(s=>s>P.k&&s<=k&&P.lanes.some(L=>!L.end&&L.total>=s));
  if(stop!=null){k=stop;P.kf=stop;}
  if(k!==P.k){P.k=k;P.lanes.forEach(L=>{if(!L.end)L.k=Math.min(k,L.total);});
    if(stop!=null){P.judging=cfgOf(P.ds).stages.find(st=>kOfStage(P.ds,st)===stop);P.hold=HOLD/Math.sqrt(P.speed);}
    else P.lanes.forEach(L=>advance(L,k));   // 기록이 짧은 파일의 "기록 끝" 처리
    paint(null);if(allDone())return finish();}
  if(P.k>=P.max&&!P.hold){P.lanes.forEach(L=>advance(L,P.k));paint(null);return finish();}
  P.raf=requestAnimationFrame(frame);}
function finish(){P.playing=false;paint(null);const b=document.querySelector('[data-rp-play]');
  if(b){b.innerHTML=`${ic('restart')}<span>다시 재생</span>`;b.dataset.done='1';}}
function restart(){if(!P)return;const {mode}=P,rows=P.lanes.map(L=>L.row),sp=P.speed;cancelAnimationFrame(P.raf);
  open(mode,rows);P.speed=sp;document.querySelectorAll('[data-rp-speed]').forEach(x=>x.setAttribute('aria-checked',String(+x.dataset.rpSpeed===sp)));}

document.addEventListener('click',ev=>{const t=ev.target.closest('[data-replay],[data-replay-all],[data-rp-close],[data-rp-play],[data-rp-restart],[data-rp-speed]');if(!t)return;
  if(t.dataset.replay){const r=S.rows.find(x=>x.id===+t.dataset.replay);if(r)open('one',[r]);}
  else if(t.hasAttribute('data-replay-all'))open('all',S.rows);
  else if(!P)return;
  else if(t.hasAttribute('data-rp-close'))close();
  else if(t.hasAttribute('data-rp-restart'))restart();
  else if(t.hasAttribute('data-rp-play')){if(t.dataset.done)return restart();P.playing=!P.playing;
    t.innerHTML=P.playing?`${ic('pause')}<span>일시정지</span>`:`${ic('play')}<span>계속</span>`;}
  else if(t.dataset.rpSpeed){P.speed=+t.dataset.rpSpeed;document.querySelectorAll('[data-rp-speed]').forEach(x=>x.setAttribute('aria-checked',String(x===t)));}});
document.addEventListener('keydown',ev=>{if(!P)return;
  if(ev.key==='Escape'){ev.stopPropagation();close();return;}
  if(ev.key==='Tab'){const f=[...document.querySelectorAll('#rp .rp button')];if(!f.length)return;const a=f[0],z=f[f.length-1];
    if(ev.shiftKey&&document.activeElement===a){ev.preventDefault();z.focus();}else if(!ev.shiftKey&&document.activeElement===z){ev.preventDefault();a.focus();}}},true);
})(typeof window!=='undefined'?window:globalThis);
