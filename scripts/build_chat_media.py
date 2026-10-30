#!/usr/bin/env python3
"""Index real portal media (stills thumbs + map atlas jpgs) for rich chat blocks."""
import json, glob, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
stills = {}
for gj in sorted(glob.glob(os.path.join(ROOT, 'public/stills/batch_*/stills.geojson'))):
    for f in json.load(open(gj)).get('features', []):
        p = f.get('properties', {})
        sid = p.get('id') or f.get('id')
        thumb = p.get('thumb')
        if not sid or not thumb or not os.path.exists(os.path.join(ROOT, 'public', thumb.lstrip('/'))):
            continue
        stills[sid] = {k: p.get(k) for k in ('name', 'municipio', 'lat', 'lon', 'thumb', 'image')}
maps = sorted(os.path.basename(p) for p in glob.glob(os.path.join(ROOT, 'public/maps/*.jpg')))
out = os.path.join(ROOT, 'netlify/functions/chat_media.json')
json.dump({'stills': stills, 'maps': maps}, open(out, 'w'), ensure_ascii=False)
print(f'chat_media: {len(stills)} stills, {len(maps)} maps')
