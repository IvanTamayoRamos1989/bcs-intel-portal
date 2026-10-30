# Deploy: Ontology EN i18n + interconnection diagram

**When:** 2026-09-15 ~22:34 CEST  
**Prod:** https://bcs-intel-portal.netlify.app/ontologia/  
**Deploy:** https://6aa9abbf0d612b83df335ecd--bcs-intel-portal.netlify.app  
**Message:** Ontology: EN i18n + visual interconnection diagram

## EN i18n
- Root cause: `graph.json` nodes had only Spanish `label`/`summary`; list + edge endpoints rendered without `data-lang-*` gates.
- Fix: added `label_en`/`summary_en` for all 81 nodes (faithful translations, numbers preserved); `src/data/ontology_i18n.json` as durable map; `export_graph.py` merges i18n on regenerate.
- Page: every entity name/summary + relation From/To gated with `data-lang-es` / `data-lang-en`; Mermaid text diagram bilingual.

## Diagram
- Library: Cytoscape.js 3.30.4 (CDN)
- Default: decision-core subgraph (~29 nodes: aquifers, SIBCS, airports, DMA/ANP locks, key instruments/actors/projects, carrying-capacity DQ)
- Toggle: Full graph (81 nodes / 212 edges)
- Click → highlight neighbors + bilingual detail panel; legend by type (F+P cyan family + distinct hues); Reset view; mobile scrollable canvas

## Preserved
Auth gate, no ontology file downloads, F+P cyan, Data wording.
