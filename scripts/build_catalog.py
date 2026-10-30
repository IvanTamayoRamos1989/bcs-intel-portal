#!/usr/bin/env python3
"""Scan BCSFP data → catalog.json + folders_summary.json (public, Drive-oriented)."""
import json, os, re
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path("/workspace/BCSFP")
OUT = Path("/workspace/BCSFP/11_bcs_hub/src/data")
SKIP_DIRS = {
    "node_modules", ".git", "dist", ".astro", "__pycache__",
    "_drive_audit",  # huge raw shards
    "_design_ref",
    # Public portal hide: F+P participant fichas (backend knowledge only)
    "08_fp_team_research",
    # Confidential / internal: never index into the public catalog
    "15_decision_platform", "_backups", "stakeholder_review",
}
SKIP_EXT = {".tar", ".gz", ".zip", ".7z", ".rar", ".iso", ".dmg"}
# Entries removed from the public catalogue by scripts/enrich_thin_entries.py
# (non_document = internal tooling; no_content = unobtainable content, listed in data_gaps.json wishlist)
_EXCL_FILE = OUT / "catalog_exclusions.json"
EXCLUDED = set(json.loads(_EXCL_FILE.read_text(encoding="utf-8")).get("paths", {}).keys()) if _EXCL_FILE.exists() else set()

THEME_BY_FOLDER = {
    "00_catalog": "catalogo",
    "01_planning": "planeacion",
    "02_water": "agua",
    "03_energy": "energia",
    "04_mobility_waste": "conectividad",
    "05_demographics": "territorio",
    "06_environment": "ambiente",
    "07_economy_investment": "economia",
    "08_fp_team_research": "investigacion",
    "09_shadow_programme": "programa",
    "10_data_lake": "data_lake",
    "11_bcs_hub": "portal",
    "12_ontology": "ontologia",
    "13_territorial_intelligence": "inteligencia_territorial",
    "13_federal_projects": "proyectos_federales",
    "14_gis_atlas": "mapas",
}

INTERESTING_EXT = {
    ".pdf", ".md", ".csv", ".xlsx", ".xls", ".json", ".geojson", ".gpkg",
    ".shp", ".kml", ".kmz", ".tif", ".tiff", ".jpg", ".jpeg", ".png",
    ".webp", ".txt", ".tsv", ".doc", ".docx", ".html", ".htm", ".xml",
    ".yaml", ".yml", ".zip", ".tar", ".gz",
}

def top_folder(rel: str) -> str:
    parts = rel.replace("\\", "/").split("/")
    return parts[0] if parts else ""

def theme_guess(rel: str) -> str:
    tf = top_folder(rel)
    if tf in THEME_BY_FOLDER:
        return THEME_BY_FOLDER[tf]
    if tf == "13_territorial_intelligence":
        parts = rel.replace("\\", "/").split("/")
        if len(parts) > 1:
            sub = parts[1]
            sub_map = {
                "hazards": "riesgos", "land_tenure": "riesgos",
                "tourism_assets": "turismo", "ports_demand": "conectividad",
                "plans_archive": "planeacion", "plans": "planeacion",
                "catastro_implan": "catastro", "maps_catalog": "mapas",
                "histories": "territorio", "fiscal": "comunidades",
                "earth_studio_stills": "mapas", "earth_studio_tour": "mapas",
                "earth_studio_FIXED": "mapas",
            }
            return sub_map.get(sub, "inteligencia_territorial")
    return "otro"

entries = []
folder_counts = {}
ext_counts = {}
theme_counts = {}

for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
    rel_dir = os.path.relpath(dirpath, ROOT).replace("\\", "/")
    if rel_dir.startswith("_drive_audit") or rel_dir.startswith("_design_ref"):
        dirnames[:] = []
        continue
    # Hub: only guide_assets / public — exclude portal code from public catalog
    if rel_dir == "11_bcs_hub":
        dirnames[:] = [d for d in dirnames if d in ("guide_assets", "public")]
    if rel_dir.startswith("11_bcs_hub/") and not (
        rel_dir.startswith("11_bcs_hub/guide_assets") or rel_dir.startswith("11_bcs_hub/public")
    ):
        dirnames[:] = []
        continue
    parts = set(dirpath.split(os.sep))
    if "node_modules" in parts:
        continue
    if "11_bcs_hub" in parts and "dist" in parts:
        continue

    if any(d.startswith("_bak") for d in dirpath.split(os.sep)):
        dirnames[:] = []
        continue
    for fn in filenames:
        if fn.startswith("."):
            continue
        if "MIES" in fn.upper().split("_")[0:1] or fn.upper().startswith("MIES"):
            continue  # internal review notes: never public
        full = Path(dirpath) / fn
        try:
            st = full.stat()
        except OSError:
            continue
        if st.st_size > 5_000_000_000:
            continue
        ext = full.suffix.lower()
        if ext not in INTERESTING_EXT and ext not in {".cpg", ".dbf", ".prj", ".shx", ".sbn", ".sbx"}:
            if ext in {".mp4", ".mov", ".avi", ".wav", ".mp3"}:
                pass
            elif not ext:
                continue
            else:
                if ext in {".pyc", ".o", ".so", ".dylib", ".class", ".lock"}:
                    continue

        rel = str(full.relative_to(ROOT)).replace("\\", "/")
        if rel in EXCLUDED:
            continue
        # Public catalog exclusions (Drive-only product)
        if rel.startswith("_design_ref/") or "/_design_ref/" in rel:
            continue
        if fn.startswith("preview_") and fn.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
            continue
        if rel.startswith("11_bcs_hub/"):
            keep_prefixes = (
                "11_bcs_hub/guide_assets/maps/",
                "11_bcs_hub/public/maps/",
                "11_bcs_hub/public/stills/",
            )
            if not any(rel.startswith(k) for k in keep_prefixes):
                continue
        if "Guia_BCS_datos" in rel and (rel.endswith(".html") or ".tar" in rel):
            continue

        tf = top_folder(rel)
        theme = theme_guess(rel)
        entry = {
            "path": rel,
            "folder": tf,
            "ext": ext.lstrip(".") or "none",
            "size": st.st_size,
            "mtime": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).strftime("%Y-%m-%d"),
            "theme": theme,
            "name": fn,
        }
        ym = re.search(r"(20\d{2})", fn)
        entry["year"] = int(ym.group(1)) if ym else None
        entries.append(entry)
        folder_counts[tf] = folder_counts.get(tf, 0) + 1
        ext_counts[entry["ext"]] = ext_counts.get(entry["ext"], 0) + 1
        theme_counts[theme] = theme_counts.get(theme, 0) + 1

entries.sort(key=lambda e: e["path"].lower())

FOLDER_META = {
    "00_catalog": {"es": "Índices y catálogos de datos", "en": "Data indexes and catalogs"},
    "01_planning": {"es": "Planeación: POER, PDU, POEL, PMD", "en": "Planning: POER, PDU, POEL, PMD"},
    "02_water": {"es": "Agua: DMA, CONAGUA, desalación", "en": "Water: DMA, CONAGUA, desalination"},
    "03_energy": {"es": "Energía: SIBCS, CENACE, PRODESEN", "en": "Energy: SIBCS, CENACE, PRODESEN"},
    "04_mobility_waste": {"es": "Movilidad y residuos", "en": "Mobility and waste"},
    "05_demographics": {"es": "Demografía INEGI / ITER", "en": "Demographics INEGI / ITER"},
    "06_environment": {"es": "Ambiente: ANP, RTP, POER UGAs", "en": "Environment: ANP, RTP, POER UGAs"},
    "07_economy_investment": {"es": "Economía, IED e inmobiliario", "en": "Economy, FDI and real estate"},
    "08_fp_team_research": {"es": "Investigación de equipo", "en": "Team research notes"},
    "09_shadow_programme": {"es": "Material de programa (archivo)", "en": "Programme archive material"},
    "10_data_lake": {"es": "Data lake NotebookLM / fuentes", "en": "Data lake NotebookLM / sources"},
    "12_ontology": {"es": "Ontología territorial", "en": "Territorial ontology"},
    "13_territorial_intelligence": {"es": "Inteligencia territorial (TI)", "en": "Territorial intelligence (TI)"},
    "14_gis_atlas": {"es": "Atlas GIS / mapas", "en": "GIS atlas / maps"},
}

folders = []
for k in sorted(folder_counts.keys()):
    if k in ("11_bcs_hub", "_design_ref"):
        continue
    meta = FOLDER_META.get(k, {"es": k, "en": k})
    folders.append({
        "id": k,
        "count": folder_counts[k],
        "label_es": meta["es"],
        "label_en": meta["en"],
        "theme": THEME_BY_FOLDER.get(k, "otro"),
    })

ti_root = ROOT / "13_territorial_intelligence"
ti_subs = []
if ti_root.exists():
    for p in sorted(ti_root.iterdir()):
        if p.is_dir() and not p.name.startswith("."):
            n = sum(1 for _ in p.rglob("*") if _.is_file())
            ti_subs.append({"id": p.name, "count": n, "path": f"13_territorial_intelligence/{p.name}"})

summary = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "total_files": len(entries),
    "pdf_count": ext_counts.get("pdf", 0),
    "md_count": ext_counts.get("md", 0),
    "csv_count": ext_counts.get("csv", 0),
    "folder_counts": folder_counts,
    "ext_counts": dict(sorted(ext_counts.items(), key=lambda x: -x[1])),
    "theme_counts": theme_counts,
    "folders": folders,
    "ti_subpacks": ti_subs,
}

OUT.mkdir(parents=True, exist_ok=True)
with open(OUT / "catalog.json", "w", encoding="utf-8") as f:
    json.dump({"summary": summary, "files": entries}, f, ensure_ascii=False)
with open(OUT / "folders_summary.json", "w", encoding="utf-8") as f:
    json.dump(summary, f, ensure_ascii=False, indent=2)

# slim: no Desktop/PC paths
slim = [{
    "n": e["name"], "p": e["path"], "f": e["folder"],
    "e": e["ext"], "t": e["theme"], "y": e["year"], "s": e["size"],
} for e in entries]
with open(OUT / "catalog_slim.json", "w", encoding="utf-8") as f:
    json.dump(slim, f, ensure_ascii=False)

print(f"OK files={len(entries)} pdfs={ext_counts.get('pdf',0)} folders={len(folders)}")
for fr in folders:
    print(f"  {fr['id']}: {fr['count']}")
