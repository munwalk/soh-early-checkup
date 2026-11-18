/* build_sdu_model.js — SDU 배포 JSON(59MB, LightGBM dump)을 브라우저용 sdu_model.js로 압축해요.
   실행: node frontend_v5/tools/build_sdu_model.js   (battery-grader 폴더에서)
   트리는 노드 배열로 펼쳐요: f=분기 특징 번호(잎이면 -1), t=분기값(잎이면 잎 값), l/r=자식 번호. 잎 값에는 shrinkage가 이미 들어 있어요. */
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..','..'),SRC=path.join(ROOT,'sdu_data','SDU_WEB_FINAL_9to12_WITH_TREES.json');
const DEMO=path.join(ROOT,'sdu_data','SDU_REAL_HELDOUT_DEMO_10FILES');
const d=JSON.parse(fs.readFileSync(SRC,'utf8'));

function flat(node){const T={f:[],t:[],l:[],r:[]};
  (function walk(n){const i=T.f.length;T.f.push(-1);T.t.push(0);T.l.push(0);T.r.push(0);
    if('split_index' in n){
      if(n.decision_type!=='<='||n.missing_type!=='None')throw new Error('지원하지 않는 분기: '+n.decision_type+'/'+n.missing_type);
      T.f[i]=n.split_feature;T.t[i]=n.threshold;T.l[i]=walk(n.left_child);T.r[i]=walk(n.right_child);}
    else T.t[i]=n.leaf_value;
    return i;})(node);
  return T;}

const models={};
for(const st of d.stages_min){const m=d.models[String(st)];
  if(m.aggregation!=='mean_of_5'||m.clip!=null||m.n_points!==st*6)throw new Error('예상과 다른 모델 설정: '+st);
  models[st]=m.trees.map(b=>{if(b.num_tree_per_iteration!==1||b.average_output)throw new Error('예상과 다른 부스팅 설정');
    return b.tree_info.map(ti=>flat(ti.tree_structure));});}

/* v4: 정밀검사 시간을 배포 JSON의 120분 가정 대신 SDU 실제 완전 충·방전 시간 365분(충전 134 + 휴지 30 + 방전 201)으로 바꿔요.
   정밀검사로 간 샘플만 시간이 (60+120) → (60+365)로 늘어나므로 평균 시간 = 원래 평균 + 정밀검사 비율 × 245분으로 정확히 다시 셀 수 있어요. */
const FULL=365,F0=d.full_test_additional_min;
if(F0!==120)throw new Error('배포 JSON의 정밀검사 시간이 120분이 아니에요: '+F0);
const remin=(mean,precise)=>mean+precise*(FULL-F0);
const cfg={
  stages:d.stages_min,q:d.q_t,lambda:d.lambda_by_alpha,fullTestMin:FULL,bounds:d.bounds,
  alphas:d.alpha_ui.supported_alpha,defaultAlpha:d.alpha_ui.default_alpha,alphaMessage:d.alpha_ui.message,
  alphaTable:d.alpha_table.map(a=>({alpha:a.alpha,lambda:a.lambda,rep500:{misgrade:a.actual_misgrade,precise:a.precise_rate,minutes:remin(a.mean_time_min,a.precise_rate)},
    test:{cells:a.independent_test.n_cells,samples:a.independent_test.n_samples,misgrade:a.independent_test.actual_misgrade,precise:a.independent_test.precise_rate,minutes:remin(a.independent_test.mean_time_min,a.independent_test.precise_rate)}})),
  coverage:d.pi_coverage.overall_by_stage,coverageWorst:d.pi_coverage.worst_cell_by_stage,
  misgradeByDistance:d.misgrade_by_distance,headline:d.headline_metric,trust:d.ui_text.trust,supported:d.ui_text.supported,
  socRange:d.soh_range.eval,cells:{train:d.cell_split.train.length,shape:d.cell_split.shape.length,calibration:d.cell_split.calibration.length,test:d.cell_split.test.length},
};

/* 시연 CSV 10개: 정답은 LABELS_NOT_WEB_INPUT.csv에서 따로 붙여요(모델 입력에는 안 들어가요). */
const lab=fs.readFileSync(path.join(DEMO,'LABELS_NOT_WEB_INPUT.csv'),'utf8').trim().split(/\r?\n/),hd=lab[0].split(',');
const examples=lab.slice(1).map(line=>{const p=line.split(','),o=Object.fromEntries(hd.map((h,i)=>[h,p[i]]));
  return{name:o.file,csv:fs.readFileSync(path.join(DEMO,o.file),'utf8'),truth:Number(o.actual_SOH),
    ref:{status:o.alpha_10_status,stage:o.alpha_10_stage?Number(o.alpha_10_stage):null,pred:o.alpha_10_pred?Number(o.alpha_10_pred):null}};});

const out='/* sdu_model.js — tools/build_sdu_model.js가 만든 파일이에요. 직접 고치지 마세요. */\n'
  +'const SDU_CFG='+JSON.stringify(cfg)+';\n'
  +'const SDU_MODELS='+JSON.stringify(models)+';\n'
  +'const SDU_EXAMPLES='+JSON.stringify(examples)+';\n'
  +'if(typeof module!=="undefined")module.exports={SDU_CFG,SDU_MODELS,SDU_EXAMPLES};\n';
fs.writeFileSync(path.join(__dirname,'..','sdu_model.js'),out);
console.log('sdu_model.js',(out.length/1e6).toFixed(2),'MB');
