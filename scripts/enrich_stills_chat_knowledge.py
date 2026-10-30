#!/usr/bin/env python3
"""Rebuild denser public/chat_stills_knowledge.json from stills_intelligence.json (no vision API).

Adds place/municipio, visible features, Territory ontology links, and portal hrefs
so the chatbot can answer spatial / map / still questions without an in-browser CV model.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTEL = ROOT / "src" / "data" / "stills_intelligence.json"
OUT = ROOT / "public" / "chat_stills_knowledge.json"

# Rough corridor / municipio hints when still.municipio is empty
BBOX_MUNI = [
    # (lat_min, lat_max, lon_min, lon_max, municipio, ontology_ids)
    (22.75, 23.55, -110.25, -109.35, "Los Cabos", ["terr_los_cabos", "terr_obs_cabos_coast", "terr_corredor_cabos"]),
    (23.35, 24.15, -110.15, -109.40, "Los Cabos", ["terr_obs_east_cape", "terr_anp_cabo_pulmo", "terr_los_cabos"]),  # East Cape
    (23.90, 24.55, -110.85, -110.10, "La Paz", ["terr_la_paz", "terr_todos_santos"]),
    (25.55, 26.35, -111.70, -110.95, "Loreto", ["terr_loreto", "terr_obs_loreto_bay", "terr_anp_loreto"]),
    (24.70, 25.55, -112.20, -111.40, "Comondú", ["terr_comondu"]),
    (26.20, 28.10, -114.20, -111.80, "Mulegé", ["terr_mulege", "terr_obs_vizcaino_spine", "terr_anp_vizcaino"]),
]

MUNI_ONTO = {
    "Los Cabos": ["terr_los_cabos", "terr_obs_cabos_coast", "terr_corredor_cabos"],
    "La Paz": ["terr_la_paz", "terr_todos_santos"],
    "Loreto": ["terr_loreto", "terr_obs_loreto_bay", "terr_anp_loreto"],
    "Comondú": ["terr_comondu"],
    "Mulegé": ["terr_mulege", "terr_obs_vizcaino_spine", "terr_anp_vizcaino"],
}

ANP_ONTO = [
    ("vizca", ["terr_anp_vizcaino", "terr_obs_vizcaino_spine"]),
    ("loreto", ["terr_anp_loreto", "terr_obs_loreto_bay"]),
    ("pulmo", ["terr_anp_cabo_pulmo", "terr_obs_east_cape"]),
    ("laguna", ["terr_anp_sierra_laguna"]),
    ("cabo san lucas", ["terr_anp_apff_csl", "terr_los_cabos"]),
    ("espiritu", ["terr_la_paz"]),
]


def clip(s: str, n: int = 950) -> str:
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def infer_muni(lat, lon, explicit: str | None) -> tuple[str, list[str]]:
    if explicit and explicit.strip() and explicit.strip().lower() not in ("sin municipio", "none", "bcs"):
        m = explicit.strip()
        return m, list(MUNI_ONTO.get(m, ["terr_bcs"]))
    if lat is None or lon is None:
        return "BCS", ["terr_bcs"]
    try:
        lat_f, lon_f = float(lat), float(lon)
    except (TypeError, ValueError):
        return "BCS", ["terr_bcs"]
    for la0, la1, lo0, lo1, muni, onto in BBOX_MUNI:
        if la0 <= lat_f <= la1 and lo0 <= lon_f <= lo1:
            return muni, list(onto)
    return "BCS", ["terr_bcs"]


def ontology_for(still: dict, spat: dict, muni: str, base: list[str]) -> list[str]:
    ids = list(base)
    for anp in spat.get("in_anp") or []:
        name = (anp.get("name") or anp.get("NOMBRE") or "").lower()
        for needle, extra in ANP_ONTO:
            if needle in name:
                ids.extend(extra)
    name = (still.get("name") or "").lower()
    if any(k in name for k in ("east cape", "cabo pulmo", "barriles", "ribera", "buena vista")):
        ids.extend(["terr_obs_east_cape", "terr_anp_cabo_pulmo"])
    if "todos santos" in name or "pescadero" in name:
        ids.extend(["terr_todos_santos", "terr_la_paz"])
    # stable unique
    out, seen = [], set()
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out[:6]


def dense_caption(r: dict) -> tuple[str, str, str, list[str], float | None, float | None]:
    still = r.get("still") or {}
    spat = r.get("spatial") or {}
    vision = r.get("vision") or {}
    sid = still.get("id") or r.get("id")
    name = still.get("name") or sid
    lat, lon = still.get("lat"), still.get("lon")
    muni, onto = infer_muni(lat, lon, still.get("municipio"))
    onto = ontology_for(still, spat, muni, onto)

    bits_es = [
        f"Still Earth Studio «{name}» (municipio {muni}, cat={still.get('category') or 'n/d'}, tema={still.get('theme') or 'n/d'})."
    ]
    bits_en = [
        f"Earth Studio still «{name}» (municipality {muni}, cat={still.get('category') or 'n/a'}, theme={still.get('theme') or 'n/a'})."
    ]

    # What is visible (vision)
    if vision and not vision.get("error"):
        vis_es = (
            f"Lo visible: cobertura={vision.get('land_cover')}; asentamiento={vision.get('settlement_density')}; "
            f"costa_visible={vision.get('coast_visible')}; turismo/resort={vision.get('tourism_resort')}"
        )
        infra = vision.get("infrastructure") or []
        if infra and infra != ["none"]:
            vis_es += f"; infra={', '.join(str(x) for x in infra[:4])}"
        water = vision.get("water_features") or []
        if water:
            vis_es += f"; agua={', '.join(str(x) for x in water[:3])}"
        if vision.get("notes_es"):
            vis_es += f". Nota visión: {vision['notes_es']}"
        bits_es.append(vis_es + ".")
        vis_en = (
            f"Visible: cover={vision.get('land_cover')}; settlement={vision.get('settlement_density')}; "
            f"coast_visible={vision.get('coast_visible')}; tourism/resort={vision.get('tourism_resort')}"
        )
        if vision.get("notes_en"):
            vis_en += f". Vision note: {vision['notes_en']}"
        bits_en.append(vis_en + ".")

    # GIS context
    if spat.get("near_coast") or (spat.get("coast_distance_m") is not None and spat.get("coast_distance_m") < 2500):
        bits_es.append(f"Cerca de costa (~{spat.get('coast_distance_m')} m).")
        bits_en.append(f"Near coast (~{spat.get('coast_distance_m')} m).")
    if spat.get("in_anp"):
        names = ", ".join((x.get("name") or x.get("NOMBRE") or "?") for x in spat["in_anp"][:2])
        bits_es.append(f"Dentro de ANP: {names}.")
        bits_en.append(f"Inside protected area: {names}.")
    elif spat.get("protected_any"):
        bits_es.append("En/near área protegida.")
        bits_en.append("In/near protected area.")
    if spat.get("in_uga"):
        names = ", ".join(
            (x.get("name") or x.get("NOMBRE_UGA") or x.get("CLAVE_UGA") or "?") for x in spat["in_uga"][:2]
        )
        bits_es.append(f"UGA POER: {names}.")
        bits_en.append(f"POER UGA: {names}.")
    hw = spat.get("nearest_highway")
    if hw:
        bits_es.append(
            f"Carretera: {hw.get('name') or hw.get('ref') or hw.get('highway')} "
            f"({hw.get('highway')}, ~{hw.get('distance_m')} m)."
        )
    tw = spat.get("nearest_town") or spat.get("nearest_settlement")
    if tw and tw.get("name"):
        bits_es.append(f"Poblado cercano: {tw.get('name')} (~{tw.get('distance_m')} m).")
        bits_en.append(f"Nearby settlement: {tw.get('name')} (~{tw.get('distance_m')} m).")

    if lat is not None and lon is not None:
        bits_es.append(f"Ubicación aprox. {float(lat):.4f}, {float(lon):.4f} (WGS84; no inventar otras coords).")
        bits_en.append(f"Approx. location {float(lat):.4f}, {float(lon):.4f} (WGS84; do not invent other coords).")

    bits_es.append(
        f"Ontología Territory: {', '.join(onto)}. "
        f"Ver /stills (id {sid}), mapa GIS /mapas, tour /earth-studio. "
        f"[mapa cartografía GIS still imagen vista satélite Earth Studio ubicación lat lon {muni}]"
    )
    bits_en.append(
        f"Territory ontology: {', '.join(onto)}. "
        f"See /stills (id {sid}), GIS /mapas, tour /earth-studio. "
        f"[map cartography GIS still image view satellite Earth Studio location lat lon {muni}]"
    )

    # Prefer precomputed summary as lead if present and short
    lead_es = (r.get("summary_es") or "").strip()
    lead_en = (r.get("summary_en") or lead_es).strip()
    body_es = (" ".join(bits_es)).strip()
    body_en = (" ".join(bits_en)).strip()
    if lead_es and len(lead_es) > 40:
        # Merge: keep dense vision/ontology tags even if lead exists
        body_es = clip(lead_es + " | " + " ".join(bits_es[1:]), 950)
        body_en = clip((lead_en or lead_es) + " | " + " ".join(bits_en[1:]), 950)
    else:
        body_es = clip(body_es, 950)
        body_en = clip(body_en, 950)

    return body_es, body_en, muni, onto, lat, lon


def build(records: list[dict]) -> list[dict]:
    chunks: list[dict] = []
    by_muni: dict[str, list] = defaultdict(list)

    for r in records:
        still = r.get("still") or {}
        sid = still.get("id") or r.get("id")
        name = still.get("name") or sid
        es, en, muni, onto, lat, lon = dense_caption(r)
        by_muni[muni].append(r)
        batch = still.get("batch") or "batch"
        chunks.append(
            {
                "id": f"still:{sid}",
                "title": f"Still territorial: {name}",
                "path": f"stills/{batch}/{sid}",
                "theme": "territorio",
                "sum_es": es,
                "sum_en": en,
                "drive_url": None,
                "type": "still",
                "municipio": muni,
                "lat": lat,
                "lon": lon,
                "ontology_ids": onto,
                "href": "/stills",
            }
        )

    for muni, rows in sorted(by_muni.items()):
        n = len(rows)
        n_coast = sum(1 for r in rows if (r.get("spatial") or {}).get("near_coast"))
        n_prot = sum(1 for r in rows if (r.get("spatial") or {}).get("protected_any"))
        n_town = sum(1 for r in rows if (r.get("spatial") or {}).get("near_town"))
        covers = defaultdict(int)
        places = []
        for r in rows:
            v = r.get("vision") or {}
            if v.get("land_cover"):
                covers[v["land_cover"]] += 1
            nm = (r.get("still") or {}).get("name")
            if nm and nm not in places and len(places) < 8:
                places.append(nm)
        cover_txt = ", ".join(f"{k}:{v}" for k, v in sorted(covers.items(), key=lambda x: -x[1])[:5])
        onto = MUNI_ONTO.get(muni, ["terr_bcs"])
        body_es = clip(
            f"Mapa / cartografía de stills Earth Studio — municipio {muni}: {n} fotogramas georreferenciados. "
            f"Cerca de costa: {n_coast}. En/near área protegida: {n_prot}. Cerca de asentamiento: {n_town}. "
            f"Coberturas vistas: {cover_txt or 'n/d'}. Lugares ejemplo: {', '.join(places) or 'n/d'}. "
            f"Ontología Territory: {', '.join(onto)}. "
            f"Consultar capa stills en /mapas (GIS), galería /stills, tour /earth-studio, síntesis /studio. "
            f"Fuente: stills_intelligence (OSM/ANP/POER + visión). "
            f"[mapa cartografía GIS still imagen vista satélite Earth Studio {muni} ubicación]",
            950,
        )
        body_en = clip(
            f"Map / cartography of Earth Studio stills — municipality {muni}: {n} georeferenced frames. "
            f"Near coast: {n_coast}. In/near protected: {n_prot}. Near settlement: {n_town}. "
            f"Land covers: {cover_txt or 'n/a'}. Example places: {', '.join(places) or 'n/a'}. "
            f"Territory ontology: {', '.join(onto)}. "
            f"See stills layer on /mapas (GIS), gallery /stills, tour /earth-studio, synthesis /studio. "
            f"[map cartography GIS still image satellite Earth Studio {muni} location]",
            950,
        )
        chunks.append(
            {
                "id": f"stillmuni:{muni}",
                "title": f"Stills / mapa por municipio — {muni}",
                "path": f"stills/municipio/{muni}",
                "theme": "territorio",
                "sum_es": body_es,
                "sum_en": body_en,
                "drive_url": None,
                "type": "still_summary",
                "municipio": muni,
                "ontology_ids": onto,
                "href": "/stills",
            }
        )

    # Corridors
    corridor_rows = []
    for r in records:
        hw = (r.get("spatial") or {}).get("nearest_highway") or {}
        if hw.get("highway") in ("motorway", "trunk", "primary") and hw.get("distance_m", 99999) <= 2000:
            corridor_rows.append(r)
    if corridor_rows:
        refs = defaultdict(int)
        for r in corridor_rows:
            hw = r["spatial"]["nearest_highway"]
            label = hw.get("ref") or hw.get("name") or hw.get("highway")
            refs[str(label)] += 1
        top = ", ".join(f"{k} ({v})" for k, v in sorted(refs.items(), key=lambda x: -x[1])[:8])
        body = clip(
            f"Corredores carreteros en stills (≤2 km de motorway/trunk/primary): {len(corridor_rows)} fotogramas. "
            f"Refs/nombres: {top}. Útil para mapa de conectividad BCS. Ver /mapas y /stills. "
            f"[mapa cartografía GIS still carretera corredor MEX 1 MEX 19]",
            950,
        )
        chunks.append(
            {
                "id": "still:corridors",
                "title": "Stills cerca de corredores carreteros BCS",
                "path": "stills/corridors",
                "theme": "conectividad",
                "sum_es": body,
                "sum_en": body,
                "drive_url": None,
                "type": "still_summary",
                "href": "/stills",
            }
        )

    # Statewide overview (decision-oriented, keeps ontology hooks)
    n = len(records)
    n_vis = sum(1 for r in records if r.get("vision") and not (r.get("vision") or {}).get("error"))
    n_coast = sum(1 for r in records if (r.get("spatial") or {}).get("near_coast"))
    n_prot = sum(1 for r in records if (r.get("spatial") or {}).get("protected_any"))
    n_anp = sum(1 for r in records if (r.get("spatial") or {}).get("in_anp"))
    n_tour = sum(1 for r in records if (r.get("vision") or {}).get("tourism_resort"))
    # Corridor samples via bbox counts
    def in_box(r, box):
        la0, la1, lo0, lo1, *_ = box
        st = r.get("still") or {}
        try:
            return la0 <= float(st["lat"]) <= la1 and lo0 <= float(st["lon"]) <= lo1
        except Exception:
            return False

    n_cabos = sum(1 for r in records if in_box(r, BBOX_MUNI[0]))
    n_east = sum(1 for r in records if in_box(r, BBOX_MUNI[1]))
    n_loreto = sum(1 for r in records if in_box(r, BBOX_MUNI[3]))
    n_viz = sum(1 for r in records if in_box(r, BBOX_MUNI[5]))
    body = clip(
        f"Inteligencia territorial — stills Earth Studio BCS (overview / mapa): {n} puntos con join GIS "
        f"(~1500 m) a carreteras, ANP, POER UGA, costa, asentamientos; visión IA {n_vis}/{n}. "
        f"Globales: near_coast {n_coast}; protected_any {n_prot}; in_anp {n_anp}; tourism_resort {n_tour}. "
        f"Muestras espaciales: corredor/densificación Los Cabos ~{n_cabos} stills (terr_obs_cabos_coast); "
        f"East Cape / Pulmo ~{n_east} (terr_obs_east_cape); bahía Loreto ~{n_loreto} (terr_obs_loreto_bay); "
        f"espina Vizcaíno ~{n_viz} (terr_obs_vizcaino_spine). "
        f"Evidencia ontología ev_stills_intel. Portales: /mapas (GIS), /stills, /earth-studio, /studio. "
        f"[mapa cartografía GIS still imagen satélite Earth Studio ubicación BCS]",
        950,
    )
    body_en = clip(
        f"Territorial intelligence — BCS Earth Studio stills (overview / map): {n} points with GIS join "
        f"(~1500 m) to roads, ANP, POER UGA, coast, settlements; AI vision {n_vis}/{n}. "
        f"Globals: near_coast {n_coast}; protected_any {n_prot}; in_anp {n_anp}; tourism_resort {n_tour}. "
        f"Spatial samples: Los Cabos corridor ~{n_cabos}; East Cape ~{n_east}; Loreto bay ~{n_loreto}; "
        f"Vizcaíno spine ~{n_viz}. Ontology evidence ev_stills_intel. "
        f"Portals: /mapas, /stills, /earth-studio, /studio. "
        f"[map cartography GIS still satellite Earth Studio location BCS]",
        950,
    )
    chunks.append(
        {
            "id": "still:overview",
            "title": "Inteligencia territorial — stills Earth Studio BCS (overview)",
            "path": "stills/intelligence/overview",
            "theme": "territorio",
            "sum_es": body,
            "sum_en": body_en,
            "drive_url": None,
            "type": "still_summary",
            "ontology_ids": [
                "ev_stills_intel",
                "terr_obs_cabos_coast",
                "terr_obs_loreto_bay",
                "terr_obs_vizcaino_spine",
                "terr_obs_east_cape",
            ],
            "href": "/stills",
        }
    )

    # Ontology bridge card (kept for RAG)
    chunks.append(
        {
            "id": "onto:v1.3-stills",
            "title": "Ontología BCS v1.3 — stills → decisiones",
            "path": "12_ontology/ontology.yaml#v1.3-stills",
            "theme": "ontologia",
            "sum_es": clip(
                "Ontología v1.3: evidencia ev_stills_intel alinea stills_intelligence y still:overview. "
                "Observaciones Territory: terr_obs_cabos_coast, terr_obs_loreto_bay, terr_obs_vizcaino_spine, "
                "terr_obs_east_cape. Candado const_coast_anp_pressure. Preguntas dq_coast_anp_buffers, "
                "dq_vizcaino_corridor, dq_stills_densification. Hub /ontologia · mapas /mapas · stills /stills. "
                "[mapa cartografía GIS still ontología Territory]",
                950,
            ),
            "sum_en": clip(
                "Ontology v1.3: evidence ev_stills_intel aligns stills_intelligence and still:overview. "
                "Territory observations: terr_obs_cabos_coast, terr_obs_loreto_bay, terr_obs_vizcaino_spine, "
                "terr_obs_east_cape. Constraint const_coast_anp_pressure. Questions dq_coast_anp_buffers, "
                "dq_vizcaino_corridor, dq_stills_densification. Hub /ontologia · maps /mapas · stills /stills.",
                950,
            ),
            "drive_url": None,
            "type": "still_summary",
            "ontology_ids": [
                "ev_stills_intel",
                "terr_obs_cabos_coast",
                "terr_obs_loreto_bay",
                "const_coast_anp_pressure",
            ],
            "href": "/ontologia",
        }
    )
    return chunks


def main():
    data = json.loads(INTEL.read_text(encoding="utf-8"))
    records = data.get("records") or []
    chunks = build(records)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(chunks, ensure_ascii=False, indent=2), encoding="utf-8")
    by = defaultdict(int)
    for c in chunks:
        by[c["type"]] += 1
    print(f"wrote {OUT} chunks={len(chunks)} by_type={dict(by)} from_records={len(records)}")


if __name__ == "__main__":
    main()
