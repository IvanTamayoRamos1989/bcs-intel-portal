import pipe,feat2,json,os,sys,numpy as np,joblib,math,time,traceback
from scipy import ndimage as ndi
from rasterio.warp import transform as wtransform
from concurrent.futures import ProcessPoolExecutor, as_completed
M=None; CLS=np.array(pipe.CLS); NAMES=pipe.WC
def init():
    global M; M=joblib.load('/workspace/geokg/model_v2.joblib')
def run(iid, keep=False):
    r=pipe.INV[iid]; p=f'/workspace/geokg/bands/{iid}.npz'
    from affine import Affine
    z=np.load(p); B=z['b'].astype(np.float32); tr=Affine(*z['tr']); crs=str(z['crs']); h,w=B.shape[1:]; px=abs(tr.a); pa=px*px/1e6
    valid=np.isfinite(B).all(0)&(np.nan_to_num(B[0])>0)
    P=M.predict_proba(feat2.feats2(B,float(r['resolution_m']))).reshape(h,w,-1)
    P=np.stack([ndi.uniform_filter(P[...,k],3) for k in range(P.shape[-1])],-1)
    k=P.argmax(-1); conf=P.max(-1); lab=M.classes_[k]; lab=np.where(valid,lab,0)
    wc=pipe.wc_labels((h,w),tr,crs); ok=np.isin(wc,pipe.CLS)&valid
    agree=float((wc[ok]==lab[ok]).mean()) if ok.any() else None
    fr={}; cf={}
    for c in pipe.CLS:
        m=lab==c; n=int(m.sum())
        if n/max(1,valid.sum())>=0.0005: fr[NAMES[c]]=round(n/max(1,valid.sum()),4); cf[NAMES[c]]=round(float(conf[m].mean()),3)
    minpx=max(20,int(0.02/pa))
    Lw,nw=ndi.label(lab==80)
    if nw:
        aw=ndi.sum_labels(np.ones_like(Lw),Lw,index=np.arange(1,nw+1)); water=np.isin(Lw,np.flatnonzero(aw>=minpx)+1)
    else: water=lab==80
    coast_px=int((water[:,1:]!=water[:,:-1]).sum()+(water[1:]!=water[:-1]).sum())
    def lonlat(rr,cc):
        x,y=tr*(cc+0.5,rr+0.5); lo,la=wtransform(crs,'EPSG:4326',[x],[y]); return [round(lo[0],5),round(la[0],5)]
    # objects: connected components
    cand=[]
    minpx=max(20,int(0.02/pa))  # >=0.02 km2 (2 ha)
    for c in pipe.CLS:
        L,n=ndi.label(lab==c,structure=np.ones((3,3)))
        if not n: continue
        areas=ndi.sum_labels(np.ones_like(L),L,index=np.arange(1,n+1))
        for j in np.argsort(-areas)[:4]:
            if areas[j]>=minpx: cand.append((float(areas[j]),c,L,j+1))
    cand.sort(key=lambda t:-t[0]); per={}
    kept=[]
    for t in cand:
        if len(kept)>=16: break
        kept.append(t)
    O=np.zeros((h,w),np.int16); objs=[]
    for n,(ar,c,L,j) in enumerate(kept,1):
        m=L==j; O[m]=n; rr,cc=np.nonzero(m)
        edge=bool(rr.min()==0 or cc.min()==0 or rr.max()==h-1 or cc.max()==w-1)
        objs.append({'id':f'{iid}#o{n}','class':NAMES[c],'area_km2':round(ar*pa,3),'frac':round(ar/lab.size,4),
          'centroid':lonlat(rr.mean(),cc.mean()),'conf':round(float(conf[m].mean()),3),'touches_frame_edge':edge})
    rels=[]; sl=ndi.find_objects(O); cent=[]
    for n,o in enumerate(objs,1):
        rr,cc=np.nonzero(O==n); cent.append((rr.mean(),cc.mean()))
    adj=set()
    for n,o in enumerate(objs,1):
        s=sl[n-1]; s=(slice(max(0,s[0].start-1),s[0].stop+1),slice(max(0,s[1].start-1),s[1].stop+1))
        m=O[s]==n; d=ndi.binary_dilation(m,np.ones((3,3)))
        for q in np.unique(O[s][d&~m]):
            if q and q!=n: adj.add(tuple(sorted((n,int(q)))))
        f=ndi.binary_fill_holes(m)
        for q in np.unique(O[s][f&~m]):
            if q and q!=n and (O[s][f]==q).sum()>=0.95*(O==q).sum(): rels.append([o['id'],'contains',objs[q-1]['id']])
    for a_,b_ in sorted(adj):
        ca,cb=objs[a_-1]['class'],objs[b_-1]['class']
        if (ca=='agua')!=(cb=='agua'):
            land,wat=(a_,b_) if cb=='agua' else (b_,a_); rels.append([objs[land-1]['id'],'along_coast',objs[wat-1]['id']])
        else: rels.append([objs[a_-1]['id'],'adjacent_to',objs[b_-1]['id']])
    for a_ in range(len(objs)):
        for b_ in range(a_+1,len(objs)):
            if tuple(sorted((a_+1,b_+1))) in adj: continue
            dkm=math.hypot(cent[a_][0]-cent[b_][0],cent[a_][1]-cent[b_][1])*px/1000
            if dkm<=1.0: rels.append([objs[a_]['id'],'near',objs[b_]['id'],round(dkm,2)])
    rec={'id':iid,'municipio':r['municipality'],'place':r['nearest_place'],'place_km':float(r['nearest_place_km'] or 0),
      'aquifers':r['aquifers'],'theme':r['theme'],'scale':r['scale_class'],'date':r['acquisition'][:10],'res_m':px,
      'width_km':float(r['width_km']),'center':[round(float(r['centre_longitude']),5),round(float(r['centre_latitude']),5)],
      'area_km2':round(lab.size*pa,3),'class_frac':fr,'class_conf':cf,'mean_conf':round(float(conf.mean()),3),
      'coastline_km':round(coast_px*px/1000,2),'agreement_wc2021':None if agree is None else round(agree,3),
      'objects':objs,'relations':rels}
    rec['valid_frac']=round(float(valid.mean()),4); rec['model']='BCS-S2MS-LandCover v2'
    if not keep and os.path.exists(p): os.remove(p)
    return rec
if __name__=='__main__':
    out=sys.argv[1]; t=time.time(); n=0
    keep=set(); done=set()
    if os.path.exists(out):
        good=[]
        for l in open(out):
            try: done.add(json.loads(l)['id']); good.append(l if l.endswith('\n') else l+'\n')
            except Exception: pass
        open(out,'w').writelines(good)
    todo=set(pipe.INV)-done; idle=0
    with ProcessPoolExecutor(8,initializer=init) as ex, open(out,'a') as f:
        while todo and idle<120:
            avail=[i for i in sorted(todo) if os.path.exists(f'/workspace/geokg/bands/{i}.npz')][:400]
            if not avail: idle+=1; time.sleep(10); continue
            idle=0
            fs={ex.submit(run,i,False):i for i in avail}
            for fu in as_completed(fs):
                todo.discard(fs[fu])
                try: f.write(json.dumps(fu.result(),ensure_ascii=False)+'\n'); f.flush(); n+=1
                except Exception as e: print('ERR',fs[fu],repr(e),flush=True)
            print(n,len(todo),round(time.time()-t),flush=True)
    print('done',n,round(time.time()-t))
