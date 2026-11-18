"""check_native_vs_dump.py — trace와 배포 JSON 예측이 왜 다른지 가르는 확인용 스크립트예요. (웹 엔진과 무관)

노트북(SDU_LTT_alpha5_12_final_500.ipynb 셀 11)에서 홀드아웃 예측(p_hold, trace 쪽)은 LightGBM의 m.predict()로,
배포 JSON은 같은 모델의 booster_.dump_model()로 만들어요. 이 스크립트는 노트북과 같은 설정으로 5분 모델을 한 번 학습한 뒤,
같은 모델에서 ① m.predict() 와 ② dump_model() 트리를 직접 따라간 값이 같은지 홀드아웃 1,729건으로 비교해요.

  ①=② 이면 → LightGBM 예측 경로 차이는 아니에요. trace는 배포 JSON과 다른 학습 실행(다른 모델)에서 나온 거예요.
             (n_jobs=-1, deterministic 미지정이라 다시 학습하면 트리가 조금씩 달라질 수 있어요)
  ①≠② 이면 → 같은 모델이라도 m.predict()와 JSON 트리 탐색이 달라요. 웹(=JSON)과 trace(=m.predict) 차이가 이것으로 설명돼요.
그리고 같은 설정으로 두 번 학습해서 트리가 똑같이 나오는지(재현성)도 확인해요.

실행 (Colab, 노트북과 같은 DATA 폴더):
  python check_native_vs_dump.py --data /content/drive/MyDrive/SDU_dataset --deploy sdu_data/SDU_WEB_FINAL_9to12_WITH_TREES.json
"""
import argparse, json
import numpy as np, pandas as pd, lightgbm as lgb


def hand_features(x):                       # 노트북 셀 5 그대로
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


def fit5(x, y, seed):                       # 노트북 model_fit(kind='lgbm') 그대로
    return [lgb.LGBMRegressor(n_estimators=600, learning_rate=.03, num_leaves=15, min_child_samples=10, subsample=.8,
                              subsample_freq=1, colsample_bytree=.8, random_state=seed+j, verbose=-1, n_jobs=-1).fit(x, y)
            for j in range(5)]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--data', required=True); ap.add_argument('--deploy', required=True)
    ap.add_argument('--stage', type=int, default=5); a = ap.parse_args()
    X = np.load(f'{a.data}/X_curve.npy', mmap_mode='r')
    M = pd.read_parquet(f'{a.data}/samples.parquet').sort_values('sample_id').reset_index(drop=True)
    D = json.load(open(a.deploy, encoding='utf-8'))
    Y = M.soh.to_numpy(float); BID = M.bid.to_numpy(); ok = M.soh.between(48, 83, inclusive='both').to_numpy()
    TR = np.flatnonzero(ok & np.isin(BID, D['train_cells'])); HO = np.flatnonzero(ok & np.isin(BID, D['test_cells']))
    T = a.stage; k = T*6; SEED = 20261028
    xt, xh = hand_features(X[TR, :k, :]), hand_features(X[HO, :k, :])
    ms = fit5(xt, Y[TR], SEED+100000+T*31)    # 노트북 stage_train_predictions의 seed 규칙
    native = np.mean([m.predict(xh) for m in ms], axis=0)
    dumps = [m.booster_.dump_model()['tree_info'] for m in ms]
    walked = np.array([np.mean([sum(walk(t['tree_structure'], f) for t in tr) for tr in dumps]) for f in xh.astype(float)])
    d = np.abs(native - walked)
    print(f'[{T}분] 같은 모델: m.predict() vs dump 트리 탐색 → 최대 차이 {d.max():.3e}, 1e-6 넘는 건 {int((d>1e-6).sum())}/{len(d)}')
    ms2 = fit5(xt, Y[TR], SEED+100000+T*31)
    native2 = np.mean([m.predict(xh) for m in ms2], axis=0); d2 = np.abs(native - native2)
    print(f'[{T}분] 같은 설정 두 번 학습: 예측 최대 차이 {d2.max():.3e}, 1e-6 넘는 건 {int((d2>1e-6).sum())}/{len(d2)}')
    deployed = [b['tree_info'] for b in D['models'][str(T)]['trees']]
    dep = np.array([np.mean([sum(walk(t['tree_structure'], f) for t in tr) for tr in deployed]) for f in xh.astype(float)])
    d3 = np.abs(native - dep)
    print(f'[{T}분] 지금 학습한 모델 vs 배포 JSON: 최대 차이 {d3.max():.3e}, 1e-6 넘는 건 {int((d3>1e-6).sum())}/{len(d3)}')
    print(f'lightgbm {lgb.__version__} · numpy {np.__version__}')


if __name__ == '__main__':
    main()
