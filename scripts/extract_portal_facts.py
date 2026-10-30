#!/usr/bin/env python3
"""Parse markdown tables in src/content/guides/*.md → structured portal facts.

Writes:
  - src/data/portal_facts.json
  - public/portal_facts.json

Each fact: {id, metric, value, unit, year, source, path, theme}
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUIDES = ROOT / "src" / "content" / "guides"
OUT_SRC = ROOT / "src" / "data" / "portal_facts.json"
OUT_PUB = ROOT / "public" / "portal_facts.json"

# Themes we care about for P1 (turismo facts live inside economia tables)
THEME_OK = {
    "economia",
    "agua",
    "energia",
    "proyectos-federales",
    "conectividad",
    "riesgos",
    "territorio",
    "planeacion",
    "ambiente",
    "historia",
}

# Skip pure file-inventory / path tables
SKIP_HEADER_HINTS = (
    "archivo",
    "ruta en",
    "ext",
    "data path",
    "path in",
    "file",
)


def strip_md(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\*\*|__|`+", "", s)
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_tables(text: str):
    """Yield (header_cells, row_cells_list) for GFM tables."""
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip().startswith("|"):
            i += 1
            continue
        block = []
        while i < len(lines) and lines[i].strip().startswith("|"):
            block.append(lines[i])
            i += 1
        if len(block) < 3:
            continue
        def cells(ln: str):
            parts = [c.strip() for c in ln.strip().strip("|").split("|")]
            return parts
        header = cells(block[0])
        sep = block[1]
        if not re.match(r"^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$", sep.strip()):
            continue
        rows = [cells(r) for r in block[2:] if not re.match(r"^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$", r.strip())]
        # normalize width
        width = len(header)
        rows = [r + [""] * (width - len(r)) if len(r) < width else r[:width] for r in rows]
        yield header, rows


def guess_year(*parts: str) -> str | None:
    blob = " ".join(parts)
    years = re.findall(r"\b(20[1-3]\d)\b", blob)
    return years[-1] if years else None


def guess_unit(value: str, metric: str) -> str:
    v = value.lower()
    m = metric.lower()
    if "hm³" in value or "hm3" in v or "hm³" in m:
        return "hm³/año"
    if "mdp" in v or "millones de pesos" in v or "m mxn" in v:
        return "millones de pesos"
    if "mdd" in v or "millones de dólares" in v:
        return "millones de dólares"
    if "%" in value:
        return "%"
    if "mw" in v or "mwh" in v:
        return "MW"
    if "habit" in v or "hab." in v:
        return "habitantes"
    if "pasajer" in v:
        return "pasajeros"
    if "hotel" in m or "habitacion" in m or "cuartos" in m:
        return "cuartos" if "habitacion" in m or "cuarto" in m else ""
    return ""


def is_numericish(val: str) -> bool:
    return bool(re.search(r"\d", val)) and not re.match(r"^https?://", val, re.I)


def row_to_facts(theme: str, path: str, header: list[str], row: list[str], section: str):
    """Emit one or more facts from a table row."""
    hlow = [strip_md(h).lower() for h in header]
    if any(any(s in h for s in SKIP_HEADER_HINTS) for h in hlow):
        return []
    cells = [strip_md(c) for c in row]
    if not any(cells):
        return []

    facts = []
    # 2-col metric|value
    if len(header) == 2 and is_numericish(cells[1]):
        metric = cells[0]
        value = cells[1]
        if len(metric) < 2:
            return []
        facts.append(
            {
                "metric": metric,
                "value": value,
                "unit": guess_unit(value, metric),
                "year": guess_year(metric, value, section),
                "source": f"guides/{theme}.md",
                "path": path,
                "theme": "turismo" if theme == "economia" and re.search(r"hotel|habitacion|cuarto|ocupaci|turis|setue", metric + value + section, re.I) else theme,
            }
        )
        return facts

    # Wide tables: first col = entity, other numeric cols = metrics
    entity = cells[0]
    for hi, h in enumerate(header[1:], start=1):
        if hi >= len(cells):
            break
        val = cells[hi]
        if not is_numericish(val):
            continue
        # skip pure path/ext columns already filtered
        metric = f"{strip_md(h)} — {entity}" if entity else strip_md(h)
        facts.append(
            {
                "metric": metric,
                "value": val,
                "unit": guess_unit(val, h + " " + entity),
                "year": guess_year(h, val, entity, section),
                "source": f"guides/{theme}.md",
                "path": path,
                "theme": "turismo"
                if theme == "economia"
                and re.search(r"hotel|habitacion|cuarto|ocupaci|turis|setue", metric + val + section, re.I)
                else theme,
            }
        )
    return facts


def extract_guide(md_path: Path) -> list[dict]:
    theme = md_path.stem
    if theme not in THEME_OK:
        return []
    text = md_path.read_text(encoding="utf-8")
    if text.startswith("---"):
        parts = text.split("---", 2)
        text = parts[2] if len(parts) >= 3 else text

    # section headings for year/context
    sections = re.split(r"\n(?=##\s)", text)
    out = []
    for si, sec in enumerate(sections):
        heading = ""
        lines = sec.splitlines()
        if lines and lines[0].startswith("#"):
            heading = lines[0].lstrip("#").strip()
        for header, rows in parse_tables(sec):
            for ri, row in enumerate(rows):
                for fact in row_to_facts(theme, f"guides/{md_path.name}#{si}", header, row, heading):
                    out.append(fact)
    return out


def slug(s: str) -> str:
    s = (
        s.lower()
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s[:48] or "fact"


def main():
    facts = []
    for md in sorted(GUIDES.glob("*.md")):
        facts.extend(extract_guide(md))

    # Dedup by theme+metric+value
    seen = set()
    uniq = []
    for f in facts:
        key = (f["theme"], f["metric"].lower(), re.sub(r"\s+", "", f["value"]))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(f)

    # Prefer themes requested in P1; keep others but mark
    priority = {"economia", "agua", "energia", "proyectos-federales", "turismo", "conectividad", "riesgos", "territorio"}
    ranked = [f for f in uniq if f["theme"] in priority] + [f for f in uniq if f["theme"] not in priority]

    final = []
    for i, f in enumerate(ranked):
        fid = f"fact:{f['theme']}:{slug(f['metric'])}:{i}"
        final.append({"id": fid, **f})

    # --- federal projects addon ---
    _addon_path = Path("/workspace/BCSFP/13_federal_projects/_portal_facts_addon.json")
    if _addon_path.exists():
        try:
            _addon = json.loads(_addon_path.read_text(encoding="utf-8"))
            existing_ids = {f.get("id") for f in final}
            for f in _addon:
                if f.get("id") not in existing_ids:
                    final.append(f)
            print(f"federal_addon_merged={sum(1 for f in final if str(f.get('id','')).startswith('fed-'))}")
        except Exception as e:
            print("federal addon skip:", e)

    OUT_SRC.parent.mkdir(parents=True, exist_ok=True)
    OUT_PUB.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "generated_from": "src/content/guides/*.md + 13_federal_projects",
        "count": len(final),
        "facts": final,
    }
    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    OUT_SRC.write_text(raw, encoding="utf-8")
    OUT_PUB.write_text(raw, encoding="utf-8")

    by = {}
    for f in final:
        by[f.get("theme") or "?"] = by.get(f.get("theme") or "?", 0) + 1
    print(f"portal_facts={len(final)} by_theme={by}")
    # sanity: economia should have PIB
    pib = [f for f in final if "187,152" in f.get("value","") or "187152" in f.get("value","").replace(",", "").replace(" ", "")]
    print(f"pib_187152_facts={len(pib)}")
    agua = [f for f in final if f.get("theme") == "agua"]
    print(f"agua_facts={len(agua)} sample={agua[0].get('metric') if agua else None}")


if __name__ == "__main__":
    main()
