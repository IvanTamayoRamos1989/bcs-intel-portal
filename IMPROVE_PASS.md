# Improve pass — UX + GIS + files (2026-09-15)

Prod: https://bcs-intel-portal.netlify.app  
Deploy: https://app.netlify.com/projects/bcs-intel-portal/deploys/6aa9a6be66108877e367b2cc  
Auth: BCS2050 · chat · F+P cyan · Data wording · engagement groups preserved.

## UX
- `/explorar`: GIS map is the primary CTA card; secondary Catalog / Files / Stills.
- Catalog copy: no “Desktop” mentions; human subgroup labels only; empty subgroups hidden; file counts on cards.
- `/inmobiliario`: filename or Drive link only (25/26 reports matched to Drive); no Desktop paths.
- Mobile GIS: collapsible layer drawer; map ~65–68vh.
- Archivos: useful territory + engagement Drive folders only (no empty data-lake root).

## GIS map (`/gis-atlas`)
- Layer panel groups: Territory photos | Protection & planning | Transport | Water | Places (+ Basemap radios).
- Collapsible groups with Show all / Hide all; color swatches; layer filter/search.
- Controls: fullscreen, Fit BCS, polygon opacity slider, Photos only toggle.
- Defaults ON: stills, ANP, osm_protected, highways, transport nodes, waterways, **coastline**, settlements.
- New layers: municipalities (5 BCS), beaches (38), power lines (288), power nodes (plants/generators).
- Scale bar + clear OSM / OpenTopoMap / Esri attribution.
- Stills popups: lazy image + thumb→full fallback.

## Files
- Light Drive re-crawl of priority folders; `SKIP_SUMMARIES=1` catalog refresh (`slim_matched` 631).
- Header search: GIS map boosted / listed first.
- Script: `scripts/build_gis_osm_layers.py` extended for municipalities, beaches, power.

## Deploy
`npm run build && npx netlify deploy --dir=dist --functions netlify/functions --prod --message "UX + GIS controls + files organization polish"`
