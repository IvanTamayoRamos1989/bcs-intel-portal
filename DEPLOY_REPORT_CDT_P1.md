# Deploy — Territorial twin Phase 1 (City Digital Twin surface)

**Page:** `/gemelo/` (alias `/cdt/` → `/gemelo/`)
**Also:** `/decision` and `/decision-twin` now redirect to `/gemelo/` (they previously 301’d to `/resumen/`).
**Data rule:** every figure on the page is read from data already in the portal. The build throws if a required extract (municipal poverty, SNIIV, cruise calls, airport passengers, GIS layer id, census totals) fails.

## What shipped

A public **Gemelo territorial** for technicians and stakeholders, in the portal’s Spanish-first voice and F+P blue (`#0083C4`). It is decision support. It is not an official plan, not a parcel model, and not a morphometric twin.

1. **Route.** `/gemelo` renders the board. It does not redirect to `/resumen`. `/cdt` is an alias.
2. **Five themes**, each with GIS layers, KPI cards, a short diagnostic, and an explicit gap:
   - Diseño urbano — settlements, towns, POER units, Cabos–La Paz focus. Census population and localities. No AGEB, fractal dimension, or betweenness.
   - Desarrollo económico — federal projects, revenue law where a figure exists (Mulegé and Loreto stay blank), demand–supply balance counts, SIBCS peak.
   - Innovación e investigación — relationship map, strategic questions, foresight signals, open data gaps. No university collaboration graph.
   - Movilidad y logística — highways, transport nodes, port/airport anchors. SETUE 2025 passengers (SJD, LAP, state). Loreto 2025 passengers are not in the archive and are not estimated. DataTur 2025 cruise calls for Cabo San Lucas and Pichilingue. FlightConnections non-stop counts.
   - Vivienda y nivel de vida — CONAVI 2024 backlog, SNIIV 2025 registry, JLL 2025 BCS market, CONEVAL 2020 municipal poverty range. Schematic 500 m studies are described as cells, not parcels, and are not turned into a housing quota.
3. **Scenario switcher** reads the four scenarios already in the portal (current trajectory, Cabos–La Paz corridor, water first, ports and airports). Choosing one turns on that scenario’s layers, fits its bbox, and sets **Abrir estas capas en Mapas** to `/mapas?scenario=…&layers=…#gis` (the existing maps deep-link).
4. **Compare.** Scatter and choropleth of the five municipalities on three published indicators: INEGI 2020 population, SNIIV 2025 housing registry, CONEVAL 2020 poverty percent. No trend line. East Cape stays inside Los Cabos and Todos Santos–El Pescadero inside La Paz, because there is no AGEB layer.
5. **Recommendations.** Rules from the growth demand–supply balance (constrained / contested / headroom / unknown), filtered by theme and scenario, plus the state “what must be true” lines. Labeled as portal decision support, not a parcel desirability score.
6. **Chat.** Corpus chunk `portal:gemelo-territorial-p1` explains the five themes and links to `/gemelo`. The old “public decision twin is deferred / no scenarios page” pitch is replaced.
7. **Nav and language.** Entry under Temas → Para especialistas, header search, EN/ES, specialist plain-language note.

## Shipped vs Phase 2

| Phase 1 (this page) | Phase 2 (not in the archive, not invented) |
|---|---|
| Municipal choropleth and five theme layer sets | INEGI AGEB polygons and block-level indicators |
| Settlement, locality, and POER as the form read | Morphometrics: fractal dimension, betweenness, urban-form self-similarity |
| Whole-municipality compare (3 indicators) | Finer units only when a real boundary exists |
| Rule-based recommendations from demand/supply | Parcel typologies, unit counts, and desirability scores — only with a real cadastre |
| Water as DMA deficit figures and focus points | Climate and water models beyond CONAGUA DMA and the runoff layers already on Maps |
| Research as the relationship map and open gaps | A research-collaboration network |
| Scenarios as layer presets and questions | A calibrated scenario model with new demand forecasts |

## How to try

1. Open `/gemelo/`.
2. Switch the five themes. The map layers and the KPI column change; the municipal compare stays.
3. Switch a scenario. The map fits that geography. Use **Abrir estas capas en Mapas**.
4. Change the scatter axes or click a municipality (map, dot, or table).
5. Read recommendations: they follow the theme and the scenario, and they say they are not a parcel model.

## Files

- `src/pages/gemelo.astro`, `src/lib/cdtModel.ts`
- `src/pages/cdt.astro`, `src/pages/decision.astro`, `src/pages/decision-twin.astro` (redirects)
- `netlify.toml` (alias redirects; `/gemelo` is no longer forced to `/resumen`)
- `src/lib/ia.ts`, `src/i18n/ui.ts`, `src/layouts/BaseLayout.astro`, `public/header-search.js`
- `scripts/build_chat_corpus.py`
- Links from `/crecimiento` and `/foresights`
