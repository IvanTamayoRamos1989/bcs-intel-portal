# Chat depth audit — BCS Hub RAG (portal facts miss)

**Date:** 2026-09-23 (Europe/Madrid)  
**Repo:** `/workspace/BCSFP/11_bcs_hub` (Netlify: bajacaliforniasur2050.com)  
**Scope:** Why the chatbot cannot answer portal-visible facts (example: PIB constante BCS = **187,152 mdp** on `/economia`), and a concrete fix plan for deeper indexing, ontology-aware retrieval, and conversation memory / gap export.  
**Do not deploy from this note** unless explicitly requested.

---

## 1. Current architecture (short)

```
Guides (src/content/guides/*.md)  ← /economia page content
catalog_slim.json (n,p,f,e,t,y,s — NO sum_es)
file_summaries.json (optional PDF extracts; NOT wired into chat corpus today)
ontology_graph.json (Territory, Actor, ResourceCapacity, Constraint,
                     DemandDriver, Instrument, Evidence, DecisionQuestion, Project)
municipios.json / top_localities.json
chat_stills_knowledge.json
Hand-built spine (DMA snapshot, foresights, crecimiento, vuelos, …)
        │
        ▼
scripts/build_chat_corpus.py
        → public/chat_corpus.json + netlify/functions/chat_corpus.json
        │
        ▼
POST /api/chat → netlify/functions/chat.mjs
  expandQuery / SYN_GROUPS intents (demo|agua|poer|energía|turismo|crecimiento)
  lexical scoreChunk (no embeddings); default k=8
  pickOntologyNodeIds + 1-hop neighbors
  formatContext → LLM (max_tokens: 900, temperature: 0.15)
  client history: last 6 turns only (ChatWidget.astro); no server Q&A log

Voice: public/js/bcs-grok-voice.js
  tool portal_ask → same POST /api/chat with history: []
```

| Source | In corpus? | Depth |
|--------|------------|--------|
| Guide markdown (`/economia` = `guides/economia.md`) | Yes — section chunks | Tables flattened (`\|` → space); numbers kept; ~900 char clip |
| Astro page HTML / client data JSON | No (only via guides) | — |
| Drive/catalog PDFs | Yes — up to 1800 **file** rows | Almost always **filename stub** (`sum_es = title`) |
| PDF text extract | Exists in `src/data/file_summaries.json` for some PIBE PDFs | **Not wired** into chat corpus; extract clipped to **~320 chars / first 2 sentences** — often **before** the headline figure |
| CSV tabulados (PIBE sectores) | Filename stub only | No row enrichment (unlike población CSVs) |
| Ontology nodes | Yes — all ~90 nodes + 1-hop hints | Types ≠ Spanish labels (see §4) |
| Stakeholders seed | Used at answer time for chips, thin in corpus | — |
| News | Not a corpus type | 0 news chunks |
| Foresights / crecimiento / vuelos | A few hand-authored chunks | — |
| Stills | ~965 chunks | Can crowd lexical matches |

**Retrieval knobs (chat.mjs):** default `k=8`; `max_tokens=900`; every query is biased with `"foresights crecimiento vocation place"` (extra noise for factoid economy Qs). No vector index.

---

## 2. Why the PIB query failed (evidence)

### 2.1 The figure **is** on the portal and **is** in the corpus

| Location | Evidence |
|----------|----------|
| Page `/economia` | `src/content/guides/economia.md` table: `PIB constante \| **187,152** millones de pesos` |
| Corpus hit | `g:economia:1` / `guides/economia.md#1` and `g:economia:8` (“Cifras ancla”) both contain `187,152` |
| Corpus miss for raw PDF figure | File rows for `2024-12-05_INEGI_PIBE_BCS_2023.pdf` and `2025-12-05_INEGI_PIBE_BCS_2024.pdf` have `sum_es` = **filename only** |

**Chunk sample (guide — good):**
```
Producto interno (PIBE 2024, INEGI). … PIB constante   187,152 millones de pesos (+3.5% vs 2023) …
[demografía población habitantes … INEGI …]   ← pollution tag (see below)
```

**Chunk sample (PDF — useless for facts):**
```
title/path: 05_demographics/2024-12-05_INEGI_PIBE_BCS_2023.pdf
sum_es:     2024-12-05_INEGI_PIBE_BCS_2023.pdf
```

On disk, `pdftotext` of `07_economy_investment/2025-12-05_INEGI_PIBE_BCS_2024.pdf` clearly states constant-price PIB **187 152 millones de pesos**. That text never reaches the chat corpus in usable form.

### 2.2 Retrieval ranks the wrong evidence (simulated lexical scores)

Typical user phrasing: *“¿Cuál es el PIB constante de BCS según INEGI?”*

1. **`inegi` is a demographics SYN_GROUPS trigger** → `isDemoIntent = true`.
2. Demo intent adds **+8** to `05_demographics` / municipio / demografía paths.
3. PIBE PDF **filename** matches `inegi` + `pibe`/`pib`/`bcs` → ranks **#1** despite empty body.
4. Census / ITER stubs in `05_demographics` fill the rest of top-k.
5. Guide chunks with **187,152** land around **rank ~40+** → **outside default k=8**.
6. Context sent to the LLM has **no figure** → model correctly refuses or points at the PDF name (what users see).

Without the word INEGI (*“PIB constante BCS”*), economia guides rise to ~rank 4–5 and *can* enter top-k — brittle and query-dependent.

Other failure modes:
- *“PIBE de Baja California Sur”* → tokens `baja|california|sur` flood Territory/history/stills; figure ~rank 67.
- Digit forms: guide has `187,152`; PDF has `187 152`; queries with `187152` do **not** substring-match the comma form.

### 2.3 PDF pipeline depth (why the chatbot cites the PDF but cannot quote it)

| Step | Behavior |
|------|----------|
| `build_drive_and_summaries.py` `summarize_pdf` | `pdftotext -f 1 -l 2` only; **no OCR**; **no table reconstruction** |
| Clip | First ~2 sentences, `clean_text(..., 320)` — **PIBE BCS 2024 summary in `file_summaries.json` is 320 chars and does not include 187152** |
| `catalog_slim.json` | Columns `n,p,f,e,t,y,s` only — **no `sum_es`** |
| `build_chat_corpus.py` | Reads catalog_slim → file chunk summary = catalog summary **or title** → stubs |
| Enrichment | Real numbers only for some **población** CSVs — **not** for PIBE CSV/PDF |

So: chatbot can “know” the file `2024-12-05_INEGI_PIBE_BCS_2023.pdf` exists (and may cite it) while that chunk carries **zero** economic figures. Note also year skew: 2023 PDF ≈ 181,155 mdp; portal/guide/2024 PDF ≈ **187,152**.

### 2.4 Extra self-harm: economy guides tagged as demography

In `build_chat_corpus.py`, any guide section matching `INEGI` gets:
`[demografía población habitantes gente censo INEGI CPV …]`  
Both PIB guide chunks match → they look like population material to the scorer, reinforcing the INEGI→demo confusion.

### 2.5 Prompt / limits (secondary)

- System prompt already says: use exact figures from context; never invent — **correct**, but context lacked the figure.
- `max_tokens: 900`, history slice 6 — not the root cause for a one-number factoid.
- Always appending foresight/vocation terms to `retrieveQuery` dilutes pure fact queries.

---

## 3. Ontology: injection vs “traverse vocaciones / capacidades / …”

**Graph on disk:** ~90 nodes, ~268 edges (`predicate`: governs, constrains, demands, …).

| Portal language | Graph `type` (exact enum) | In chat? |
|-----------------|---------------------------|----------|
| Vocaciones | `DemandDriver` (+ `Territory`) | Node summaries in corpus; **no** type named Vocación |
| Capacidades | `ResourceCapacity` | Yes |
| Restricciones | `Constraint` | Yes |
| Actores | `Actor` | Yes |
| Instrumentos | `Instrument` | Yes |

**Runtime behavior (`pickOntologyNodeIds`):**
- Lexical score over id/type/label/summary.
- Take top seeds; add **up to 4 neighbors per seed** (1-hop only).
- Reserve ~3–5 ontology slots in the retrieved set (0 when pure demo intent).

**Gaps for ontology-aware Q&A:**
- No multi-hop path queries (“restricciones de la vocación turismo Cabos”).
- No intent that maps Spanish facet words → `type` filters.
- Economy/PIB facts are **not** ontology nodes (correctly — they are guide/PDF facts); ontology cannot rescue PIB.

---

## 4. Conversation memory & gap list — current state

| Layer | Today |
|-------|--------|
| Client (`ChatWidget.astro`) | In-memory `history` array; sends `history.slice(-6)`; **not** persisted; localStorage only for sheet open/collapsed |
| Voice | `history: []` every `portal_ask` |
| Server (`chat.mjs`) | Stateless except IP rate limit Map; **no** Q&A log; **no** Blobs/DB |
| “Evidencia faltante” UI | Deep-link to `/crecimiento` — not a harvested gap list |

**Gap:** no durable turn store → cannot aggregate interests or export missing-knowledge.

---

## 5. Voice path

`bcs-grok-voice.js` → tool `portal_ask` → `POST /api/chat` with same RAG function.  
**Same corpus, same retrieval bugs.** Voice adds empty history and short spoken paraphrase of `answer` + up to 4 source titles.

---

## 6. Prioritized fixes (concrete file changes)

### P0 — Make PIB-style portal facts answerable (this week)

1. **Wire real summaries into the chat corpus**  
   - **File:** `scripts/build_chat_corpus.py`  
   - Load `src/data/file_summaries.json` by path; if `sum_es` length > title, use it (prefer `source: pdf|md|csv` over `heuristic`).  
   - Re-copy to `public/chat_corpus.json` + `netlify/functions/chat_corpus.json`.

2. **Fact-card / deeper extract for priority economic PDFs**  
   - **File:** `scripts/build_drive_and_summaries.py` (`summarize_pdf`)  
   - For paths matching `PIBE|PIB_|ITAEE|IED|CNIE|SETUE`:  
     - `pdftotext` pages 1–4 (or full if short).  
     - Clip to **1200–2000** chars (not 320).  
     - Regex-harvest lines with `PIB|VAB|millones|mdp|%` into a leading “CIFRAS:” line (normalize `187 152` → `187,152` / `187152`).  
   - Force-refresh summaries for:  
     `07_economy_investment/2025-12-05_INEGI_PIBE_BCS_2024.pdf`,  
     `05_demographics/2024-12-05_INEGI_PIBE_BCS_2023.pdf`,  
     PIBE CSV tabulado (row peek like población helper).

3. **Economy intent + stop INEGI⇒demo hijack**  
   - **File:** `netlify/functions/chat.mjs`  
   - Add SYN_GROUP triggers: `pib`, `pibe`, `ied`, `vab`, `economia`, `económico`, `empleo`, `enoe`, `itaee`, `setue`, `mdd`, `mdp` → expand `economia`, `pibe`, `inegi`, `07_economy`.  
   - Set `isEconomyIntent`; **do not** set `isDemoIntent` from `inegi` alone when economy tokens present.  
   - In `scoreChunk`: `+10` for `theme=economia`, `guides/economia`, `07_economy_investment`; boost `type=guide` further on economy intent.  
   - Raise `k` to 12 on economy intent; prefer guide slots like water prefers `guides/agua`.

4. **Stop demography tag pollution on economy guides**  
   - **File:** `scripts/build_chat_corpus.py`  
   - Only add `[demografía…]` extra when theme ∈ {territorio, historia, demografia} **or** population keywords — **not** bare `INEGI`.  
   - Add economy extra tags: `[economía PIB PIBE VAB IED INEGI constante nominal mdp]`.

5. **Number normalization in retrieval**  
   - **File:** `chat.mjs` `tokenize` / `normHay`  
   - Index and query form: strip `[\\s,]` inside digit runs so `187,152` ≡ `187 152` ≡ `187152`.

6. **Rebuild & verify locally (no deploy unless asked)**  
   ```bash
   python3 scripts/build_drive_and_summaries.py   # or targeted PIBE refresh
   python3 scripts/build_chat_corpus.py
   # smoke: score “PIB constante BCS según INEGI” → guides/economia with 187,152 in top 3
   ```

### P1 — Deeper document/page indexing (tables & exact figures)

1. **Structured fact extract layer** (new `scripts/extract_portal_facts.py` → `public/portal_facts.json`)  
   - Parse guide markdown tables → `{metric, value, unit, year, source, path, theme}`.  
   - Seed corpus with `type: "fact"` chunks (high score on exact metric tokens).  
   - Include `/economia` PIB, IED, ENOE, hotel rooms, fiscal MDP, etc.

2. **CSV enricher** for `*PIBE*tabulado*.csv` (mirror `_summarize_poblacion_csv`): latest-year PIB total + top sectors.

3. **Optional:** embed table HTML from built `dist/economia/index.html` as a single “page snapshot” chunk if guides drift from rendered page.

4. **PDF tables:** for priority PDFs, try `pdftotext -layout` + line heuristics; OCR only if `pdftotext` < 40 chars (scanned). Keep OCR out of default path (cost/latency).

### P1 — Ontology-aware retrieval

1. **Facet map in `chat.mjs`:**  
   `vocacion|vocaciones` → types `DemandDriver`;  
   `capacidad|capacidades` → `ResourceCapacity`;  
   `restriccion|candado|constraint` → `Constraint`;  
   `actor|actores|stakeholder` → `Actor`;  
   `instrumento|pdu|poer|ped` → `Instrument`.

2. **`traverseOntology(seedIds, predicates, maxDepth=2)`** — BFS on `ontology_graph.json` edges; inject path labels into context (`Turismo Cabos —demands→ Acuífero 0317 —constrains→ DMA déficit`).

3. **Corpus:** store `onto_type` + neighbor id list on ontology chunks (already partially present); ensure Spanish synonyms in `sum_es`.

### P2 — Conversation memory + missing-knowledge export (Netlify-friendly)

**Constraints:** static site + Functions; no always-on DB; Blobs optional; privacy (auth gate already).

**Proposed design:**

| Piece | Implementation |
|-------|----------------|
| Turn log | In `chat.mjs` after successful answer: write to **Netlify Blobs** store `chat-turns` (key = `YYYY-MM-DD/ulid.json`) with `{ts, lang, q, answer_len, source_paths[], place, intents[], refused_figure: bool, voice: bool}`. **No raw PII**; truncate q/answer to 500/300 chars. Feature-flag env `CHAT_LOG_BLOBS=1`. |
| Client session | `sessionStorage` chat id + optional “export my thread” JSON download (already have history in RAM). |
| Gap detection | If model answer matches `/no (consta|está) en (el )?contexto|not (found|in context)|no (tengo|encuentro) (la )?cifra/i` **or** retrieval top score &lt; threshold **or** user clicks “Evidencia faltante” → append to Blob `chat-gaps/{week}.jsonl` `{q, intents, top_paths, reason}`. |
| Export | New function `chat-gaps.mjs` (auth + admin secret): `GET` aggregates week → CSV/JSON of missing questions clustered by theme tokens. |
| Interests rollup | Nightly or on-demand reduce Blob keys → `{theme, count, sample_qs}` for editorial prioritization (which guides/PDFs to deepen). |

Fits serverless: append-only Blobs, no migration; works with static front end.

### P2 — Voice parity

- Pass last 2–4 voice transcripts as `history` into `portal_ask`.  
- Same economy intent / fact cards benefit automatically.

---

## 7. Success criteria — PIB-style fact check (after fixes)

Run these queries against `/api/chat` (ES) and require **all**:

| # | Query | Must |
|---|-------|------|
| 1 | `¿Cuál es el PIB constante de BCS según INEGI?` | Answer contains **187,152** (or `187 152`) and cites guía `/economia` or PIBE 2024 PDF — **not** only the 2023 filename |
| 2 | `PIB constante BCS` | Same figure without needing the word INEGI |
| 3 | `PIBE 2024 Baja California Sur` | Figure + year 2024; does not answer with 2023-only 181,155 unless asked for 2023 |
| 4 | Retrieval debug (log top-8 ids) | `g:economia:1` or `g:economia:8` or enriched PIBE 2024 file in **top 3** |
| 5 | Voice `portal_ask` with query #1 | Spoken answer includes the figure (same RAG) |
| 6 | Regression | `¿Cuántos habitantes en La Paz?` still returns census figure (economy intent must not break demo) |

Optional ontology check (P1):  
`¿Qué restricciones tiene la vocación turística de Los Cabos?` → context includes `DemandDriver` turismo + linked `Constraint`/`ResourceCapacity` (DMA/SIBCS), not random stills only.

---

## 8. Root-cause one-liner

**The portal and guide corpus already contain 187,152; retrieval is demography-biased whenever the user says “INEGI”, PDF chunks are filename stubs (and PDF summaries are clipped before the figure), and there is no economy intent or fact-card layer — so top-k context never reaches the LLM.**

---

## Appendix — P0 implemented (2026-09-23 Europe/Madrid)

See **DEPLOY_REPORT_CHAT_DEPTH_P0.md**.

- Wired `file_summaries` into corpus; deepened PIBE PDF extracts (187,152 in summary).
- Economy intent in `chat.mjs`; INEGI no longer forces demography when PIB/economía present; number normalize; foresight bias skipped on pure economy factoids.
- Offline: PIB+INEGI → `g:economia:1` rank **#1**. Live: answer contains **187,152**.
- Prod deploy id: `6ab39f38f1b30590aa33084b`.

---

## Appendix — P1 implemented (2026-09-23 Europe/Madrid)

See **DEPLOY_REPORT_CHAT_DEPTH_P1.md**.

- Portal fact cards from guide tables (`type: fact`, 227 facts).
- Priority-theme deeper PDF extracts + PIBE CSV peek.
- Ontology Spanish facets + **2-hop** BFS (cap ~8).
- Offline + live: PIB **187,152** still #1; facet queries return ontology; deploy `6ab3a1c832a4a390791cffa7`.

---

## Appendix — P2 implemented (2026-09-23 Europe/Madrid)

See **DEPLOY_REPORT_CHAT_MEMORY.md**.

- Netlify Blobs turn log + gap export; `/memoria/` UI; session id in ChatWidget/voice.
- Prod deploy id: `6ab3a4c5f1b305aed5330865`.
