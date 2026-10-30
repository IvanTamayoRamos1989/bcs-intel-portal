#!/usr/bin/env python3
"""Build BCS OSM-derived GeoJSON layers for /gis-atlas.

Preferred path (offline, reproducible):
  1. Download Geofabrik Mexico extract (~600 MB):
       https://download.geofabrik.de/north-america/mexico-latest.osm.pbf
  2. Clip to BCS bbox with osmium:
       osmium extract -b -115.2,22.8,-109.3,28.0 mexico.osm.pbf -o bcs.osm.pbf
  3. Tag-filter + ogr2ogr → public/gis/osm_*.geojson

Fallback: Overpass API in lat strips (rate-limits common).

Outputs (written under public/gis/):
  osm_highways.geojson      motorway|trunk|primary|secondary
  osm_waterways.geojson     river|canal
  osm_coastline.geojson     natural=coastline
  osm_protected.geojson     boundary=protected_area / nature_reserve
  osm_towns.geojson         place=city|town
  osm_transport_nodes.geojson  aerodromes, ferry terminals, harbours
  osm_municipalities.geojson   admin_level=6 (BCS municipios)
  osm_beaches.geojson          natural/leisure=beach (points)
  osm_power_lines.geojson      power=line|minor_line
  osm_power_nodes.geojson      power=substation|plant (+ named generators)

Also keep existing GeoPackage exports: anp_federales, rtp_conabio, poer_ugas,
ran_nucleos, settlements, highway_nodes. Stills: public/stills/stills.geojson.

BCS bbox: west=-115.2, south=22.8, east=-109.3, north=28.0
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GIS = ROOT / "public" / "gis"
BBOX = (-115.2, 22.8, -109.3, 28.0)  # W S E N
STRIPS = [(22.8, 24.2), (24.2, 25.5), (25.5, 26.7), (26.7, 28.0)]
UA = "BCS-Portal-GIS/1.0 (build_gis_osm_layers.py)"
OVERPASS = "https://overpass-api.de/api/interpreter"


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.check_call(cmd)


def overpass(query: str, timeout: int = 120) -> dict:
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(OVERPASS, data=data, method="POST")
    req.add_header("User-Agent", UA)
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def ways_to_fc(elements: list, props_fn) -> dict:
    feats = []
    for el in elements:
        if el.get("type") != "way" or "geometry" not in el:
            continue
        coords = [[p["lon"], p["lat"]] for p in el["geometry"]]
        if len(coords) < 2:
            continue
        tags = el.get("tags") or {}
        geometry = {"type": "LineString", "coordinates": coords}
        is_poly = tags.get("boundary") or tags.get("leisure") == "nature_reserve"
        if is_poly and len(coords) >= 3:
            if coords[0] != coords[-1]:
                coords = coords + [coords[0]]
            geometry = {"type": "Polygon", "coordinates": [coords]}
        feats.append(
            {
                "type": "Feature",
                "id": el.get("id"),
                "geometry": geometry,
                "properties": props_fn(tags, el.get("id")),
            }
        )
    return {"type": "FeatureCollection", "features": feats}


def write_fc(name: str, fc: dict) -> Path:
    GIS.mkdir(parents=True, exist_ok=True)
    path = GIS / name
    path.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"WROTE {path.name}: {len(fc['features'])} features, {path.stat().st_size} bytes")
    return path


def build_from_pbf(pbf: Path) -> None:
    bcs = Path("/tmp/bcs_osm/bcs.osm.pbf")
    bcs.parent.mkdir(parents=True, exist_ok=True)
    w, s, e, n = BBOX
    run(["osmium", "extract", "-b", f"{w},{s},{e},{n}", str(pbf), "-o", str(bcs), "--overwrite"])

    # Highways / waterways via Overpass-style filters with osmium + ogr2ogr
    filters = {
        "highways": (
            ["w/highway=motorway", "w/highway=trunk", "w/highway=primary", "w/highway=secondary"],
            "lines",
            "osm_highways.geojson",
            0.0003,
        ),
        "waterways": (
            ["w/waterway=river", "w/waterway=canal"],
            "lines",
            "osm_waterways.geojson",
            0.0005,
        ),
        "coast": (["w/natural=coastline"], "lines", "osm_coastline.geojson", 0.0008),
        "protected": (
            [
                "wr/boundary=protected_area",
                "wr/leisure=nature_reserve",
                "wr/boundary=national_park",
            ],
            "multipolygons",
            "osm_protected.geojson",
            0.001,
        ),
    }
    for key, (tags, layer, out_name, simp) in filters.items():
        out_pbf = Path(f"/tmp/bcs_osm/bcs_{key}.osm.pbf")
        run(["osmium", "tags-filter", str(bcs), *tags, "-o", str(out_pbf), "--overwrite"])
        out_gj = GIS / out_name
        if out_gj.exists():
            out_gj.unlink()
        cmd = [
            "ogr2ogr",
            "-f",
            "GeoJSON",
            "-t_srs",
            "EPSG:4326",
            "-simplify",
            str(simp),
            str(out_gj),
            str(out_pbf),
            layer,
            "--config",
            "OSM_USE_CUSTOM_INDEXING",
            "NO",
        ]
        run(cmd)
        print(f"  {out_name}: {out_gj.stat().st_size} bytes")

    # Points
    pts_pbf = Path("/tmp/bcs_osm/bcs_points.osm.pbf")
    run(
        [
            "osmium",
            "tags-filter",
            str(bcs),
            "n/aeroway=aerodrome",
            "n/aeroway=airport",
            "n/amenity=ferry_terminal",
            "n/harbour=yes",
            "n/industrial=port",
            "n/place=city",
            "n/place=town",
            "-o",
            str(pts_pbf),
            "--overwrite",
        ]
    )
    tmp_pts = Path("/tmp/bcs_osm/all_points.geojson")
    if tmp_pts.exists():
        tmp_pts.unlink()
    run(
        [
            "ogr2ogr",
            "-f",
            "GeoJSON",
            "-t_srs",
            "EPSG:4326",
            str(tmp_pts),
            str(pts_pbf),
            "points",
            "--config",
            "OSM_USE_CUSTOM_INDEXING",
            "NO",
        ]
    )
    g = json.loads(tmp_pts.read_text(encoding="utf-8"))
    towns, transport = [], []
    for f in g.get("features", []):
        p = f.get("properties") or {}
        place = p.get("place") or ""
        aeroway = p.get("aeroway") or ""
        amenity = p.get("amenity") or ""
        harbour = p.get("harbour") or ""
        industrial = p.get("industrial") or ""
        props = {
            "name": p.get("name") or "",
            "place": place,
            "population": p.get("population") or "",
            "kind": aeroway
            or amenity
            or industrial
            or ("harbour" if harbour == "yes" else ""),
            "icao": p.get("icao") or "",
            "iata": p.get("iata") or "",
            "osm_id": p.get("osm_id") or "",
        }
        f2 = {"type": "Feature", "geometry": f["geometry"], "properties": props}
        if place in ("city", "town"):
            towns.append(f2)
        if aeroway or amenity == "ferry_terminal" or harbour == "yes" or industrial == "port":
            transport.append(f2)
    write_fc("osm_towns.geojson", {"type": "FeatureCollection", "features": towns})
    write_fc(
        "osm_transport_nodes.geojson",
        {"type": "FeatureCollection", "features": transport},
    )

    # Municipalities (admin_level=6)
    muni_pbf = Path("/tmp/bcs_osm/bcs_muni.osm.pbf")
    run(["osmium", "tags-filter", str(bcs), "r/admin_level=6", "wr/admin_level=6", "-o", str(muni_pbf), "--overwrite"])
    muni_gj = Path("/tmp/bcs_osm/muni_raw.geojson")
    if muni_gj.exists():
        muni_gj.unlink()
    run([
        "ogr2ogr", "-f", "GeoJSON", "-t_srs", "EPSG:4326", "-simplify", "0.002",
        str(muni_gj), str(muni_pbf), "multipolygons",
        "--config", "OSM_USE_CUSTOM_INDEXING", "NO",
    ])
    mg = json.loads(muni_gj.read_text(encoding="utf-8"))
    bcs_keys = ("la paz", "loreto", "los cabos", "mulegé", "mulege", "comondú", "comondu")
    muni_feats = []
    for f in mg.get("features", []):
        props = f.get("properties") or {}
        name = (props.get("name") or props.get("name:es") or "").replace("Municipio de ", "")
        low = name.lower()
        if any(k in low for k in bcs_keys):
            muni_feats.append({
                "type": "Feature",
                "geometry": f["geometry"],
                "properties": {"name": name, "admin_level": "6", "boundary": props.get("boundary") or "", "osm_id": props.get("osm_id") or ""},
            })
    write_fc("osm_municipalities.geojson", {"type": "FeatureCollection", "features": muni_feats})

    # Beaches
    beach_pbf = Path("/tmp/bcs_osm/bcs_beach.osm.pbf")
    run([
        "osmium", "tags-filter", str(bcs),
        "n/natural=beach", "n/leisure=beach", "w/natural=beach", "w/leisure=beach",
        "-o", str(beach_pbf), "--overwrite",
    ])
    beach_pts = Path("/tmp/bcs_osm/beach_pts.geojson")
    beach_poly = Path("/tmp/bcs_osm/beach_poly.geojson")
    for path in (beach_pts, beach_poly):
        if path.exists():
            path.unlink()
    run(["ogr2ogr", "-f", "GeoJSON", "-t_srs", "EPSG:4326", str(beach_pts), str(beach_pbf), "points", "--config", "OSM_USE_CUSTOM_INDEXING", "NO"])
    run(["ogr2ogr", "-f", "GeoJSON", "-t_srs", "EPSG:4326", "-simplify", "0.0005", str(beach_poly), str(beach_pbf), "multipolygons", "--config", "OSM_USE_CUSTOM_INDEXING", "NO"])
    beach_feats = []
    seen = set()
    for path in (beach_pts, beach_poly):
        bg = json.loads(path.read_text(encoding="utf-8"))
        for f in bg.get("features", []):
            props = f.get("properties") or {}
            name = props.get("name") or ""
            geom = f.get("geometry") or {}
            if geom.get("type") != "Point":
                ring = None
                if geom.get("type") == "Polygon":
                    ring = geom["coordinates"][0]
                elif geom.get("type") == "MultiPolygon":
                    ring = geom["coordinates"][0][0]
                if not ring:
                    continue
                xs = [c[0] for c in ring]
                ys = [c[1] for c in ring]
                coords = [sum(xs) / len(xs), sum(ys) / len(ys)]
                geom = {"type": "Point", "coordinates": coords}
            key = (name, round(geom["coordinates"][0], 5), round(geom["coordinates"][1], 5))
            if key in seen:
                continue
            seen.add(key)
            beach_feats.append({
                "type": "Feature",
                "geometry": geom,
                "properties": {"name": name, "kind": "beach"},
            })
    write_fc("osm_beaches.geojson", {"type": "FeatureCollection", "features": beach_feats})

    # Power lines + substations/plants
    power_pbf = Path("/tmp/bcs_osm/bcs_power.osm.pbf")
    run([
        "osmium", "tags-filter", str(bcs),
        "w/power=line", "w/power=minor_line",
        "n/power=substation", "w/power=substation",
        "n/power=plant", "w/power=plant",
        "n/power=generator",
        "-o", str(power_pbf), "--overwrite",
    ])
    plines = Path("/tmp/bcs_osm/power_lines.geojson")
    ppts = Path("/tmp/bcs_osm/power_pts.geojson")
    ppoly = Path("/tmp/bcs_osm/power_poly.geojson")
    for path in (plines, ppts, ppoly):
        if path.exists():
            path.unlink()
    run(["ogr2ogr", "-f", "GeoJSON", "-t_srs", "EPSG:4326", "-simplify", "0.0004", str(plines), str(power_pbf), "lines", "--config", "OSM_USE_CUSTOM_INDEXING", "NO"])
    run(["ogr2ogr", "-f", "GeoJSON", "-t_srs", "EPSG:4326", str(ppts), str(power_pbf), "points", "--config", "OSM_USE_CUSTOM_INDEXING", "NO"])
    run(["ogr2ogr", "-f", "GeoJSON", "-t_srs", "EPSG:4326", str(ppoly), str(power_pbf), "multipolygons", "--config", "OSM_USE_CUSTOM_INDEXING", "NO"])
    import re as _re

    def _tag(props, key):
        if props.get(key):
            return props[key]
        ot = props.get("other_tags") or ""
        m = _re.search(r'"%s"=>"([^"]*)"' % _re.escape(key), ot)
        return m.group(1) if m else ""

    line_feats = []
    for f in json.loads(plines.read_text(encoding="utf-8")).get("features", []):
        props = f.get("properties") or {}
        if _tag(props, "power") not in ("line", "minor_line"):
            continue
        line_feats.append({
            "type": "Feature",
            "geometry": f["geometry"],
            "properties": {
                "name": _tag(props, "name") or _tag(props, "ref"),
                "power": _tag(props, "power"),
                "voltage": _tag(props, "voltage"),
                "operator": _tag(props, "operator"),
            },
        })
    write_fc("osm_power_lines.geojson", {"type": "FeatureCollection", "features": line_feats})

    node_feats = []
    for path in (ppts, ppoly):
        for f in json.loads(path.read_text(encoding="utf-8")).get("features", []):
            props = f.get("properties") or {}
            pw = _tag(props, "power")
            name = _tag(props, "name")
            if pw not in ("substation", "plant") and not (pw == "generator" and name):
                continue
            geom = f.get("geometry") or {}
            if geom.get("type") != "Point":
                ring = None
                if geom.get("type") == "Polygon":
                    ring = geom["coordinates"][0]
                elif geom.get("type") == "MultiPolygon":
                    ring = geom["coordinates"][0][0]
                if not ring:
                    continue
                xs = [c[0] for c in ring]
                ys = [c[1] for c in ring]
                geom = {"type": "Point", "coordinates": [sum(xs) / len(xs), sum(ys) / len(ys)]}
            node_feats.append({
                "type": "Feature",
                "geometry": geom,
                "properties": {"name": name, "power": pw, "voltage": _tag(props, "voltage")},
            })
    write_fc("osm_power_nodes.geojson", {"type": "FeatureCollection", "features": node_feats})


def build_from_overpass() -> None:
    w, _, e, _ = BBOX
    # Highways
    chunks = []
    for s, n in STRIPS:
        q = f'[out:json][timeout:120];way["highway"~"^(motorway|trunk|primary|secondary)$"]({s},{w},{n},{e});out geom;'
        chunks.append(overpass(q))
    els = []
    seen = set()
    for j in chunks:
        for el in j.get("elements", []):
            key = (el.get("type"), el.get("id"))
            if key in seen:
                continue
            seen.add(key)
            els.append(el)
    write_fc(
        "osm_highways.geojson",
        ways_to_fc(
            els,
            lambda t, i: {
                "name": t.get("name") or t.get("ref") or "",
                "highway": t.get("highway", ""),
                "ref": t.get("ref", ""),
                "osm_id": i,
            },
        ),
    )
    print("Overpass path only builds highways here; prefer --pbf for full set.", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--pbf",
        type=Path,
        help="Path to mexico-latest.osm.pbf (Geofabrik). Preferred.",
    )
    ap.add_argument(
        "--overpass",
        action="store_true",
        help="Fallback: fetch highways via Overpass strips (rate-limits likely).",
    )
    args = ap.parse_args()
    GIS.mkdir(parents=True, exist_ok=True)
    if args.pbf:
        if not args.pbf.exists():
            print(f"PBF not found: {args.pbf}", file=sys.stderr)
            return 1
        build_from_pbf(args.pbf)
    elif args.overpass:
        build_from_overpass()
    else:
        ap.print_help()
        print(
            "\nExample:\n  python3 scripts/build_gis_osm_layers.py --pbf /tmp/mexico.osm.pbf",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
