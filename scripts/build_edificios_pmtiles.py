#!/usr/bin/env python3
"""Pack the nine-zone buildings into one vector-tile file (PMTiles) for the 3D twin.

Input : public/gis/edificios/index.json + tiles/*.geojson (Open Buildings v3 footprints with 2.5D 2023 height)
Output: public/gis/edificios/edificios.pmtiles  (MVT, gzip, zooms 13-15, layer "edificios")
        and adds a "pmtiles" block to index.json (url, zooms, layer, bounds).

Every building and every field is kept (h, hm, hx, n, a, c, mz). Geometry is clipped per tile
with a small buffer and quantised to the 4096 tile grid (~2.4 m at z13, ~0.6 m at z15).
The map overzooms z15 up to z17.

Usage: python3 scripts/build_edificios_pmtiles.py
"""
import gzip
import json
import math
from collections import defaultdict
from pathlib import Path

import mapbox_vector_tile
import numpy as np
import shapely
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from shapely.geometry import box, shape

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / 'public' / 'gis' / 'edificios'
OUT = DIR / 'edificios.pmtiles'
ZOOMS = (13, 14, 15)
EXTENT = 4096
BUFFER = 64 / EXTENT          # tile-relative clip buffer
LAYER = 'edificios'
R = 6378137.0


def merc(xy):
    x = xy[:, 0] * math.pi / 180 * R
    y = [math.log(math.tan(math.pi / 4 + v * math.pi / 360)) * R for v in xy[:, 1]]
    xy = xy.copy()
    xy[:, 0] = x
    xy[:, 1] = y
    return xy


def tile_bounds_merc(z, x, y):
    n = 2 ** z
    size = 2 * math.pi * R / n
    minx = -math.pi * R + x * size
    maxy = math.pi * R - y * size
    return minx, maxy - size, minx + size, maxy


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def main():
    ix = json.loads((DIR / 'index.json').read_text())
    geoms, props = [], []
    for t in ix['tiles']:
        fc = json.loads((DIR / 'tiles' / Path(t['url']).name).read_text())
        for f in fc['features']:
            g = shape(f['geometry'])
            if g.is_empty:
                continue
            p = f['properties']
            props.append({k: p[k] for k in ('h', 'hm', 'hx', 'n', 'a', 'c', 'mz') if p.get(k) is not None})
            geoms.append(g)
    print(f'{len(geoms)} buildings read')
    geoms_m = shapely.transform(shapely.make_valid(np.array(geoms, dtype=object)), merc)
    bounds_ll = shapely.bounds(geoms)
    for p in props:
        if 'c' in p:
            p['c'] = round(p['c'], 2)

    minlon, minlat = bounds_ll[:, 0].min(), bounds_ll[:, 1].min()
    maxlon, maxlat = bounds_ll[:, 2].max(), bounds_ll[:, 3].max()
    tiles = []
    for z in ZOOMS:
        buckets = defaultdict(list)
        for i, b in enumerate(bounds_ll):
            x0, y1 = lonlat_to_tile(b[0], b[1], z)
            x1, y0 = lonlat_to_tile(b[2], b[3], z)
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    buckets[(x, y)].append(i)
        sizes = []
        for (x, y), idx in buckets.items():
            mb = tile_bounds_merc(z, x, y)
            w = mb[2] - mb[0]
            clip = box(mb[0] - w * BUFFER, mb[1] - w * BUFFER, mb[2] + w * BUFFER, mb[3] + w * BUFFER)
            feats = []
            for i in idx:
                g = geoms_m[i].intersection(clip) if not clip.contains(geoms_m[i]) else geoms_m[i]
                if g.is_empty or g.geom_type not in ('Polygon', 'MultiPolygon'):
                    continue
                feats.append({'geometry': g, 'properties': props[i]})
            if not feats:
                continue
            data = mapbox_vector_tile.encode(
                [{'name': LAYER, 'features': feats}],
                default_options={'quantize_bounds': mb, 'extents': EXTENT, 'y_coord_down': False},
            )
            gz = gzip.compress(data, 9)
            sizes.append(len(gz))
            tiles.append((zxy_to_tileid(z, x, y), gz))
        sizes.sort()
        print(f'z{z}: {len(sizes)} tiles, median {sizes[len(sizes) // 2] / 1024:.0f} KB, max {sizes[-1] / 1024:.0f} KB')

    tiles.sort(key=lambda t: t[0])
    with open(OUT, 'wb') as fh:
        wr = Writer(fh)
        for tid, data in tiles:
            wr.write_tile(tid, data)
        cz = ZOOMS[0]
        wr.finalize(
            {
                'tile_type': TileType.MVT, 'tile_compression': Compression.GZIP,
                'min_zoom': ZOOMS[0], 'max_zoom': ZOOMS[-1],
                'min_lon_e7': int(minlon * 1e7), 'min_lat_e7': int(minlat * 1e7),
                'max_lon_e7': int(maxlon * 1e7), 'max_lat_e7': int(maxlat * 1e7),
                'center_zoom': cz, 'center_lon_e7': int((minlon + maxlon) / 2 * 1e7), 'center_lat_e7': int((minlat + maxlat) / 2 * 1e7),
            },
            {
                'name': 'BCS2050 edificios', 'attribution': 'Google Open Buildings v3 + 2.5D Temporal (2023)',
                'description': ix.get('source', ''),
                'vector_layers': [{'id': LAYER, 'minzoom': ZOOMS[0], 'maxzoom': ZOOMS[-1], 'fields': {
                    'h': 'Number', 'hm': 'Number', 'hx': 'Number', 'n': 'Number', 'a': 'Number', 'c': 'Number', 'mz': 'String'}}],
            },
        )
    ix['pmtiles'] = {'url': '/gis/edificios/edificios.pmtiles', 'layer': LAYER, 'minzoom': ZOOMS[0], 'maxzoom': ZOOMS[-1],
                     'bounds': [round(minlon, 5), round(minlat, 5), round(maxlon, 5), round(maxlat, 5)], 'buildings': len(geoms)}
    (DIR / 'index.json').write_text(json.dumps(ix, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1e6:.1f} MB, {len(tiles)} tiles')


if __name__ == '__main__':
    main()
