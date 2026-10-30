# Deploy report — Chat depth P0 (PIB / INEGI retrieval)

**Date:** 2026-09-23 ~11:43 Europe/Madrid (UTC+2)  
**Repo:** `/workspace/BCSFP/11_bcs_hub`  
**Site:** https://bajacaliforniasur2050.com (Netlify `bcs-intel-portal`)

## Goal

Portal chatbot returns PIB constante **187,152** for typical INEGI/PIBE queries.

## Files changed

| File | Change |
|------|--------|
| `scripts/build_drive_and_summaries.py` | Deeper PIBE/economy PDF extracts (pp.1–4, ~1800 chars, `CIFRAS:` harvest, number normalize); `refresh_economy_summaries()` |
| `src/data/file_summaries.json` | Force-refreshed 63 economy/PIBE PDF summaries (2024 BCS includes 187,152 / 187152) |
| `scripts/build_chat_corpus.py` | Wire `file_summaries.json` into file chunks; stop INEGI→demografía pollution on economy guides; economy tags/theme for PIBE |
| `netlify/functions/chat.mjs` | Economy intent; no demo hijack from bare INEGI+PIB; number token normalize; economy boosts; no foresight bias on pure factoids; k=12; promote economia/PIBE |
| `public/chat_corpus.json` | Rebuilt (synced) |
| `netlify/functions/chat_corpus.json` | Rebuilt (synced) |
| `dist/chat_corpus.json` | Via `npm run build` on deploy |

## Offline verify (retrieve)

| Query | Intent | Rank of 187,152 chunk |
|-------|--------|------------------------|
| ¿Cuál es el PIB constante de Baja California Sur según el INEGI? | economy (demo=false) | **#1** `g:economia:1` |
| PIB constante BCS | economy | **#1** `g:economia:1` |
| PIBE 2024 BCS | economy | **#1** `g:economia:1` |
| ¿Cuántos habitantes en La Paz? | demography | municipio/censo top — no regression |

## Deploy

- **Deploy id:** `6ab39f38f1b30590aa33084b` (prod, `--skip-functions-cache`)  
- Prior attempt (may have used functions cache): `6ab39f1134d62228512e58f2`  
- Production URL: https://bajacaliforniasur2050.com  
- Unique: https://6ab39f38f1b30590aa33084b--bcs-intel-portal.netlify.app  
- Logs: https://app.netlify.com/projects/bcs-intel-portal/deploys/6ab39f38f1b30590aa33084b

## Live smoke (auth + POST /api/chat)

- Login OK (password portal).  
- Q: *¿Cuál es el PIB constante de Baja California Sur según el INEGI?*  
- Answer contains **187,152**; cites guía economía + PIBE 2024 PDF.  
- Snippet: *El PIB constante de Baja California Sur para el año 2024 es de 187,152 millones de pesos… (+3.5% vs 2023).*

## Blockers

None.
