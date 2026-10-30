# Deploy — Organigrama Los Cabos (2026-09-30)

- Data: BCSFP/14_gobierno/los_cabos_organigrama_2024_2027.{json,csv,md,png} (99 units, 92 named heads, 7 without name).
- Corpus: scripts/build_chat_corpus.py → add_los_cabos_organigrama(): 16 chunks `gobierno:los-cabos:*` (type guide, theme gobierno), source "Organigrama General H. XV Ayuntamiento de Los Cabos (BOGE #14, 29 feb 2024)".
- chat.mjs: isGovWhoQuery() — "who runs X in Los Cabos" skips foresight bias, pins top-2 organigrama chunks in context and cites them first.
- Ontology (12_ontology/ontology.yaml → export_graph.py): +10 nodes (ev_organigrama_cabos, actor_cabos_presidencia, 7 actor_cabos_dg_*, actor_cabos_delegaciones), +33 edges; OOMSAPAS/IMPLAN summaries add titular. 148 nodes / 493 edges.
- Page: /studio/los_cabos/ section #gobierno-municipal (image + table). Image at /gobierno/los_cabos_organigrama_2024_2027.png.
- Deploy: 6abd26ca0522f043b00fc1da (prod). Backup: BCSFP/_bak_organigrama/.
