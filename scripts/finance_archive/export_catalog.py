"""Publish a provenance-preserving catalog; no financial amounts are inferred."""
import csv, json, re, sqlite3, unicodedata
from pathlib import Path
from urllib.parse import urlsplit, unquote
from datetime import datetime, timezone
ROOT=Path(__import__("os").environ.get("BCS_FINANCE_ARCHIVE", Path.cwd()/".finance-archive")).resolve()
OUT=ROOT/'catalog'
def plain(s):return ''.join(c for c in unicodedata.normalize('NFD',s.lower()) if unicodedata.category(c)!='Mn')
GROUPS=[('Cuenta pública',r'cuenta.?public|cuentapublic|/cp/'),('Participaciones y municipios',r'participaci|municip|fortamun|fism|fais|fois'),('Evaluación y resultados',r'evaluaci|pae|indicador|desempeno|matriz|mir[- _/]'),('Deuda y disciplina financiera',r'deuda|disciplina|financiamiento|quirogra|ldf'),('Presupuesto y egresos',r'presup|egreso|gasto|costos|paquete-economico'),('Ingresos',r'ingreso|ingre_|tribut|recauda|impuesto'),('Planes y programas',r'plan|program|obra|inversion'),('Contrataciones',r'licitaci|adquisici|contrato|convocatoria'),('Marco normativo',r'normativ|ley|reglamento|codigo|lineamiento'),('Transparencia y contabilidad',r'contab|transparen|rendi|financier')]
def build():
    OUT.mkdir(parents=True,exist_ok=True);db=sqlite3.connect(ROOT/'archive.sqlite');db.row_factory=sqlite3.Row
    records=[]
    for row in db.execute("SELECT * FROM resources WHERE kind!='sitemap' AND status!='excluded' ORDER BY url"):
        d=dict(row);url=d['url'];parents=[dict(x) for x in db.execute('SELECT parent,label FROM links WHERE url=? ORDER BY parent',(url,))]
        labels=[p['label'] for p in parents if len(p['label'])>5 and '\ufffd' not in p['label'] and p['label']!='Enlace de selector oficial']
        name=unquote(urlsplit(url).path).rstrip('/').split('/')[-1]
        title=(d['title'] or '') if d['kind']=='page' else (labels[0] if labels else name)
        if not title or '\ufffd' in title:title=name.replace('-',' ').replace('_',' ')
        title=title.split(' – Secretaría')[0]
        text=plain(unquote(url)+' '+title)
        category=next((name for name,pat in GROUPS if re.search(pat,text)),'Otros documentos públicos')
        years=sorted(set(re.findall(r'(?<!\d)(?:19|20)\d{2}(?!\d)',unquote(url)+' '+title)))
        records.append({'id':__import__('hashlib').sha256(url.encode()).hexdigest()[:20],'title':title,'url':url,'kind':d['kind'],'category':category,'years':years,'format':Path(urlsplit(url).path).suffix.lstrip('.').upper() if d['kind']=='document' else 'WEB','status':d['status'],'bytes':d['bytes'],'sha256':d['sha256'],'downloaded_at':d['fetched'],'local_path':d['path'],'error':d['error'],'source_pages':parents,'territorial_status':'Sin asignación territorial validada','amounts_status':'No extraídos ni validados'})
    counts={s:n for s,n in db.execute('SELECT status,count(*) FROM resources GROUP BY status')}
    payload={'generated_at':datetime.now(timezone.utc).isoformat(),'source':'https://finanzas.bcs.gob.mx/','scope':'Páginas públicas y archivos enlazados descubiertos desde el mapa del sitio y la navegación; documentos externos gubernamentales enlazados. No incluye sistemas privados ni garantiza documentos no enlazados o generados por selectores no resueltos.','classification':'Tema y años detectados automáticamente en URL y título; pendientes de revisión documental. El año puede ser de publicación, no del ejercicio fiscal.','counts':counts,'complete':not any(counts.get(x,0) for x in ['pending','running','error']),'records':records}
    data=json.dumps(payload,ensure_ascii=False)
    for filename,body in [('catalog.json',data),('catalog.js','window.BCS_FINANZAS = '+data+';')]:
        tmp=OUT/(filename+'.tmp');tmp.write_text(body,encoding='utf-8');tmp.replace(OUT/filename)
    with (OUT/'catalog.csv').open('w',encoding='utf-8-sig',newline='') as f:
        fields=['id','title','url','kind','category','years','format','status','bytes','sha256','downloaded_at','local_path','territorial_status','amounts_status'];w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader()
        for r in records:
            safe={**r,'years':';'.join(r['years'])}
            for k,v in safe.items():
                if isinstance(v,str) and v.startswith(('=','+','-','@')):safe[k]="'"+v
            w.writerow(safe)
    print(json.dumps({'records':len(records),'counts':counts},ensure_ascii=False))
if __name__=='__main__':build()
