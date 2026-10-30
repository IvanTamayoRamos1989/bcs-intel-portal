#!/usr/bin/env python3
"""Build drive_index, file summaries, enrich catalog_slim/catalog."""
from __future__ import annotations
import json, re, subprocess, hashlib
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict

HUB = Path('/workspace/BCSFP/11_bcs_hub')
LAKE = Path('/workspace/BCSFP')
ROOT_ID = '1v3_MVil8BzvWXf6NCsQBfx6aSJEmOCC7'
ROOT_URL = f'https://drive.google.com/drive/folders/{ROOT_ID}'
PAGES = HUB / 'scripts/drive_crawl/pages'
FOLDER_MAP = {
  '00_catalog': '11LUYA735fzTKaYKN8EZea2tPyRo0RhDb',
  '01_planning': '1o1X4yxJZk-lLzBAg8GymhOEwYqgqfewv',
  '02_water': '14A_pAcmPy7Q10-V9EAD7f4u0iPFlEVwf',
  '03_energy': '1WCOk146uvNMXUce05J9rjpVsbvOhPz6-',
  '04_mobility_waste': '1yQPGjlM6Ri_IIELjtpjgcV8PUcCaq0Xh',
  '05_demographics': '1G1IepLmhKmHn5OGVrggm22Fi4yn2VoYR',
  '06_environment': '1hd5ZW71g-RuMkJcpdUmSXSxondgFBnsh',
  '07_economy_investment': '1YEQq0vxgOYlpYFz_ZCLjUIIcphy-HHeJ',
  '08_fp_team_research': '1UCjtCBgWxuuKGUzqBBuzyzRfRRzVB7yO',
  # '09_shadow_programme': trashed 2026-09-15
  '10_data_lake': '158H29D8F_1XShR3Hx0lyXZ7Tc5nyREJZ',
  '11_bcs_hub': '1Hq2Zwk0VRS2uo1Z-rYTTsbLk1veCG3gR',
  '12_ontology': '1jl0uofmBUuijPQSGgCEn_f7yNXXpxwKu',
  '13_territorial_intelligence': '1t5_CTE7mybtqhe1LVaF-769uKoGXHvcE',
  '13_federal_projects': '1CEoA0QaztHJBW9KBqqc7J5diAPjZUm3j',
  '00_README': '1oITn7Uy62deedjcFSPbesLHJIOyun8Lb',
  'BCS_hub_pack': '13lEPsMXo1XmyJV0CzZ_bFmYK_ALwoWXm',
}
ID_TO_TOP = {v: k for k, v in FOLDER_MAP.items()}
FOLDER_MIME = 'application/vnd.google-apps.folder'

FOLDER_LABELS = {
  '00_catalog': ('Índices y catálogos de datos', 'Data indexes and catalogs'),
  '01_planning': ('Planeación: POER, PDU, POEL, PMD', 'Planning: POER, PDU, POEL, PMD'),
  '02_water': ('Agua: DMA, CONAGUA, desalación', 'Water: DMA, CONAGUA, desalination'),
  '03_energy': ('Energía: SIBCS, CENACE, PRODESEN', 'Energy: SIBCS, CENACE, PRODESEN'),
  '04_mobility_waste': ('Movilidad y residuos', 'Mobility and waste'),
  '05_demographics': ('Demografía y turismo', 'Demographics and tourism'),
  '06_environment': ('Ambiente y ANP', 'Environment and protected areas'),
  '07_economy_investment': ('Economía e inversión', 'Economy and investment'),
  '08_fp_team_research': ('Investigación equipo F+P', 'F+P team research'),
  '09_shadow_programme': ('Programa sombra / entregables', 'Shadow programme / deliverables'),
  '10_data_lake': ('Data lake / índices', 'Data lake / indexes'),
  '11_bcs_hub': ('Portal BCS hub', 'BCS hub portal'),
  '12_ontology': ('Ontología territorial', 'Territorial ontology'),
  '13_territorial_intelligence': ('Inteligencia territorial', 'Territorial intelligence'),
  '13_federal_projects': ('Proyectos federales', 'Federal projects'),
}

def view_url(fid, mime=''):
  if mime.startswith('application/vnd.google-apps.') and 'folder' not in mime:
    kind = mime.split('.')[-1]
    if kind == 'document':
      return f'https://docs.google.com/document/d/{fid}/edit'
    if kind == 'spreadsheet':
      return f'https://docs.google.com/spreadsheets/d/{fid}/edit'
    if kind == 'presentation':
      return f'https://docs.google.com/presentation/d/{fid}/edit'
  return f'https://drive.google.com/file/d/{fid}/view'

def dl_url(fid):
  return f'https://drive.google.com/uc?export=download&id={fid}'

def clean_text(t: str, limit=400) -> str:
  t = re.sub(r'[#*_`>\[\]\(\)]+', ' ', t)
  t = re.sub(r'\s+', ' ', t).strip()
  if len(t) > limit:
    t = t[:limit].rsplit(' ', 1)[0] + '…'
  return t

def heuristic_summary(name: str, folder: str, ext: str):
  fl = FOLDER_LABELS.get(folder, (folder, folder))
  base = Path(name).stem.replace('_', ' ').replace('-', ' ')
  base = re.sub(r'\s+', ' ', base).strip()
  # year prefix
  m = re.match(r'^(\d{4}(?:-\d{2}(?:-\d{2})?)?)\s+(.*)$', base)
  year = m.group(1) if m else None
  rest = m.group(2) if m else base
  es = f"{rest} — {fl[0]}"
  en = f"{rest} — {fl[1]}"
  if ext:
    es += f' ({ext.upper()})'
    en += f' ({ext.upper()})'
  if year:
    es = f'[{year}] ' + es
    en = f'[{year}] ' + en
  return clean_text(es, 220), clean_text(en, 220)

def paraphrase_en(es: str) -> str:
  # lightweight: keep content, mark as EN paraphrase of ES extract
  return clean_text(es, 280)

def summarize_md(path: Path):
  try:
    raw = path.read_text(encoding='utf-8', errors='ignore')
  except Exception:
    return None, None
  # first non-empty paragraph after optional title
  lines = []
  for line in raw.splitlines():
    s = line.strip()
    if not s:
      if lines:
        break
      continue
    if s.startswith('#') and not lines:
      # use title lightly
      title = s.lstrip('#').strip()
      lines.append(title)
      continue
    lines.append(s)
    if len(' '.join(lines)) > 350:
      break
  es = clean_text(' '.join(lines), 400)
  if not es:
    return None, None
  return es, paraphrase_en(es)

def is_economy_pdf(path: Path) -> bool:
  name = path.name.upper()
  rel = str(path).replace('\\', '/').upper()
  keys = ('PIBE', 'PIB_', 'ITAEE', 'IED', 'CNIE', 'SETUE', 'ENOE', 'VAB')
  return any(k in name or k in rel for k in keys) or '07_ECONOMY' in rel

def is_priority_pdf(path: Path) -> bool:
  """Deeper extracts for water/SEMARNAT/MIA, energy, tourism SETUE, ports/airports, planning."""
  if is_economy_pdf(path):
    return True
  name = path.name.upper()
  rel = str(path).replace('\\', '/').upper()
  keys = (
    'DMA', 'CONAGUA', 'SEMARNAT', 'MIA', 'MANIFESTACION', 'DESAL', 'ACUIFERO', 'OOMSAPAS', 'CEA',
    'PRODESEN', 'PLADESE', 'PAMRNT', 'CENACE', 'SIBCS', 'SENER', 'CFE',
    'SETUE', 'TURISMO', 'DATATUR',
    'AEROPUERTO', 'PUERTO', 'API ', 'ASIPONA', 'SCT_', 'SJD', 'LAP',
    'PDU', 'POEL', 'POER', 'POET', 'PMD', 'PED', 'ORDENAMIENTO', 'IMPLAN',
  )
  folders = ('02_WATER', '03_ENERGY', '01_PLANNING', '07_ECONOMY', '04_MOBILITY', '13_TERRITORIAL')
  return any(k in name or k in rel for k in keys) or any(f in rel for f in folders)

def _normalize_money_figures(text: str) -> str:
  """Normalize spaced/comma digit groups and add compact form for retrieval."""
  def repl(m):
    digits = re.sub(r'[\s,]', '', m.group(0))
    if len(digits) < 4:
      return m.group(0)
    try:
      n = int(digits)
      grouped = f'{n:,}'
    except ValueError:
      grouped = digits
    if grouped == digits:
      return digits
    return f'{grouped} ({digits})'
  # Runs of digits with spaces/commas between (e.g. 187 152 / 187,152)
  return re.sub(r'\b\d{1,3}(?:[\s,]\d{3})+\b', repl, text)

def _harvest_economy_cifras(text: str) -> str:
  lines = []
  for raw in re.split(r'[\n\r]+|(?<=[\.\;])\s+', text):
    s = raw.strip()
    if not s:
      continue
    if re.search(r'PIB|VAB|PIBE|millones|mdp|ISPN|constante|nominal|IED|%', s, re.I):
      if re.search(r'\d', s):
        lines.append(s)
    if len(lines) >= 8:
      break
  if not lines:
    return ''
  joined = ' | '.join(lines)
  joined = _normalize_money_figures(joined)
  return 'CIFRAS: ' + clean_text(joined, 700)


def _harvest_priority_cifras(text: str) -> str:
  """Line harvest for water/energy/tourism/ports/planning PDFs."""
  lines = []
  for raw in re.split(r'[\n\r]+|(?<=[\.\;])\s+', text):
    s = raw.strip()
    if not s:
      continue
    if re.search(r'DMA|hm\s*³|hm3|MW|MWh|PIB|VAB|turista|cuarto|habitacion|pasajer|concesion|extraccion|disponibilidad|PDU|POER|UGA|%', s, re.I):
      if re.search(r'\d', s):
        lines.append(s)
    if len(lines) >= 8:
      break
  if not lines:
    return ''
  joined = ' | '.join(lines)
  joined = _normalize_money_figures(joined)
  return 'CIFRAS: ' + clean_text(joined, 700)

def summarize_pdf(path: Path):
  priority = is_priority_pdf(path)
  economy = is_economy_pdf(path)
  last_page = 4 if priority else 2
  clip_limit = 1800 if priority else 320
  try:
    r = subprocess.run(
      ['pdftotext', '-f', '1', '-l', str(last_page), '-enc', 'UTF-8', str(path), '-'],
      capture_output=True, text=True, timeout=40
    )
    text = r.stdout or ''
  except Exception:
    return None, None
  # Keep some newlines for harvest, then flatten for body
  raw = text.strip()
  flat = re.sub(r'\s+', ' ', raw).strip()
  if len(flat) < 40:
    return None, None
  if priority:
    cifras = _harvest_economy_cifras(raw) if economy else _harvest_priority_cifras(raw)
    # Prefer more of the body so headline figures (often mid-page-1) are kept
    body = _normalize_money_figures(flat)
    if cifras:
      chunk = cifras + ' ' + body
    else:
      chunk = body
    es = clean_text(chunk, clip_limit)
  else:
    parts = re.split(r'(?<=[\.\!\?])\s+', flat)
    chunk = ' '.join(parts[:2]) if parts else flat
    es = clean_text(chunk, clip_limit)
  if not es:
    return None, None
  en = paraphrase_en(es) if not economy else clean_text(es, min(clip_limit, 1600))
  return es, en

def load_pages():
  files = []
  folders = []
  for p in sorted(PAGES.glob('*.json')):
    try:
      data = json.loads(p.read_text())
    except Exception:
      continue
    path_guess = data.get('path_guess', '')
    for f in data.get('files', []):
      f = dict(f)
      f['_path_guess'] = path_guess
      if f.get('mimeType') == FOLDER_MIME:
        folders.append(f)
      else:
        files.append(f)
  return files, folders

def load_legacy_inventory():
  inv_path = LAKE / '_drive_audit/drive_inventory.json'
  if not inv_path.exists():
    return []
  inv = json.loads(inv_path.read_text())
  out = []
  for f in inv.get('files', []):
    out.append({
      'id': f['id'],
      'title': f['title'],
      'mimeType': f.get('mimeType', ''),
      'parentId': f.get('parentId', ''),
      'fileSize': f.get('size'),
      '_path_guess': (f.get('parent_path') or '').replace('RS_BCS_2050/', ''),
    })
  return out

def build_drive_index():
  by_id = {}
  # legacy first
  for f in load_legacy_inventory():
    fid = f['id']
    mime = f.get('mimeType', '')
    if mime == FOLDER_MIME:
      continue
    entry = {
      'id': fid,
      'title': f['title'],
      'parentId': f.get('parentId', ''),
      'mimeType': mime,
      'viewUrl': view_url(fid, mime),
      'downloadUrl': dl_url(fid),
      'path_guess': f.get('_path_guess', ''),
    }
    by_id[fid] = entry
  page_files, page_folders = load_pages()
  for f in page_files:
    fid = f['id']
    mime = f.get('mimeType', '')
    title = f.get('title', '')
    path_guess = f.get('_path_guess') or ''
    # refine path from parent top folder
    pid = f.get('parentId', '')
    if not path_guess and pid in ID_TO_TOP:
      path_guess = ID_TO_TOP[pid]
    entry = {
      'id': fid,
      'title': title,
      'parentId': pid,
      'mimeType': mime,
      'viewUrl': f.get('viewUrl') or view_url(fid, mime),
      'downloadUrl': dl_url(fid),
      'path_guess': path_guess,
    }
    by_id[fid] = entry  # prefer fresh

  by_title = defaultdict(list)
  for e in by_id.values():
    by_title[e['title']].append({
      'id': e['id'],
      'title': e['title'],
      'parentId': e['parentId'],
      'viewUrl': e['viewUrl'],
      'downloadUrl': e['downloadUrl'],
      'path_guess': e['path_guess'],
    })

  # folder count from pages + map
  folder_ids = set(FOLDER_MAP.values())
  for f in page_folders:
    folder_ids.add(f['id'])

  index = {
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'root_id': ROOT_ID,
    'root_url': ROOT_URL,
    'by_title': dict(by_title),
    'by_id': by_id,
    'stats': {
      'folders': len(folder_ids),
      'files': len(by_id),
      'matched': 0,
    },
    'top_folders': {k: {'id': v, 'viewUrl': f'https://drive.google.com/drive/folders/{v}'} for k, v in FOLDER_MAP.items()},
  }
  return index, page_folders

def pick_drive_match(title: str, folder: str, by_title: dict):
  matches = by_title.get(title) or by_title.get(title.strip())
  if not matches:
    # case-insensitive
    tl = title.lower()
    matches = []
    for k, v in by_title.items():
      if k.lower() == tl:
        matches.extend(v)
  if not matches:
    return None
  if len(matches) == 1:
    return matches[0]
  # prefer parent chain / path_guess matching folder
  scored = []
  for m in matches:
    score = 0
    pg = (m.get('path_guess') or '')
    if folder and folder in pg:
      score += 10
    if folder and pg.startswith(folder):
      score += 5
    if folder and folder in FOLDER_MAP and m.get('parentId') == FOLDER_MAP[folder]:
      score += 8
    scored.append((score, m))
  scored.sort(key=lambda x: -x[0])
  return scored[0][1]

def generate_summaries(catalog_files):
  summaries = {}
  # 1) all markdown
  md_paths = []
  for p in LAKE.rglob('*.md'):
    sp = str(p)
    if 'node_modules' in sp or '/.git/' in sp or '/dist/' in sp:
      continue
    if 'MIES' in p.name.upper() or '/15_decision_platform/' in sp or '/_backups/' in sp or '/stakeholder_review/' in sp:
      continue  # internal / confidential: never summarised for the public portal
    md_paths.append(p)
  for p in md_paths:
    rel = str(p.relative_to(LAKE)).replace('\\', '/')
    es, en = summarize_md(p)
    if not es:
      folder = rel.split('/')[0]
      es, en = heuristic_summary(p.name, folder, 'md')
    summaries[rel] = {'sum_es': es, 'sum_en': en, 'source': 'md'}

  # 2) priority PDFs
  priority_roots = [
    LAKE / '01_planning',
    LAKE / '02_water',
    LAKE / '03_energy',
    LAKE / '06_environment',
    LAKE / '07_economy_investment',
  ]
  # TI subdirs
  ti = LAKE / '13_territorial_intelligence'
  if ti.exists():
    for sub in ti.iterdir():
      if sub.is_dir() and any(x in sub.name.lower() for x in ('plan', 'fiscal', 'catastro', 're_', 'report')):
        priority_roots.append(sub)
    # also common packs
    for name in ['plans', 'plans_archive', 'fiscal', 'catastro', 're_reports', 'reports']:
      cand = ti / name
      if cand.exists():
        priority_roots.append(cand)

  pdf_done = 0
  PDF_CAP = 750
  seen = set()
  pdf_list = []
  for root in priority_roots:
    if not root.exists():
      continue
    for p in root.rglob('*.pdf'):
      if 'node_modules' in str(p):
        continue
      rp = p.resolve()
      if rp in seen:
        continue
      seen.add(rp)
      pdf_list.append(p)
  # also theme_docs / re_reports referenced — add all PDFs under 13 if under cap
  # include remaining planning-adjacent from catalog themes
  for p in sorted(pdf_list, key=lambda x: str(x)):
    if pdf_done >= PDF_CAP:
      break
    rel = str(p.relative_to(LAKE)).replace('\\', '/')
    if rel in summaries:
      continue
    es, en = summarize_pdf(p)
    folder = rel.split('/')[0]
    if not es:
      es, en = heuristic_summary(p.name, folder, 'pdf')
      src = 'heuristic'
    else:
      src = 'pdf'
    summaries[rel] = {'sum_es': es, 'sum_en': en, 'source': src}
    pdf_done += 1

  # 3) heuristics for remaining catalog rows without summary (esp. pdf/md priority already done)
  for f in catalog_files:
    rel = f.get('path') or f.get('p')
    if not rel or rel in summaries:
      continue
    name = f.get('name') or f.get('n') or Path(rel).name
    folder = f.get('folder') or f.get('f') or rel.split('/')[0]
    ext = f.get('ext') or f.get('e') or Path(rel).suffix.lstrip('.')
    # only heuristic for pdf/md/csv/xlsx or important types to avoid bloating
    if ext.lower() in ('pdf', 'md', 'csv', 'xlsx', 'xls', 'doc', 'docx', 'pptx', 'json', 'html', 'txt'):
      es, en = heuristic_summary(name, folder, ext)
      summaries[rel] = {'sum_es': es, 'sum_en': en, 'source': 'heuristic'}

  return summaries, {'md': len(md_paths), 'pdf_extracted_or_heuristic': pdf_done}



def refresh_priority_summaries(summaries: dict) -> int:
  """Force deeper PDF extracts for water/energy/tourism/ports/planning when files exist."""
  updated = 0
  keys = (
    'DMA', 'CONAGUA', 'SEMARNAT', 'MIA', 'DESAL', 'ACUIFERO',
    'PRODESEN', 'PLADESE', 'PAMRNT', 'CENACE', 'SIBCS',
    'SETUE', 'TURISMO', 'AEROPUERTO', 'PUERTO', 'PDU', 'POEL', 'POER', 'POET',
  )
  folders = ('02_water', '03_energy', '01_planning', '04_mobility')
  targets = []
  for rel in list(summaries.keys()):
    name = Path(rel).name.upper()
    low = rel.lower()
    if any(k in name for k in keys) or any(f in low for f in folders):
      if low.endswith('.pdf'):
        targets.append(rel)
  # Cap to keep refresh bounded
  targets = targets[:120]
  for rel in targets:
    p = LAKE / rel
    if not p.exists() or p.suffix.lower() != '.pdf':
      continue
    es, en = summarize_pdf(p)
    if not es:
      continue
    prev = (summaries.get(rel) or {}).get('sum_es') or ''
    src_prev = (summaries.get(rel) or {}).get('source')
    if src_prev == 'heuristic' or len(es) > len(prev) + 40 or 'CIFRAS:' in es:
      summaries[rel] = {'sum_es': es, 'sum_en': en or paraphrase_en(es), 'source': 'pdf'}
      updated += 1
  return updated

def refresh_economy_summaries(summaries: dict) -> int:
  """Force deeper PDF extracts for PIBE / key economy docs (overwrite stubs)."""
  updated = 0
  targets = []
  for rel in list(summaries.keys()):
    name = Path(rel).name.upper()
    if any(k in name for k in ('PIBE', 'PIB_', 'ITAEE', 'IED', 'CNIE', 'SETUE')) or '07_economy_investment' in rel.lower() and name.endswith('.PDF') and 'INEGI' in name:
      targets.append(rel)
  # Always include known PIBE paths even if missing from map
  for extra in (
    '07_economy_investment/2025-12-05_INEGI_PIBE_BCS_2024.pdf',
    '07_economy_investment/2025-12-05_INEGI_PIBE_2024_nacional.pdf',
    '05_demographics/2024-12-05_INEGI_PIBE_BCS_2023.pdf',
  ):
    if extra not in targets:
      targets.append(extra)
  for rel in targets:
    p = LAKE / rel
    if not p.exists():
      continue
    if p.suffix.lower() != '.pdf':
      continue
    es, en = summarize_pdf(p)
    if not es:
      continue
    prev = (summaries.get(rel) or {}).get('sum_es') or ''
    # Refresh if new extract is longer, contains cifras, or prior was heuristic/stub
    src_prev = (summaries.get(rel) or {}).get('source')
    if (
      src_prev == 'heuristic'
      or len(es) > len(prev) + 40
      or 'CIFRAS:' in es
      or '187,152' in es
      or '187152' in es
      or '181,155' in es
      or '181155' in es
    ):
      summaries[rel] = {'sum_es': es, 'sum_en': en or paraphrase_en(es), 'source': 'pdf'}
      updated += 1
  return updated

def enrich(index, summaries):
  by_title = index['by_title']
  catalog = json.loads((HUB / 'src/data/catalog.json').read_text())
  # Slim is ALWAYS derived from catalog.json (single source of truth for the
  # file count shown on the site). Previously it was re-read from an older
  # public/catalog_slim.json, which left 25 files out (6,747 vs 6,772).
  slim = [
    {'n': f['name'], 'p': f['path'], 'f': f.get('folder', ''), 'e': f.get('ext', ''),
     't': f.get('theme'), 'y': f.get('year'), 's': f.get('size')}
    for f in catalog['files']
  ]
  matched = 0
  # enrich full catalog
  for f in catalog['files']:
    m = pick_drive_match(f['name'], f.get('folder', ''), by_title)
    if m:
      f['drive_id'] = m['id']
      f['drive_view'] = m['viewUrl']
      f['drive_download'] = m['downloadUrl']
      matched += 1
    s = summaries.get(f['path'])
    if s:
      f['sum_es'] = s['sum_es']
      f['sum_en'] = s['sum_en']
  # enrich slim
  slim_matched = 0
  slim_with_sum = 0
  for r in slim:
    m = pick_drive_match(r['n'], r.get('f', ''), by_title)
    if m:
      r['gid'] = m['id']
      r['dv'] = m['viewUrl']
      r['dd'] = m['downloadUrl']
      slim_matched += 1
    s = summaries.get(r['p'])
    if s:
      r['sum_es'] = s['sum_es']
      r['sum_en'] = s['sum_en']
      slim_with_sum += 1
  index['stats']['matched'] = slim_matched
  return catalog, slim, {
    'catalog_matched': matched,
    'slim_matched': slim_matched,
    'slim_with_sum': slim_with_sum,
    'slim_total': len(slim),
    'catalog_total': len(catalog['files']),
  }

PUBLIC_HIDE_PATH_SUBSTR = ('08_fp_team_research',)

def write_slim_drive(index):
  slim = {}
  for title, items in index['by_title'].items():
    key = title.lower()
    # prefer first; store list compact — never publish F+P participant fichas
    kept = [
      {'id': i['id'], 'dv': i['viewUrl'], 'dd': i['downloadUrl'], 'pg': i.get('path_guess', '')}
      for i in items
      if not any(s in str(i.get('path_guess') or '') for s in PUBLIC_HIDE_PATH_SUBSTR)
    ]
    if kept:
      slim[key] = kept
  # also drop top_folders entry if present
  tf = index.get('top_folders') or {}
  if isinstance(tf, dict):
    for hide in PUBLIC_HIDE_PATH_SUBSTR:
      tf.pop(hide, None)
  return slim

def main():
  PAGES.mkdir(parents=True, exist_ok=True)
  index, page_folders = build_drive_index()
  # pending subfolders for agent
  pending = []
  for f in page_folders:
    pending.append({'id': f['id'], 'title': f.get('title'), 'parentId': f.get('parentId'), 'path_guess': f.get('_path_guess', '') + '/' + f.get('title', '')})
  (HUB / 'scripts/drive_crawl/state/pending_folders.json').write_text(json.dumps(pending, indent=2, ensure_ascii=False))

  catalog = json.loads((HUB / 'src/data/catalog.json').read_text())
  sum_path = HUB / 'src/data/file_summaries.json'
  import os
  if os.environ.get('SKIP_SUMMARIES') == '1' and sum_path.exists():
    print('Reusing existing summaries…')
    summaries = json.loads(sum_path.read_text())
    sum_stats = {'reused': True, 'count': len(summaries)}
  else:
    print('Generating summaries…')
    summaries, sum_stats = generate_summaries(catalog['files'])
    sum_path.write_text(json.dumps(summaries, ensure_ascii=False, indent=1))

  n_econ = refresh_economy_summaries(summaries)
  n_pri = refresh_priority_summaries(summaries)
  sum_path.write_text(json.dumps(summaries, ensure_ascii=False, indent=1))
  sum_stats = dict(sum_stats or {})
  sum_stats['economy_pdf_refreshed'] = n_econ
  sum_stats['priority_pdf_refreshed'] = n_pri
  print(f'Refreshed economy/PIBE PDF summaries: {n_econ}')
  print(f'Refreshed priority theme PDF summaries: {n_pri}')

  catalog2, slim2, match_stats = enrich(index, summaries)
  (HUB / 'src/data/drive_index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1))
  drive_slim = write_slim_drive(index)
  (HUB / 'public/drive_index_slim.json').write_text(json.dumps(drive_slim, ensure_ascii=False))
  (HUB / 'src/data/catalog.json').write_text(json.dumps(catalog2, ensure_ascii=False, indent=1))
  (HUB / 'src/data/catalog_slim.json').write_text(json.dumps(slim2, ensure_ascii=False))
  (HUB / 'public/catalog_slim.json').write_text(json.dumps(slim2, ensure_ascii=False))

  # missing important local PDFs
  drive_titles = {t.lower() for t in index['by_title']}
  missing_pdfs = []
  for f in catalog2['files']:
    if f.get('ext') != 'pdf':
      continue
    if f['folder'] in ('01_planning', '02_water', '03_energy', '06_environment', '07_economy_investment') or f['folder'].startswith('13_'):
      if f['name'].lower() not in drive_titles and not f.get('drive_id'):
        missing_pdfs.append(f['path'])

  report = {
    'drive_files': index['stats']['files'],
    'drive_folders': index['stats']['folders'],
    'pending_subfolders': len(pending),
    'summaries': len(summaries),
    'sum_stats': sum_stats,
    'match_stats': match_stats,
    'missing_priority_pdfs_count': len(missing_pdfs),
    'missing_priority_pdfs_sample': missing_pdfs[:80],
  }
  (HUB / 'scripts/drive_crawl/state/report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
  print(json.dumps(report, indent=2))

if __name__ == '__main__':
  main()
