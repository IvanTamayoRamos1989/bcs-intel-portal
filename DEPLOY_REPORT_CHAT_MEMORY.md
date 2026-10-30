# Deploy report — Chat memory + knowledge gaps (P2)

**Date:** 2026-09-23 ~12:08 Europe/Madrid (UTC+2)  
**Repo:** `/workspace/BCSFP/11_bcs_hub`  
**Site:** https://bajacaliforniasur2050.com (Netlify `bcs-intel-portal`)

## Goal

Server-side conversation memory so the team can see what people ask, spot themes, and export **knowledge gaps** when the bot cannot answer — without breaking P0/P1 retrieval.

## What shipped

| Piece | Detail |
|-------|--------|
| Turn log | After each successful `POST /api/chat`, append a turn to Netlify Blobs (`bcs-portal`) |
| Store shape | Per-turn keys `chat-turns/{id}` + index `chat-turns-index` (avoids clobber races; `list()` unreliable in this Functions env) |
| Privacy | Truncated `q` (500) / `a_preview` (300); hashed session id; sources paths only; **no passwords / API keys** |
| Gap flag | Heuristic on refuse / no-data language (+ optional `gap` boolean from client) |
| Themes | `theme_guess` from intents / keywords |
| Rate / size | Chat IP rate limit unchanged (30/min); memory write rate 40/min; body cap **48 KB** |
| Voice | `portal_ask` → same `/api/chat` (logging automatic); sends `voice: true` + session id |
| Client session | `sessionStorage` key `bcs_chat_sid` (uuid) in ChatWidget + voice |

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/chat` | Portal cookie | Answers + logs turn (`memory_log` in JSON) |
| GET | `/api/chat-memory?limit=50` | Portal cookie | Recent turns, themes, top questions |
| GET | `/api/chat-memory?gaps_only=1` | Portal cookie | Only gaps |
| GET | `/api/chat-memory?export=gaps&format=json\|csv&limit=200` | Portal cookie | Downloadable gap list |

## How Ivan opens the gap list

1. Log in at https://bajacaliforniasur2050.com (password **BCS2050**).
2. Open **https://bajacaliforniasur2050.com/memoria/** (also under nav Evidencia → “Memoria chat”).
3. Filter **Solo brechas**, or download:
   - JSON: `/api/chat-memory?export=gaps&format=json&limit=200`
   - CSV: `/api/chat-memory?export=gaps&format=csv&limit=200`

## Files

| File | Change |
|------|--------|
| `netlify/lib/chat_memory.mjs` | **New** — Blobs helpers, gap heuristic, index |
| `netlify/functions/chat-memory.mjs` | **New** — GET memory / export |
| `netlify/functions/chat.mjs` | Log turn after answer; body size cap |
| `netlify.toml` | `/api/chat-memory` redirect; Blobs external for chat + chat-memory |
| `src/components/ChatWidget.astro` | Session id in POST body |
| `public/js/bcs-grok-voice.js` | Session + `voice: true` |
| `src/pages/memoria.astro` | **New** — Spanish admin table UI |
| `src/i18n/ui.ts` | Nav + copy |

## Deploy

- **Deploy id:** `6ab3a4c5f1b305aed5330865` (prod, `--skip-functions-cache`)
- Production: https://bajacaliforniasur2050.com
- Unique: https://6ab3a4c5f1b305aed5330865--bcs-intel-portal.netlify.app
- Logs: https://app.netlify.com/projects/bcs-intel-portal/deploys/6ab3a4c5f1b305aed5330865

## Smoke (auth)

| Check | Result |
|-------|--------|
| Login | OK |
| PIB question | Answer contains **187,152**; `memory_log.ok=true`, `gap=false` |
| Nonsense / no-data question | `memory_log.ok=true`, `gap=true`; appears in export |
| `GET /api/chat-memory` | Returns turns + themes |
| `/memoria/` | HTTP 200 (auth-gated by edge) |
| P0/P1 retrieval | PIB still answered correctly |

### Sample counts (after smoke)

| Metric | Approx. |
|--------|---------|
| Stored turns | **10** |
| Gaps | **6** (includes earlier heuristic false-positives from pre-fix deploys) |
| Index ids | **8** |
| Themes seen | economia, agua, otro |

Disable logging without redeploy: set env `CHAT_LOG_BLOBS=0`.

## Notes

- Strong Blobs consistency is **not** available in this Functions environment (`uncachedEdgeURL` missing) — index + per-turn keys used instead.
- Legacy key `chat-turns` (single JSON array from first attempt) is still merged on read.
- `memory_log` on chat responses is a small non-secret status object for ops/smoke; safe to ignore in the UI.
