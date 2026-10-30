#!/usr/bin/env python3
"""Enrich filename-only entries in src/data/file_summaries.json with real extracted text.

For every public catalog file (catalog_slim.json) whose summary is thin (<120 chars) and whose
format has extractable text, read the file on disk and write a short factual summary:
  pdf  -> text of the first pages (pdftotext)        source=extract_pdf
  md/txt/html -> first meaningful lines              source=extract_text
  csv/xlsx/xls -> sheet names, header row, row count, first data row   source=extract_table
  json/geojson/kml -> top-level keys / feature count / placemark names source=extract_struct
Never invents content: the summary is only text present in the file. Images are skipped.
"""
import csv, json, re, subprocess, sys, zipfile
from pathlib import Path

HUB = Path(__file__).resolve().parents[1]
LAKE = HUB.parent
SUMS = HUB / "src/data/file_summaries.json"
SLIM = HUB / "src/data/catalog_slim.json"
TEXT_EXT = {"pdf", "md", "txt", "html", "csv", "xlsx", "xls", "json", "geojson", "kml"}
SKIP = re.compile(r"08_fp_team_research|15_decision_platform|_backups|stakeholder_review|MIES", re.I)


def tidy(s, n=520):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s[:n].rsplit(" ", 1)[0] + "…" if len(s) > n else s


def good_lines(text, n=520):
    text = re.sub(r"\.{4,}\s*\d*", " ", text or "")  # table-of-contents dot leaders
    out = []
    for ln in text.splitlines():
        ln = re.sub(r"<[^>]+>", " ", ln)
        ln = re.sub(r"[#*_`|>]+", " ", ln).strip()
        if len(ln.split()) < 4 or re.fullmatch(r"[\d\W]+", ln):
            continue
        out.append(ln)
        if sum(len(x) for x in out) > n:
            break
    return tidy(" · ".join(out), n)


def ex_pdf(p):
    try:
        t = subprocess.run(["pdftotext", "-l", "3", "-q", str(p), "-"], capture_output=True, text=True, timeout=40).stdout
    except Exception:
        return None
    return good_lines(t)


def ex_text(p):
    try:
        t = p.read_text(encoding="utf-8", errors="replace")[:20000]
    except Exception:
        return None
    if p.suffix.lower() == ".html":
        t = re.sub(r"(?is)<(script|style).*?</\1>", " ", t)
        t = re.sub(r"(?s)<[^>]+>", "\n", t)
    return good_lines(t)


def ex_csv(p):
    try:
        with open(p, encoding="utf-8", errors="replace", newline="") as f:
            rows = []
            for i, r in enumerate(csv.reader(f)):
                if i < 3:
                    rows.append(r)
            n = i + 1 if rows else 0
    except Exception:
        return None
    if not rows:
        return None
    head = ", ".join(c.strip().lstrip("\ufeff") for c in rows[0][:16] if c.strip())
    # column names only: data rows may contain personal data (padrones), never copied
    return tidy(f"Tabla CSV, {max(n - 1, 0)} filas. Columnas: {head}.")


def ex_xlsx(p):
    try:
        import openpyxl
        wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    except Exception:
        return None
    parts = [f"Libro Excel; hojas: {', '.join(wb.sheetnames[:8])}."]
    for ws in wb.worksheets[:2]:
        rows = []
        for r in ws.iter_rows(max_row=8, values_only=True):
            vals = [str(v).strip() for v in r if v not in (None, "")]
            if len(vals) >= 2:  # first multi-cell row = header; data rows are never copied
                rows.append(", ".join(vals[:14]))
                break
            if len(vals) == 1 and not rows:
                parts.append(vals[0][:120])
        if rows:
            parts.append(f"[{ws.title}] columnas: " + rows[0])
    wb.close()
    return tidy(" ".join(parts))


def ex_struct(p):
    ext = p.suffix.lower()
    try:
        t = p.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None
    if ext == ".kml":
        names = re.findall(r"<name>(.*?)</name>", t[:400000], re.S)
        names = [re.sub(r"<!\[CDATA\[|\]\]>", "", x).strip() for x in names if x.strip()]
        if not names:
            return None
        return tidy(f"KML con {len(names)} elementos nombrados: " + ", ".join(names[:15]))
    try:
        d = json.loads(t)
    except Exception:
        return None
    if isinstance(d, dict) and d.get("type") == "FeatureCollection":
        feats = d.get("features") or []
        props = list((feats[0].get("properties") or {}).keys())[:12] if feats else []
        return tidy(f"GeoJSON con {len(feats)} elementos; atributos: {', '.join(props)}")
    if isinstance(d, dict):
        return tidy(f"JSON con claves: {', '.join(list(d.keys())[:20])}")
    if isinstance(d, list):
        k = list(d[0].keys())[:12] if d and isinstance(d[0], dict) else []
        return tidy(f"JSON lista de {len(d)} registros" + (f"; campos: {', '.join(k)}" if k else ""))
    return None


EX = {"pdf": ex_pdf, "md": ex_text, "txt": ex_text, "html": ex_text, "csv": ex_csv, "xlsx": ex_xlsx,
      "xls": None, "json": ex_struct, "geojson": ex_struct, "kml": ex_struct}
SRC = {"pdf": "extract_pdf", "md": "extract_text", "txt": "extract_text", "html": "extract_text", "csv": "extract_table",
       "xlsx": "extract_table", "json": "extract_struct", "geojson": "extract_struct", "kml": "extract_struct"}


def main():
    sums = json.loads(SUMS.read_text(encoding="utf-8"))
    slim = json.loads(SLIM.read_text(encoding="utf-8"))
    done = skipped = 0
    for r in slim:
        p, e = r["p"], (r.get("e") or "").lower()
        if e not in TEXT_EXT or SKIP.search(p) or not EX.get(e):
            continue
        cur = sums.get(p) or {}
        cur_s = cur.get("sum_es") or r.get("sum_es") or ""
        if len(cur_s) >= 120 and cur.get("source") != "heuristic" and not str(cur.get("source", "")).startswith("extract"):
            continue
        fp = LAKE / p
        if not fp.is_file():
            skipped += 1
            continue
        txt = EX[e](fp)
        if not txt or len(txt) < 60:
            skipped += 1
            continue
        title = re.sub(r"[_\-]+", " ", Path(p).stem)
        s = f"{title}: {txt}"
        sums[p] = {"sum_es": s, "sum_en": s, "source": SRC[e]}
        done += 1
        if done % 100 == 0:
            print(done, file=sys.stderr)
    SUMS.write_text(json.dumps(sums, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"enriched": done, "skipped": skipped, "total_summaries": len(sums)}))


if __name__ == "__main__":
    main()
