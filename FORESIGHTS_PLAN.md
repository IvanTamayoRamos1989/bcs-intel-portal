## Place dossiers

- `/lugares/` (+ `/places/` alias) — seven vocation dossiers from `place_dossiers.json` (`scripts/build_place_dossiers.py`).
- Wired to PlaceStrip `?place=`, nav **Lugares/Places**, foresights + crecimiento deep-links.
- Weekly: `update_bcs_foresights.py` now calls `tag_news_flights_to_foresights.py` (U5).

# Foresights / Prospectiva — BCS 2050

**Prod:** https://bcs-intel-portal.netlify.app/foresights/  
**Aliases:** `/prospectiva`, `/foresight` → `/foresights/`  
**Data:** `src/data/foresights.json` (+ `public/foresights.json` mirror)  
**Weekly script:** `scripts/update_bcs_foresights.py` (+ `scripts/build_foresights_figures.py`)

## Intent

Make the portal more intelligent toward **BCS 2050 regional strategy** by mimicking Foster + Partners professional lenses and identified stakeholder groups in a **conversation / consensus** sense.

- **Not** dumping F+P personal fichas (`08_fp_team_research/` stays hidden).
- **Not** a public Decision twin or locked scenarios (see `DECISION_TWIN_DEFERRED.md`).
- Foresights = **signals + implications + open questions**, refreshed weekly.

## Four layers

```
1. Evidence          news.json · catalog planning · theme pages · flights
        ↓
2. Role lenses       nine professional stances (plain names, no bios)
        ↓
3. Debate / consensus   contested claims · emerging agreements · gaps
        ↓
4. Weekly foresights    edition in foresights.json → /foresights page + Ask corpus
```

| Layer | What it does | Portal surface |
|-------|----------------|----------------|
| Evidence | Curated facts and recent material | `/noticias`, `/catalogo`, theme lenses, `/vuelos` |
| Role lenses | How a discipline would read the week | Role briefs on `/foresights` |
| Debate / consensus | Claims that are emerging, contested, or missing | Consensus seeds + watchlist |
| Weekly foresights | Packaged edition for the team | `/foresights` + chat chunk |

## Role lenses (plain names)

Mapped loosely to Steering / TAG / Forum **groups** — never to private F+P people:

| `role_id` | ES | EN | Loose group map |
|-----------|----|----|-----------------|
| `territorial_development` | Desarrollo territorial | Territorial development | Steering · regional strategy |
| `vision_spatial` | Visión y marco espacial | Vision & spatial framework | Steering / TAG · planning |
| `sustainability_infra` | Sustentabilidad e infraestructura | Sustainability & infrastructure | TAG · Infrastructure & Utilities |
| `water_security` | Seguridad hídrica | Water security | Steering · Water & Energy regulators |
| `energy_grid` | Energía y red | Energy & grid | TAG · Infrastructure / regulators |
| `tourism_investment` | Turismo e inversión | Tourism & investment | Forum · economy & tourism |
| `municipal_planning` | Planeación municipal | Municipal planning | Steering · Municipal Planning Authorities |
| `environment_anp` | Ambiente y ANPs | Environment & ANPs | TAG · Environmental & Conservation |
| `community_tenure` | Comunidad y tenencia | Community & land tenure | Forum · communities / tenure |



## Portal review P1 (2026-09-20)

- Ask evidence chain: file · ontology · stakeholder · place · foresight signal (`ChatWidget` + `chat.mjs` + bundled `foresights.json` / `growth_demand_supply.json`).
- Debate/consensus deepened: status, `place_ids`, opposing lenses, next evidence ask.
- News/flights tagged into signals & places: `scripts/tag_news_flights_to_foresights.py` (run after news/flight refresh).

## Portal review P0 (2026-09-20)

- **Place strip** (`PlaceStrip.astro` + `public/place-strip.js`): persistent chrome on all portal pages + Ask panel. Selection via `?place=<id>` and `localStorage` (`bcs_place`). IDs: `los_cabos`, `east_cape`, `todos_santos`, `la_paz`, `loreto`, `comondu`, `mulege_north`.
- **/foresights as weekly argument** (order locked): (1) edition thesis → (2) signals + sources → (3) role-lens tensions → (4) debate/consensus + watchlist → (5) visuals with “so what for this place?” captions → (6) place vocation cards (strip-filtered) → (7) CTA to `/crecimiento`.
- Data: `edition_thesis_*` fields on `foresights.json`; visual captions tightened. Redirects `/prospectiva` `/foresight` unchanged.
- P0.2 `/crecimiento` scorecards already shipped — strip highlights `data-place-card` articles; do not rebuild.
- Deferred: Decision twin public UI; F+P fichas; full P1 Ask chain / Studio IA (light Ask place hint started).

## Weekly update

```bash
cd /workspace/BCSFP/11_bcs_hub
python3 scripts/update_bcs_foresights.py
# optional: rebuild Ask corpus so chat points at the new edition
python3 scripts/build_chat_corpus.py
npm run build && npx netlify deploy --dir=dist --functions netlify/functions --prod --message "Foresights weekly"
```

The script:

1. Reads `src/data/news.json`, recent `01_planning` rows in `catalog_slim.json`, and optional flight connectivity counts.
2. Clusters themes (water, energy, planning, tourism, environment) into **signals** with real `source_urls` / `portal_paths` only.
3. Refreshes bilingual role briefs, consensus seeds, and watchlist from those signals.
4. **Fails safely:** if little new material, keeps prior signals, bumps `updated`, and sets a “little change” summary.
5. Calls `build_foresights_figures.py` to regenerate maps/diagrams/charts into `public/foresights/`.

Parent agent registers the weekly routine; this doc is the runbook.


## Visual pipeline

Figures under `public/foresights/`, listed in `foresights.json` → `visuals[]`, rendered on `/foresights`.

| Asset | File | Source |
|-------|------|--------|
| Vocation map | `vocation_map.png` | `osm_municipalities.geojson` + place anchors |
| Places GeoJSON | `vocation_places.geojson` | Leaflet layer on page |
| Signals diagram | `signals_diagram.png` | `signals[]` |
| Flights chart | `constraints_flights.png` | `flight_connections_bcs.json` (SJD/LAP/LTO) |
| DMA chart | `constraints_dma.png` | `focus_water_dmas.geojson` |
| Counts chart | `constraints_counts.png` | stills + DMA + airports |
| Role tensions | `role_tensions.png` | water · energy island · Cabos vs rest |
| Stills strip | `stills/*.jpg` | existing portal stills near places |

```bash
# regenerate (also called at end of weekly update):
.venv-foresights/bin/python scripts/build_foresights_figures.py
# or:
python3 scripts/update_bcs_foresights.py
```

Stack: **matplotlib + shapely** (no full QGIS). One-time:

```bash
python3 -m venv .venv-foresights
.venv-foresights/bin/pip install matplotlib shapely numpy pillow
```

Page UX: full-width vocation map near top, charts interleaved, EN/ES captions, lightbox, optional Leaflet, mobile-safe. Preserves auth, F+P hide, no decision-twin page, place-vocation model.



## Growth demand–supply (prerequisite)

Before public scenarios, each place vocation has a **demand vs supply** scorecard on `/crecimiento` (`growth_demand_supply.json`). Weekly foresights should:

1. Prefer citing **gap** cells when a signal lacks a number (e.g. Loreto DMA, amenity rooms Todos Santos, Cabos PDU status).
2. Link portal paths to `/crecimiento#<place_id>` alongside `/agua`, `/energia`, `/vuelos`.
3. Keep balance reads qualitative (`constrained` / `contested` / `headroom` / `unknown`) — do not invent statistics in the weekly edition.
4. State roll-up on `/crecimiento` is the “what must be true for 2050” checklist; foresights `system_view` should stay consistent with it.

Method: `GROWTH_DEMAND_SUPPLY.md`. Rebuild Ask after JSON edits: `python3 scripts/build_chat_corpus.py`.

## Guardrails

- Auth gate, mobile bottom chat, stakeholders directory: unchanged.
- No public Decision twin / scenarios page.
- No F+P personal fichas in catalog, search, or chat downloads.
- Page disclaimer: internal intelligence / draft foresight — **not** an official plan.

## Place vocations (geographic backbone)

BCS is **not** one uniform future. Foresights structure the state as **territorial vocations**: each location has a distinct role; the **sum** of vocations = a coherent 2050 strategy.

| Place | Indicative vocation |
|-------|---------------------|
| Los Cabos / San José–Cabo San Lucas | Tourism–growth engine; water & energy stress |
| East Cape / Cabo del Este | Coastal growth pressure; ANP / Cabo Pulmo tension |
| Todos Santos–El Pescadero | Pacific spine; amenity migration |
| La Paz | Capital, services; water–energy coupling |
| Loreto | Tourism + conservation; mid-peninsula node |
| Ciudad Constitución / Comondú | Agri / service hub; desal & irrigation pilots |
| Mulegé / north (optional) | Sparse corridor; green-H2 / remote energy signals |

Each weekly edition carries `places[]` cards (vocation, strengths, constraints, portal links, open question) plus a short `system_view` sentence on how vocations must add up. **Role lenses** still apply; **places** are the geographic backbone of signals and consensus.

## Swarm merge (2026-09-19)

Inputs under `foresights_swarm/` merged into the seed edition:

| File | Into |
|------|------|
| `places_claude.md` | `places[]` (+ sum_2050 / open questions) |
| `roles_astra.md` | `role_briefs[]` |
| `system_view_antigravity.md` | `system_view_es` / `system_view_en` |
| `signals_kimi.md` | (present) aligned with `signals[]` from news.json |

Weekly script preserves `places` / `role_briefs` / `system_view` across regenerations and notes swarm filenames in `swarm_sources`.
