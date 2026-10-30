#!/usr/bin/env python3
"""One-pass rewrite of user-visible source labels in hand-maintained content (2026-10-08).

Replaces internal lake/repo paths and *.json file names in the portal guides (src/content/guides/*.md)
with plain source labels from scripts/source_labels.py. Idempotent. Generated data files are cleaned by their
generators; `node scripts/check_visible_paths.mjs` (run by `npm run build`) fails the build if anything slips through.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from source_labels import label_for_path, clean_text  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]

HEADERS = [
    ("## Rutas en los datos", "## Fuentes en el acervo"),
    ("### Rutas clave en los datos", "### Fuentes clave en el acervo"),
    ("## Data paths", "## Data sources"),
    ("| Recurso | Ruta |", "| Recurso | Fuente |"),
    ("| Instrumento | Geografía | Status | Ruta / nota |", "| Instrumento | Geografía | Status | Fuente / nota |"),
    ("<span data-lang-es>Ruta en los datos</span><span data-lang-en hidden>Data path</span>",
     "<span data-lang-es>Fuente</span><span data-lang-en hidden>Source</span>"),
]


GUIDE_THEME = {
    "agua": "agua", "ambiente": "ambiente", "conectividad": "puertos y conectividad", "economia": "economía",
    "energia": "energía", "historia": "historia", "planeacion": "planeación", "riesgos": "riesgos",
    "territorio": "territorio",
}
KNOWN = {"conjunto_de_datos_iter_03CSV20.csv": "INEGI ITER 2020, BCS"}
DOC_NAME = {"README": "Nota de la carpeta", "SOURCE_LOG": "Registro de fuentes"}
LAKE_TOKEN = re.compile(r"`((?:\.\./)?(?:\d{2}_[\w-]+|[a-z][a-z_]+)/[^`\s]*|[\w.*-]+\.(?:md|csv|xlsx|zip|kml|yaml|pdf|shp))`")


def _lake_label(tok: str, theme: str) -> str:
    name = tok.rstrip("/").split("/")[-1]
    if name in KNOWN:
        return KNOWN[name]
    lab = label_for_path(tok)
    if lab.endswith("— acervo de datos") and theme:
        lab = lab.replace("— acervo de datos", f"— {theme}")
    return lab


def _doc_title(fname: str) -> str:
    """Readable document name from the file's own name (no invented content)."""
    stem = re.sub(r"\.[A-Za-z0-9]{2,4}$", "", fname)
    if stem in DOC_NAME:
        return DOC_NAME[stem]
    t = stem.replace("_", " ").strip()
    return t[:1].upper() + t[1:]


def clean_guide(s: str, theme: str = "") -> str:
    # sample-document tables: first cell is a raw file name → readable document name
    s = re.sub(r"^\| ([\w.-]+\.(?:md|csv|xlsx|zip|kml|pdf)) \|", lambda m: "| " + _doc_title(m.group(1)) + " |", s, flags=re.M)
    s = s.replace("| <span data-lang-es>Archivo</span><span data-lang-en hidden>File</span> | Ext |",
                  "| <span data-lang-es>Documento</span><span data-lang-en hidden>Document</span> | <span data-lang-es>Formato</span><span data-lang-en hidden>Format</span> |")
    # backticked relative lake paths / file names → plain label
    s = LAKE_TOKEN.sub(lambda m: _lake_label(m.group(1), theme), s)
    # markdown link whose text became a label but href is a relative lake folder → keep text only
    s = re.sub(r"\[(Base de datos BCS 2050 — [^\]]+)\]\((?!https?:|/)[^)]*\)", r"\1", s)
    for a, b in HEADERS:
        s = s.replace(a, b)
    # collapse runs of the same label joined by ", " / " / " / " · "
    s = re.sub(r"(Base de datos BCS 2050 — [^,·/|()\n]+?)(?:(?:, | / | · )\1)+(?=[,·/|()\n .]|$)", r"\1", s)
    s = s.replace("INEGI Censo 2020 ITER BCS (INEGI ITER 2020, BCS)", "INEGI Censo 2020 ITER BCS")
    s = s.replace("INEGI Censo 2020 ITER (INEGI ITER 2020, BCS)", "INEGI Censo 2020 ITER")
    # drop exact-duplicate bullet lines inside one list (several files → same plain label)
    out, seen = [], set()
    for line in s.split("\n"):
        if line.startswith("- "):
            if line in seen:
                continue
            seen.add(line)
        else:
            if line.strip() == "" or not line.startswith("  "):
                seen = set() if line.strip() and not line.startswith("- ") else seen
        out.append(line)
    s = "\n".join(out)
    # figure captions: the <small> already names the real source; drop the internal path line
    s = re.sub(r"<br\s*/?>\s*<code>(?:BCSFP|11_bcs_hub)[^<]*</code>", "", s)
    # backticked internal paths / json names → plain label
    s = re.sub(r"`((?:BCSFP|11_bcs_hub|src/data)[^`]*)`", lambda m: label_for_path(m.group(1)), s)
    s = re.sub(r"`/?([\w-]+\.(?:json|geojson))`", lambda m: clean_text(m.group(1)), s)
    s = s.replace(" (si presente en lake)", "").replace(" (if present in lake)", "")
    return clean_text(s)


def main():
    n = 0
    for p in sorted((ROOT / "src/content/guides").glob("*.md")):
        old = p.read_text(encoding="utf-8")
        new = clean_guide(old, GUIDE_THEME.get(p.stem, ""))
        if new != old:
            p.write_text(new, encoding="utf-8")
            n += 1
            print("cleaned", p.relative_to(ROOT))
    print(f"guides changed: {n}")


if __name__ == "__main__":
    main()
