#!/usr/bin/env python3
"""Build an offline capacity-study REQUEST package (contract bcs.capacity_study.v0.1, BCS-owned) for one municipio.

Output: /workspace/shared/bcs_studies/_requests/<municipio>/  (all geometry in EPSG:32612, metres)
Rules: only data already in the BCSFP lake / portal. Never invent parcels: if no cadastre exists, emit an
analysis grid explicitly labelled as such. Every layer and figure carries source / date / method / caveat
(same fields as src/data/data_inventory.json). Usage: build_study_request.py los_cabos
"""
from __future__ import annotations
import hashlib, json, math, os, re, sys
from datetime import date
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio import features as rfeatures
from rasterio.windows import from_bounds
from shapely.geometry import Point, box, shape, mapping
from shapely.ops import unary_union

HUB = Path(__file__).resolve().parents[1]
LAKE = HUB.parent
OUT_ROOT = Path(os.environ.get("BCS_REQUESTS_OUT", "/workspace/shared/bcs_studies/_requests"))
CRS = "EPSG:32612"
TODAY = str(date.today())

MUNI = {
    "los_cabos": {"label": "Los Cabos", "cve_mun": "008", "esc_folder": "05_Los_Cabos", "aquifers": ["0317", "0319"],
                  "study_id": "loscabos-municipio-001"},
}

# --- internal lake locations: used ONLY to read inputs; never written to the package ---
LAKE_PATH = {
    "inegi_mg2022": "05_demographics/2022-12-01_INEGI-CONABIO_Municipios_BCS_MarcoGeoestadistico2022.zip",
    "inegi_iter2020": "05_demographics/2020-03-15_INEGI_Censo2020_ITER_BCS.zip",
    "inegi_serie": "05_demographics/1990-2020_INEGI_Poblacion_municipal_BCS_serie_censal.csv",
    "conanp_anp": "13_territorial_intelligence/_raw/maps_listings/anp_federales/anp_federales_BCS_2025.shp",
    "hydro_red": "16_escorrentia/BCS_Escorrentia_2026/municipios/{esc_folder}/red_drenaje.geojson",
    "hydro_tray": "16_escorrentia/BCS_Escorrentia_2026/municipios/{esc_folder}/stormwater_trayectorias.geojson",
    "hydro_acc": "16_escorrentia/BCS_Escorrentia_2026/stormwater/BCS_acc_3s.tif",
}

# --- sources as clean citations (institution, dataset, year, licence, method, caveat; public URL only in `url`) ---
# Rule: no internal paths, raw file names or hosts inside any text field. `url` is a separate citation field (or None).
SRC = {
    "inegi_mg2022": dict(title="Marco Geoestadístico 2022 — límites municipales de Baja California Sur", owner="INEGI (distribución CONABIO)",
                         dataset="Marco Geoestadístico", year="2022", source_date="2022-12-01", licence="INEGI — Términos de libre uso",
                         url="https://www.inegi.org.mx/temas/mg/",
                         method="Polígono municipal oficial, reproyectado de EPSG:4326 a EPSG:32612",
                         caveat="Límite geoestadístico, no deslinde legal"),
    "inegi_iter2020": dict(title="Censo de Población y Vivienda 2020 — Principales resultados por localidad (ITER), Baja California Sur", owner="INEGI",
                           dataset="Censo de Población y Vivienda 2020, ITER", year="2020", source_date="2020-03-15",
                           licence="INEGI — Términos de libre uso", url="https://www.inegi.org.mx/programas/ccpv/2020/",
                           method="Localidades con coordenadas ITER (grados-minutos-segundos → decimal) y POBTOT / VIVPAR_HAB",
                           caveat="Puntos de localidad, no polígonos urbanos; población residente 2020 (sin flotante/turística)"),
    "inegi_serie": dict(title="Población municipal de Baja California Sur 1990–2020 (censos de población)", owner="INEGI",
                        dataset="Censos de Población y Vivienda 1990, 2000, 2010 y 2020", year="1990–2020", source_date="2020-03-15",
                        licence="INEGI — Términos de libre uso", url="https://www.inegi.org.mx/programas/ccpv/2020/",
                        method="Totales municipales de cada censo", caveat="Sin proyección: los censos no proyectan"),
    "conanp_anp": dict(title="Áreas Naturales Protegidas federales — Baja California Sur", owner="CONANP",
                       dataset="Polígonos de ANP federales", year="2025", source_date="2025",
                       licence="Datos abiertos del Gobierno de México", url="https://www.conanp.gob.mx/",
                       method="Polígonos ANP que intersectan el municipio, recortados", caveat="Incluye superficie marina; las reglas de manejo varían por zona/subzona (no modeladas)"),
    "poer": dict(title="Programa de Ordenamiento Ecológico Regional de Baja California Sur (POERBCS) — Unidades de Gestión Ambiental (UGA)",
                 owner="Gobierno de Baja California Sur / SEMARNAT", dataset="POERBCS, UGA", year=None,
                 source_date="(fecha del decreto no consolidada en el acervo)", licence="Gobierno de Baja California Sur",
                 url="https://www.gob.mx/semarnat/acciones-y-programas/ordenamiento-ecologico-del-territorio",
                 method="UGAs que intersectan el municipio, recortadas; atributos CLAVE_UGA / CLASIFICAC", caveat="Política ambiental por UGA; criterios de uso no traducidos aún a reglas de exclusión"),
    "hydro_red": dict(title="Red de drenaje HydroRIVERS v1, recortada al municipio",
                      owner="WWF HydroSHEDS; recorte del equipo del portal BCS 2050", dataset="HydroRIVERS v1", year="2026 (recorte)",
                      source_date="2026-10-05", licence="HydroSHEDS — atribución requerida", url="https://www.hydrosheds.org/products/hydrorivers",
                      method="Tramos HydroRIVERS con orden de Strahler (ORD_STRA); geometría original sin simplificar",
                      caveat="Modelo de terreno (SRTM ~2000); no es mapa oficial de inundación; no incluye drenaje pluvial urbano"),
    "hydro_tray": dict(title="Trayectorias potenciales de escorrentía (D8) derivadas de HydroSHEDS",
                       owner="WWF HydroSHEDS; cálculo del equipo del portal BCS 2050", dataset="HydroSHEDS v1, dirección de flujo 3″", year="2026 (cálculo)",
                       source_date="2026-10-05", licence="HydroSHEDS — atribución requerida", url="https://www.hydrosheds.org/hydrosheds-core-downloads",
                       method="Rutas D8 sobre HydroSHEDS DIR 3″ desde retícula de semillas (~3.7–4.2 km)",
                       caveat="Rutas potenciales muestreadas, no volúmenes ni probabilidades"),
    "hydro_acc": dict(title="Acumulación de flujo HydroSHEDS 3″, recortada a Baja California Sur",
                      owner="WWF HydroSHEDS; recorte del equipo del portal BCS 2050", dataset="HydroSHEDS v1, acumulación de flujo 3″", year="2026 (recorte)",
                      source_date="2026-10-05", licence="HydroSHEDS — atribución requerida", url="https://www.hydrosheds.org/hydrosheds-core-downloads",
                      method="Celdas con acumulación ≥ umbral (supuesto A-FC-1) poligonizadas y recortadas al municipio",
                      caveat="Concentración de flujo = celdas aportantes; NO es zona inundable oficial ni profundidad de agua"),
    "osm_coast": dict(title="Línea de costa OpenStreetMap", owner="OpenStreetMap contributors", dataset="OpenStreetMap natural=coastline",
                      year="2026", source_date="2026-09", licence="ODbL", url="https://www.openstreetmap.org/copyright",
                      method="Líneas natural=coastline recortadas a 2 km del municipio",
                      caveat="No es la delimitación oficial de ZOFEMAT (SEMARNAT); la zona federal no está en el acervo"),
    "conagua_dma": dict(title="Acuerdo de disponibilidad media anual de agua de los 653 acuíferos (DOF, 9 nov 2023) y fichas de actualización CONAGUA 2024",
                        owner="CONAGUA / SEMARNAT", dataset="Disponibilidad media anual de agua subterránea (DMA)", year="2023",
                        source_date="2023-11-09", licence="Gobierno de México", url="https://www.dof.gob.mx/",
                        method="NOM-011-CONAGUA-2015: DMA = R − DNC − VEAS (hm³/año); cifras del Acuerdo DOF 2023, p. 3",
                        caveat="Sin polígonos de acuífero en el acervo: se entrega como atributo municipal, no como capa espacial"),
    "portal_focus": dict(title="Franjas de foco indicativas del portal (corredor Cabos–La Paz; East Cape)", owner="Equipo del portal BCS 2050",
                         dataset="Lectura territorial del portal", year="2026", source_date="2026-09", licence="Interno", url=None,
                         method="Polígonos dibujados como lectura territorial", caveat="Indicativo; NO es zonificación ni área de crecimiento de un instrumento de planeación"),
    "grid": dict(title="Retícula de análisis 500 m (generada para esta solicitud)", owner="Equipo del portal BCS 2050",
                 dataset="Retícula de análisis", year=TODAY[:4], source_date=TODAY, licence="Interno", url=None,
                 method="Celdas cuadradas de 500 m en EPSG:32612 recortadas al límite municipal INEGI 2022",
                 caveat="NO son predios: no hay catastro en el acervo. Unidad de cálculo esquemática"),
}

# Guard: no path / filename / host may appear in citation text (url is the only place for a public address).
_LEAK = re.compile(r"(\.(zip|shp|shx|dbf|tif|tiff|csv|pdf|geojson|json|py|xlsx?)\b|[\w.-]+/[\w.-]+/[\w.-]+|\\|[A-Za-z]:/|https?://|\b[\w-]+\.(gob|org|com|net|edu|io)(\.mx)?\b|\b[\w-]+\.mx\b)", re.I)


def assert_clean(obj, where="$", skip=("url",)):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k not in skip:
                assert_clean(v, f"{where}.{k}", skip)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            assert_clean(v, f"{where}[{i}]", skip)
    elif isinstance(obj, str) and _LEAK.search(obj):
        raise SystemExit(f"leak in citation text at {where}: {obj!r}")


def lake(key: str, cfg: dict) -> Path:
    return LAKE / LAKE_PATH[key].format(**cfg)


ASSUMPTIONS = [
    {"id": "A-FC-1", "text_es": "Umbral de concentración de flujo: celdas con ≥ 1,000 celdas aportantes (≈ 7–8 km² de cuenca a 3″ en esta latitud)",
     "value": 1000, "unit": "celdas aportantes", "basis": "Supuesto de la solicitud para delimitar cauces de flujo concentrado; ajustable por el estudio"},
    {"id": "A-FC-2", "text_es": "Segundo umbral (flujo concentrado menor): ≥ 100 celdas aportantes", "value": 100, "unit": "celdas aportantes",
     "basis": "Supuesto de la solicitud; clase de menor concentración"},
    {"id": "A-GRID-1", "text_es": "Tamaño de celda de la retícula de análisis", "value": 500, "unit": "m", "basis": "Escala municipal esquemática; no cadastral"},
]


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def dms_to_dd(s: str) -> float | None:
    m = re.match(r"\s*(\d+)°(\d+)'([\d.]+)\"\s*([NSEW])", str(s))
    if not m:
        return None
    d, mi, se, hemi = int(m.group(1)), int(m.group(2)), float(m.group(3)), m.group(4)
    v = d + mi / 60 + se / 3600
    return -v if hemi in "SW" else v


def vclip(g: gpd.GeoDataFrame, mask) -> gpd.GeoDataFrame:
    g = g[g.geometry.notna()].copy()
    g["geometry"] = g.geometry.make_valid()
    g = g[g.intersects(mask)]
    return gpd.clip(g, mask)


def write(gdf: gpd.GeoDataFrame, path: Path, layer_meta: dict) -> dict:
    gdf = gdf.to_crs(CRS)
    for c in gdf.columns:
        if c != "geometry" and str(gdf[c].dtype).startswith("datetime"):
            gdf[c] = gdf[c].dt.strftime("%Y-%m-%d")
    # round coordinates to cm-ish (1 decimal of metre is plenty for schematic study)
    gj = json.loads(gdf.to_json(drop_id=True))
    gj["crs"] = {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32612"}}
    gj["bcs_layer"] = layer_meta
    txt = json.dumps(gj, ensure_ascii=False, separators=(",", ":"))
    txt = re.sub(r"(\d+\.\d)\d+", r"\1", txt)  # 0.1 m precision
    path.write_text(txt, encoding="utf-8")
    return {"file": path.name, "features": len(gdf), "bytes": path.stat().st_size, "sha256": sha256(path)}


def main(muni_id: str):
    cfg = MUNI[muni_id]
    out = OUT_ROOT / muni_id
    out.mkdir(parents=True, exist_ok=True)
    files = {}

    # 1. Municipal limit (INEGI MG 2022)
    import zipfile, tempfile
    tmp = Path(tempfile.mkdtemp())
    zipfile.ZipFile(lake("inegi_mg2022", cfg)).extractall(tmp)
    mun = gpd.read_file(next(tmp.glob("*.shp")))
    col = next(c for c in mun.columns if c.upper() in ("CVE_MUN", "CVEGEO", "CVE_MUNI"))
    sel = mun[mun[col].astype(str).str.endswith(cfg["cve_mun"])].copy()
    assert len(sel) == 1, f"municipio not found ({col})"
    sel = sel.set_crs("EPSG:4326", allow_override=True)
    lim = sel.to_crs(CRS)
    lim_geom = lim.geometry.iloc[0]
    lim_out = gpd.GeoDataFrame({"municipio": [cfg["label"]], "cve_mun": [cfg["cve_mun"]], "area_m2": [round(lim_geom.area, 1)],
                                "source_ref": ["inegi_mg2022"]}, geometry=[lim_geom], crs=CRS)
    files["municipal_limit"] = write(lim_out, out / "municipal_limit.geojson", {"role": "boundary", "source_ref": "inegi_mg2022"})
    lim_4326 = sel.geometry.make_valid().iloc[0]
    bbox_4326 = lim_4326.buffer(0.03).bounds

    # 2. Localities (INEGI ITER 2020) — points
    zipfile.ZipFile(lake("inegi_iter2020", cfg)).extractall(tmp / "iter")
    iter_csv = next((tmp / "iter").rglob("conjunto_de_datos_iter_*.csv"))
    d = pd.read_csv(iter_csv, dtype=str, encoding="utf-8")
    d = d[(d.MUN == cfg["cve_mun"]) & (~d.LOC.isin(["0000", "9998", "9999"]))].copy()
    d["lon"] = d.LONGITUD.map(dms_to_dd)
    d["lat"] = d.LATITUD.map(dms_to_dd)
    d = d.dropna(subset=["lon", "lat"])
    num = lambda s: int(s) if str(s).isdigit() else None
    locs = gpd.GeoDataFrame({
        "cve_loc": d.LOC, "nombre": d.NOM_LOC,
        "pobtot_2020": d.POBTOT.map(num), "vivpar_hab_2020": d.VIVPAR_HAB.map(num),
        "ambito": np.where(d.POBTOT.map(lambda s: (num(s) or 0) >= 2500), "urbana", "rural"),
        "source_ref": "inegi_iter2020",
    }, geometry=[Point(xy) for xy in zip(d.lon, d.lat)], crs="EPSG:4326")
    files["localities"] = write(locs, out / "localities.geojson", {"role": "context", "source_ref": "inegi_iter2020",
                                "note_es": "Puntos de localidad; ámbito urbano = POBTOT ≥ 2,500 (criterio INEGI)"})

    # 3. Indicative focus belts (portal) clipped
    fb = []
    for f in ("focus_corridor_cabos_lapaz", "focus_east_cape"):
        g = gpd.read_file(HUB / "public/gis" / f"{f}.geojson").set_crs("EPSG:4326", allow_override=True)
        g = g[g.geometry.type.isin(["Polygon", "MultiPolygon"])]
        g = vclip(g, lim_4326)
        if len(g):
            fb.append(g[["id", "name_es", "geometry"]].assign(indicative=True, source_ref="portal_focus"))
    if fb:
        fbg = pd.concat(fb, ignore_index=True)
        files["focus_belts_indicative"] = write(gpd.GeoDataFrame(fbg, crs="EPSG:4326"), out / "focus_belts_indicative.geojson",
                                                {"role": "context", "source_ref": "portal_focus", "note_es": SRC["portal_focus"]["caveat"]})

    # 4. Constraints
    cons = {}
    anp = gpd.read_file(lake("conanp_anp", cfg)).to_crs("EPSG:4326")
    anp = vclip(anp, lim_4326)
    keep = [c for c in ("NOMBRE", "CAT_MANEJO", "PRIM_DEC", "ID_ANP") if c in anp.columns]
    anp = anp[keep + ["geometry"]].assign(source_ref="conanp_anp")
    cons["protected_areas"] = write(anp, out / "c_protected_areas.geojson", {"role": "exclude_or_condition", "source_ref": "conanp_anp"})

    uga = gpd.read_file(HUB / "public/gis/poer_ugas.geojson").set_crs("EPSG:4326", allow_override=True)
    uga = vclip(uga, lim_4326)
    uga = uga[[c for c in ("CLAVE_UGA", "NOMBRE_UGA", "CLASIFICAC", "clave_MOE", "UGA_MUN") if c in uga.columns] + ["geometry"]].assign(source_ref="poer")
    cons["poer_ugas"] = write(uga, out / "c_poer_ugas.geojson", {"role": "attribute", "source_ref": "poer"})

    red = gpd.read_file(lake("hydro_red", cfg)).set_crs("EPSG:4326", allow_override=True)
    red = red[[c for c in ("HYRIV_ID", "ORD_STRA", "ORD_CLAS", "UPLAND_SKM", "DIRECTION_OK", "CLIPPED_KM", "ENDORHEIC") if c in red.columns] + ["geometry"]].assign(source_ref="hydro_red")
    cons["runoff_network"] = write(red, out / "c_runoff_network.geojson", {"role": "condition", "source_ref": "hydro_red",
                                   "note_es": "Retiro/servidumbre de cauce no definido en la solicitud: el estudio debe declarar su supuesto"})

    tray = gpd.read_file(lake("hydro_tray", cfg)).set_crs("EPSG:4326", allow_override=True)
    tray = tray[[c for c in ("PATH_ID", "END_TYPE", "CLIPPED_KM", "END_ACC_CELLS") if c in tray.columns] + ["geometry"]].assign(source_ref="hydro_tray")
    cons["runoff_paths"] = write(tray, out / "c_runoff_paths.geojson", {"role": "context", "source_ref": "hydro_tray"})

    # Flow concentration polygons from accumulation raster
    with rasterio.open(lake("hydro_acc", cfg)) as ds:
        win = from_bounds(*bbox_4326, transform=ds.transform)
        acc = ds.read(1, window=win)
        tr = ds.window_transform(win)
        nod = ds.nodata
    if nod is not None:
        acc = np.where(acc == nod, 0, acc)
    cls = np.zeros(acc.shape, dtype=np.uint8)
    cls[acc >= 100] = 1
    cls[acc >= 1000] = 2
    polys = []
    for geom, val in rfeatures.shapes(cls, mask=cls > 0, transform=tr):
        polys.append({"geometry": shape(geom), "clase": int(val)})
    fc = gpd.GeoDataFrame(polys, crs="EPSG:4326")
    fc = vclip(fc, lim_4326)
    fc = fc.dissolve(by="clase", as_index=False)
    fc["umbral_celdas"] = fc.clase.map({1: 100, 2: 1000})
    fc["assumption_ref"] = fc.clase.map({1: "A-FC-2", 2: "A-FC-1"})
    fc["source_ref"] = "hydro_acc"
    fc["etiqueta_es"] = fc.clase.map({1: "flujo concentrado (≥100 celdas)", 2: "flujo muy concentrado (≥1,000 celdas)"})
    cons["flow_concentration"] = write(fc, out / "c_flow_concentration.geojson", {"role": "exclude_or_condition", "source_ref": "hydro_acc",
                                       "note_es": "Proxy de terreno de cauces con flujo concentrado; NO es zona inundable oficial"})

    coast = gpd.read_file(HUB / "public/gis/osm_coastline.geojson").set_crs("EPSG:4326", allow_override=True)
    coast = vclip(coast, lim_4326.buffer(0.02))
    coast = coast[["geometry"]].assign(source_ref="osm_coast")
    cons["coastline"] = write(coast, out / "c_coastline.geojson", {"role": "reference", "source_ref": "osm_coast",
                              "note_es": "ZOFEMAT oficial no disponible; si el estudio aplica 20 m desde pleamar (LGBN) debe declararlo como supuesto"})

    aq = json.loads((HUB / "src/data/aquifers_bcs.json").read_text(encoding="utf-8"))
    aq_rows = []
    for a in aq["aquifers"]:
        if a["clave"] not in cfg["aquifers"]:
            continue
        row = {k: a.get(k) for k in ("clave", "nombre", "R", "DNC", "VCAS", "VEALA", "VAPTYR", "VAPRH", "dma_hm3", "status",
                                     "municipio_texto", "source", "source_page")}
        # clean citation of the CONAGUA aquifer sheet (no internal file name)
        row["ficha_cita"] = (f"CONAGUA (2024) — Actualización de la disponibilidad media anual de agua en el acuífero "
                             f"{a['nombre']} ({a['clave']}), Baja California Sur")
        row["ficha_page"] = a.get("ficha_page")
        row["source_ref"] = "conagua_dma"
        aq_rows.append(row)
    aq_doc = {
        "role": "attribute", "source_ref": "conagua_dma", "geometry": None,
        "note_es": "Sin polígonos de acuífero en el acervo. Ambos acuíferos están declarados totalmente dentro del municipio (fichas CONAGUA).",
        "method_es": aq["method_es"], "aquifers": aq_rows}
    assert_clean(aq_doc, "$aquifer_deficit")
    (out / "c_aquifer_deficit.json").write_text(json.dumps(aq_doc, ensure_ascii=False, indent=1), encoding="utf-8")
    cons["aquifer_deficit"] = {"file": "c_aquifer_deficit.json", "features": len(aq_rows), "sha256": sha256(out / "c_aquifer_deficit.json")}

    # 5. Units: analysis grid (NO cadastre in lake)
    minx, miny, maxx, maxy = lim_geom.bounds
    step = 500
    cells = []
    xs = np.arange(math.floor(minx / step) * step, maxx, step)
    ys = np.arange(math.floor(miny / step) * step, maxy, step)
    from shapely.prepared import prep
    pl = prep(lim_geom)
    for x in xs:
        for y in ys:
            b = box(x, y, x + step, y + step)
            if not pl.intersects(b):
                continue
            g = b if pl.contains(b) else b.intersection(lim_geom)
            if g.is_empty or g.area < 1:
                continue
            cells.append({"id": f"G500-{int(x)}-{int(y)}", "unit_kind": "analysis_grid_cell", "area_m2": round(g.area, 1),
                          "source_ref": "grid", "geometry": g})
    grid = gpd.GeoDataFrame(cells, crs=CRS)
    files["units"] = write(grid, out / "units_analysis_grid_500m.geojson", {"role": "units", "unit_kind": "analysis_grid_cell",
                           "source_ref": "grid", "note_es": "NO son predios. No hay catastro en el acervo BCSFP."})

    # 6. Growth (census only)
    serie = pd.read_csv(lake("inegi_serie", cfg), dtype={"cve_mun": str})
    s = serie[serie.cve_mun.str.zfill(3) == cfg["cve_mun"]].sort_values("year")
    hist = [{"year": int(r.year), "population": int(r.poblacion_total)} for r in s.itertuples()]
    growth = {"base_year": 2020, "population": hist[-1]["population"], "source_ref": "inegi_serie",
              "history": hist, "horizon_year": 2050, "population_horizon": None,
              "population_horizon_note_es": "Sin proyección con fuente en el acervo (CONAPO proyecciones municipales no descargadas). Se deja vacío por regla del contrato.",
              "floating_population": None,
              "floating_population_note_es": "Población flotante/turística sin cifra consolidada en el portal"}

    # 7. Request
    req = {
        "schema": "bcs.capacity_study.v0.1",
        "kind": "request",
        "study_id": cfg["study_id"],
        "municipio": cfg["label"], "municipio_id": muni_id,
        "crs": CRS, "units_of_measure": "m, m2",
        "created": TODAY, "lod_requested": "schematic",
        "question_es": "Capacidad de vivienda esquemática del municipio bajo restricciones ambientales, de escorrentía y agua, sin catastro.",
        "units": {"file": files["units"]["file"], "unit_kind": "analysis_grid_cell",
                  "note_es": "No hay predios en el acervo. Las celdas de 500 m son unidades de cálculo, no lotes."},
        "boundary": {"file": files["municipal_limit"]["file"], "source_ref": "inegi_mg2022"},
        "context": {k: v["file"] for k, v in files.items() if k in ("localities", "focus_belts_indicative")},
        "constraints": {k: {"file": v["file"], "role": None, "source_ref": None} for k, v in cons.items()},
        "growth": growth,
        "assumptions": ASSUMPTIONS,
        "required_response": {
            "schema": "bcs.capacity_study.v0.1", "kind": "response",
            "every_number_needs": "source_ref (key of sources) or assumption_ref (id in assumptions)",
            "leave_blank_if_unsourced": True,
            "forbidden_fields": ["prompt_version", "generator", "commission_id", "model", "tokens", "file paths", "module or app names"],
        },
    }
    roles = {"protected_areas": ("exclude_or_condition", "conanp_anp"), "poer_ugas": ("attribute", "poer"),
             "runoff_network": ("condition", "hydro_red"), "runoff_paths": ("context", "hydro_tray"),
             "flow_concentration": ("exclude_or_condition", "hydro_acc"), "coastline": ("reference", "osm_coast"),
             "aquifer_deficit": ("attribute", "conagua_dma")}
    for k, (r, s_) in roles.items():
        req["constraints"][k]["role"], req["constraints"][k]["source_ref"] = r, s_
    (out / "request.json").write_text(json.dumps(req, ensure_ascii=False, indent=1), encoding="utf-8")

    # 8. Manifest
    manifest = {
        "package": f"bcs_capacity_study_request/{muni_id}", "schema": "bcs.capacity_study.v0.1", "created": TODAY,
        "crs": CRS, "crs_note": "Todas las geometrías en EPSG:32612 (UTM 12N, metros). Coordenadas redondeadas a 0.1 m.",
        "files": {**{k: v for k, v in files.items()}, **{f"constraint:{k}": v for k, v in cons.items()},
                  "request": {"file": "request.json", "sha256": sha256(out / "request.json")}},
        "sources": SRC, "assumptions": ASSUMPTIONS,
        "figures": [
            {"label": "Población 2020", "value": growth["population"], "unit": "habitantes", "source_ref": "inegi_serie"},
            {"label": "Localidades ITER 2020", "value": len(locs), "unit": "localidades", "source_ref": "inegi_iter2020"},
            {"label": "Área municipal (MG2022, UTM 12N)", "value": round(lim_geom.area / 1e6, 2), "unit": "km²", "source_ref": "inegi_mg2022",
             "method": "Área planimétrica en EPSG:32612"},
        ] + [{"label": f"DMA acuífero {a['clave']} {a['nombre']}", "value": a["dma_hm3"], "unit": "hm³/año", "source_ref": "conagua_dma"} for a in aq_rows],
        "missing": [
            {"item": "Predios / catastro", "status": "no disponible en el acervo",
             "where": "Catastro municipal de Los Cabos (visor eCarto) — solo consulta en línea; solicitar capa por convenio o PNT",
             "url": "https://catastroloscabos.gob.mx/"},
            {"item": "Zonificación PDU 2040 (polígonos)", "status": "solo PDF en el acervo",
             "where": "IMPLAN Los Cabos — Visor Urbano / solicitar shapefile", "url": None},
            {"item": "Polígonos urbanos de localidad / AGEB urbanas", "status": "no en el acervo",
             "where": "INEGI Marco Geoestadístico (localidades urbanas, AGEB)", "url": "https://www.inegi.org.mx/temas/mg/"},
            {"item": "ZOFEMAT oficial", "status": "no en el acervo", "where": "SEMARNAT / DGZFMTAC", "url": None},
            {"item": "Zonas inundables oficiales (Atlas de Riesgo municipal / CENAPRED)", "status": "solo imágenes/PDF",
             "where": "IMPLAN Los Cabos, Atlas de Riesgo; Atlas de Riesgo de la UABCS", "url": "https://atlasriesgo.uabcs.mx/"},
            {"item": "Polígonos de acuíferos 0317/0319", "status": "no en el acervo", "where": "CONAGUA SIGA / SINA",
             "url": "https://sigagis.conagua.gob.mx/gas1/"},
            {"item": "Proyección de población 2050", "status": "no en el acervo", "where": "CONAPO proyecciones municipales",
             "url": "https://www.gob.mx/conapo"},
        ],
        "caveats_es": [
            "Las celdas de la retícula NO son predios; cualquier resultado es esquemático (lod=schematic).",
            "La concentración de flujo es un proxy de terreno (HydroSHEDS), no zona inundable oficial.",
            "Sin catastro, zonificación ni ZOFEMAT oficiales: el estudio no puede expresar capacidad legal por predio.",
            "Población residente 2020; sin población flotante/turística.",
        ],
    }
    assert_clean({k: v for k, v in manifest.items() if k != "files"}, "$manifest")
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"out": str(out), "files": {k: (v.get("features"), v.get("bytes")) for k, v in {**files, **cons}.items()}}, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "los_cabos")
