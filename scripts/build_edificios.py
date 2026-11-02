#!/usr/bin/env python3
"""Buildings for the 3D twin, from the Earth Engine exports in Drive/BCS2050_edificios.

Footprints : Google Open Buildings v3 polygons (50 cm imagery), confidence >= 0.70
Height     : Google Open Buildings 2.5D Temporal v1, band building_height, 2023
             (mean and max of the 4 m raster inside each footprint, metres above terrain)

Input : a folder with bcs_edificios_<city>.geojson and/or bcs_edificios_<city>_<ij>.geojson tiles
Output: public/gis/edificios/<city>.geojson  +  public/gis/edificios/index.json

Per building:
  h    height drawn, m: the estimated mean, floored at 3 m (one storey) when the estimate is lower
  hm   estimated mean height, m (as exported, 1 decimal); hx estimated max, m
  n    estimated storeys = round(h / 3)
  a    footprint area, m2;  c  detection confidence
  mz   CVEGEO of the INEGI 2020 block that contains the footprint centroid (null outside urban blocks)

Usage: python3 scripts/build_edificios.py <folder with exports>
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from shapely.geometry import shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'gis' / 'edificios'
BLOCKS = ROOT / 'public' / 'gis' / 'manzanas_2020.geojson'
MIN_H = 3.0

NAMES = {
    'cabo_san_lucas': 'Cabo San Lucas', 'corredor_turistico': 'Corredor turístico', 'san_jose_del_cabo': 'San José del Cabo',
    'la_paz': 'La Paz', 'todos_santos': 'Todos Santos', 'loreto': 'Loreto', 'ciudad_constitucion': 'Ciudad Constitución',
    'guerrero_negro': 'Guerrero Negro', 'santa_rosalia': 'Santa Rosalía',
}


def rnd(c):
    if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
        return [round(c[0], 6), round(c[1], 6)]
    return [rnd(x) for x in c]


def main(src):
    groups = defaultdict(list)
    for p in sorted(Path(src).glob('bcs_edificios_*.geojson')):
        m = re.match(r'bcs_edificios_(.+?)(?:_(\d\d))?\.geojson$', p.name)
        groups[m.group(1)].append((m.group(2), p))

    blocks = json.loads(BLOCKS.read_text())['features']
    bgeoms = [shape(f['geometry']) for f in blocks]
    bids = [f['properties']['id'] for f in blocks]
    tree = STRtree(bgeoms)

    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for city, files in groups.items():
        tiles = [p for t, p in files if t]
        use = tiles if tiles else [p for t, p in files if not t]
        feats, floored = [], 0
        seen = set()
        for path in use:
            for f in json.loads(path.read_text())['features']:
                pr = f.get('properties') or {}
                g = shape(f['geometry'])
                key = (round(g.centroid.x, 6), round(g.centroid.y, 6))
                if key in seen:
                    continue
                seen.add(key)
                hm = pr.get('altura_media_m')
                hx = pr.get('altura_max_m')
                h = max(MIN_H, hm or 0)
                if (hm or 0) < MIN_H:
                    floored += 1
                mz = None
                for i in tree.query(g.centroid):
                    if bgeoms[i].contains(g.centroid):
                        mz = bids[i]
                        break
                feats.append({'type': 'Feature', 'properties': {
                    'h': round(h, 1), 'hm': None if hm is None else round(hm, 1), 'hx': None if hx is None else round(hx, 1),
                    'n': max(1, round(h / 3)), 'a': round(pr.get('area_m2') or 0, 1), 'c': pr.get('confianza'), 'mz': mz,
                }, 'geometry': {'type': f['geometry']['type'], 'coordinates': rnd(f['geometry']['coordinates'])}})
        xs = [c for f in feats for c in [shape(f['geometry']).bounds]]
        bbox = [round(min(b[0] for b in xs), 5), round(min(b[1] for b in xs), 5), round(max(b[2] for b in xs), 5), round(max(b[3] for b in xs), 5)]
        out = OUT / f'{city}.geojson'
        out.write_text(json.dumps({'type': 'FeatureCollection', 'features': feats}, separators=(',', ':')))
        hs = sorted(f['properties']['h'] for f in feats)
        index.append({'id': city, 'name': NAMES.get(city, city), 'url': f'/gis/edificios/{city}.geojson', 'bbox': bbox,
                      'buildings': len(feats), 'floored_to_one_storey': floored, 'h_p50': hs[len(hs) // 2], 'h_p90': hs[int(len(hs) * .9)],
                      'h_max': hs[-1], 'mb': round(out.stat().st_size / 1e6, 1)})
        print(f'{city}: {len(feats)} buildings from {len(use)} file(s), {floored} floored to {MIN_H} m, {index[-1]["mb"]} MB')

    meta = {
        'source': 'Google Open Buildings v3 (footprints, 50 cm imagery, confidence >= 0.70) and Open Buildings 2.5D Temporal v1 (building_height, 2023), via Earth Engine',
        'height_rule': f'Drawn height is the estimated mean inside the footprint, floored at {MIN_H} m (one storey).',
        'limits': 'Height is a model estimate from Sentinel-2 (effective 4 m). Good to tell one, two or three storeys from towers; not exact to the metre.',
        'cities': sorted(index, key=lambda r: r['id']),
    }
    (OUT / 'index.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
