# Deploy — Foresights visuals (2026-09-19 Europe/Madrid)

**Prod:** https://bajacaliforniasur2050.com/foresights/  
**Netlify alias:** https://bcs-intel-portal.netlify.app/foresights/  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6aaef06298b6c09eae48d61f  
**Message:** Foresights visuals — maps diagrams charts

## Figure paths (`public/foresights/`)

| Path | Role |
|------|------|
| `/foresights/vocation_map.png` | Place-vocation map (OSM municipalities + anchors) |
| `/foresights/vocation_places.geojson` | Leaflet markers |
| `/foresights/signals_diagram.png` | Radial signals board |
| `/foresights/constraints_flights.png` | SJD/LAP/LTO non-stop destinations |
| `/foresights/constraints_dma.png` | 5 CONAGUA DMA deficit aquifers |
| `/foresights/constraints_counts.png` | Stills / DMA / airports counts |
| `/foresights/role_tensions.png` | Water vs growth · SIBCS island · Cabos vs rest |
| `/foresights/stills/*.jpg` | 4 territory stills near vocations |

All assets HTTP 200 on prod.

## Pipeline

- `scripts/build_foresights_figures.py` (matplotlib + shapely; no full QGIS)
- Hooked at end of `scripts/update_bcs_foresights.py`
- Documented in `FORESIGHTS_PLAN.md` § Visual pipeline
- Venv: `.venv-foresights`

## Preserved

Auth gate · F+P fichas hide · no decision-twin public page · place-vocation model · mobile bottom chat
