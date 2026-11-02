"""Extract a short first-page excerpt without interpreting financial amounts."""
from pathlib import Path
import sqlite3, re, logging
from pypdf import PdfReader
ROOT=Path(__import__("os").environ.get("BCS_FINANCE_ARCHIVE", Path.cwd()/".finance-archive")).resolve()
logging.getLogger('pypdf').setLevel(logging.ERROR)
def run():
 c=sqlite3.connect(ROOT/'archive.sqlite',timeout=30)
 c.execute('CREATE TABLE IF NOT EXISTS excerpts(sha256 TEXT PRIMARY KEY,excerpt TEXT,pages INTEGER,status TEXT,error TEXT)')
 rows=c.execute("SELECT DISTINCT r.sha256,r.path FROM resources r LEFT JOIN excerpts e ON e.sha256=r.sha256 WHERE r.status='ok' AND r.mime='application/pdf' AND e.sha256 IS NULL").fetchall();done=0
 for sha,path in rows:
  try:
   reader=PdfReader(ROOT/path,strict=False)
   text=' '.join((reader.pages[0].extract_text() or '').split())
   text=re.sub(r'https?://\S+','',text).strip()[:1100]
   status='text' if len(text)>60 else 'needs_visual_review'
   c.execute('INSERT OR IGNORE INTO excerpts VALUES(?,?,?,?,?)',(sha,text,len(reader.pages),status,None));done+=status=='text'
  except Exception as e:c.execute('INSERT OR IGNORE INTO excerpts VALUES(?,?,?,?,?)',(sha,'',None,'error',str(e)[:300]))
  c.commit()
 print('PDFs examined:',len(rows),'with source excerpt:',done)
if __name__=='__main__':run()
