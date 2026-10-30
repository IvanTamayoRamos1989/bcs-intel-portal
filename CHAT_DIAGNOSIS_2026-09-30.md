# BCS Portal chat: why the answers are poor (diagnosis only)

**Date:** 30 Sep 2026, tests run 17:03–17:10 CEST · **Scope:** read-only. Nothing was edited or deployed.
**Live endpoint:** `https://bajacaliforniasur2050.com/api/chat` (cookie auth). **Code read:** `netlify/functions/chat.mjs` (2,227 lines), `netlify/lib/chat_memory.mjs`, `src/components/ChatWidget.astro`, `scripts/build_chat_corpus.py`, `scripts/build_library.py`, `chat_corpus.json` (4,172 chunks at read time).
**Method:**
1. I sent 15 live questions, plus a follow-up pair.
2. I ran `handler()` locally against a snapshot copy in `/workspace/chatdiag/`. The xAI call was mocked, so I could capture the exact CONTEXT that the model receives for each question. For Q01 the local chips match the live chips exactly.

Raw artefacts are in `/workspace/chatdiag/`:
- `live_results.json`, `live_followup.json`: the live answers
- `local_ctx.json`: the captured context for each question
- `q01_sys.txt`, `q04_sys.txt`: full system prompts

---

## 1. Summary

The model is not the main problem. **Retrieval and the "evidence chain" code decide what the model can see, and both are broken in systematic ways:**

1. **Place bias overwrites the question.** When the question names a place, or a place tab is active, the backend appends `"… <place> foresights crecimiento demand supply vocation"` to the retrieval query. Those words fire the *growth-constraint*, *water* and *energy* intents. Their forced injections then fill up to 14 context slots with the same 8 ontology cards: Escasez hídrica, DMA, SIBCS, Tenencia, **PDU 2040 Los Cabos**, Municipio de Los Cabos, Turismo Los Cabos, plus water guides. The actual answer gets pushed out. As a result, *"¿Cuántos habitantes tiene Loreto?"* returns "no hay cifra" even though Loreto = 18,052 is in the corpus. The Loreto airport passenger fact and the new Los Cabos organigrama are pushed out the same way.
2. **There is no real relevance threshold.** Every `fact` chunk gets +3.5, every `ontology` chunk +1.2, every `guide` chunk +0.8 and every `municipio` chunk +1.5, **even when zero query words match**. The only cut-off is `s > 0.5`. For nonsense like "xyzzy foo", 736 chunks pass, and the model receives 8 DMA/POER cards.
3. **Matching uses raw substrings, not words.** `hay.includes(token)` is used everywhere:
   - "semar" matches SEMARNAT (46 chunks).
   - "dur" matches "durante".
   - **"presidente" contains "residen"**, which triggers the *population* intent, so "presidente municipal" returns census tables.
   - Place inference uses `'lap'` and `'lto'`, so "colapso" becomes La Paz and "salto" or "resultado alto" becomes Loreto.
   - There is no typo handling ("abitantes", "poblasion" and "dur" fail) and no IDF weighting, so common words like "baja", "california" and "sur" count as much as "sedena".
4. **The chips are always filled, whether relevant or not.** The chips (Archivo, Actor, Señal, Onto) are computed from whatever came back, and every picker has a fallback that never returns empty:
   - `pickForesightSignals` returns the top 2 signals even with score 0.
   - `pickPrimaryFile` scans the whole corpus for any Drive file with a single token hit ("BajaCaliforniaSur" in a filename).
   - `pickStakeholder` scores against the *titles of the irrelevant chunks*: the word "Acuífero" in a title gives +18 to CONAGUA.

   This reproduces Ivan's SEDENA chips exactly.
5. **The model answers from its own prior knowledge when the context is empty or off-topic.** Three cases:
   - It named Oscar Leggs Castro as the current Los Cabos mayor. The correct name in the corpus is Christian Agúndez Gómez.
   - It wrote a paragraph about the Marina in La Paz with no source at all.
   - It gave La Paz = 250,141 while citing INEGI, but that number was *not in its context*.

   `grok-4-1-fast-non-reasoning` at temperature 0.15 does not reliably follow the "no inventes" rule once the context is noise.
6. **The corpus has gaps.** Security and defence are almost absent: one "Guardia Nacional" project card, 0 hits for militar, naval, SEDENA facilities, policía or delito. There is no clean figure for installed MW in BCS. **1,356 of the 1,800 `file` chunks are filename-only** (summary under 80 chars). File chunks are capped at 1,800 out of 6,747 catalog files. Each library PDF contributes only 3–8 selected pages.

---

## 2. Live test results (15 questions + follow-up)

The ratings are mine (1 = wrong or ungrounded, 5 = correct, grounded, relevant chips). "Chips" means the evidence chain the UI shows. "Ctx" is what the model actually received (captured locally).

| # | Question (place sent) | Answer (short) | File / Actor / Signal chips | Rating | Why |
|---|---|---|---|---|---|
| Q01 | `sedena baja california dur` (BCS/null) | "SEDENA tiene presencia… a través de la Guardia Nacional… no se especifican cuarteles" | CONEVAL SIDS PDF · Julio César Villarreal Trasviña (CONAGUA) · sig-water-energy-coupling, sig-sibcs-island-grid · Onto: SIBCS, Acuífero 0317, BCS, GN | **1.5** | Ctx: SIBCS, BCS, Acuífero 0317, GN card, 4 economy facts. Only 1 relevant chunk. **Chips are identical to Ivan's report.** |
| Q02 | `sedena baja california sur` | Same answer | CONEVAL SIDS · CFE Transmisión · same signals | **1.5** | The typo fix makes no difference: "sur" is a place token and "sedena" matches 1 chunk. |
| Q03 | `guardia nacional` | Deployment "en proceso", link gob.mx/guardianacional | INEGI PIBE nacional · Lesvia Davis · sig-tourism-fdi-vs-water · Onto: airports SJD/LAP | **2.5** | Text is grounded in the single GN card. The airport and PIBE chips are noise. |
| Q04 | `cuantos abitantes tiene la paz` | "250,141 habitantes, Censo 2020" | PDUCP La Paz · IMPLAN La Paz · water signals · Onto: DMA, Escasez, SIBCS, Tenencia | **2** | Number is right (city/cabecera), but **it was not in the context** (see `q04_sys.txt`). The municipio figure 292,241 was not given. The typo defeated the demo intent, and place bias filled 14 slots with water/Los Cabos cards. |
| Q05 | `¿Cuál es la población de La Paz?` (la_paz) | "aproximadamente 250,000 habitantes" | Same as Q04, **incl. "PDU 2040 Los Cabos"** | **2** | Ungrounded and vague. Census chunks were pushed out. A Los Cabos PDU chip on a La Paz question. |
| Q06 | Water supply of Los Cabos, l/s (los_cabos) | Desal 250 l/s ≈ 7.88 hm³/a; "no hay dato de suministro total" | OOMSAPAS norms PDF · IMPLAN Los Cabos | **3** | Honest data gap, correctly grounded. The corpus has no OOMSAPAS total supply figure (corpus gap). |
| Q07 | `capacidad instalada de energia en BCS en MW` | "≈688.5 MW… capacidad instalada" | POERBCS criteria PDF · SEPUIMM actor · Onto: water constraints, PDU Cabos | **1** | **Wrong: 688.5 MW is the SIBCS peak demand, not installed capacity.** "capacidad" triggered the growth-constraint and water intents. There is no installed-capacity fact in the corpus. |
| Q08 | `semarnat` | Generic SEMARNAT description + Los Cardones / DMA | SEMARNAT Vizcaíno decree · CONAGUA actor | **3** | Acceptable. The first paragraph is prior knowledge. |
| Q09 | `desaladora los cabos` (los_cabos) | 250 l/s, 7.88 hm³, does not cancel the 0317 deficit | DOF APP desal 250 lps · IMPLAN Los Cabos | **4** | Good. Water and place bias happen to align with the topic. |
| Q10 | Library: desalination and reuse | EPA 2012 reuse, OECD, generic desal advice | OOMSAPAS PDF · CONAGUA · Onto: water | **3** | Library chunks were retrieved. Item 1 ("desalación") is not tied to any document. The 5 ontology cards waste slots. |
| Q11 | Mayor of Los Cabos + how to contact IMPLAN (los_cabos) | "**Oscar Leggs Castro**" | PMD Los Cabos 2024–27 · Beatriz González Gibert (IMPLAN) | **1** | **Hallucinated. That was the 2018–21 mayor.** The correct name (Christian Agúndez Gómez) is in `stakeholders_seed.json` and in the new organigrama guide chunks, but the ctx held only water/Los Cabos cards. The actor chip was right, but the answer did not use it. |
| Q12 | `marina armada de mexico puerto la paz` | 3 paragraphs about the Navy in La Paz | PDUCP La Paz · IMPLAN La Paz · water signals | **1** | **Fully invented.** Zero naval content in the ctx or the corpus. "la paz" inferred place and flooded the ctx with water cards. |
| Q13 | `aeropuerto loreto pasajeros` (loreto) | "No hay cifras específicas…" | Loreto PSDU · CONAGUA actor | **1** | **False negative:** `fact:conectividad:pasajeros_2025_loreto` and `2026_LTO_Loreto_airport_passengers_AFAC_cited.md` exist. Place bias pushed them out. |
| Q14 | `PIB de Baja California Sur 2023` | 181,155 mdp constant, PIBE 2023 | PIBE BCS 2023 PDF | **4** | Good. The economy intent has no place and so escapes the bias. One stray ANP guide chip. |
| Q15 | What constrains tourism growth in Todos Santos? (todos_santos, EN) | Water (0313), SIBCS, "PDU 2040 Los Cabos also reflects…" | PSDU Todos Santos · CONAGUA | **2.5** | Aquifer 0313 is correct. Citing the Los Cabos PDU for Todos Santos (municipio La Paz) is wrong. The same 8 fixed cards appear again. |
| F1 | `¿Cuántos habitantes tiene Loreto?` | "No hay una cifra exacta de habitantes de Loreto" | 5 water/Los Cabos cards | **1** | **False negative.** Loreto 18,052 is in 4+ chunks. |
| F2 | `¿y Mulegé?` (with history) | Same "no hay cifra" | Same | **1** | History reaches the LLM, but **retrieval ignores history**, so follow-ups retrieve on "¿y Mulegé?" alone. |

**Average ≈ 2.2 / 5.** Only the two questions that avoided place bias and matched a strong intent (Q09, Q14) were good.

---

## 3. How the retrieval pipeline actually works (code evidence)

| Aspect | What the code does | Problem |
|---|---|---|
| Scoring | Hand-tuned keyword scoring, `scoreChunk()` L529–790: +1 per token found anywhere, +2.5 title, +1.2 path, +1.5 theme, +1.8 summary, then ~40 intent-specific multipliers and boosts. **No BM25/IDF and no embeddings.** | Frequent words weigh as much as rare ones: "baja" matches 372 chunks, "sedena" matches 1. |
| Match unit | `hay.includes(t)`: **substring**, not word. The same applies to SYN triggers (`norm.includes(t)`) and `inferPlaceId` (`hay.includes('lap')`). | presidente→"residen" (demo intent), semar→SEMARNAT, dur→durante, colapso→La Paz, salto/alto→Loreto. |
| Accents | NFD fold on query and chunk: OK. | — |
| Typos | None. | "abitantes", "poblasion", "dur" fail. |
| Stopwords | ES/EN list (L187). Tokens under 3 chars are dropped. | Fine, but "tiene", "cuantos", "quien" etc. survive. |
| Query expansion | 8 static synonym groups + a Spanish→English library bridge + ~15 intent regexes. There is no LLM rewrite and history is not used. | The triggers are too broad: `demand`, `capacidad`, `red`, `consumo`, `year` fire water/energy/growth. `capacidad` alone makes every "capacidad instalada" question a water-constraint question. |
| Place bias | `handler` L1977–1981: `retrieveQuery = msg + place + placeId + ' foresights crecimiento demand supply vocation'` whenever there is a place. | **Root cause #1.** "crecimiento" fires the growth-constraint injection (8 fixed ontology IDs incl. `inst_pdu_cabos`, `terr_los_cabos`, `dd_turismo_cabos`, whatever the place). "demand" fires the water intent and its forced water guides. |
| Forced injections | Water, economy, fact, tourism/ANP, spatial, growth, demo, scenario and library each *prepend* fixed chunks, and every step truncates to k. | They overwrite each other. The last matching one wins, whatever the question. The demo check `hasDemo` is satisfied by "Ontology Territory: **Municipio** de Los Cabos" (regex `municipio`), so census chunks are never injected. |
| Ontology slots | 3–8 reserved ontology cards per question (`reservedOnto`), picked by 2-hop BFS from token overlap. | Always spent, even on "sedena". Ontology summaries carry **keyword stuffing** (`[Constraint ontologia ontology capacidad … agua water DMA hm3 … crecimiento growth]`, in 187 chunks), so these cards match almost any query. |
| Threshold | `if (s > 0.5)`, but facts get a flat +3.5, municipio +1.5, ontology +1.2 and guide +0.8 **before any match check**. | **No effective threshold.** "xyzzy foo", "sedena" and "armada" each pass 715–736 chunks, and the top results are the DMA facts. |
| k / context size | k = 8 by default, 10–14 by intent. The system prompt is 10–19k chars (≈3–5.5k tokens), of which the prompt text itself is ≈6k chars. Each chunk is only its summary (`sum_es`, 400–950 chars), not the full text. | The context is small, and most of it is filled by the same cards. |
| Chips | `pickPrimaryFile` scans the corpus if no Drive file was retrieved (base score 8, 1 token hit is enough). `pickStakeholder` builds its blob from the titles of the retrieved chunks. `pickForesightSignals` falls back to the first 2 signals when all scores are 0. `buildOntologyLinks` tops up from the graph when fewer than 2 ontology links exist. The UI also adds a Place chip from `window.BCSPlace`. | **Chips always appear, relevant or not.** This is exactly Ivan's SEDENA example. |
| Answer-level threshold | None. An empty or irrelevant context is still sent as "CONTEXTO". | The model fills gaps from its own knowledge (Q11, Q12, Q04). |

### Corpus check (rg / python over `chat_corpus.json`, `ontology_graph.json`, `stakeholders_seed.json`)
- **SEDENA:** 1 chunk (`onto:proj_fed_seg_001` "Infraestructura Guardia Nacional en BCS": "Dependencia: Guardia Nacional / SEDENA / SEMAR … cuarteles BCS no listados con fuente primaria aquí").
- **Guardia Nacional:** 2 chunks (the same project as an ontology card + a fact card).
- **SEMAR:** 46 substring hits, almost all SEMARNAT. Real SEMAR content is 1 fact (ASIPONA Cabo San Lucas → SEMAR).
- **militar, naval, defensa, ejército (as an institution), policía, delito, homicidio:** **0**. "seguridad" appears in 11 chunks (PED, 2º Informe annex, CENACE); no crime statistics, SESNSP or zonas militares/navales.
- **No stakeholder** for SEDENA, SEMAR, GN or state/municipal security.
- **Other gaps:** no statewide installed-capacity figure (only indirect: indisponibilidad 350.17 MW ≈29.5%, plant-level MW); no OOMSAPAS total supply l/s.
- **Thin chunks:** 1,356 of 1,800 `file` chunks have a summary under 80 chars (filename only). `MAX_ROWS = 1800` of 6,747 catalog files. Each library document is 3–8 heuristic pages (676 chunks / 111 documents).

---

## 4. Model, parameters, memory

- **Model:** `providerConfig()` uses `grok-4-1-fast-non-reasoning` unless `BCS_CHAT_MODEL` is set. I could not read the Netlify env; the answer style matches non-reasoning. The same model is used for every question, with no routing.
- **Parameters:** `temperature 0.15`, `max_tokens 900`. **No truncation seen**: the longest answer was 1,509 chars, and the prompt asks for brevity. `finish_reason` is not returned to the client, so truncation can't be monitored.
- **History:** the client sends the last 6 turns (`history`), and these go to the LLM (each clipped to 1,500 chars). **Retrieval never sees history**, so follow-ups like "¿y Mulegé?" retrieve badly (F2). Old answers in history can also push the model to repeat earlier topics.
- **"Memory" feature:** `logChatTurn` (`netlify/lib/chat_memory.mjs`) only *writes* turns and gaps to Netlify Blobs, and `/memoria` reads them. **It does not feed retrieval or the prompt**, so it does not pollute answers.
- **Ontology and place bias:** this **is the main pollution source** (see §3). Two further inputs pollute the context: the reserved ontology slots and the keyword-stuffed ontology summaries. The foresight "spine" (thesis + 2–4 signals + growth scorecard) is prepended to every place question, whether relevant or not.
- **Prompt:** long (≈6k chars) and heavily tuned toward water, scenario and estimates ("DEBES dar una estimación", "Prefiere síntesis a 'no está en los documentos'"). That encourages confident synthesis on thin context. It has no explicit rule for people, officials or organisations ("never name a person or office-holder not present in CONTEXT"), and no "if CONTEXT is empty or irrelevant, say so and stop".

---

## 5. Root causes, ranked

| Rank | Root cause | Evidence | Impact |
|---|---|---|---|
| 1 | **Place/foresight words appended to the retrieval query** fire growth/water/energy intents and their forced injections | L1977–1981. Q04, Q05, Q11, Q12, Q13, Q15, F1, F2 all get the same 8 cards. Raw `retrieve("cuantos abitantes tiene la paz")` → census chunks; with the appended string → 0 census chunks. | Every place question (and every question that names a place) |
| 2 | **No relevance threshold**, plus unconditional type bonuses, plus always-filled chips | "xyzzy foo" passes 736 chunks. Pickers have non-empty fallbacks. SEDENA chips reproduced. | Irrelevant chips; the model is invited to improvise |
| 3 | **Substring matching and no IDF** (tokens, triggers, place inference) | presidente→demo, semar→SEMARNAT, lap/lto false places, "baja/california/sur" ≈ "sedena" weight | Wrong intents; short keyword queries fail |
| 4 | **The model is not held to grounding** when the context is weak; one non-reasoning model for everything | Leggs Castro, Marina paragraph, 250,141 with no source in ctx, 688.5 MW "installed" | Confident wrong answers, the worst trust damage |
| 5 | **Over-broad intent triggers and stacked forced injections** that overwrite each other | "capacidad"→water/growth (Q07). `hasDemo` satisfied by "Municipio de Los Cabos" ontology card. | Topic drift even without a place |
| 6 | **Corpus gaps and thin chunks** | Security/defence ≈0. No installed MW. 75% of file chunks filename-only. 1,800 of 6,747 files. 3–8 pages per library PDF. | Some questions cannot be answered even with perfect retrieval |
| 7 | **No typo handling, no query rewrite, retrieval ignores history** | abitantes/poblasion/dur; "¿y Mulegé?" | Typos and follow-ups fail |

---

## 6. Fixes (concrete, with effort)

### P0: quick wins (≈1.5–2 days total; would fix most of the failures above)
1. **Stop appending `foresights crecimiento demand supply vocation`** (and the place label) to `retrieveQuery`. Use the place only as a soft score boost for chunks that mention it (and as a filter against the other municipio's PDU). Run the growth-constraint injection only when the *user's own message* asks about growth or constraints. **2–3 h.** On its own this fixes F1, F2, Q04, Q05, Q11 and Q13, and lets the new Los Cabos organigrama surface.
2. **Word-level matching.** Tokenise each chunk once into a `Set` (cached at cold start). Match whole words, plus prefixes of 5 or more characters for Spanish inflection. Apply the same to SYN triggers and `inferPlaceId` (drop `lap`, `lto`, `sjd` as substrings; require a word boundary). **3–4 h.**
3. **A real relevance gate.** No type bonus when `nonPlaceHits === 0`. Require at least one non-place, non-generic token match. Compute `topScore`; if it is below τ (tune on the golden set), switch to **"no evidence" mode**:
   - send the model an explicit `CONTEXTO: (sin evidencia relevante en el portal)`;
   - return `sources: []`, `primary_file: null`, `stakeholder: null`, `foresight_signals: []`;
   - show "Sin evidencia en el acervo" in the UI instead of chips.

   **3–4 h.**
4. **Chips only from relevant evidence.**
   - `pickForesightSignals`: no fallback when all scores are 0; require a real keyword or place match.
   - `pickPrimaryFile`: drop the whole-corpus fallback, or require at least 2 non-place token hits.
   - `pickStakeholder`: score on the query plus the top 3 *gated* chunks only, never on noise titles.
   - Don't top up ontology links from the graph when retrieval was gated.

   **2–3 h.**
5. **Grounding rules in the prompt.** Add: "Nunca nombres personas, cargos, instituciones ni cifras que no estén en el CONTEXTO; si falta, dilo en una frase y sugiere dónde buscar." Soften "prefiere síntesis a 'no está'" so it applies only when related evidence exists. Strip the `[… keyword tags …]` tails from `sum_es` before building the context (keep them for scoring only). **1–2 h.**
6. **Golden eval set.** 40–60 questions with expected facts and chips (the 17 here plus water, energy, people, library and security). Script it against local `handler()` with a mocked LLM for retrieval metrics, plus the live endpoint for answers. Run before every deploy. **4–6 h.**

### P1: retrieval quality (≈4–6 days)
7. **BM25 with IDF** over title, summary and path (e.g. MiniSearch, Orama or wink-bm25). Build the index at build time into the function bundle. Add **fuzzy matching** (edit distance ≤1 for tokens of 5+ chars, against the corpus vocabulary) so "abitantes" becomes habitantes and "poblasion" becomes población. **1–1.5 days.** Then retire most of the hand-tuned multipliers.
8. **LLM query rewrite before retrieval.** One cheap `grok-4-1-fast-non-reasoning` call with JSON output: `{corrected_query, keywords_es, keywords_en, entities, place, intent, is_followup, standalone_query}`. It uses the last 2 turns of history, which fixes typos ("dur"→"sur") and follow-ups ("¿y Mulegé?"). Cost: about +0.4–0.8 s per question. **1 day.**
9. **Hybrid search with embeddings.** Precompute embeddings for ~4.2k chunks at build (float16, about 3–6 MB). At query time, embed the rewritten query, take cosine top-50, and combine with BM25 using reciprocal rank fusion. Optionally rerank the top 30 with an LLM or reranker. **1.5–2 days.**
10. **Replace stacked forced injections with quotas.** After fusion, reserve at most 2 ontology cards, only if they pass the gate, and at most 2 per folder. Intent boosts become small priors, not prepends. **1 day.**

### P2: model and coverage (≈1–2 weeks, can run in parallel)
11. **Model routing.** Keep `grok-4-1-fast-non-reasoning` for factoid lookups. Route open, scenario, compare and "why" questions to `grok-4-1-fast-reasoning`, or to `grok-4` for the hardest ones, with `max_tokens` about 2,000 (reasoning uses tokens) and stricter grounding. Return `finish_reason` and log it. **0.5–1 day + eval.** Verify current xAI model names and pricing before switching.
12. **Web-search fallback, clearly labelled.** When the gate fails or the question is about current office-holders or events, optionally call xAI's search tool and show the result under a separate "Fuente externa (web) — no verificada en el acervo" block with URLs. Never mix it into the portal chips. **1–1.5 days.** Needs a product decision and a cost cap.
13. **Fill the corpus gaps:**
    - Security: SEDENA/SEMAR/Guardia Nacional presence in BCS (zonas militares/navales, cuarteles GN, with primary sources), SESNSP crime incidence by municipio, state and municipal security secretariats, plus the matching ontology Actor nodes and stakeholders.
    - Energy: installed capacity by plant and technology in SIBCS (PRODESEN / CENACE capacity table).
    - Water: OOMSAPAS Los Cabos and La Paz supply (l/s, sources), turned into `fact` cards.

    **2–4 days** of research and ingest.
14. **Deepen the thin corpus.**
    - Raise or remove `MAX_ROWS = 1800` (out of 6,747 files).
    - Regenerate the 1,356 filename-only summaries from the PDF text.
    - Page-chunk key PDFs (PDU, POER, PED, PRODESEN, CONAGUA DMA, INEGI) into 500–800-token passages instead of one summary per file.
    - Index more library pages, or all pages with embeddings.

    **2–4 days** (build time and bundle size need watching: the corpus JSON is already 4.2 MB against a `MAX_BYTES` of 5.2 MB. Consider moving it to Blobs or a separate index file).

**Suggested order:** P0 1–6, then redeploy and rerun the golden set, then P1 7–8, then P1 9–10, then P2 11–14. P0 alone should lift most of the 1–2 ratings above to 3–4 and remove the irrelevant chips.

---

## 7. Before-examples (for regression)

1. **`sedena baja california dur`** (BCS tab): "SEDENA tiene presencia… a través de la Guardia Nacional… no se especifican cuarteles". Chips: CONEVAL SIDS PDF, Julio César Villarreal Trasviña (CONAGUA), sig-water-energy-coupling, Onto SIBCS / Acuífero 0317. Context had 1 relevant chunk out of 8. *Expected after fix:* "El acervo solo registra un proyecto federal 'Infraestructura Guardia Nacional en BCS' (sin cuarteles con fuente primaria); no hay datos de SEDENA/SEMAR en BCS", plus 1–2 relevant chips (proyectos federales), or a labelled web fallback.
2. **`¿Cuántos habitantes tiene Loreto?`**: "No hay una cifra exacta de habitantes de Loreto en el contexto". The corpus has 18,052 (INEGI 2020) in several chunks. Place bias pushed them out. *Expected:* "Loreto (municipio): 18,052 hab., INEGI Censo 2020".
3. **`¿Quién es el presidente municipal de Los Cabos…?`**: "Oscar Leggs Castro" (former mayor, hallucinated). The corpus has Arq. Christian Agúndez Gómez (stakeholders seed + organigrama guide). "presidente" triggers the population intent through the "residen" substring, and place bias floods the context. *Expected:* "Arq. Christian Agúndez Gómez (Presidencia Municipal 2024–2027)" with the organigrama chunk as source.

(Also useful: Q07 "capacidad instalada … MW" → 688.5 MW, which is peak demand, not capacity; Q12 "marina armada … la paz" → fully invented paragraph.)

---

## 8. Note for the parallel organigrama task
The Los Cabos organigrama chunks are already in the local `chat_corpus.json` (`Organigrama Ayuntamiento de Los Cabos 2024–2027`, `Cabildo…`, `Presidencia Municipal…`). **With the current `chat.mjs` they will not reach the model** for "¿Quién es el presidente municipal de Los Cabos?". I checked this locally with the new corpus: the context was 14 water/Los Cabos cards and 0 organigrama chunks. The same holds for "presidente municipal" without a place (census tables win because of the "residen" substring). P0 fixes 1–3 are needed for that work to show up in answers.
