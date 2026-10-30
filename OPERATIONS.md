# BCS 2050 portal — Operations

Site: https://bajacaliforniasur2050.com (Netlify site `bcs-intel-portal`). Astro static site + Netlify functions
(`/api/auth`, `/api/chat`, `/api/chat-memory`, …). Repo: `/workspace/BCSFP/11_bcs_hub`.

## Hard rules
- No invented names or numbers. An estimate must be labelled as an estimate. The chat answers only from portal evidence.
- No F+P staff profiles or assignments in the portal.
- No internal tool, vendor or platform names in public text. Run `rg -i "\bmies\b" dist` after every build; it must return nothing.
- Light theme. The BORRADOR badge is hidden in production (`CONTEXT=production`).
- Do not re-add the public scenario or decision-twin screens.
- Secrets (`BCS_CHAT_API_KEY`, `XAI_API_KEY`, `BCS_PORTAL_SESSION_SECRET`, `BCS_PORTAL_PASSWORD`) live only in Netlify env vars. Never print or commit them.

## 1. Backup (always first)
```bash
bash scripts/backup_data.sh       # -> /workspace/BCSFP/_backups/bcs_hub_data_<ts>.tar.gz (keeps the 15 newest)
```
Restore: `cd /workspace/BCSFP/11_bcs_hub && tar -xzf /workspace/BCSFP/_backups/bcs_hub_data_<ts>.tar.gz`, then rebuild.
For a full snapshot including images, use `tar -czf /workspace/BCSFP/_backups/11_bcs_hub_<ts>.tar.gz --exclude=node_modules --exclude=dist 11_bcs_hub`.

## 2. Data refresh order
```bash
python3 scripts/build_catalog.py                       # rescans the lake; honours src/data/catalog_exclusions.json
SKIP_SUMMARIES=1 python3 scripts/build_drive_and_summaries.py   # Drive links + slim (always derived from catalog.json)
python3 scripts/enrich_file_summaries.py               # pass 1: text of PDFs/MD/CSV/XLSX/JSON/KML
python3 scripts/enrich_thin_entries.py                 # pass 2: images/ESP/ZIP/DOC/GIS/OCR; writes catalog_exclusions.json
python3 scripts/apply_catalog_enrichment.py            # merge summaries + exclusions + Drive ids (scripts/drive_links_manual.json)
python3 scripts/build_wishlist.py                      # data_gaps.json → wishlist from no_content exclusions
python3 scripts/build_escorrentia.py                 # runoff layers + escorrentia.json (from 16_escorrentia)
python3 scripts/build_aquifers.py                      # 39 BCS aquifers (DOF 2023) + agua guide tables
python3 scripts/extract_portal_facts.py                # portal_facts.json
python3 scripts/build_data_inventory.py                # data_inventory.json (lineage + figures + count check)
python3 scripts/build_chat_corpus.py                   # netlify/functions/chat_corpus.json (RAG corpus)
```
Check that `data_inventory.json` → `catalog_count.reconciled` is `true`. catalog.json, catalog_slim.json and folders_summary.json must have the same count.

Filename-only entries: pass 1 and pass 2 must leave no public entry without a real summary. If a file's content cannot be
obtained, it is removed from the catalogue (`catalog_exclusions.json`, reason `no_content`) and listed in
`src/data/data_gaps.json` → `wishlist` (shown on `/memoria`). Internal tooling (scripts, logs, copy maps, backups) is
excluded with reason `non_document`. Broken downloads whose content exists in another lake file are excluded as `superseded`
(map in `SUPERSEDED` in enrich_thin_entries.py). Scanned plans with no OCR-able text can get a summary written from a visual review
(`MANUAL` in enrich_thin_entries.py; source `visual_review`).

Caution: `build_catalog.py` rewrites catalog_slim.json and drops the Drive fields. To add a few new lake files without a full rescan:
`python3 scripts/add_catalog_files.py <relpath> ...`, then run pass 1, pass 2 and apply_catalog_enrichment.py.

## 3. Build
`npm run build` = ingest_studies.py → `update_bcs_news.py --check` (news guard) → clean_data_labels.py + clean_source_labels.py (plain source labels) → build_chat_corpus.py (includes the news feed) → check_card_titles.mjs → build_explorer_assets.mjs (atlas JS/CSS) → astro build → check_forbidden_terms.mjs → check_visible_paths.mjs → check_explorer.mjs (atlas gate, section 10).
```bash
CONTEXT=production npm run build
rg -i "\bmies\b" dist ; rg -c "BORRADOR" dist | head     # the first command must return nothing
```

## 4. Chat evaluation (before every production deploy)
- Battery: `scripts/eval/questions_es.json` (106 questions = original 100 + 6 news; regenerate with `python3 scripts/eval/make_questions.py`).
- Offline gate, no LLM, no secrets. It checks whether the retrieved context holds the facts each question needs:
  `node scripts/eval/offline_context_eval.mjs netlify/functions/chat.mjs new`
- Live or staging, end to end: `node scripts/eval/run_eval.mjs --base <url> --label <label> --concurrency 2 --gap 2600`
  → `scripts/eval/results/<label>_<ts>.{json,md}`. Scores: accuracy, invented numbers, correct refusals, sources on refusals.
- **Pass mark (Ivan, 2026-10-08):** ≥ 91 on the original 100 questions (E001–E100) AND ≥ 5/6 on the news questions
  (`cat: "noticias"`, E101–E106), with 0 invented numbers. Stored in `questions_es.json` → `gate`; the offline gate prints
  `GATE PASS/FAIL` and exits 1 on FAIL; `run_eval.mjs` reports the gate in the summary/.md and exits 1 on FAIL.
- Also: invented numbers must not increase vs the last live run.
- Spot-check retrieval: `node scripts/eval/local_retrieval.mjs "pregunta"`.

## 5. Staging
```bash
npx netlify deploy --dir=dist            # draft URL https://<hash>--bcs-intel-portal.netlify.app
```
Caveat: `BCS_CHAT_API_KEY` / `XAI_API_KEY` are scoped to the **production** context only. On a draft deploy the chat
answers "El chat no está configurado en el servidor". Static pages can be checked on staging. To test the chat on
staging, add the *Deploy previews* / *Branch deploys* scope to those two variables in the Netlify UI (Site configuration
→ Environment variables). This is an owner decision. Until then, use the offline gate (section 4) before deploying, and
run the live eval right after deploying, ready to roll back.

## 6. Production deploy
```bash
CONTEXT=production npm run build && npx netlify deploy --prod --dir=dist
```
Rollback: Netlify UI → Deploys → previous deploy → "Publish deploy" (or `npx netlify api restoreSiteDeploy`).

## 7. Live verification
- Pages: `/resumen/`, `/catalogo/` (header count = list count), `/studio/<muni>/` (Cifras clave + Agua: acuíferos + "Exportar expediente (PDF)"), `/agua/#acuiferos`, `/memoria/` (wishlist).
- JSON: `/data_inventory.json`, `/aquifers_bcs.json`, `/catalog_slim.json`, `/data_gaps.json`.
- Chat: `POST /api/auth` with the portal password returns cookie `bcs_portal_auth`; `POST /api/chat` with `{message, lang}`
  returns `grounded`, `evidence_count`, `sources`. Run the live eval (section 4).
- `curl -s https://bajacaliforniasur2050.com/js/bcs-grok-voice.js > /tmp/v.js && node scripts/check_forbidden_terms.mjs ../../../tmp/v.js` must pass (forbidden-term check, hashes only).

## Capacity studies (Phase 0, offline) — 2026-10-08
- `npm run build` = see section 1 (news guard, label cleaners, corpus, astro, check_forbidden_terms.mjs — fails build on forbidden internal terms, hashes only — and check_visible_paths.mjs).
- Studies: `/workspace/shared/bcs_studies/<muni>/*.json` → `src/data/studies/<muni>.json` (whitelist summary incl. totals refs, pending assumptions, breakdowns, growth, water, data gaps) + `src/data/studies/units/<study_id>.json` (per-unit rows). Section `#estudios-capacidad` on /studio/<muni>/ and chat chunks only with `PUBLIC_STUDIES_ENABLED=1` (off; not deployed).
- Los Cabos request package: `python3 scripts/build_study_request.py los_cabos` → `/workspace/shared/bcs_studies/_requests/los_cabos/` (EPSG:32612). Sources are clean citations (title/owner/dataset/year/licence/method/caveat + separate `url`); lake paths live only in `LAKE_PATH` and a leak guard aborts if a path, file name or host appears in citation text. `BCS_REQUESTS_OUT` overrides the output dir (for dry runs).
- Preview with the flag (never in dist): `PUBLIC_STUDIES_ENABLED=1 npx astro build --outDir /tmp/dist_flag`. Do not run `build_chat_corpus.py` with the flag before a production deploy.
- Plan/notes: `/workspace/shared/bcs_studies/BCS_INGESTION_PLAN.md`, `CONTRACT_v0.1_BCS_NOTES.md`.

## 8. Daily news → chat knowledge (RAG) — 2026-10-08
Every news item is a chat chunk (`type: "news"`), so every build/deploy carries the current feed. Nothing to remember:
`npm run build` always rebuilds the corpus from `src/data/news.json` + `src/data/news_archive.json`.

Daily flow (routine, weekdays 07:05 Madrid):
1. `python3 scripts/update_bcs_news.py [--merge curated_items.json] [--no-search]`
   - searches, then MERGES new items into the existing feed (dedupe by normalised URL and normalised title);
     existing items are never dropped. Curated items (with a paraphrased `blurb_es/en`) can be merged from a JSON file
     (list or `{"items": [...]}`); a curated item replaces a `_needs_review` placeholder with the same URL/title.
   - retention: last 365 days stay in `news.json`; older items move to `news_archive.json` (still in the chat corpus).
   - guard: exit 2 and nothing written if feed+archive would shrink, if any existing item would disappear, or if
     `news.json` cannot be parsed. Backups of every write: `scripts/_cache/news_backups/` (30 newest).
   - then runs `tag_news_flights_to_foresights.py` and `build_chat_corpus.py` (skip with `--no-tag` / `--no-corpus`).
     `--dry-run` merges and checks without writing.
2. If the routine edits `news.json` by hand instead, run `python3 scripts/tag_news_flights_to_foresights.py`.
3. `CONTEXT=production npm run build` — `update_bcs_news.py --check` fails the build if any item ever published
   (ledger `src/data/news_ledger.json`) is missing from feed + archive (catches truncation by any tool or manual edit),
   then `build_chat_corpus.py` writes one chunk per item (prints `news_chunks=N`; fails if the feed has items but 0 chunks).
4. Offline gate: `node scripts/eval/offline_context_eval.mjs netlify/functions/chat.mjs <label>` (106 questions incl. 6 `noticias`).
5. `npx netlify deploy --prod --dir=dist` — the chat function bundles `chat_corpus.json`; the BM25 index is built in memory
   from it at cold start, so the deploy is all that is needed for the chat to know the new items.

Deliberate removal of a wrong item: `python3 scripts/update_bcs_news.py --remove <url>` (recorded in `ledger.removed`; the
search will not re-add it). Restore after an accident: copy the newest file from `scripts/_cache/news_backups/`.

How the chat uses news (`netlify/lib/rag.mjs`, `netlify/functions/chat.mjs`):
- Chunk = title, outlet, date, place/municipality and topic tags, stored summary, URL (`href`). Indexed text is kept lean
  (headline + summary); tags/metadata are shown to the model in the evidence header, not indexed.
- Current-events questions (noticias, reciente, hoy, huracán, trayectoria, esperan/prevé, …) boost news with a recency factor
  relative to the newest item in the feed, max 5 news chunks. Other questions demote news (×0.75–0.85) and cap them at 2,
  so official data keeps priority.
- Prompt rule 7: news are labelled "noticia — prensa, NO oficial"; cite as "Noticia: medio, fecha"; prefer the most recent
  item; if a news item conflicts with an official source, show both and say which is official.
- Source cards: `sources[]` entries with `type: "news"`, `label: "Noticia"`, `outlet`, `date`, `url`; the chat widget shows
  them as amber "NOTICIA · medio · fecha — titular" cards linking to the article.
- Items still marked `_needs_review` (search hits without a summary) stay in the chat with the headline only, labelled
  «Noticia sin resumen» (title, evidence header and source card).
- `/noticias` shows only the latest 90 items (`NEWS_PAGE_MAX` in `src/pages/noticias.astro`) with a note that older news
  remains searchable in the chat; the chat corpus keeps every item (feed + archive).
- No script/tool names in user-visible text: enforced by `scripts/check_visible_paths.mjs` (section 9).

## 9. Source labels — no internal paths in visible text (2026-10-08)

Pages show plain source labels, never repo/lake paths or data-file names:
- Real underlying source when it is documented (e.g. «INEGI Censo 2020», «CONAGUA — disponibilidad media anual de
  acuíferos (DOF 2023)», «FlightConnections.com — rutas sin escalas (consultado 2026-09-17)», «Modelo de terreno
  HydroSHEDS / HydroRIVERS»); dated lake files `YYYY[-MM[-DD]]_<Institución>_<Título>.ext` become
  «Institución — Título (año)» from the file name itself.
- Otherwise the generic «Base de datos BCS 2050 — <tema>». Never invent a source.
- One rule set, two mirrors: `scripts/source_labels.py` (data/guides) and `src/lib/sourceLabel.ts` (components:
  `cleanSourceText`, `labelForPath`, `docTitle`; `lakePath`/`fileName` in `src/lib/paths.ts` return labels).
  Add new dataset labels to both maps.
- `scripts/clean_data_labels.py` rewrites display fields (source, sources, note, method, caveat, summary, …) in
  `src/data`, `public` and `netlify/functions` JSON; location fields (path, desktop, file, href, url, evidence_path)
  stay intact and are labelled on render. `scripts/clean_source_labels.py` does the guides. Both are idempotent and
  run in `npm run build` (`npm run labels` by hand).
- `scripts/check_visible_paths.mjs` (last build step; `npm run check:paths`) fails the build if visible text in
  `dist/**/*.html` (text nodes + title/alt/aria-label/placeholder, both languages) contains `src/data`, `BCSFP/`,
  `11_bcs_hub`, a `*.json` name, `scripts/…` or a `*.py` name. Links may still point at `/data.json` files; only the
  link text must be a plain label.

### Chat source cards — human titles only (2026-10-08)
- `build_chat_corpus.py` adds `display_title` + `theme_label` to every chunk (`add_display_titles`, rules in
  `scripts/source_labels.py::human_doc_title`): lake catalog metadata (`00_catalog/CATALOG*.csv`: title — issuer (year))
  → document heading from the indexed summary (text documents; internal/working headings are skipped) →
  «Datos BCS — <nombre> (año)» for state open-data files → «Institución — Título (año)» from dated file names →
  «Documento del acervo BCS 2050 — <tema>». `title` itself is unchanged, so retrieval is unchanged.
- `netlify/functions/chat.mjs`: `cardTitle()` for every card, the primary-document chip and the evidence headers the
  model cites; `sanitizeCards()` re-checks every response. `ChatWidget.astro::safeCardTitle()` never renders a raw
  file name (same fallback). The team memory log stores card titles; /memoria hides file names from older turns.
- Tests: `scripts/check_card_titles.mjs` (build step; `npm run check:cards`) fails if any chunk lacks a clean
  `display_title`; the offline gate and the live eval (`run_eval.mjs`) fail if any returned card title matches the
  file-name pattern (extension, underscore, or `YYYY-MM-DD_` prefix). News headlines are exempt.

## 10. Explorar — atlas territorial 3D (`/explorar`) — 2026-10-08
Route change: the former home dashboard moved from `/explorar` to **`/inicio`** (same content; brand link, Inicio tab and
login redirect now point to `/inicio`; the old `/inicio → /explorar` redirects were removed). `/explorar` is the atlas.
`/mapas` is untouched. Old `/explorar` bookmarks now open the atlas.

Files
- Page: `src/pages/explorar.astro` (own full-screen chrome, reuses `ChatWidget` → same `/api/chat`).
- Code: `src/explorer/0*.js` and `src/explorer/1*.css` → concatenated by `scripts/build_explorer_assets.mjs` into
  `public/explorar/explorer.{js,css}` (do not edit those two outputs by hand).
- Data: `python3 scripts/build_explorer_data.py` (≈7 s) → `public/explorar/data/` (manifest, base, bands, index, knowledge,
  13 `layer-*.json`), `public/explorar/terrain/` (18 Terrarium tiles z5–7, overview cache), `vendor/` (MapLibre GL 5.6.2),
  `fonts/` (DM Sans). Re-run it after changing GIS sources, escorrentía, energy (OSM) layers, ITER, news, foresights,
  questions, federal projects or aquifers. It aborts if a vertex is not a source vertex or if a text leaks a path.
- Chat hooks in `ChatWidget.astro`: `window.BCSChat` (open/close/prefill/send) and the `bcs:chat-answer` event (used for
  the "Localizar" chips). No effect on other pages.
- Docs: `/workspace/BCSFP/18_ux_territorial/README_EXPLORAR.md`.

Gate (`node scripts/check_explorer.mjs`, part of `npm run build`): no `#000`/`#000000`/`black`/`rgb(a)(0,0,0)` in atlas
CSS/JS/page; manifest counts = features; full provenance on every layer and base source; every feature has key, name and
valid geometry inside the BCS frame; no synthetic points (only original OSM nodes in energy layers, flagged); aquifers
never drawn without polygons; no visible paths/filenames; reduced-motion, Escape, focus, WebGL fallback and OSM
attribution present; first-load raw budget 2.6 MB.

E2E + screenshots (headless Chrome, SwiftShader WebGL):
```bash
node /workspace/BCSFP/18_ux_territorial/verify/serve_dist.mjs &          # dist on :4321 with auth stub
node /workspace/BCSFP/18_ux_territorial/verify/e2e_explorar.mjs          # local
BASE=https://bajacaliforniasur2050.com node /workspace/BCSFP/18_ux_territorial/verify/e2e_explorar.mjs   # live, incl. chat
```
Screenshots go to `/workspace/BCSFP/_screenshots/explorar_*.png`; results to `verify/e2e_results_{local,prod}.json`.

Base maps: Ilustrado (own style + hillshade), Satélite = EOxCloudless **2016** (CC BY 4.0, attribution shown). The
2018–2025 EOX mosaics are CC BY-NC-SA: do not switch without a commercial licence. Nocturno = NASA GIBS
`VIIRS_Night_Lights` 2016 (public domain) on a navy base with hillshade. Relief tiles: AWS Terrain Tiles (Terrarium),
sea flattened to 0 m in the client.

Live check after deploy: `/explorar/` loads, Capas shows 13 layers + Acuíferos (por ubicar), click a city → ficha,
"Preguntar sobre esto" opens the docked chat prefilled, answer shows "Localizar" chips. `rg -i "\bmies\b" dist` empty.
Rollback: section 6 (publish the previous deploy).

Deploy history for the atlas (Madrid time): pre-atlas rollback target `6ac77a48c80ed3dde738fdf9` (13:11); first atlas deploy
`6ac7aaa11eb205d9698fd7bb` (~16:36); current `6ac7af23992ae1ef0a8aebb3` (~17:05). Post-deploy verification:
`BASE=https://bajacaliforniasur2050.com node /workspace/BCSFP/18_ux_territorial/verify/e2e_explorar.mjs` (23 checks incl. chat)
and `node /workspace/BCSFP/18_ux_territorial/verify/live_health.mjs` (portal pages 200, no BORRADOR, chat grounded).

## 11. Chat — municipio vs cabecera population (2026-10-08) and Netlify badge

**Problem:** "¿Cuántos habitantes tiene La Paz según el Censo 2020?" was answered with 250,141 (the La Paz *city*,
cabecera) instead of 292,241 (the *municipio*). Same risk for Loreto (18,052 municipio vs 16,311 city).
**Verified first** against the raw INEGI ITER 2020 zip (`05_demographics`, LOC=0000 municipal rows and LOC=0001 cabeceras):
Los Cabos 351,111 / San José del Cabo 136,285 · La Paz 292,241 / La Paz 250,141 · Comondú 73,021 / Ciudad Constitución 43,805 ·
Mulegé 64,022 / Santa Rosalía 14,357 · Loreto 18,052 / Loreto 16,311 (state 798,447). Portal data already matched.
**Fix (corpus / fact cards / retrieval / prompt):**
- `scripts/build_chat_corpus.py`: `m:<municipio>` card leads with the municipal total and names the cabecera as a locality;
  `m:loc:<cabecera>` card retitled "Población de la localidad X, cabecera del municipio Y" and always carries the municipal
  total (for La Paz/Loreto it states the name is shared and the municipal figure is the default); no file names in card text.
- `src/data/portal_facts.json` + `public/portal_facts.json`: 15 population fact metrics relabelled (values untouched), e.g.
  "Población del municipio La Paz (POBTOT municipal, municipio completo)" / "Población de la localidad cabecera … (no es el total municipal)".
- Guides: territorio/historia table headers say "POBTOT municipal" vs "POBTOT de la localidad"; historia §6 no longer says
  Cabo San Lucas + San José del Cabo ≈ 351k (they sum 338,979 of the municipal 351,111).
- `netlify/lib/rag.mjs` `pinMunicipalPopulation()`: population question naming a municipio (or explicit place) → municipal card
  first, cabecera card second; "ciudad/localidad/cabecera" or a cabecera name (Santa Rosalía…) → locality first; other localities
  (Cabo San Lucas) keep normal ranking; projection/scenario questions untouched.
- `netlify/functions/chat.mjs` prompt (ES + EN): "población de <municipio>" = municipal total; cabecera named separately; shared
  names → municipal first; no file names.
Live test: `node /workspace/BCSFP/18_ux_territorial/verify/live_pop_chat.mjs base,orig,alt,gente` (20 questions) and `live_city_chat.mjs`.

**"Powered by Netlify" badge:** edge-injected by Netlify (`/.netlify/scripts/hud?variant=public`) on Free-plan projects created on
or after 2026-08-19 (this project: 2026-09-15). Not in our code. Turned off at no cost with the per-project setting
(UI: Project configuration > General > Powered by Netlify badge; API field `built_with_badge_enabled=false`). No redeploy needed.
If it ever reappears, check that setting first.

Deploys: chat fix `6ac7b40d360a5f3881ced03c` (2026-10-08 ~18:03 Madrid); rollback target `6ac7af23992ae1ef0a8aebb3`.


## 12. Rediseño del portal — mismo estilo que el atlas + navegación simplificada (2026-10-08)

- **Estilo compartido:** `src/styles/atlas-theme.css` (cargado por `BaseLayout` después de `global.css`): tokens del atlas (papel #f4f0e6, panel #fbf8f1, tinta #23374a — nunca negro puro —, azul mineral #34607d, salvia, arena, terracota), DM Sans, botones/pastillas redondeados, tarjetas, tablas con desplazamiento en móvil, grupos plegables (`details.pt-group`). Colores fijos de páginas y componentes remapeados con `18_ux_territorial/redesign/remap_colors.py` (el atlas no se toca).
- **Arquitectura de información (fuente única `src/lib/ia.ts`):** barra superior igual a la del atlas: BCS2050 (→ /inicio) · Explorar · Temas ▾ (6 temas) · Documentos ▾ · Noticias · buscador · Preguntar · Ayuda y fuentes · ES|EN. Móvil: BCS2050 · Preguntar · Menú (cajón con temas plegables) + buscador. Ruta (Inicio › Tema › Página) en todas las páginas. Páginas nuevas: `/temas`, `/ayuda`. Se quitaron menús duplicados (menú agrupado antiguo, barra de pestañas iOS, hoja "Más", "Accesos rápidos"). Todas las URLs siguen igual; los alias antiguos siguen redirigiendo.
- **Asistente:** "Preguntar" abre/cierra el panel en cualquier página. En escritorio el panel queda acoplado y recuerda si se cerró (`localStorage bcs_chat_docked`; por defecto abierto solo en pantallas ≥1500 px). En el atlas el comportamiento no cambia (`DOCKABLE` solo con `body.has-chat-sidebar`).
- **Paridad:** `node 18_ux_territorial/redesign/crawl_inventory.mjs <out.json>` + `node parity_check.mjs inventory_before.json inventory_after.json` → 0 faltantes (rutas, 1023 enlaces externos, 47 archivos, datasets, tablas/gráficas/mapas/imágenes/formularios por página, chat/voz/buscador/idioma/salir/filtro de municipio).
- **Deploy:** `6ac7e99aeac465742b1452c8` (publicado 2026-10-08 21:07 Madrid, producción). **Rollback:** `6ac7b40d360a5f3881ced03c` (`npx netlify api restoreSiteDeploy --data '{"site_id":"<site>","deploy_id":"6ac7b40d360a5f3881ced03c"}'` o "Publish deploy" en la UI).
- **Verificación live:** atlas e2e 23/23; 19 páginas + datos 200; puerta de acceso intacta (sin sesión HTML→302 /, datos→401); eval chat 97/100, noticias 6/6, 0 cifras inventadas, 0 títulos de tarjeta con nombre de archivo; sin insignia BORRADOR.

## 13. Chat: cambio de proveedor a xAI (2026-10-16)

- **Causa del 502 "LLM error" (desde ≥15 oct):** `BCS_CHAT_PROVIDER=openai` con una clave OpenAI invalidada (HTTP 401 `token_invalidated`).
- **Cambio (solo env de producción, sin cambios de código):** `BCS_CHAT_PROVIDER=xai`, `BCS_CHAT_MODEL=grok-4.20-0309-non-reasoning` (nombre explícito; `grok-4-1-fast-non-reasoning` ya se redirige), `BCS_CHAT_API_KEY` = clave xAI (la misma que `XAI_API_KEY`, que usa la voz).
- **Deploy:** `6ad1d870149109f6fd0280a7` (2026-10-16 ~09:57 Madrid, producción). **Rollback:** `6ad1b183ca79c5b2f314efa7` (ojo: el rollback solo restaura el código; el chat seguirá en xAI mientras las variables de entorno no se cambien).
- **Verificación:** build con todas las comprobaciones OK (términos prohibidos, rutas visibles, explorador); eval en vivo 98/100, noticias 6/6, 0 cifras inventadas, 0 títulos de tarjeta erróneos; pregunta general OK; población municipio La Paz 292,241; noticias recientes con tarjetas "Noticia"; `/api/voice-token` 200.
