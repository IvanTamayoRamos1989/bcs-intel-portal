# Deploy report — Chat rich UX (26 Oct 2026)

**Production deploy id:** `6adf7163f5ae5e8638b081ee` (site `bcs-intel-portal`, `--prod --skip-functions-cache`)
- Production: https://bajacaliforniasur2050.com · https://bcs-intel-portal.netlify.app
- Unique: https://6adf7163f5ae5e8638b081ee--bcs-intel-portal.netlify.app
- (Intermediate deploy same day: `6adf70b23bed6ea85fae47d4`, superseded.)

## Files changed
- `src/pages/inicio.astro` — chat-first hero ("Pregúntale al plan BCS 2050"): big input + 6 suggested-question chips that open the docked chat and send; "Para especialistas" heading de-emphasized; desktop auto-docks the chat on arrival.
- `src/components/ChatWidget.astro` — bot bubbles render rich (markdown + blocks) via `BCSChatRender`; panel default width 440px; desktop dock default now ≥1100px (and always on /inicio); new CSS for tables, media cards, pills, "Dato faltante" callout. `bcs:chat-answer` event + `window.BCSChat` API unchanged; voice path unchanged.
- `public/js/bcs-chat-render.js` (new) — tiny DOM-only renderer (no innerHTML): paragraphs, **bold**/*em*/`code`, lists, headings, pipe/fenced tables → `<table>`, autolinks http(s) + internal `/paths`, `[label](url)` only for http(s)/internal; media blocks (image/map cards with "Ver en explorar"/"Ver en mapas"/Google Maps), table blocks, link pills.
- `netlify/functions/chat.mjs` — new `blocks[]` in response, built only from retrieved evidence: population table (municipio chunks), facts table (≥3 fact chunks), stills thumbs with coords → Google Maps, map-atlas images (evidence hits + question topic → real `/maps/*.jpg` with caption/source from corpus), atlas link, primary document link. Table block dropped when the model already drew a table. Prompt (ES/EN) now allows compact markdown tables + "mira el mapa abajo" for place/map questions, forbids writing URLs, adds "Dato faltante:" line. Number guard / grounding untouched.
- `scripts/build_chat_media.py` (new, in `npm run build`) → `netlify/functions/chat_media.json` (956 stills, 43 maps); added to `netlify.toml` included_files.
- `src/styles/global.css`, `src/styles/atlas-theme.css` — `--chat-sidebar-w` 440px (380px at 901–1180, 480px ≥1600).

## Build
`npm run build` green: forbidden-terms OK, visible-paths OK, check_explorer OK.

## Smoke (prod, auth BCS2050, Chrome headless 1440×900 + API)
- `/inicio`: hero visible, chat docked (440px), no page errors. Mobile 390px: chat collapsed to sheet tab (unchanged).
- Q "¿Cuántas personas viven en cada municipio?" → markdown table rendered as `<table>` (Los Cabos 351,111; La Paz 292,241; Comondú 73,021; Mulegé 64,022 — INEGI 2020, all in corpus), document pill, 4 source chips, chain links.
- Q "¿Qué áreas naturales protegidas hay en la costa de Los Cabos?" → bulleted answer (PN Cabo Pulmo, DOF 2009), "Dato faltante" line, 4 images (2 aerial stills + POERBCS 56 UGAs + política ambiental maps), atlas pill, Cabo Pulmo Drive doc pill, sources.
- Screenshots: `ux_redesign_shots/chat_rich/`.

## Gaps / P1
- Stills are picked by retrieval rank, not filtered by the asked place (Los Cabos ANP question showed ANP Nopoló/Loreto); filter by place/municipio.
- Some stills have grid-style names (e.g. `grid_24.150_-109.850`) as captions — humanize.
- Voice transcripts render as markdown but get no blocks (no API call).
- Only 4 of 5 municipios came back in the population answer (retrieval k); consider forcing all municipio chunks for "cada municipio" intent.
- No deep-link from map card to a specific `/mapas` anchor or explorar layer.
