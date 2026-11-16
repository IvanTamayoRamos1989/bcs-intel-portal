import os, json, math, time, threading, urllib.request
import numpy as np, rasterio
from rasterio.windows import from_bounds
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling
from rasterio.warp import transform as wtransform
from affine import Affine
import pipe
os.environ.update(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_MAX_RETRY='4', GDAL_HTTP_RETRY_DELAY='2', VSI_CACHE='FALSE')
W=pipe.W; BANDS=['B02','B03','B04','B08','B11','B12']
_tok={'t':None,'exp':0}; _lk=threading.Lock()
def token():
    with _lk:
        if time.time()>_tok['exp']-300:
            d=json.load(urllib.request.urlopen('https://planetarycomputer.microsoft.com/api/sas/v1/token/sentinel2l2a01/sentinel2-l2'))
            _tok['t']=d['token']; _tok['exp']=time.time()+2400
        return _tok['t']
ITEMS_P=f'{W}/stac_items.json'
ITEMS=json.load(open(ITEMS_P)) if os.path.exists(ITEMS_P) else {}
def item(scene, url):
    if scene not in ITEMS:
        d=json.load(urllib.request.urlopen(url))
        ITEMS[scene]={'hrefs':{b:d['assets'][b]['href'] for b in BANDS},'baseline':d['properties'].get('s2:processing_baseline'),
                      'epsg':d['properties'].get('proj:epsg') or int(str(d['properties'].get('proj:code','0')).split(':')[-1])}
    return ITEMS[scene]
def grid(r):
    res=float(r['resolution_m']); w=int(r['width']); h=int(r['height']); epsg=int(r['epsg'])
    x,y=wtransform('EPSG:4326',f'EPSG:{epsg}',[float(r['centre_longitude'])],[float(r['centre_latitude'])])
    x0=round((x[0]-w*res/2)/10)*10; y1=round((y[0]+h*res/2)/10)*10
    tr=Affine(res,0,x0,0,-res,y1)
    f=max(1,int(math.ceil(max(h,w)/512)))
    if f>1: h,w=h//f,w//f; tr=tr*Affine.scale(f)
    return tr,(h,w),epsg
def bands(iid):
    r=pipe.INV[iid]; it=item(r['scene_id'],r['source_stac_url']); tr,(h,w),epsg=grid(r)
    off=1000 if float(it['baseline'] or 0)>=4 else 0
    b=tr.c, tr.f+tr.e*h, tr.c+tr.a*w, tr.f
    out=np.zeros((len(BANDS),h,w),np.float32); tok=token()
    for k,bn in enumerate(BANDS):
        with rasterio.open('/vsicurl/'+it['hrefs'][bn]+'?'+tok) as s:
            src=s if s.crs.to_epsg()==epsg else WarpedVRT(s,crs=f'EPSG:{epsg}',resampling=Resampling.bilinear)
            win=from_bounds(*b,transform=src.transform)
            a=src.read(1,window=win,out_shape=(h,w),resampling=Resampling.average if src.res[0]<tr.a else Resampling.bilinear,boundless=True,fill_value=0).astype(np.float32)
        out[k]=np.where(a>0,(a-off)/10000.0,np.nan)
    return out,tr,f'EPSG:{epsg}'
def save_items(): json.dump(ITEMS,open(ITEMS_P,'w'))
