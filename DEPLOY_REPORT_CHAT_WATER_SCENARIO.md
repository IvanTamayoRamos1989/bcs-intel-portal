# Deploy report — Chat water × population scenario (estimate + data-gap)

**Date:** 2026-09-23 ~14:56 Europe/Madrid (UTC+2)  
**Repo:** `/workspace/BCSFP/11_bcs_hub`  
**Prod:** https://bajacaliforniasur2050.com  
**Deploy id (final):** `6ab3cc65a77d2d9eb53d815e` (prod, `--skip-functions-cache`)  
**Unique:** https://6ab3cc65a77d2d9eb53d815e--bcs-intel-portal.netlify.app  
**Logs:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6ab3cc65a77d2d9eb53d815e

## Root cause

Not an API outage — `/api/chat` already returned HTTP 200 with substance. Hedge came from:

1. **Retrieval** for water×population scenarios preferred DMA/agua chunks; ITER ontology falsely satisfied demography, so **POBTOT 798,447** often never entered CONTEXT.
2. **`isOpenIntent`** stayed false when water-quantity + demography co-occurred.
3. **System prompt** allowed stopping at “faltan consumo y proyecciones” instead of scaling portal proxies (DMA deficit × population factor).
4. **Gap memory** did not treat “Dato que falta:” / soft hedges as `gap=true`.
5. **Voice `portal_ask`** already POSTed `message`; improved HTTP error surfacing so chat failures are not silent.

## Files changed

| File | Change |
|------|--------|
| `netlify/functions/chat.mjs` | `isScenarioIntent`; dual agua+población force-retrieve; k bump; ESTIMATE + DATA-GAP prompt (scale DMA×factor); `gapExplicit=true` on scenarios |
| `netlify/lib/chat_memory.mjs` | `detectGap`: Data-gap / Dato que falta; soft hedges; estimate+missing-input |
| `public/js/bcs-grok-voice.js` | `portal_ask`: surface `!r.ok` status/error |

## Offline verify

Scenario intent true; top chunks include statewide POBTOT fact **and** agua DMA snapshot/guides.

## Live smoke (auth OK)

Q: *¿Cuánta agua necesitaremos consumir anualmente si la población de BCS se triplica en los próximos 30 años?*

Sample (no secrets):

> Estimación basada en datos del portal: Población 798,447 (INEGI 2020) → ×3 = 2,395,341. Déficit portal ≈ 63.88 hm³/año → ×3 ≈ **191.64 hm³/año**.  
> **Dato que falta:** Consumo per cápita actual de agua en BCS…

`memory_log.gap`: **true**
