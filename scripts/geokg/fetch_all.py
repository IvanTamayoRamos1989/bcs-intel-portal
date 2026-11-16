import s2,sys,json,os,numpy as np,time
from concurrent.futures import ThreadPoolExecutor
ids=sorted(s2.pipe.INV)
done=set()
if os.path.exists('out/records_v2.jsonl'): done={json.loads(l)['id'] for l in open('out/records_v2.jsonl') if l.strip()}
ids=[i for i in ids if i not in done]
def one(i):
    p=f'bands/{i}.npz'
    if os.path.exists(p): return 0
    for k in range(3):
        try:
            B,tr,crs=s2.bands(i); np.savez_compressed(p+'.tmp.npz',b=B.astype(np.float16),tr=np.array(tr)[:6],crs=crs); os.rename(p+'.tmp.npz',p); return 1
        except Exception as e: err=e; time.sleep(3)
    print('ERR',i,repr(err),flush=True); return 0
# prefetch STAC items serially (cached)
for i in ids:
    s2.item(s2.pipe.INV[i]['scene_id'],s2.pipe.INV[i]['source_stac_url'])
s2.save_items()
with ThreadPoolExecutor(16) as ex: n=sum(ex.map(one,ids))
print('fetched',n)
