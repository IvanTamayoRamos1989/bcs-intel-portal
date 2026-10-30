# Deploy report — Chat depth P1 (portal facts + ontology facets)

**Date:** 2026-09-23 ~11:55 Europe/Madrid (UTC+2)  
**Repo:** `/workspace/BCSFP/11_bcs_hub`  
**Site:** https://bajacaliforniasur2050.com (Netlify `bcs-intel-portal`)

## Goal

Deeper, ontology-aware portal chatbot: structured fact cards from guide tables, richer priority-theme PDF/CSV extracts, Spanish facet → ontology type mapping with **2-hop** graph expansion — without regressing P0 PIB **187,152**.

## Files changed

| File | Change |
|------|--------|
| `scripts/extract_portal_facts.py` | **New** — parse GFM tables in `src/content/guides/*.md` → structured facts |
| `src/data/portal_facts.json` | Generated (227 facts) |
| `public/portal_facts.json` | Public copy |
| `scripts/build_chat_corpus.py` | Emit `type: "fact"` chunks; PIBE CSV enricher; Spanish ontology facet synonyms |
| `scripts/build_drive_and_summaries.py` | `is_priority_pdf` + deeper extracts; `_harvest_priority_cifras`; `refresh_priority_summaries` for water/energy/SETUE/ports/planning |
| `src/data/file_summaries.json` | Priority theme PDFs refreshed (deeper extracts where files exist) |
| `netlify/functions/chat.mjs` | Facet map; 2-hop BFS ontology; fact/facet k=12; prefer `fact`/`guide`; skip foresight bias on fact/facet; stills boost for mapa/cartografía |
| `public/chat_corpus.json` | Rebuilt |
| `netlify/functions/chat_corpus.json` | Rebuilt |
| `netlify/functions/ontology_graph.json` | Synced from graph |
| `dist/*` | Via `npm run build` |

## Counts

| Metric | Value |
|--------|-------|
| Portal facts extracted | **227** |
| Facts by theme | {'agua': 24, 'conectividad': 17, 'economia': 16, 'turismo': 10, 'energia': 10, 'riesgos': 29, 'territorio': 27, 'ambiente': 50, 'historia': 7, 'planeacion': 37} |
| Corpus chunks | **3264** |
| Corpus by type | {'file': 1800, 'guide': 166, 'municipio': 16, 'fact': 227, 'ontology': 90, 'still': 965} |
| Ontology nodes | 90 |
| Ontology hop depth | **2** (BFS) |
| Ontology slot cap (facet) | ~8–12 |

## Offline verify (retrieve)

| Query | Intent | Result |
|-------|--------|--------|
| ¿Cuál es el PIB constante de BCS según INEGI? | economy+fact | **#1** `fact:economia:…` with **187,152** (guide also in top) |
| restricciones agua Los Cabos | facet→Constraint | Constraint / ResourceCapacity ontology in top-k (2-hop neighbors) |
| actores clave turismo BCS | facet→Actor | Actor nodes (SETUE, CONANP, CEA, ayuntamientos, …) in top-k |
| DMA déficit acuífero Cabo San Lucas | fact | `type=fact` agua DMA rows (0317 −24.07, …) in top-k |
| habitaciones hotel Los Cabos | fact | turismo fact card (hoteles/habitaciones) present in top-k |

No PIB regression vs P0.

## Deploy

- **Deploy id:** `6ab3a1c832a4a390791cffa7` (prod, `--skip-functions-cache`)
- Production URL: https://bajacaliforniasur2050.com
- Unique: https://6ab3a1c832a4a390791cffa7--bcs-intel-portal.netlify.app
- Logs: https://app.netlify.com/projects/bcs-intel-portal/deploys/6ab3a1c832a4a390791cffa7

## Live smoke (auth + POST /api/chat)

- Login OK (portal password).
- Q: *¿Cuál es el PIB constante de BCS según INEGI?* → answer contains **187,152**; cites guía economía.
- Q: *restricciones agua Los Cabos* → Constraint ontology (escasez hídrica / DMA déficit) in sources; cites acuíferos 0317/0319 deficits.

## Out of scope (noted)

- P2 conversation memory / Blobs
- Full map vision (only light stills boost when query says mapa/cartografía)

## Blockers

None.
