#!/usr/bin/env python3
"""Append files added to the data lake after the last full scan (build_catalog.py) to catalog.json and catalog_slim.json
without a rescan, so Drive links already in the catalogue are kept. Usage: add_catalog_files.py <relpath> [...]"""
import json, re, sys, os
from collections import Counter
from datetime import date
from pathlib import Path

HUB = Path(__file__).resolve().parents[1]
LAKE = HUB.parent
D = HUB / "src/data"


def main(paths):
    cat = json.loads((D / "catalog.json").read_text(encoding="utf-8"))
    slim = json.loads((D / "catalog_slim.json").read_text(encoding="utf-8"))
    have = {f["path"] for f in cat["files"]}
    theme_by_folder = {}
    for f in cat["files"]:
        theme_by_folder.setdefault(f["folder"], Counter())[f.get("theme")] += 1
    added = 0
    for p in paths:
        fp = LAKE / p
        if p in have or not fp.is_file():
            continue
        folder = p.split("/")[0]
        m = re.match(r"(\d{4})", fp.name)
        e = {"path": p, "folder": folder, "ext": fp.suffix.lower().lstrip("."), "size": fp.stat().st_size,
             "mtime": date.fromtimestamp(fp.stat().st_mtime).isoformat(),
             "theme": theme_by_folder.get(folder, Counter({None: 1})).most_common(1)[0][0], "name": fp.name,
             "year": int(m.group(1)) if m and 1900 < int(m.group(1)) < 2100 else None}
        cat["files"].append(e)
        slim.append({"n": e["name"], "p": p, "f": folder, "e": e["ext"], "t": e["theme"], "y": e["year"], "s": e["size"]})
        added += 1
    (D / "catalog.json").write_text(json.dumps(cat, ensure_ascii=False), encoding="utf-8")
    (D / "catalog_slim.json").write_text(json.dumps(slim, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"added": added}))


if __name__ == "__main__":
    main(sys.argv[1:])
