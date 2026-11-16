import pipe,random,json
from concurrent.futures import ThreadPoolExecutor
random.seed(2050); by={}
for i,r in pipe.INV.items(): by.setdefault(r['municipality'],[]).append(i)
tr,te=[],[]
for m,l in sorted(by.items()):
    s=random.sample(sorted(l),70); tr+=s[:50]; te+=s[50:]
json.dump({'train':tr,'test':te},open('split.json','w'))
with ThreadPoolExecutor(6) as ex: list(ex.map(pipe.fetch,tr+te))
print('ok',len(tr),len(te))
