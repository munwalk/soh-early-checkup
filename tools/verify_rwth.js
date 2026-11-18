/* verify_rwth.js — RWTH 웹 엔진이 팀원 패키지(rwth_ridge_web/index.html)의 계산과 같은지 확인해요.
   1) 시연 CSV를 모든 α·단계에서 index.html의 modelPredict·measure 식으로 다시 계산해 비교
   2) 원본 Python 파이프라인이 남긴 independent_test_trace.csv의 확정 예측값과 비교
   3) charge_Ah·energy_Wh에 첫 값(오프셋)을 더한 CSV도 같은 예측이 나오는지 (첫 값 빼기 보정 경로)
   실행: node frontend_v3/tools/verify_rwth.js   (Python 쪽 독립 계산은 verify_rwth.py) */
const RWTH=require('../rwth_engine.js'),{RWTH_CFG:C,RWTH_MODELS:M}=require('../rwth_model.js'),{RWTH_EXAMPLES}=require('../rwth_demo.js');
const cfg=require('../../rwth_ridge_web/rwth_web_independent_validated_config.json');

/* independent_test_trace.csv(원본 Python 결과)의 α=5% 행. sample_130은 평가 범위 48–83% 밖이라 trace에 없어요. */
const TRACE={'cell_10_sample_135.csv':{alpha:0.05,stage:1,pred:81.52369689941406}};

/* index.html의 식 그대로 (CSV 행에서 time_s를 뺀 나머지를 이어 붙임) */
function refPredict(rows,t){const m=cfg.models[String(t)],n=t*60/cfg.input.dt_s+1,x=rows.slice(0,n).flatMap(r=>r.slice(1));
  let p=Number(m.intercept);for(let i=0;i<x.length;i++)p+=m.coef[i]*(x[i]-m.mean[i])/m.scale[i];return p;}
const g=(v,b)=>v>=b[1]?'A':v>=b[0]?'B':'C';
function refMeasure(rows,a){const lam=Number(cfg.lambdas[a]);
  for(const t of cfg.stages_min){if(rows.length<t*60/10+1)return{kind:'incomplete'};
    const p=refPredict(rows,t),m=lam*cfg.q_t[String(t)];if(g(p,cfg.bounds)===g(p-m,cfg.bounds)&&g(p,cfg.bounds)===g(p+m,cfg.bounds))return{kind:'confirmed',t,p};}
  return{kind:'precise'};}
const shift=(text,dq,de)=>{const L=text.trim().split(/\r?\n/);return[L[0],...L.slice(1).map(l=>{const p=l.split(',');p[3]=String(+p[3]+dq);p[4]=String(+p[4]+de);return p.join(',');})].join('\n');};

let bad=0,maxErr=0,maxShift=0;
for(const ex of RWTH_EXAMPLES){
  const rows=ex.csv.trim().split(/\r?\n/).slice(1).map(l=>l.split(',').map(Number)),c=RWTH.parse(ex.csv),cs=RWTH.parse(shift(ex.csv,1.234,4.567));
  if(c.zeroed||!cs.zeroed){bad++;console.log('FAIL 보정 표시',ex.name);}
  for(const t of C.stages){const p=RWTH.predictStage(M,t,c);
    maxErr=Math.max(maxErr,Math.abs(p-refPredict(rows,t)));maxShift=Math.max(maxShift,Math.abs(p-RWTH.predictStage(M,t,cs)));}
  for(const a of Object.keys(cfg.lambdas)){const r=RWTH.judge(c,M,C,Number(a)),ref=refMeasure(rows,a);
    const kind={auto:'confirmed',precise:'precise',extend:'incomplete'}[r.decision];
    const ok=kind===ref.kind&&(kind!=='confirmed'||(r.stage===ref.t&&Math.abs(r.soh-ref.p)<1e-9));
    if(!ok){bad++;console.log('FAIL',ex.name,'α',a,r.decision,r.stage,'| ref',ref.kind,ref.t);}}
  const r5=RWTH.judge(c,M,C,0.05),tr=TRACE[ex.name];
  const okTr=!tr||(r5.decision==='auto'&&r5.stage===tr.stage&&Math.abs(r5.soh-tr.pred)<1e-3);if(!okTr)bad++;
  console.log((okTr?'OK  ':'FAIL'),ex.name.padEnd(24),'α5%',r5.decision,r5.stage,r5.soh.toFixed(5),tr?`| Python trace ${tr.stage}분 ${tr.pred.toFixed(5)}`:'| trace 없음(평가 범위 밖)',
    '| 단계별',C.stages.map(t=>RWTH.predictStage(M,t,c).toFixed(3)).join(' '));
}
if(maxShift>1e-9){bad++;}
/* 확정 안 되는 경로: 시연 셀은 모두 1분에 확정돼서, λ를 크게 바꾼 설정으로 연장·정밀검사 흐름만 확인해요 */
const big=Object.assign({},C,{lambda:{'0.05':100}}),lines=RWTH_EXAMPLES[0].csv.trim().split(/\r?\n/);
const rs=RWTH.judge(RWTH.parse(lines.slice(0,14).join('\n')),M,big,0.05),rf=RWTH.judge(RWTH.parse(lines.join('\n')),M,big,0.05);
const okFlow=rs.decision==='extend'&&rs.next===5&&rs.nextRows===31&&rf.decision==='precise'&&rf.minutes===C.unresolvedMin;if(!okFlow)bad++;
console.log((okFlow?'OK  ':'FAIL'),'λ=100: 2분 기록',rs.decision,`→ ${rs.next}분(${rs.nextRows}행) 필요`,'| 30분 기록',rf.decision,rf.minutes+'분');
console.log('index.html 식과 예측값 최대 차이',maxErr.toExponential(2),'· 충전량·에너지 오프셋 넣은 CSV와 최대 차이',maxShift.toExponential(2));
console.log(bad?`불일치 ${bad}건`:'모두 일치');process.exit(bad?1:0);
