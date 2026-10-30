# Deploy — Decision OS (ChatGPT PC review backlog)

**When:** 2026-09-20 ~18:51 CEST (Europe/Madrid)  
**Prod:** https://bajacaliforniasur2050.com · https://bcs-intel-portal.netlify.app  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6ab00f102998d1548e5e70cc  
**Unique:** https://6ab00f102998d1548e5e70cc--bcs-intel-portal.netlify.app  
**Password:** BCS2050  
**Reviews:** `foresights_swarm/PORTAL_REVIEW_CHATGPT_PC.md` · `MIES_URBANISM_INTEL_REVIEW.md`

## Thesis shipped

Portal moves toward a **place-based decision operating system**:

**Place → strategic question → evidence → lenses → disagreement → demand/supply + capacity → planning position → evidence gap → next action.**

## Phases completed

### Phase 1 — Strategic Question object (highest)
- Data: `src/data/strategic_questions.json` (+ public + chat bundle)
- 8 seeded questions (Cabos water–energy, East Cape edge, La Paz capital, Loreto ANP, Comondú non-offset, Mulegé evidence desert, Todos Santos amenity, carrying-capacity metrics)
- Pages: `/preguntas/`, `/preguntas/[id]/`; aliases `/questions/`
- Wired from Ask actions/chips, DebateConsensus CTA, `/lugares` dossiers, `/crecimiento` SQ links, `/sesion`

### Phase 2 — `/lugares` as primary spine
- BCS aggregate interdependency note (Cabos ≠ BCS)
- Strategic questions + session CTA per dossier
- Lugares first under Studio nav

### Phase 3 — Inspectable `/crecimiento` + carrying capacity
- Explicit layers: market demand · territorial supply · carrying capacity
- Per-place inspectable constraint panel (known load / known capacity / gaps) from GDS cells only; blanks = unknown
- Links to related strategic questions

### Phase 4 — Foresights as monitored hypotheses
- `hypothesis_monitor` on foresights.json + UI block (confirm / weaken / places / watch indicators with FACT/ASSUMPTION)

### Phase 5 — Ask strategy copilot
- System prompt: Answer → claims → sources → contradictions → uncertainty → spatial scope → what would change this
- Returns `strategic_questions` + `actions` (dossier, growth, map, compare, create SQ, missing evidence, session)
- ChatWidget renders action chips

### Phase 6 — Place strip clarity
- Visible **BCS-wide** reset chip + live “Contexto: …” state
- Strip z-index raised vs Ask sheet

### Phase 7 — Studio IA
- Nav: **Studio** (Lugares, Preguntas, Prospectiva, Crecimiento, Sesión) · Explorar · Evidencia · Temas · Lugar & mercado

### Phase 8 — Stakeholders ↔ questions
- SQ detail “Quién debe participar” from `stakeholder_ids` heuristics

### Phase 9 — Mobile + governance (partial)
- Freshness chips on SQ, foresights, session
- Ask sheet 3-state → **done 2026-09-20 leftovers ship**; still deferred: deeper progressive evidence disclosure

### Phase 10 — Strategy Session
- `/sesion/` (+ `/strategy-session/`): per-place 7-block brief; BCS-wide when strip cleared; print/PDF CSS

## Guardrails kept
- No invented statistics; FACT/ASSUMPTION tags
- Decision twin still redirects to `/resumen/`; F+P fichas hidden
- Prior P0/P1/dossiers/news-flights feeds preserved

## Deferred / next
- Full quantitative “committed additions / 2050 requirement” columns when portal has those series
- Richer stakeholder↔SQ graph editing UI
- Ask bottom-sheet collapsed/partial/full states → **done 2026-09-20 leftovers ship**
- Resumen place-aware KPIs → **done 2026-09-20 leftovers ship** (MIES U6)
- EN guide prose / map figcaptions (ux-p2 leftover) → **done 2026-09-20 leftovers ship**
- Custom-domain `/api/auth` 404 quirk (verify via netlify.app)

## Files (this deploy)
- `src/data/strategic_questions.json`, `public/strategic_questions.json`, `netlify/functions/strategic_questions.json`
- `src/pages/preguntas/index.astro`, `src/pages/preguntas/[id].astro`
- `src/pages/sesion.astro`
- `src/pages/lugares.astro`, `src/pages/crecimiento.astro`, `src/pages/foresights.astro`
- `src/components/ChatWidget.astro`, `src/components/PlaceStrip.astro`, `src/components/DebateConsensus.astro`
- `public/place-strip.js`, `netlify/functions/chat.mjs`, `netlify.toml`, `src/i18n/ui.ts`
- `src/data/foresights.json` (+ public/functions mirrors) — hypothesis_monitor
- `DEPLOY_REPORT_REVIEW_EXEC.md`, `DEPLOY_REPORT_DECISION_OS.md`

## Prior related deploys (same day)
- P0 place strip + foresights argument — `6ab000383531444ecd69e4b5`
- P1 Ask chain + debate + news/flights — `6ab00249e77affdcc49b278c`
- Place dossiers `/lugares` — `6ab007c4699140b1aea808e0`
- This Decision OS slice — `6ab00f102998d1548e5e70cc`

## Leftovers ship — Ask 3-state + Resumen KPIs + ux-p2 (2026-09-20)

**When:** 2026-09-20 ~18:55 CEST (Europe/Madrid)  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6ab00fe4b7fae6c1aa4df1ae  
**Unique:** https://6ab00fe4b7fae6c1aa4df1ae--bcs-intel-portal.netlify.app  
**Prod:** https://bajacaliforniasur2050.com  
**Message:** `Decision OS leftovers: Ask 3-state sheet + Resumen place KPIs + EN/maps captions`

### Shipped this pass

| Item | Status | Notes |
|------|--------|-------|
| Ask mobile 3-state bottom sheet | **Shipped** | `collapsed` (FAB) → `partial` (~48vh) → `full` (near viewport); partial/full toggles in header; swipe-down on head / Escape steps down; place strip preserved; desktop sidebar unchanged |
| Resumen place-aware KPIs | **Shipped** | Each KPI card lists 3 driving vocations with links to `/crecimiento?place=` (GDS) and `/lugares?place=` (dossier) |
| ux-p2 EN guide prose | **Shipped** | Expanded EN blocks for thin guides (agua, energia, conectividad, economia, historia, planeacion, riesgos, territorio); ambiente already ~parity |
| Map / stills figcaptions | **Shipped** | Bilingual alt + `map-cap-so` theme caption on `/mapas` gallery; stills category EN + short so-what line |
| Foresights mobile cards (optional) | **Shipped** | Single-column argument card padding/typography polish ≤640px |

### Verification

- Local `astro build`: 57 pages OK
- Prod unique: `/resumen/` shows `kpi-drivers` chips; chat markup includes `bcs-chat-sheet-controls` + `data-sheet` JS; `/mapas/` has `map-cap-so`; `/agua/` EN contains “Annual mean availability”
- Desktop Ask: sidebar always open (min-width 901px rules unchanged)

### Remaining gaps (honest)

- EN guide tables (especially planeacion) still ES-heavy — prose EN improved, full table parity not attempted
- Ask sheet state preference persists `partial`/`full` in localStorage; collapsed is default on mobile load
- Twin + F+P remain hidden (by design)
- No invented carrying-capacity numeric thresholds beyond portal FACT cells
- Drag-handle / rubber-band sheet animation not implemented (buttons + swipe on head only)
- Resumen “driving vocations” are editorial mappings from known portal concentrations — not a statistical attribution model

### Files touched

- `src/components/ChatWidget.astro`
- `src/pages/resumen.astro`
- `src/content/guides/{agua,energia,conectividad,economia,historia,planeacion,riesgos,territorio}.md`
- `src/pages/mapas.astro`
- `src/pages/stills.astro`
- `src/pages/foresights.astro`
- `DEPLOY_REPORT_DECISION_OS.md` (this section)

## Studio municipal hub + review-notes scrub (2026-09-20)

**When:** 2026-09-20 ~19:55 CEST (Europe/Madrid)  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6ab0392e7fdfaa48ec54d580  
**Unique:** https://6ab0392e7fdfaa48ec54d580--bcs-intel-portal.netlify.app  
**Prod:** https://bajacaliforniasur2050.com  

### What changed
- **Studio IA** simplified to `/studio/` with **6 units only**: BCS (state) + Los Cabos + La Paz + Loreto + Comondú + Mulegé.
- Each `/studio/[muni]/` aggregates vocation, demand–supply, strategic questions, foresight signals, instruments/mobility/tenure — one scroll, “ver detalle” links only.
- Nested vocations stay inside municipios (East Cape → Los Cabos; Todos Santos → La Paz).
- Nav **Studio** group is a single entry (`/studio`). Preguntas / foresights / crecimiento moved under Evidence as library routes.
- PlaceStrip primary chips: **BCS + 5 municipios** (still maps to vocation place ids for filters).
- `/lugares` becomes a client redirect into `/studio/...` (honors `?place=`).
- User-facing copy scrubbed of review-note jargon; dossier fields renamed to `structure_note_*` in dossiers / scripts.

### Municipio → vocation place ids
| Studio id | Place ids |
|-----------|-----------|
| `bcs` | all seven |
| `los_cabos` | `los_cabos`, `east_cape` |
| `la_paz` | `la_paz`, `todos_santos` |
| `loreto` | `loreto` |
| `comondu` | `comondu` |
| `mulege` | `mulege_north` |

### Redirects / demotions
- `/places`, `/lugar` → `/studio/`
- `/lugares` → client map to `/studio/{muni}/` via `?place=`
- `/preguntas`, `/foresights`, `/crecimiento`, `/sesion` remain bookmarked; demoted from Studio chrome
- SVG schematics stay at `/lugares/*.svg` (static assets)

### Remaining gaps
- Full EN table parity in topic guides still ES-heavy
- Decision twin + F+P fichas still hidden
- Ask still receives vocation `place` ids (compatible); Studio path used in action chips
