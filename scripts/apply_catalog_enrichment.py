#!/usr/bin/env python3
"""Apply file_summaries.json + catalog_exclusions.json to catalog.json / catalog_slim.json / folders_summary.json
in place (no rescan, keeps Drive links). Same merge rule as build_drive_and_summaries.enrich().
Run after enrich_file_summaries.py and enrich_thin_entries.py."""
import json
from collections import Counter
from pathlib import Path

HUB = Path(__file__).resolve().parents[1]
D = HUB / "src/data"
P = HUB / "public"


def main():
    cat = json.loads((D / "catalog.json").read_text(encoding="utf-8"))
    slim_old = {r["p"]: r for r in json.loads((D / "catalog_slim.json").read_text(encoding="utf-8"))}
    sums = json.loads((D / "file_summaries.json").read_text(encoding="utf-8"))
    ex = json.loads((D / "catalog_exclusions.json").read_text(encoding="utf-8")).get("paths", {}) if (D / "catalog_exclusions.json").exists() else {}
    man = {}
    if (HUB / "scripts/drive_links_manual.json").exists():  # Drive ids found/uploaded on 2026-10-05 (by file name)
        dm = json.loads((HUB / "scripts/drive_links_manual.json").read_text(encoding="utf-8"))
        man = {**dm.get("existing", {}), **dm.get("uploaded", {})}
    before = len(cat["files"])
    files = [f for f in cat["files"] if f["path"] not in ex]
    for f in files:
        if not f.get("drive_id") and not slim_old.get(f["path"], {}).get("gid") and f["name"] in man:
            g = man[f["name"]]
            f["drive_id"], f["drive_view"] = g, f"https://drive.google.com/file/d/{g}/view"
            f["drive_download"] = f"https://drive.google.com/uc?export=download&id={g}"
        s = sums.get(f["path"])
        if s:
            f["sum_es"], f["sum_en"] = s["sum_es"], s.get("sum_en", "")
    slim = []
    for f in files:
        o = slim_old.get(f["path"], {})
        r = {"n": f["name"], "p": f["path"], "f": f.get("folder", ""), "e": f.get("ext", ""), "t": f.get("theme"),
             "y": f.get("year"), "s": f.get("size")}
        gid = f.get("drive_id") or o.get("gid")
        if gid:
            r["gid"] = gid
            r["dv"] = f.get("drive_view") or o.get("dv") or f"https://drive.google.com/file/d/{gid}/view"
            r["dd"] = f.get("drive_download") or o.get("dd") or f"https://drive.google.com/uc?export=download&id={gid}"
        if f.get("sum_es") or o.get("sum_es"):
            r["sum_es"] = f.get("sum_es") or o.get("sum_es")
            r["sum_en"] = f.get("sum_en", o.get("sum_en", ""))
        slim.append(r)
    sm = cat["summary"]
    ext = Counter(f["ext"] for f in files)
    folder = Counter(f["folder"] for f in files)
    theme = Counter(f["theme"] for f in files)
    sm.update(total_files=len(files), pdf_count=ext.get("pdf", 0), md_count=ext.get("md", 0), csv_count=ext.get("csv", 0),
              folder_counts=dict(folder), ext_counts=dict(ext.most_common()), theme_counts=dict(theme))
    sm["folders"] = [dict(fr, count=folder.get(fr["id"], 0)) for fr in sm.get("folders", []) if folder.get(fr["id"], 0)]
    sm["excluded_from_public_catalog"] = {"total": len(ex),
                                          "non_document": sum(1 for v in ex.values() if v["reason"] == "non_document"),
                                          "no_content": sum(1 for v in ex.values() if v["reason"] == "no_content"),
                                          "superseded": sum(1 for v in ex.values() if v["reason"] == "superseded")}
    cat["files"] = files
    (D / "catalog.json").write_text(json.dumps(cat, ensure_ascii=False), encoding="utf-8")
    (P / "catalog.json").write_text(json.dumps(cat, ensure_ascii=False), encoding="utf-8")
    for d in (D, P):
        (d / "folders_summary.json").write_text(json.dumps(sm, ensure_ascii=False, indent=2), encoding="utf-8")
        (d / "catalog_slim.json").write_text(json.dumps(slim, ensure_ascii=False), encoding="utf-8")
    thin = sum(1 for r in slim if len(r.get("sum_es") or "") < 120)
    print(json.dumps({"before": before, "after": len(files), "excluded": before - len(files), "slim": len(slim),
                      "with_summary_ge120": len(slim) - thin, "still_thin": thin,
                      "with_drive_link": sum(1 for r in slim if r.get("gid"))}))


if __name__ == "__main__":
    main()
