#!/usr/bin/env python3
"""Build portal-ready escorrentía layers from 16_escorrentia/BCS_Escorrentia_2026.
Terrain-based runoff model (HydroSHEDS / HydroRIVERS) — NOT an official flood hazard map.
Never invent figures: only copy numbers from the package JSON/CSV."""
from __future__ import annotations
import json, math, shutil
from pathlib import Path
from datetime import date

import numpy as np
from PIL import Image
from osgeo import ogr, osr  # noqa: F401 — ensures GDAL Python bindings
from osgeo import gdal

HUB = Path(__file__).resolve().parents[1]
SRC = HUB.parent / "16_escorrentia" / "BCS_Escorrentia_2026"
OUT_GIS = HUB / "public" / "gis" / "escorrentia"
OUT_DATA = HUB / "src" / "data"
PUB = HUB / "public"
OUT_GIS.mkdir(parents=True, exist_ok=True)

# LatLonBox from the package KMZ GroundOverlays (matches clipped rasters).
BOUNDS = {"north": 29.0, "south": 22.0, "east": -109.0, "west": -116.0}

MUNI_MAP = {
    "01_Mulege": ("mulege", "Mulegé"),
    "02_Loreto": ("loreto", "Loreto"),
    "03_Comondu": ("comondu", "Comondú"),
    "04_La_Paz": ("la_paz", "La Paz"),
    "05_Los_Cabos": ("los_cabos", "Los Cabos"),
}

CAVEAT_ES = (
    "Modelo preliminar de recorridos potenciales de escorrentía superficial a partir del relieve "
    "(HydroSHEDS DIR 3″ / HydroRIVERS). NO es un mapa oficial de peligro por inundación: no calcula "
    "profundidad, velocidad, caudal, tiempo de llegada ni superficie inundada. La acumulación es "
    "número de celdas aportantes, no agua almacenada. La lluvia puede infiltrarse o evaporarse; aquí "
    "solo se representa dónde podría ir la fracción que produce escorrentía. No modela tuberías, "
    "alcantarillas ni obras hidráulicas. Relieve base SRTM ~2000. Límites municipales de referencia: "
    "World Bank 2012 vía geoBoundaries; límite estatal INEGI 2020 vía geoBoundaries."
)
CAVEAT_EN = (
    "Preliminary terrain-based potential surface-runoff routes (HydroSHEDS DIR 3″ / HydroRIVERS). "
    "NOT an official flood-hazard map: no depth, velocity, discharge, travel time or inundated area. "
    "Accumulation is contributing-cell count, not stored water. Does not model pipes or storm drains."
)


def simplify_geojson(src: Path, dst: Path, tolerance: float, keep_props: list[str] | None = None,
                     filter_fn=None, max_features: int | None = None) -> dict:
    """Simplify with ogr -simplify via in-memory copy; drop unused properties."""
    ds = gdal.OpenEx(str(src), gdal.OF_VECTOR)
    if ds is None:
        raise SystemExit(f"Cannot open {src}")
    layer = ds.GetLayer(0)
    feats = []
    for i, f in enumerate(layer):
        if filter_fn and not filter_fn(f):
            continue
        geom = f.GetGeometryRef()
        if geom is None:
            continue
        g2 = geom.SimplifyPreserveTopology(tolerance) if tolerance > 0 else geom.Clone()
        if g2 is None or g2.IsEmpty():
            continue
        props = {}
        for j in range(f.GetFieldCount()):
            name = f.GetFieldDefnRef(j).GetName()
            if keep_props and name not in keep_props:
                continue
            props[name] = f.GetField(j)
        feats.append({"type": "Feature", "properties": props, "geometry": json.loads(g2.ExportToJson())})
        if max_features and len(feats) >= max_features:
            break
    ds = None
    out = {"type": "FeatureCollection", "features": feats}
    dst.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {"features": len(feats), "bytes": dst.stat().st_size}


def recolor_overlay(src_png: Path, dst_png: Path, mode: str) -> None:
    """Recolor package preview PNGs into the portal light-theme palette.
    mode='relief' → warm grey-green hillshade-like; mode='acc' → cyan→deep blue concentration."""
    im = Image.open(src_png).convert("RGBA")
    arr = np.asarray(im).astype(np.float32)
    rgb, a = arr[..., :3], arr[..., 3]
    # Luminance of source
    lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]) / 255.0
    out = np.zeros_like(arr)
    if mode == "relief":
        # Portal neutrals with a soft teal tint for land; transparent sea (low alpha or near-black source)
        land = a > 20
        # hillshade-like: light cream high, soft slate low
        out[land, 0] = 245 - lum[land] * 90
        out[land, 1] = 247 - lum[land] * 70
        out[land, 2] = 250 - lum[land] * 55
        out[land, 3] = np.clip(a[land] * 0.85, 0, 220)
    else:  # accumulation / concentration
        land = a > 15
        # Map luminance to portal water ramp (#caf0f8 → #0077b6 → #023e8a)
        t = 1.0 - lum  # brighter source = higher accumulation in Ivan's preview (cyan)
        # Actually Ivan's acc preview is cyan on dark; higher acc = brighter cyan
        t = np.clip(lum, 0, 1)
        out[land, 0] = 2 + (1 - t[land]) * 180
        out[land, 1] = 62 + (1 - t[land]) * 140
        out[land, 2] = 138 + t[land] * 80
        out[land, 3] = np.clip(40 + t[land] * 180, 0, 200)
    Image.fromarray(out.astype(np.uint8), "RGBA").save(dst_png, optimize=True)


def build_meta() -> dict:
    resumen = json.loads((SRC / "resumen_municipios.json").read_text(encoding="utf-8"))
    storm = json.loads((SRC / "stormwater" / "resumen_municipios_stormwater.json").read_text(encoding="utf-8"))
    est = json.loads((SRC / "estadisticas.json").read_text(encoding="utf-8"))
    est_sw = json.loads((SRC / "stormwater" / "estadisticas_stormwater.json").read_text(encoding="utf-8"))
    by_muni = {}
    for r in resumen:
        key = next(k for k, (_, label) in MUNI_MAP.items() if label == r["municipio"] or label.replace("ó", "o") == r["municipio"].replace("ó", "o"))
        slug, label = MUNI_MAP[key]
        sw = next(s for s in storm if s["municipio"] == r["municipio"])
        by_muni[slug] = {
            "id": slug,
            "label_es": label,
            "label_en": label.replace("é", "e").replace("ó", "o") if label != "La Paz" else "La Paz",
            "carpeta": key,
            "tramos_unicos": r["tramos_unicos"],
            "partes_red": r["partes"],
            "longitud_km": r["longitud_km"],
            "redes_conectadas": r["redes_conectadas"],
            "trayectorias_distintas": sw["trayectorias_distintas"],
            "partes_trayectorias": sw["partes"],
        }
    return {
        "id": "ds-escorrentia",
        "updated": str(date.today()),
        "title_es": "Escorrentía y agua de lluvia (modelo de terreno)",
        "title_en": "Runoff and stormwater (terrain model)",
        "package": "16_escorrentia/BCS_Escorrentia_2026",
        "package_date": "2026-10-05",
        "source_es": "HydroSHEDS v1.1 y HydroRIVERS v1 (WWF y colaboradores); relieve SRTM; límites geoBoundaries (municipios World Bank 2012, estado INEGI 2020). Empaquetado y recorte al estado: Ivan Tamayo Ramos, 5 oct 2026.",
        "source_en": "HydroSHEDS v1.1 and HydroRIVERS v1 (WWF et al.); SRTM terrain; geoBoundaries. Packaged and clipped to BCS by Ivan Tamayo Ramos, 5 Oct 2026.",
        "method_es": (
            "Red regional HydroRIVERS recortada al estado (2,900 tramos; 16,588.1 km). "
            "Dirección comprobada en 2,680 tramos. Trayectorias D8 desde 4,574 semillas en retícula "
            "de 45 celdas (~3.7–4.2 km) sobre HydroSHEDS DIR 3″; 4,428 salidas costeras y 146 sumideros interiores. "
            "Conteos de rutas muestreadas, no volúmenes ni probabilides."
        ),
        "method_en": (
            "HydroRIVERS network clipped to the state (2,900 reaches; 16,588.1 km). "
            "D8 paths from 4,574 seeds on a 45-cell lattice over HydroSHEDS DIR 3″; "
            "4,428 coastal outlets and 146 inland sinks. Sampled-route counts, not volumes."
        ),
        "caveat_es": CAVEAT_ES,
        "caveat_en": CAVEAT_EN,
        "citations": [
            "https://www.hydrosheds.org/",
            "Lehner, Verdin y Jarvis (2008), Eos 89(10):93–94",
            "Lehner y Grill (2013), Hydrological Processes 27:2171–2186",
            "https://atlasriesgo.uabcs.mx/ (contexto documental de inundaciones; no es la capa modelada)",
            "https://www.geoboundaries.org/",
        ],
        "bounds": BOUNDS,
        "statewide": {
            "tramos_unicos": est["tramos_unicos"],
            "longitud_km": est["longitud_km"],
            "tramos_direccion_verificada": est["tramos_direccion_verificada"],
            "tramos_direccion_no_verificada": est["tramos_direccion_no_verificada"],
            "seed_count": est_sw["seed_count"],
            "salida_costera": est_sw["termination_counts"]["salida_costera"],
            "sumidero_interior": est_sw["termination_counts"]["sumidero_interior"],
            "resolution_arcsec": est_sw["resolution_arcsec"],
            "sampling_note": est_sw["sampling_note"],
        },
        "municipios": by_muni,
        "layers": {
            "red_drenaje": "/gis/escorrentia/red_drenaje.geojson",
            "trayectorias": "/gis/escorrentia/trayectorias.geojson",
            "relieve": "/gis/escorrentia/relieve.png",
            "concentracion": "/gis/escorrentia/concentracion.png",
        },
        "label_es": "Modelo de terreno de escorrentía — no es mapa oficial de inundación",
        "label_en": "Terrain-based runoff model — not an official flood map",
    }


def main():
    print("Building escorrentía portal assets…")
    # 1) Statewide drainage network — simplify ~30–40 m
    r = simplify_geojson(
        SRC / "datos" / "bcs_red_drenaje.geojson",
        OUT_GIS / "red_drenaje.geojson",
        tolerance=0.00035,
        keep_props=["HYRIV_ID", "ORD_STRA", "ORD_CLAS", "LENGTH_KM", "UPLAND_SKM", "DIRECTION_OK", "CLIPPED_KM", "ENDORHEIC"],
    )
    print("red_drenaje", r)

    # 2) Statewide rain paths — keep every 3rd path + those ending with high accumulation; simplify harder
    def tray_filter(f):
        pid = f.GetField("PATH_ID") or 0
        end_acc = f.GetField("END_ACC_CELLS") or 0
        return (pid % 3 == 0) or (end_acc >= 5000)

    t = simplify_geojson(
        SRC / "stormwater" / "BCS_trayectorias_lluvia.geojson",
        OUT_GIS / "trayectorias.geojson",
        tolerance=0.0008,
        keep_props=["PATH_ID", "END_TYPE", "CLIPPED_KM", "END_ACC_CELLS", "FULL_PATH_KM"],
        filter_fn=tray_filter,
    )
    print("trayectorias", t)

    # 3) Per-municipality
    for folder, (slug, _) in MUNI_MAP.items():
        base = SRC / "municipios" / folder
        rr = simplify_geojson(
            base / "red_drenaje.geojson",
            OUT_GIS / f"{slug}_red.geojson",
            tolerance=0.0003,
            keep_props=["HYRIV_ID", "ORD_STRA", "ORD_CLAS", "LENGTH_KM", "DIRECTION_OK", "CLIPPED_KM"],
        )
        # Municipal trajectories can still be large (Mulegé 8MB) — sample + simplify
        def muni_tray_filter(f, _slug=slug):
            pid = f.GetField("PATH_ID") or 0
            # denser municipalities: keep more
            step = 2 if _slug in ("los_cabos", "loreto") else 3
            return pid % step == 0

        tt = simplify_geojson(
            base / "stormwater_trayectorias.geojson",
            OUT_GIS / f"{slug}_tray.geojson",
            tolerance=0.0007,
            keep_props=["PATH_ID", "END_TYPE", "CLIPPED_KM", "END_ACC_CELLS"],
            filter_fn=muni_tray_filter,
        )
        print(slug, rr, tt)

    # 4) Overlays in portal palette
    recolor_overlay(SRC / "stormwater" / "relieve_3s_vista.png", OUT_GIS / "relieve.png", "relief")
    recolor_overlay(SRC / "stormwater" / "acumulacion_celdas_vista.png", OUT_GIS / "concentracion.png", "acc")
    print("overlays", (OUT_GIS / "relieve.png").stat().st_size, (OUT_GIS / "concentracion.png").stat().st_size)

    # 5) Metadata JSON
    meta = build_meta()
    for p in (OUT_DATA / "escorrentia.json", PUB / "escorrentia.json"):
        p.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print("meta written; statewide km", meta["statewide"]["longitud_km"])


if __name__ == "__main__":
    main()
