# Chat triple links (file · ontology · contact)

**URL:** https://bcs-intel-portal.netlify.app  
**Goal:** Every chat answer surfaces three clear follow-ups in a fixed UI order.

## API (`netlify/functions/chat.mjs`)

After RAG + LLM, the JSON body always includes:

```json
{
  "answer": "…readable prose (no raw ontology node id dumps)…",
  "primary_file": {
    "title": "…",
    "path": "01_planning/…",
    "view_url": "https://drive.google.com/file/d/…/view",
    "download_url": "https://drive.google.com/uc?export=download&id=…",
    "catalog_url": "/catalogo?q=…",
    "why": "top catalog match · Drive link available"
  },
  "ontology": [
    {
      "id": "inst_pdu_cabos",
      "label": "PDU 2040 Los Cabos",
      "label_es": "PDU 2040 Los Cabos",
      "kind": "Instrument",
      "href": "/ontologia#inst_pdu_cabos",
      "why": "governs→Municipio de Los Cabos; depends_on→POERBCS 2026; …"
    }
  ],
  "stakeholder": {
    "id": "st-016",
    "name": "Beatriz González Gibert",
    "description": "IMPLAN Los Cabos; PDU and urban land criteria.",
    "contact": "https://…",
    "group": "Steering Committee",
    "subgroup": "…",
    "href": "/stakeholders?q=Beatriz%20Gonz%C3%A1lez%20Gibert&id=st-016"
  },
  "sources": [ { "title", "path", "drive_url" } ]
}
```

- **`primary_file`:** ranks retrieved catalog/file/guide chunks; prefers Drive-linked PDF/docs; never `08_fp_team_research`. Place-aware (Los Cabos ≠ La Paz PDU). Falls back to `catalog_url` when no Drive link.
- **`ontology`:** 2–5 graph nodes (prefer Instrument / Evidence / DecisionQuestion / Constraint) with 1-hop `why` and `/ontologia#id` hrefs. Cabos questions never attach `inst_pdu_lapaz`.
- **`stakeholder`:** heuristics against bundled `stakeholders_seed.json` (SEPUIMM, CONAGUA, IMPLAN, OOMSAPAS, CFE, …). Institutional contacts preferred; F+P leads only if the question is clearly about F+P. `null` if no good match (UI shows muted “No clear match”).
- Model instructed **not** to dump `ontology node id: …` in prose; server also scrubs common patterns.

Bundled into the function: `chat_corpus.json`, `ontology_graph.json`, `stakeholders_seed.json`.

## UI (`ChatWidget.astro`)

Below each bot answer, three labeled blocks (ES/EN via i18n):

1. **Archivo / File** — title + View / Download (Drive) and/or Open in catalog  
2. **Ontología / Ontology** — compact pills → `/ontologia#nodeId`  
3. **Contacto / Contact** — name + description + Open contact / View in Stakeholders  

Empty blocks keep structure with muted **Sin coincidencia clara / No clear match**.

Legacy source chips remain de-emphasized under the triple blocks.

## Stakeholders deep-link

`/stakeholders?q=Name&id=st-016` prefills the search box and briefly outlines the matching row.

## Example shape (Los Cabos PDU / growth)

- `primary_file` → Cabos PDU / planning PDF with Drive view+download  
- `ontology` → `inst_pdu_cabos`, water/energy constraints — **not** `inst_pdu_lapaz`  
- `stakeholder` → IMPLAN Los Cabos or Ayunt./OOMSAPAS contact when the topic matches  

Preserved: slim always-open sidebar, auth gate, RAG strengths (estimates, open questions, water/demo routing).


## Deploy

**Prod:** https://bcs-intel-portal.netlify.app  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6aaba5b9b6fe476442851abd  
**When:** 2026-09-17 ~10:33 Europe/Madrid (CEST)

Prod smoke (auth): Los Cabos growth/PDU → `inst_pdu_cabos` (not `inst_pdu_lapaz`); stakeholder IMPLAN Los Cabos; primary_file prefers Drive PDF when present.

### Example prod response shape (Los Cabos growth / PDU)

```json
{
  "primary_file": {
    "title": "2023-08_Ayuntamiento-Los-Cabos_Convocatoria-Consulta-Publica-PDU-2040.pdf",
    "view_url": "https://drive.google.com/file/d/…/view",
    "download_url": "https://drive.google.com/uc?export=download&id=…",
    "catalog_url": "/catalogo?q=…"
  },
  "ontology": [
    { "id": "inst_pdu_cabos", "kind": "Instrument", "href": "/ontologia#inst_pdu_cabos" },
    { "id": "const_dma_deficit", "kind": "Constraint" }
  ],
  "stakeholder": {
    "name": "Beatriz González Gibert",
    "description": "IMPLAN Los Cabos; PDU and urban land criteria.",
    "href": "/stakeholders?q=…&id=st-016"
  }
}
```
