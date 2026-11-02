#!/usr/bin/env python3
"""Drop GIS features that sit outside the published Baja California Sur boundary.

Uses public/explorar/data/base.json. A feature stays if any vertex is inside the
boundary or within 25 km of it (lagoon centroids and the coastline). Sinaloa and
Sonora towns are far outside that band.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'public/explorar/data/base.json'
GIS = ROOT / 'public/gis'
BUFFER_KM = 25

ONE_LINE = {
    'osm_towns.geojson', 'osm_highways.geojson', 'osm_power_lines.geojson',
    'osm_waterways.geojson', 'osm_protected.geojson', 'osm_municipalities.geojson',
}


def rings_of(geom):
    if not geom:
        return []
    t = geom.get('type')
    c = geom.get('coordinates') or []
    if t == 'Polygon':
        return [c[0]] if c else []
    if t == 'MultiPolygon':
        return [poly[0] for poly in c if poly]
    return []


def vertices(geom, out):
    if not geom:
        return
    t = geom.get('type')
    c = geom.get('coordinates')
    if t == 'Point':
        out.append(c)
    elif t in ('LineString', 'MultiPoint'):
        out.extend(c)
    elif t in ('Polygon', 'MultiLineString'):
        for part in c:
            out.extend(part)
    elif t == 'MultiPolygon':
        for poly in c:
            for ring in poly:
                out.extend(ring)
    elif t == 'GeometryCollection':
        for g in geom.get('geometries') or []:
            vertices(g, out)


def in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-15) + xi):
            inside = not inside
        j = i
    return inside


def in_boundary(x, y, polys):
    for poly in polys:
        if not poly:
            continue
        if in_ring(x, y, poly[0]):
            if any(in_ring(x, y, hole) for hole in poly[1:]):
                continue
            return True
    return False


def km(a, b):
    lon1, lat1 = math.radians(a[0]), math.radians(a[1])
    lon2, lat2 = math.radians(b[0]), math.radians(b[1])
    dlon, dlat = lon2 - lon1, lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(min(1, math.sqrt(h)))


def near(pt, sample):
    return min(km(pt, p) for p in sample) <= BUFFER_KM


def keep(geom, polys, sample):
    pts = []
    vertices(geom, pts)
    if not pts:
        return False
    for pt in pts:
        if in_boundary(pt[0], pt[1], polys):
            return True
    # One distance check is enough: Sinaloa is far; lagoon centroids are close.
    return near(pts[0], sample) or near(pts[len(pts) // 2], sample)


def main():
    base = json.loads(BASE.read_text())
    geom = base['boundary']['features'][0]['geometry']
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    sample = []
    for ring in rings_of(geom):
        sample.extend(ring[::25])
    changed = 0
    for path in sorted(GIS.glob('*.geojson')):
        data = json.loads(path.read_text())
        feats = data.get('features') or []
        kept = [f for f in feats if keep(f.get('geometry'), polys, sample)]
        if len(kept) == len(feats):
            continue
        data['features'] = kept
        if path.name in ONE_LINE:
            text = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        else:
            text = json.dumps(data, ensure_ascii=False, indent=2)
        path.write_text(text + '\n')
        print(f'{path.name}: {len(feats)} -> {len(kept)}')
        changed += 1
    if not changed:
        print('clip_bcs_gis: nothing outside the state')
    else:
        print(f'clip_bcs_gis: updated {changed} file(s)')


if __name__ == '__main__':
    main()
