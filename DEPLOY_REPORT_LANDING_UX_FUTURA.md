# Deploy report: Landing UX "futura" (26 Oct 2026)

- **Production deploy:** `6adf92820aeb8cb63d263384`. Live at https://bajacaliforniasur2050.com/inicio. Unique preview: https://6adf92820aeb8cb63d263384--bcs-intel-portal.netlify.app
- Draft preview, no API keys: `6adf91ef681f0bed84e2855a`
- Command: `npx netlify deploy --prod --no-build --dir=dist --functions=netlify/functions --site bcs-intel-portal --skip-functions-cache`. Passing `--build` fails in the CLI, so run `npm run build` first.
- Backup of the previous chat function: `/tmp/chat.mjs.bak`

## Changes
- `src/components/ChatWidget.astro`
  - Dark institutional-futurist shell, scoped to `body.chat-home`: deep blue/teal gradients, a faint grid, a glow on the input, a teal→blue send button and a dark place strip.
  - New welcome: kicker line, gradient title, purpose line, and asset counters (5 municipios / 43 mapas / 956 fotos aéreas). The counters are real asset counts.
  - The 6 starter questions are now cards with a thumbnail from a real map or still, plus a topic label.
  - Bot answers sit on a light "paper" card for readability.
  - Charts and follow-up chips are rendered.
  - Mobile: the top bar no longer wraps.
- `public/js/bcs-chat-render.js`: new `chart` block (animated CSS bars). A line starting with `👉` is styled as the follow-up question.
- `netlify/functions/chat.mjs`
  - Prompt (ES and EN): every answer must end with one `👉` follow-up question. The same applies when there is no evidence.
  - Server guarantees: if the last line has no `?`, it appends one. The response now includes `followUps: string[]` (up to 3): the model's question plus topic/place-aware chips (`buildFollowUps`, `FU_TOPICS`).
  - Charts come only from numbers in retrieved chunks: municipality population (≥2 municipios), municipio vs. cabecera vs. remainder (single municipio), and DMA by aquifer (≥2 numeric DMA facts).
  - Media caps raised: maps 2→4, stills 3→4. The place filter is unchanged.
- `scripts/_landing_futura_shots.mjs`: before/after screenshots → `ux_redesign_shots/landing_futura/`

## Smoke test (prod)
- "Cuanta gente vive en la paz?" → 292,241 / 250,141 (INEGI 2020), chart, 👉 question + 3 chips. No Los Cabos maps.
- ANP en La Paz → DMA La Paz map + POER maps + CONANP Sierra La Laguna document + chips.
- Plan urbano Los Cabos → PDU 2040 maps.
- Population for every municipio → table + bar chart.

## Gaps
- No videos in `public/`, so none are shown and no URLs were invented.
- No La Paz city PDU map. A La Paz population answer can say "mira el mapa abajo" when only the atlas link is shown.
- The first chip is the model's own question, which can be yes/no in style.
