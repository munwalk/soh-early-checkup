/* tools/build_rwth_demo_extra.js (frontend_v5) — rwth_data의 시연용 CSV 4개를 RWTH 예시에 더해요.
   rwth_demo.js(원래 예시 2개)는 그대로 두고, rwth_demo_extra.js가 RWTH_EXAMPLES 뒤에 붙여요.
   고른 기준: A·B·C가 모두 나오게, B 2개는 α 5%에서 30분까지 가는 기록(CELL-0108·0116)으로.
   정답(truth)은 rwth_data/README_정답은_웹_입력_금지.md 표 값이고, 화면 비교용이라 판정에는 안 써요.
   실행: node tools/build_rwth_demo_extra.js (frontend_v5 폴더에서) */
const fs=require('fs'),path=require('path');
const SRC=path.join(__dirname,'..','..','rwth_data');
const PICK=[['CELL-0113.csv',33,471,80.2412],['CELL-0108.csv',18,256,62.7873],['CELL-0116.csv',36,515,60.7444],['CELL-0109.csv',18,257,50.4845]];
const ex=PICK.map(([f,cell,sample,truth])=>({name:`cell_${cell}_sample_${sample}.csv`,cell,sample,truth,inEvalRange:truth>=48&&truth<=83,
  csv:fs.readFileSync(path.join(SRC,f),'utf8').replace(/\r/g,'')}));
fs.writeFileSync(path.join(__dirname,'..','rwth_demo_extra.js'),
  `/* rwth_demo_extra.js — tools/build_rwth_demo_extra.js가 만든 파일이에요. 직접 고치지 마세요. rwth_data에서 고른 RWTH 시연 기록 ${ex.length}개를 예시에 더해요. */\nRWTH_EXAMPLES.push(...${JSON.stringify(ex)});\n`);
console.log('rwth_demo_extra.js',ex.map(x=>x.name).join(', '));
