import numpy as np, glob, rasterio
from scipy import ndimage as ndi
from rasterio.warp import reproject, Resampling
GMW=sorted(glob.glob('/workspace/geokg/gmw/gmw_v3_2020/*.tif'))
GB=[(f,rasterio.open(f).bounds) for f in GMW]
def gmw_labels(shape,tr,crs,lonlat_bounds):
    lo0,la0,lo1,la1=lonlat_bounds; out=np.zeros(shape,np.uint8)
    for f,b in GB:
        if b.right<lo0 or b.left>lo1 or b.top<la0 or b.bottom>la1: continue
        with rasterio.open(f) as s:
            t=np.zeros(shape,np.uint8); reproject(rasterio.band(s,1),t,dst_transform=tr,dst_crs=crs,resampling=Resampling.nearest); out|=(t==1)
    return out.astype(bool)
def feats2(B,res):
    B=np.nan_to_num(B.astype(np.float32),nan=0.0)
    b2,b3,b4,b8,b11,b12=B; e=1e-4
    nd=lambda a,b:(a-b)/(a+b+e)
    NDVI=nd(b8,b4); NDWI=nd(b3,b8); MNDWI=nd(b3,b11); NDBI=nd(b11,b8); BSI=((b11+b4)-(b8+b2))/((b11+b4)+(b8+b2)+e)
    F=[b2,b3,b4,b8,b11,b12,NDVI,NDWI,MNDWI,NDBI,BSI,b12/(b11+e)]
    for k in (5,15,31):
        for v in (b8,NDVI,b11):
            m=ndi.uniform_filter(v,k); F.append(m)
        m=ndi.uniform_filter(b4,k); F.append(np.sqrt(np.maximum(ndi.uniform_filter(b4*b4,k)-m*m,0)))
    gm=np.hypot(ndi.sobel(b4,0),ndi.sobel(b4,1)); F+=[gm,ndi.uniform_filter(gm,9),np.full_like(b2,float(res))]
    return np.stack(F,-1).reshape(-1,len(F)).astype(np.float32)
