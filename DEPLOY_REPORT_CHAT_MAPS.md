# Deploy report — Chat maps / stills P1b (spatial RAG)

**Date:** 2026-09-23 ~12:20 Europe/Madrid (UTC+2)  
**Repo:** `/workspace/BCSFP/11_bcs_hub`  
**Site:** https://bajacaliforniasur2050.com (Netlify `bcs-intel-portal`)  
**Auth:** portal password (unchanged)

## Goal

Make maps and stills meaningfully usable in chatbot answers (describe what spatial sources show, cite them) without an in-browser CV model. Depth + retrieval, not vision inference at chat time.

## Deploy

| Field | Value |
|-------|--------|
| **Deploy id** | `6ab3a77d68a091b7ed0115f7` |
| Production | https://bajacaliforniasur2050.com |
| Unique | https://6ab3a77d68a091b7ed0115f7--bcs-intel-portal.netlify.app |
| Logs | https://app.netlify.com/projects/bcs-intel-portal/deploys/6ab3a77d68a091b7ed0115f7 |
| Prior build in same thread | `6ab3a6b07543125cc0dcce9d` (first P1b); place-tag fix → `6ab3a77d…` |

## What improved

1. **Denser stills knowledge** (`scripts/enrich_stills_chat_knowledge.py` → `public/chat_stills_knowledge.json`)
   - Captions: place, municipio (bbox-inferred when missing), what’s visible (vision), GIS context, approx. lat/lon when present, Territory ontology ids, links to `/stills` `/mapas` `/earth-studio`
   - Municipio cards denser (e.g. Los Cabos **165** frames vs ~15 tagged-only before; Loreto **57**)
   - Overview + ontology bridge chunks kept/enriched
2. **Corpus build** (`scripts/build_chat_corpus.py`)
   - Passes `municipio` / `lat` / `lon` / `ontology_ids` / `href` on still chunks
   - Adds spatial portal guides: `/mapas`, `/earth-studio`, `/stills`, `/studio`
   - Adds up to 18 thematic JPG gallery cards (PDU Cabos, POER, DMA, atlas) with **place-aware** tags (no false “Los Cabos” on La Paz DMA maps)
3. **Retrieval** (`netlify/functions/chat.mjs`)
   - `isSpatialIntent` (mapa, cartografía, GIS, still, imagen, vista, satélite, Earth Studio, ubicación, lat/lon, …)
   - Stronger stills + Territory ontology + mapas guides boosts; hard-prefer 1–2 still/map sources in top-k
   - Citations prefer stills/map paths when spatial; skip foresight-query bias on spatial intents
   - System prompt: describe what spatial sources show + link; **do not invent coordinates**
4. **Safety**
   - PIB path unchanged offline + live (**187,152**)
   - Conversation memory still logs (`memory_log.ok: true` on smokes)

## Corpus counts (post-build)

| Metric | Value |
|--------|--------|
| Chunks | **3286** |
| By type | file 1800 · still **965** · fact 227 · guide **188** · ontology 90 · municipio 16 |
| Stills knowledge | 956 stills + 9 summaries (incl. overview / corridors / onto bridge) |
| Spatial portal guides | 4 + 18 gallery map cards |

## Offline verify (retrieve top-k)

| Query | Result |
|-------|--------|
| qué muestra el mapa de Los Cabos | stillmuni:Los Cabos #1, still:overview, terr_obs_cabos_coast / PDU, portal:mapas-gis |
| stills Loreto costa | stillmuni:Loreto #1 + stills ANP Loreto + terr_obs_loreto_bay |
| cartografía GIS Bahía de Loreto | stills + Territory Loreto |
| ubicación stills East Cape | still:overview + terr_obs_east_cape |
| PIB constante BCS INEGI | facts/guides economy; **not** spatial |

## Live smoke (auth + POST /api/chat)

- Login OK.
- *qué muestra el mapa de Los Cabos* → cites **Stills / mapa por municipio — Los Cabos** (165 fotogramas; costa / coberturas / lugares); href `/stills`; memory ok.
- *stills Loreto costa* → cites Loreto municipio stills + ANP still; memory ok.
- *PIB constante BCS INEGI* → **187,152** mdp; economy guides; memory ok.

## Files touched

- `scripts/enrich_stills_chat_knowledge.py` (new)
- `scripts/build_chat_corpus.py`
- `public/chat_stills_knowledge.json`
- `public/chat_corpus.json` + `netlify/functions/chat_corpus.json`
- `netlify/functions/chat.mjs`
- `DEPLOY_REPORT_CHAT_MAPS.md` (this file)

## Out of scope

- Full in-browser CV / Earth Studio frame decoder
- Re-running vision API on stills (reused existing `stills_intelligence.json`)

## Blockers

None.
