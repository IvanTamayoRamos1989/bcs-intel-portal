import pipe,json,numpy as np,joblib,time
from concurrent.futures import ProcessPoolExecutor
from functools import partial
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import classification_report, confusion_matrix
sp=json.load(open('split.json'))
def prep(iid,n=5000,full=False):
    r=pipe.INV[iid]; a,tr,crs=pipe.load(pipe.fetch(iid)); y=pipe.wc_labels(a.shape[1:],tr,crs).ravel()
    X=pipe.feats(a,float(r['resolution_m'])); ok=np.isin(y,pipe.CLS)
    if full: return X[ok],y[ok]
    rng=np.random.default_rng(abs(hash(iid))%2**32); idx=np.flatnonzero(ok)
    idx=rng.choice(idx,min(n,len(idx)),replace=False) if len(idx) else idx
    return X[idx],y[idx]
if __name__=='__main__':
    t=time.time()
    with ProcessPoolExecutor(8) as ex: P=list(ex.map(prep,sp['train']))
    X=np.concatenate([p[0] for p in P]); y=np.concatenate([p[1] for p in P])
    print('train px',len(y),dict(zip(*np.unique(y,return_counts=True))),time.time()-t,flush=True)
    u,c=np.unique(y,return_counts=True); w=dict(zip(u,(c.max()/c)**0.3)); sw=np.array([w[v] for v in y])
    m=HistGradientBoostingClassifier(max_iter=300,learning_rate=0.1,max_leaf_nodes=63,random_state=0)
    m.fit(X,y,sample_weight=sw); joblib.dump(m,'model_hgb.joblib'); print('fit',time.time()-t,flush=True)
    with ProcessPoolExecutor(8) as ex: Q=list(ex.map(partial(prep,full=True),sp['test']))
    Xt=np.concatenate([q[0] for q in Q]); yt=np.concatenate([q[1] for q in Q])
    pr=m.predict(Xt); print('test px',len(yt),'acc',(pr==yt).mean())
    rep=classification_report(yt,pr,output_dict=True,zero_division=0); print(classification_report(yt,pr,zero_division=0,digits=3))
    labs=sorted(set(yt)|set(pr)); cm=confusion_matrix(yt,pr,labels=labs)
    iou={int(l):float(cm[i,i]/(cm[i].sum()+cm[:,i].sum()-cm[i,i])) for i,l in enumerate(labs)}
    print('IoU',iou)
    json.dump({'test_pixels':int(len(yt)),'test_images':len(sp['test']),'train_images':len(sp['train']),'accuracy':float((pr==yt).mean()),'macro_f1':rep['macro avg']['f1-score'],'per_class':{k:{'f1':v['f1-score'],'precision':v['precision'],'recall':v['recall'],'support':v['support']} for k,v in rep.items() if k.isdigit()},'iou':iou},open('eval.json','w'),indent=1)
