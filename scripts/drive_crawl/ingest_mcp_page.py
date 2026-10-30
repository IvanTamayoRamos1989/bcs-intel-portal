#!/usr/bin/env python3
"""Ingest MCP search_files JSON into a crawl page and update BFS queue."""
import json, sys, re, hashlib
from pathlib import Path

FOLDER_MIME = "application/vnd.google-apps.folder"
PAGES = Path("/workspace/BCSFP/11_bcs_hub/scripts/drive_crawl/pages")
QUEUE = Path("/workspace/BCSFP/11_bcs_hub/scripts/drive_crawl/state/bfs_queue.json")
VISITED = Path("/workspace/BCSFP/11_bcs_hub/scripts/drive_crawl/state/bfs_visited.json")
RAW = Path("/workspace/BCSFP/11_bcs_hub/scripts/drive_crawl/state/mcp_raw")

def slug(path: str) -> str:
    s = path.replace("/", "__")
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", s)
    return s[:120] or "root"

def normalize(f, parent_id):
    out = {
        "id": f["id"],
        "title": f.get("title") or f.get("name") or "",
        "mimeType": f.get("mimeType") or "",
        "parentId": f.get("parentId") or parent_id,
    }
    if f.get("fileSize") is not None:
        out["fileSize"] = str(f["fileSize"])
    elif f.get("size") is not None:
        out["fileSize"] = str(f["size"])
    return out

def main():
    if len(sys.argv) < 3:
        print("usage: ingest_mcp_page.py <folder_id> <path_guess> [raw.json]")
        sys.exit(2)
    folder_id = sys.argv[1]
    path_guess = sys.argv[2]
    raw_path = Path(sys.argv[3]) if len(sys.argv) > 3 else RAW / f"{folder_id}.json"
    data = json.loads(raw_path.read_text())
    files_raw = data.get("files") or data.get("Files") or []
    # also accept bare list
    if isinstance(data, list):
        files_raw = data
    files = [normalize(f, folder_id) for f in files_raw]
    page = {"path_guess": path_guess, "files": files}
    out = PAGES / f"live_{slug(path_guess)}.json"
    out.write_text(json.dumps(page, indent=2, ensure_ascii=False))
    # update visited + queue subfolders
    visited = json.loads(VISITED.read_text()) if VISITED.exists() else []
    if folder_id not in visited:
        visited.append(folder_id)
    VISITED.write_text(json.dumps(visited))
    queue = json.loads(QUEUE.read_text()) if QUEUE.exists() else []
    qids = {q["id"] for q in queue}
    added = 0
    for f in files:
        if f["mimeType"] == FOLDER_MIME and f["id"] not in visited and f["id"] not in qids:
            child_path = f"{path_guess}/{f['title']}".strip("/")
            queue.append({"id": f["id"], "path": child_path, "priority": True})
            qids.add(f["id"])
            added += 1
    # remove this folder from queue if present
    queue = [q for q in queue if q["id"] != folder_id]
    QUEUE.write_text(json.dumps(queue, indent=2))
    n_files = sum(1 for f in files if f["mimeType"] != FOLDER_MIME)
    n_folders = sum(1 for f in files if f["mimeType"] == FOLDER_MIME)
    n_pdf = sum(1 for f in files if "pdf" in f["mimeType"].lower() or f["title"].lower().endswith(".pdf"))
    token = data.get("nextPageToken") or data.get("next_page_token") or data.get("nextPage") 
    print(json.dumps({
        "wrote": str(out),
        "path": path_guess,
        "files": n_files,
        "folders": n_folders,
        "pdfs": n_pdf,
        "queued_subfolders": added,
        "queue_len": len(queue),
        "next_page_token": token,
    }))

if __name__ == "__main__":
    main()
