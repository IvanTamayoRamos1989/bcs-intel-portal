"""Pack processed Open Buildings GeoJSONs into small spatial files for the map.
Usage: python scripts/pack_buildings.py <output directory> <processed city directories...>
Each input directory has a city index.json and the matching city GeoJSON files.
"""
import json, math, sys
from collections import defaultdict
from pathlib import Path

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf8')

def pack(out, roots):
    seen=set(); cities=[]; tiles=[]
    for root in roots:
        ix=json.loads((root/'index.json').read_text(encoding='utf8'))
        for c in ix['cities']:
            city=c['id']; groups=defaultdict(list); extents={}
            for f in json.loads((root/(city+'.geojson')).read_bytes())['features']:
                g=f['geometry']; p=f['properties']
                assert g['type'] in ('Polygon','MultiPolygon') and p['h']>=3 and p['a']>0
                geom=json.dumps(g,separators=(',',':'))
                if geom in seen: continue
                seen.add(geom)
                polys=[g['coordinates']] if g['type']=='Polygon' else g['coordinates']
                pts=[pt for polygon in polys for ring in polygon for pt in ring]
                xs,ys=zip(*pts); x,y=pts[0]
                k=(math.floor(x*80),math.floor(y*80))
                groups[k].append(f)
                b=extents.setdefault(k,[180,90,-180,-90])
                b[:]=[min(b[0],min(xs)),min(b[1],min(ys)),max(b[2],max(xs)),max(b[3],max(ys))]
            dense=max(groups,key=lambda k:len(groups[k])); sample=groups[dense][len(groups[dense])//2]['geometry']
            ring=(sample['coordinates'] if sample['type']=='Polygon' else sample['coordinates'][0])[0]
            center=[sum(v[i] for v in ring[:-1])/(len(ring)-1) for i in range(2)]
            cities.append(dict(id=city,name=c['name'],center=center,buildings=sum(map(len,groups.values()))))
            for (x,y),fs in sorted(groups.items()):
                id=f'{city}_{x}_{y}'; path='tiles/'+id+'.geojson'
                write(out/path,dict(type='FeatureCollection',features=fs))
                tiles.append(dict(id=id,bbox=extents[x,y],url='/gis/edificios/'+path))
    write(out/'index.json',dict(source=ix['source'],limits=ix['limits'],height_rule=ix['height_rule'],cities=cities,tiles=tiles))
    print([(c['name'],c['buildings']) for c in cities],len(seen),'buildings;',len(tiles),'tiles')
if __name__=='__main__': pack(Path(sys.argv[1]),list(map(Path,sys.argv[2:])))
