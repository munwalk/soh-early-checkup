"""dump_py_features.py — SDU 불일치 원인 진단용 Python 기준값을 만들어요.

hand_features는 SDU_LTT_alpha5_12_final_500.ipynb(셀 5)를 한 글자도 바꾸지 않고 옮겼어요.
배포 JSON(SDU_WEB_FINAL_9to12_WITH_TREES.json)의 트리를 Python으로 직접 따라가 예측값도 같이 적어요.
LightGBM은 필요 없고 numpy만 있으면 돼요.

실행 (battery-grader 폴더에서):
  python frontend_v3/tools/dump_py_features.py --npy X_curve.npy \
      --trees sdu_data/SDU_WEB_FINAL_9to12_WITH_TREES.json \
      --ids sdu_data/sdu_holdout_mismatch.csv --out py_features.csv
  --ids 에는 sample_id 열이 있는 CSV(불일치 목록 또는 trace)를 주면 돼요. 전체 1,729건도 돼요.
결과 CSV 열: sample_id, stage, pred_json, f0..f65  → verify_sdu_holdout.js --py-features 로 비교해요.
"""
import argparse, csv, json
import numpy as np


def hand_features(x):
    x=np.asarray(x, dtype=np.float32)
    N,L,Cn=x.shape; feats=[]; loc=np.linspace(0,L-1,5).astype(int)
    for j in range(Cn):
        a=x[:,:,j]
        feats.extend([a[:,0],a[:,-1],a.mean(1),a.std(1),a.min(1),a.max(1),(a[:,-1]-a[:,0])/max(L-1,1)])
        feats.extend([a[:,i] for i in loc[1:-1]])
        if L>2:
            d=np.diff(a,axis=1)
            feats.extend([d.mean(1),d.std(1),np.abs(d).max(1)])
    curr=x[:,:,1]
    below=np.abs(curr)<0.95*np.abs(curr).max(1,keepdims=True)
    feats.append(np.where(below.any(1),below.argmax(1),L).astype(float))
    return np.stack(feats,1).astype(np.float32)


def walk(node, f):
    while 'split_index' in node:
        node = node['left_child'] if f[node['split_feature']] <= node['threshold'] else node['right_child']
    return node['leaf_value']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--npy', required=True); ap.add_argument('--trees', required=True)
    ap.add_argument('--ids', required=True); ap.add_argument('--out', required=True)
    a = ap.parse_args()
    X = np.load(a.npy, mmap_mode='r')
    D = json.load(open(a.trees, encoding='utf-8'))
    with open(a.ids, encoding='utf-8-sig') as fh:
        ids = sorted({int(r['sample_id']) for r in csv.DictReader(fh)})
    ids = np.array(ids)
    rows = []
    for T in D['stages_min']:
        # 노트북과 같게: X[HOLD,:T*6,:] 를 한 번에 넣어요 (여러 행을 함께 넣어도 행별 결과는 같아야 해요)
        F = hand_features(X[ids, :T*6, :])
        forests = [b['tree_info'] for b in D['models'][str(T)]['trees']]
        for k, sid in enumerate(ids):
            f = F[k].astype(float)            # LightGBM도 float32 입력을 double로 바꿔 비교해요
            p = np.mean([sum(walk(t['tree_structure'], f) for t in forest) for forest in forests])
            rows.append([int(sid), T, repr(float(p))] + [repr(float(v)) for v in f])
    with open(a.out, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh); w.writerow(['sample_id','stage','pred_json'] + [f'f{i}' for i in range(66)]); w.writerows(rows)
    print(f'{len(ids)}건 × {len(D["stages_min"])}단계 → {a.out}  (numpy {np.__version__})')


if __name__ == '__main__':
    main()
