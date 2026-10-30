# Deploy report — chat open-question + ontology RAG (2026-09-16 22:14 CEST)

**URL:** https://bcs-intel-portal.netlify.app  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6aaaf889d2ec30e0a69f88a8

## Prompt / retrieval changes
- Rewrote ES+EN system prompt: synthesize across docs+ontology; answer directly first; cite; transparent estimates; no unrelated file dumps; demographic fallback only for population Qs.
- Always inject ontology slice (term overlap + 1-hop neighbors from `ontology_graph.json`); reserved 3–5 ontology slots (skipped for pure population Qs).
- Open-question intent (why/how/cuánto/cómo/compare/estimate/constrains/…) → k=12–14; diversify guides + ontology + theme PDFs + stills. Pure “cuánta población…” stays demographic (not open-Q).
- Thematic boosts kept (water, energy, planning, demography, tourism/ANP, growth constraints).
- Rank sources: ontology + Drive with substance; demote weak filename-only; census preferred on population Qs.
- Corpus: **all 90** ontology nodes (with 1-hop relation hints) type=`ontology`; rebuilt (~3046 chunks). Files: `chat.mjs`, `build_chat_corpus.py`, `ontology_graph.json`.

## Sample Q→A (prod)
1. **Water annual use** → Transparent DMA estimate (~53 hm³/yr four poles); cites ontology aquifers / CONAGUA — not INEGI.
2. **What constrains growth in Los Cabos?** → Water scarcity, DMA deficits, isolated SIBCS grid, irregular tenure, PDU 2040 — ontology constraints, not a refuse.
3. **Tourism pressure ↔ protected areas?** → `const_coast_anp_pressure` (72 stills near_coast∩ANP) + ANP núcleos veto + CONANP.
4. **SJC population** → 136,285 (INEGI Censo 2020) still works.
