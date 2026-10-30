# Deploy — Stills UX + Catalog absorbs Files (2026-09-15)

Prod: https://bcs-intel-portal.netlify.app  
Deploy: https://app.netlify.com/projects/bcs-intel-portal/deploys/6aa9ad09d8faf6b7e1b8fd9d  
Auth / F+P cyan / Data wording preserved.

## Stills (`/stills`)
Removed: batch dropdown; GeoJSON CTA; near-dupe stat clutter; batch chips; technical primary IDs; ESP/work-doc CTAs.
Data: `stills_points.json` 1000→956 (44 near-dupes from `stills_dedup_report.json`); gallery + geojson already 956.
UX: title “Fotos del territorio” / “Territory photos”; filters category + municipality; big map; map↔card sync; place-name popups; “Mapa completo” → `/gis-atlas`.

## Catalog / Files
`/catalogo` is the only files UI; Netlify upload form at bottom (`#contribuir`); `/catalogo/gracias/`.
Redirects: `/archivos`, `/archivos/`, `/archivos/*` → `/catalogo/`.
Removed Files from nav, quick links, header search pages, explorar cards/CTAs.
