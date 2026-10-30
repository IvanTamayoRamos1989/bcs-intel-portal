#!/usr/bin/env python3
"""Plain, human source labels for internal data paths / file names (2026-10-08).

Never shown to users: lake paths (BCSFP/…), repo paths (11_bcs_hub, src/data/…) or *.json file names.
`label_for_path()` returns the real institution / dataset / year when the file name encodes it
(convention `YYYY[-MM[-DD]]_<Institución>_<Título>.ext`), otherwise the generic portal label
"Base de datos BCS 2050 — <tema>". Nothing is invented: the label only re-uses what the file name says.
`label_for_json()` maps portal data files to the real underlying source where it is documented.
"""
from __future__ import annotations

import re

GENERIC = "Base de datos BCS 2050"

FOLDER_THEME = {
    "00_catalog": "catálogo", "01_planning": "planeación", "02_water": "agua", "03_energy": "energía",
    "04_mobility_waste": "movilidad y residuos", "05_demographics": "población", "06_environment": "ambiente",
    "07_economy_investment": "economía e inversión", "09_shadow_programme": "estudios temáticos",
    "10_data_lake": "acervo de datos", "11_bcs_hub": "portal", "12_ontology": "ontología",
    "13_federal_projects": "proyectos federales", "13_library": "biblioteca",
    "13_territorial_intelligence": "inteligencia territorial", "14_gis_atlas": "atlas SIG",
    "14_gobierno": "gobierno", "15_decision_platform": "estrategia", "16_escorrentia": "escorrentía",
    "17_insumos_capacidad": "insumos de capacidad",
}
SUB_THEME = {
    "ports_demand": "puertos y demanda", "plans": "planes", "plans_archive": "archivo de planes",
    "fiscal": "finanzas públicas", "hazards": "riesgos", "histories": "historia", "land_tenure": "tenencia de la tierra",
    "ssn_cenapred": "sismicidad", "atlas_riesgos_bcs": "riesgos", "poerbcs_shapes": "ordenamiento ecológico (POERBCS)",
    "maps": "mapas", "guide_assets": "mapas", "catastro_implan": "catastro", "connectivity": "conectividad aérea",
    "communities": "comunidades", "gis": "capa SIG", "stills": "imágenes del territorio",
    "tourism_assets": "turismo", "data": "acervo de datos",
}
ORG_FIX = {"Gobierno-BCS": "Gobierno de BCS", "Finanzas-BCS": "Finanzas BCS", "Congreso-BCS": "Congreso de BCS",
           "BOGE-BCS": "Boletín Oficial BCS", "SECTUR-DataTur": "SECTUR DataTur", "SETUE-BCS": "SETUE BCS",
           "Gobierno-BCS-UABCS": "Gobierno de BCS y UABCS"}

# Portal data files → documented underlying source (only where the portal states it)
JSON_LABEL = {
    "municipios.json": f"{GENERIC} — municipios",
    "aquifers_bcs.json": "CONAGUA — disponibilidad media anual de acuíferos (DOF 2023)",
    "escorrentia.json": "Modelo de terreno HydroSHEDS / HydroRIVERS",
    "flight_connections_bcs.json": "FlightConnections.com — rutas sin escalas (consultado 2026-09-17)",
    "ports_demand.json": f"{GENERIC} — puertos y demanda",
    "stills_points.json": f"{GENERIC} — imágenes del territorio",
    "growth_demand_supply.json": f"{GENERIC} — demanda y oferta de crecimiento",
    "tourism_detail.json": f"{GENERIC} — turismo",
    "data_gaps.json": f"{GENERIC} — brechas de datos",
    "stills_intelligence.json": f"{GENERIC} — análisis de imágenes del territorio",
    "news.json": f"{GENERIC} — noticias",
    "foresights.json": f"{GENERIC} — prospectiva",
    "catalog.json": f"{GENERIC} — catálogo de documentos",
    "portals.json": f"{GENERIC} — catastro",
    "graph.json": f"{GENERIC} — ontología",
    "ontology_graph.json": f"{GENERIC} — ontología",
    "portal_facts.json": f"{GENERIC} — cifras del portal",
    "osm_municipalities.geojson": "OpenStreetMap — límites municipales",
}


def _theme(parts: list[str]) -> str:
    theme = ""
    for p in parts:
        if p in FOLDER_THEME and not theme:
            theme = FOLDER_THEME[p]
        if p in SUB_THEME:
            theme = SUB_THEME[p]
    return theme or "acervo de datos"


def label_for_file(name: str) -> str | None:
    """Institution — title (year) from `YYYY[-MM[-DD]]_<Org>_<Title>.ext`; None if the name has no such info."""
    stem = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", name)
    m = re.match(r"^(\d{4})(-\d{4}|-\d{2}(?:-\d{2})?)?_([^_]+)_(.+)$", stem)
    if not m:
        return None
    year, rng, org, title = m.groups()
    if rng and len(rng) == 5:
        year = f"{year}–{rng[1:]}"
    unverified = bool(re.search(r"UNVERIFIED", title))
    title = re.sub(r"[-_]?image-only[-_]?UNVERIFIED", "", title)
    title = re.sub(r"[-_ .…]*(?:\.\.\.|…|\.\.)[-_ .…]*$", "", title).strip(" .-_")
    if not re.search(r"[A-Za-zÁÉÍÓÚáéíóúÑñ]{2}", title):
        return None
    title = re.sub(r"[-_]+", " ", title).strip()
    org = ORG_FIX.get(org, org.replace("-", " "))
    lab = f"{org} — {title} ({year})"
    return lab + (" — sin verificar" if unverified else "")


def label_for_path(path: str) -> str:
    p = re.sub(r"#.*$", "", str(path).strip().strip("`")).replace("\\\\", "\\")
    parts = [x for x in re.split(r"[\\/]+", p) if x]
    if parts and parts[0] in ("BCSFP", "src", "public"):
        parts = parts[1:]
    name = parts[-1] if parts and "." in parts[-1] and not p.endswith(("\\", "/")) else ""
    if name in JSON_LABEL:
        return JSON_LABEL[name]
    if name and "*" not in name:
        lab = label_for_file(name)
        if lab:
            return lab
    th = _theme(parts[:-1] if name else parts)
    if name and name.endswith((".json", ".geojson")) and "*" not in name:
        return label_for_json(name)
    if "guide_assets" in parts or (name and name.lower().endswith((".jpg", ".png", ".webp"))):
        return f"{GENERIC} — galería de mapas"
    return f"{GENERIC} — {th}"


def label_for_json(name: str) -> str:
    if name in JSON_LABEL:
        return JSON_LABEL[name]
    return f"{GENERIC} — capa SIG" if name.endswith(".geojson") else f"{GENERIC} — datos del portal"


PATH_RE = re.compile(r"(?:BCSFP[\\/]|11_bcs_hub[\\/]|src/data/|public/(?=[\w*])|(?<![\w/.-])\d{2}_[a-z][a-z_]+[\\/])[^\s`|<>\"')\]]*(?: (?!BCSFP|11_bcs_hub|src/|public/)[A-Z][^\s`|<>\"')\]\\/]*[\\/][^\s`|<>\"')\]]*)*")


def clean_text(s: str) -> str:
    """Replace any internal path in free text by its plain label (used for data strings)."""
    s = PATH_RE.sub(lambda m: label_for_path(m.group(0)), s)
    s = re.sub(r"(?<![\w/.-])/?([\w-]+\.(?:json|geojson))\b", lambda m: label_for_json(m.group(1)), s)
    s = DOC_RE.sub(_doc, s)
    return _tidy(s)


FILE_LABEL = {
    "communities_master.csv": f"{GENERIC} — comunidades",
    "top_localities_by_municipio.csv": f"{GENERIC} — localidades principales por municipio",
    "settlement_hierarchy.md": f"{GENERIC} — jerarquía de asentamientos",
    "fiscal_municipal.md": f"{GENERIC} — finanzas municipales",
    "strengths_opportunities.md": f"{GENERIC} — fortalezas y oportunidades",
    "plans_master.csv": f"{GENERIC} — archivo de planes",
    "plans_by_community.md": f"{GENERIC} — planes por comunidad",
    "plans_timeline.md": f"{GENERIC} — cronología de planes",
}
DOC_RE = re.compile(r"(?<![\w/.-])`?(_?[\w-]+\.(md|csv|xlsx))`?(?![\w/])")


def _doc(m) -> str:
    name, ext = m.group(1), m.group(2)
    if name in FILE_LABEL:
        return FILE_LABEL[name]
    return f"{GENERIC} — " + ("nota de trabajo" if ext == "md" else "tabla de datos")


def _tidy(s: str) -> str:
    """Drop repeated ' · ' segments and the generic municipios label when INEGI is already cited."""
    s = re.sub(r"`(Base de datos BCS 2050 — [^`]+)`", r"\1", s)
    if " · " not in s:
        return s
    segs, out = s.split(" · "), []
    for g in segs:
        if g.strip() and g.strip() in [o.strip() for o in out]:
            continue
        out.append(g)
    if any("INEGI" in g for g in out):
        out = [g for g in out if g.strip() != f"{GENERIC} — municipios"] or out
    return " · ".join(out)


if __name__ == "__main__":
    import sys
    for a in sys.argv[1:]:
        print(a, "→", label_for_path(a))


# ---- display-field cleaning for data JSON (2026-10-08) -------------------------------------
# Only free-text fields that pages/chat show to people. Location fields (path, desktop, file,
# href, url, evidence_path, …) are left intact for links/loaders; components label them on render
# via src/lib/sourceLabel.ts.
DISPLAY_KEYS = {
    "sum_es", "sum_en", "note", "note_es", "note_en", "wishlist_note_es", "wishlist_note_en",
    "source", "sources", "source_es", "source_en", "sources_es", "sources_en",
    "next_evidence_es", "next_evidence_en", "summary", "summary_es", "summary_en",
    "evidence_missing_es", "evidence_missing_en", "tag_note_es", "tag_note_en",
    "method", "caveat", "method_note_es", "method_note_en", "metric", "locks_es", "locks_en",
}
VALUE_KEY_FILES = {"portal_facts.json"}  # here `value` is display text too


def clean_display(obj, keys=DISPLAY_KEYS, _key=None):
    if isinstance(obj, dict):
        return {k: clean_display(v, keys, k) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_display(v, keys, _key) for v in obj]
    if isinstance(obj, str) and _key in keys:
        out = clean_text(obj)
        return out.replace("Evidence in BCSFP", "Evidence in the portal").replace("Evidencia en BCSFP", "Evidencia en el portal")
    return obj


# ---- human titles for chat source cards (2026-10-08) ----------------------------------------
# Order: lake catalog metadata (title/issuer/date) → document heading from the indexed summary
# (text documents) → "Datos BCS — <name> (year)" for state open-data files → "Institución — Título (año)"
# from dated file names → generic "Documento del acervo BCS 2050 — <tema>". Never a raw file name.
DOC_FALLBACK = "Documento del acervo BCS 2050"
FILENAME_RE = re.compile(
    r"\.(pdf|md|csv|tsv|xlsx?|json|geojson|zip|kml|kmz|docx?|pptx?|txt|py|mjs|ya?ml|shp|dbf|prj|esp|html?|jpe?g|png|webp)\b"
    r"|_|^\d{4}(-\d{2}){0,2}[ _-]?_", re.I)
THEME_ES = {
    "agua": "agua", "energia": "energía", "economia": "economía", "demografia": "población", "catalogo": "catálogo",
    "data_lake": "acervo de datos", "ambiente": "ambiente", "planeacion": "planeación", "territorio": "territorio",
    "inteligencia_territorial": "inteligencia territorial", "portal": "portal", "programa": "estudios temáticos",
    "proyectos_federales": "proyectos federales", "conectividad": "conectividad", "ontologia": "ontología",
    "mapas": "mapas", "biblioteca": "biblioteca", "movilidad": "movilidad", "riesgos": "riesgos",
}
_HEAD_BLOCK = re.compile(
    r"CopyFromBox|subagent|executor|\bParent\b|cursor|\bMCP\b|NotebookLM|Desktop|\bbox\b|README|FAILED|stackTrace|"
    r"Google Drive|\bDrive\b|error|^[{<\[]|^https?:|^Source:|^Fuente:|^\W|F\+P|P20153|BCSFP|Earth Studio|\bESP\b|"
    r"\(Ivan\)|client-side|Shadow programme|working session|\b\d{2} [a-z]+ intelligence|Steering Committee|tesseract|"
    r"\bOCR\b|Page not found|domain is for use|^PK\b|[\x00-\x08\ufffd]|^Gobierno del estado de baja california sur$|"
    r"Sistema Electr[oó]nico|DIARIO OFICIAL$|^DOF - Diario Oficial|^I\. |folder id|^Searches performed|^Source filter|"
    r"ON HOLD|DOWNLOADED|CONFIRMED|Talking points|^Index\b|Data lake|data lake", re.I)
_PLACES = ("Baja California Sur", "Comondú", "La Paz", "Loreto", "Los Cabos", "Mulegé", "México", "Todos Santos",
           "San José del Cabo", "Cabo San Lucas", "Guerrero Negro", "Santa Rosalía", "Ciudad Constitución")
_TEXT_EXT = (".md", ".txt", ".doc", ".docx", ".html", ".htm")


def theme_label(theme: str | None, path: str = "") -> str:
    if theme and theme in THEME_ES:
        return THEME_ES[theme]
    parts = [x for x in re.split(r"[\\/]+", path or "") if x]
    return _theme(parts[:-1]) if parts else "acervo de datos"


def _sentence(s: str) -> str:
    s = re.sub(r"\s+", " ", s.replace("_", " ")).strip(" -—·:")
    letters = [ch for ch in s if ch.isalpha()]
    if letters and sum(ch.isupper() for ch in letters) / len(letters) > 0.8 and len(letters) > 6:
        s = s.lower()
        s = s[:1].upper() + s[1:]
        for tok in ("bcs", "inegi", "conagua", "dof", "boge", "cfe", "cenace", "sener", "imss", "semarnat", "sectur", "setue"):
            s = re.sub(rf"\b{tok}\b", tok.upper(), s)
        for pl in _PLACES:
            s = re.sub(re.escape(pl), pl, s, flags=re.I)
    return s.rstrip(" ,;")


def _cut(s: str, n: int = 100) -> str:
    if len(s) <= n:
        return s
    cut = s[:n].rsplit(" ", 1)[0].rstrip(" ,;:-—")
    return cut + "…"


def load_doc_meta(lake_root) -> dict:
    """filename → {title, issuer, date} from the lake catalogs (00_catalog/CATALOG*.csv)."""
    import csv
    from pathlib import Path
    meta = {}
    for f in sorted(Path(lake_root).glob("00_catalog/CATALOG*.csv")):
        try:
            with open(f, encoding="utf-8", newline="") as fh:
                for row in csv.DictReader(fh):
                    fn = (row.get("filename") or "").strip()
                    t = (row.get("title") or "").strip()
                    if fn and t:
                        meta[fn] = {"title": t, "issuer": (row.get("issuer") or "").strip(),
                                    "date": (row.get("doc_date") or "").strip()}
        except Exception:
            continue
    return meta


def human_doc_title(name: str, path: str = "", sum_es: str = "", theme: str | None = None, meta: dict | None = None) -> str:
    name = (name or (path or "").replace("\\", "/").split("/")[-1] or "").strip()
    fallback = f"{DOC_FALLBACK} — {theme_label(theme, path)}"
    m0 = re.match(r"^(\d{4})", name)
    year = m0.group(1) if m0 else ""
    cand = ""
    md = (meta or {}).get(name)
    if md:
        t, iss = md["title"], md.get("issuer", "")
        y = (md.get("date") or year)[:4]
        cand = t
        if iss and iss.lower() not in t.lower():
            cand += f" — {iss}"
        if y and y not in cand:
            cand += f" ({y})"
    if not cand and name.lower().endswith(_TEXT_EXT) and sum_es and ": " in sum_es:
        head = sum_es.split(": ", 1)[1].split(" · ")[0].strip()
        head = re.sub(r"&\s?#?8211;", "–", head).replace("&amp;", "&")
        head = re.sub(r"^title:\s*", "", head, flags=re.I)
        head = re.sub(r"^T\d(?:[ .]\d{2})?\s*[—-]?\s*", "", head)
        mweb = re.match(r"Página web guardada «([^»]+)»", head)
        if mweb:
            head = f"Página web — {mweb.group(1)}"
        if 8 <= len(head) and re.search(r"[A-Za-zÁÉÍÓÚáéíóú]{3}", head) and not _HEAD_BLOCK.search(head):
            cand = _cut(_sentence(head))
            if year and year not in cand:
                cand += f" ({year})"
    if not cand:
        mo = re.match(r"^(\d{4})_datosbcs_(.+?)(\.[A-Za-z0-9]{2,5})?$", name, re.I)
        if mo:
            body = _cut(_sentence(mo.group(2)), 90)
            cand = f"Datos BCS — {body}" + ("" if mo.group(1) in body else f" ({mo.group(1)})")
    if not cand:
        mq = re.match(r"^(\d{4})_Q([1-4])_", name)  # 2023_Q4_CaboRE_… → org CaboRE, "(Q4 2023)"
        nm = re.sub(r"^(\d{4})_Q([1-4])_", r"\1_", name)
        lab = label_for_file(nm)
        if lab:
            org, rest = lab.split(" — ", 1)
            cand = f"{org} — {_sentence(rest)}" if not re.fullmatch(r"[A-Z]{3}", org) else _sentence(rest)
            if mq:
                cand = cand.replace(f"({mq.group(1)})", f"(Q{mq.group(2)} {mq.group(1)})")
    if not cand:
        return fallback
    cand = re.sub(r"\s+", " ", cand.replace("_", " ")).strip()
    return fallback if FILENAME_RE.search(cand) else cand


def human_library_title(title: str) -> str:
    t = re.sub(r"\b\d{2}_([A-Z][A-Z_]+)\b", lambda m: _sentence(m.group(1)), title or "")
    return re.sub(r"\s+", " ", t.replace("_", " ")).strip()
