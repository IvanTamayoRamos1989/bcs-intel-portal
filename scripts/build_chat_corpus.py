#!/usr/bin/env python3
"""Build public/chat_corpus.json (+ netlify/functions copy).

Prefer substantive summaries (guides, municipios, INEGI extracts) over
filename stubs; dedupe lake copies of the same basename.
"""
import csv
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAKE = ROOT.parent  # BCSFP/
OUT = ROOT / "public" / "chat_corpus.json"
FN = ROOT / "netlify" / "functions" / "chat_corpus.json"
MAX_ROWS = 4200  # 2026-10-05: filename-only rows are skipped, so slots go to real summaries
MAX_BYTES = 8_500_000  # 2026-10-05 grounded RAG: all files with real text  # raised 2026-09-28 for 13_library page-cited extracts (~1 MB)
PRIORITY_EXT = {"pdf", "md", "html", "doc", "docx", "txt", "csv", "xlsx"}
EXCLUDE_PATH_PREFIXES = (
    "08_fp_team_research/",
    "08_fp_team_research",
)
EXCLUDE_PATH_SUBSTR = ("08_fp_team_research",)

def is_excluded_path(path: str) -> bool:
    p = (path or "").replace("\\", "/")
    if not p:
        return False
    for pref in EXCLUDE_PATH_PREFIXES:
        if p == pref.rstrip("/") or p.startswith(pref if pref.endswith("/") else pref + "/"):
            return True
    return any(s in p for s in EXCLUDE_PATH_SUBSTR)

PRIORITY_FOLDERS = {
    "01_planning", "02_water", "03_energy", "04_mobility_waste", "05_demographics",
    "06_environment", "07_economy_investment", "12_ontology", "13_territorial_intelligence", "13_federal_projects",
    "00_catalog", "14_gis_atlas",
}
PRIORITY_THEMES = {
    "planeacion", "agua", "energia", "ambiente", "conectividad", "economia",
    "territorio", "inteligencia_territorial", "proyectos_federales", "ontologia", "programa", "catalogo",
    "demografia",
}

# Prefer canonical lake folders over data_lake mirrors when deduping by basename
FOLDER_RANK = {
    "05_demographics": 100,
    "01_planning": 90,
    "02_water": 85,
    "13_territorial_intelligence": 80,
    "13_federal_projects": 78,
    "07_economy_investment": 75,
    "06_environment": 70,
    "03_energy": 65,
    "04_mobility_waste": 60,
    "12_ontology": 55,
    "00_catalog": 50,
    "14_gis_atlas": 45,
}


def clip(s, n=420):
    s = (s or "").strip()
    if len(s) <= n:
        return s
    return s[: n - 1].rsplit(" ", 1)[0] + "…"


def folder_of(path):
    return (path or "").split("/")[0]


def path_priority(path):
    f = folder_of(path)
    base = FOLDER_RANK.get(f, 10)
    if "10_data_lake" in (path or "") or path.startswith("10_"):
        base -= 40
    if "/_raw_downloads/" in (path or "") or "/_downloads/" in (path or ""):
        base -= 15
    return base


def score_row(r):
    s = 0
    e = (r.get("e") or "").lower()
    f = r.get("f") or folder_of(r.get("p") or "")
    t = r.get("t") or ""
    p = r.get("p") or ""
    if r.get("sum_es") or r.get("sum_en"):
        s += 50
    if e in ("pdf", "md"):
        s += 40
    elif e in PRIORITY_EXT:
        s += 20
    if f in PRIORITY_FOLDERS:
        s += 25
    if t in PRIORITY_THEMES:
        s += 15
    se = len(r.get("sum_es") or "")
    if se > 80:
        s += 10
    if se > 160:
        s += 10
    if t == "data_lake" and se < 60:
        s -= 10
    if e in ("esp", "kml", "jpg", "png", "astro", "gz"):
        s -= 30
    s += path_priority(p) // 5
    # Prefer demographic CSVs / INEGI in 05_
    pl = p.lower()
    if "05_demographics" in pl:
        s += 20
    if any(k in pl for k in ("poblacion", "censo", "inegi", "iter", "demograf")):
        s += 15
    return s


def enrich_inegi_csv_summary(path_str, title):
    """If an on-disk INEGI población CSV exists, build a fact-rich summary."""
    candidates = []
    p = Path(path_str)
    # Hub-relative paths point into BCSFP siblings
    if not p.is_absolute():
        candidates.append(LAKE / path_str)
        candidates.append(ROOT / path_str)
        # basename search under 05_demographics
        candidates.append(LAKE / "05_demographics" / Path(path_str).name)
    for cand in candidates:
        if cand.is_file() and cand.suffix.lower() == ".csv":
            try:
                return _summarize_poblacion_csv(cand, title)
            except Exception:
                continue
    return None


def _norm_row(r):
    """Strip BOM/whitespace from CSV header keys."""
    return {str(k).lstrip("\ufeff").strip(): v for k, v in r.items()}


def _summarize_poblacion_csv(path: Path, title: str) -> str:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    # Detect serie censal vs ITER-like municipal extract
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return title
    header = lines[0].lower().lstrip("\ufeff")
    rows = [_norm_row(r) for r in csv.DictReader(lines)]
    if not rows:
        return title

    facts = []
    keys0 = {k.lower() for k in rows[0]}
    if "poblacion_total" in header or "poblacion_total" in keys0:
        # serie censal year,municipio,poblacion_total
        by_year = {}
        for r in rows:
            try:
                y = int(str(r.get("year") or "").strip())
            except ValueError:
                continue
            mun = (r.get("municipio") or "").strip()
            loc = (r.get("nom_loc") or "").strip().lower()
            try:
                pob = int(float(str(r.get("poblacion_total") or "0").replace(",", "")))
            except ValueError:
                continue
            if "total de la entidad" in mun.lower() or mun.lower().startswith("total"):
                by_year.setdefault(y, {})["estado"] = pob
            elif "total" in loc or loc == "" or "municipio" in loc:
                by_year.setdefault(y, {})[mun] = pob
        if 2020 in by_year:
            d = by_year[2020]
            parts = [f"INEGI serie censal / Censo 2020 — población (habitantes, gente, demografía, CPV):"]
            if "estado" in d:
                parts.append(f"BCS estatal {d['estado']:,}".replace(",", ","))
            for mun, pob in sorted(((k, v) for k, v in d.items() if k != "estado"), key=lambda x: -x[1]):
                parts.append(f"{mun} {pob:,}".replace(",", ","))
            return clip(" ".join(parts), 900)
    # ITER / municipal extract with POBTOT
    if "pobtot" in header:
        parts = [
            "INEGI Censo 2020 (CPV/ITER) — población total (habitantes, gente, demografía, viviendas):"
        ]
        for r in rows:
            mun = (r.get("NOM_MUN") or r.get("nom_mun") or "").strip()
            loc = (r.get("NOM_LOC") or r.get("nom_loc") or "").strip()
            try:
                pob = int(str(r.get("POBTOT") or r.get("pobtot") or "0").replace(",", "").strip() or "0")
            except ValueError:
                continue
            loc_l = loc.lower()
            if "total de la entidad" in loc_l:
                parts.append(f"Baja California Sur (estado) {pob:,} habitantes.")
            elif "total del municipio" in loc_l or "total municipal" in loc_l:
                parts.append(f"Municipio {mun}: {pob:,} habitantes (POBTOT).")
        if len(parts) > 1:
            return clip(" ".join(parts), 900)
    return None




def enrich_pibe_csv_summary(path_str, title):
    """Peek PIBE sector tabulado CSV for latest-year totals (like población helper)."""
    candidates = []
    p = Path(path_str)
    if not p.is_absolute():
        candidates.append(LAKE / path_str)
        candidates.append(ROOT / path_str)
        candidates.append(LAKE / "07_economy_investment" / Path(path_str).name)
        candidates.append(LAKE / "05_demographics" / Path(path_str).name)
    for cand in candidates:
        if cand.is_file() and cand.suffix.lower() == ".csv":
            try:
                out = _summarize_pibe_csv(cand, title)
                if out:
                    return out
            except Exception:
                continue
    return None


def _summarize_pibe_csv(path: Path, title: str) -> str:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return None
    # Header often: Descriptores,2003,...,2023<P>
    header = lines[0].lstrip("\ufeff")
    year_cols = re.findall(r"(20\d{2})", header)
    if not year_cols:
        return None
    latest = year_cols[-1]
    # Find column index of latest year
    hdr_cells = next(csv.reader([header]))
    idx = None
    for i, h in enumerate(hdr_cells):
        if latest in str(h):
            idx = i
    if idx is None:
        return None
    facts = []
    for row in csv.reader(lines[1:]):
        if len(row) <= idx:
            continue
        desc = (row[0] or "").strip()
        val = (row[idx] or "").strip()
        if not val:
            continue
        try:
            num = float(val.replace(",", ""))
        except ValueError:
            continue
        # Keep totals and a few top sectors
        low = desc.lower()
        if (
            "producto interno bruto" in low
            or "actividad económica total" in low
            or "actividades primarias" in low
            or "actividades secundarias" in low
            or "actividades terciarias" in low
            or "alojamiento" in low
            or "construcción" in low
            or "minería" in low
        ):
            # Prefer short descriptor tail
            short = desc.split("|")[-1].strip()[:80] or desc[:80]
            facts.append(f"{short}: {num:,.1f} mdp ({latest})")
        if len(facts) >= 8:
            break
    if not facts:
        return None
    body = (
        f"INEGI PIBE tabulado sectores — totales {latest} (PIB / VAB / mdp, economía): "
        + "; ".join(facts)
        + " [economía PIB PIBE VAB INEGI constante mdp millones sectores]"
    )
    return clip(body, 1200)


def load_file_summaries():
    """Map lake-relative path -> summary row from file_summaries.json."""
    p = ROOT / "src/data/file_summaries.json"
    if not p.exists():
        return {}
    try:
        data = json.load(open(p, encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def pick_file_summary(path_str, title, summaries):
    """Prefer substantive file_summaries extract over catalog stub / title."""
    row = summaries.get(path_str) or summaries.get((path_str or "").replace("\\", "/"))
    if not row:
        # basename fallback (prefer non-data_lake keys if multiple)
        base = Path(path_str or "").name.lower()
        cands = []
        for k, v in summaries.items():
            if Path(k).name.lower() == base:
                cands.append((k, v))
        if cands:
            cands.sort(key=lambda kv: (0 if "10_data_lake" not in kv[0] else 1, len(kv[0])))
            row = cands[0][1]
    if not row:
        return None, None, None
    se = (row.get("sum_es") or "").strip()
    sn = (row.get("sum_en") or "").strip()
    src = row.get("source") or ""
    title = title or Path(path_str or "").name
    # Prefer pdf/md/csv extracts over heuristic stubs; require longer than title
    if se and len(se) > max(len(title) + 10, 80):
        if src in ("pdf", "md", "csv") or src != "heuristic" or len(se) > 160:
            return se, sn or se, src
    if se and src in ("pdf", "md", "csv") and len(se) > len(title):
        return se, sn or se, src
    return None, None, None


ORG_SRC = "Organigrama General H. XV Ayuntamiento de Los Cabos (BOGE #14, 29 feb 2024)"
ORG_JSON = LAKE / "14_gobierno" / "los_cabos_organigrama_2024_2027.json"
ORG_DRIVE = "https://drive.google.com/file/d/1ST2zM7inC6QSOsGuN2leonNrEGkAev1_/view"
ORG_TAGS = ("[quién dirige titular director directora director general encargado responsable jefe "
            "gobierno municipal ayuntamiento Los Cabos organigrama funcionarios 2024-2027]")

MESAS_SRC = ROOT / "src" / "data" / "mesas_trabajo.json"
MESAS_SOURCE = "Ivan Tamayo, notas de mesas de trabajo, 30 sep 2026"
MESAS_TAGS = ("[mesas de trabajo integrantes quiénes están en la mesa hospitalidad inversión extranjera "
              "desarrollo orientado al transporte política estatal urbanización Los Cabos regeneración biodiversidad "
              "seguridad pública infraestructura energía agua SEPUIMM CEA Conagua]")


def add_los_cabos_organigrama(chunks):
    """One overview chunk + one chunk per dependency / Dirección General / group (14_gobierno)."""
    if not ORG_JSON.is_file():
        return 0
    data = json.loads(ORG_JSON.read_text(encoding="utf-8"))
    rows = data.get("unidades") or []
    by_area = {r["area"]: r for r in rows}
    kids = {}
    for r in rows:
        kids.setdefault(r.get("depende_de") or "", []).append(r)

    def who(r):
        t = (r.get("titular") or "").strip()
        return t if t else "(sin titular)"

    def line(r):
        return f"{r['area']}: {who(r)}"

    path = "14_gobierno/los_cabos_organigrama_2024_2027.json"
    n = 0

    def push(cid, title, body_es, body_en, extra_tags=""):
        nonlocal n
        chunks.append({
            "id": f"gobierno:los-cabos:{cid}",
            "title": title[:140],
            "path": f"{path}#{cid}",
            "theme": "gobierno",
            "sum_es": clip(f"{body_es} Fuente: {ORG_SRC}. {ORG_TAGS} {extra_tags}".strip(), 3200),
            "sum_en": clip(f"{body_en} Source: {ORG_SRC}. [who runs head director Los Cabos municipal government org chart] {extra_tags}".strip(), 3200),
            "drive_url": ORG_DRIVE,
            "type": "guide",
            "source": ORG_SRC,
        })
        n += 1

    P = "Presidencia Municipal"
    top = [by_area.get(a) for a in ("Presidencia Municipal", "Sindicatura Municipal", "Secretaría General",
                                   "Tesorería Municipal", "Contraloría Municipal", "Oficialía Mayor") if by_area.get(a)]
    dgs = [r for r in rows if r.get("tipo") == "dirección general"]
    desc = [r for r in kids.get(P, []) if r.get("tipo") in ("organismo descentralizado", "instituto municipal")]
    deleg = kids.get("Delegaciones", [])
    ov_es = ("Organigrama general del H. XV Ayuntamiento de Los Cabos, B.C.S. (administración 2024–2027), "
             "actualizado conforme al Reglamento de la Administración Pública Municipal (BOGE #14, 29 feb 2024). "
             "Mando superior: " + "; ".join(line(r) for r in top) + ". "
             "Direcciones Generales: " + "; ".join(line(r) for r in dgs) + ". "
             "Organismos descentralizados e institutos: " + "; ".join(line(r) for r in desc) + ". "
             "Delegaciones municipales: " + "; ".join(line(r) for r in deleg) + ". "
             "El Cabildo lo integran la Presidencia, la Sindicatura y 11 regidurías.")
    ov_en = ("Org chart of the XV City Council of Los Cabos, B.C.S. (2024–2027 administration). Top level: "
             + "; ".join(line(r) for r in top) + ". General Directorates: " + "; ".join(line(r) for r in dgs)
             + ". Decentralised bodies and institutes: " + "; ".join(line(r) for r in desc)
             + ". Municipal delegations: " + "; ".join(line(r) for r in deleg) + ".")
    push("overview", "Organigrama Ayuntamiento de Los Cabos 2024–2027 (quién es quién)", ov_es, ov_en,
         "presidente municipal alcalde síndica tesorero contralor oficial mayor secretario general")

    cab = kids.get("Cabildo", [])
    push("cabildo", "Cabildo de Los Cabos 2024–2027: Presidencia, Sindicatura y regidurías",
         "Cabildo del H. XV Ayuntamiento de Los Cabos: " + "; ".join(line(r) for r in cab) + ".",
         "Los Cabos council (Cabildo): " + "; ".join(line(r) for r in cab) + ".",
         "regidor regidora regidores síndico síndica presidente municipal alcalde cabildo")

    staff = [r for r in kids.get(P, []) if r.get("tipo") == "unidad de apoyo de Presidencia"]
    push("presidencia", "Presidencia Municipal de Los Cabos y sus unidades de apoyo",
         f"Presidencia Municipal de Los Cabos: {who(by_area[P])}. Unidades de apoyo que dependen de Presidencia: "
         + "; ".join(line(r) for r in staff) + ".",
         f"Los Cabos Mayor's Office: {who(by_area[P])}. Staff units: " + "; ".join(line(r) for r in staff) + ".",
         "presidente municipal alcalde gabinete turismo comunicación social secretaría particular")

    push("descentralizados", "Organismos descentralizados e institutos municipales de Los Cabos (OOMSAPAS, IMPLAN, DIF)",
         "Organismos e institutos que dependen de Presidencia Municipal de Los Cabos: " + "; ".join(line(r) for r in desc)
         + ". También: " + line(by_area["Dirección Municipal de Desarrollo Sostenible"]) + ".",
         "Decentralised bodies and institutes under the Los Cabos Mayor's Office: " + "; ".join(line(r) for r in desc) + ".",
         "OOMSAPAS agua potable IMPLAN planeación DIF familias instituto mujeres juventud cultura deporte")

    syn = {
        "Secretaría General": "secretario general protección civil gobierno jurídico",
        "Tesorería Municipal": "tesorero tesorera tesorería finanzas ingresos egresos catastro predial ZOFEMAT",
        "Contraloría Municipal": "contralor contralora transparencia visitaduría",
        "Oficialía Mayor": "oficial mayor recursos humanos administración",
    }
    for a in ("Secretaría General", "Tesorería Municipal", "Contraloría Municipal", "Oficialía Mayor"):
        r = by_area.get(a)
        if not r:
            continue
        sub = kids.get(a, [])
        push(a.lower().replace(" ", "-").replace("í", "i").replace("é", "e"),
             f"{a} de Los Cabos: titular y direcciones (organigrama 2024–2027)",
             f"{a} del H. XV Ayuntamiento de Los Cabos. Titular: {who(r)}. Depende de Presidencia Municipal. "
             f"Direcciones y áreas que dependen de la {a} ({len(sub)}): " + "; ".join(line(x) for x in sub) + ". "
             "Las Direcciones Generales (Desarrollo Urbano, Obras Públicas, etc.) no dependen de esta área sino de Presidencia Municipal.",
             f"{a} (Los Cabos). Head: {who(r)}. Units: " + "; ".join(line(x) for x in sub) + ".",
             syn.get(a, ""))

    for r in dgs:
        sub = kids.get(r["area"], [])
        short = r["area"].replace("Dirección General de ", "")
        push("dg-" + re.sub(r"[^a-z0-9]+", "-", fold_ascii(short).lower()).strip("-")[:40],
             f"{r['area']} de Los Cabos: director general y direcciones",
             f"{r['area']} del H. XV Ayuntamiento de Los Cabos. Director(a) general / titular: {who(r)}. "
             "Depende de Presidencia Municipal. Direcciones y coordinaciones a su cargo: "
             + "; ".join(line(x) for x in sub) + ".",
             f"{r['area']} (Los Cabos General Directorate of {short}). Director general: {who(r)}. Units: "
             + "; ".join(line(x) for x in sub) + ".",
             f"director general de {short}")

    push("delegaciones", "Delegaciones municipales de Los Cabos (Cabo San Lucas, Santiago, Miraflores, La Ribera)",
         "Delegaciones municipales de Los Cabos (dependen de Presidencia Municipal): " + "; ".join(line(r) for r in deleg)
         + ". Además, la Coordinación Municipal de Subdelegados depende de la Secretaría General: "
         + who(by_area.get("Coordinación Municipal de Subdelegados", {})) + ".",
         "Los Cabos municipal delegations: " + "; ".join(line(r) for r in deleg) + ".",
         "delegado delegada delegación Cabo San Lucas Santiago Miraflores La Ribera")
    return n


def add_mesas_trabajo(chunks):
    """Add Ivan Tamayo's internal stakeholder working tables (30 Sep 2026)."""
    if not MESAS_SRC.is_file():
        return 0
    data = json.loads(MESAS_SRC.read_text(encoding="utf-8"))
    mesas = data.get("mesas") or []
    n = 0

    def members_text(mesa):
        return "; ".join(
            f"{p.get('nombre')}: {p.get('descripcion')}" for p in (mesa.get("integrantes") or [])
        )

    for mesa in mesas:
        mid = mesa.get("id") or re.sub(r"[^a-z0-9]+", "-", fold_ascii(mesa.get("nombre") or "mesa").lower()).strip("-")
        name = mesa.get("nombre") or mid
        body = (
            f"Mesa de trabajo de {name}: {members_text(mesa)}. "
            f"Estas son notas internas de {MESAS_SOURCE}; no incluyen datos de contacto."
        )
        chunks.append({
            "id": f"mesas:{mid}",
            "title": f"Mesa de trabajo {name}: integrantes",
            "path": f"portal/mesas-de-trabajo#{mid}",
            "theme": "stakeholders",
            "sum_es": clip(f"{body} Fuente: {MESAS_SOURCE}. {MESAS_TAGS}", 1400),
            "sum_en": clip(f"Working table {name}: " + "; ".join(
                f"{p.get('nombre')}: {p.get('descripcion')}" for p in (mesa.get("integrantes") or [])
            ) + f". Internal notes source: {MESAS_SOURCE}. {MESAS_TAGS}", 1400),
            "drive_url": None,
            "type": "guide",
        })
        n += 1

    if mesas:
        overview = "Mesas de trabajo internas BCS2050: " + " ".join(
            f"Mesa de {m.get('nombre')}: {members_text(m)}." for m in mesas
        )
        chunks.append({
            "id": "mesas:overview",
            "title": "Mesas de trabajo BCS2050: integrantes",
            "path": "portal/mesas-de-trabajo",
            "theme": "stakeholders",
            "sum_es": clip(f"{overview} Fuente: {MESAS_SOURCE}. {MESAS_TAGS}", 3200),
            "sum_en": clip(f"Internal BCS2050 working tables: {overview} Source: {MESAS_SOURCE}. {MESAS_TAGS}", 3200),
            "drive_url": None,
            "type": "guide",
        })
        n += 1
    return n


def add_aquifers(chunks):
    """One chunk per BCS aquifer (DOF 9 nov 2023 + CONAGUA fichas) from src/data/aquifers_bcs.json."""
    p = ROOT / "src" / "data" / "aquifers_bcs.json"
    if not p.is_file():
        return 0
    d = json.loads(p.read_text(encoding="utf-8"))
    n = 0
    for a in d.get("aquifers", []):
        dma = a["dma_hm3"]
        estado = "déficit (sin volumen para nuevas concesiones)" if dma < 0 else "disponibilidad positiva"
        muni = ", ".join(a["municipios"]) if a["municipios"] else "municipio por verificar (sin ficha CONAGUA en el acervo)"
        if a.get("municipio_por_confirmar") and a["municipios"]:
            muni += " (por confirmar)"
        ficha = f" Ficha CONAGUA: {a['ficha_file']} p.{a['ficha_page']}." if a.get("ficha_file") else ""
        body = (f"Acuífero {a['clave']} {a['nombre']} (Baja California Sur): disponibilidad media anual DMA "
                f"{dma:.6f} hm³/año (≈ {dma:.2f}) → {estado}. R={a['R']} DNC={a['DNC']} VCAS={a['VCAS']} VEALA={a['VEALA']} "
                f"VAPTYR={a['VAPTYR']} VAPRH={a['VAPRH']} hm³/año. Municipio: {muni}. Fuente: Acuerdo DMA 653 acuíferos, "
                f"DOF 9 nov 2023, p.3 (02_water/2023-11-09_SEMARNAT_Acuerdo-DMA-653-acuiferos.pdf).{ficha} "
                "Método NOM-011-CONAGUA-2015 (DMA = R − DNC − VEAS); balance legal, no aforo físico.")
        chunks.append({"id": f"aq:{a['clave']}", "title": f"Acuífero {a['clave']} {a['nombre']} — DMA (DOF 2023)",
                       "path": "data/aquifers_bcs.json#" + a["clave"], "theme": "agua", "sum_es": body, "sum_en": "",
                       "drive_url": None, "type": "fact", "metric": f"DMA — {a['clave']} {a['nombre']}",
                       "value": f"{dma:.2f} hm³/año"})
        n += 1
    aqs = d.get("aquifers", [])
    if aqs:
        deficit = [a for a in aqs if a["dma_hm3"] < 0]
        tot = sum(a["dma_hm3"] for a in deficit)
        names = ", ".join(f"{a['clave']} {a['nombre']}" for a in deficit)
        body = (f"Baja California Sur tiene {len(aqs)} acuíferos oficiales publicados por CONAGUA (Acuerdo DMA 653 acuíferos, "
                f"DOF 9 nov 2023, p.3). Cuántos acuíferos hay en BCS: {len(aqs)}. De ellos {len(deficit)} están en déficit "
                f"(DMA negativa, suma {tot:.3f} hm³/año): {names}. Los demás tienen disponibilidad positiva. "
                "Método NOM-011-CONAGUA-2015; balance legal, no aforo físico.")
        chunks.append({"id": "aq:resumen", "title": f"Acuíferos de Baja California Sur — {len(aqs)} acuíferos, {len(deficit)} en déficit (DOF 2023)",
                       "path": "data/aquifers_bcs.json", "theme": "agua", "sum_es": body, "sum_en": "", "drive_url": None,
                       "type": "fact", "metric": "Número de acuíferos BCS", "value": str(len(aqs))})
        n += 1
    return n


def add_stakeholders(chunks):
    """Institutional stakeholders (steering / technical / forum) as actor cards. No F+P staff."""
    p = ROOT / "netlify" / "functions" / "stakeholders_seed.json"
    if not p.is_file():
        return 0
    items = json.loads(p.read_text(encoding="utf-8")).get("items", [])
    n = 0
    for st in items:
        if st.get("group") not in ("Steering Committee", "Technical Advisory Group", "Stakeholders Forum"):
            continue
        blob = f"{st.get('description') or ''} {st.get('org') or ''}"
        if re.search(r"foster|f\+p", blob, re.I):
            continue
        desc = (st.get("description") or "").strip()
        if not desc:
            continue
        ROLE_ES = [(r"\bGovernor\b", "Gobernador del Estado"), (r"\bMayor\b", "Presidente(a) municipal / alcaldía"),
                   (r"\baquifers\b", "acuíferos"), (r"\bwater\b", "agua"), (r"\bplanning\b", "planeación"),
                   (r"\btourism\b", "turismo"), (r"\bgrid\b", "red eléctrica")]
        es_bits = [es for rx, es in ROLE_ES if re.search(rx, desc, re.I)]
        body = f"Actor del programa BCS 2050 ({st.get('group')}): {st['name']} — {desc}"
        if es_bits:
            body += " Cargo / tema: " + "; ".join(es_bits) + "."
        if st.get("org") and st["org"] not in ("None", st["name"]):
            body += f" Organización: {st['org']}."
        chunks.append({"id": f"actor:{st['id']}", "title": f"Actor: {st['name']}", "path": f"stakeholders/{st['id']}",
                       "theme": "actores", "sum_es": body, "sum_en": "", "drive_url": None, "type": "actor",
                       "href": f"/stakeholders?q={st['name']}"})
        n += 1
    return n


def add_studies(chunks):
    """Capacity studies (Phase 0). Only when PUBLIC_STUDIES_ENABLED=1; data is pre-scrubbed by ingest_studies.py."""
    import os
    if os.environ.get("PUBLIC_STUDIES_ENABLED") != "1":
        return 0
    n = 0
    for f in sorted((ROOT / "src/data/studies").glob("*.json")):
        doc = json.loads(f.read_text(encoding="utf-8"))
        for st in doc.get("studies") or []:
            checks = "; ".join(
                f"{c.get('label_es') or c.get('id')}: {c.get('result')}" for c in st.get("checks") or []
            )
            res = {"pass": "cumple", "fail": "no cumple", "not_evaluable": "no se pudo evaluar"}
            checks = "; ".join(
                f"{c.get('label_es') or c.get('id')}: {res.get(c.get('result'), c.get('result'))}" for c in st.get("checks") or []
            )
            pending = "; ".join(f"{a.get('id')}: {a.get('text_es')}" for a in st.get("pending_assumptions") or [])
            nr = st.get("null_reasons_es") or {}
            gaps = [v for v in (nr.get("gross_floor_m2"), nr.get("dwellings_est"),
                                (st.get("water") or {}).get("per_capita_demand_note_es"),
                                (st.get("growth") or {}).get("population_horizon_note_es")) if v]
            gaps += [f"{g.get('item')}: {g.get('status')}" for g in st.get("data_gaps") or []]
            body = (
                f"Estudio preliminar y esquemático de capacidad ({doc.get('municipio')}, estado {st.get('status')}). "
                f"{st.get('narrative_es') or ''} "
                f"IMPORTANTE: la superficie 'no excluida' NO es suelo urbanizable; solo no cae en las capas de exclusión aplicadas. "
                f"Verificaciones: {checks or 'n/d'}. "
                f"Supuestos pendientes de confirmar: {pending or 'ninguno'}. "
                f"Datos que faltan: {'; '.join(gaps) or 'n/d'}. "
                f"Advertencia: {st.get('caveat_es') or ''}"
            )
            chunks.append({
                "id": f"study:{st.get('study_id')}", "title": f"Estudio de capacidad — {doc.get('municipio')}",
                "path": f"estudios/{doc.get('municipio')}", "theme": "territorio",
                "sum_es": body, "sum_en": "", "drive_url": None, "type": "fact",
                "href": f"/studio/{doc.get('municipio')}/#estudios-capacidad",
            })
            n += 1
    return n


def add_escorrentia(chunks):
    """Terrain-based runoff model summary for chat (not an official flood map)."""
    p = ROOT / "src/data/escorrentia.json"
    if not p.is_file():
        return 0
    d = json.loads(p.read_text(encoding="utf-8"))
    sw = d.get("statewide") or {}
    body = (
        f"Escorrentía y agua de lluvia en Baja California Sur — modelo de terreno (HydroSHEDS / HydroRIVERS), "
        f"entrega {d.get('package_date')}. "
        f"Red de drenaje: {sw.get('tramos_unicos')} tramos, {sw.get('longitud_km')} km. "
        f"Dirección verificada en {sw.get('tramos_direccion_verificada')} tramos; "
        f"{sw.get('tramos_direccion_no_verificada')} sin dirección confirmada. "
        f"Trayectorias D8 desde {sw.get('seed_count')} semillas (celdas de 3″ ≈ 90 m): "
        f"{sw.get('salida_costera')} salidas costeras y {sw.get('sumidero_interior')} sumideros interiores. "
        f"NO es un mapa oficial de peligro por inundación: no calcula profundidad, velocidad, caudal, "
        f"tiempo de llegada ni superficie inundada. La acumulación es número de celdas aportantes, no agua almacenada. "
        f"Fuente: {d.get('source_es')} Método: {d.get('method_es')}"
    )
    chunks.append({
        "id": "esc:resumen", "title": "Escorrentía BCS — modelo de terreno",
        "path": "escorrentia/resumen", "theme": "agua",
        "sum_es": body, "sum_en": "", "drive_url": None, "type": "fact",
        "href": "/agua/escorrentia/",
    })
    n = 1
    for slug, m in (d.get("municipios") or {}).items():
        mb = (
            f"Escorrentía en {m.get('label_es')} (modelo de terreno HydroSHEDS/HydroRIVERS): "
            f"{m.get('tramos_unicos')} tramos únicos, {m.get('longitud_km')} km de red de drenaje, "
            f"{m.get('redes_conectadas')} redes conectadas, "
            f"{m.get('trayectorias_distintas')} trayectorias D8 distintas (muestreo). "
            f"No es mapa oficial de inundación; conteos de rutas, no volúmenes. Ver /agua/escorrentia/."
        )
        chunks.append({
            "id": f"esc:{slug}", "title": f"Escorrentía — {m.get('label_es')}",
            "path": f"escorrentia/{slug}", "theme": "agua",
            "sum_es": mb, "sum_en": "", "drive_url": None, "type": "fact",
            "href": "/agua/escorrentia/",
        })
        n += 1
    return n


NEWS_PLACE = {
    "los_cabos": ("Los Cabos", "Los Cabos"), "east_cape": ("Cabo Este (East Cape)", "Los Cabos"),
    "todos_santos": ("Todos Santos–El Pescadero", "La Paz"), "la_paz": ("La Paz", "La Paz"),
    "loreto": ("Loreto", "Loreto"), "comondu": ("Comondú", "Comondú"), "mulege_north": ("Mulegé (norte)", "Mulegé"),
}
NEWS_TOPIC = {
    "water": ("agua", "water"), "energy": ("energía", "energy"), "tourism": ("turismo", "tourism"),
    "environment": ("medio ambiente y riesgos", "environment and hazards"), "planning": ("planeación", "planning"),
    "land_use": ("uso de suelo", "land use"), "connectivity": ("conectividad aérea", "air connectivity"),
}
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
PENDING_RE = re.compile(r"^\(?(pendiente de resumen|summary pending)", re.I)


def add_news(chunks):
    """Daily BCS news feed (src/data/news.json + news_archive.json) — one chunk per item.

    Press reports, NOT official data: type 'news', labelled «Noticia» with outlet + date, external URL
    as href so the chat shows a source card. Retrieval demotes them unless the question is about
    current events (netlify/lib/rag.mjs) and the prompt tells the model official sources win.
    """
    items = []
    for fname, archived in (("news.json", False), ("news_archive.json", True)):
        p = ROOT / "src" / "data" / fname
        if not p.is_file():
            continue
        d = json.loads(p.read_text(encoding="utf-8"))
        for it in (d.get("items") if isinstance(d, dict) else d) or []:
            items.append((it, archived))
    seen = set()
    n = 0
    for it, archived in items:
        url = str(it.get("url") or "").strip()
        title_es = (it.get("title_es") or it.get("title_en") or "").strip()
        if not re.match(r"^https?://", url) or not title_es or url in seen:
            continue
        seen.add(url)
        title_en = (it.get("title_en") or title_es).strip()
        iso = str(it.get("date") or "")[:10]
        try:
            y, m, dd = (int(x) for x in iso.split("-"))
            f_es, f_en = f"{dd} de {MESES[m - 1]} de {y}", f"{MONTHS[m - 1]} {dd}, {y}"
            short = f"{dd} {MESES[m - 1][:3]} {y}"
        except Exception:
            f_es = f_en = short = iso or "fecha no indicada"
        found_only = it.get("date_kind") == "found"
        outlet = (it.get("source") or "medio no indicado").strip()
        b_es = (it.get("blurb_es") or "").strip()
        b_en = (it.get("blurb_en") or "").strip()
        pending = bool(it.get("_needs_review")) or PENDING_RE.match(b_es or "")
        if pending:  # headline-only search hit: kept, labelled «noticia sin resumen» (Ivan, 2026-10-08)
            b_es = "Noticia sin resumen: solo se conoce el titular."
            b_en = "News item without summary: only the headline is known."
        places = [NEWS_PLACE[p] for p in (it.get("place_ids") or []) if p in NEWS_PLACE]
        lugares = ", ".join(dict.fromkeys(pl[0] for pl in places)) or "Baja California Sur (sin municipio específico)"
        munis = ", ".join(dict.fromkeys(pl[1] for pl in places)) or "estatal / no especificado"
        topics = [NEWS_TOPIC.get(t, (t, t)) for t in (it.get("topics") or [])]
        temas_es = ", ".join(t[0] for t in topics) or "general"
        temas_en = ", ".join(t[1] for t in topics) or "general"
        lug = f" ({lugares})" if places else ""
        # Indexed text stays lean (no boilerplate words such as "titular", "lugar", "oficial" that would
        # make every news chunk match unrelated questions); metadata is rendered by chat.mjs from fields.
        sum_es = f"Noticia de prensa ({outlet}, {iso}): {title_es}. {b_es}{lug}"
        sum_en = f"News report ({outlet}, {iso}): {title_en}. {b_en or b_es}{lug}"
        chunks.append({
            "id": f"news:{it.get('id') or iso}",
            "title": f"{'Noticia sin resumen' if pending else 'Noticia'} ({outlet}, {short}): {title_es}",
            "path": f"noticias/{iso}/{it.get('id') or ''}".rstrip("/"),
            "theme": "noticias",
            "sum_es": sum_es,
            "sum_en": sum_en,
            "drive_url": None,
            "href": url,
            "url": url,
            "type": "news",
            "outlet": outlet,
            "date": iso,
            "date_label_es": f_es,
            "date_label_en": f_en,
            "date_kind": "found" if found_only else "published",
            "municipios": munis,
            "lugares": lugares,
            "place_ids": list(it.get("place_ids") or []),
            "topics": list(it.get("topics") or []),
            "topics_es": temas_es,
            "topics_en": temas_en,
            "archived": archived,
            "official": False,
            "no_summary": bool(pending),
        })
        n += 1
    return n, len(items)


def fold_ascii(s):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def add_display_titles(chunks):
    import sys as _sys
    _sys.path.insert(0, str(Path(__file__).resolve().parent))
    from source_labels import (human_doc_title, human_library_title, load_doc_meta, theme_label,
                               FILENAME_RE, DOC_FALLBACK)
    meta = load_doc_meta(ROOT.parent)
    n_fb = n_meta = 0
    for c in chunks:
        t = c.get("type")
        c["theme_label"] = theme_label(c.get("theme"), c.get("path") or "")
        raw = re.sub(r"<[^>]+>", " ", str(c.get("title") or ""))
        raw = re.sub(r"\s+", " ", raw).strip().rstrip(":").strip()
        if t == "file":
            name = (c.get("path") or "").replace("\\", "/").split("/")[-1] or raw
            dt = human_doc_title(name, c.get("path") or "", c.get("sum_es") or "", c.get("theme"), meta)
            n_meta += name in meta
        elif t == "library":
            dt = human_library_title(raw)
        else:
            dt = raw
        if not dt or (t != "news" and FILENAME_RE.search(dt)):
            dt2 = re.sub(r"\s+", " ", re.sub(r"\.[A-Za-z0-9]{2,5}\b", "", dt.replace("_", " "))).strip()
            dt = dt2 if dt2 and not FILENAME_RE.search(dt2) else f"{DOC_FALLBACK} — {c['theme_label']}"
        if dt.startswith(DOC_FALLBACK):
            n_fb += 1
        c["display_title"] = dt
    print(f"display_titles: {len(chunks)} (catalog metadata {n_meta}, generic fallback {n_fb})")


def main():
    chunks = []
    catalog = json.load(open(ROOT / "src/data/catalog_slim.json"))
    file_summaries = load_file_summaries()
    scored = sorted(
        ((score_row(r), r) for r in catalog),
        key=lambda x: (-x[0], x[1].get("p") or ""),
    )

    # Dedupe by basename: keep highest-priority path
    best_by_base = {}
    for sc, r in scored:
        p = r.get("p") or r.get("n")
        if not p:
            continue
        base = Path(p).name.lower()
        prev = best_by_base.get(base)
        if prev is None or path_priority(p) > path_priority(prev[1].get("p") or "") or (
            path_priority(p) == path_priority(prev[1].get("p") or "") and sc > prev[0]
        ):
            best_by_base[base] = (sc, r)

    # Re-sort selected unique basenames
    unique_rows = sorted(best_by_base.values(), key=lambda x: (-x[0], x[1].get("p") or ""))

    seen_paths = set()
    for sc, r in unique_rows:
        if sum(1 for c in chunks if c["type"] == "file") >= MAX_ROWS:
            break
        p = r.get("p") or r.get("n")
        if not p or p in seen_paths:
            continue
        if is_excluded_path(p):
            continue
        if not (r.get("sum_es") or r.get("sum_en") or r.get("n")):
            continue
        seen_paths.add(p)
        title = r.get("n") or Path(p).name
        sum_es = r.get("sum_es") or title
        sum_en = r.get("sum_en") or title
        # Prefer real PDF/MD/CSV extracts from file_summaries.json over stubs
        fs_es, fs_en, fs_src = pick_file_summary(p, title, file_summaries)
        if fs_es:
            sum_es = fs_es
            sum_en = fs_en or fs_es
        # Enrich thin demographic CSV stubs with real numbers from disk
        thin = len(sum_es) < 120 or "— Demografía" in sum_es or "Demografía y turismo CSV" in sum_es
        pl = p.lower()
        if thin and any(k in pl for k in ("poblacion", "censo", "inegi", "05_demographics")):
            enriched = enrich_inegi_csv_summary(p, title)
            if enriched:
                sum_es = enriched
                sum_en = enriched
        # PIBE / economy CSV tabulados — latest year totals
        if (
            any(k in pl for k in ("pibe", "pib_", "tabulado", "07_economy"))
            and pl.endswith(".csv")
            and (len(sum_es) < 200 or sum_es == title or "heuristic" in sum_es.lower())
        ):
            enriched_p = enrich_pibe_csv_summary(p, title)
            if enriched_p:
                sum_es = enriched_p
                sum_en = enriched_p
        # Tag demographic / water files for retrieval
        theme = r.get("t") or ""
        if "05_demographics" in pl or any(k in pl for k in ("censo", "poblacion", "demograf", "coneval")):
            if not theme or theme == "data_lake":
                theme = "demografia"
        if "07_economy" in pl or any(k in pl for k in ("pibe", "pib_", "itaee", "ied", "enoe", "setue", "economia")):
            if not theme or theme in ("data_lake", "demografia"):
                # PIBE often lives under 05_demographics; still treat as economy
                if any(k in pl for k in ("pibe", "pib_", "itaee", "ied", "07_economy")):
                    theme = "economia"
            extra_e = (
                " [economía PIB PIBE VAB IED INEGI constante nominal mdp millones "
                "empleo ENOE ITAEE]"
            )
            if any(k in pl for k in ("pibe", "pib_", "07_economy", "itaee", "ied")):
                if "economía PIB PIBE" not in sum_es:
                    sum_es = clip(sum_es + extra_e, 1200)
                    sum_en = clip(sum_en + extra_e, 1200)
        if "02_water" in pl or any(k in pl for k in ("conagua", "dma", "acuifero", "desal", "oomsapas")):
            if not theme or theme == "data_lake":
                theme = "agua"
            # Surface quantity keywords so consumption queries match PDF chunks
            extra_w = (
                " [agua water DMA hm³ consumo consumption disponibilidad extracción "
                "anual year acuífero CONAGUA CEA OOMSAPAS déficit]"
            )
            if "dma" in pl or "conagua" in pl or "acuifero" in pl:
                if extra_w.strip(" []") not in sum_es:
                    sum_es = clip(sum_es + extra_w, 900)
                    sum_en = clip(sum_en + extra_w, 900)
        # Never index filename-only rows (diagnosis 2026-09-30): they only add noise
        _core = re.sub(r"\s*\[[^\]]*\]\s*$", "", sum_es or "").strip()
        if len(_core) < 80 or _core == title:
            continue
        # Earth Studio frames/stills are already indexed as 'still' chunks (stills_intelligence): no duplicates
        if fs_src == "extract_still":
            continue
        if sum_en == sum_es:
            sum_en = ""
        chunks.append({
            "id": "f:" + hashlib.md5(p.encode()).hexdigest()[:12],
            "title": title,
            "path": p,
            "theme": theme,
            "sum_es": clip(sum_es, 1400 if theme == "economia" or "pibe" in pl else 900),
            "sum_en": clip(sum_en, 1400 if theme == "economia" or "pibe" in pl else 900),
            "drive_url": r.get("dv") or None,
            "type": "file",
        })

    for md in sorted((ROOT / "src/content/guides").glob("*.md")):
        text = md.read_text(encoding="utf-8")
        if text.startswith("---"):
            parts = text.split("---", 2)
            text = parts[2] if len(parts) >= 3 else text
        theme = md.stem
        sections = re.split(r"\n(?=##\s)", text)
        for i, sec in enumerate(sections):
            sec = sec.strip()
            if not sec:
                continue
            lines = sec.splitlines()
            heading = lines[0].lstrip("#").strip() if lines else theme
            body = "\n".join(lines[1:] if lines and lines[0].startswith("#") else lines).strip()
            body = re.sub(r"\n{3,}", "\n\n", body)
            body = clip(body.replace("|", " ").replace("**", ""), 900)
            if len(body) < 40 and i > 0:
                continue
            summary = f"{heading}. {body}" if body else heading
            # Boost territorio / demography / water / economy keyword surface in guide chunks
            extra = ""
            # Demography tags: only true demography sections — NOT bare INEGI (economy guides cite INEGI)
            demo_theme = theme in ("territorio", "historia", "demografia")
            demo_body = bool(re.search(
                r"poblaci[oó]n|habitantes|censo|cabecera|viviendas|POBTOT|CPV|ITER",
                summary,
                re.I,
            ))
            if demo_theme or (demo_body and theme not in ("economia", "crecimiento", "conectividad")):
                extra = (
                    " [demografía población habitantes gente censo INEGI CPV "
                    "municipio localidades viviendas]"
                )
            if theme == "economia" or re.search(
                r"\bPIB\b|PIBE|VAB|IED|ENOE|ITAEE|constante|millones de pesos|mdp",
                summary,
                re.I,
            ):
                extra += (
                    " [economía PIB PIBE VAB IED INEGI constante nominal mdp "
                    "millones empleo ENOE producto interno]"
                )
            if theme == "agua" or re.search(
                r"DMA|hm³|acu[ií]fero|CONAGUA|disponibilidad|desal", summary, re.I
            ):
                extra += (
                    " [agua water consumo consumption anual year hm3 DMA "
                    "disponibilidad extracción demanda CONAGUA CEA acuífero déficit]"
                )
            chunks.append({
                "id": f"g:{theme}:{i}",
                "title": f"Guía {theme}: {heading}"[:120],
                "path": f"guides/{md.name}#{i}",
                "theme": theme if theme != "territorio" else "demografia",
                "sum_es": clip(summary + extra, 950),
                "sum_en": clip(summary + extra, 950),
                "drive_url": None,
                "type": "guide",
            })

    muni = json.load(open(ROOT / "src/data/municipios.json"))
    for name, m in muni.items():
        cab = m.get("cabecera") or ""
        pob = m.get("pob")
        cab_pob = m.get("cab_pob")
        same = cab.strip().lower() == name.strip().lower()
        # Municipal total first; the cabecera figure is a single locality and is named as such (never as the municipio).
        sum_es = (
            f"Población del municipio {name} (municipio completo, CVE {m.get('cve')}): {pob:,} habitantes "
            f"(INEGI Censo de Población y Vivienda 2020, POBTOT municipal; gente, demografía, censo). "
            f"Su cabecera, la localidad {cab}, tiene {cab_pob:,} habitantes: es la cifra de una localidad, no el total del municipio. "
            + (f"«{name}» nombra tanto al municipio como a su cabecera; sin otra precisión, «población de {name}» = {pob:,} (municipio). " if same else "")
            + f"Localidades con población: {m.get('locs')}. "
            f"Fortalezas: {m.get('strengths_es') or ''} Candados/limitaciones: {m.get('locks_es') or ''}"
        )
        sum_en = (
            f"Population of the municipality of {name} (whole municipality, CVE {m.get('cve')}): {pob:,} inhabitants "
            f"(INEGI Census 2020, municipal POBTOT). "
            f"Its seat, the locality of {cab}, has {cab_pob:,} inhabitants: a single locality, not the municipal total. "
            + (f"“{name}” names both the municipality and its seat; unless the city is specified, “population of {name}” = {pob:,} (municipality). " if same else "")
            + f"Localities: {m.get('locs')}. "
            f"Strengths: {m.get('strengths_en') or ''} Constraints: {m.get('locks_en') or ''}"
        )
        chunks.append({
            "id": f"m:{name}",
            "title": f"Población del municipio {name} — INEGI Censo 2020",
            "path": f"municipios/{name}",
            "theme": "demografia",
            "sum_es": clip(sum_es, 900),
            "sum_en": clip(sum_en, 900),
            "drive_url": None,
            "type": "municipio",
        })
        # Cabecera / locality chunk (answers “cuánta gente vive en la ciudad de X”) — always paired with the municipal total
        if cab and cab_pob:
            if same:
                lead_es = (
                    f"«{name}» designa al municipio y a su cabecera. Municipio {name} (total municipal): {pob:,} habitantes. "
                    f"Ciudad / localidad {cab} (cabecera): {cab_pob:,} habitantes. "
                    f"Si la pregunta no precisa «ciudad» o «localidad», la población de {name} es la municipal ({pob:,}); la de la ciudad se da aparte. "
                )
                lead_en = (
                    f"“{name}” names both the municipality and its seat. Municipality of {name} (municipal total): {pob:,} inhabitants. "
                    f"City / locality of {cab} (seat): {cab_pob:,} inhabitants. "
                    f"Unless the city is specified, the population of {name} is the municipal one ({pob:,}). "
                )
            else:
                lead_es = (
                    f"Ciudad / localidad {cab}, cabecera del municipio {name}: {cab_pob:,} habitantes (POBTOT de la localidad). "
                    f"No es la población del municipio: el municipio {name} suma {pob:,} habitantes. "
                )
                lead_en = (
                    f"City / locality of {cab}, seat of the municipality of {name}: {cab_pob:,} inhabitants (locality POBTOT). "
                    f"Not the municipal population: the municipality of {name} totals {pob:,}. "
                )
            fact_es = lead_es + "Fuente: INEGI, Censo de Población y Vivienda 2020 (resultados por localidad, ITER)."
            fact_en = lead_en + "Source: INEGI, Population and Housing Census 2020 (locality results, ITER)."
            chunks.append({
                "id": f"m:loc:{cab}",
                "title": f"Población de la localidad {cab}, cabecera del municipio {name} — INEGI Censo 2020",
                "path": f"municipios/{name}/localidad/{cab}",
                "theme": "demografia",
                "sum_es": clip(fact_es, 700),
                "sum_en": clip(fact_en, 700),
                "drive_url": None,
                "type": "municipio",
            })

    # Top localities with real POBTOT (from portal data, sourced INEGI)
    top_path = ROOT / "src/data/top_localities.json"
    if top_path.is_file():
        tops = json.load(open(top_path))
        # One chunk per municipio with top localities listed
        by_mun = {}
        for row in tops:
            mun = row.get("nom_mun") or ""
            by_mun.setdefault(mun, []).append(row)
        for mun, rows in by_mun.items():
            lines = []
            for row in rows[:8]:
                loc = row.get("nom_loc") or ""
                try:
                    pob = int(str(row.get("pobtot") or "0"))
                except ValueError:
                    continue
                tier = row.get("tier") or ""
                lines.append(f"{loc}: {pob:,} hab. ({tier})")
            if not lines:
                continue
            mt = (muni.get(mun) or {}).get("pob")
            body = (
                (f"Municipio {mun}: {mt:,} habitantes en total (municipal). " if mt else "")
                + f"Localidades principales de {mun} — población / habitantes / gente "
                f"(INEGI Censo 2020 CPV POBTOT, demografía): " + "; ".join(lines) + "."
            )
            chunks.append({
                "id": f"loc:{mun}",
                "title": f"Localidades y población — {mun} (INEGI 2020)",
                "path": f"05_demographics/top_localities/{mun}",
                "theme": "demografia",
                "sum_es": clip(body, 900),
                "sum_en": clip(body, 900),
                "drive_url": None,
                "type": "municipio",
            })

    # Explicit state + major-city demographics cheat-sheet (numbers from municipios/top_localities only)
    cheat_lines = [
        "Población Baja California Sur (INEGI Censo 2020 / CPV / ITER — demografía, habitantes, gente, viviendas):"
    ]
    for name, m in muni.items():
        cheat_lines.append(
            f"Municipio {name} (total municipal): {m.get('pob'):,} hab.; su cabecera, la localidad {m.get('cabecera')}: {m.get('cab_pob'):,} hab."
        )
    # Add CSL from top_localities if present
    if top_path.is_file():
        for row in tops:
            if (row.get("nom_loc") or "") == "Cabo San Lucas":
                cheat_lines.append(
                    f"Localidad Cabo San Lucas (Los Cabos): {int(row['pobtot']):,} habitantes."
                )
                break
    cheat = " ".join(cheat_lines)
    chunks.append({
        "id": "demo:bcs:censo2020",
        "title": "Población municipal y cabeceras BCS — INEGI Censo 2020",
        "path": "05_demographics/portal_extract_censo2020_municipios",
        "theme": "demografia",
        "sum_es": clip(cheat, 950),
        "sum_en": clip(cheat, 950),
        "drive_url": None,
        "type": "municipio",
    })


    # Portal fact-cards from guide markdown tables (P1)
    facts_paths = [
        ROOT / "src" / "data" / "portal_facts.json",
        ROOT / "public" / "portal_facts.json",
    ]
    facts_data = None
    for fp in facts_paths:
        if fp.is_file():
            try:
                facts_data = json.load(open(fp, encoding="utf-8"))
                break
            except Exception:
                continue
    n_facts = 0
    if facts_data:
        for fact in facts_data.get("facts") or []:
            metric = (fact.get("metric") or "").strip()
            value = (fact.get("value") or "").strip()
            if not metric or not value:
                continue
            theme = fact.get("theme") or "portal"
            unit = fact.get("unit") or ""
            year = fact.get("year") or ""
            src = fact.get("source") or fact.get("path") or ""
            # Heavy lexical weight on metric tokens for retrieval
            metric_tokens = re.findall(r"[A-Za-zÁÉÍÓÚáéíóúñÑ0-9%]{3,}", metric)
            boost = " ".join(dict.fromkeys(metric_tokens + metric_tokens))  # duplicate for weight
            body_es = (
                f"Hecho portal [{theme}]: {metric} = {value}"
                + (f" {unit}" if unit and unit not in value else "")
                + (f" ({year})" if year else "")
                + f". Fuente: {src}."
                + f" [{boost} cifra dato tabla guía {theme}]"
            )
            body_en = (
                f"Portal fact [{theme}]: {metric} = {value}"
                + (f" {unit}" if unit and unit not in value else "")
                + (f" ({year})" if year else "")
                + f". Source: {src}."
                + f" [{boost} figure table guide {theme}]"
            )
            fid = fact.get("id") or f"fact:{theme}:{n_facts}"
            chunks.append({
                "id": fid if str(fid).startswith("fact:") else f"fact:{fid}",
                "title": f"Hecho {theme}: {metric}"[:120],
                "path": fact.get("path") or f"guides/{theme}.md#fact",
                "theme": theme,
                "sum_es": clip(body_es, 700),
                "sum_en": clip(body_en, 700),
                "drive_url": None,
                "type": "fact",
                "metric": metric,
                "value": value,
            })
            n_facts += 1
        print(f"portal_facts_added={n_facts}")


    # Ontology graph — ALL nodes with summaries (+ 1-hop relation hints) for RAG
    graph_paths = [
        ROOT / "src" / "data" / "graph.json",
        LAKE / "12_ontology" / "graph.json",
    ]
    graph = None
    graph_src = None
    for gp in graph_paths:
        if gp.is_file():
            try:
                graph = json.load(open(gp, encoding="utf-8"))
                graph_src = gp
                break
            except Exception:
                continue
    if graph and isinstance(graph.get("nodes"), list):
        by_id = {n.get("id"): n for n in graph["nodes"] if n.get("id")}
        # adjacency for 1-hop neighbor labels
        adj = {nid: [] for nid in by_id}
        for e in graph.get("edges") or []:
            a, b = e.get("from"), e.get("to")
            pred = e.get("predicate") or "related"
            if a in adj and b in by_id:
                adj[a].append((pred, b))
            if b in adj and a in by_id:
                adj[b].append((pred + "_of", a))

        def theme_for(hay: str, ntype: str) -> str:
            if any(k in hay for k in ("agua", "dma", "acuif", "hm3", "hm³", "desal", "conagua")):
                return "agua"
            if any(k in hay for k in ("energi", "sibcs", "cfe", "cenace", "prodesen", "pamrnt", "elect")):
                return "energia"
            if any(k in hay for k in ("pdu", "poer", "ordenamiento", "planeacion", "uga", "ped")):
                return "planeacion"
            if any(k in hay for k in ("anp", "proteg", "turismo", "costa", "pulmo", "vizcaino")):
                return "ambiente"
            if ntype == "Constraint":
                return "limitaciones"
            if ntype in ("Actor", "Instrument"):
                return "ontologia"
            return "ontologia"

        def type_tags(ntype: str, hay: str) -> str:
            tags = [ntype, "ontologia", "ontology", "capacidad", "capacidades", "restriccion",
                    "restricciones", "constraint", "actor", "actores", "stakeholder",
                    "instrumento", "instrumentos", "demanda", "vocacion", "vocaciones",
                    "DemandDriver", "ResourceCapacity", "Constraint", "Actor", "Instrument"]
            if "agua" in hay or "dma" in hay or "acuif" in hay:
                tags += ["agua", "water", "DMA", "hm3", "acuífero", "disponibilidad", "consumo"]
            if "energi" in hay or "sibcs" in hay:
                tags += ["energia", "energy", "SIBCS", "red aislada"]
            if "anp" in hay or "proteg" in hay or "turismo" in hay:
                tags += ["ANP", "turismo", "protected", "costa", "presión"]
            if "pdu" in hay or "poer" in hay:
                tags += ["PDU", "POER", "planeacion", "crecimiento"]
            if "crecimiento" in hay or "growth" in hay:
                tags += ["crecimiento", "growth", "capacidad de carga"]
            return " ".join(tags)

        n_onto = 0
        for node in graph["nodes"]:
            ntype = node.get("type") or ""
            nid = node.get("id") or ""
            if not nid:
                continue
            label = node.get("label") or nid
            label_en = node.get("label_en") or label
            summary = (node.get("summary") or "").strip()
            summary_en = (node.get("summary_en") or summary).strip()
            if not summary and not summary_en:
                continue
            hay = f"{nid} {label} {label_en} {summary} {summary_en}".lower()
            # 1-hop relation hint (capacity, constraints, actors, instruments)
            neigh = []
            for pred, oid in adj.get(nid, [])[:8]:
                on = by_id.get(oid) or {}
                ol = on.get("label") or oid
                neigh.append(f"{pred}→{ol}")
            rel_es = (" Relaciones: " + "; ".join(neigh) + ".") if neigh else ""
            rel_en = (" Relations: " + "; ".join(neigh) + ".") if neigh else ""
            tags = type_tags(ntype, hay)
            sum_es = f"Ontología {ntype} [{nid}] {label}. {summary}{rel_es} [{tags}]"
            sum_en = f"Ontology {ntype} [{nid}] {label_en}. {summary_en}{rel_en} [{tags}]"
            chunks.append({
                "id": f"onto:{nid}",
                "title": f"Ontology {ntype}: {label}"[:120],
                "path": f"12_ontology/graph.json#{nid}",
                "theme": theme_for(hay, ntype),
                "sum_es": clip(sum_es, 950),
                "sum_en": clip(sum_en, 950),
                "drive_url": None,
                "type": "ontology",
                "onto_id": nid,
                "onto_type": ntype,
            })
            n_onto += 1
        print(f"ontology_nodes_added={n_onto}")

        # Ship graph copy for runtime 1-hop injection in the Netlify function
        fn_graph = ROOT / "netlify" / "functions" / "ontology_graph.json"
        slim = {
            "nodes": [
                {
                    "id": n.get("id"),
                    "type": n.get("type"),
                    "label": n.get("label"),
                    "label_en": n.get("label_en"),
                    "summary": n.get("summary"),
                    "summary_en": n.get("summary_en"),
                }
                for n in graph["nodes"]
                if n.get("id")
            ],
            "edges": [
                {"from": e.get("from"), "to": e.get("to"), "predicate": e.get("predicate")}
                for e in (graph.get("edges") or [])
                if e.get("from") and e.get("to")
            ],
        }
        fn_graph.write_text(json.dumps(slim, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"ontology_graph_copied={fn_graph} from={graph_src}")

    # Curated bilingual DMA snapshot (documented deficits — not official statewide consumption)
    dma_es = (
        "Snapshot agua BCS — déficits DMA documentados (CONAGUA 2024 / guía agua / ontología), "
        "NO un total oficial de consumo estatal. "
        "Acuíferos clave en déficit (hm³/año): "
        "0317 Cabo San Lucas ≈ −24.07 (ontología ~−24); "
        "0319 San José del Cabo ≈ −12.49 (ontología ~−12.5); "
        "0324 La Paz ≈ −13.49 (ontología ~−13.5); "
        "0313 Todos Santos ≈ −2.96 (ontología ~−3). "
        "Suma déficits de estos 4 polos ≈ 53 hm³/año; "
        "suma déficits pack sur (7 acuíferos en guía agua) ≈ 63.88 hm³/año. "
        "DMA = R − DNC − VEAS (NOM-011): mide disponibilidad/presión, no 'consumo' municipal facturado. "
        "Estimación de presión hídrica sur = suma de déficits (o extracción si aparece en resúmenes). "
        "Fuentes: guides/agua.md, 02_water CONAGUA Actualización DMA, nodos rc_acuifero_* / const_dma_deficit. "
        "[consumo consumption anual year hm3 water agua demanda extracción disponibilidad]"
    )
    dma_en = (
        "BCS water snapshot — documented DMA deficits (CONAGUA 2024 / agua guide / ontology), "
        "NOT an official statewide consumption total. "
        "Key aquifers in deficit (hm³/year): "
        "0317 Cabo San Lucas ≈ −24.07 (ontology ~−24); "
        "0319 San José del Cabo ≈ −12.49 (ontology ~−12.5); "
        "0324 La Paz ≈ −13.49 (ontology ~−13.5); "
        "0313 Todos Santos ≈ −2.96 (ontology ~−3). "
        "Sum of these 4 growth-pole deficits ≈ 53 hm³/year; "
        "south pack deficit sum (7 aquifers in agua guide) ≈ 63.88 hm³/year. "
        "DMA = R − DNC − VEAS (NOM-011): availability/pressure metric, not billed municipal 'consumption'. "
        "Estimate of southern water pressure = sum of deficits (or extraction if present in summaries). "
        "Sources: guides/agua.md, 02_water CONAGUA DMA updates, rc_acuifero_* / const_dma_deficit nodes. "
        "[consume consumption yearly annual hm3 water demand extraction availability]"
    )
    chunks.append({
        "id": "water:bcs-dma-snapshot",
        "title": "BCS DMA deficit snapshot — CONAGUA / ontology (estimate basis)",
        "path": "guides/agua.md#dma-snapshot",
        "theme": "agua",
        "sum_es": clip(dma_es, 950),
        "sum_en": clip(dma_en, 950),
        "drive_url": None,
        "type": "guide",
    })

    # Stills territorial intelligence (spatial + vision) for RAG — denser captions + ontology links
    stills_know = ROOT / "public" / "chat_stills_knowledge.json"
    if stills_know.is_file():
        try:
            sk = json.loads(stills_know.read_text(encoding="utf-8"))
            n_add = 0
            for row in sk:
                if not isinstance(row, dict):
                    continue
                typ = row.get("type") or "still"
                # Keep all still_summary cards; for per-still keep spatial/visual substance
                if typ == "still":
                    hay = ((row.get("sum_es") or "") + " " + (row.get("title") or "")).lower()
                    if not any(
                        k in hay
                        for k in (
                            "anp", "proteg", "costa", "uga", "uga", "cabecera", "turismo",
                            "puerto", "carretera", "mapa", "cartograf", "gis", "satelit",
                            "earth", "studio", "visible", "municipio", "loreto", "cabos",
                            "vizcaino", "pulmo", "asentamiento", "cobertura",
                        )
                    ):
                        continue
                chunk = {
                    "id": row.get("id") or ("stillx:" + str(n_add)),
                    "title": (row.get("title") or "Still")[:120],
                    "path": row.get("path") or row.get("href") or "stills/intelligence",
                    "theme": row.get("theme") or "territorio",
                    "sum_es": clip(row.get("sum_es") or row.get("title") or "", 950),
                    "sum_en": clip(row.get("sum_en") or row.get("sum_es") or "", 950),
                    "drive_url": row.get("drive_url"),
                    "type": "still" if str(typ).startswith("still") else typ,
                }
                if row.get("municipio"):
                    chunk["municipio"] = row["municipio"]
                if row.get("lat") is not None:
                    chunk["lat"] = row["lat"]
                if row.get("lon") is not None:
                    chunk["lon"] = row["lon"]
                if row.get("ontology_ids"):
                    chunk["ontology_ids"] = row["ontology_ids"]
                if row.get("href"):
                    chunk["href"] = row["href"]
                chunks.append(chunk)
                n_add += 1
            print(f"stills_knowledge_added={n_add}")
        except Exception as e:
            print(f"stills_knowledge_skip={type(e).__name__}:{e}")

    # Spatial portal guides: /mapas, /earth-studio, /stills, /studio + JPG gallery highlights
    try:
        gallery = []
        gall_path = ROOT / "src" / "data" / "maps_gallery.json"
        if gall_path.is_file():
            gallery = json.loads(gall_path.read_text(encoding="utf-8"))
        # Portal how-to spatial
        chunks.append({
            "id": "portal:mapas-gis",
            "title": "Mapas GIS BCS — capas interactivas y galería",
            "path": "portal/mapas",
            "theme": "territorio",
            "sum_es": clip(
                "Página /mapas: mapa GIS interactivo del territorio BCS (Leaflet) con capas OSM "
                "(carreteras, ríos, costa), ANP/POER UGA, stills Earth Studio (toggle), lugares de foco. "
                "Galería JPG temática (PDU 2040 Los Cabos, POERBCS UGAs, DMA acuíferos, atlas de riesgos). "
                "Fotos georreferenciadas en /stills; tour /earth-studio; síntesis municipal /studio. "
                "WGS84. Para preguntas tipo «qué muestra el mapa de Los Cabos» usar galería PDU/POER + stills municipio. "
                "[mapa mapas cartografía GIS GIS still imagen vista satélite Earth Studio ubicación lat lon]",
                950,
            ),
            "sum_en": clip(
                "Page /mapas: interactive BCS GIS map (Leaflet) with OSM layers (roads, rivers, coast), "
                "ANP/POER UGA, Earth Studio stills (toggle), focus places. Thematic JPG gallery "
                "(Los Cabos PDU 2040, POERBCS UGAs, DMA aquifers, hazard atlas). "
                "Georeferenced photos at /stills; tour /earth-studio; municipal synthesis /studio. "
                "[map maps cartography GIS still image satellite Earth Studio location]",
                950,
            ),
            "drive_url": None,
            "type": "guide",
            "href": "/mapas",
        })
        chunks.append({
            "id": "portal:earth-studio",
            "title": "Earth Studio / stills georreferenciados BCS",
            "path": "portal/earth-studio",
            "theme": "territorio",
            "sum_es": clip(
                "Earth Studio del programa se consulta como stills georreferenciados (~956) en mapa abierto "
                "(/stills, redirección desde /earth-studio) — no como paquete ESP/KML. Cada still tiene cruce GIS "
                "(ANP, UGA, costa, carretera) + visión de lo visible. Capas también en /mapas#gis. "
                "[Earth Studio stills imagen vista satélite mapa cartografía GIS ubicación]",
                950,
            ),
            "sum_en": clip(
                "Programme Earth Studio is available as ~956 georeferenced stills on an open map "
                "(/stills, redirected from /earth-studio) — not as ESP/KML. Each still has GIS join "
                "(ANP, UGA, coast, road) + vision of what is visible. Also on /mapas#gis. "
                "[Earth Studio stills image satellite map cartography GIS location]",
                950,
            ),
            "drive_url": None,
            "type": "guide",
            "href": "/earth-studio",
        })
        chunks.append({
            "id": "portal:stills-guide",
            "title": "Stills BCS — galería y mapa de fotogramas",
            "path": "portal/stills",
            "theme": "territorio",
            "sum_es": clip(
                "Página /stills: galería + mapa Leaflet de fotogramas Earth Studio por municipio/lugar "
                "(Los Cabos, Loreto costa, East Cape, Vizcaíno, La Paz, Comondú, Mulegé). "
                "Útil para describir qué se ve (costa, ANP, asentamiento, cobertura) citando el still — "
                "sin inventar coordenadas fuera del contexto. Ver también /mapas y ontología Territory. "
                "[stills still imagen vista satélite mapa cartografía GIS Earth Studio ubicación costa Loreto Cabos]",
                950,
            ),
            "sum_en": clip(
                "Page /stills: gallery + Leaflet map of Earth Studio frames by municipality/place "
                "(Los Cabos, Loreto coast, East Cape, Vizcaíno, La Paz, Comondú, Mulegé). "
                "Describe what is visible citing the still — do not invent coordinates absent from context. "
                "[stills still image satellite map cartography GIS Earth Studio location coast]",
                950,
            ),
            "drive_url": None,
            "type": "guide",
            "href": "/stills",
        })
        chunks.append({
            "id": "portal:studio-spatial",
            "title": "Studio territorial — síntesis espacial por municipio",
            "path": "portal/studio",
            "theme": "territorio",
            "sum_es": clip(
                "Página /studio: hub de síntesis territorial (estado + municipios). Complementa /mapas y /stills "
                "con vocación, demanda–oferta y preguntas estratégicas por unidad. "
                "[studio mapa territorio municipio Los Cabos Loreto La Paz Comondú Mulegé cartografía]",
                900,
            ),
            "sum_en": clip(
                "Page /studio: territorial synthesis hub (state + municipalities). Complements /mapas and /stills "
                "with vocation, demand–supply and strategic questions per unit. "
                "[studio map territory municipality cartography]",
                900,
            ),
            "drive_url": None,
            "type": "guide",
            "href": "/studio",
        })
        # Highlight gallery maps (PDU Cabos, POER, DMA, risks) as individual spatial cards
        n_g = 0
        for m in gallery:
            title = m.get("title_es") or m.get("title_en") or m.get("file") or "mapa"
            src = m.get("src") or m.get("file") or ""
            theme = m.get("theme") or "territorio"
            blob = f"{title} {src} {theme}".lower()
            # Prefer maps useful for «mapa de Los Cabos» / planning / water / hazards
            if not any(k in blob for k in ("pdu", "cabos", "poer", "uga", "dma", "paz", "loreto", "cicl", "riesgo", "atlas", "inund", "tsunami")):
                continue
            # Place tags only when the map title/file actually refers to that place
            place_tags = []
            blob_places = f"{title} {src}".lower()
            if any(k in blob_places for k in ("cabos", "cabo san lucas", "san jose del cabo", "pdu2040", "pdu-2040")):
                place_tags.extend(["Los Cabos", "cabos"])
            if any(k in blob_places for k in ("la paz", "paz", "todos santos", "barriles")):
                place_tags.extend(["La Paz", "paz"])
            if "loreto" in blob_places:
                place_tags.extend(["Loreto", "loreto"])
            if any(k in blob_places for k in ("mulegé", "mulege", "vizcaíno", "vizcaino", "rosalía", "rosalia")):
                place_tags.extend(["Mulegé", "mulege"])
            if any(k in blob_places for k in ("comondú", "comondu", "constitución", "constitucion")):
                place_tags.extend(["Comondú", "comondu"])
            place_txt = " ".join(dict.fromkeys(place_tags)) or "BCS"
            chunks.append({
                "id": f"portal:map-gallery:{Path(src).stem or n_g}",
                "title": f"Mapa galería: {title}",
                "path": f"portal/mapas#gallery:{Path(src).name}",
                "theme": theme if theme in ("agua","energia","ambiente","conectividad","riesgos","territorio","planeacion","economia") else "territorio",
                "sum_es": clip(
                    f"Mapa temático JPG «{title}» en /mapas (galería). Tema: {theme}. "
                    f"Archivo: {src}. Fuente: {m.get('source') or 'pack mapas portal'}. "
                    f"Ámbito: {place_txt}. "
                    f"Usar para describir qué muestra el mapa (sin inventar capas no listadas). "
                    f"Relacionado: /mapas, /stills, guías temáticas. "
                    f"[mapa cartografía GIS imagen {title} {theme} {place_txt}]",
                    900,
                ),
                "sum_en": clip(
                    f"Thematic JPG map «{m.get('title_en') or title}» on /mapas (gallery). Theme: {theme}. "
                    f"File: {src}. Source: {m.get('source_en') or m.get('source') or 'portal maps pack'}. "
                    f"Scope: {place_txt}. "
                    f"Describe what the map shows (do not invent unlisted layers). "
                    f"[map cartography GIS image {title} {theme} {place_txt}]",
                    900,
                ),
                "drive_url": None,
                "type": "guide",
                "href": "/mapas",
            })
            n_g += 1
            if n_g >= 18:
                break
        print(f"spatial_portal_guides=4 gallery_map_chunks={n_g}")
    except Exception as e:
        print(f"spatial_portal_skip={type(e).__name__}:{e}")

    # FlightConnections BCS non-stop destinations (portal /vuelos)
    try:
        fc_path = ROOT / "src" / "data" / "flight_connections_bcs.json"
        if fc_path.is_file():
            fc = json.loads(fc_path.read_text(encoding="utf-8"))
            lines_es = []
            lines_en = []
            for ap in fc.get("airports") or []:
                c = ap.get("counts") or {}
                dests = ap.get("destinations") or []
                top = ", ".join(f"{d.get('city')} ({d.get('iata')})" for d in dests[:12])
                more = len(dests) - 12
                top_s = top + (f" … +{more}" if more > 0 else "")
                lines_es.append(
                    f"{ap.get('iata')} {ap.get('name_es') or ap.get('name')}: "
                    f"{c.get('total', len(dests))} destinos sin escalas "
                    f"(MX {c.get('mx',0)} / US {c.get('us',0)} / CA {c.get('ca',0)} / EU {c.get('eu',0)} / other {c.get('other',0)}). "
                    f"Ejemplos: {top_s}."
                )
                lines_en.append(
                    f"{ap.get('iata')} {ap.get('name')}: "
                    f"{c.get('total', len(dests))} non-stop destinations "
                    f"(MX {c.get('mx',0)} / US {c.get('us',0)} / CA {c.get('ca',0)} / EU {c.get('eu',0)} / other {c.get('other',0)}). "
                    f"Examples: {top_s}."
                )
            retrieved = fc.get("retrieved") or "2026-09-17"
            src = fc.get("source") or "FlightConnections.com"
            body_es = (
                f"Conectividad aérea BCS (rutas sin escalas) según {src}, consultado {retrieved}. "
                + " ".join(lines_es)
                + " Ver panel /vuelos. Los horarios cambian; verificar en la fuente. "
                "[vuelos flights SJD LAP LTO aeropuerto airport destinos sin escalas non-stop "
                "FlightConnections Los Cabos La Paz Loreto]"
            )
            body_en = (
                f"BCS air connectivity (non-stop routes) per {src}, retrieved {retrieved}. "
                + " ".join(lines_en)
                + " See /vuelos panel. Schedules change; verify on source. "
                "[vuelos flights SJD LAP LTO airport non-stop destinations "
                "FlightConnections Los Cabos La Paz Loreto]"
            )
            chunks.append({
                "id": "portal:flight-connections-bcs",
                "title": "Vuelos / Air connectivity BCS (FlightConnections)",
                "path": "portal/vuelos",
                "theme": "conectividad",
                "sum_es": clip(body_es, 950),
                "sum_en": clip(body_en, 950),
                "drive_url": None,
                "type": "guide",
            })
            # Per-airport short facts for “what flights from SJD?”
            for ap in fc.get("airports") or []:
                dests = ap.get("destinations") or []
                c = ap.get("counts") or {}
                listing = ", ".join(f"{d.get('city')} ({d.get('iata')})" for d in dests)
                iata = ap.get("iata")
                chunks.append({
                    "id": f"portal:flights-from-{iata}",
                    "title": f"Flights from {iata} / Vuelos desde {iata}",
                    "path": f"portal/vuelos#{(iata or '').lower()}",
                    "theme": "conectividad",
                    "sum_es": clip(
                        f"¿Qué vuelos hay desde {iata}? Destinos sin escalas según FlightConnections.com "
                        f"(consultado {retrieved}): {c.get('total', len(dests))} rutas — {listing}. "
                        f"Fuente: {ap.get('source_url')}. Verificar horarios en origen. "
                        f"[vuelos flights from {iata} non-stop destinos aeropuerto]",
                        950,
                    ),
                    "sum_en": clip(
                        f"What flights from {iata}? Non-stop destinations per FlightConnections.com "
                        f"(retrieved {retrieved}): {c.get('total', len(dests))} routes — {listing}. "
                        f"Source: {ap.get('source_url')}. Verify schedules on source. "
                        f"[vuelos flights from {iata} non-stop destinations airport]",
                        950,
                    ),
                    "drive_url": None,
                    "type": "guide",
                })
            print(f"flight_connections_chunks=1+{len(fc.get('airports') or [])}")
    except Exception as e:
        print(f"flight_connections_skip={type(e).__name__}:{e}")

    # Foresights / Prospectiva — weekly place-vocation intelligence
    chunks.append({
        "id": "portal:foresights",
        "title": "Prospectiva BCS / Foresights (vocaciones de lugar)",
        "path": "portal/foresights",
        "theme": "planeacion",
        "sum_es": (
            "Página /foresights (también /prospectiva): prospectiva semanal BCS 2050. "
            "Columna vertebral geográfica = vocaciones de lugar (Los Cabos motor turístico; East Cape/San José del Este; "
            "Todos Santos–El Pescadero; La Paz capital; Loreto turismo–conservación; Constitución/Comondú agro; "
            "norte/Mulegé energía remota). La suma de vocaciones = estrategia coherente — no un futuro uniforme. "
            "Señales + lentes de rol + semillas de consenso + watchlist. Inteligencia interna / borrador; no plan oficial. "
            "El gemelo territorial fase 1 está en /gemelo (también /cdt): mapas, cifras y escenarios, sin modelo de predios. "
            "Ver también Noticias, Catálogo, Ontología, Actores, Mapas. "
            "[foresights prospectiva vocaciones lugares BCS 2050 signals consensus gemelo territorial]"
        ),
        "sum_en": (
            "Page /foresights (also /prospectiva): weekly BCS 2050 foresight. "
            "Geographic backbone = place vocations (Los Cabos tourism engine; East Cape/San José del Este; "
            "Todos Santos–El Pescadero; La Paz capital; Loreto tourism–conservation; Constitución/Comondú agri; "
            "north/Mulegé remote energy). Sum of vocations = coherent strategy — not one uniform future. "
            "Signals + role lenses + consensus seeds + watchlist. Internal draft intelligence; not an official plan. "
            "Phase-1 territorial twin is at /gemelo (also /cdt): maps, figures and scenarios, with no parcel model. "
            "See also News, Catalog, Ontology, Stakeholders, Maps. "
            "[foresights prospectiva place vocations BCS 2050 signals consensus territorial twin]"
        ),
        "drive_url": None,
        "type": "guide",
    })


    # Growth demand–supply by place vocation (pre-scenario layer)
    chunks.append({
        "id": "portal:crecimiento-demand-supply",
        "title": "Crecimiento demanda–oferta / Growth demand–supply",
        "path": "portal/crecimiento",
        "theme": "planeacion",
        "sum_es": (
            "Página /crecimiento (también /demand-supply, /oferta-demanda): scorecard de demanda vs oferta "
            "de crecimiento por vocación de lugar (Los Cabos, East Cape, Todos Santos, La Paz, Loreto, "
            "Constitución/Comondú, norte/Mulegé). Demanda = turismo/vuelos/asentamiento/economía desde datos "
            "reales del portal; oferta = agua DMA, energía SIBCS, PDU/POEL/PMD, ANPs. Celdas sin cifra: "
            "status gap. Roll-up estatal: qué debe ser verdad para que las vocaciones sumen a un 2050 coherente. "
            "El gemelo territorial fase 1 (/gemelo) usa esta capa junto con escenarios y el mapa. "
            "Ver Prospectiva, Resumen, Agua, Energía, Vuelos. "
            "[crecimiento demand supply demanda oferta vocaciones capacidad DMA SIBCS carrying capacity gaps gemelo]"
        ),
        "sum_en": (
            "Page /crecimiento (also /demand-supply, /oferta-demanda): demand vs supply growth scorecard "
            "by place vocation (Los Cabos, East Cape, Todos Santos, La Paz, Loreto, Constitución/Comondú, "
            "north/Mulegé). Demand = tourism/flights/settlement/economy from real portal data; supply = DMA water, "
            "SIBCS energy, PDU/POEL/PMD, ANPs. Cells without numbers: status gap. State roll-up: what must be true "
            "for vocations to sum to a coherent 2050. The phase-1 territorial twin (/gemelo) uses this layer "
            "together with scenarios and the map. See Foresights, Summary, Water, Energy, Flights. "
            "[crecimiento demand supply vocations capacity DMA SIBCS carrying capacity gaps territorial twin]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    # Territorial twin phase 1 — five CDT themes on portal data, not a parcel model
    chunks.append({
        "id": "portal:gemelo-territorial-p1",
        "title": "Gemelo territorial BCS / Territorial twin phase 1",
        "path": "portal/gemelo",
        "theme": "planeacion",
        "sum_es": (
            "Página /gemelo (alias /cdt; /decision y /decision-twin redirigen aquí): Gemelo territorial fase 1 "
            "de Baja California Sur. Apoyo a la decisión para técnicos, con etiquetas en español claro. "
            "Cinco temas: diseño urbano (asentamiento, localidades y ordenamiento; no hay AGEB ni dimensión fractal "
            "ni centralidad de intermediación), desarrollo económico (ingresos municipales donde hay cifra, proyectos "
            "federales, lectura demanda–oferta), innovación e investigación (mapa de relaciones, preguntas estratégicas, "
            "prospectiva y brechas; no hay red de colaboración entre escuelas), movilidad y logística (pasajeros aéreos, "
            "destinos sin escalas, cruceros DataTur, carreteras) y vivienda y nivel de vida (rezago CONAVI, registro "
            "SNIIV por municipio, pobreza CONEVAL 2020). Cada tema muestra capas del mapa, fichas con cifras ya "
            "publicadas y un diagnóstico corto. Escenarios: trayectoria actual, intensificar corredor Cabos–La Paz, "
            "agua primero, puertos y aeropuertos como anclas. Enlace al mapa: /mapas?scenario= y capas del tema. "
            "Comparación de los cinco municipios (población 2020, registro de vivienda 2025, pobreza 2020). "
            "East Cape se lee dentro de Los Cabos y Todos Santos dentro de La Paz. Recomendaciones por reglas de "
            "demanda–oferta de crecimiento: no son puntuaciones por predio ni modelo catastral. "
            "Cómo usarlo: tema, escenario, comparar municipios, recomendaciones. Complementa la consulta en /inicio. "
            "Casos de otras ciudades (fuente externa, sin cifras del portal): /aprendizaje. Ver /crecimiento, "
            "/mapas, /ontologia, /inmobiliario, /puertos. "
            "[gemelo territorial city digital twin cdt temas diseño urbano economía innovación movilidad vivienda escenarios comparar municipios]"
        ),
        "sum_en": (
            "Page /gemelo (alias /cdt; /decision and /decision-twin redirect here): phase-1 territorial twin "
            "for Baja California Sur. Decision support for technical readers, with plain labels. "
            "Five themes: urban design (settlement, localities and zoning; no AGEB, fractal dimension or betweenness), "
            "economic development (municipal revenue where a figure exists, federal projects, demand–supply read), "
            "innovation and research (relationship map, strategic questions, foresight and gaps; no university "
            "collaboration network), mobility and logistics (air passengers, non-stop destinations, DataTur cruises, "
            "highways) and housing and living standard (CONAVI backlog, SNIIV registry by municipality, CONEVAL 2020 "
            "poverty). Each theme shows map layers, cards with figures already published, and a short diagnostic. "
            "Scenarios: current trajectory, intensify Cabos–La Paz corridor, water first, ports and airports as anchors. "
            "Map link: /mapas?scenario= plus the theme layers. Comparison of the five municipalities (2020 population, "
            "2025 housing registry, 2020 poverty). East Cape is read inside Los Cabos and Todos Santos inside La Paz. "
            "Recommendations are rules from growth demand and supply: not parcel scores and not a cadastre model. "
            "How to use it: theme, scenario, compare municipalities, recommendations. It complements the consultation at /inicio. "
            "Cases from other cities (external source, no portal figures): /aprendizaje. See /crecimiento, "
            "/mapas, /ontologia, /inmobiliario, /puertos. "
            "[gemelo territorial city digital twin cdt themes urban design economy innovation mobility housing scenarios compare municipalities]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:aprendizaje-ciudades",
        "title": "Aprender de otras ciudades / Learn from other cities",
        "path": "portal/aprendizaje",
        "theme": "planeacion",
        "sum_es": (
            "Página /aprendizaje (también intercambio de casos): casos y redes de otras ciudades para la consulta ciudadana. "
            "Siempre son fuente externa: no traen cifras de Baja California Sur y no sustituyen al portal. "
            "Redes: GPSC (thegpsc.org), UrbanShift (shiftcities.org y es.shiftcities.org; el programa está cerrando y se cita como archivo), "
            "C40 Knowledge Hub, ICLEI, Urban Sustainability Exchange de Metropolis, Plataforma Urbana y de Ciudades de CEPAL, "
            "y la panorámica de desarrollo urbano del Banco Mundial. KPESIC fue una plataforma bilingüe de infraestructura sostenible en América Latina; "
            "su sitio ya no resuelve, así que no se enlaza. Casos: agua y turismo en Los Cabos (IFC y Water Alternatives), "
            "ciudades hídricas y costa en C40, captación de lluvia y parque lineal en Ciudad de México, "
            "y proyectos UrbanShift en Costa Rica, Brasil y Argentina. "
            "El gemelo territorial está en /gemelo. La consulta conversacional está en /inicio. "
            "Pregunta de seguimiento útil: ¿quieres ver el agua, la vivienda o la movilidad de un municipio de BCS? "
            "[aprendizaje intercambio ciudades GPSC UrbanShift C40 ICLEI CEPAL casos externos]"
        ),
        "sum_en": (
            "Page /aprendizaje (also a case exchange): cases and networks from other cities for the citizen consultation. "
            "They are always an external source: they do not bring Baja California Sur figures and they do not replace the portal. "
            "Networks: GPSC (thegpsc.org), UrbanShift (shiftcities.org and es.shiftcities.org; the program is closing and is cited as an archive), "
            "C40 Knowledge Hub, ICLEI, Metropolis Urban Sustainability Exchange, ECLAC Urban and Cities Platform, "
            "and the World Bank urban-development overview. KPESIC was a bilingual Latin American sustainable-infrastructure platform; "
            "its site no longer resolves, so it is not linked. Cases: water and tourism in Los Cabos (IFC and Water Alternatives), "
            "C40 water-safe cities and coastal adaptation, Mexico City rainwater harvesting and a linear park, "
            "and UrbanShift projects in Costa Rica, Brazil and Argentina. "
            "The territorial twin is at /gemelo. The conversational consultation is at /inicio. "
            "A useful follow-up: do you want water, housing or mobility for a BCS municipality? "
            "[aprendizaje case exchange cities GPSC UrbanShift C40 ICLEI CEPAL external cases]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:evidencia-coordinacion-p16",
        "title": "Evidencia externa y coordinación de proyectos / External evidence and project coordination",
        "path": "portal/coordinacion",
        "theme": "planeacion",
        "sum_es": (
            "Fase 1.6. /aprendizaje incluye un bloque de evidencia externa (fuente externa, sin copiar cifras): "
            "WRI Aqueduct 4.0 (wri.org/aqueduct), MapBiomas México (mexico.mapbiomas.org), "
            "WRI Resource Watch (resourcewatch.org), DataMéxico en economia.gob.mx/datamexico "
            "(datamexico.org redirige ahí) y Data Commons (datacommons.org). "
            "No sustituyen acuíferos CONAGUA, censo ni el inventario del portal. "
            "/coordinacion agrupa el inventario federal por la institución tal como está escrita "
            "(44 proyectos). Muestra obra, municipio, estado y sexenio. No calcula fecha de entrega. "
            "El gemelo /gemelo muestra en la comparación la fuente, el año y si la serie cubre los cinco municipios. "
            "Las preguntas estratégicas se cuentan por tema del tablero; una pregunta puede estar en más de un tema. "
            "La prospectiva conserva sus propios temas (agua, energía, turismo, ambiente, suelo, planeación). "
            "Desde Inicio hay accesos a /aprendizaje y al gemelo con el escenario de agua. "
            "Pregunta de seguimiento: ¿quieres la institución de un proyecto federal o la comparación de dos municipios? "
            "[coordinacion evidencia Aqueduct MapBiomas DataMéxico Data Commons gemelo calidad]"
        ),
        "sum_en": (
            "Phase 1.6. /aprendizaje has an external-evidence block (external source, figures not copied): "
            "WRI Aqueduct 4.0 (wri.org/aqueduct), MapBiomas México (mexico.mapbiomas.org), "
            "WRI Resource Watch (resourcewatch.org), DataMéxico at economia.gob.mx/datamexico "
            "(datamexico.org redirects there) and Data Commons (datacommons.org). "
            "They do not replace CONAGUA aquifers, the census or the portal inventory. "
            "/coordinacion groups the federal inventory by the institution line as written "
            "(44 projects). It shows the work, municipality, status and administration. It does not calculate a delivery date. "
            "The twin /gemelo shows, on the comparison, the source, the year and whether the series covers five municipalities. "
            "Strategic questions are counted by board theme; one question can sit in more than one theme. "
            "Foresight keeps its own themes (water, energy, tourism, environment, land, planning). "
            "Home links to /aprendizaje and to the twin on the water scenario. "
            "Follow-up: do you want the institution behind a federal project, or a comparison of two municipalities? "
            "[coordination evidence Aqueduct MapBiomas DataMexico Data Commons twin quality]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:vistas-metas-p17",
        "title": "Vistas guardadas y preguntas abiertas / Saved views and open questions",
        "path": "portal/vistas",
        "theme": "planeacion",
        "sum_es": (
            "Página /vistas: cinco vistas con nombre para una reunión. Cada enlace abre capas y un escenario que ya existen. "
            "1) Agua primero en el sur: /mapas?scenario=water_first#gis y el gemelo con tema vivienda. "
            "2) Crecimiento Cabos–La Paz: /mapas?scenario=corridor_intensify#gis. "
            "3) Puertos y aeropuertos: /mapas?scenario=ports_air_hubs#gis. "
            "4) Contexto de vivienda: asentamientos, ordenamiento y acuíferos en déficit. El rezago CONAVI es estatal y no se reparte por municipio. "
            "5) East Cape y áreas protegidas: /mapas?scenario=baseline&layers=focus_east_cape,anp_federales#gis. "
            "Página /metas: preguntas estratégicas por tema del gemelo (estado abierta), señales de prospectiva (estado en el portal) "
            "y brechas de datos (parcial o abierta, como viene en la lista). No hay porcentaje de avance. "
            "/coordinacion sigue agrupando proyectos federales por institución. "
            "/aprendizaje#evidencia lista Aqueduct, MapBiomas, Resource Watch, DataMéxico y Data Commons como fuente externa. "
            "La lista corta para imprimir está en /aprendizaje. "
            "Pregunta de seguimiento: ¿quieres abrir la vista de agua, la de puertos o una brecha concreta? "
            "[vistas guardadas metas preguntas brechas foro gemelo mapas coordinacion evidencia]"
        ),
        "sum_en": (
            "Page /vistas: five named views for a meeting. Each link opens layers and a scenario that already exist. "
            "1) Water first in the south: /mapas?scenario=water_first#gis and the twin on the housing theme. "
            "2) Cabos–La Paz growth: /mapas?scenario=corridor_intensify#gis. "
            "3) Ports and airports: /mapas?scenario=ports_air_hubs#gis. "
            "4) Housing context: settlements, zoning and deficit aquifers. The CONAVI backlog is statewide and is not split by municipality. "
            "5) East Cape and protected areas: /mapas?scenario=baseline&layers=focus_east_cape,anp_federales#gis. "
            "Page /metas: strategic questions by twin theme (status open), foresight signals (status in the portal) "
            "and data gaps (partial or open, as the list already says). There is no progress percentage. "
            "/coordinacion still groups federal projects by institution. "
            "/aprendizaje#evidencia lists Aqueduct, MapBiomas, Resource Watch, DataMéxico and Data Commons as external sources. "
            "The one-page print list is on /aprendizaje. "
            "Follow-up: do you want the water view, the ports view, or a specific gap? "
            "[saved views metas questions gaps forum twin maps coordination evidence]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:foro-dossiers-p18",
        "title": "Fichas municipales, gemelo y hoja para invitados / Municipal pages, twin and guest sheet",
        "path": "portal/foro",
        "theme": "planeacion",
        "sum_es": (
            "Desde la ficha de un municipio (/studio/los_cabos, /studio/la_paz, /studio/loreto, /studio/comondu, /studio/mulege; "
            "/lugares lleva al mismo índice) hay enlaces al gemelo con ese municipio elegido (?muni=) y a la vista guardada que le corresponde. "
            "En el gemelo, al tocar un municipio se abre su ficha, la vocación en /crecimiento#id y la vista. "
            "Las recomendaciones de demanda y oferta enlazan a /crecimiento#los_cabos y anclas equivalentes. "
            "La hoja para invitados está en /foro: gemelo, vistas, aprendizaje para imprimir y coordinación. "
            "Cada página nueva explica en tres pasos cómo usarla. "
            "Pregunta de seguimiento: ¿quieres la ficha de un municipio o la vista de puertos? "
            "[foro gemelo studio lugares crecimiento vistas invitados]"
        ),
        "sum_en": (
            "From a municipality page (/studio/los_cabos, /studio/la_paz, /studio/loreto, /studio/comondu, /studio/mulege; "
            "/lugares opens the same index) there are links to the twin with that municipality selected (?muni=) and to the matching saved view. "
            "In the twin, tapping a municipality opens its page, the vocation at /crecimiento#id and the view. "
            "Demand-and-supply recommendations link to /crecimiento#los_cabos and the matching anchors. "
            "The guest sheet is at /foro: twin, views, learning ready to print, and coordination. "
            "Each new page explains in three steps how to use it. "
            "Follow-up: do you want a municipality page or the ports view? "
            "[guest sheet twin studio places growth views]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:ruta-decision-p19",
        "title": "Ruta de decisión del portal / Portal decision path",
        "path": "portal/foro",
        "theme": "planeacion",
        "sum_es": (
            "Ruta para invitados, en este orden: 1) Aprender de otras ciudades en /aprendizaje (la impresión deja solo fuentes externas; "
            "evidencia en /aprendizaje#evidencia: Aqueduct, MapBiomas, Resource Watch, DataMéxico, Data Commons). "
            "2) Ver una vista guardada en /vistas (agua primero, corredor Cabos–La Paz, puertos y aeropuertos, contexto de vivienda, East Cape). "
            "3) Comparar en el gemelo /gemelo. Loreto tiene 89,600 viajeros aéreos en 2025, del comunicado del gobierno del estado. "
            "Si una serie no está (Ley de Ingresos 2026 de Mulegé y Loreto) el tablero dice «sin serie municipal en el acervo» y enlaza a /metas. No se inventa el número. "
            "4) Coordinar proyectos en /coordinacion (institución, obra, sexenio; sin fecha de entrega calculada). "
            "La hoja corta con esos cuatro enlaces está en /foro. "
            "Pregunta de seguimiento: ¿empiezas por aprender de otras ciudades, por una vista, o por un municipio en el gemelo? "
            "[foro vistas metas coordinacion aprendizaje gemelo ruta decision sin serie]"
        ),
        "sum_en": (
            "Guest path, in this order: 1) Learn from other cities at /aprendizaje (printing leaves only external sources; "
            "evidence at /aprendizaje#evidencia: Aqueduct, MapBiomas, Resource Watch, DataMéxico, Data Commons). "
            "2) Open a saved view at /vistas (water first, Cabos–La Paz corridor, ports and airports, housing context, East Cape). "
            "3) Compare on the twin /gemelo. Loreto has 89,600 air travelers in 2025, from the state government release. "
            "If a series is missing (2026 revenue law for Mulegé and Loreto) the board says there is no municipal series in the archive and links to /metas. The number is not invented. "
            "4) Coordinate projects at /coordinacion (institution, work, administration; no calculated delivery date). "
            "The short sheet with those four links is at /foro. "
            "Follow-up: do you start by learning from other cities, by a saved view, or by a municipality on the twin? "
            "[guest sheet views open questions coordination learning twin decision path missing series]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:descubrimiento-p110",
        "title": "Mapa del sitio y fila de especialistas / Site map and specialist row",
        "path": "portal/rutas",
        "theme": "planeacion",
        "sum_es": (
            "El mapa del sitio está en /rutas y se resume en /ayuda. Incluye /gemelo, /vistas, /metas, /coordinacion, /aprendizaje y /foro. "
            "En Inicio (/inicio) las preguntas ciudadanas van primero. Debajo hay una fila corta: Gemelo, Vistas, Metas, Coordinación, Aprendizaje y Foro. "
            "En /mapas, el enlace «Vistas guardadas» abre /vistas. Cada vista sigue abriendo el mapa y el gemelo. "
            "En /aprendizaje#evidencia hay tres fichas externas más, comprobadas el 31 de octubre de 2026: "
            "Digital Twin Victoria (https://digitaltwin.vic.gov.au/public/), ClimateView (https://www.climateview.global/en) y Open SDG (https://open-sdg.org/). "
            "Sirven como referencia de catálogo espacial, de metas sin porcentaje y de huecos visibles. No se copian sus cifras. "
            "Pregunta de seguimiento: ¿quieres el mapa del sitio, una vista guardada o la evidencia externa? "
            "[rutas mapa del sitio especialistas vistas mapas evidencia]"
        ),
        "sum_en": (
            "The site map is at /rutas and is summarized on /ayuda. It includes /gemelo, /vistas, /metas, /coordinacion, /aprendizaje and /foro. "
            "On Home (/inicio) the citizen questions come first. Under them is a short row: Twin, Views, Questions, Coordination, Learning and Guests. "
            "On /mapas, Saved views opens /vistas. Each view still opens the map and the twin. "
            "On /aprendizaje#evidencia there are three more external cards, checked on 31 October 2026: "
            "Digital Twin Victoria (https://digitaltwin.vic.gov.au/public/), ClimateView (https://www.climateview.global/en) and Open SDG (https://open-sdg.org/). "
            "They are references for a spatial catalogue, for targets without a percentage, and for gaps left in view. Their figures are not copied. "
            "Follow-up: do you want the site map, a saved view, or the external evidence? "
            "[site map specialist row saved views maps evidence]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:eje-aereo-p116",
        "title": "Viajeros aéreos 2025 y eje del gemelo / 2025 air travelers and the twin axis",
        "path": "portal/gemelo",
        "href": "/gemelo/?theme=movilidad&x=pob&y=aereo_2025",
        "theme": "planeacion",
        "sum_es": (
            "Pasajeros aéreos de Loreto en 2025: 89,600 viajeros. Lo informó el Gobierno de Baja California Sur "
            "(https://www.bcs.gob.mx/supera-bcs-los-4-5-millones-de-pasajeros-aereos-en-2025-la-paz-crece-10-9/). "
            "En esa misma nota Los Cabos son 3,765,000 pasajeros y La Paz 668,800, y los tres suman 4,523,400. "
            "En el gemelo, la ficha de Los Cabos sigue en 3,800,000 porque así está redondeada la información estratégica de SETUE (3.8 millones). "
            "No se reemplaza una cifra por la otra. "
            "No confundir con 33,412: ese número es pasajeros de crucero del puerto de Loreto (DataTur 2025), no del aeropuerto. "
            "Para comparar aeropuertos o usar el eje aéreo abra /gemelo/?theme=movilidad&x=pob&y=aereo_2025. "
            "El gráfico dibuja Los Cabos, La Paz y Loreto. Comondú y Mulegé no tienen aeropuerto: no se ponen en cero. "
            "Pregunta de seguimiento: ¿quieres ese eje aéreo o la ley de ingresos 2026 que sigue en blanco para Mulegé y Loreto? "
            "[pasajeros loreto comparar aeropuertos eje aereo 89600]"
        ),
        "sum_en": (
            "Loreto 2025 air passengers: 89,600 travelers, stated by the Baja California Sur government "
            "(https://www.bcs.gob.mx/supera-bcs-los-4-5-millones-de-pasajeros-aereos-en-2025-la-paz-crece-10-9/). "
            "On that same note Los Cabos is 3,765,000 passengers and La Paz 668,800, and the three add up to 4,523,400. "
            "On the twin, the Los Cabos card stays at 3,800,000 because that is the rounded SETUE strategic brief (3.8 million). "
            "One figure is not replaced by the other. "
            "Do not confuse this with 33,412: that number is cruise passengers at the port of Loreto (DataTur 2025), not the airport. "
            "To compare airports or use the air axis open /gemelo/?theme=movilidad&x=pob&y=aereo_2025. "
            "The chart draws Los Cabos, La Paz and Loreto. Comondú and Mulegé have no airport: they are not set to zero. "
            "Follow-up: do you want that air axis, or the 2026 revenue law that is still blank for Mulegé and Loreto? "
            "[loreto passengers compare airports air axis 89600]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:evidencia-desal-p119",
        "title": "Desalación, agua no contabilizada y casos externos / Desalination, uncounted water and external cases",
        "path": "portal/aprendizaje",
        "href": "/aprendizaje/#evidencia",
        "theme": "planeacion",
        "sum_es": (
            "En /aprendizaje#evidencia hay fichas externas, comprobadas el 31 de octubre de 2026. Sus cifras no son de Baja California Sur. "
            "IFC, 2023: PDF sobre la asociación de agua en Los Cabos, que junta desalación y agua no contabilizada "
            "(https://www.ifc.org/content/dam/ifc/doc/2023/2023-Mexico-Los-Cabos-Water-PPP.pdf). "
            "McEvoy, 2014: artículo sobre desalación y seguridad hídrica en Cabo San Lucas "
            "(https://www.water-alternatives.org/index.php/alldoc/articles/vol7/v7issue2/262-a7-3-5/file). "
            "C40 Water Safe Cities mira sequía e inundación juntas "
            "(https://www.c40knowledgehub.org/s/article/Water-Safe-Cities). "
            "C40 tiene un tema de adaptación costera "
            "(https://www.c40knowledgehub.org/s/topic/0TO1Q0000002IZKWA2/coastal-adaptation-solutions?language=en_US). "
            "UrbanShift documenta el proyecto de Costa Rica "
            "(https://www.shiftcities.org/projects/costa-rica). "
            "Ninguna de esas páginas sustituye los acuíferos CONAGUA ni el gemelo. "
            "Pregunta de seguimiento: ¿quieres la ficha de desalación en Los Cabos, o la vista de agua primero en el sur? "
            "[desalacion los cabos agua no contabilizada c40 urbanshift evidencia]"
        ),
        "sum_en": (
            "On /aprendizaje#evidencia there are external cards, checked on 31 October 2026. Their figures are not for Baja California Sur. "
            "IFC, 2023: a PDF on the Los Cabos water partnership, pairing desalination and uncounted water "
            "(https://www.ifc.org/content/dam/ifc/doc/2023/2023-Mexico-Los-Cabos-Water-PPP.pdf). "
            "McEvoy, 2014: an article on desalination and water security in Cabo San Lucas "
            "(https://www.water-alternatives.org/index.php/alldoc/articles/vol7/v7issue2/262-a7-3-5/file). "
            "C40 Water Safe Cities looks at drought and flooding together "
            "(https://www.c40knowledgehub.org/s/article/Water-Safe-Cities). "
            "C40 has a coastal-adaptation topic "
            "(https://www.c40knowledgehub.org/s/topic/0TO1Q0000002IZKWA2/coastal-adaptation-solutions?language=en_US). "
            "UrbanShift documents the Costa Rica project "
            "(https://www.shiftcities.org/projects/costa-rica). "
            "None of those pages replaces the CONAGUA aquifers or the twin. "
            "Follow-up: do you want the Los Cabos desalination card, or the water-first view in the south? "
            "[desalination los cabos non-revenue water c40 urbanshift evidence]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:foro-cierre-p124",
        "title": "Qué me llevo del foro / What I take away from the forum",
        "path": "portal/foro",
        "href": "/foro/#cierre",
        "theme": "planeacion",
        "sum_es": (
            "Al terminar la reunión, /foro#cierre deja cuatro direcciones públicas. "
            "La consulta está en /inicio, con el camino «Antes de decidir». "
            "Los límites del gemelo están en /gemelo#limites. "
            "Las cinco vistas están en /vistas. "
            "La evidencia de otras ciudades está en /aprendizaje#evidencia y sus cifras no son de Baja California Sur. "
            "Esa hoja no trae la entrada del portal. "
            "Pregunta de seguimiento: ¿abre la consulta, los límites del gemelo, o las vistas? "
            "[que me llevo del foro enlaces despues de la reunion takeaway foro]"
        ),
        "sum_en": (
            "At the end of the meeting, /foro#cierre leaves four public addresses. "
            "The consultation is at /inicio, with the “Before you decide” path. "
            "The twin limits are at /gemelo#limites. "
            "The five views are at /vistas. "
            "Evidence from other cities is at /aprendizaje#evidencia and those figures are not for Baja California Sur. "
            "That sheet does not include the portal entrance. "
            "Follow-up: do you open the consultation, the twin limits, or the views? "
            "[what I take away links after the meeting forum takeaway]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:foro-ruta-p125",
        "title": "Ruta del foro en el mapa del sitio / Forum path on the site map",
        "path": "portal/rutas",
        "href": "/rutas/#ruta-foro",
        "theme": "planeacion",
        "sum_es": (
            "La ruta del foro está en /rutas#ruta-foro, para no memorizar las anclas. "
            "El recorrido de diez minutos está en /foro#recorrido. "
            "La lista de quien conduce está en /foro#kit. "
            "Lo que se lleva al salir está en /foro#cierre. "
            "Los límites de la Fase 1 están en /gemelo#limites. "
            "En /inicio, «Antes de decidir» sigue vistas, gemelo, preguntas abiertas y evidencia. "
            "Ninguna de esas líneas trae la entrada del portal. "
            "Pregunta de seguimiento: ¿abre el recorrido, la lista de quien conduce, o lo que se lleva al salir? "
            "[ruta del foro mapa del foro como seguir el foro]"
        ),
        "sum_en": (
            "The forum path is on /rutas#ruta-foro, so the anchors do not have to be memorized. "
            "The ten-minute walk is at /foro#recorrido. "
            "The host checklist is at /foro#kit. "
            "What you take away is at /foro#cierre. "
            "The Phase 1 limits are at /gemelo#limites. "
            "On /inicio, “Before you decide” follows views, twin, open questions and evidence. "
            "None of those lines includes the portal entrance. "
            "Follow-up: do you open the walk, the host list, or what you take away? "
            "[forum route forum map how to follow the forum]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:gemelo-3d-p20",
        "title": "Gemelo 3D, capas y escenarios / 3D twin, layers and scenarios",
        "path": "portal/gemelo",
        "href": "/gemelo/",
        "theme": "planeacion",
        "sum_es": (
            "El gemelo en /gemelo muestra el relieve del estado y las capas públicas, agrupadas en los cinco temas. "
            "Al cambiar de tema se encienden las capas de ese tema y se mantienen las del escenario. "
            "Cada capa dice su fuente y su año, o que el año no está registrado. "
            "Los escenarios son trayectoria actual, corredor Cabos–La Paz, agua primero, y puertos y aeropuertos. "
            "«Qué cambia» dice qué capas se encienden, qué municipios quedan en tensión y cómo se cruzan agua, vivienda y movilidad. "
            "Se puede comparar con otro escenario: el enlace guarda tema, escenario y comparación. "
            "Sigue sin poder mapas por manzana (AGEB), predios, catastro o métricas de forma. Si una celda está en blanco, se queda en blanco. "
            "Pregunta de seguimiento: ¿abre el relieve, las capas del tema, o qué cambia en un escenario? "
            "[gemelo 3d capas del gemelo escenarios]"
        ),
        "sum_en": (
            "The twin at /gemelo shows the state’s terrain and the public layers, grouped in the five themes. "
            "Changing theme turns on that theme’s layers and keeps the scenario layers. "
            "Each layer names its source and year, or says the year is not recorded. "
            "The scenarios are current trajectory, the Cabos–La Paz corridor, water first, and ports and airports. "
            "“What changes” says which layers turn on, which municipalities are under stress, and how water, housing and mobility meet. "
            "You can compare with another scenario: the link keeps theme, scenario and comparison. "
            "It still cannot do block maps (AGEB), parcels, cadastre or form metrics. If a cell is blank, it stays blank. "
            "Follow-up: do you open the terrain, the theme layers, or what changes in a scenario? "
            "[3d twin twin layers gemelo scenarios]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:gemelo-extrusion-p21",
        "title": "Altura municipal y palancas del escenario / Municipal height and scenario levers",
        "path": "portal/gemelo",
        "href": "/gemelo/?z=pob",
        "theme": "planeacion",
        "sum_es": (
            "En /gemelo la altura de cada municipio sigue una cifra que ya está en el tablero: población, registro de vivienda, viajeros aéreos, pasajeros de crucero o pobreza, entre otras. "
            "La altura es relativa a la cifra más alta. No son metros de terreno ni edificios. "
            "Si un municipio no tiene esa cifra, no se levanta: Comondú y Mulegé se quedan fuera de los viajeros aéreos 2025, y Mulegé y Loreto fuera de la ley de ingresos 2026. Un cero publicado sí se dibuja. "
            "Cada escenario tiene palancas que adelantan una lectura ya escrita, por ejemplo el margen de agua o la demanda aérea. "
            "La palanca entra en «Qué cambia» y en el enlace. "
            "Pregunta de seguimiento: ¿quiere la altura por población, o la palanca de agua? "
            "[extrusion municipal palancas del escenario]"
        ),
        "sum_en": (
            "On /gemelo the height of each municipality follows a figure already on the board: population, the housing registry, air travelers, cruise passengers or poverty, among others. "
            "Height is relative to the highest figure. These are not meters of terrain or buildings. "
            "If a municipality has no such figure, it does not rise: Comondú and Mulegé stay off 2025 air travelers, and Mulegé and Loreto stay off the 2026 revenue law. A published zero is drawn. "
            "Each scenario has levers that bring forward a reading already written, for example water headroom or air demand. "
            "The lever is part of “What changes” and of the link. "
            "Follow-up: do you want the height by population, or the water lever? "
            "[municipal extrusion scenario levers]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:gemelo-camino-p22",
        "title": "Camino de decisión del gemelo / Twin decision path",
        "path": "portal/gemelo",
        "href": "/gemelo/?path=diagnostico",
        "theme": "planeacion",
        "sum_es": (
            "El gemelo en /gemelo se recorre en cuatro pasos: diagnóstico, meta, escenario y recomendación. "
            "El diagnóstico muestra el tema, la altura municipal y las capas de ese tema. "
            "La meta muestra las preguntas ya escritas para el municipio y el tema, y enlaza con /metas. "
            "El escenario muestra el botón, la palanca, qué cambia y la comparación. "
            "La recomendación muestra la regla del portal para ese municipio y ese escenario. "
            "Imprimir deja una hoja con el tema, el escenario, la palanca, los municipios en tensión y la recomendación. No añade cifras. "
            "El enlace guarda el paso en path. "
            "Pregunta de seguimiento: ¿abre el diagnóstico, la meta, o la recomendación? "
            "[camino de decision diagnostico gemelo recomendacion gemelo]"
        ),
        "sum_en": (
            "The twin at /gemelo is walked in four steps: diagnosis, goal, scenario and recommendation. "
            "Diagnosis shows the theme, the municipal height and that theme’s layers. "
            "The goal shows the questions already written for the municipality and the theme, and links to /metas. "
            "The scenario shows the button, the lever, what changes and the comparison. "
            "The recommendation shows the portal rule for that municipality and that scenario. "
            "Print leaves a sheet with the theme, the scenario, the lever, the municipalities under stress and the recommendation. It adds no figures. "
            "The link keeps the step in path. "
            "Follow-up: do you open the diagnosis, the goal, or the recommendation? "
            "[decision path twin diagnosis twin recommendation]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:gemelo-cruce-p23",
        "title": "Impacto entre temas del gemelo / Cross-theme impact on the twin",
        "path": "portal/gemelo",
        "href": "/gemelo/?path=escenario",
        "theme": "planeacion",
        "sum_es": (
            "En /gemelo el impacto entre temas es una lectura cualitativa de las reglas ya escritas. No es un motor de simulación y no crea cifras. "
            "El tema activo dice cómo presiona a los otros cuatro. El escenario y la palanca, si hay una, ponen delante una frase que ya estaba en el portal. "
            "Si una celda está en blanco, se queda en blanco. "
            "Los nodos del escenario salen de la ontología. No traen coordenada propia: el enlace abre el nombre en /ontologia. "
            "Si el nodo es un municipio del tablero, se puede ver ese municipio en el mapa que ya existe. "
            "Pregunta de seguimiento: ¿abre el cruce de temas o los nodos del escenario? "
            "[impacto entre temas efectos cruzados ontologia del escenario]"
        ),
        "sum_en": (
            "On /gemelo the cross-theme impact is a qualitative reading of rules already written. It is not a simulation engine and it creates no figures. "
            "The active theme says how it presses the other four. The scenario and the lever, if one is set, put in front a sentence that was already in the portal. "
            "If a cell is blank, it stays blank. "
            "The scenario nodes come from the ontology. They have no coordinate of their own: the link opens the name at /ontologia. "
            "If the node is a municipality on the board, that municipality can be seen on the map that already exists. "
            "Follow-up: do you open the cross-theme reading or the scenario nodes? "
            "[cross-theme impact cross effects scenario ontology]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:gemelo-ficha-p24",
        "title": "Ficha municipal del gemelo / Municipal fiche on the twin",
        "path": "portal/gemelo",
        "href": "/gemelo/?muni=Los%20Cabos",
        "theme": "planeacion",
        "sum_es": (
            "Al tocar un municipio en /gemelo se abre su ficha, sin salir de la página. "
            "Trae el nombre, la cifra elegida para la altura con su unidad, fuente y año, o un — si esa cifra no existe. "
            "La demanda, la oferta y el balance son los textos ya escritos para ese lugar. "
            "La recomendación es la regla del escenario y de la palanca, si aplica a ese municipio. "
            "La ficha enlaza la vista guardada y el aprendizaje del tema. "
            "El enlace guarda muni junto con tema, escenario, camino, palanca, altura y comparación. "
            "Pregunta de seguimiento: ¿abre la ficha de Los Cabos o la de Loreto? "
            "[ficha municipal demanda y oferta gemelo]"
        ),
        "sum_en": (
            "Tapping a municipality on /gemelo opens its fiche, without leaving the page. "
            "It shows the name, the figure chosen for the height with its unit, source and year, or an em dash if that figure does not exist. "
            "Demand, supply and balance are the texts already written for that place. "
            "The recommendation is the scenario and lever rule, when it applies to that municipality. "
            "The fiche links the saved view and the theme’s learning page. "
            "The link keeps muni together with theme, scenario, path, lever, height and comparison. "
            "Follow-up: do you open the Los Cabos fiche or the Loreto one? "
            "[municipal fiche twin demand and supply]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:gemelo-lado-p25",
        "title": "Comparar escenarios lado a lado / Compare scenarios side by side",
        "path": "portal/gemelo",
        "href": "/gemelo/?scenario=baseline&compare=water_first",
        "theme": "planeacion",
        "sum_es": (
            "En /gemelo, Comparar con deja ver dos escenarios a la vez. "
            "En pantalla ancha hay dos mapas con el mismo encuadre: A es el escenario elegido y B es la comparación. "
            "En pantalla estrecha, Ver A, Ambos y Ver B cambian las capas sin mover la cámara. "
            "Qué cambia dice en una frase la diferencia y lista solo en A, solo en B y en ambos. "
            "Esas capas ya están en los escenarios. No se inventan. "
            "El enlace guarda compare. "
            "Pregunta de seguimiento: ¿compara agua primero con la trayectoria actual, o el corredor con los puertos? "
            "[comparar escenarios lado a lado escenario a y b]"
        ),
        "sum_en": (
            "On /gemelo, Compare with shows two scenarios at once. "
            "On a wide screen there are two maps with the same frame: A is the chosen scenario and B is the comparison. "
            "On a narrow screen, View A, Both and View B change the layers without moving the camera. "
            "What changes says the difference in one sentence and lists only in A, only in B and in both. "
            "Those layers are already in the scenarios. None are invented. "
            "The link keeps compare. "
            "Follow-up: do you compare water first with the current trajectory, or the corridor with the ports? "
            "[compare scenarios side by side scenario A and B]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:gemelo-presets-p26",
        "title": "Aperturas para la reunión / Meeting openings for the twin",
        "path": "portal/gemelo",
        "href": "/gemelo/#presets",
        "theme": "planeacion",
        "sum_es": (
            "En /gemelo#presets hay cuatro aperturas listas para la reunión. Son puntos de partida, no pronósticos, y no añaden cifras. "
            "Agua primero abre el diagnóstico de vivienda, con la altura del registro SNIIV y la palanca del acuífero en déficit. "
            "Corredor y trayectoria compara el corredor con la trayectoria actual. "
            "Puertos y aire abre la recomendación de movilidad, con la palanca de demanda aérea. "
            "Ficha Los Cabos abre el diagnóstico con ese municipio. "
            "La misma lista está en /foro#kit. Esa hoja no trae la entrada del portal. "
            "Pregunta de seguimiento: ¿abre agua primero, el corredor comparado, o la ficha de Los Cabos? "
            "[presets del gemelo reunion gemelo para la reunion]"
        ),
        "sum_en": (
            "At /gemelo#presets there are four ready openings for the meeting. They are starting points, not forecasts, and they add no figures. "
            "Water first opens the housing diagnosis, with the SNIIV registry height and the aquifer-deficit lever. "
            "Corridor and trajectory compares the corridor with the current trajectory. "
            "Ports and air opens the mobility recommendation, with the air-demand lever. "
            "The Los Cabos fiche opens the diagnosis with that municipality. "
            "The same list is on /foro#kit. That sheet does not include the portal entrance. "
            "Follow-up: do you open water first, the compared corridor, or the Los Cabos fiche? "
            "[meeting presets twin meeting for the meeting]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:gemelo-stills-p27",
        "title": "Fotos en la ficha y leyenda de la altura / Photos on the fiche and the height legend",
        "path": "portal/gemelo",
        "href": "/gemelo/#cdt-fiche-wrap",
        "theme": "planeacion",
        "sum_es": (
            "En /gemelo la ficha del municipio puede mostrar hasta tres fotogramas que ya están en la vista de ese lugar. "
            "El nombre de la foto es el del lugar. Un toque abre esa vista. Si no hay foto para el municipio, la franja no aparece. "
            "Junto al control de altura, la leyenda dice la cifra, la unidad, la fuente y el año. "
            "Sin cifra, el municipio queda plano. No es cero. "
            "Pregunta de seguimiento: ¿abre la ficha de Los Cabos, o la leyenda de la altura? "
            "[fotos del municipio still gemelo leyenda extrusion]"
        ),
        "sum_en": (
            "On /gemelo the municipality fiche can show up to three frames already in that place’s view. "
            "The photo name is the place name. A tap opens that view. If the municipality has no photo, the strip does not appear. "
            "Next to the height control, the legend names the figure, the unit, the source and the year. "
            "With no figure, the municipality stays flat. It is not zero. "
            "Follow-up: do you open the Los Cabos fiche, or the height legend? "
            "[municipality photos twin still extrusion legend]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:gemelo-atlas-p28",
        "title": "Del gemelo al atlas / From the twin to the atlas",
        "path": "portal/gemelo",
        "href": "/explorar/?tema=urbano&capas=cities,zoning",
        "theme": "planeacion",
        "sum_es": (
            "El atlas en /explorar es el inventario para explorar el territorio. "
            "El gemelo en /gemelo es el lugar de los escenarios y la decisión. "
            "Abrir en el atlas lleva las capas del tema que el atlas ya conoce, y el municipio si está elegido. "
            "Una capa del gemelo sin equivalente en el atlas no se inventa. "
            "Desde el atlas, Gemelo territorial abre el diagnóstico. "
            "Pregunta de seguimiento: ¿abre el atlas con vivienda, o vuelve al diagnóstico del gemelo? "
            "[abrir en el atlas del gemelo al atlas]"
        ),
        "sum_en": (
            "The atlas at /explorar is the inventory for exploring the territory. "
            "The twin at /gemelo is where scenarios and the decision live. "
            "Open in atlas carries the theme layers the atlas already knows, and the municipality when one is chosen. "
            "A twin layer with no atlas counterpart is left out. "
            "From the atlas, Decision twin opens the diagnosis. "
            "Follow-up: do you open the atlas with housing, or return to the twin diagnosis? "
            "[open in the atlas from the twin to the atlas]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:gemelo-novedades-p29",
        "title": "Novedades del gemelo / What is new on the twin",
        "path": "portal/gemelo",
        "href": "/gemelo/#presets",
        "theme": "planeacion",
        "sum_es": (
            "En /inicio, debajo de Antes de decidir, hay una línea con lo nuevo del gemelo 3D: capas, escenarios lado a lado, ficha municipal y aperturas para la reunión. "
            "Para la reunión abre /gemelo#presets. El diagnóstico abre /gemelo con el camino en diagnóstico. "
            "La segunda vista del mapa aparece solo al comparar, y en pantalla ancha. "
            "Una capa que no está en el tema ni en el escenario no se descarga hasta que se enciende. "
            "Pregunta de seguimiento: ¿abre las aperturas de la reunión, o el diagnóstico? "
            "[novedades gemelo gemelo mas rapido]"
        ),
        "sum_en": (
            "On /inicio, under Before you decide, one line lists what is new on the 3D twin: layers, scenarios side by side, a municipal fiche and meeting openings. "
            "For the meeting opens /gemelo#presets. Diagnosis opens /gemelo with the path on diagnosis. "
            "The second map view appears only while comparing, and only on a wide screen. "
            "A layer that is not in the theme or the scenario is not downloaded until it is turned on. "
            "Follow-up: do you open the meeting openings, or the diagnosis? "
            "[twin news faster twin]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:gemelo-limites-p123",
        "title": "Qué puede y qué no puede el gemelo en la Fase 1 / What the twin can and cannot do in Phase 1",
        "path": "portal/gemelo",
        "href": "/gemelo/#limites",
        "theme": "planeacion",
        "sum_es": (
            "En la Fase 1 el gemelo puede comparar los cinco municipios, con cinco temas y escenarios. "
            "Si una celda está en blanco, se queda en blanco. "
            "Todavía no puede mostrar mapas por manzana (AGEB), forma de predios, lotes de catastro, ni inventar una cifra que falta. "
            "Eso está escrito en /gemelo#limites. Las brechas abiertas están en /metas. "
            "Los casos de otras ciudades están en /aprendizaje#evidencia y sus cifras no son de Baja California Sur. "
            "Pregunta de seguimiento: ¿quiere ver las preguntas abiertas o un caso de otra ciudad? "
            "[que no puede el gemelo limites del gemelo limites fase 1 ageb]"
        ),
        "sum_en": (
            "In Phase 1 the twin can compare the five municipalities, with five themes and scenarios. "
            "If a cell is blank, it stays blank. "
            "It cannot yet show block maps (AGEB), parcel form, cadastre lots, or invent a missing figure. "
            "That is written at /gemelo#limites. Open gaps are at /metas. "
            "Cases from other cities are at /aprendizaje#evidencia and their figures are not for Baja California Sur. "
            "Follow-up: do you want the open questions or a case from another city? "
            "[what the twin cannot do twin limits phase 1 limits ageb]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:gemelo-leer-p121",
        "title": "Cómo leer el tablero del gemelo / How to read the twin board",
        "path": "portal/gemelo",
        "href": "/gemelo/",
        "theme": "planeacion",
        "sum_es": (
            "Para usar el gemelo: elija un tema, luego un escenario, y compare los municipios. "
            "Si una celda está en blanco, se queda en blanco. No se rellena en la reunión. "
            "Las vistas con nombre están en /vistas. Los casos de otras ciudades están en /aprendizaje#evidencia y sus cifras no son de Baja California Sur. "
            "Pregunta de seguimiento: ¿abre el gemelo o una vista guardada? "
            "[como usar el gemelo como leer el tablero]"
        ),
        "sum_en": (
            "To use the twin: pick a theme, then a scenario, and compare the municipalities. "
            "If a cell is blank, it stays blank. It is not filled in during the meeting. "
            "The named views are at /vistas. Cases from other cities are at /aprendizaje#evidencia and their figures are not for Baja California Sur. "
            "Follow-up: do you open the twin or a saved view? "
            "[how to use the twin how to read the board]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:foro-kit-p122",
        "title": "Kit de la reunión en la hoja de invitados / Meeting kit on the guest sheet",
        "path": "portal/foro",
        "href": "/foro/#kit",
        "theme": "planeacion",
        "sum_es": (
            "El kit de la reunión está en /foro#kit, después del recorrido de diez minutos. "
            "Trae las cinco vistas por nombre, con su tarjeta en /vistas y el mismo centro de Google Maps, "
            "más el gemelo de agua y vivienda, la evidencia de otras ciudades en /aprendizaje#evidencia y la coordinación. "
            "Sirve para imprimir la lista. La entrada del portal no va en esa hoja. "
            "Pregunta de seguimiento: ¿imprime el kit o abre una de las cinco vistas? "
            "[kit reunion imprimir foro lista para la reunion]"
        ),
        "sum_en": (
            "The meeting kit is at /foro#kit, after the ten-minute walk. "
            "It lists the five views by name, with the card on /vistas and the same Google Maps center, "
            "plus the water-and-housing twin, evidence from other cities at /aprendizaje#evidencia, and coordination. "
            "It is there to print the list. The portal entrance is not on that sheet. "
            "Follow-up: do you print the kit or open one of the five views? "
            "[meeting kit print forum meeting list]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:consulta-ruta-p120",
        "title": "Evidencia, vistas y recorrido del foro / Evidence, views and the forum walk",
        "path": "portal/inicio",
        "href": "/aprendizaje/#evidencia",
        "theme": "planeacion",
        "sum_es": (
            "Desde Inicio hay tres atajos, debajo de las preguntas. "
            "Evidencia: /aprendizaje#evidencia reúne casos de otras ciudades sobre agua y costa. Esas cifras no son de Baja California Sur. "
            "Vistas: /vistas abre cinco mapas con nombre (agua, corredor, puertos, vivienda y East Cape). "
            "Recorrido: /foro#recorrido es el orden de diez minutos. La hoja para invitados es /foro. "
            "Pregunta de seguimiento: ¿abres la evidencia de otras ciudades, una vista, o el recorrido del foro? "
            "[evidencia casos de otras ciudades recorrido foro hoja invitados]"
        ),
        "sum_en": (
            "Home has three shortcuts under the questions. "
            "Evidence: /aprendizaje#evidencia gathers cases from other cities on water and the coast. Those figures are not for Baja California Sur. "
            "Views: /vistas opens five named maps (water, corridor, ports, housing and East Cape). "
            "Walk: /foro#recorrido is the ten-minute order. The guest sheet is /foro. "
            "Follow-up: do you open the evidence from other cities, a view, or the forum walk? "
            "[evidence cases from other cities forum walk guest sheet]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:vistas-nombres-p118",
        "title": "Las cinco vistas por nombre / The five views by name",
        "path": "portal/vistas",
        "href": "/vistas/",
        "theme": "planeacion",
        "sum_es": (
            "Hay cinco vistas con nombre en /vistas. Cada tarjeta dice qué capas enciende el mapa y, si hay escenario, qué encuadre usa. "
            "1) Agua primero en el sur: escenario «Agua primero» (acuíferos en déficit, corredor, East Cape, cauces y costa) y encuadre del sur. "
            "El gemelo abre /gemelo/?theme=vivienda&scenario=water_first&x=pob&y=pobreza_pct, el mismo enlace de /foro. "
            "2) Crecimiento Cabos–La Paz: escenario del corredor. Mapa /mapas?scenario=corridor_intensify#gis. "
            "3) Puertos y aeropuertos: escenario de puertos y aeropuertos. Mapa /mapas?scenario=ports_air_hubs#gis. "
            "4) Contexto de vivienda: sin escenario. Enciende asentamientos, ordenamiento y acuíferos en déficit, con encuadre de todo el estado. "
            "Mapa /mapas?layers=settlements,poer_ugas,focus_water_dmas#gis. El rezago CONAVI no se reparte por municipio. "
            "5) East Cape y áreas protegidas: encuadre del sur de «Trayectoria actual». Esas capas se sustituyen por East Cape y áreas protegidas federales. "
            "Mapa /mapas?scenario=baseline&layers=focus_east_cape,anp_federales#gis. "
            "El recorrido de 10 minutos está en /foro#recorrido: esta hoja, las vistas, el gemelo de agua y vivienda, aprendizaje para imprimir y coordinación. "
            "Pregunta de seguimiento: ¿abres Agua primero en el sur, o el recorrido de 10 minutos? "
            "[cinco vistas agua primero corredor puertos vivienda east cape recorrido]"
        ),
        "sum_en": (
            "There are five named views at /vistas. Each card says which layers the map turns on and, when there is a scenario, which frame it uses. "
            "1) Water first in the south: the “Water security first” scenario (deficit aquifers, corridor, East Cape, waterways and coastline) and the south frame. "
            "The twin opens /gemelo/?theme=vivienda&scenario=water_first&x=pob&y=pobreza_pct, the same link as /foro. "
            "2) Cabos–La Paz growth: the corridor scenario. Map /mapas?scenario=corridor_intensify#gis. "
            "3) Ports and airports: the ports-and-airports scenario. Map /mapas?scenario=ports_air_hubs#gis. "
            "4) Housing context: no scenario. It turns on settlements, zoning and deficit aquifers, with a statewide frame. "
            "Map /mapas?layers=settlements,poer_ugas,focus_water_dmas#gis. The CONAVI backlog is not split by municipality. "
            "5) East Cape and protected areas: the south frame of “Current trajectory”. Those scenario layers are replaced by East Cape and federal protected areas. "
            "Map /mapas?scenario=baseline&layers=focus_east_cape,anp_federales#gis. "
            "The ten-minute walk is at /foro#recorrido: this sheet, the views, the water-and-housing twin, learning ready to print, and coordination. "
            "Follow-up: do you open Water first in the south, or the ten-minute walk? "
            "[five views water first corridor ports housing east cape ten-minute walk]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    chunks.append({
        "id": "portal:sustancia-p111",
        "title": "Cifras en blanco y hoja para imprimir / Blank figures and the print sheet",
        "path": "portal/foro",
        "theme": "planeacion",
        "sum_es": (
            "Pasajeros aéreos 2025: Los Cabos 3,800,000 y La Paz 668,800 salen de la información estratégica de SETUE. "
            "Loreto: el gobierno del estado informó 89,600 viajeros en 2025 "
            "(https://www.bcs.gob.mx/supera-bcs-los-4-5-millones-de-pasajeros-aereos-en-2025-la-paz-crece-10-9/). "
            "En esa misma nota, Los Cabos 3,765,000 + La Paz 668,800 + Loreto 89,600 = 4,523,400. "
            "No se usa otra cifra de la AFAC porque esa hoja no se abrió. "
            "La Ley de Ingresos 2026 de Mulegé y de Loreto sigue en blanco en la comparación: "
            "el boletín del Congreso dice el monto de Mulegé, pero no es el PDF del boletín oficial, y Loreto no trae un total en una gaceta abierta. "
            "Los Cabos, La Paz y Comondú sí tienen monto. "
            "Para imprimir la hoja de invitados use /foro; al imprimir /aprendizaje queda la lista de fuentes externas con su dirección. "
            "Pregunta de seguimiento: ¿quieres la cifra de Loreto o la ley de ingresos que sigue en blanco? "
            "[foro imprimir loreto pasajeros ley ingresos en blanco]"
        ),
        "sum_en": (
            "2025 air passengers: Los Cabos 3,800,000 and La Paz 668,800 come from the SETUE strategic brief. "
            "Loreto: the state government reported 89,600 travelers in 2025 "
            "(https://www.bcs.gob.mx/supera-bcs-los-4-5-millones-de-pasajeros-aereos-en-2025-la-paz-crece-10-9/). "
            "On that same note, Los Cabos 3,765,000 + La Paz 668,800 + Loreto 89,600 = 4,523,400. "
            "No AFAC figure is used because that spreadsheet was not opened. "
            "The 2026 revenue laws for Mulegé and Loreto stay blank in the comparison: "
            "the Congress bulletin states Mulegé’s amount, but it is not the official-gazette PDF, and Loreto has no total in an open gazette. "
            "Los Cabos, La Paz and Comondú do have an amount. "
            "To print the guest sheet use /foro; printing /aprendizaje leaves the external-source list with each address. "
            "Follow-up: do you want the Loreto figure, or the revenue law that stays blank? "
            "[guest sheet print loreto passengers revenue law blank]"
        ),
        "drive_url": None,
        "type": "guide",
    })

    # 14_gobierno — Organigrama General H. XV Ayuntamiento de Los Cabos (2024–2027)
    try:
        n_gov = add_los_cabos_organigrama(chunks)
        print(f"los_cabos_organigrama_chunks={n_gov}")
    except Exception as e:
        print(f"los_cabos_organigrama_skip={type(e).__name__}:{e}")

    # Internal stakeholder working tables — Ivan Tamayo notes (30 Sep 2026)
    try:
        n_mesas = add_mesas_trabajo(chunks)
        print(f"mesas_trabajo_chunks={n_mesas}")
    except Exception as e:
        print(f"mesas_trabajo_skip={type(e).__name__}:{e}")

    try:
        n_esc = add_escorrentia(chunks)
        print(f"escorrentia_chunks={n_esc}")
        print(f"study_chunks={add_studies(chunks)}")
        print(f"aquifer_chunks={add_aquifers(chunks)}")
        print(f"stakeholder_chunks={add_stakeholders(chunks)}")
    except Exception as e:
        print(f"aquifer/stakeholder_skip={type(e).__name__}:{e}")

    # Daily BCS news feed (press, not official) — rebuilt on every build / news update
    n_news, n_news_items = add_news(chunks)
    print(f"news_chunks={n_news} (items in feed+archive={n_news_items})")
    if n_news_items and not n_news:
        raise SystemExit("ERROR: news.json has items but no news chunks were added to the chat corpus")

    # BCS2050 Library (13_library) — page-cited extracts built by scripts/build_library.py
    lib_path = ROOT / "src" / "data" / "library_chunks.json"
    if lib_path.is_file():
        try:
            lib_chunks = json.loads(lib_path.read_text(encoding="utf-8"))
            have = {c["id"] for c in chunks}
            n_lib = 0
            for c in lib_chunks:
                if c.get("id") in have:
                    continue
                chunks.append(c)
                n_lib += 1
            print(f"library_chunks_added={n_lib}")
        except Exception as e:
            print(f"library_chunks_skip={type(e).__name__}:{e}")

    # Human titles for chat source cards (2026-10-08): never a raw file name on a card.
    # `title` stays as indexed (retrieval unchanged); cards and evidence headers use `display_title`.
    add_display_titles(chunks)

    def dumps(c):
        return json.dumps(c, ensure_ascii=False, separators=(",", ":"))

    raw = dumps(chunks)
    while len(raw.encode("utf-8")) > MAX_BYTES:
        for i in range(len(chunks) - 1, -1, -1):
            if chunks[i]["type"] == "file":
                chunks.pop(i)
                break
        else:
            break
        raw = dumps(chunks)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    FN.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(raw, encoding="utf-8")
    FN.write_text(raw, encoding="utf-8")
    by = {}
    for c in chunks:
        by[c["type"]] = by.get(c["type"], 0) + 1
    demo_n = sum(1 for c in chunks if "demograf" in (c.get("theme") or "") or "05_demographics" in (c.get("path") or ""))
    print(f"chunks={len(chunks)} bytes={len(raw.encode())} by_type={by} demografiaish={demo_n}")


if __name__ == "__main__":
    main()
