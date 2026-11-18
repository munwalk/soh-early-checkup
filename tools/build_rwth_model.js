/* build_rwth_model.js — RWTH 배포 패키지(rwth_ridge_web)를 브라우저용 파일 2개로 묶어요.
   rwth_model.js = 판정에 쓰는 것(모델 계수·q(t)·λ·검증표) / rwth_demo.js = 시연 CSV와 정답 SOH(판정 코드는 읽지 않음)
   실행: node frontend_v3/tools/build_rwth_model.js   (battery-grader 폴더에서)
   모델 계수·q(t)·λ·검증표는 설정 JSON 값을 그대로 옮기고, 단계별 RMSE는 independent_test_stage_metrics.csv에서 읽어요. */
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..','..'),SRC=path.join(ROOT,'rwth_ridge_web');
const d=JSON.parse(fs.readFileSync(path.join(SRC,'rwth_web_independent_validated_config.json'),'utf8'));
const DEMO=path.join(__dirname,'..','demo_rwth');
const csv=(f,dir=SRC)=>{const L=fs.readFileSync(path.join(dir,f),'utf8').replace(/^﻿/,'').trim().split(/\r?\n/),h=L[0].split(',');
  return L.slice(1).map(l=>{const p=l.split(',');return Object.fromEntries(h.map((k,i)=>[k,p[i]]));});};

if(d.dataset!=='RWTH'||d.input.dt_s!==10||d.input.channels.join()!=='voltage_V,current_A,charge_Ah,energy_Wh,temperature_C')
  throw new Error('예상과 다른 입력 설정');
const models={};
for(const st of d.stages_min){const m=d.models[String(st)],n=(st*60/10+1)*5;
  if(m.coef.length!==n||m.mean.length!==n||m.scale.length!==n||m.scale.some(v=>!(v>0)))throw new Error('예상과 다른 모델 설정: '+st);
  models[st]={intercept:m.intercept,coef:m.coef,mean:m.mean,scale:m.scale};}

const split=JSON.parse(fs.readFileSync(path.join(SRC,'deployment_cell_split.json'),'utf8'));
const stage=csv('independent_test_stage_metrics.csv').map(r=>({stage:+r.stage_min,n:+r.n,rmse:+r.rmse,mae:+r.mae,coverage:+r.coverage_90_approx}));
const testN=d.validation.independent_test_n_48_83;
const lambda=Object.fromEntries(Object.entries(d.lambdas).map(([k,v])=>[Number(k).toFixed(2),v]));

const cfg={
  stages:d.stages_min,q:d.q_t,lambda,fullTestMin:d.full_test_min,unresolvedMin:d.unresolved_elapsed_min,bounds:d.bounds,
  alphas:Object.keys(lambda).map(Number).sort((a,b)=>a-b),defaultAlpha:0.10,evalRange:[48,83],   // 기본 α는 기존 웹과 같은 10% (팀원 페이지는 5%)
  alphaTable:d.alpha_table.map(a=>({alpha:a.alpha,lambda:a.lambda,
    test:{cells:split.test.length,samples:a.n_eval,misgrade:a.actual_misgrade,precise:a.precise_rate,minutes:a.mean_time_min,exceeded:a.alpha_exceeded_on_test}})),
  stageMetrics:stage,testN,validation:d.validation,
  cells:{train:split.train.length,shape:split.shape.length,calibration:split.calibration.length,test:split.test.length},
};

const out='/* rwth_model.js — tools/build_rwth_model.js가 만든 파일이에요. 직접 고치지 마세요. 정답 SOH는 들어 있지 않아요. */\n'
  +'const RWTH_CFG='+JSON.stringify(cfg)+';\n'
  +'const RWTH_MODELS='+JSON.stringify(models)+';\n'
  +'if(typeof module!=="undefined")module.exports={RWTH_CFG,RWTH_MODELS};\n';
fs.writeFileSync(path.join(__dirname,'..','rwth_model.js'),out);
console.log('rwth_model.js',(out.length/1e6).toFixed(2),'MB');

/* 시연 CSV: 시험 셀 10번(학습·q(t)·λ에 안 쓴 셀). 정답 SOH는 demo_rwth/labels_NOT_WEB_INPUT.csv에서 따로 붙여요.
   화면의 "실제 측정값과 비교"에만 쓰고, 판정(rwth_engine.js)에는 들어가지 않아요. */
const examples=csv('labels_NOT_WEB_INPUT.csv',DEMO).map(o=>({name:o.file,cell:+o.cell_id,sample:+o.sample_id,truth:+o.soh_label,
  inEvalRange:o.evaluation_soh_range==='True',csv:fs.readFileSync(path.join(SRC,o.file),'utf8')}));
const demo='/* rwth_demo.js — tools/build_rwth_model.js가 만든 시연용 파일이에요. 직접 고치지 마세요. truth는 화면 비교용 정답이고 판정에 쓰지 않아요. */\n'
  +'const RWTH_EXAMPLES='+JSON.stringify(examples)+';\n'
  +'if(typeof module!=="undefined")module.exports={RWTH_EXAMPLES};\n';
fs.writeFileSync(path.join(__dirname,'..','rwth_demo.js'),demo);
console.log('rwth_demo.js',examples.length,'개');
