# Deploy report — Portal + Drive engagement alignment (2026-09-15 ~20:03 PT / 18:03 UTC)

## Prod
https://bcs-intel-portal.netlify.app

## Trash (recoverable)
- **Total:** 110 items (files + empty folders)
- **Shadow programme:** 47 (all children + meetings + `09_shadow_programme` folder)
- **Earth Studio work docs:** 63 (ESP×26, KML×26, manifests/scripts/READMEs/brief, `esp`/`kml`/`earth_studio_tour` folders)
- Log: `scripts/drive_crawl/state/trashed_work_docs.json`
- **Not trashed:** PAL/Acciona; thematic PDFs; public stills; unrelated Drive RENDER/FIXED outside BCS root

## Catalog IA
- Browse by group / Explorar por grupo (F+P labels from BCS_stakeholders_simple.xlsx)
- Groups: Steering Committee (6) · Technical Advisory Group (4) · Stakeholders Forum (3) · Territory data (8 themes)
- Mapping: `src/data/engagement_catalog.json`
- Default filter: En Drive; no Desktop paths; ontology/shadow/ESP work packs excluded from download rows

## Earth Studio → stills
- Nav / explorar Earth Studio → `/stills`
- `/earth-studio` short intro + client redirect to `/stills`
- `/stills` OSM primary basemap; no Catálogo earth_studio / ESP-pack CTAs

## Ontology
- On-page graph/lenses kept
- Catalog + archivos: no YAML/pack download CTAs; `12_ontology` filtered from public catalog downloads

## Drive alignment
- Created under `10_data_lake`: 01_Steering_Committee, 02_Technical_Advisory_Group, 03_Stakeholders_Forum + all subgroups
- Moved sample evidence (CONAGUA DMA, municipal PMDs, CONANP PMs, OOMSAPAS) into matching subgroups
- IDs: `scripts/drive_crawl/state/engagement_folder_ids.json`
- Theme folders 01–07 remain as Territory data packs

## Footer
- No remaining “Acervo catalog” in src (already Data/Catálogo wording)
