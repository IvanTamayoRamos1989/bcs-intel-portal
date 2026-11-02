"""Resumable, read-only public-document archive. Python standard library only.
Run: python collect.py --workers 4
Re-run retries failures and resumes pending URLs; originals are content-addressed.
"""
import argparse, concurrent.futures as cf, hashlib, html, json, re, sqlite3, time
import urllib.request, urllib.parse as U, urllib.robotparser, itertools
from html.parser import HTMLParser
from pathlib import Path
from datetime import datetime, timezone
import xml.etree.ElementTree as ET

ROOT = Path(__import__("os").environ.get("BCS_FINANCE_ARCHIVE", Path.cwd()/".finance-archive")).resolve()
BASE = 'https://finanzas.bcs.gob.mx/'
HOST = 'finanzas.bcs.gob.mx'
AGENT = 'BCS2050-PublicArchive/1.0'
DOC = re.compile(r'\.(pdf|xlsx?|csv|zip|rar|7z|docx?|pptx?|ods|odt|kml|kmz|geojson|json|xml|txt|jpe?g|png|webp)$', re.I)
SKIP = re.compile(r'/(wp-admin|wp-login|wp-json|feed|comments|author|tag|category|page)/|replytocom=|/wp-content/(plugins|themes)/.*\.(js|css|php)', re.I)
CORE = re.compile(r'presup|cuenta|rendi|armoniza|participa|fiscal|program|normativ|evaluaci|deuda|disciplina|transparen|ingreso|egreso|planea|fois',re.I)
def now(): return datetime.now(timezone.utc).isoformat()
def canonical(raw, base):
    raw=html.unescape(raw).strip().replace('\\/','/')
    if not raw or raw.startswith(('#','javascript:','mailto:','tel:','data:')): return None
    p=U.urlsplit(U.urljoin(base,raw))
    if p.scheme not in ('http','https') or not p.hostname or p.username: return None
    query=U.parse_qs(p.query)
    if 'file' in query: return canonical(query['file'][0],base)
    path=re.sub('/+','/',p.path or '/')
    path=U.quote(U.unquote(path),safe="/:@!$&'()*+,;=-._~")
    if p.hostname==HOST:
        query={k:v for k,v in query.items() if k in ('p','page_id','attachment_id','download')}
        return U.urlunsplit(('https',HOST,path,U.urlencode(query,doseq=True),''))
    return U.urlunsplit((p.scheme,p.netloc,path,p.query,''))

class Links(HTMLParser):
    def __init__(self):
        super().__init__();self.links=[];self.anchor=None;self.label=[];self.title=[];self.in_title=False;self.select=None;self.selects={}
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='select':self.select=a.get('id');self.selects.setdefault(self.select,[])
        if tag=='option' and self.select:self.selects[self.select].append(a.get('value'))
        if tag=='title':self.in_title=True
        if tag=='a':self.anchor=a.get('href');self.label=[]
        if tag in ('iframe','embed','object','option'):
            u=a.get('src') or a.get('data') or a.get('value')
            if u and (tag!='option' or u.startswith(('http://','https://','/wp-content/'))):self.links.append((u,a.get('title','')))
    def handle_data(self,data):
        if self.in_title:self.title.append(data)
        if self.anchor:self.label.append(data)
    def handle_endtag(self,tag):
        if tag=='select':self.select=None
        if tag=='title':self.in_title=False
        if tag=='a' and self.anchor:
            self.links.append((self.anchor,' '.join(' '.join(self.label).split())));self.anchor=None

def dynamic_links(s, selects):
    """Expand only literal concatenations and observed dropdown values; never eval JS."""
    found=[]
    for body in re.split(r'function\s+[\w$]+\s*\([^)]*\)\s*\{',s)[1:]:
        bindings=dict(re.findall(r'''(\w+)\s*=\s*document.getElementById\(["']([^"']+)["']\).value''',body))
        combos=dict(re.findall(r'''(\w+)\s*=\s*document.getElementById\(["']([^"']+)["']\)\s*;''',body))
        rules=re.findall(r'''if\s*\(\s*(\w+)\.selectedIndex\s*>=\s*(\d+)\s*&&\s*\w+\.selectedIndex\s*<=\s*(\d+)\s*\)\s*\{\s*(\w+)\s*=\s*['"]([^'"]+)['"]''',body)
        expressions=re.findall(r'''window.open\(([^;\n]*?)\)''',body)
        expressions=[re.sub(r''',\s*['"]_blank['"]\s*$''','',e) for e in expressions]
        # Variable URLs and table links are expanded from their literal source expressions.
        expressions += re.findall(r'''(?:var\s+)?(?:url|link\d+)\s*=\s*([^;\n]+)''',body)
        items=[[(i,v) for i,v in enumerate(selects.get(sid,[])) if v is not None] for sid in bindings.values()]
        if any(not x for x in items) or __import__('math').prod(map(len,items))>4000:continue
        for choices in itertools.product(*items):
            values={k:item[1] for k,item in zip(bindings,choices)}
            indexes={sid:item[0] for sid,item in zip(bindings.values(),choices)}
            for combo,lo,hi,var,value in rules:
                if int(lo)<=indexes.get(combos.get(combo),-1)<=int(hi):values[var]=value
            for expr in expressions:
                parts=re.split(r'\s*\+\s*',expr.strip());result=[]
                for part in parts:
                    if re.fullmatch(r'''(["']).*\1''',part):result.append(part[1:-1])
                    elif part in values:result.append(values[part])
                    else:result=[];break
                if result and DOC.search(U.urlsplit(''.join(result)).path):found.append((''.join(result),'Enlace de selector oficial'))
    return found

def connect():
    db=sqlite3.connect(ROOT/'archive.sqlite');db.execute('PRAGMA journal_mode=WAL')
    db.executescript('''CREATE TABLE IF NOT EXISTS resources(url TEXT PRIMARY KEY, kind TEXT, priority INT, status TEXT DEFAULT 'pending', title TEXT, path TEXT, sha256 TEXT, bytes INT, mime TEXT, fetched TEXT, error TEXT, final_url TEXT);
    CREATE TABLE IF NOT EXISTS links(parent TEXT,url TEXT,label TEXT,PRIMARY KEY(parent,url,label));
    CREATE INDEX IF NOT EXISTS links_by_url ON links(url);''')
    return db

def enqueue(db,raw,parent,label=''):
    u=canonical(raw,parent)
    if not u:return
    p=U.urlsplit(u); ext=Path(U.unquote(p.path)).suffix.lower()
    document=bool(DOC.search(p.path))
    # External government documents are copied; external portals are catalogued only.
    allowed=p.hostname==HOST or (p.hostname.endswith('.gob.mx') and document)
    kind='sitemap' if 'sitemap' in p.path and ext=='.xml' else 'document' if document else 'page'
    if not allowed:
        db.execute('INSERT OR IGNORE INTO links VALUES(?,?,?)',(parent,u,label));return
    if p.hostname==HOST and (SKIP.search(u) or (p.query and not document)):
        return
    if not robot.can_fetch(AGENT,u) and p.hostname==HOST:return
    priority=0 if kind=='sitemap' else 1 if kind=='page' and CORE.search(u) else 3 if kind=='page' else 2
    db.execute('INSERT OR IGNORE INTO resources(url,kind,priority,title) VALUES(?,?,?,?)',(u,kind,priority,label))
    db.execute('INSERT OR IGNORE INTO links VALUES(?,?,?)',(parent,u,label))

def download(row):
    url,kind=row; temp=ROOT/'tmp'/hashlib.sha256(url.encode()).hexdigest()
    try:
        req=urllib.request.Request(url,headers={'User-Agent':AGENT,'Accept-Encoding':'identity'})
        with urllib.request.urlopen(req,timeout=40) as r:
            mime=r.headers.get_content_type(); final=r.url; digest=hashlib.sha256();size=0
            with temp.open('wb') as out:
                while True:
                    b=r.read(128*1024)
                    if not b:break
                    out.write(b);digest.update(b);size+=len(b)
                    if size>512*1024*1024:raise ValueError('Archivo mayor que 512 MiB; requiere descarga específica')
        sha=digest.hexdigest(); suffix=Path(U.unquote(U.urlsplit(url).path)).suffix.lower()
        if mime=='text/html':suffix='.html'
        elif mime=='application/pdf':suffix='.pdf'
        elif not re.fullmatch(r'\.[a-z0-9]{1,8}',suffix):suffix='.bin'
        if kind=='document' and suffix=='.html':raise ValueError('El enlace de documento devolvió HTML; revisar origen')
        dest=ROOT/'originals'/(sha+suffix)
        if dest.exists():temp.unlink()
        else:temp.replace(dest)
        found=[];title=''
        if mime=='text/html':
            raw=dest.read_bytes()
            try:s=raw.decode('utf-8')
            except UnicodeDecodeError:s=raw.decode('cp1252',errors='replace')
            parser=Links();parser.feed(s);found=parser.links;title=' '.join(' '.join(parser.title).split())
            found += dynamic_links(s,parser.selects)
            # Some older sections keep document URLs in Javascript dropdowns.
            found += [(html.unescape(m),'') for m in re.findall(r'''(?:https?://|/wp-content/)[^\s<>"']+?\.(?:pdf|xlsx?|csv|zip|docx?|ods)(?:\?[^\s<>"']*)?''',s,re.I)]
        elif kind=='sitemap':
            found=[(e.text,'') for e in ET.fromstring(dest.read_bytes()).iter() if e.tag.endswith('}loc')]
        return {'url':url,'status':'ok','path':dest.relative_to(ROOT).as_posix(),'sha256':sha,'bytes':size,'mime':mime,'fetched':now(),'final_url':final,'title':title,'links':found}
    except Exception as e:
        if temp.exists():temp.unlink()
        return {'url':url,'status':'error','error':str(e)[:800],'fetched':now()}

def summary(db):
    return {s:n for s,n in db.execute('SELECT status,count(*) FROM resources GROUP BY status')}
def run():
    ap=argparse.ArgumentParser();ap.add_argument('--workers',type=int,default=4);ap.add_argument('--retry-errors',action='store_true');args=ap.parse_args()
    for d in ('originals','tmp'): (ROOT/d).mkdir(exist_ok=True)
    db=connect();db.execute("UPDATE resources SET status='pending' WHERE status='running'")
    if args.retry_errors:db.execute("UPDATE resources SET status='pending' WHERE status='error'")
    enqueue(db,BASE,BASE);enqueue(db,BASE+'wp-sitemap.xml',BASE);db.commit()
    started=time.monotonic();last=0;active={}
    with cf.ThreadPoolExecutor(max_workers=max(1,min(args.workers,6))) as pool:
        while True:
            rows=db.execute("SELECT url,kind FROM resources WHERE status='pending' ORDER BY priority,url LIMIT ?",(args.workers-len(active),)).fetchall()
            for row in rows:
                db.execute("UPDATE resources SET status='running' WHERE url=?",(row[0],));active[pool.submit(download,row)]=row
            db.commit()
            if not active:break
            done,_=cf.wait(active,timeout=1,return_when=cf.FIRST_COMPLETED)
            for f in done:
                row=active.pop(f);result=f.result();found=result.pop('links',[])
                if not result.get('title'):result.pop('title',None)
                url=result.pop('url');db.execute('UPDATE resources SET '+','.join(k+'=?' for k in result)+' WHERE url=?',(*result.values(),url))
                for link,label in found:enqueue(db,link,url,label)
            db.commit()
            if time.monotonic()-last>20:
                report={'updated':now(),'elapsed_seconds':round(time.monotonic()-started),'counts':summary(db),'downloaded_bytes':db.execute('SELECT coalesce(sum(bytes),0) FROM resources').fetchone()[0]}
                (ROOT/'progress.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report),flush=True);last=time.monotonic()
    print('Finished',json.dumps(summary(db)),flush=True)
    report={'updated':now(),'counts':summary(db),'downloaded_bytes':db.execute('SELECT coalesce(sum(bytes),0) FROM resources').fetchone()[0]}
    (ROOT/'progress.json').write_text(json.dumps(report,indent=2),encoding='utf-8')

robot=urllib.robotparser.RobotFileParser(BASE+'robots.txt')
if __name__=='__main__':
    ROOT.mkdir(parents=True,exist_ok=True)
    raw=urllib.request.urlopen(BASE+'robots.txt',timeout=30).read().decode('utf-8')
    (ROOT/'robots.txt').write_text(raw,encoding='utf-8');robot.parse(raw.splitlines());run()
