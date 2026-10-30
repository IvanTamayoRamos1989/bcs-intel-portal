#!/usr/bin/env python3
"""Build the /explorar territorial atlas data (split per layer, lazy-loaded).

Inputs (read-only): the territorial prototype (18_ux_territorial/prototype), INEGI ITER 2020,
the regional GIS atlas GeoPackage (14_gis_atlas), the runoff package already published under
public/gis/escorrentia, OSM transport nodes (public/gis) and portal JSON (src/data).
Outputs: public/explorar/data/*.json, public/explorar/terrain/z/x/y.png, vendor + fonts.

Rules enforced here (the build aborts on violation):
- no invented coordinates: points are written exactly as in the source; lines/polygons are
  topology-preserving simplifications whose vertices are a subset of the source vertices
  (checked vertex by vertex, tolerance 2e-5 degrees for the 5-decimal rounding);
- no clipping vertices: features are kept whole (no intersection with display boxes);
- every layer carries title, owner, date, licence, url, resolution, method and limits;
- no file paths or file names in any text shown to users.
"""
from __future__ import annotations
import base64, csv, hashlib, io, json, math, re, shutil, sqlite3, sys, zipfile
from collections import Counter, defaultdict
from pathlib import Path

from shapely import wkb, make_valid
from shapely.geometry import Polygon, shape, mapping, Point, box
from shapely.ops import transform, unary_union
from shapely.prepared import prep
from pyproj import Transformer

HUB = Path(__file__).resolve().parent.parent
BCSFP = HUB.parent
PROTO = BCSFP / '18_ux_territorial' / 'prototype'
OUT = HUB / 'public' / 'explorar'
DATA = OUT / 'data'
ITER = BCSFP / '05_demographics' / '2020-03-15_INEGI_Censo2020_ITER_BCS.zip'
GPKG = BCSFP / '14_gis_atlas' / 'BCS_regional.gpkg'
ESC = HUB / 'public' / 'gis' / 'escorrentia'
SRC = HUB / 'src' / 'data'

utm = Transformer.from_crs('EPSG:4326', 'EPSG:32612', always_xy=True).transform
geo = Transformer.from_crs('EPSG:32612', 'EPSG:4326', always_xy=True).transform

def js_payload(path: Path, var: str):
    text = path.read_text(encoding='utf-8')
    return json.loads(text.split(f'window.{var} = ', 1)[1].strip().rstrip(';'))

def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def rnd(v, nd):
    if isinstance(v, (list, tuple)):
        return [rnd(x, nd) for x in v]
    if isinstance(v, float):
        return round(v, nd)
    return v

def simplified(geom, metres):
    if not geom.is_valid:
        geom = make_valid(geom)
    if metres <= 0:
        return geom
    return transform(geo, transform(utm, geom).simplify(metres, preserve_topology=True))

def vertices(coords):
    if not coords:
        return
    if isinstance(coords[0], (int, float)):
        yield coords
        return
    for c in coords:
        yield from vertices(c)

class VertexIndex:
    def __init__(self):
        self.b = defaultdict(list)
    def add_geom(self, g):
        for x, y, *_ in vertices(g['coordinates'] if isinstance(g, dict) else mapping(g)['coordinates']):
            self.b[(round(x, 3), round(y, 3))].append((x, y))
    def has(self, x, y, tol=2e-5):
        kx, ky = round(x, 3), round(y, 3)
        for dx in (-0.001, 0, 0.001):
            for dy in (-0.001, 0, 0.001):
                for (ox, oy) in self.b.get((round(kx + dx, 3), round(ky + dy, 3)), ()):
                    if abs(ox - x) <= tol and abs(oy - y) <= tol:
                        return True
        return False

def assert_subset(layer_id, features, index):
    bad = 0
    total = 0
    for f in features:
        for x, y in vertices(f['geometry']['coordinates']):
            total += 1
            if not index.has(x, y):
                bad += 1
    if bad:
        raise SystemExit(f'{layer_id}: {bad}/{total} vertices are not source vertices — refusing to write')
    return total

# ---------------------------------------------------------------- base geography
G = js_payload(PROTO / 'geography.js', 'BCS_GEOGRAPHY')
boundary = make_valid(shape(G["boundary"]["features"][0]["geometry"])).buffer(0)
munis = [(f['properties']['name'], f['properties']['cvegeo'], shape(f['geometry'])) for f in G['municipalities']['features']]
muni_prep = [(n, c, prep(g)) for n, c, g in munis]
land_ctx = unary_union([shape(f['geometry']) for f in G['surroundingLand']['features']])

def muni_of_point(x, y):
    p = Point(x, y)
    for n, c, pg in muni_prep:
        if pg.covers(p):
            return n
    return None

def munis_touching(geom):
    return [n for n, c, pg in muni_prep if pg.intersects(geom)]

land_all = boundary.buffer(0).union(land_ctx.buffer(0))
frame = box(-118, 20, -106, 31.5)
sea = frame.difference(land_all)

base = {
    'boundary': G['boundary'],
    'municipalities': {'type': 'FeatureCollection', 'features': [
        {'type': 'Feature', 'id': i, 'properties': {'name': n, 'cvegeo': c}, 'geometry': f['geometry']}
        for i, ((n, c, _), f) in enumerate(zip(munis, G['municipalities']['features']))]},
    'land': G['surroundingLand'],
    'bounds': G['bounds'],
}
for k in ('boundary', 'municipalities', 'land'):
    for f in base[k]['features']:
        f['geometry']['coordinates'] = rnd(f['geometry']['coordinates'], 5)
bands = js_payload(PROTO / 'elevation-bands.js', 'BCS_ELEVATION_BANDS')
for f in bands['features']:
    f['geometry']['coordinates'] = rnd(f['geometry']['coordinates'], 4)
prov = G['provenance']
base_sources = [
    {'id': 'boundary', 'label': 'Límite estatal y municipios', 'title': 'Marco Geoestadístico 2022 · municipios de Baja California Sur', 'owner': 'INEGI / CONABIO',
     'date': '2022-12', 'license': 'INEGI · términos de libre uso de la información', 'url': 'https://www.inegi.org.mx/temas/mg/',
     'resolution': 'Simplificado ~39 m para visualización regional', 'method': 'Cinco polígonos municipales disueltos en el límite estatal; se conservan islas y huecos.',
     'limits': 'Límite geoestadístico de referencia; no acredita linderos legales.'},
    {'id': 'land', 'label': 'Tierra circundante', 'title': 'Natural Earth 1:10 millones · tierra física', 'owner': 'Natural Earth', 'date': 'v5', 'license': 'Dominio público',
     'url': 'https://www.naturalearthdata.com/', 'resolution': '1:10 000 000', 'method': 'Solo contexto alrededor de BCS.', 'limits': 'Costa generalizada; la costa de BCS usa INEGI.'},
    {'id': 'bands', 'label': 'Bandas de altitud', 'title': 'Bandas derivadas del modelo de elevación Terrarium (caché general)', 'owner': 'Tilezen / AWS Terrain Tiles (INEGI, USGS, NOAA y otros)',
     'date': 'caché 2026-10-08', 'license': 'Atribución según Tilezen joerd', 'url': 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
     'resolution': '~1.1 km por píxel a 25° N', 'method': 'Umbrales 150, 450, 900 y 1,500 m sobre el DEM de visión general.', 'limits': 'Codifican altitud; no vegetación ni uso del suelo. Se desvanecen al acercarse.'},
]

# ---------------------------------------------------------------- layers
layers = []
VERTS = {}

def add_layer(meta, features, index=None):
    for f in features:
        g = f['geometry']
        if g['type'] == 'Point':
            g['coordinates'] = rnd(g['coordinates'], 6)
        else:
            g['coordinates'] = rnd(g['coordinates'], 5)
    if index is not None and meta['geom'] != 'point':
        VERTS[meta['id']] = assert_subset(meta['id'], features, index)
    meta['count'] = len(features)
    meta['file'] = f"layer-{meta['id']}.json"
    body = {'type': 'FeatureCollection', 'features': features}
    txt = json.dumps(body, ensure_ascii=False, separators=(',', ':'))
    (DATA / meta['file']).write_text(txt, encoding='utf-8')
    meta['bytes'] = len(txt.encode('utf-8'))
    layers.append(meta)

def feat(key, name, props, geom_mapping):
    p = {k: v for k, v in props.items() if v is not None and v != ''}
    p['_k'] = key
    p['_n'] = name
    return {'type': 'Feature', 'id': key, 'properties': p, 'geometry': geom_mapping}

DATA.mkdir(parents=True, exist_ok=True)
for old in DATA.glob('layer-*.json'):
    old.unlink()

# 1. INEGI ITER 2020 localities
with zipfile.ZipFile(ITER) as z:
    name = [n for n in z.namelist() if n.lower().endswith('.csv') and 'conjunto_de_datos_iter' in n.lower()][0]
    table = z.read(name).decode('utf-8-sig')

def dms(text):
    nums = list(map(float, re.findall(r'\d+(?:\.\d+)?', text)))
    v = nums[0] + nums[1] / 60 + nums[2] / 3600
    return -v if ('W' in text or 'S' in text) else v

KEEP = ['ENTIDAD', 'MUN', 'LOC', 'NOM_LOC', 'NOM_MUN', 'POBTOT', 'ALTITUD', 'VIVTOT', 'VIVPAR_HAB', 'VPH_C_ELEC', 'VPH_S_ELEC',
        'VPH_AGUADV', 'VPH_AGUAFV', 'VPH_DRENAJ', 'VPH_NODREN', 'VPH_INTER', 'LONGITUD', 'LATITUD']
cities = []
iter_rows = 0
for row in csv.DictReader(io.StringIO(table)):
    if row['LOC'] in ('0000', '9998', '9999'):
        continue
    iter_rows += 1
    if not row['LONGITUD'] or not row['LATITUD']:
        continue
    props = {k: row[k] for k in KEEP}
    pop = int(row['POBTOT']) if row['POBTOT'].isdigit() else None
    props['pop'] = pop
    key = 'inegi-' + row['ENTIDAD'] + row['MUN'] + row['LOC']
    cities.append(feat(key, row['NOM_LOC'], props, {'type': 'Point', 'coordinates': [dms(row['LONGITUD']), dms(row['LATITUD'])]}))
assert len(cities) == iter_rows, 'every ITER locality must carry coordinates'
cities.sort(key=lambda f: -(f['properties'].get('pop') or 0))
add_layer({'id': 'cities', 'group': 'habitar', 'label': 'Ciudades y localidades', 'unit': 'localidades', 'geom': 'point', 'symbol': 'city',
           'source': {'title': 'Censo de Población y Vivienda 2020 · Integración territorial (ITER) BCS', 'owner': 'INEGI', 'date': '2020-03-15 (fecha censal)',
                      'license': 'INEGI · términos de libre uso de la información', 'url': 'https://www.inegi.org.mx/programas/ccpv/2020/#datos_abiertos',
                      'resolution': 'Punto de referencia por localidad (coordenada publicada en grados, minutos y segundos)',
                      'method': 'Todas las localidades con coordenadas publicadas; conversión DMS → grados decimales sin desplazar puntos.',
                      'limits': 'Puntos de referencia censal, no límites urbanos ni edificios. Población 2020; no es proyección 2050.'}}, cities)

# 2. GeoPackage polygons
conn = sqlite3.connect(GPKG)
conn.row_factory = sqlite3.Row
def gpkg_geom(data):
    e = (data[3] >> 1) & 7
    return wkb.loads(bytes(data[8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[e]:]))

ENC_FIX = {'Vizca¡no': 'Vizcaíno'}
def fix_name(s):
    s = str(s or '').strip()
    for a, b in ENC_FIX.items():
        s = s.replace(a, b)
    return s

POLY = [
    ('protected', 'agua', 'Áreas naturales protegidas federales', 'áreas', 'anp_federales', 'NOMBRE', 'ID_ANP', 15,
     {'title': 'Áreas naturales protegidas federales', 'owner': 'CONANP / CONABIO', 'date': '2025-04 (copia del atlas regional)', 'license': 'Información pública federal',
      'url': 'https://sig.conanp.gob.mx/', 'resolution': 'Polígonos oficiales simplificados 15 m', 'method': 'Polígonos completos del atlas regional, sin recorte; simplificación topológica 15 m (UTM 12N).',
      'limits': 'No incluye subzonificación ni reglas de manejo; varias áreas son mayormente marinas (se indica en cada ficha). Consultar el decreto vigente.'}),
    ('priority', 'agua', 'Regiones terrestres prioritarias', 'regiones', 'rtp_conabio', 'NOMBRE', 'CLAVE', 25,
     {'title': 'Regiones terrestres prioritarias de México', 'owner': 'CONABIO', 'date': '2004', 'license': 'CONABIO · uso no lucrativo con atribución (ver geoportal)',
      'url': 'http://www.conabio.gob.mx/informacion/gis/', 'resolution': 'Escala de origen 1:1 000 000; simplificado 25 m', 'method': 'Polígonos completos del atlas regional; simplificación topológica 25 m.',
      'limits': 'Prioridad de conservación; no equivale a un decreto de área natural protegida. Un nombre del archivo trae un error de codificación (Vizca¡no); se muestra corregido y el valor original se conserva.'}),
    ('zoning', 'ordenar', 'Unidades de gestión ambiental POERBCS', 'polígonos', 'poer_ugas', 'NOMBRE_UGA', 'CLAVE_UGA', 25,
     {'title': 'Programa de Ordenamiento Ecológico Regional de BCS (POERBCS) · UGA', 'owner': 'Gobierno de BCS / SEMARNAT (atlas regional del portal)', 'date': 'Capa del atlas regional (fecha de la capa sin registrar)',
      'license': 'Información pública', 'url': 'https://www.gob.mx/semarnat/acciones-y-programas/programas-de-ordenamiento-ecologico-expedidos',
      'resolution': 'Simplificado 25 m', 'method': '69 polígonos = 56 claves UGA (la UGA 54 se divide en 14 polígonos 54_xx). Simplificación topológica 25 m.',
      'limits': 'Consultar el instrumento publicado y sus criterios antes de interpretar una UGA como permiso de uso.'}),
    ('agrarian', 'ordenar', 'Núcleos agrarios', 'núcleos', 'ran_nucleos', 'NOM_NUC', 'Clv_Unica', 15,
     {'title': 'Núcleos agrarios (perímetros)', 'owner': 'Registro Agrario Nacional (RAN)', 'date': 'Capa del atlas regional (fecha de corte sin registrar)', 'license': 'Información pública (RAN datos abiertos)',
      'url': 'https://datos.gob.mx/busca/organization/ran', 'resolution': 'Simplificado 15 m', 'method': 'Perímetros del atlas regional (origen KML RAN); simplificación topológica 15 m.',
      'limits': 'No acredita propiedad, derechos ni deslindes vigentes; requiere consulta registral.'}),
]
DROP_COLS = {'geom', 'fid', 'description', 'timestamp', 'begin', 'end', 'altitudeMode', 'tessellate', 'extrude', 'visibility', 'drawOrder', 'icon', 'COV_', 'COV_ID'}
for lid, group, label, unit, table, name_f, key_f, tol, source in POLY:
    feats = []
    idx = VertexIndex()
    for row in conn.execute(f'SELECT * FROM "{table}"'):
        g = gpkg_geom(row['geom'])
        if not g.is_valid:
            g = make_valid(g)
        if g.geom_type == 'GeometryCollection':
            g = unary_union([p for p in g.geoms if p.geom_type in ('Polygon', 'MultiPolygon')])
        idx.add_geom(g)
        props = {k: row[k] for k in row.keys() if k not in DROP_COLS}
        name = fix_name(props.get(name_f) or props.get('Name') or '')
        if lid == 'zoning':
            name = f"UGA {props['CLAVE_UGA']} · {name}" if name and not name.upper().startswith('UGA') else (name or f"UGA {props['CLAVE_UGA']}")
        land_share = g.intersection(land_all).area / g.area if g.area else 1
        props['_marine'] = max(0.0, round(1 - land_share, 3))
        mz = munis_touching(g)
        props['_munis'] = mz
        key = f"{lid}-{props.get(key_f) or row['fid']}-{row['fid']}"
        s = simplified(g, tol)
        feats.append(feat(key, name or f'{label} {row["fid"]}', props, mapping(s)))
    add_layer({'id': lid, 'group': group, 'label': label, 'unit': unit, 'geom': 'polygon', 'source': source}, feats, idx)

# 3. OSM roads (whole ways that touch BCS; no clipping)
raw_path = PROTO / '_spatial_sources' / 'roads-overpass.json'
raw = json.loads(raw_path.read_text(encoding='utf-8'))
allowed = {'motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link'}
region = prep(boundary.buffer(0.0003))
roads, ridx = [], VertexIndex()
from shapely.geometry import LineString
RANK = {'motorway': 1, 'trunk': 1, 'primary': 2, 'secondary': 3}
for el in raw['elements']:
    t = el.get('tags', {})
    if t.get('highway') not in allowed:
        continue
    co = [(p['lon'], p['lat']) for p in el.get('geometry', [])]
    if len(co) < 2:
        continue
    line = LineString(co)
    if not region.intersects(line):
        continue
    ridx.add_geom(line)
    nm = t.get('name') or (f"Carretera {t['ref']}" if t.get('ref') else 'Tramo vial sin nombre en OSM')
    props = dict(t)
    props.update({'osm_id': el['id'], 'osm_url': f"https://www.openstreetmap.org/way/{el['id']}", '_rank': RANK.get(t['highway'].replace('_link', ''), 3),
                  '_munis': munis_touching(line)})
    roads.append(feat(f"osm-way-{el['id']}", nm, props, mapping(simplified(line, 5))))
snap = raw.get('osm3s', {}).get('timestamp_osm_base', '')
add_layer({'id': 'roads', 'group': 'habitar', 'label': 'Carreteras principales', 'unit': 'segmentos', 'geom': 'line',
           'source': {'title': 'OpenStreetMap · vías motorway, trunk, primary y secondary', 'owner': '© Colaboradores de OpenStreetMap', 'date': snap[:10] or '2026-10-08',
                      'license': 'ODbL 1.0', 'url': 'https://www.openstreetmap.org/copyright', 'resolution': 'Vías completas; simplificación 5 m',
                      'method': 'Consulta Overpass; se conservan las vías completas que tocan BCS (sin recortes) y todas sus etiquetas.',
                      'limits': 'Cartografía comunitaria: completitud y clasificación variables; omite calles locales y caminos menores. No es inventario oficial de SICT.'}}, roads, ridx)

# 4. HydroRIVERS drainage + D8 flow paths (runoff package)
for lid, fname, label, unit, tol, src in [
    ('rivers', 'red_drenaje.geojson', 'Red de drenaje modelada', 'tramos', 20,
     {'title': 'HydroRIVERS v1 · recorte del paquete Escorrentía BCS 2026', 'owner': 'WWF / HydroSHEDS (Lehner y Grill 2013)', 'date': '2026-10-05 (paquete)',
      'license': 'HydroSHEDS · licencia libre con atribución', 'url': 'https://www.hydrosheds.org/products/hydrorivers',
      'resolution': 'Derivado de HydroSHEDS 15″ (~500 m); simplificación 20 m',
      'method': '2,981 partes de línea = 2,900 tramos únicos (HYRIV_ID). Orden Strahler ≥ 3 a escala estatal; todos los tramos al acercarse.',
      'limits': 'Red modelada: no demuestra agua permanente, caudal actual ni nombres oficiales. No es mapa de inundación.'}),
    ('runoff', 'trayectorias.geojson', 'Trayectorias de escorrentía (modelo de terreno)', 'trayectorias', 20,
     {'title': 'Trayectorias D8 de escorrentía potencial · paquete Escorrentía BCS 2026', 'owner': 'HydroSHEDS DIR 3″ (WWF); trazado del paquete Escorrentía BCS', 'date': '2026-10-05',
      'license': 'HydroSHEDS · licencia libre con atribución', 'url': 'https://www.hydrosheds.org/',
      'resolution': 'Dirección de flujo 3″ (~90 m); semillas cada ~3.7–4.2 km; simplificación 20 m',
      'method': 'Recorridos D8 desde una retícula uniforme de semillas hasta la costa o un sumidero interior.',
      'limits': 'Modelo de terreno, NO es mapa oficial de inundación: no calcula profundidad, velocidad, caudal ni superficie inundada. No modela drenaje urbano.'}),
]:
    d = json.loads((ESC / fname).read_text(encoding='utf-8'))
    out, idx = [], VertexIndex()
    for i, f in enumerate(d['features']):
        g = shape(f['geometry'])
        idx.add_geom(g)
        p = dict(f['properties'])
        if lid == 'rivers':
            nm = f"Cauce modelado · orden Strahler {p.get('ORD_STRA', 's/d')}"
            key = f"hyriv-{p.get('HYRIV_ID', i)}-{i}"
        else:
            end = {'salida_costera': 'salida a la costa', 'sumidero_interior': 'sumidero interior'}.get(p.get('END_TYPE'), p.get('END_TYPE'))
            nm = f"Trayectoria de escorrentía {p.get('PATH_ID', i)} · {end}"
            key = f"d8-{p.get('PATH_ID', i)}-{i}"
        p['_munis'] = munis_touching(g)
        out.append(feat(key, nm, p, mapping(simplified(g, tol))))
    add_layer({'id': lid, 'group': 'agua', 'label': label, 'unit': unit, 'geom': 'line', 'source': src,
               'portal': {'href': '/agua/escorrentia/', 'label': 'Escorrentía y agua de lluvia'}}, out, idx)

# 5. OSM electricity (prototype extract, original OSM coordinates)
E = js_payload(PROTO / 'energy-layers.js', 'BCS_ENERGY_LAYERS')
esrc = E['layers'][0]['source']
ELAB = {'plants': ('Centrales eléctricas', 'centrales', 'plant'), 'substations': ('Subestaciones', 'subestaciones', 'transformer'),
        'transmission': ('Líneas eléctricas', 'líneas', None), 'generators': ('Generadores', 'generadores', 'generator')}
UNNAMED = {'plants': 'Central sin nombre', 'substations': 'Subestación sin nombre', 'transmission': 'Línea eléctrica sin nombre', 'generators': 'Generador sin nombre'}
for lay in E['layers']:
    lid = lay['id']
    label, unit, sym = ELAB[lid]
    feats = []
    for f in lay['geometry']['features']:
        p = {k: v for k, v in f['properties'].items() if not k.startswith('_')}
        key = f['properties']['_key']
        osm_type, osm_num = key.split('-')[1], key.split('-')[2]
        p['osm_id'] = f'{osm_type}/{osm_num}'
        p['osm_url'] = f['properties'].get('_sourceUrl')
        p['osm_edit'] = (f['properties'].get('_sourceDate') or '')[:10]
        nm = p.get('name:es') or p.get('name')
        if not nm:
            nm = f"{UNNAMED[lid]} (OSM {osm_num})"
        g = shape(f['geometry'])
        rp = g if g.geom_type == 'Point' else g.representative_point()
        p['_munis'] = munis_touching(g)
        if g.geom_type == 'Point':
            # original OSM node coordinate (generator node or, for one relation, its member generator node)
            p['_geom_note'] = f['properties'].get('_precision') if key.startswith('osm-relation') else 'Nodo OSM original: coordenada puntual publicada en OpenStreetMap.'
        feats.append(feat(key, nm, p, f['geometry']))
    geomkind = 'line' if lid == 'transmission' else 'facility'
    src = {'title': f'OpenStreetMap · power={ {"plants":"plant","substations":"substation","transmission":"line","generators":"generator"}[lid] }',
           'owner': '© Colaboradores de OpenStreetMap', 'date': esrc['date'][:10], 'license': 'ODbL 1.0', 'url': 'https://www.openstreetmap.org/copyright',
           'resolution': 'Coordenadas OSM originales; sin simplificar',
           'method': 'Objetos etiquetados power=plant/substation/line/generator dentro del límite INEGI de BCS. Las líneas que cruzan el límite conservan solo sus vértices OSM interiores; no se interpolan conexiones.',
           'limits': 'Cartografía comunitaria, PARCIAL y no certificada: no es el inventario oficial de CFE/CENACE. Tensión y potencia son etiquetas OSM sin verificar.'
                     + (' Un generador puede formar parte de una central: no se suman como centrales.' if lid in ('generators', 'plants') else '')}
    add_layer({'id': lid, 'group': 'habitar', 'label': label, 'unit': unit, 'geom': geomkind, 'symbol': sym, 'partial': True, 'source': src}, feats)

# 6. OSM transport nodes (airports, ferry terminals, harbours)
tn = json.loads((HUB / 'public' / 'gis' / 'osm_transport_nodes.geojson').read_text(encoding='utf-8'))
KIND = {'aerodrome': 'Aeródromo / aeropuerto', 'ferry_terminal': 'Terminal de transbordador', 'harbour': 'Puerto'}
tfeats = []
near = prep(boundary.buffer(0.02))
# 6a. OSM aerodrome polygons (ways + Loreto multipolygon), Overpass 2026-10-08 — original vertices, no simplification
from shapely.ops import linemerge, polygonize, unary_union
AERO = json.loads(Path('/workspace/BCSFP/14_gis_atlas/osm_aerodromes_bcs_overpass_20261008.json').read_text(encoding='utf-8'))
AERO_REL = json.loads(Path('/workspace/BCSFP/14_gis_atlas/osm_aerodrome_lto_relation_overpass_20261008.json').read_text(encoding='utf-8'))
AERO_TS = (AERO.get('osm3s') or {}).get('timestamp_osm_base', '')[:10]
aero_polys = []
for e in AERO['elements'] + AERO_REL['elements']:
    if e['type'] == 'way':
        ring = [[round(pt['lon'], 7), round(pt['lat'], 7)] for pt in e.get('geometry', [])]
        if len(ring) < 4 or ring[0] != ring[-1]:
            continue
        geom = make_valid(Polygon(ring))
    elif e['type'] == 'relation' and e.get('members'):
        lines = [[(round(pt['lon'], 7), round(pt['lat'], 7)) for pt in m['geometry']] for m in e['members'] if m.get('role') == 'outer' and m.get('geometry')]
        polys = list(polygonize(linemerge(lines)))
        if not polys:
            continue
        geom = unary_union(polys)
    else:
        continue
    if not geom.intersects(boundary.buffer(0.02)):
        continue
    t = e.get('tags', {})
    pp = {k: v for k, v in t.items() if k in ('aeroway', 'name', 'name:es', 'name:en', 'iata', 'icao', 'operator', 'ele', 'aerodrome:type', 'aerodrome', 'surface')}
    pp['kind'] = 'aerodrome'; pp['tipo'] = 'Aeródromo / aeropuerto (polígono)'
    pp['osm_id'] = f"{e['type']}/{e['id']}"; pp['osm_url'] = f"https://www.openstreetmap.org/{e['type']}/{e['id']}"
    pp['osm_snapshot'] = AERO_TS
    pp['_munis'] = munis_touching(geom)
    if not pp['_munis']:
        pp['_geom_note'] = 'El polígono OSM queda fuera del límite estatal INEGI de BCS; se muestra como contexto inmediato junto al límite.'
    nm = t.get('name:es') or t.get('name') or f"Aeródromo sin nombre (OSM {e['id']})"
    gm = mapping(geom)
    gm = json.loads(json.dumps(gm))
    def _r(c):
        return [round(c[0], 6), round(c[1], 6)] if isinstance(c[0], (int, float)) else [_r(x) for x in c]
    gm['coordinates'] = _r(gm['coordinates'])
    aero_polys.append((geom, feat(f"osm-{e['type']}-{e['id']}", nm, pp, gm)))
tfeats.extend(f for _, f in aero_polys)
aero_union = prep(unary_union([g for g, _ in aero_polys])) if aero_polys else None
dropped_dupes = 0
for f in tn['features']:
    x, y = f['geometry']['coordinates'][:2]
    if not near.covers(Point(x, y)):
        continue
    if aero_union is not None and f['properties'].get('kind') == 'aerodrome' and aero_union.covers(Point(x, y)):
        dropped_dupes += 1   # same aerodrome already drawn with its OSM polygon
        continue
    p = dict(f['properties'])
    p['tipo'] = KIND.get(p.get('kind'), p.get('kind'))
    if p.get('osm_id'):
        p['osm_url'] = f"https://www.openstreetmap.org/node/{p['osm_id']}"
    nm = p.get('name') or f"{p['tipo']} sin nombre (OSM {p.get('osm_id')})"
    p['_munis'] = [m for m in [muni_of_point(x, y)] if m]
    p['_geom_note'] = 'Nodo OSM original: coordenada puntual publicada en OpenStreetMap.'
    tfeats.append(feat(f"osm-tr-{p.get('osm_id') or len(tfeats)}", nm, p, {'type': 'Point', 'coordinates': [x, y]}))
add_layer({'id': 'transport', 'group': 'habitar', 'label': 'Aeropuertos y puertos', 'unit': 'elementos', 'geom': 'facility', 'symbol': 'transport', 'partial': True,
           'source': {'title': 'OpenStreetMap · aeródromos, terminales de transbordador y puertos', 'owner': '© Colaboradores de OpenStreetMap', 'date': f'nodos 2026-09 (extracción del portal) · polígonos de aeródromo {AERO_TS} (Overpass)',
                      'license': 'ODbL 1.0', 'url': 'https://www.openstreetmap.org/copyright', 'resolution': 'Polígono OSM del aeródromo (vértices originales) o nodo OSM (punto)',
                      'method': f'{len(aero_polys)} polígonos aeroway=aerodrome que tocan BCS (incluye los aeropuertos SJD, LAP, LTO, CSL y Guerrero Negro) + nodos OSM aeroway=aerodrome, amenity=ferry_terminal y harbour dentro de BCS (tolerancia costera ~2 km). Se omiten {dropped_dupes} nodos de aeródromo que caen dentro de un polígono ya dibujado.',
                      'limits': 'Incluye pistas menores; no distingue operación comercial. Rutas aéreas en /vuelos (FlightConnections).'},
           'portal': {'href': '/vuelos/', 'label': 'Vuelos y conectividad aérea'}}, tfeats)

# ---------------------------------------------------------------- energy names cleanup check
for l in layers:
    if l['id'] in ('substations', 'plants', 'generators', 'transmission'):
        pass

# ---------------------------------------------------------------- terrain cache → PNG tiles
T = js_payload(PROTO / 'terrain-cache.js', 'BCS_TERRAIN')
tdir = OUT / 'terrain'
if tdir.exists():
    shutil.rmtree(tdir)
for key, b64 in T['tiles'].items():
    z, x, y = key.split('/')
    p = tdir / z / x
    p.mkdir(parents=True, exist_ok=True)
    (p / f'{y}.png').write_bytes(base64.b64decode(b64))
terrain_keys = sorted(T['tiles'].keys())

# ---------------------------------------------------------------- vendor + fonts
(OUT / 'vendor').mkdir(exist_ok=True)
for n in ('maplibre-gl.js', 'maplibre-gl.css'):
    shutil.copy2(PROTO / 'vendor' / n, OUT / 'vendor' / n)
(OUT / 'fonts').mkdir(exist_ok=True)
for i in range(4):
    shutil.copy2(PROTO / 'fonts' / f'font-{i}.ttf', OUT / 'fonts' / f'dmsans-{[400,500,600,700][i]}.ttf')

# ---------------------------------------------------------------- knowledge: unlocated, topics, relations
aq = json.loads((SRC / 'aquifers_bcs.json').read_text(encoding='utf-8'))
unlocated = []
for a in aq['aquifers']:
    mun = ', '.join(a.get('municipios') or []) or 'Municipio por confirmar en la fuente'
    unlocated.append({'id': f"aq-{a['clave']}", 'kind': 'Acuífero', 'name': f"Acuífero {a['nombre']} ({a['clave']})", 'muni': a.get('municipio_texto') or mun,
                      'metric': f"DMA {a['dma_hm3']:+.2f} hm³/año".replace('.', '.'), 'status': a.get('status'),
                      'reason': 'Sin polígono oficial del acuífero en el acervo: no se dibuja ni se asigna a geometrías municipales.',
                      'source': a.get('source'), 'href': '/agua/#acuiferos', 'topic': 'agua'})
fp = json.loads((SRC / 'federal_projects.json').read_text(encoding='utf-8'))
for p in fp['projects']:
    unlocated.append({'id': p['id'], 'kind': 'Proyecto federal', 'name': p.get('proyecto') or p.get('name') or p['id'], 'muni': p.get('municipio(s)') or p.get('municipios_raw') or 'BCS', 'ref': p['id'],
                      'metric': p.get('capacidad/alcance') or '', 'date': p.get('fecha_anuncio') or '', 'owner': p.get('dependencia') or '', 'url': p.get('fuente_principal_url') or '',
                      'status': p.get('estado'), 'reason': 'El inventario solo da una referencia municipal aproximada; no hay geometría confirmada de la obra.',
                      'source': 'Inventario de proyectos federales BCS 2050', 'href': f"/proyectos-federales/?q={p['id']}", 'topic': 'proyectos'})
for u in E['unlocated']:
    unlocated.append({'id': u['id'], 'kind': 'Infraestructura eléctrica documentada', 'name': u['name'], 'muni': 'Municipio sin verificar',
                      'reason': u['reason'], 'source': (u.get('source') or {}).get('title', '').replace('BCS2050 · ', ''), 'url': (u.get('source') or {}).get('url'), 'href': '/energia/', 'topic': 'energia'})

def load(n):
    return json.loads((SRC / f'{n}.json').read_text(encoding='utf-8'))

M = load('municipios')
STUDIO = {'Los Cabos': 'los_cabos', 'La Paz': 'la_paz', 'Loreto': 'loreto', 'Comondú': 'comondu', 'Mulegé': 'mulege'}
PLACE = {'Los Cabos': 'los_cabos', 'La Paz': 'la_paz', 'Loreto': 'loreto', 'Comondú': 'comondu', 'Mulegé': 'mulege_north'}
municipal = {}
for n, d in M.items():
    municipal[n] = {'name': n, 'cve': d.get('cve'), 'pop': d.get('pob'), 'locs': d.get('locs'), 'cabecera': d.get('cabecera'), 'cab_pop': d.get('cab_pob'),
                    'strengths': d.get('strengths_es'), 'locks': d.get('locks_es'), 'studio': f"/studio/{STUDIO[n]}/", 'place': PLACE[n],
                    'source': 'INEGI Censo 2020 (población); fichas municipales del portal'}

SECTIONS = [
  # id, title, href, group, blurb, layers
  ('agua', 'Agua', '/agua/', 'Agua y vida', 'Disponibilidad de acuíferos (DMA), desalación y abastecimiento.', ['rivers', 'runoff']),
  ('escorrentia', 'Escorrentía y agua de lluvia', '/agua/escorrentia/', 'Agua y vida', 'Red de drenaje y trayectorias de escorrentía: modelo de terreno, no mapa de inundación.', ['rivers', 'runoff']),
  ('acuiferos', 'Acuíferos (DOF 2023)', '/agua/#acuiferos', 'Agua y vida', f"{len(aq['aquifers'])} acuíferos de BCS con su balance administrativo; sin polígonos oficiales en el acervo.", []),
  ('ambiente', 'Ambiente y conservación', '/ambiente/', 'Agua y vida', 'Áreas protegidas, regiones prioritarias, costa.', ['protected', 'priority']),
  ('energia', 'Energía', '/energia/', 'Habitar y conectar', 'Sistema eléctrico aislado de BCS (SIBCS), generación y transmisión.', ['plants', 'substations', 'transmission', 'generators']),
  ('conectividad', 'Conectividad', '/conectividad/', 'Habitar y conectar', 'Carreteras, puertos y aeropuertos.', ['roads', 'transport']),
  ('vuelos', 'Vuelos', '/vuelos/', 'Habitar y conectar', 'Destinos sin escalas desde SJD, LAP y LTO (FlightConnections).', ['transport']),
  ('puertos', 'Puertos', '/puertos/', 'Habitar y conectar', 'Puertos y demanda.', ['transport']),
  ('territorio', 'Territorio', '/territorio/', 'Ordenar el territorio', 'Geografía, municipios y demografía.', ['cities']),
  ('planeacion', 'Planeación', '/planeacion/', 'Ordenar el territorio', 'POERBCS, PDU, POEL y otros instrumentos.', ['zoning']),
  ('planes-archivo', 'Archivo de planes', '/planes-archivo/', 'Ordenar el territorio', 'Instrumentos de planeación archivados.', []),
  ('catastro', 'Catastro', '/catastro/', 'Ordenar el territorio', 'IMPLAN y catastro municipal.', ['agrarian']),
  ('riesgos', 'Riesgos', '/riesgos/', 'Ordenar el territorio', 'Amenazas, ciclones, sismos e inundaciones (documental).', ['runoff']),
  ('economia', 'Economía', '/economia/', 'Economía y sociedad', 'Inversión, empleo y sectores.', []),
  ('turismo', 'Turismo', '/turismo/', 'Economía y sociedad', 'Oferta, ocupación y destinos.', []),
  ('inmobiliario', 'Inmobiliario', '/inmobiliario/', 'Economía y sociedad', 'Reportes de mercado con fuentes nombradas; no es recomendación de inversión.', []),
  ('fiscal', 'Fiscal', '/fiscal/', 'Economía y sociedad', 'Ingresos y finanzas públicas.', []),
  ('comunidades', 'Comunidades', '/comunidades/', 'Economía y sociedad', 'Localidades y perfiles municipales.', ['cities']),
  ('historia', 'Historia', '/historia/', 'Economía y sociedad', 'Cronología y narrativas locales.', []),
  ('proyectos', 'Proyectos federales', '/proyectos-federales/', 'Proyectos y horizonte 2050', f"Inventario de {fp.get('count', len(fp['projects']))} proyectos; ubicación solo municipal (Información por ubicar).", []),
  ('foresights', 'Prospectiva', '/foresights/', 'Proyectos y horizonte 2050', 'Vocaciones de lugar y señales semanales. Lectura de horizonte, no pronóstico.', []),
  ('crecimiento', 'Crecimiento demanda–oferta', '/crecimiento/', 'Proyectos y horizonte 2050', 'Presión frente a capacidad por lugar.', []),
  ('preguntas', 'Preguntas estratégicas', '/preguntas/', 'Proyectos y horizonte 2050', 'Preguntas de estrategia con evidencia y supuestos separados.', []),
  ('resumen', 'Resumen', '/resumen/', 'Conocimiento y fuentes', 'Tablero de cifras clave de BCS.', []),
  ('studio', 'Fichas municipales', '/studio/', 'Conocimiento y fuentes', 'Cifras clave, agua, planes y expediente por municipio.', ['cities']),
  ('lugares', 'Lugares', '/lugares/', 'Conocimiento y fuentes', 'Lugares y vocaciones.', ['cities']),
  ('ontologia', 'Ontología', '/ontologia/', 'Conocimiento y fuentes', 'Entidades del programa y sus relaciones explícitas.', []),
  ('stakeholders', 'Actores y mesas de trabajo', '/stakeholders/', 'Conocimiento y fuentes', 'Directorio de actores institucionales y mesas de trabajo.', []),
  ('catalogo', 'Catálogo de documentos', '/catalogo/', 'Conocimiento y fuentes', 'Inventario de documentos del acervo con descarga.', []),
  ('biblioteca', 'Biblioteca', '/biblioteca/', 'Conocimiento y fuentes', 'Referencias y lecturas indexadas.', []),
  ('noticias', 'Noticias', '/noticias/', 'Conocimiento y fuentes', 'Notas de prensa recientes (no son dato oficial).', []),
  ('memoria', 'Memoria y datos pendientes', '/memoria/', 'Conocimiento y fuentes', 'Brechas de datos y documentos solicitados.', []),
  ('mapas', 'Mapas (vista anterior)', '/mapas/', 'Conocimiento y fuentes', 'Mapa interactivo y galería de mapas escaneados.', []),
  ('stills', 'Fotos del territorio', '/stills/', 'Conocimiento y fuentes', 'Fotografías aéreas por ubicación de cámara (no son capas cartográficas).', []),
]
topics = [{'id': s[0], 'title': s[1], 'href': s[2], 'group': s[3], 'text': s[4], 'layers': s[5], 'kind': 'Tema'} for s in SECTIONS]

items = []  # extra searchable knowledge
for q in load('strategic_questions')['questions']:
    items.append({'kind': 'Pregunta estratégica', 'title': q['question_es'], 'href': f"/preguntas/{q['id']}/", 'topic': 'preguntas',
                  'munis': [k for k, v in PLACE.items() if v in (q.get('places') or [])]})
for p in load('foresights')['places']:
    items.append({'kind': 'Vocación de lugar (prospectiva)', 'title': p['name_es'], 'text': p.get('vocation_es', ''), 'href': f"/foresights/?place={p['id']}", 'topic': 'foresights'})
for n in sorted(load('news')['items'], key=lambda x: x.get('date', ''), reverse=True):
    items.append({'kind': 'Noticia', 'title': n.get('title_es') or n.get('title_en'), 'text': f"{n.get('source', '')} · {n.get('date', '')}", 'url': n.get('url'), 'href': '/noticias/', 'topic': 'noticias'})
for g in load('data_gaps')['gaps']:
    items.append({'kind': 'Dato pendiente', 'title': g.get('topic'), 'text': (g.get('detail_es') or '')[:180], 'href': '/memoria/', 'topic': 'memoria'})
for m in load('mesas_trabajo')['mesas']:
    items.append({'kind': 'Mesa de trabajo', 'title': f"Mesa: {m.get('nombre')}", 'href': '/stakeholders/', 'topic': 'stakeholders'})
gr = load('graph')
for nd in gr['nodes']:
    if nd.get('type') in ('Person',):
        continue
    items.append({'kind': f"Ontología · {nd.get('type')}", 'title': nd.get('label'), 'text': (nd.get('summary') or '')[:160], 'href': f"/ontologia/#{nd['id']}", 'topic': 'ontologia'})
lib = load('library')
for it in lib['items']:
    items.append({'kind': 'Biblioteca', 'title': it.get('title'), 'text': f"{it.get('org', '')} {it.get('year', '')}".strip(), 'url': it.get('url'), 'href': '/biblioteca/', 'topic': 'biblioteca'})

# Explicit editorial relations (declared here, never inferred from distance)
relations = {
    'layer': {
        'cities': [('topic', 'territorio', 'Contexto territorial'), ('topic', 'comunidades', 'Perfiles de localidades'), ('topic', 'studio', 'Ficha del municipio (atributo NOM_MUN)')],
        'roads': [('topic', 'conectividad', 'Red vial y conectividad')],
        'transport': [('topic', 'vuelos', 'Rutas aéreas sin escalas'), ('topic', 'puertos', 'Puertos y demanda')],
        'plants': [('topic', 'energia', 'Sistema eléctrico SIBCS'), ('layer', 'generators', 'Generadores (pueden formar parte de una central)')],
        'substations': [('topic', 'energia', 'Sistema eléctrico SIBCS'), ('topic', 'memoria', 'Brecha: inventario oficial de subestaciones')],
        'transmission': [('topic', 'energia', 'Sistema eléctrico SIBCS')],
        'generators': [('topic', 'energia', 'Sistema eléctrico SIBCS'), ('layer', 'plants', 'Centrales eléctricas')],
        'rivers': [('topic', 'escorrentia', 'Modelo de escorrentía'), ('layer', 'runoff', 'Trayectorias de escorrentía'), ('topic', 'acuiferos', 'Acuíferos (registros sin polígono)')],
        'runoff': [('topic', 'escorrentia', 'Modelo de escorrentía'), ('topic', 'riesgos', 'Riesgos (documental)')],
        'protected': [('topic', 'ambiente', 'Conservación'), ('layer', 'zoning', 'UGA del POERBCS')],
        'priority': [('topic', 'ambiente', 'Conservación'), ('layer', 'protected', 'Áreas protegidas federales')],
        'zoning': [('topic', 'planeacion', 'Instrumentos de planeación'), ('topic', 'planes-archivo', 'Archivo de planes')],
        'agrarian': [('topic', 'catastro', 'Catastro y tenencia'), ('topic', 'planeacion', 'Planeación')],
    },
    'note': 'Relaciones editoriales declaradas en los datos. Ninguna se infiere por cercanía; los vínculos a municipios usan el atributo municipal de la fuente o un cruce espacial con los polígonos INEGI.'
}

knowledge = {'topics': topics, 'items': items, 'unlocated': unlocated, 'municipal': municipal, 'relations': relations,
             'studies_enabled': False}
(DATA / 'knowledge.json').write_text(json.dumps(knowledge, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
# orientation labels on the opening view: the largest INEGI localities (exact census coordinates)
base['majorCities'] = {'type': 'FeatureCollection', 'features': [
    {'type': 'Feature', 'properties': {'_k': f['properties']['_k'], '_n': f['properties']['_n'], 'pop': f['properties']['pop']}, 'geometry': f['geometry']}
    for f in cities if (f['properties'].get('pop') or 0) >= 4000]}
(DATA / 'bands.json').write_text(json.dumps(bands, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
(DATA / 'base.json').write_text(json.dumps(base, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

# compact search index for every spatial record (loaded on first search / inventory)
order = [l['id'] for l in layers]
rows = []
for l in layers:
    feats = json.loads((DATA / l['file']).read_text(encoding='utf-8'))['features']
    for f in feats:
        p = f['properties']
        muni = p.get('NOM_MUN') or p.get('UGA_MUN') or p.get('MUNICIPIO') or ', '.join(p.get('_munis') or [])
        ref = p.get('ref') or p.get('CLAVE_UGA') or p.get('Clv_Unica') or p.get('iata') or p.get('icao') or p.get('osm_id') or p.get('LOC') or ''
        cat = p.get('highway') or p.get('CAT_MANEJO') or p.get('substation') or p.get('plant:source') or p.get('generator:source') or p.get('tipo') or ''
        rows.append([order.index(l['id']), p['_k'], p['_n'], muni, str(ref), str(cat), p.get('pop') or 0])
(DATA / 'index.json').write_text(json.dumps({'layers': order, 'rows': rows}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

manifest = {
    'version': 2, 'built': '2026-10-08', 'crs': 'EPSG:4326',
    'groups': [{'id': 'habitar', 'label': 'Habitar y conectar'}, {'id': 'agua', 'label': 'Agua y vida'}, {'id': 'ordenar', 'label': 'Ordenar el territorio'}],
    'presets': {'esencial': ['cities', 'roads', 'rivers'], 'infraestructura': ['cities', 'roads', 'transport', 'plants', 'substations', 'transmission'],
                'agua': ['rivers', 'runoff', 'protected', 'priority'], 'todo': [l['id'] for l in layers]},
    'missing': [{'id': 'aquifers', 'group': 'agua', 'label': 'Acuíferos', 'count': len(aq['aquifers']),
                 'note': 'Sin polígonos oficiales en el acervo: 39 registros en «Información por ubicar» y en el tema Agua.'}],
    'layers': layers, 'base_sources': base_sources, 'terrain_tiles': terrain_keys,
    'checks': {'iter_localities': iter_rows, 'vertex_subset_checked': VERTS,
               'poer_distinct_uga_codes': len({f['properties']['CLAVE_UGA'].split('_')[0] for f in json.loads((DATA / 'layer-zoning.json').read_text())['features']}),
               'hydrorivers_unique_ids': len({f['properties'].get('HYRIV_ID') for f in json.loads((DATA / 'layer-rivers.json').read_text())['features']})},
}
(DATA / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')

# leak guard: no file paths / file names in any explorer text
leak = re.compile(r'(BCSFP|11_bcs_hub|src/data|archivo_BCSFP|portal_data|\b[\w-]+\.(?:json|py|gpkg|zip|csv|geojson|js)\b)')
for fpath in [DATA / 'manifest.json', DATA / 'knowledge.json']:
    txt = fpath.read_text(encoding='utf-8')
    for m in leak.finditer(txt):
        ctx = txt[max(0, m.start() - 40): m.end() + 10]
        if 'http' in ctx or '"file"' in ctx:
            continue
        raise SystemExit(f'leak guard: {fpath.name}: {m.group(0)!r} in …{ctx}…')
print(json.dumps({'layers': {l['id']: l['count'] for l in layers}, 'bytes': {l['id']: l['bytes'] for l in layers},
                  'unlocated': len(unlocated), 'topics': len(topics), 'items': len(items), 'checks': manifest['checks']}, ensure_ascii=False, indent=1))
