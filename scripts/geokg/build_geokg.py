#!/usr/bin/env python3
"""Build the BCS 2050 Geospatial Knowledge Graph (GeoKG) products from per-frame records.

Input  data/geokg/records.jsonl.gz  (one line per Sentinel-2 frame: land-cover fractions from the
       semantic-segmentation model, connected-component objects and scene-graph relations)
       data/geokg/model_card.json   (model name, training, held-out evaluation vs ESA WorldCover 2021)
Output src/data/geokg_summary.json  (municipio / localidad aggregates for chat + ontology)
       public/gis/geokg/frames.geojson (one point per frame, map layer)
       public/gis/geokg/geokg_graph.json.gz (full node/edge graph, download)
All values are model-derived from the images; nothing here is an official statistic.
"""
import gzip, json, statistics, unicodedata, re
from collections import Counter, defaultdict
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
REC = ROOT / "data" / "geokg" / "records.jsonl.gz"
CARD = ROOT / "data" / "geokg" / "model_card.json"
OUT_SUM = ROOT / "src" / "data" / "geokg_summary.json"
OUT_PTS = ROOT / "public" / "gis" / "geokg" / "frames.geojson"
OUT_G = ROOT / "public" / "gis" / "geokg" / "geokg_graph.json.gz"
MUNI_NODE = {"Comondú": "terr_comondu", "La Paz": "terr_la_paz", "Loreto": "terr_loreto", "Los Cabos": "terr_los_cabos", "Mulegé": "terr_mulege"}
CLASSES = ["arbolado", "matorral", "pastizal", "cultivo", "urbano_construido", "suelo_desnudo", "agua", "humedal", "manglar"]

def slug(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")

def r(x, n=2):
    return None if x is None else round(x, n)

def main():
    if not REC.is_file():
        print("geokg_skip=no_records"); return
    card = json.loads(CARD.read_text(encoding="utf-8"))
    recs = [json.loads(l) for l in gzip.open(REC, "rt", encoding="utf-8")]
    recs.sort(key=lambda x: x["id"])
    # ---- graph
    nodes, edges = {}, []
    def node(i, t, **kw):
        nodes.setdefault(i, {"id": i, "type": t, **kw})
    for c in CLASSES: node(f"class:{c}", "LandCoverClass", label=c)
    for m, onto in MUNI_NODE.items(): node(f"muni:{slug(m)}", "Municipio", label=m, ontology=onto)
    for x in recs:
        mu = f"muni:{slug(x['municipio'])}"; im = f"img:{x['id']}"
        node(im, "ImageFrame", label=x["id"], date=x["date"], center=x["center"], res_m=x["res_m"])
        edges.append([im, "located_in", mu])
        if x.get("place"):
            lo = f"loc:{slug(x['municipio'])}:{slug(x['place'])}"
            node(lo, "Localidad", label=x["place"], municipio=x["municipio"])
            if (lo, "located_in", mu) not in nodes.setdefault("_seen", set()):
                nodes["_seen"].add((lo, "located_in", mu)); edges.append([lo, "located_in", mu])
            edges.append([im, "near", lo, x.get("place_km")])
        for aq in [a.strip() for a in (x.get("aquifers") or "").split("|") if a.strip()]:
            node(f"aq:{slug(aq)}", "Acuifero", label=aq); edges.append([im, "overlaps", f"aq:{slug(aq)}"])
        for c, f in x["class_frac"].items():
            edges.append([im, "has_cover", f"class:{c}", f])
        for o in x["objects"]:
            node(f"obj:{o['id']}", "Object", cls=o["class"], area_km2=o["area_km2"], centroid=o["centroid"], conf=o["conf"])
            edges.append([im, "contains", f"obj:{o['id']}"]); edges.append([f"obj:{o['id']}", "instance_of", f"class:{o['class']}"])
        for rel in x["relations"]:
            edges.append([f"obj:{rel[0]}", rel[1], f"obj:{rel[2]}"] + rel[3:])
    nodes.pop("_seen", None)
    ntypes = Counter(n["type"] for n in nodes.values()); etypes = Counter(e[1] for e in edges)
    OUT_G.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(OUT_G, "wt", encoding="utf-8") as g:
        json.dump({"about": "BCS 2050 GeoKG — model-derived from Sentinel-2 frames (images of baja). Not official statistics.",
                   "model": card["model"], "nodes": list(nodes.values()), "edges": edges}, g, ensure_ascii=False, separators=(",", ":"))
    # ---- map points
    feats = []
    for x in recs:
        u = x["class_frac"].get("urbano_construido", 0.0)
        lvl = 0 if u < 0.01 else 1 if u < 0.05 else 2 if u < 0.20 else 3
        dom = max(x["class_frac"].items(), key=lambda kv: kv[1])[0] if x["class_frac"] else None
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": x["center"]},
            "properties": {"name": f"{x['place'] or x['municipio']} · {x['date']}", "frame": x["id"], "municipio": x["municipio"],
                "level": lvl, "geokg": 1, "urb": r(u * 100, 1), "agua": r(x["class_frac"].get("agua", 0) * 100, 1),
                "veg": r(sum(x["class_frac"].get(c, 0) for c in ("arbolado", "matorral", "pastizal", "manglar", "humedal")) * 100, 1),
                "dom": dom, "coast": x["coastline_km"], "w_km": x["width_km"], "conf": x["mean_conf"], "agree": x["agreement_wc2021"],
                "n_obj": len(x["objects"]), "n_rel": len(x["relations"])}})
    OUT_PTS.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # ---- aggregates
    by = defaultdict(list)
    for x in recs: by[x["municipio"]].append(x)
    munis = {}
    for m, xs in sorted(by.items()):
        def share(sel):
            tot = sum(x["area_km2"] for x in sel) or 1
            return {c: r(100 * sum(x["area_km2"] * x["class_frac"].get(c, 0) for x in sel) / tot, 1) for c in CLASSES}
        reg = [x for x in xs if x["scale"] in ("Regional", "Paisaje_y_cuenca")]
        coast = [x["coastline_km"] for x in xs if x["coastline_km"] >= 0.5]
        rel = Counter()
        for x in xs:
            cls = {o["id"]: o["class"] for o in x["objects"]}
            for e in x["relations"]:
                rel[f"{cls.get(e[0])} {e[1]} {cls.get(e[2])}"] += 1
        urban_frames = [x for x in xs if x["class_frac"].get("urbano_construido", 0) >= 0.01]
        munis[m] = {"ontology": MUNI_NODE.get(m), "frames": len(xs), "frames_wide": len(reg),
            "share_all_pct": share(xs), "share_wide_pct": share(reg) if reg else None,
            "frames_with_coast": len(coast), "coast_km_median": r(statistics.median(coast), 1) if coast else None,
            "frames_urban_ge1pct": len(urban_frames), "mean_conf": r(statistics.mean(x["mean_conf"] for x in xs), 3),
            "mean_agreement_wc2021": r(statistics.mean([x["agreement_wc2021"] for x in xs if x["agreement_wc2021"] is not None] or [0]), 3),
            "objects": sum(len(x["objects"]) for x in xs), "relations": sum(len(x["relations"]) for x in xs),
            "top_relations": rel.most_common(8),
            "dates": [min(x["date"] for x in xs), max(x["date"] for x in xs)]}
    # localidades: frame centred on the place (<=2 km), width 5.12–10.24 km preferred
    locs = {}
    for x in recs:
        if not x.get("place") or (x.get("place_km") or 99) > 2: continue
        k = (x["municipio"], x["place"]); best = locs.get(k)
        if x["width_km"] > 10.5: continue
        u = lambda y: y["area_km2"] * y["class_frac"].get("urbano_construido", 0)
        if best is None or (u(x), x["mean_conf"]) > (u(best), best["mean_conf"]): locs[k] = x
    loc_rows = []
    for (m, p), x in locs.items():
        objs_u = [o for o in x["objects"] if o["class"] == "urbano_construido"]
        loc_rows.append({"municipio": m, "localidad": p, "frame": x["id"], "date": x["date"], "width_km": x["width_km"], "res_m": x["res_m"],
            "frame_km2": x["area_km2"], "urbano_km2": r(x["area_km2"] * x["class_frac"].get("urbano_construido", 0), 2),
            "urbano_pct": r(100 * x["class_frac"].get("urbano_construido", 0), 1), "agua_pct": r(100 * x["class_frac"].get("agua", 0), 1),
            "manglar_pct": r(100 * x["class_frac"].get("manglar", 0), 1), "cultivo_pct": r(100 * x["class_frac"].get("cultivo", 0), 1),
            "coast_km": x["coastline_km"], "conf": x["mean_conf"], "agree": x["agreement_wc2021"],
            "urban_along_coast": sum(1 for e in x["relations"] if e[1] == "along_coast" and any(o["id"] == e[0] for o in objs_u)),
            "largest_urban_obj_km2": max([o["area_km2"] for o in objs_u], default=0)})
    loc_rows.sort(key=lambda y: -(y["urbano_km2"] or 0))
    summary = {"title": "GeoKG BCS 2050 — imágenes Sentinel-2 (carpeta «images of baja»)",
        "source": {"name": "images of baja — Atlas territorial multiescala (Foster + Partners, 15 nov 2026)", "drive_url": "https://drive.google.com/drive/folders/1KS5hc194cLLWzJ1r25CiALtvkHg-TJuq",
                   "imagery": "Copernicus Sentinel-2 L2A visual (RGB 8-bit), 2026-02-24 a 2026-11-14", "credit": "Contains modified Copernicus Sentinel data 2026"},
        "model": card["model"], "evaluation": card["evaluation"], "caveats_es": card["caveats_es"],
        "frames": len(recs), "graph": {"nodes": len(nodes), "edges": len(edges), "node_types": dict(ntypes), "edge_types": dict(etypes)},
        "municipios": munis, "localidades": loc_rows}
    OUT_SUM.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    # ---- ontology: one Evidence node + edges to the municipal Territory nodes (idempotent)
    gp = ROOT / "src" / "data" / "graph.json"
    if gp.is_file():
        graph = json.loads(gp.read_text(encoding="utf-8"))
        ev = card["evaluation"]
        sm = "; ".join(f"{m}: urbano {x['share_all_pct']['urbano_construido']}%, agua {x['share_all_pct']['agua']}%" for m, x in munis.items())
        nd = {"id": "ev_geokg_s2", "type": "Evidence", "label": f"GeoKG imágenes Sentinel-2 ({len(recs)} marcos)",
              "summary": (f"Grafo de conocimiento geoespacial de la carpeta «images of baja»: segmentación semántica ({card['model']['name']}) en 9 clases y grafo de escena "
                          f"(adjacent_to, contains, along_coast, near). {len(nodes):,} nodos, {len(edges):,} aristas. Concordancia {ev['overall_agreement']*100:.0f}% con WorldCover 2021. "
                          f"Área de imagen analizada — {sm}. Valores derivados por modelo, no oficiales."),
              "label_en": f"GeoKG Sentinel-2 images ({len(recs)} frames)",
              "summary_en": (f"Geospatial knowledge graph from the 'images of baja' folder: semantic segmentation ({card['model']['name']}, 9 classes) and scene graph. "
                             f"{len(nodes):,} nodes, {len(edges):,} edges. {ev['overall_agreement']*100:.0f}% agreement with WorldCover 2021. Model-derived, not official."),
              "evidence_path": "BCSFP/11_bcs_hub/src/data/geokg_summary.json"}
        graph["nodes"] = [n for n in graph["nodes"] if n.get("id") != "ev_geokg_s2"] + [nd]
        graph["edges"] = [e for e in graph.get("edges", []) if "ev_geokg_s2" not in (e.get("from"), e.get("to"))]
        ids = {n.get("id") for n in graph["nodes"]}
        for m in munis:
            t = MUNI_NODE.get(m)
            if t in ids: graph["edges"].append({"from": t, "to": "ev_geokg_s2", "predicate": "evidenced_by"})
        gp.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"geokg frames={len(recs)} nodes={len(nodes)} edges={len(edges)} localidades={len(loc_rows)}")

if __name__ == "__main__":
    main()
