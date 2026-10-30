# Design system — BCS data guide

**Sources (Ivan PDFs):**
- `ref_A.pdf` — F+P Technical Supporting Document (A4). Cover: solid `#0080C0`, white sans title bottom-left. Interior: generous whitespace, short blue rules, thin gray page footer (doc name left / page right). Previews: `preview_A-001.png`, `preview_A_intro-007.png`.
- `ref_B.pdf` — Client workshop 11 Sep 2026. Light gray slides, clear tables, section headers; cover green `#387820`. Preview: `preview_B-01.png`, `preview_B-02.png` (six lenses).

**Site purpose:** public **Guía de datos · Baja California Sur** — understanding the state with synthesized public facts. Not a Foster proposal title, not “Futures Programme”.

---

## Graphic tokens

| Token | Hex | Use |
|---|---|---|
| `--fp-blue` | `#0080C0` | Cover / primary brand / links / h1–h2 / active nav / card accent |
| `--fp-blue-dark` | `#006BA3` | Hover |
| `--fp-blue-soft` | `#A0D0E0` | Soft callout bars, chips |
| `--bg` | `#F5F7F9` | Page background |
| `--surface` | `#FFFFFF` | Cards, header, footer |
| `--text` | `#1A1A1A` | Body |
| `--muted` | `#5A5A5A` | Secondary text |
| `--rule` | `#D0D0D0` | Thin rules / table lines |
| `--border` | `#E0E0E0` | Card borders |
| `--accent-green` | `#387820` | Rare chips / lens labels only (workshop cover) |

**Typography:** system / Inter-like sans. Large bold section titles (F+P “Our Approach” weight). Body ~17px, line-height ~1.7. Short 2px blue rule under `h2` and above hero title.

**Layout patterns**
- Header: white/light bar; brand in `--fp-blue`; active nav = blue text + blue underline.
- Hero (home): full-bleed `--fp-blue` band; white title **Guía de datos · Baja California Sur**; left-aligned, generous padding (cover language).
- Cards: white surface, border `#E0E0E0`, left accent bar `--fp-blue`.
- Tables: blue header row, alternating soft gray rows (workshop slide clarity).
- Footer: thin `--rule` line; site name left + section title right (F+P page footer).

Implemented in `src/styles/global.css` + `src/layouts/BaseLayout.astro`.

---

## IA — workshop lenses → public data guide

Lenses organize **content about understanding BCS**, not a stakeholder-engagement process. No primary page for GC1 / F+P governance.

| Workshop lens | Site route(s) | Public purpose |
|---|---|---|
| Vision & Planning | `/planeacion` | POERBCS, PDU, POEL as facts |
| Data & Evidence | `/agua` `/energia` `/ambiente` | Verifiable water, power, ANP |
| Critical Mass (Demand) | `/economia` | Tourism / investment / growth pressure as data |
| Infrastructure & Capacity | `/conectividad` (+ links to agua/energía) | Airports, cruises, Mex 1/19 |
| Policy & Agenda | `/territorio` | Municipios, población, mandato factual |
| Project Governance | `/fuentes` (one line) | Who produces data — not organogram |

**Also in main nav (supporting):** `/riesgos` · `/historia` · `/` (home explains the guide).

**Out of scope / not primary nav:** team CVs, fee, contract calendar, F+P actores matrix, proposals pitch, programme dates as main content. Legacy `/actores` etc. may remain unlinked.

---

## File map

| File | Role |
|---|---|
| `src/styles/global.css` | Tokens + components |
| `src/layouts/BaseLayout.astro` | Light header, optional hero, F+P footer |
| `src/content/guides/*.md` | Guide prose |
| `src/pages/index.astro` | Home + lens map table |
| `DATA_GUIDE_IA.md` | Route IA for Ivan |
| `_design_ref/DESIGN_SYSTEM.md` | This document |
