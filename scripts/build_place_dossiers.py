#!/usr/bin/env python3
"""Build src/data/place_dossiers.json (+ public mirror) from foresights, growth,
catalog_slim, flights. FACT vs ASSUMPTION tagged. No invented statistics.
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FS = ROOT / "src" / "data" / "foresights.json"
GDS = ROOT / "src" / "data" / "growth_demand_supply.json"
CAT = ROOT / "src" / "data" / "catalog_slim.json"
FLIGHTS = ROOT / "src" / "data" / "flight_connections_bcs.json"
OUT = ROOT / "src" / "data" / "place_dossiers.json"
PUB = ROOT / "public" / "place_dossiers.json"
SVG_DIR = ROOT / "public" / "lugares"

PLACE_ORDER = [
    "los_cabos",
    "east_cape",
    "todos_santos",
    "la_paz",
    "loreto",
    "comondu",
    "mulege_north",
]

AIRPORT_PLACE = {"SJD": "los_cabos", "LAP": "la_paz", "LTO": "loreto"}

# Structure readings (ASSUMPTION unless sourced)
STRUCTURE = {
    "los_cabos": {
        "role": "gateway",
        "role_es": "Puerta / corredor",
        "role_en": "Gateway / corridor",
        "reading_es": "Motor turístico–aéreo: Cabo San Lucas–San José del Cabo como corredor, no enclave aislado; SJD amplifica demanda. Cabos ≠ BCS.",
        "reading_en": "Tourism–air engine: Cabo San Lucas–San José del Cabo as corridor, not isolated enclave; SJD amplifies demand. Cabos ≠ BCS.",
        "tag": "FACT",
        "tag_note_es": "Vocación y conteos de vuelos SJD desde foresights/growth/flights.",
        "tag_note_en": "Vocation and SJD flight counts from foresights/growth/flights.",
    },
    "east_cape": {
        "role": "edge",
        "role_es": "Borde / edge",
        "role_en": "Edge condition",
        "reading_es": "Techo de conservación (Cabo Pulmo / ANP) frente a desborde desde Cabos — edge condition, no turismo residual.",
        "reading_en": "Conservation ceiling (Cabo Pulmo / ANP) vs. spillover from Cabos — edge condition, not residual tourism.",
        "tag": "ASSUMPTION",
        "tag_note_es": "Lectura design reading / semillas de consenso; no hay métrica de desborde inventada.",
        "tag_note_en": "design reading / consensus-seed reading; no invented spillover metric.",
    },
    "todos_santos": {
        "role": "spine",
        "role_es": "Espina Pacífico",
        "role_en": "Pacific spine",
        "reading_es": "Amenidad Todos Santos–Pescadero: densificación vs. diversificación; morfología de pueblo a proteger hasta evidencia catastral.",
        "reading_en": "Amenity Todos Santos–Pescadero: densification vs. diversification; pueblo morphology to protect until cadastral evidence.",
        "tag": "ASSUMPTION",
        "tag_note_es": "design reading marca morfología como ASSUMPTION hasta evidencia catastral.",
        "tag_note_en": "design reading marks morphology as ASSUMPTION until cadastral evidence.",
    },
    "la_paz": {
        "role": "gateway",
        "role_es": "Capital de gobernanza",
        "role_en": "Governance capital",
        "reading_es": "Capital de servicios/coordinación + acoplamiento agua–energía. Rol urbano = gobernanza, no segundo Cabos.",
        "reading_en": "Services/coordination capital + water–energy coupling. Urban role = governance, not a second Cabos.",
        "tag": "FACT",
        "tag_note_es": "Alineado a tesis de edición y scorecard La Paz.",
        "tag_note_en": "Aligned to edition thesis and La Paz scorecard.",
    },
    "loreto": {
        "role": "edge",
        "role_es": "Nodo mid-península",
        "role_en": "Mid-peninsula node",
        "reading_es": "Crecimiento contestado vs. ANP/POEL; PTAR/acueducto como habilitador o demora del asentamiento.",
        "reading_en": "Contested growth vs. ANP/POEL; WWTP/aqueduct as enabler or delay of settlement.",
        "tag": "ASSUMPTION",
        "tag_note_es": "Lectura design reading; cifras PTAR no inventadas.",
        "tag_note_en": "design reading reading; WWTP figures not invented.",
    },
    "comondu": {
        "role": "working_landscape",
        "role_es": "Paisaje productivo inland",
        "role_en": "Inland working landscape",
        "reading_es": "Headroom agro/producción relativo — no usar el interior vacío como compensación del déficit sur (falacia ya marcada en GDS).",
        "reading_en": "Relative agri/production headroom — do not treat empty interior as offset for southern deficit (fallacy already in GDS).",
        "tag": "FACT",
        "tag_note_es": "Balance headroom en growth_demand_supply; falacia de compensación es lectura de método GDS / design method.",
        "tag_note_en": "Headroom balance in growth_demand_supply; offset fallacy is GDS / design method method reading.",
    },
    "mulege_north": {
        "role": "working_landscape",
        "role_es": "Desierto de evidencia",
        "role_en": "Evidence desert",
        "reading_es": "Balance unknown + señales Oasis H2. Marcar evidence desert: no inventar offset norte para el estado.",
        "reading_en": "Unknown balance + Oasis H2 signals. Mark evidence desert: do not invent a northern statewide offset.",
        "tag": "FACT",
        "tag_note_es": "balance_read=unknown en GDS; H2 aparece en noticias etiquetadas.",
        "tag_note_en": "balance_read=unknown in GDS; H2 appears in tagged news.",
    },
}

# Known instrument holes (honest gaps)
KNOWN_GAPS = {
    "la_paz": [
        {
            "instrument": "PMDU",
            "status": "gap",
            "label_es": "PMDU La Paz — texto completo",
            "label_en": "La Paz PMDU — full text",
            "note_es": "Hueco conocido: falta texto completo PMDU en el acervo.",
            "note_en": "Known hole: full PMDU text missing from the acervo.",
            "tag": "FACT",
        }
    ],
    "loreto": [
        {
            "instrument": "PMD",
            "status": "gap",
            "label_es": "PMD Loreto",
            "label_en": "Loreto PMD",
            "note_es": "Hueco conocido: PMD / cobertura incompleta.",
            "note_en": "Known hole: PMD / incomplete coverage.",
            "tag": "FACT",
        },
        {
            "instrument": "PSDU",
            "status": "gap",
            "label_es": "PSDU Loreto",
            "label_en": "Loreto PSDU",
            "note_es": "Hueco conocido: PSDU no consolidado en catálogo.",
            "note_en": "Known hole: PSDU not consolidated in catalog.",
            "tag": "FACT",
        },
    ],
}

PLACE_CATALOG_KW = {
    "los_cabos": [r"los[-_\s]?cabos", r"cabo[-_\s]?san[-_\s]?lucas", r"san[-_\s]?jos[eé][-_\s]?del[-_\s]?cabo", r"\bsjd\b"],
    "east_cape": [r"east[-_\s]?cape", r"cabo[-_\s]?del[-_\s]?este", r"cabo[-_\s]?pulmo", r"barriles", r"ribera", r"san[-_\s]?jos[eé][-_\s]?del[-_\s]?este", r"cardonal"],
    "todos_santos": [r"todos[-_\s]?santos", r"pescadero"],
    "la_paz": [r"la[-_\s]?paz", r"\blap\b"],
    "loreto": [r"loreto", r"\blto\b"],
    "comondu": [r"comond[uú]", r"constituci[oó]n"],
    "mulege_north": [r"muleg[eé]", r"rosal[ií]a", r"vizca[ií]no"],
}

INSTR_PATTERNS = [
    ("PDU", re.compile(r"(?<![a-z])pdu(?![a-z])|pdu[-_\s]?20", re.I)),
    ("POEL", re.compile(r"poel", re.I)),
    ("PMD", re.compile(r"(?<![a-z])pmd(?![a-z])|pmdu", re.I)),
    ("PMDU", re.compile(r"pmdu", re.I)),
    ("PSDU", re.compile(r"psdu", re.I)),
    ("ANP", re.compile(r"(?<![a-z])anp(?![a-z])|conanp|reserva|área\s+natural|area\s+natural", re.I)),
]


def load(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def catalog_blob(row: dict) -> str:
    return f"{row.get('p') or ''} {row.get('n') or ''} {row.get('f') or ''}"


def find_instruments(catalog: list, place_id: str) -> list[dict]:
    kws = [re.compile(k, re.I) for k in PLACE_CATALOG_KW.get(place_id, [])]
    found: dict[str, dict] = {}
    for row in catalog:
        blob = catalog_blob(row)
        if not any(k.search(blob) for k in kws):
            continue
        # Avoid La Paz municipality docs flooding East Cape only when place is la_paz
        # (east_cape uses Barriles/Pulmo keywords — OK)
        path = row.get("p") or row.get("n") or ""
        for name, rx in INSTR_PATTERNS:
            if not rx.search(blob):
                continue
            # Prefer PMDU over PMD when both match
            key = name
            if name == "PMD" and "pmdu" in blob.lower():
                key = "PMDU"
            prev = found.get(key)
            entry = {
                "instrument": key,
                "status": "on_disk",
                "label_es": f"{key} en catálogo",
                "label_en": f"{key} in catalog",
                "path": path,
                "note_es": path.split("/")[-1][:80] if path else "",
                "note_en": path.split("/")[-1][:80] if path else "",
                "tag": "FACT",
            }
            if not prev:
                found[key] = entry
    # Merge known gaps (don't overwrite on_disk)
    for gap in KNOWN_GAPS.get(place_id, []):
        inst = gap["instrument"]
        if inst not in found:
            found[inst] = gap
        elif found[inst]["status"] == "on_disk" and inst in ("PMDU", "PMD", "PSDU") and place_id in ("la_paz", "loreto"):
            # Keep on_disk but add gap note for known incomplete
            if place_id == "la_paz" and inst == "PMDU":
                found[inst] = {
                    **found[inst],
                    "status": "gap",
                    "note_es": "Hay referencias en catálogo pero falta texto completo PMDU (hueco conocido).",
                    "note_en": "Catalog references exist but full PMDU text is a known hole.",
                    "tag": "FACT",
                }
            if place_id == "loreto" and inst in ("PMD", "PSDU", "PMDU"):
                # Loreto has PMDU files that may be incomplete scans
                if "incomplete" in (found[inst].get("path") or "").lower() or "scan" in (found[inst].get("path") or "").lower():
                    found[inst]["note_es"] = (found[inst].get("note_es") or "") + " · posible incompleto (hueco conocido)."
                    found[inst]["note_en"] = (found[inst].get("note_en") or "") + " · possibly incomplete (known hole)."
                    found[inst]["status"] = "gap"
    # Ensure core chips always present
    for core in ("PDU", "POEL", "PMD", "ANP"):
        if core not in found and f"PMDU" not in found:
            # only add gap placeholder if nothing similar
            pass
    for core in ("PDU", "POEL", "PMDU", "ANP"):
        if core not in found and not (core == "PMDU" and "PMD" in found):
            if core == "PMDU" and any(k in found for k in ("PMD", "PDU")):
                continue
            found[core] = {
                "instrument": core,
                "status": "gap",
                "label_es": f"{core} — sin hallazgo claro",
                "label_en": f"{core} — no clear find",
                "note_es": "No se encontró instrumento claro en catalog_slim para este lugar.",
                "note_en": "No clear instrument found in catalog_slim for this place.",
                "tag": "FACT",
            }
    # Prefer order
    order = ["PDU", "PMDU", "POEL", "PMD", "PSDU", "ANP"]
    out = []
    seen = set()
    for o in order:
        if o in found and o not in seen:
            out.append(found[o])
            seen.add(o)
    for k, v in found.items():
        if k not in seen:
            out.append(v)
            seen.add(k)
    return out[:6]


def mobility_for(place_id: str, flights: dict) -> dict:
    airports = {a["iata"]: a for a in (flights.get("airports") or []) if a.get("iata")}
    iata = next((k for k, v in AIRPORT_PLACE.items() if v == place_id), None)
    facts = []
    if iata and iata in airports:
        a = airports[iata]
        n = a.get("counts", {}).get("total")
        facts.append(
            {
                "es": f"Aeropuerto {iata}: {n} destinos sin escalas (FlightConnections, {flights.get('retrieved')}).",
                "en": f"Airport {iata}: {n} non-stop destinations (FlightConnections, {flights.get('retrieved')}).",
                "tag": "FACT",
                "iata": iata,
                "destinations": n,
            }
        )
    # Corridor prose without inventing counts
    corridors = {
        "los_cabos": {
            "es": "Puerta aérea SJD + corredor terrestre Cabo–SJD; dependencia desal/SIBCS (señales foresights).",
            "en": "SJD air gate + Cabo–SJD land corridor; desal/SIBCS dependency (foresight signals).",
            "tag": "FACT",
        },
        "east_cape": {
            "es": "Acceso principalmente por corredor desde Los Cabos / La Paz; sin aeropuerto propio en el pack de vuelos.",
            "en": "Access mainly via corridor from Los Cabos / La Paz; no own airport in the flights pack.",
            "tag": "FACT",
        },
        "todos_santos": {
            "es": "Espina carretera Pacífico hacia Cabos/La Paz; sin aeropuerto propio en el pack de vuelos.",
            "en": "Pacific highway spine toward Cabos/La Paz; no own airport in the flights pack.",
            "tag": "FACT",
        },
        "la_paz": {
            "es": "Puerta LAP (conteo en pack) + puerto/capital; rol de coordinación estatal.",
            "en": "LAP gate (count in pack) + port/capital; statewide coordination role.",
            "tag": "FACT",
        },
        "loreto": {
            "es": "Puerta LTO (conteo en pack) + nodo mid-península; acceso limitado vs. SJD.",
            "en": "LTO gate (count in pack) + mid-peninsula node; limited access vs. SJD.",
            "tag": "FACT",
        },
        "comondu": {
            "es": "Acceso inland por corredor Ciudad Constitución; sin aeropuerto en pack SJD/LAP/LTO.",
            "en": "Inland access via Ciudad Constitución corridor; no airport in SJD/LAP/LTO pack.",
            "tag": "FACT",
        },
        "mulege_north": {
            "es": "Corredor norte disperso (Mulegé / Santa Rosalía / Vizcaíno); sin aeropuerto en pack de tres.",
            "en": "Dispersed northern corridor (Mulegé / Santa Rosalía / Vizcaíno); no airport in the three-pack.",
            "tag": "FACT",
        },
    }
    c = corridors[place_id]
    return {
        "airport_facts": facts,
        "corridor_es": c["es"],
        "corridor_en": c["en"],
        "tag": c["tag"],
        "schematic": f"/lugares/{place_id}_structure.svg",
    }


def tenure_ask(place_id: str, roles: list, place: dict) -> dict:
    tenure = next((r for r in roles if r.get("role_id") == "community_tenure"), None)
    open_q_es = place.get("open_question_es") or ""
    open_q_en = place.get("open_question_en") or ""
    if tenure:
        risk_es = tenure.get("tension_es") or tenure.get("stance_es")
        risk_en = tenure.get("tension_en") or tenure.get("stance_en")
        tag = "ASSUMPTION"
        note_es = "Derivado del lente community_tenure (rol), no de un censo de tenencia por lugar."
        note_en = "From community_tenure role lens, not a place-level tenure census."
    else:
        risk_es = "Riesgo de tenencia/comunidad poco documentado en el portal para este lugar."
        risk_en = "Tenure/community risk thinly documented in the portal for this place."
        tag = "ASSUMPTION"
        note_es = "Sin lente community_tenure aplicable con detalle local."
        note_en = "No community_tenure lens with local detail."
    return {
        "risk_es": risk_es,
        "risk_en": risk_en,
        "open_ask_es": open_q_es
        or "¿Quién tiene acceso seguro al suelo y al agua en este lugar la próxima década?",
        "open_ask_en": open_q_en
        or "Who has secure access to land and water in this place over the next decade?",
        "tag": tag,
        "tag_note_es": note_es,
        "tag_note_en": note_en,
    }


def write_svg(place_id: str, structure: dict) -> str:
    SVG_DIR.mkdir(parents=True, exist_ok=True)
    role = structure["role"]
    colors = {
        "gateway": "#0080C0",
        "spine": "#0d9488",
        "edge": "#c2410c",
        "working_landscape": "#047857",
    }
    color = colors.get(role, "#0080C0")
    labels = {
        "gateway": ("GATEWAY", "SPINE", "EDGE"),
        "spine": ("NODE", "SPINE", "EDGE"),
        "edge": ("PRESSURE", "EDGE", "PROTECT"),
        "working_landscape": ("WORK", "LAND", "LINK"),
    }
    a, b, c = labels.get(role, ("A", "B", "C"))
    title = place_id.replace("_", " ")
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 200" role="img" aria-label="Structure {title}">
  <rect width="420" height="200" fill="#f8fafc"/>
  <text x="16" y="28" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#0f172a">{title} · {structure["role_en"]}</text>
  <rect x="24" y="56" width="100" height="56" rx="10" fill="{color}" opacity="0.9"/>
  <text x="74" y="90" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="700" fill="#fff">{a}</text>
  <rect x="160" y="56" width="100" height="56" rx="10" fill="#334155"/>
  <text x="210" y="90" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="700" fill="#fff">{b}</text>
  <rect x="296" y="56" width="100" height="56" rx="10" fill="#94a3b8"/>
  <text x="346" y="90" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="700" fill="#fff">{c}</text>
  <path d="M124 84 H160" stroke="#0080C0" stroke-width="3"/>
  <path d="M260 84 H296" stroke="#0080C0" stroke-width="3"/>
  <text x="16" y="150" font-family="system-ui,sans-serif" font-size="11" fill="#475569">{structure["reading_en"][:90]}</text>
  <text x="16" y="170" font-family="system-ui,sans-serif" font-size="10" fill="#94a3b8">Schematic · not a survey map · BCS 2050</text>
</svg>
'''
    path = SVG_DIR / f"{place_id}_structure.svg"
    path.write_text(svg, encoding="utf-8")
    return f"/lugares/{place_id}_structure.svg"


def gds_summary(place: dict) -> dict:
    demand = place.get("demand") or []
    supply = place.get("supply") or []
    gaps = sum(1 for x in demand + supply if x.get("status") == "gap")
    ok = sum(1 for x in demand + supply if x.get("status") == "ok")
    return {
        "balance_read": place.get("balance_read"),
        "balance_read_es": place.get("balance_read_es"),
        "balance_read_en": place.get("balance_read_en"),
        "vocation_es": place.get("vocation_es"),
        "vocation_en": place.get("vocation_en"),
        "cells_ok": ok,
        "cells_gap": gaps,
        "href": f"/crecimiento/?place={place.get('id')}#{place.get('id')}",
        "tag": "FACT",
        "tag_note_es": "Solo celdas de growth_demand_supply.json — sin cifras inventadas.",
        "tag_note_en": "Only cells from growth_demand_supply.json — no invented figures.",
    }


def main() -> int:
    fs = load(FS, {})
    gds = load(GDS, {})
    catalog = load(CAT, [])
    if isinstance(catalog, dict):
        catalog = catalog.get("items") or catalog.get("files") or []
    flights = load(FLIGHTS, {})

    places_fs = {p["id"]: p for p in (fs.get("places") or [])}
    places_g = {p["id"]: p for p in (gds.get("places") or [])}
    seeds = fs.get("consensus_seeds") or []
    watch = fs.get("watchlist") or []
    roles = fs.get("role_briefs") or []

    dossiers = []
    for pid in PLACE_ORDER:
        pl = places_fs.get(pid) or {"id": pid}
        g = places_g.get(pid) or {"id": pid}
        st = STRUCTURE[pid]
        svg = write_svg(pid, st)

        claims = [s for s in seeds if pid in (s.get("place_ids") or [])]
        # watchlist items mentioning place name
        name_blob = f"{pl.get('name_es','')} {pl.get('name_en','')} {pid}"
        watch_local = []
        for w in watch:
            blob = f"{w.get('item_es','')} {w.get('item_en','')}"
            if any(tok in blob.lower() for tok in [pid.replace("_", " "), *(PLACE_CATALOG_KW.get(pid, [])[:2])]):
                watch_local.append(w)
            elif pid == "los_cabos" and re.search(r"cabos|sjd|san jos", blob, re.I):
                watch_local.append(w)
            elif pid == "east_cape" and re.search(r"este|pulmo|east", blob, re.I):
                watch_local.append(w)

        dossiers.append(
            {
                "id": pid,
                "name_es": pl.get("name_es") or pid,
                "name_en": pl.get("name_en") or pid,
                "vocation": {
                    "statement_es": pl.get("vocation_es"),
                    "statement_en": pl.get("vocation_en"),
                    "strengths_es": pl.get("strengths_es"),
                    "strengths_en": pl.get("strengths_en"),
                    "constraints_es": pl.get("constraints_es"),
                    "constraints_en": pl.get("constraints_en"),
                    "sum_2050_es": pl.get("sum_2050_es"),
                    "sum_2050_en": pl.get("sum_2050_en"),
                    "structure_note_es": st["reading_es"],
                    "structure_note_en": st["reading_en"],
                    "tag": "FACT",
                    "tag_note_es": "Vocación desde foresights.json places[]; nota design reading etiquetada aparte en structure.",
                    "tag_note_en": "Vocation from foresights.json places[]; design reading note tagged separately under structure.",
                },
                "demand_supply": gds_summary({**g, "id": pid}),
                "contested_claims": claims,
                "watchlist": watch_local[:5],
                "instruments": find_instruments(catalog, pid),
                "mobility": mobility_for(pid, flights),
                "tenure": tenure_ask(pid, roles, pl),
                "structure": {
                    **st,
                    "schematic": svg,
                },
            }
        )

    doc = {
        "updated": date.today().isoformat(),
        "title_es": "Dossiers de lugar — BCS 2050",
        "title_en": "Place dossiers — BCS 2050",
        "disclaimer_es": "Inteligencia interna. FACT = dato o archivo del portal. ASSUMPTION = lectura de diseño (lentes de diseño) sin métrica inventada. Cabos ≠ BCS; desequilibrios locales no se cancelan a escala estatal.",
        "disclaimer_en": "Internal intelligence. FACT = portal datum or file. ASSUMPTION = design reading (design lenses) without invented metrics. Cabos ≠ BCS; local imbalances do not cancel statewide.",
        "places": dossiers,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    PUB.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} places={len(dossiers)} svgs={len(list(SVG_DIR.glob('*_structure.svg')))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
