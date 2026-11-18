/* verify_sdu.js — 시연 CSV 10개를 웹 엔진으로 돌려서, 배포 JSON에 적힌 α=10% 결과(상태·확정 단계·예측값)와 맞는지 확인해요.
   실행: node frontend_v3/tools/verify_sdu.js */
const SDU=require('../sdu_engine.js'),{SDU_CFG,SDU_MODELS,SDU_EXAMPLES}=require('../sdu_model.js');
let bad=0,maxErr=0;
for(const ex of SDU_EXAMPLES){
  const c=SDU.parse(ex.csv),r=SDU.judge(c,SDU_MODELS,SDU_CFG,0.10),ref=ex.ref;
  const status=r.decision==='auto'?'confirmed':'precise';
  let ok=status===ref.status;
  if(ref.status==='confirmed'){const e=Math.abs(r.soh-ref.pred);maxErr=Math.max(maxErr,e);ok=ok&&r.stage===ref.stage&&e<1e-6;}
  if(!ok)bad++;
  console.log((ok?'OK  ':'FAIL'),ex.name.padEnd(36),status.padEnd(9),String(r.stage).padEnd(4),r.soh.toFixed(6),'| ref',ref.status,ref.stage,ref.pred==null?'':ref.pred.toFixed(6),'| 단계별',r.steps.map(s=>s.soh.toFixed(3)).join(' '));
}
/* dVdt 열을 빼고 전압에서 다시 계산해도 같은 입력이 되는지 */
let dv=0;for(const ex of SDU_EXAMPLES){const c=SDU.parse(ex.csv),g=SDU.gradient(c.V).map(x=>x*60000);dv=Math.max(dv,...g.map((x,i)=>Math.abs(x-c.dVdt[i])));}
console.log('예측값 최대 차이',maxErr.toExponential(2),'· dVdt 재계산 최대 차이',dv.toFixed(5),'mV/min');
console.log(bad?`불일치 ${bad}건`:'10건 모두 일치');process.exit(bad?1:0);
