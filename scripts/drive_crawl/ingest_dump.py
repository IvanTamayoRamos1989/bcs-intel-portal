#!/usr/bin/env python3
import json, re, sys
from pathlib import Path

PAGES = Path('/workspace/BCSFP/11_bcs_hub/scripts/drive_crawl/pages')
QUEUE = Path('/workspace/BCSFP/11_bcs_hub/scripts/drive_crawl/state/bfs_queue.json')
VISITED = Path('/workspace/BCSFP/11_bcs_hub/scripts/drive_crawl/state/bfs_visited.json')
RAW = Path('/workspace/BCSFP/11_bcs_hub/scripts/drive_crawl/state/mcp_raw')
FOLDER_MIME = 'application/vnd.google-apps.folder'
RAW.mkdir(parents=True, exist_ok=True)

def slug(path):
    return re.sub(r'[^A-Za-z0-9._-]+', '_', path.replace('/', '__'))[:120]

def parse_dump(path):
    raw = Path(path).read_text(errors='ignore')
    idx = -1
    for marker in ['{\n  "files"', '{"files"', '{\r\n  "files"']:
        i = raw.find(marker)
        if i >= 0:
            idx = i
            break
    if idx < 0:
        if raw.strip() in ('{}', ''):
            return {'files': []}
        # error payloads
        if '"isError"' in raw or 'Invalid JSON' in raw:
            raise ValueError(f'error dump: {raw[:200]}')
        idx = raw.find('{')
        if idx < 0:
            raise ValueError(f'no json in {path}')
    data = json.loads(raw[idx:])
    if 'files' not in data and isinstance(data.get('result'), dict):
        data = data['result']
    return data

def ingest(dump_path, folder_id, path_guess):
    data = parse_dump(dump_path)
    files_raw = data.get('files') or []
    files = []
    for f in files_raw:
        rec = {
            'id': f['id'],
            'title': f.get('title') or '',
            'mimeType': f.get('mimeType') or '',
            'parentId': f.get('parentId') or folder_id,
        }
        if f.get('fileSize') is not None:
            rec['fileSize'] = str(f['fileSize'])
        files.append(rec)
    (RAW / f'{folder_id}.json').write_text(json.dumps({'files': files}, ensure_ascii=False))
    out = PAGES / f'live_{slug(path_guess)}.json'
    # merge if paginating
    existing = []
    if out.exists() and '--append' in sys.argv:
        existing = json.loads(out.read_text()).get('files', [])
        have = {e['id'] for e in existing}
        files = existing + [f for f in files if f['id'] not in have]
    out.write_text(json.dumps({'path_guess': path_guess, 'files': files}, indent=2, ensure_ascii=False))
    visited = json.loads(VISITED.read_text()) if VISITED.exists() else []
    if folder_id not in visited:
        visited.append(folder_id)
    VISITED.write_text(json.dumps(visited))
    queue = json.loads(QUEUE.read_text()) if QUEUE.exists() else []
    qids = {q['id'] for q in queue} | set(visited)
    added = 0
    for f in files:
        if f['mimeType'] == FOLDER_MIME and f['id'] not in qids:
            queue.append({'id': f['id'], 'path': f"{path_guess}/{f['title']}", 'priority': True})
            qids.add(f['id']); added += 1
    queue = [q for q in queue if q['id'] != folder_id]
    QUEUE.write_text(json.dumps(queue, indent=2))
    token = data.get('nextPageToken') or data.get('next_page_token')
    n_pdf = sum(1 for f in files if 'pdf' in f['mimeType'].lower() or f['title'].lower().endswith('.pdf'))
    n_fold = sum(1 for f in files if f['mimeType'] == FOLDER_MIME)
    print(json.dumps({'path': path_guess, 'n': len(files), 'pdfs': n_pdf, 'folders': n_fold, 'queued': added, 'qlen': len(queue), 'next': token}))

if __name__ == '__main__':
    ingest(sys.argv[1], sys.argv[2], sys.argv[3])
