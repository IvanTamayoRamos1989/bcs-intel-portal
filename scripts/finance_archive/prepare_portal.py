"""Prepare a reviewed, downloaded-only publication snapshot in the current portal.
The complete archive and its pending URLs stay outside the Git repository.
"""
from pathlib import Path
import csv,json,shutil,sqlite3,re
import export_catalog
ROOT=export_catalog.ROOT
REPO=Path(__file__).resolve().parents[2]
def build():
 export_catalog.build()
 src=export_catalog.OUT;dest=REPO/'public'/'finanzas-publicas';dest.mkdir(parents=True,exist_ok=True)
 data=json.loads((src/'catalog.json').read_text(encoding='utf-8'))
 data['archived_pages']=sum(r['kind']=='page' and r['status']=='ok' for r in data['records'])
 data['archived_documents']=sum(r['kind']=='document' and r['status']=='ok' for r in data['records'])
 data['scope']+=' La entrega publicada incluye únicamente recursos descargados correctamente; el inventario completo y sus pendientes permanecen en el archivo de trabajo.'
 data['records']=[{k:v for k,v in r.items() if k not in ('local_path','error')} for r in data['records'] if r['status']=='ok']
 db=sqlite3.connect(ROOT/'archive.sqlite')
 excerpts={sha:text for sha,text in db.execute("SELECT sha256,excerpt FROM excerpts WHERE status='text'")}
 # A public entry must expose readable source content, not merely a filename.
 data['records']=[r for r in data['records'] if r['kind']=='document' and r['sha256'] in excerpts]
 for r in data['records']:
  r['excerpt']=excerpts[r['sha256']]
  if re.search(r'\.(pdf|xlsx?|docx?|zip)\b|_',r['title'],re.I):
   r['title']=re.sub(r'\.(pdf|xlsx?|docx?|zip)$','',r['title'],flags=re.I).replace('_',' ').strip()
   if len(r['title'])<5:r['title']=r['category']+' · '+(' / '.join(r['years']) or 'Sin año identificado')
  r['excerpt_method']='Extracto automático de la primera página; no valida importes ni clasificación.'
 data['scope']+=' Esta primera entrega se limita a PDF con texto extraíble; los documentos escaneados y otros formatos siguen en el archivo de trabajo para revisión.'
 # Sort the current budget and reporting years before older material.
 data['records'].sort(key=lambda r:(max(r['years'],default='0000'),r['title']),reverse=True)
 encoded=json.dumps(data,ensure_ascii=False,separators=(',',':'))
 (dest/'catalog.json').write_text(encoded,encoding='utf-8');(dest/'catalog.js').write_text('window.BCS_FINANZAS='+encoded+';',encoding='utf-8')
 with (dest/'catalog.csv').open('w',encoding='utf-8-sig',newline='') as f:
  fields=['id','title','url','category','years','format','status','bytes','sha256','downloaded_at'];w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader()
  for r in data['records']:
   row={**r,'years':';'.join(r['years'])}
   if row['title'].startswith(('=','+','-','@')):row['title']="'"+row['title']
   w.writerow(row)
 budget=json.loads((dest/'budget-2026-q2.json').read_text(encoding='utf-8'));budget.pop('local_path',None)
 (dest/'budget-2026-q2.json').write_text(json.dumps(budget,ensure_ascii=False),encoding='utf-8')
 (dest/'budget.js').write_text('window.BCS_BUDGET='+json.dumps(budget,ensure_ascii=False)+';',encoding='utf-8')
 print('Publication snapshot:',len(data['records']),'downloaded resources with source excerpts')
if __name__=='__main__':build()
