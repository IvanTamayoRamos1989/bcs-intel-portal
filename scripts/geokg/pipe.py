import csv, json, os, sys, time, random, subprocess, math
import numpy as np, rasterio
from rasterio.warp import reproject, Resampling, transform as wtransform
from scipy import ndimage as ndi
os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN','EMPTY_DIR')
os.environ.setdefault('CPL_VSIL_CURL_ALLOWED_EXTENSIONS','.tif')
os.environ.setdefault('GDAL_CACHEMAX','512')
W=os.environ.get('GEOKG_WORK','/workspace/geokg')
INV={r['id']:r for r in csv.DictReader(open(f'{W}/inventario_10000.csv',encoding='utf-8-sig'))}
IDX={}
for l in open(f'{W}/tif_index.txt'):
    m,n,fid=l.split(); IDX[n.rsplit('_',1)[0]]=(m,n,fid)
WC={10:'arbolado',20:'matorral',30:'pastizal',40:'cultivo',50:'urbano_construido',60:'suelo_desnudo',80:'agua',90:'humedal',95:'manglar'}
CLS=[10,20,30,40,50,60,80,90,95]
def wc_url(lat,lon):
    la=int(math.floor(lat/3)*3); lo=int(math.floor(lon/3)*3)
    return f"/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{'N' if la>=0 else 'S'}{abs(la):02d}{'E' if lo>=0 else 'W'}{abs(lo):03d}_Map.tif"
def fetch(iid):
    m,n,fid=IDX[iid]; p=f'{W}/tif/{n}'
    if not os.path.exists(p):
        for k in range(4):
            r=subprocess.run(['curl','-sfL','-o',p+'.part',f'https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t'])
            if r.returncode==0 and os.path.getsize(p+'.part')>1000: os.rename(p+'.part',p); break
            time.sleep(3*(k+1))
        else: raise RuntimeError('download failed '+iid)
    return p
def load(p, maxside=512):
    s=rasterio.open(p); a=s.read().astype(np.float32); tr=s.transform; crs=s.crs
    f=max(1,int(math.ceil(max(a.shape[1:])/maxside)))
    if f>1:
        h=a.shape[1]//f*f; w=a.shape[2]//f*f
        a=a[:,:h,:w].reshape(3,h//f,f,w//f,f).mean((2,4)); tr=tr*rasterio.Affine.scale(f)
    return a,tr,crs
def wc_labels(shape,tr,crs):
    dst=np.zeros(shape,np.uint8); h,w=shape
    xs=[tr.c, tr.c+tr.a*w]; ys=[tr.f, tr.f+tr.e*h]
    lon,lat=wtransform(crs,'EPSG:4326',[xs[0],xs[1],xs[0],xs[1]],[ys[0],ys[0],ys[1],ys[1]])
    urls={wc_url(la,lo) for la in (min(lat),max(lat)) for lo in (min(lon),max(lon))}
    for u in urls:
        try:
            with rasterio.open(u) as s:
                tmp=np.zeros(shape,np.uint8)
                reproject(rasterio.band(s,1),tmp,dst_transform=tr,dst_crs=crs,resampling=Resampling.mode)
                dst[dst==0]=tmp[dst==0]
        except Exception as e: pass
    return dst
def feats(a,res):
    R,G,B=a/255.0; V=a.max(0)/255; mn=a.min(0)/255; S=np.where(V>0,(V-mn)/np.maximum(V,1e-6),0)
    L=(R+G+B)/3; eps=1e-3
    F=[R,G,B,V,S,(G-R)/(G+R+eps),(B-R)/(B+R+eps),(G-B)/(G+B+eps)]
    for k in (5,15,31):
        m=ndi.uniform_filter(L,k); sd=np.sqrt(np.maximum(ndi.uniform_filter(L*L,k)-m*m,0))
        F+= [m,sd]+[ndi.uniform_filter(c,k) for c in (R,G,B)]
    gm=np.hypot(ndi.sobel(L,0),ndi.sobel(L,1)); F+=[gm,ndi.uniform_filter(gm,9),np.full_like(R,float(res))]
    return np.stack(F,-1).reshape(-1,len(F)).astype(np.float32)
