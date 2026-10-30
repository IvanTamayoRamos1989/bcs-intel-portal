# Deploy — ChatGPT portal review P0 exec

**When:** 2026-09-20 ~17:48 CEST (Europe/Madrid)  
**Prod site:** https://bajacaliforniasur2050.com  
**Netlify alias:** https://bcs-intel-portal.netlify.app  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6ab000383531444ecd69e4b5  
**Unique URL:** https://6ab000383531444ecd69e4b5--bcs-intel-portal.netlify.app  
**Message:** `P0 place strip + foresights weekly argument (ChatGPT review exec)`

Password gate unchanged (`BCS2050`).

## URLs (verified authenticated on netlify.app)

| Surface | URL |
|---------|-----|
| Foresights (weekly argument) | https://bcs-intel-portal.netlify.app/foresights/ |
| Alias ES | https://bcs-intel-portal.netlify.app/prospectiva/ → `/foresights/` |
| Alias EN | https://bcs-intel-portal.netlify.app/foresight/ → `/foresights/` |
| Growth scorecards (P0.2, unchanged logic) | https://bcs-intel-portal.netlify.app/crecimiento/?place=loreto |
| Place strip script | https://bcs-intel-portal.netlify.app/place-strip.js |
| Place deep-link example | https://bcs-intel-portal.netlify.app/foresights/?place=la_paz#la_paz |

Also mirrored on `bajacaliforniasur2050.com` (same deploy). Note: custom-domain `/api/auth` returned 404 from this box at verify time (pre-existing routing quirk); portal pages + auth work on `bcs-intel-portal.netlify.app`.

## What shipped (P0)

### P0.1 — Persistent place-vocation strip
- Reusable `PlaceStrip.astro` + `public/place-strip.js`
- Shared IDs in `src/lib/places.ts`: `los_cabos`, `east_cape`, `todos_santos`, `la_paz`, `loreto`, `comondu`, `mulege_north`
- Persist via `?place=<id>` + `localStorage` (`bcs_place`); sync chips; highlight/dim `[data-place-card]` / `[data-place-item]`; deep-links to `/foresights/` and `/crecimiento/`
- Chrome copy: **Lugares = BCS 2050** / **Places = BCS 2050**
- Mounted in `BaseLayout` (all portal pages, incl. foresights, mapas, resumen, stakeholders, noticias, crecimiento) and compact strip inside `ChatWidget` (Ask)

### P0.2 — Growth demand–supply
- **Not rebuilt.** Strip filters/highlights existing scorecards via `data-place-card={pl.id}`; CTA from foresights keeps place query.

### P0.3 — Foresights as weekly argument
Page order locked:
1. Edition thesis (headline + summary + system view)
2. Signals with sources
3. Role-lens disagreements / tensions (+ role_tensions figure)
4. Debate/consensus + watchlist (`DebateConsensus.astro`)
5. Visuals with “so what for this place?” captions
6. Place vocation cards (strip-filtered) + link to `/crecimiento`
7. Clear CTA to demand–supply ledger

Data: `edition_thesis_*` on `foresights.json`; visual captions tightened. Redirects `/prospectiva`, `/foresight` kept. `FORESIGHTS_PLAN.md` updated.

### P1 started (light, non-blocking)
- Ask sends `place` from strip; `chat.mjs` biases retrieval + system prompt; returns `foresight_signal`; client shows place · foresight chips
- `DebateConsensus.astro` on foresights from `consensus_seeds` + watchlist

## Guardrails kept
- Decision twin / scenarios public routes still deferred (redirects untouched)
- F+P fichas (`08_fp_team_research`) stay hidden
- No invented statistics

## Deferred (P1/P2 from review)
- Full Ask Evidence → Lens → Debate → Foresight chain UI
- News/flights auto-tag into signals
- Studio IA regroup / mobile one-thumb foresights polish
- Place-aware Resumen KPIs
- Stakeholders living graph; ontology outbound spine links
- Public filter when going public later

## Files changed
- `src/lib/places.ts` (new)
- `src/components/PlaceStrip.astro` (new)
- `src/components/DebateConsensus.astro` (new)
- `public/place-strip.js` (new)
- `src/layouts/BaseLayout.astro`
- `src/components/ChatWidget.astro`
- `src/pages/foresights.astro` (rewrite)
- `src/pages/crecimiento.astro` (`data-place-card` + scroll-margin)
- `src/data/foresights.json` + `public/foresights.json`
- `netlify/functions/chat.mjs` (place spine + foresight_signal)
- `FORESIGHTS_PLAN.md`
- `DEPLOY_REPORT_REVIEW_EXEC.md` (this file)

## Blockers
- None for P0 deploy. Custom-domain `/api/auth` 404 observed from verify box (netlify.app auth OK); not introduced by this slice — flag for follow-up if users hit it on `bajacaliforniasur2050.com`.


---

## P1 — Ask chain · debate depth · news/flights inputs

**When:** 2026-09-20 ~17:57 CEST (Europe/Madrid)  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6ab00249e77affdcc49b278c  
**Unique URL:** https://6ab00249e77affdcc49b278c--bcs-intel-portal.netlify.app  
**Message:** `P1 Ask chain + debate depth + news/flights into foresights`  
**Prod:** https://bajacaliforniasur2050.com · https://bcs-intel-portal.netlify.app

### URLs verified (auth BCS2050 on netlify.app)

| Surface | URL |
|---------|-----|
| Foresights debate + provenance | https://bcs-intel-portal.netlify.app/foresights/ |
| Signal deep-link | https://bcs-intel-portal.netlify.app/foresights/?signal=sig-water-energy-coupling#signal-sig-water-energy-coupling |
| News → feeds into | https://bcs-intel-portal.netlify.app/noticias/ |
| Flights → feeds foresights | https://bcs-intel-portal.netlify.app/vuelos/#feeds-foresights |
| Feeds index JSON | https://bcs-intel-portal.netlify.app/foresights_feeds.json |
| Growth (unchanged P0.2) | https://bcs-intel-portal.netlify.app/crecimiento/ |

### What shipped

**P1.1 — Ask evidence chain**
- `ChatWidget` renders short chips: File · Ontology · Stakeholder · Place · Foresight signal(s); omits missing links (no fake “no match” row per slot).
- `chat.mjs` bundles `foresights.json` + `growth_demand_supply.json`; infers place from strip or query; injects spine into CONTEXT; returns structured `place` + `foresight_signals[]`.
- System prompt: prefer short synthesis; do not invent missing chain links.

**P1.2 — Debate/consensus deepened**
- `DebateConsensus.astro`: status, place chips, opposing lenses, next evidence ask + CTAs.
- `consensus_seeds` enriched via `tag_news_flights_to_foresights.py` (places, lenses, next_evidence ES/EN).

**P1.3 — News & flights as inputs**
- Script `scripts/tag_news_flights_to_foresights.py` tags news → `place_ids` + `feeds_into`; signals/places get `provenance` (news_ids, flight_refs); writes `public/foresights_feeds.json`.
- `/noticias` “Alimenta →” chips to signals/places; `/vuelos` “Alimenta la prospectiva” cards (SJD/LAP/LTO → place + signals).
- Foresights signals/place cards show provenance chips.

### Guardrails kept
- Decision twin / gemelo redirects unchanged; F+P fichas still hidden.

### Deferred (remaining P1/P2)
- News/flights auto-ingest into weekly `update_bcs_foresights.py` (script is separate; run after refresh).
- Studio IA regroup; mobile one-thumb foresights polish; place-aware Resumen KPIs.
- Custom-domain `/api/auth` 404 quirk (P0 note) still observed from verify box — use netlify.app for auth checks.

### Files changed (P1)
- `scripts/tag_news_flights_to_foresights.py` (new)
- `public/foresights_feeds.json` (new)
- `src/components/DebateConsensus.astro`
- `src/components/ChatWidget.astro`
- `netlify/functions/chat.mjs`
- `netlify/functions/foresights.json` (+ growth mirror)
- `netlify.toml` (chat included_files)
- `src/data/foresights.json` + `public/foresights.json`
- `src/data/news.json`
- `src/pages/foresights.astro`
- `src/pages/noticias.astro`
- `src/pages/vuelos.astro`
- `FORESIGHTS_PLAN.md`
- `DEPLOY_REPORT_REVIEW_EXEC.md` (this P1 section)


---

## Place dossiers — MIES U1 / §5

**When:** 2026-09-20 ~18:20 CEST (Europe/Madrid)  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6ab007c4699140b1aea808e0  
**Unique URL:** https://6ab007c4699140b1aea808e0--bcs-intel-portal.netlify.app  
**Message:** `Place dossiers /lugares (MIES U1) + weekly tag fold`  
**Prod:** https://bajacaliforniasur2050.com · https://bcs-intel-portal.netlify.app

### URLs

| Surface | URL |
|---------|-----|
| Lugares index | https://bcs-intel-portal.netlify.app/lugares/ |
| Alias EN | https://bcs-intel-portal.netlify.app/places/ → `/lugares/` |
| Place deep-link | https://bcs-intel-portal.netlify.app/lugares/?place=loreto#loreto |
| Evidence desert | https://bcs-intel-portal.netlify.app/lugares/?place=mulege_north#mulege_north |
| Structure SVG | https://bcs-intel-portal.netlify.app/lugares/los_cabos_structure.svg |
| Data | https://bcs-intel-portal.netlify.app/place_dossiers.json |

### What shipped

- **IA:** `/lugares/` single page with 7 dossier sections (`data-place-card` + `#id`); PlaceStrip `?place=` scroll/highlight; nav **Lugares / Places**; aliases `/places`, `/lugar`.
- **Each dossier (1 scroll):** vocation (+ MIES U1 note) · demand–supply summary → `/crecimiento` · contested claims (embedded DebateConsensus) · instrument chips PDU/POEL/PMD/ANP (on_disk / gap, FACT) · mobility gate (SJD 56 / LAP 7 / LTO 5 only where in pack) · tenure + open evidence ask · structure reading + SVG schematic.
- **Data:** `src/data/place_dossiers.json` via `scripts/build_place_dossiers.py`; SVGs in `public/lugares/*_structure.svg`. FACT/ASSUMPTION tags throughout. Known holes: La Paz PMDU full text; Loreto PMD/PSDU.
- **Links:** foresights place cards + crecimiento scorecards → dossier; strip deep-link “Dossiers”.
- **U5 secondary:** `update_bcs_foresights.py` calls `tag_news_flights_to_foresights.py` after edition write.

### Guardrails
- No invented flight/route counts beyond pack; Decision twin + F+P still hidden; P0/P1 spine kept.

### Files (this slice)
- `scripts/build_place_dossiers.py` (new)
- `src/data/place_dossiers.json` + `public/place_dossiers.json` (new)
- `public/lugares/*_structure.svg` (7 new)
- `src/pages/lugares.astro` (new)
- `src/i18n/ui.ts`, `netlify.toml` redirects
- `src/components/PlaceStrip.astro`, `public/place-strip.js`
- `src/components/DebateConsensus.astro` (embedded mode)
- `src/pages/foresights.astro`, `src/pages/crecimiento.astro`
- `scripts/update_bcs_foresights.py` (U5 fold)
- `FORESIGHTS_PLAN.md`, `DEPLOY_REPORT_REVIEW_EXEC.md`

### Blockers
- None for dossiers deploy. Instrument chips are catalog-heuristic (honest gaps labeled); deeper Drive “on Drive” status not separately detected beyond on_disk path. Custom-domain `/api/auth` quirk from earlier still noted.


---

## Decision OS — PC review backlog (Phases 1–10 slice)

**When:** 2026-09-20 ~18:51 CEST (Europe/Madrid)  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6ab00f102998d1548e5e70cc  
**Unique:** https://6ab00f102998d1548e5e70cc--bcs-intel-portal.netlify.app  
**Message:** `Decision OS: SQ + Studio IA + capacity panels + Strategy Session + Ask actions`

### Phase status

| Phase | Status |
|-------|--------|
| 1 Strategic Question object | **Shipped** — 8 seeded SQs, `/preguntas/` + detail, `/questions/` alias |
| 2 Deepen `/lugares` | **Shipped** — BCS aggregate, SQ links, session CTA; Lugares primary in Studio nav |
| 3 Inspectable `/crecimiento` + capacity | **Shipped** — demand/supply/capacity layers + inspectable constraint panels |
| 4 Foresights monitored hypotheses | **Shipped** — confirm/weaken/places/watch indicators |
| 5 Ask strategy copilot | **Shipped** — structured prompt + actions + SQ chips |
| 6 Place strip clarity | **Shipped** — BCS-wide label + live context chip + z-index |
| 7 Studio IA | **Shipped** — Studio / Evidence / Themes regroup |
| 8 Stakeholders ↔ questions | **Shipped** — “who must participate” on SQ pages |
| 9 Mobile + governance chips | **Partial** — freshness chips on SQ/foresights/session; Ask sheet states not fully rebuilt |
| 10 Strategy Session | **Shipped** — `/sesion/` (+ `/strategy-session/`), print CSS |

### Key URLs

- https://bcs-intel-portal.netlify.app/preguntas/
- https://bcs-intel-portal.netlify.app/preguntas/sq-cabos-water-energy/
- https://bcs-intel-portal.netlify.app/lugares/
- https://bcs-intel-portal.netlify.app/crecimiento/
- https://bcs-intel-portal.netlify.app/sesion/
- https://bcs-intel-portal.netlify.app/foresights/#hypothesis
- https://bcs-intel-portal.netlify.app/strategic_questions.json

See also `DEPLOY_REPORT_DECISION_OS.md`.

