# Deploy report — chat water quantity RAG (2026-09-16 ~19:56 Europe/Madrid)

**URL:** https://bcs-intel-portal.netlify.app  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6aaaf458c4b518bd1b61b59f

## Changes
- `netlify/functions/chat.mjs`: EN/ES water+quantity triggers; hard-boost ontology DMA / `guides/agua` / `02_water` CONAGUA; demote demographics on water intents; k=10–12; quantitative estimate system prompt; demographic-file fallback only for population questions.
- `scripts/build_chat_corpus.py`: ontology ResourceCapacity/Constraint water nodes + curated `water:bcs-dma-snapshot` chunk; water keyword tags on DMA PDFs/guides.
- Corpus rebuilt (~2976 chunks) into `public/`, `netlify/functions/`, `dist/`.

## Verify
- Water consumption → estimate from DMA deficits (~53 hm³/yr four poles / ~63.88 pack), sources agua/ontology/CONAGUA — not INEGI demography.
- SJC population → 136,285 (INEGI 2020) still works.
- POER → planning PDFs still works.
