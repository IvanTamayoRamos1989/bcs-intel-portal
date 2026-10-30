#!/usr/bin/env python3
import json, sys, re
from pathlib import Path
PAGES = Path("/workspace/BCSFP/11_bcs_hub/scripts/drive_crawl/pages")
QUEUE = Path("/workspace/BCSFP/11_bcs_hub/scripts/drive_crawl/state/bfs_queue.json")
VISITED = Path("/workspace/BCSFP/11_bcs_hub/scripts/drive_crawl/state/bfs_visited.json")
FOLDER_MIME = "application/vnd.google-apps.folder"

def slug(path):
    s = path.replace("/", "__")
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s)[:120] or "root"

def main():
    path_guess = sys.argv[1]
    folder_id = sys.argv[2]
    lines = sys.stdin.read().splitlines()
    files = []
    for line in lines:
        if not line.strip():
            continue
        parts = line.split("\t")
        # id title mime parent [size]
        fid, title, mime, parent = parts[0], parts[1], parts[2], parts[3]
        rec = {"id": fid, "title": title, "mimeType": mime, "parentId": parent}
        if len(parts) > 4 and parts[4]:
            rec["fileSize"] = parts[4]
        files.append(rec)
    out = PAGES / f"live_{slug(path_guess)}.json"
    out.write_text(json.dumps({"path_guess": path_guess, "files": files}, indent=2, ensure_ascii=False))
    visited = json.loads(VISITED.read_text()) if VISITED.exists() else []
    if folder_id not in visited:
        visited.append(folder_id)
    VISITED.write_text(json.dumps(visited))
    queue = json.loads(QUEUE.read_text()) if QUEUE.exists() else []
    qids = {q["id"] for q in queue}
    added = 0
    for f in files:
        if f["mimeType"] == FOLDER_MIME and f["id"] not in visited and f["id"] not in qids:
            queue.append({"id": f["id"], "path": f"{path_guess}/{f['title']}", "priority": True})
            qids.add(f["id"]); added += 1
    queue = [q for q in queue if q["id"] != folder_id]
    QUEUE.write_text(json.dumps(queue, indent=2))
    n_pdf = sum(1 for f in files if "pdf" in f["mimeType"].lower() or f["title"].lower().endswith(".pdf"))
    n_fold = sum(1 for f in files if f["mimeType"] == FOLDER_MIME)
    print(json.dumps({"wrote": str(out.name), "n": len(files), "pdfs": n_pdf, "folders": n_fold, "queued": added, "qlen": len(queue)}))

if __name__ == "__main__":
    main()
