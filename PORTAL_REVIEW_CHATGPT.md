# BCS 2050 Territorial Intelligence Portal — Review

**Reviewer lens:** ChatGPT-quality strategy-studio critique  
**Live:** https://bcs-intel-portal.netlify.app (password BCS2050)  
**Based on:** shipped surface described in `PORTAL_REVIEW_BRIEF_FOR_CHATGPT.md` + hub runbooks (Foresights, IA, optimize passes). No deploy.  
**Date:** 2026-09-20

---

## 1. Overall thesis

**The portal is already a strong evidence and navigation shell for an internal BCS 2050 team — but it is not yet a working strategy studio.**

It succeeds as a bilingual, password-gated workspace that gathers catalog/Drive downloads, GIS and stills, ontology, KPIs, news, stakeholders, flights, plans, theme guides, an always-on Ask assistant, and a Foresights layer with place vocations and role lenses. That is real product capacity.

What is still missing is the **closed intelligence loop** Ivan locked: Evidence → role lenses → debate/consensus → foresights, with **scenarios only after demand/supply by place vocation**. Today those pieces sit side by side more than they chain. A strategist can find material; they cannot yet run a place-by-place argument from demand–supply tension to a contested claim to a weekly foresight that clearly changes a decision.

**Recommendation:** Keep the shell; stop adding adjacent modules. Spend the next cycles making **place vocation** the spine of every major surface (Ask, Foresights, Maps, Summary, Stakeholders), finishing **growth demand–supply scorecards**, and forcing every foresight edition to show **evidence → lens conflict → open question** in one scroll. Decision twin and public filtering stay deferred until that spine is trustworthy.

---

## 2. Prioritized steps (intelligence + UX)

Order is deliberate: higher items unlock lower ones.

### P0 — Make “place vocation” the operating system

1. **One place strip everywhere** — Los Cabos, East Cape, Todos Santos, La Paz, Loreto, Constitución/Comondú (and peers) as a persistent filter or jump list on Foresights, Maps/GIS, Summary, Ask, Stakeholders, and News. Sum of places = BCS 2050 should be visible in the chrome, not only inside Foresights copy.
2. **Ship growth demand–supply scorecards by vocation** (already in progress) as the next canonical evidence object: simple, comparable cards (drivers, constraints, confidence, last updated, source links). Until these exist, foresights risk sounding like commentary without a ledger.
3. **Rewrite Foresights page as a weekly argument, not a stack of widgets** — top: edition thesis; then signals with sources; then role-lens disagreements; then consensus seeds / watchlist; then visuals that illustrate *those* claims. Maps/charts/diagrams should answer “so what for this place?” in the caption.

### P1 — Close the Evidence → Lens → Debate → Foresight path

4. **Wire Ask to the same spine** — answers should default to: primary file + ontology + stakeholder **and** the relevant place vocation + the current foresight signal IDs. Prefer “show the chain” over longer prose.
5. **Expose debate/consensus as first-class UI** — contested claims, emerging agreements, and gaps need their own readable block (not only buried in JSON-fed text). Each claim needs: status, places touched, opposing lenses, and one next evidence ask.
6. **News and flights as inputs, not destinations** — weekday news and SJD/LAP/LTO connectivity should auto-tag into signals and place cards; reduce orphan browsing of feeds that never change a scorecard or foresight.

### P2 — UX that matches an internal strategy tool

7. **Simplify information architecture for first five minutes** — group nav still reads like a data portal (Explorar / Temas / Lugar & mercado / Evidencia). Add a single **Studio** entry path: Today’s edition → Places → Evidence for this place → Ask. Keep deep theme pages, but demote them under “Library.”
8. **Mobile: chat + foresights first** — bottom sheet Ask and foresights must work one-thumb: short thesis, swipeable place cards, expandable sources. GIS can stay secondary on small screens (collapsible drawer is fine; do not make map the first cognitive load on phone).
9. **Catalog honesty** — Drive-only downloads are fine if every card shows size, language, date, and “opens outside portal.” Hide empty subgroups; never surface Desktop paths (already a lock — keep enforcing).
10. **Summary KPI dashboard → place-aware** — KPIs that are state-wide only reinforce “BCS as one blob.” Pair each headline metric with the three places that drive it and a link into the scorecard.

### P3 — Depth and trust (after the spine)

11. **Fill known evidence holes that block place stories** (from optimize backlog): La Paz PMDU full text; Loreto PMD / PSDU gaps; AFAC primary where gob.mx allows. Prioritize by which vocation scorecard is blocked.
12. **Stakeholders as living graph, not directory only** — editable directory is good; next step is link each actor to places, themes, and contested claims so Ask and Foresights can cite “who cares / who decides.”
13. **Ontology as bridge, not exhibit** — graph EN/ES is valuable when a click lands on catalog + place + foresight claim. If zoom/labels already exist, the win is outbound links into the spine, not more graph chrome.
14. **Keep Decision twin and F+P personal fichas hidden** until demand/supply scorecards are stable; do not let twin UI dilute attention.
15. **When going public later** — filter stakeholders and sensitive fichas; keep the same place spine so public and internal are one product with gates, not two sites.

---

## 3. What is already working (keep)

- Password-gated internal tool posture with clear future public filter intent.
- Breadth: catalog/Drive, GIS + OSM, stills, ontology, KPIs, news, stakeholders, flights, plans, themes.
- Ask always available (desktop sidebar / mobile sheet) with file + ontology + stakeholder hooks.
- Foresights architecture (vocations, role lenses, weekly refresh, visual pipeline) matches the locked intelligence path on paper.
- Bilingual ES/EN and F+P-adjacent visual language suitable for a serious regional strategy room.

---

## 4. Success test (definition of “strategy studio”)

The portal is “complete enough” for strategy work when a new team member can, in one sitting:

1. Pick **Loreto** (or any vocation),  
2. See **demand vs supply** with sources,  
3. Read **this week’s contested claims** for that place,  
4. Ask the chatbot a decision question and get **file + lens + scorecard** links,  
5. Leave with **one open question** the Monday refresh should answer.

Until that path is smooth, treat new features as optional and the place spine as mandatory.

---

*End of review. File for BCS swarm; no deploy performed.*
