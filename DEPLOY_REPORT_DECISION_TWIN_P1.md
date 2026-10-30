> **Deferred (2026-09-16):** Public Decision twin UI removed pending demand/supply of growth analysis. Scenario JSON, focus GeoJSON, and this report retained for later. See `DECISION_TWIN_DEFERRED.md`.

# Deploy — Decision twin Phase 1 (2026-09-16)

**Prod:** https://bcs-intel-portal.netlify.app  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6aab0d807e997a14891da278  
**Page:** https://bcs-intel-portal.netlify.app/decision/  
**Aliases:** `/gemelo` → `/decision/`, `/decision-twin` → `/decision/`

## What it is
A **decision twin** = one shared territorial model for strategy choices (client / F+P / TAG): pick a scenario, see which GIS layers and ontology nodes matter, zoom to priority geographies. **Not** a photoreal statewide 3D twin.

## Scenario ids
| id | EN title | Focus |
|----|----------|--------|
| `baseline` | Current trajectory | Tourism + coastal growth; stressed DMAs; East Cape / Pulmo pressure |
| `corridor_intensify` | Intensify Cabos–La Paz corridor | Los Cabos–Todos Santos–La Paz + East Cape flank |
| `water_first` | Water security first | DMA deficits 0313/0317/0319/0324 + 0318; desal/reuse |
| `ports_air_hubs` | Ports & airports as growth anchors | SJD / LAP / LTO + CSL / Pichilingue / Santa Rosalía |

Data: `src/data/scenarios.json` (+ public copy `/scenarios.json`).

## Higher-fidelity focus areas
1. **Cabos–Todos Santos–La Paz corridor**
2. **East Cape / Cabo del Este** (Los Barriles–Buenavista–La Ribera–Cabo Pulmo indicative belt)
3. **Loreto**
4. **Ciudad Constitución**
5. **Water systems** (DMA markers)
6. **Ports / airports**

## GIS layers added (`public/gis/`, group **Decision focus** / **Foco de decisión**, off by default)
| Layer id | File |
|----------|------|
| `focus_corridor_cabos_lapaz` | `focus_corridor_cabos_lapaz.geojson` |
| `focus_east_cape` | `focus_east_cape.geojson` |
| `focus_water_dmas` | `focus_water_dmas.geojson` |
| `focus_ports_air` | `focus_ports_air.geojson` |
| `focus_places_loreto_constitucion` | `focus_places_loreto_constitucion.geojson` |

Registered in `public/gis/layers.json`. Belts/markers are **indicative** (documented in GeoJSON properties); no invented statistics — facts cite Summary / ontology / CONAGUA DMA / SETUE / DataTur / INEGI.

## Maps deep-link
- `/mapas?scenario=<id>#gis` — loads `/scenarios.json`, enables `priority_layer_ids`, `fitBounds` on `focus_bbox`, opens Decision focus group.
- Optional: `&layers=id1,id2` overrides layer list.
- Also reads `#scenario=<id>`.
- Decision page embeds iframe + “Open full map” with the same query.

## Other wiring
- Nav: Summary → **Decision twin** → Explore → … (i18n `decision` / `navDecision` EN/ES)
- `/resumen` CTA card → `/decision`
- Ask corpus chunk `portal:decision-twin-p1` (scenarios + East Cape + focus areas)
- Ontology links `/ontologia#<nodeId>` focus search on hash
- Header search includes Decision twin
- Preserved: auth BCS2050, chat, GIS-in-Maps, F+P cyan, Data wording, Summary/News, EN/ES, ontology, Drive-only downloads

## How to try
1. Open https://bcs-intel-portal.netlify.app/decision/
2. Switch scenario cards (mobile-friendly grid)
3. Click **Open full map** → layers + bbox for that scenario
4. Focus cards → East Cape, Loreto, Constitución, water, ports
