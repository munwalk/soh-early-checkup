"""verify_rwth.py — RWTH 예측을 Python(numpy)으로 따로 계산해서 웹(JavaScript) 엔진과 비교해요.

JavaScript 두 개(팀원 index.html, rwth_engine.js)가 같은 식을 쓰는지만 보면 같은 실수를 같이 할 수 있어서,
CSV 읽기부터 특징 만들기·표준화·Ridge 계산까지 numpy로 다시 짰어요.
  - 특징: 앞 n행 × [V, I, dQ, dE, temp] time-major (설정 JSON의 feature_order)
  - 예측: intercept + Σ coef·(x − mean)/scale  (sklearn StandardScaler + Ridge와 같은 식)
원본 학습 파이프라인 값은 independent_test_trace.csv의 확정 예측값(sample_135, 1분)으로만 확인할 수 있어요.

실행: py -3.13 frontend_v3/tools/verify_rwth.py   (battery-grader 폴더에서, node 필요)
"""
import csv
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "rwth_ridge_web"
TOOLS = Path(__file__).resolve().parent
COLS = ["time_s", "voltage_V", "current_A", "charge_Ah", "energy_Wh", "temperature_C"]
TRACE = {"cell_10_sample_135.csv": (1, 81.52369689941406)}  # independent_test_trace.csv, α=5%

cfg = json.loads((SRC / "rwth_web_independent_validated_config.json").read_text(encoding="utf-8"))
labels = list(csv.DictReader((TOOLS.parent / "demo_rwth" / "labels_NOT_WEB_INPUT.csv").open(encoding="utf-8")))


def load(path: Path, dq: float = 0.0, de: float = 0.0) -> np.ndarray:
    with path.open(encoding="utf-8") as f:
        r = csv.DictReader(f)
        x = np.array([[float(row[c]) for c in COLS] for row in r], dtype=np.float64)
    x[:, 3] += dq
    x[:, 4] += de
    x[:, 3] -= x[0, 3]  # 충전 시작 기준 변화량 (웹과 같은 보정)
    x[:, 4] -= x[0, 4]
    return x


def predict(x: np.ndarray, t: int) -> float:
    m = cfg["models"][str(t)]
    n = t * 60 // cfg["input"]["dt_s"] + 1
    feat = x[:n, 1:].reshape(-1)  # time_s를 빼고 행 순서대로 펼침
    z = (feat - np.asarray(m["mean"])) / np.asarray(m["scale"])
    return float(m["intercept"] + z @ np.asarray(m["coef"]))


js = r"""
const R=require('./frontend_v3/rwth_engine.js'),{RWTH_CFG:C,RWTH_MODELS:M}=require('./frontend_v3/rwth_model.js'),fs=require('fs');
const out={};for(const f of process.argv.slice(1)){const c=R.parse(fs.readFileSync(f,'utf8'));out[f]=C.stages.map(t=>R.predictStage(M,t,c));}
console.log(JSON.stringify(out));
"""
files = [str(SRC / row["file"]) for row in labels]
web = json.loads(subprocess.run(["node", "-e", js, *files], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True).stdout)

bad, max_diff = 0, 0.0
for row, f in zip(labels, files):
    x = load(Path(f))
    py = [predict(x, t) for t in cfg["stages_min"]]
    diff = max(abs(a - b) for a, b in zip(py, web[f]))
    shifted = load(Path(f), dq=1.234, de=4.567)
    shift_diff = max(abs(predict(shifted, t) - p) for t, p in zip(cfg["stages_min"], py))
    max_diff = max(max_diff, diff, shift_diff)
    line = f"{row['file']:<24} Python {' '.join(f'{p:.5f}' for p in py)} | 웹과 최대 차이 {diff:.1e} | 오프셋 CSV 차이 {shift_diff:.1e}"
    if row["file"] in TRACE:
        t, ref = TRACE[row["file"]]
        e = abs(py[cfg["stages_min"].index(t)] - ref)
        line += f" | 원본 trace {t}분 {ref:.5f} 차이 {e:.1e}"
        bad += e > 1e-3
    print(line)
bad += max_diff > 1e-9
print("모두 일치" if not bad else f"불일치 {bad}건")
sys.exit(1 if bad else 0)
