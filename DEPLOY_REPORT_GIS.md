# Deploy report — GIS atlas + Data lake UI removal (2026-09-15 ~21:42 PT / 19:42 UTC)

## Prod
https://bcs-intel-portal.netlify.app/gis-atlas/

Deploy: https://app.netlify.com/projects/bcs-intel-portal/deploys/6aa99f9cfe77d238eb611c0e  
Message: `GIS map: OSM layers + Earth Studio stills; remove Data lake UI`

## Data lake UI removed
- `/archivos`: removed Drive card for `10_data_lake`; copy → “carpetas de datos / project folders”
- `/explorar`: top-level folder browse hides `10_data_lake` (engagement groups still reach Steering/TAG/Forum)
- Labels renamed away from “Data lake” → “Datos de proyecto (engagement) / Project data”
- Catalog theme `data_lake` → `project_data` (slim catalog + folders_summary)
- Ontología / Fuentes: softened “data lake” → project/theme folders
- Drive content **not** deleted

## GIS layers (`public/gis/`)
| Layer | Features | Size |
|-------|----------|------|
| osm_highways | 3379 | ~2.1 MB |
| osm_coastline | 2070 | ~867 KB |
| osm_waterways | 260 | ~622 KB |
| osm_protected | 141 | ~584 KB |
| osm_towns | 383 | ~73 KB |
| osm_transport_nodes | 48 | ~10 KB |
| anp_federales | 10 | 43 KB |
| rtp_conabio | 5 | 115 KB |
| poer_ugas | 69 | 391 KB |
| ran_nucleos | 96 | 281 KB |
| settlements | 77 | 18 KB |
| highway_nodes | 61 | 13 KB |
| **Territory stills** | **956** | `/stills/stills.geojson` ~542 KB |

Basemaps: OSM · OpenTopoMap · Esri imagery  
Defaults ON: stills, ANP, highways, waterways, settlements, airports/ports  
Script: `scripts/build_gis_osm_layers.py` (Geofabrik Mexico PBF + osmium preferred)

## Nav
- Quick link / i18n: **Mapa GIS** / **GIS map**
- Explorar card updated; `/stills` CTA → GIS map primary

## Preserve
Auth gate · chat · F+P cyan · Data wording · engagement catalog groups
