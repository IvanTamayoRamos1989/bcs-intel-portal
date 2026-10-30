# Deploy report — Chat-only landing (26 Oct 2026)

**Production deploy id:** `6adf788195ddae17c9627315` — https://bajacaliforniasur2050.com/inicio
Unique: https://6adf788195ddae17c9627315--bcs-intel-portal.netlify.app
(Same-day intermediates superseded: `6adf76fa58f1fe07df08bd13`, `6adf77d04c37a6d892d0f589`.)

## What changed
- `/inicio` (where the password gate sends people after login) is now **only the chat**, full screen, like the Grok app: a centered conversation column (max 820px), a big welcome title "Pregúntale al plan BCS 2050", 6 suggested-question cards, a rounded input box with Hablar/Escuchar/Enviar, the municipality scope chips, and in the top bar only "English" + "Resto del portal →". No portal header/nav, footer, dashboards or cards.
- The old home content (figures, topics, news, "Para especialistas") moved to **`/portal`**, and the last deploy's hero block was removed from it.
- `src/layouts/BaseLayout.astro`: new `chatHome` prop (adds the `chat-home` body class and passes `home` to `ChatWidget`).
- `src/components/ChatWidget.astro`: on `chat-home` the chat is always open and full screen (the mobile sheet logic is turned off there), and the welcome block clears after the first message. On every other page the right-hand sidebar works as before (440px).
- Rich answers (markdown tables, image/map cards, links, Data-gap callout, sources, evidence links) and voice are unchanged.

## Verification
- `npm run build` green (forbidden-terms, visible-paths, check_explorer OK).
- Prod, logged in: at 1440×900 the chat fills 1440×900; at 390×844 it fills 390×844; no page errors.
- Clicked "¿Qué áreas naturales protegidas hay en BCS?": a formatted list + Dato faltante + 2 POERBCS map cards + atlas/document links + 4 source chips.
- `/portal` loads. Screenshots: `ux_redesign_shots/chat_landing/`.

## Known nits
- On mobile the top bar wraps into 2 rows (BCS 2050 / English · Resto del portal).

## Hotfix — media must match the municipio (26 Oct 2026, 17:1x CET)
Deploy `6adf798e5f33e354b5d20e26` (prod, `--skip-functions-cache`). Bug: "¿Cuánta gente vive en La Paz?" showed Los Cabos PDU 2040 maps.
Root cause: the map-topic rule matched "la paz" → PDU 2040 (which is the Los Cabos plan).
Fix (`netlify/functions/chat.mjs`): the target municipio comes from the message first, then the UI `place`, otherwise the question is statewide. Each map is tagged by municipio (pdu2040/dma-sjc → Los Cabos; dma-la-paz/psdu → La Paz; POER/atlas/CENACE/PRODESEN = statewide). Photos are filtered by their municipio, and the document pill is dropped if its title names another municipio. With a target municipio, local media from any other municipio is never shown; if nothing matches, it is left out.
Smoke (prod API):
- La Paz población [la_paz] → text 292,241 / 250,141; blocks: only the atlas link (no Cabos maps).
- Plan urbano La Paz → PSDU Todos Santos + PSDU Barriles (both La Paz municipio), no PDU 2040.
- PDU 2040 Los Cabos zonificación → PDU 2040 maps + PDU document (Cabos media still works).
- ANP Loreto → Loreto/Nopoló photos + statewide POER maps.
