#!/usr/bin/env python3
"""Urban blocks 2020 for the 3D twin, from the BCS2050 Foster GIS handover.

Input : inegi_censo_2020_manzanas_gis/manzanas_urbanas_2020/manzanas_urbanas_2020.gpkg
        (INEGI Censo de Población y Vivienda 2020, 17,009 urban blocks, EPSG:4326)
Output: public/gis/manzanas_2020.geojson

Fields kept per block:
  id    CVEGEO (join key; never join on names)
  mun   municipality name as published
  loc   locality name as published
  pob   POBTOT, persons (null when INEGI suppressed or did not publish the cell)
  viv   VIVTOT, dwellings (null when suppressed)
  ha    block area in hectares, measured in EPSG:6372 (Mexico ITRF2008 / LCC)
  dens  pob / ha, persons per hectare (null when pob is null or the block is < 0.01 ha)
  agua  % of inhabited dwellings with piped water inside (VPH_AGUADV / TVIVHAB),
        null when either cell is suppressed or TVIVHAB is 0

The block layer covers urban blocks only. It is not the whole state population.
A null stays null: it is not drawn as zero.

Usage: python3 scripts/build_manzanas_2020.py <path/to/foster_package_root>
"""
import json
import sys
from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parent.parent
REL = 'inegi_censo_2020_manzanas_gis/manzanas_urbanas_2020/manzanas_urbanas_2020.gpkg'
OUT = ROOT / 'public' / 'gis' / 'manzanas_2020.geojson'


def num(v):
    s = str(v).strip() if v is not None else ''
    return int(s) if s.isdigit() else None


def main(pkg):
    src = Path(pkg) / REL
    cols = ['cvegeo', 'nom_mun', 'nom_loc', 'pobtot', 'vivtot', 'tvivhab', 'vph_aguadv']
    g = gpd.read_file(src, columns=cols)
    assert str(g.crs).upper().endswith('4326'), g.crs
    m = g.to_crs(6372)
    area_ha = m.geometry.area / 10_000
    # ~1 m simplification in metres, then back to WGS84 at 6 decimals (~0.1 m).
    g['geometry'] = m.geometry.simplify(1.0, preserve_topology=True).to_crs(4326)

    feats = []
    nulls = 0
    for row, ha in zip(g.itertuples(index=False), area_ha):
        pob = num(row.pobtot)
        viv = num(row.vivtot)
        hab = num(row.tvivhab)
        agua = num(row.vph_aguadv)
        dens = round(pob / ha, 1) if pob is not None and ha >= 0.01 else None
        pct = round(100 * agua / hab, 1) if agua is not None and hab else None
        if pob is None:
            nulls += 1
        geom = row.geometry.__geo_interface__
        feats.append({
            'type': 'Feature',
            'properties': {
                'id': row.cvegeo, 'mun': row.nom_mun, 'loc': row.nom_loc,
                'pob': pob, 'viv': viv, 'ha': round(float(ha), 3), 'dens': dens, 'agua': pct,
            },
            'geometry': geom,
        })

    def rnd(c):
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
            return [round(c[0], 6), round(c[1], 6)]
        return [rnd(x) for x in c]

    for f in feats:
        f['geometry'] = {'type': f['geometry']['type'], 'coordinates': rnd(f['geometry']['coordinates'])}

    fc = {
        'type': 'FeatureCollection',
        'meta': {
            'source': 'INEGI, Censo de Población y Vivienda 2020, manzanas urbanas (GIS derivative in the BCS2050 Foster handover, 2026-10-29)',
            'reference_year': 2020,
            'blocks': len(feats),
            'blocks_without_population': nulls,
            'density': 'persons per hectare, block area in EPSG:6372',
            'limits': 'Urban blocks only; not the whole state population. Not building height.',
        },
        'features': feats,
    }
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT.relative_to(ROOT)}: {len(feats)} blocks, {nulls} without population, {OUT.stat().st_size / 1e6:.1f} MB')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
