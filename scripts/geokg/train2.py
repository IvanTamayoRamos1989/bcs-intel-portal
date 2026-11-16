import pipe,feat2,json,numpy as np,joblib,time,sys
from concurrent.futures import ProcessPoolExecutor
from functools import partial
from affine import Affine
from rasterio.warp import transform_bounds
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import classification_report, confusion_matrix
sp=json.load(open('split.json'))
def labels(iid):
    z=np.load(f'bands/{iid}.npz'); B=z['b'].astype(np.float32); tr=Affine(*z['tr']); crs=str(z['crs']); h,w=B.shape[1:]
    wc=pipe.wc_labels((h,w),tr,crs)
    lb=transform_bounds(crs,'EPSG:4326',tr.c,tr.f+tr.e*h,tr.c+tr.a*w,tr.f)
    g=feat2.gmw_labels((h,w),tr,crs,lb)
    ok=np.isfinite(B).all(0)&(B[0]>0)
    return B,wc,g,ok
def prep(iid,mode,n=5000,full=False):
    B,wc,g,ok=labels(iid); r=pipe.INV[iid]
    y=wc.copy()
    if mode=='gmw': y[g]=95
    X=feat2.feats2(B,float(r['resolution_m'])); y=y.ravel(); m=(np.isin(y,pipe.CLS)&ok.ravel())
    if full: return X[m],y[m],wc.ravel()[m]
    idx=np.flatnonzero(m); rng=np.random.default_rng(abs(hash(iid))%2**32)
    idx=rng.choice(idx,min(n,len(idx)),replace=False) if len(idx) else idx
    return X[idx],y[idx],None
def report(yt,pr):
    rep=classification_report(yt,pr,output_dict=True,zero_division=0); labs=sorted(set(yt)|set(pr)); cm=confusion_matrix(yt,pr,labels=labs)
    iou={str(l):float(cm[i,i]/max(1,(cm[i].sum()+cm[:,i].sum()-cm[i,i]))) for i,l in enumerate(labs)}
    return {'accuracy':float((pr==yt).mean()),'macro_f1':rep['macro avg']['f1-score'],'per_class':{k:{'f1':v['f1-score'],'precision':v['precision'],'recall':v['recall'],'support':v['support']} for k,v in rep.items() if k.isdigit()},'iou':iou}
if __name__=='__main__':
    mode=sys.argv[1]; t=time.time()
    with ProcessPoolExecutor(8) as ex: P=list(ex.map(partial(prep,mode=mode),sp['train']))
    X=np.concatenate([p[0] for p in P]); y=np.concatenate([p[1] for p in P])
    u,c=np.unique(y,return_counts=True); w=dict(zip(u,(c.max()/c)**0.3)); sw=np.array([w[v] for v in y])
    m=HistGradientBoostingClassifier(max_iter=300,learning_rate=0.1,max_leaf_nodes=63,random_state=0).fit(X,y,sample_weight=sw)
    joblib.dump(m,f'model_v2_{mode}.joblib'); print('fit',round(time.time()-t),flush=True)
    with ProcessPoolExecutor(8) as ex: Q=list(ex.map(partial(prep,mode=mode,full=True),sp['test']))
    Xt=np.concatenate([q[0] for q in Q]); yt=np.concatenate([q[1] for q in Q]); ywc=np.concatenate([q[2] for q in Q])
    pr=m.predict(Xt)
    res={'vs_wc2021':report(ywc,pr),'vs_training_labels':report(yt,pr),'test_pixels':int(len(yt))}
    json.dump(res,open(f'eval_v2_{mode}.json','w'),indent=1)
    r=res['vs_wc2021']; print(mode,'acc',round(r['accuracy'],3),'mF1',round(r['macro_f1'],3),{k:round(v['f1'],3) for k,v in r['per_class'].items()})
    if mode=='gmw': r=res['vs_training_labels']; print('vs WC+GMW acc',round(r['accuracy'],3),{k:round(v['f1'],3) for k,v in r['per_class'].items()})
