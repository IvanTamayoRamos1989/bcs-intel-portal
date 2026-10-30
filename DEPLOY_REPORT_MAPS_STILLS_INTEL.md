# Deploy — Maps UX + Stills Intelligence (2026-09-16)

Prod: https://bcs-intel-portal.netlify.app  
Map UX deploy: https://app.netlify.com/projects/bcs-intel-portal/deploys/6aaaba5a92dd58757d4ae58f  
Intelligence RAG deploy: https://app.netlify.com/projects/bcs-intel-portal/deploys/6aaac0de9f9f8abd7ffd47d6  
Unique: https://6aaac0de9f9f8abd7ffd47d6--bcs-intel-portal.netlify.app

## PART A — Maps
- `/mapas` GIS: stills layer `defaultOn: false` in `public/gis/layers.json` (toggle remains).
- `/stills`: OSM standard default (`tile.openstreetmap.org`), basemap switcher (OSM / OpenTopoMap / Esri Imagery); CSS forces `filter: none` on tiles; ocean-ish load background (not washed gray). Gallery + photos kept.

## PART B — Stills intelligence
- Script: `scripts/build_stills_intelligence.py` (spatial STRtree + gpt-4o-mini vision on thumbs; JSONL resume).
- **956/956** spatial + vision OK.
- Outputs: `src/data/stills_intelligence.json`, `public/stills_intelligence_slim.json`, `public/chat_stills_knowledge.json` (964 chunks), `STILLS_INTELLIGENCE_REPORT.md`.
- Chat: `build_chat_corpus.py` merges stills knowledge → `netlify/functions/chat_corpus.json` (2954 chunks; 964 type=still). Redeployed functions so RAG retrieves them.
