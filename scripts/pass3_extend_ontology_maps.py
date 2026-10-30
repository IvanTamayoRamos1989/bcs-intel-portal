#!/usr/bin/env python3
"""Pass 3: extend ontology with federal projects + energy assets; build map GeoJSON + search index.
Never invent numeric capacities — only copy sourced fields from federal_projects JSON / known graph.
"""
from __future__ import annotations
import json
import re
from datetime import date
from pathlib import Path

HUB = Path(__file__).resolve().parents[1]
LAKE = HUB.parent
ONTO_YAML = LAKE / "12_ontology" / "ontology.yaml"
EXPORT = LAKE / "12_ontology" / "export_graph.py"
FED = LAKE / "13_federal_projects" / "federal_projects_bcs.json"
GRAPH_HUB = HUB / "src" / "data" / "graph.json"
LAYERS = HUB / "public" / "gis" / "layers.json"
OUT_FED_GEO = HUB / "public" / "gis" / "federal_projects.geojson"
OUT_ENE_GEO = HUB / "public" / "gis" / "energy_assets.geojson"
OUT_SEARCH = HUB / "public" / "search_index.json"
PORTAL_FACTS = HUB / "src" / "data" / "portal_facts.json"
PUBLIC_FACTS = HUB / "public" / "portal_facts.json"

# Cabecera / municipal approximate centroids (public geography; NOT project site coords)
MUNI_CENTROID = {
    "los_cabos": {"lat": 23.063, "lon": -109.702, "label": "Los Cabos", "studio": "los_cabos", "terr": "terr_los_cabos"},
    "la_paz": {"lat": 24.142, "lon": -110.311, "label": "La Paz", "studio": "la_paz", "terr": "terr_la_paz"},
    "loreto": {"lat": 26.012, "lon": -111.349, "label": "Loreto", "studio": "loreto", "terr": "terr_loreto"},
    "comondu": {"lat": 25.032, "lon": -111.670, "label": "Comondú", "studio": "comondu", "terr": "terr_comondu"},
    "mulege": {"lat": 27.339, "lon": -112.267, "label": "Mulegé", "studio": "mulege", "terr": "terr_mulege"},
    "bcs": {"lat": 25.85, "lon": -111.85, "label": "BCS", "studio": "bcs", "terr": "terr_bcs"},
}

SECTOR_THEME = {
    "energy": "energia",
    "water": "agua",
    "roads": "conectividad",
    "ports": "conectividad",
    "airports": "conectividad",
    "environment": "ambiente",
    "tourism": "turismo",
    "housing": "economia",
    "education": "economia",
    "health": "economia",
    "social": "economia",
    "internet": "conectividad",
    "mining": "economia",
    "fisheries": "economia",
    "security": "economia",
    "other": "economia",
}

# Actor id shortcuts by dependencia keyword
DEP_ACTOR = {
    "cfe": "actor_cfe",
    "cenace": "actor_cenace",
    "conagua": "actor_conagua",
    "conanp": "actor_conanp",
}


def slug(s: str) -> str:
    s = (s or "").lower()
    s = s.replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u").replace("ñ", "n")
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s[:48] or "x"


def parse_munis(raw: str) -> list[str]:
    t = (raw or "").strip()
    low = t.lower()
    if not t or "estatal" in low or "sibcs" in low or "sitio no" in low or "por definir" in low or "costero" in low:
        return ["bcs"]
    found = []
    order = [
        ("los cabos", "los_cabos"),
        ("la paz", "la_paz"),
        ("loreto", "loreto"),
        ("comondú", "comondu"),
        ("comondu", "comondu"),
        ("mulegé", "mulege"),
        ("mulege", "mulege"),
        ("todos santos", "la_paz"),  # within La Paz muni
        ("guerrero negro", "mulege"),
        ("isla santa margarita", "comondu"),
        ("golfo de ulloa", "comondu"),
        ("sierra la laguna", "la_paz"),
    ]
    for needle, key in order:
        if needle in low and key not in found:
            found.append(key)
    return found or ["bcs"]


def ensure_yaml_deps():
    try:
        import yaml  # noqa
    except ImportError:
        import subprocess, sys
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyyaml", "-q"])


def load_fed():
    data = json.loads(FED.read_text())
    return data["projects"]


def extend_ontology_yaml(projects: list[dict]) -> int:
    ensure_yaml_deps()
    import yaml

    text = ONTO_YAML.read_text()
    data = yaml.safe_load(text)
    existing = {i["id"] for i in data["instances"]}
    # Ensure territory nodes for all munis exist
    terr_needed = {
        "terr_la_paz": ("Municipio de La Paz", "Capital estatal; servicios y amenidad Todos Santos–Pescadero."),
        "terr_loreto": ("Municipio de Loreto", "Crecimiento contestado frente a ANP / POEL."),
        "terr_comondu": ("Municipio de Comondú", "Polo agropecuario Valle Santo Domingo."),
        "terr_mulege": ("Municipio de Mulegé", "Norte / Vizcaíno — evidencia escasa; no inventar offset estatal."),
    }
    added = 0
    for tid, (lab, summ) in terr_needed.items():
        if tid not in existing:
            data["instances"].append({
                "id": tid,
                "type": "Territory",
                "label_es": lab,
                "label_en": lab.replace("Municipio de ", "") + " municipality",
                "summary": summ,
                "links": [{"rel": "located_in", "to": "terr_bcs"}],
            })
            existing.add(tid)
            added += 1

    # Energy capacity / asset nodes (qualitative; no invented MW)
    energy_nodes = [
        {
            "id": "rc_plant_sol_insurgentes",
            "type": "ResourceCapacity",
            "label_es": "Planta solar Sol de Insurgentes (OSM)",
            "label_en": "Sol de Insurgentes solar plant (OSM)",
            "summary": "Nodo OSM power=plant en Comondú. Capacidad MW no consolidada en portal — ver brecha renovables.",
            "evidence_path": "BCSFP/14_gis_atlas/osm_power_nodes",
            "links": [
                {"rel": "located_in", "to": "terr_comondu"},
                {"rel": "supplies", "to": "rc_sibcs"},
                {"rel": "cross_ref_osm", "to": "rc_sibcs"},
            ],
        },
        {
            "id": "rc_bess_gap",
            "type": "Constraint",
            "label_es": "Brecha: proyectos BESS (ubicación/MW)",
            "label_en": "Gap: BESS projects (location/MW)",
            "summary": "Almacenamiento en baterías: capacidad, sitio y empresas aún no consolidados con fuente primaria en el portal.",
            "evidence_path": "BCSFP/11_bcs_hub/src/data/data_gaps.json#gap-energia-baterias-bess",
            "links": [
                {"rel": "constrains", "to": "rc_sibcs"},
                {"rel": "informs_decision", "to": "dq_capacidad_carga"},
            ],
        },
        {
            "id": "rc_subestaciones_gap",
            "type": "Constraint",
            "label_es": "Brecha: inventario subestaciones SIBCS",
            "label_en": "Gap: SIBCS substation inventory",
            "summary": "Falta listado público consolidado de subestaciones (nombre, MVA) para el SIBCS.",
            "evidence_path": "BCSFP/11_bcs_hub/src/data/data_gaps.json#gap-energia-subestaciones",
            "links": [
                {"rel": "constrains", "to": "rc_sibcs"},
                {"rel": "depends_on", "to": "actor_cfe"},
            ],
        },
        {
            "id": "ev_federal_projects_inventory",
            "type": "Evidence",
            "label_es": "Inventario proyectos federales BCS (44)",
            "label_en": "BCS federal projects inventory (44)",
            "summary": "JSON/CSV curado en 13_federal_projects — anuncios y fuentes; no implica ejecución completa.",
            "evidence_path": "BCSFP/13_federal_projects/",
            "links": [{"rel": "located_in", "to": "terr_bcs"}],
        },
        {
            "id": "inst_federal_pipeline",
            "type": "Instrument",
            "label_es": "Pipeline de proyectos federales (AMLO/Sheinbaum)",
            "label_en": "Federal project pipeline (AMLO/Sheinbaum)",
            "summary": "Conjunto de anuncios e instrumentos federales rastreados para BCS; cruzar con estado y fuente.",
            "evidence_path": "BCSFP/13_federal_projects/",
            "links": [
                {"rel": "governs", "to": "terr_bcs"},
                {"rel": "evidenced_by", "to": "ev_federal_projects_inventory"},
            ],
        },
    ]
    for node in energy_nodes:
        if node["id"] not in existing:
            data["instances"].append(node)
            existing.add(node["id"])
            added += 1

    # Map existing P23 to federal id if present in list
    for p in projects:
        pid = p["id"]  # e.g. FED-ENE-001
        nid = "proj_" + slug(pid)
        if nid in existing or pid == "FED-ENE-P23":  # skip weird
            continue
        # Avoid duplicating canonical P23 node — link instead
        label = p.get("proyecto") or pid
        summary_parts = [
            f"Sexenio {p.get('sexenio')}; sector {p.get('sector')}; estado {p.get('estado')}.",
        ]
        if p.get("dependencia"):
            summary_parts.append(f"Dependencia: {p['dependencia']}.")
        if p.get("capacidad/alcance"):
            summary_parts.append(str(p["capacidad/alcance"]))
        if p.get("data_gap"):
            summary_parts.append(f"Brecha: {p['data_gap']}")
        munis = parse_munis(p.get("municipio(s)") or "")
        links = [{"rel": "evidenced_by", "to": "ev_federal_projects_inventory"}]
        links.append({"rel": "engages_in", "to": "inst_federal_pipeline"})
        for m in munis:
            terr = MUNI_CENTROID[m]["terr"]
            if terr in existing or terr in terr_needed or terr == "terr_los_cabos" or terr == "terr_bcs":
                links.append({"rel": "located_in", "to": terr if terr in existing or terr == "terr_los_cabos" or terr == "terr_bcs" or terr in terr_needed else "terr_bcs"})
        # Fix located_in: use terr that will exist
        links = [l for l in links if l["rel"] != "located_in"]
        for m in munis:
            links.append({"rel": "located_in", "to": MUNI_CENTROID[m]["terr"]})
        dep = (p.get("dependencia") or "").lower()
        for key, actor in DEP_ACTOR.items():
            if key in dep and actor in existing:
                links.append({"rel": "depends_on", "to": actor})
                break
        if p.get("sector") == "energy":
            links.append({"rel": "enables", "to": "rc_sibcs"})
            links.append({"rel": "informs_decision", "to": "dq_capacidad_carga"})
        if p.get("sector") == "water":
            links.append({"rel": "informs_decision", "to": "dq_capacidad_carga"})
        # Cross-link known P23
        if "p23" in label.lower() or "transmisión" in label.lower() and "cabos" in label.lower():
            if "proj_p23_bs1" in existing:
                links.append({"rel": "isA", "to": "proj_p23_bs1"})

        node = {
            "id": nid,
            "type": "Project",
            "label_es": label[:120],
            "label_en": label[:120],
            "summary": " ".join(summary_parts)[:480],
            "evidence_path": p.get("fuente_principal_url") or "BCSFP/13_federal_projects/",
            "federal_id": pid,
            "links": links,
        }
        # Special: if this is clearly the same as proj_p23_bs1, skip creating duplicate — add edge from existing
        if nid == "proj_fed_ene_p23" or "P23-BS1" in label or "P23 BS1" in label.upper():
            # enrich existing proj_p23_bs1 links only
            continue
        data["instances"].append(node)
        existing.add(nid)
        added += 1

    data["updated"] = date.today().isoformat()
    data["version"] = str(data.get("version") or "1.3")
    # bump minor
    try:
        major, minor = str(data["version"]).split(".")[:2]
        data["version"] = f"{major}.{int(minor) + 1}"
    except Exception:
        data["version"] = "1.4"

    ONTO_YAML.write_text(yaml.dump(data, allow_unicode=True, sort_keys=False, width=100))
    return added


def run_export():
    import subprocess, sys
    subprocess.check_call([sys.executable, str(EXPORT)])


def build_federal_geo(projects: list[dict]):
    features = []
    for p in projects:
        munis = parse_munis(p.get("municipio(s)") or "")
        # One feature per project at primary muni centroid (first) — multi-muni noted in props
        primary = munis[0]
        c = MUNI_CENTROID[primary]
        props = {
            "id": p["id"],
            "name": p.get("proyecto"),
            "sexenio": p.get("sexenio"),
            "sector": p.get("sector"),
            "dependencia": p.get("dependencia"),
            "municipios_raw": p.get("municipio(s)"),
            "municipios": munis,
            "estado": p.get("estado"),
            "monto_MXN": p.get("monto_MXN") or "",
            "alcance": p.get("capacidad/alcance") or "",
            "fuente": p.get("fuente_principal_url") or "",
            "precision": "municipality_centroid_approximate",
            "precision_es": "Aprox. centroide de cabecera/municipio — no es coordenada de obra",
            "precision_en": "Approx. municipality/cabecera centroid — not a worksite coordinate",
            "studio_href": f"/studio/{MUNI_CENTROID[primary]['studio']}/",
            "ontology_id": "proj_" + slug(p["id"]),
            "dossier_theme": SECTOR_THEME.get(p.get("sector") or "", "economia"),
        }
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [c["lon"], c["lat"]]},
            "properties": props,
        })
    geo = {
        "type": "FeatureCollection",
        "name": "federal_projects_bcs",
        "crs_note": "WGS84; positions are approximate municipal centroids unless otherwise sourced",
        "features": features,
    }
    OUT_FED_GEO.write_text(json.dumps(geo, ensure_ascii=False, indent=2))
    return len(features)


def build_energy_geo():
    """Public OSM plant inside BCS + approximate endpoints for P23 corridor."""
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-111.74569846, 25.1946455]},
            "properties": {
                "id": "osm_sol_insurgentes",
                "name": "Sol de Insurgentes",
                "kind": "plant",
                "precision": "osm_sourced",
                "precision_es": "Coordenada OSM (power=plant)",
                "precision_en": "OSM coordinate (power=plant)",
                "source": "OpenStreetMap osm_power_nodes",
                "ontology_id": "rc_plant_sol_insurgentes",
                "studio_href": "/studio/comondu/",
            },
        },
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-110.311, 24.142]},
            "properties": {
                "id": "p23_endpoint_lapaz",
                "name": "P23-BS1 — extremo La Paz (aprox.)",
                "kind": "transmission",
                "precision": "approximate",
                "precision_es": "Extremo aproximado del corredor de transmisión — no torre georreferenciada",
                "precision_en": "Approximate transmission corridor end — not a surveyed tower",
                "source": "Ontology proj_p23_bs1 / PAMRNT narrative",
                "ontology_id": "proj_p23_bs1",
                "studio_href": "/studio/la_paz/",
            },
        },
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-109.702, 23.063]},
            "properties": {
                "id": "p23_endpoint_cabos",
                "name": "P23-BS1 — extremo Los Cabos (aprox.)",
                "kind": "transmission",
                "precision": "approximate",
                "precision_es": "Extremo aproximado del corredor de transmisión — no torre georreferenciada",
                "precision_en": "Approximate transmission corridor end — not a surveyed tower",
                "source": "Ontology proj_p23_bs1 / PAMRNT narrative",
                "ontology_id": "proj_p23_bs1",
                "studio_href": "/studio/los_cabos/",
            },
        },
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-111.85, 25.85]},
            "properties": {
                "id": "sibcs_system",
                "name": "SIBCS (sistema aislado)",
                "kind": "system",
                "precision": "symbolic",
                "precision_es": "Marcador simbólico del sistema — no es una subestación",
                "precision_en": "Symbolic system marker — not a substation",
                "source": "Ontology rc_sibcs",
                "ontology_id": "rc_sibcs",
                "studio_href": "/studio/bcs/",
                "note_es": "Inventario de subestaciones: brecha de datos (ver ontología rc_subestaciones_gap).",
            },
        },
    ]
    # Line for P23 approximate corridor
    features.append({
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": [[-110.311, 24.142], [-109.702, 23.063]],
        },
        "properties": {
            "id": "p23_corridor_approx",
            "name": "P23-BS1 La Paz–Los Cabos (trazo aproximado)",
            "kind": "transmission_line",
            "precision": "approximate",
            "precision_es": "Trazo esquemático entre cabeceras — no alineamiento oficial",
            "precision_en": "Schematic trace between cabeceras — not an official alignment",
            "source": "Ontology proj_p23_bs1",
            "ontology_id": "proj_p23_bs1",
        },
    })
    geo = {
        "type": "FeatureCollection",
        "name": "energy_assets_bcs",
        "crs_note": "WGS84; mix of OSM-sourced and approximate/symbolic markers — see precision field",
        "features": features,
    }
    OUT_ENE_GEO.write_text(json.dumps(geo, ensure_ascii=False, indent=2))
    return len(features)


def update_layers():
    layers = json.loads(LAYERS.read_text())
    by_id = {L["id"]: L for L in layers}
    extras = [
        {
            "id": "federal_projects",
            "url": "/gis/federal_projects.geojson",
            "name_es": "Proyectos federales (centroide mun.)",
            "name_en": "Federal projects (muni centroid)",
            "type": "points",
            "defaultOn": True,
            "color": "#7B6BB0",
            "group": "projects",
            "group_es": "Proyectos",
            "group_en": "Projects",
            "cluster": True,
            "legend_es": "Posición aproximada = centroide municipal (no obra)",
            "legend_en": "Approx. position = municipal centroid (not worksite)",
        },
        {
            "id": "energy_assets",
            "url": "/gis/energy_assets.geojson",
            "name_es": "Energía (plantas / P23 / SIBCS)",
            "name_en": "Energy (plants / P23 / SIBCS)",
            "type": "mixed",
            "defaultOn": True,
            "color": "#E8A838",
            "group": "energy",
            "group_es": "Energía",
            "group_en": "Energy",
            "cluster": False,
            "legend_es": "OSM + marcadores aproximados; subestaciones = brecha",
            "legend_en": "OSM + approximate markers; substations = data gap",
        },
    ]
    for e in extras:
        if e["id"] in by_id:
            # update in place
            for i, L in enumerate(layers):
                if L["id"] == e["id"]:
                    layers[i] = e
                    break
        else:
            layers.insert(0, e)
    LAYERS.write_text(json.dumps(layers, ensure_ascii=False, indent=2) + "\n")


def build_search_index(projects: list[dict]):
    graph = json.loads(GRAPH_HUB.read_text())
    items = []
    for p in projects:
        munis = parse_munis(p.get("municipio(s)") or "")
        items.append({
            "kind": "federal_project",
            "id": p["id"],
            "href": f"/proyectos-federales/?q={p['id']}",
            "title_es": p.get("proyecto"),
            "title_en": p.get("proyecto"),
            "blurb_es": f"{p.get('sector')} · {p.get('sexenio')} · {p.get('municipio(s)')}",
            "blurb_en": f"{p.get('sector')} · {p.get('sexenio')} · {p.get('municipio(s)')}",
            "tags": [p.get("sector"), p.get("sexenio"), p.get("dependencia")] + munis,
        })
    for n in graph.get("nodes", []):
        items.append({
            "kind": "ontology",
            "id": n["id"],
            "href": f"/ontologia/?node={n['id']}",
            "title_es": n.get("label"),
            "title_en": n.get("label_en") or n.get("label"),
            "blurb_es": (n.get("summary") or "")[:160],
            "blurb_en": (n.get("summary_en") or n.get("summary") or "")[:160],
            "tags": [n.get("type"), n["id"]],
        })
    for key, c in MUNI_CENTROID.items():
        if key == "bcs":
            href = "/studio/bcs/"
        else:
            href = f"/studio/{c['studio']}/"
        items.append({
            "kind": "place",
            "id": key,
            "href": href,
            "title_es": c["label"],
            "title_en": c["label"],
            "blurb_es": "Ficha municipal / studio",
            "blurb_en": "Municipal dossier / studio",
            "tags": ["municipio", "lugar", key],
        })
    themes = [
        ("agua", "Agua", "Water"),
        ("energia", "Energía", "Energy"),
        ("economia", "Economía", "Economy"),
        ("territorio", "Población / territorio", "Population / territory"),
        ("conectividad", "Movilidad / infraestructura", "Mobility / infrastructure"),
        ("ambiente", "Medio ambiente", "Environment"),
        ("turismo", "Turismo", "Tourism"),
        ("planeacion", "Gobernanza / planeación", "Governance / planning"),
        ("proyectos-federales", "Proyectos federales", "Federal projects"),
    ]
    for slug_, es, en in themes:
        items.append({
            "kind": "theme",
            "id": slug_,
            "href": f"/{slug_}/",
            "title_es": es,
            "title_en": en,
            "blurb_es": "Eje temático",
            "blurb_en": "Theme hub",
            "tags": ["tema", slug_],
        })
    OUT_SEARCH.write_text(json.dumps({"updated": date.today().isoformat(), "count": len(items), "items": items}, ensure_ascii=False, indent=2))
    return len(items)


def inject_portal_facts(projects: list[dict], n_nodes: int, n_edges: int):
    """Append ontology/federal fact snippets for chat — no invented numbers."""
    facts_path = PORTAL_FACTS
    data = json.loads(facts_path.read_text())
    facts = data.get("facts") or []
    # Remove prior pass3 markers
    facts = [f for f in facts if not (isinstance(f, dict) and f.get("id", "").startswith("pass3_"))]
    new = [
        {
            "id": "pass3_ontology_extent",
            "es": f"La ontología del portal incluye {n_nodes} entidades y {n_edges} relaciones (export graph.json), con los 44 proyectos federales enlazados a territorio, sector y evidencia.",
            "en": f"The portal ontology includes {n_nodes} entities and {n_edges} relations (graph.json export), with all 44 federal projects linked to territory, sector and evidence.",
            "source": "12_ontology/graph.json",
        },
        {
            "id": "pass3_federal_map",
            "es": "En el mapa, los 44 proyectos federales se muestran en el centroide aproximado del municipio (no son coordenadas de obra). Ver campo precision.",
            "en": "On the map, the 44 federal projects are shown at approximate municipal centroids (not worksite coordinates). See precision field.",
            "source": "public/gis/federal_projects.geojson",
        },
        {
            "id": "pass3_energy_gap",
            "es": "Subestaciones SIBCS y proyectos BESS figuran como brechas de datos en la ontología; no se inventan MVA ni sitios.",
            "en": "SIBCS substations and BESS projects appear as ontology data gaps; MVA and sites are not invented.",
            "source": "data_gaps.json",
        },
    ]
    # A few project one-liners with sourced fields only
    for p in projects[:8]:
        new.append({
            "id": f"pass3_fed_{p['id']}",
            "es": f"Proyecto federal {p['id']}: {p.get('proyecto')} — {p.get('sexenio')}, {p.get('sector')}, {p.get('municipio(s)')}, estado {p.get('estado')}.",
            "en": f"Federal project {p['id']}: {p.get('proyecto')} — {p.get('sexenio')}, {p.get('sector')}, {p.get('municipio(s)')}, status {p.get('estado')}.",
            "source": p.get("fuente_principal_url") or "13_federal_projects",
        })
    facts.extend(new)
    data["facts"] = facts
    data["count"] = len(facts)
    facts_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    PUBLIC_FACTS.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def main():
    projects = load_fed()
    assert len(projects) == 44, len(projects)
    n_add = extend_ontology_yaml(projects)
    print("ontology instances added:", n_add)
    run_export()
    graph = json.loads(GRAPH_HUB.read_text())
    print("graph nodes/edges:", len(graph["nodes"]), len(graph["edges"]))
    nfed = build_federal_geo(projects)
    nene = build_energy_geo()
    update_layers()
    ns = build_search_index(projects)
    inject_portal_facts(projects, len(graph["nodes"]), len(graph["edges"]))
    print("federal geo features:", nfed, "energy:", nene, "search items:", ns)
    print("done")


if __name__ == "__main__":
    main()
