/* tools/build_misgrade_data.js (frontend_final) — 경계거리별 관측 오판율 실험 결과(data/misgrade_by_distance_web.json)를
   브라우저가 file://에서도 읽을 수 있게 misgrade_data.js로 감싸요. 값은 바꾸지 않아요.
   실행: node tools/build_misgrade_data.js (frontend_final 폴더에서) */
const fs=require('fs'),path=require('path');
const src=path.join(__dirname,'..','data','misgrade_by_distance_web.json'),J=JSON.parse(fs.readFileSync(src,'utf8'));
fs.writeFileSync(path.join(__dirname,'..','misgrade_data.js'),
  `/* misgrade_data.js — tools/build_misgrade_data.js가 data/misgrade_by_distance_web.json에서 만든 파일이에요. 직접 고치지 마세요.\n   셀 단위 5겹 교차검증 예측에 웹의 q(t)·λ를 그대로 적용해, 확정 시점 경계거리 구간별로 센 관측 오판율이에요. */\nconst MISGRADE=${JSON.stringify(J)};\n`);
console.log('misgrade_data.js', J.version, Object.keys(J.rwth.byAlpha).length, Object.keys(J.sdu.byAlpha).length);
