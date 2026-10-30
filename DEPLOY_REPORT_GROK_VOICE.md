# Deploy — Grok realtime voice (xAI)

**When:** 2026-09-23 (Europe/Madrid)
**Deploy id:** `6ab38676e8600ea2b6c8d181`
**Prod URL:** https://bajacaliforniasur2050.com
**Unique URL:** https://6ab38676e8600ea2b6c8d181--bcs-intel-portal.netlify.app

## What shipped
- `netlify/functions/voice-token.mjs` — portal-auth + mint ephemeral client secret via `POST https://api.x.ai/v1/realtime/client_secrets`
- `public/js/bcs-grok-voice.js` — WebSocket `xai-client-secret.${token}`, server_vad (~1000ms), voice `eve`, tool `portal_ask` → `/api/chat`
- `ChatWidget.astro` Hablar/Parar uses Grok only (no Web Speech fallback)
- Redirect `/api/voice-token` → function; auth-gate still requires cookie (same as `/api/chat`)

## How user starts/stops
1. Sign in on landing (password gate).
2. Open Consulta → tap **Hablar** (becomes **Parar**).
3. Speak; barge-in via server VAD; transcripts appear as chat bubbles.
4. Tap **Parar** to close the WebSocket and mic.

## Verification
- Unauth `POST /api/voice-token` → **401**
- Authed without `XAI_API_KEY` → **503** `{ error: "Voice not configured" }`
- Landing `/` remains password-only; `/explorar/` unauth → 302 `/`

## Blocker
**XAI_API_KEY was not on the box** (only `BCS_CHAT_API_KEY` = OpenAI `sk-`, must not be used for xAI). Netlify production also has no `XAI_API_KEY` / `BCS_VOICE_XAI_KEY`. Set an `xai-…` key on Netlify as `XAI_API_KEY` (and optionally `BCS_VOICE_XAI_KEY`), then Hablar will mint tokens.
