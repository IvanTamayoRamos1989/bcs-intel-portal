# BCS Portal — UX / i18n audit

**Date:** 2026-09-15  
**Scope:** `src/pages/*`, GuideShell, NoteCards, ChatWidget, BaseLayout, `src/content/guides/*`, topic tables  
**Lang model:** `ui.ts` + `data-i18n` / `data-lang-es|en` + `public/lang-toggle.js` (localStorage `bcs_portal_lang`)  
**Prod:** https://bcs-intel-portal.netlify.app

---

## Summary

Confirmed bug on `/ambiente` (Environment theme): with **EN** selected, chrome/nav switches to English, but the body stacks **Environment** (BaseLayout H1) **and** ungated markdown **`# Ambiente`**, then full Spanish ANP copy/tables (`Cuatro ANP de referencia`, `Decreto` / `Superficie` / `Municipio`). Root cause: GuideShell/`[topic].astro` render markdown with **no lang gate**; BaseLayout alone is bilingual. Same dual-render pattern on all theme guides.

Astro pages (home, catalogo, archivos, mapas, etc.) are mostly dual-gated. Gaps: Spanish-only table headers, NoteCards ES-only, footer section label always ES, guide bodies ES-only, duplicate EN leads (GuideShell + `ENRICHED_V2`).

---

## How lang works (verified)

| Layer | Behavior |
|-------|----------|
| `html lang` / `data-lang` | Set by `lang-toggle.js` from localStorage (default `es`) |
| `[data-i18n]` | Replaced from `window.__BCS_UI__[lang]` |
| `[data-lang-es]` / `[data-lang-en]` | `hidden` toggled |
| BaseLayout H1 | Dual spans — OK |
| Guide `<Content />` | **Ungated** Spanish MD — **broken** |
| a11y | `lang` attr updates; nav `aria-label="Principal"` stays ES |

---

## P0 — fix now (i18n correctness)

| ID | Issue | Paths | Fix |
|----|-------|-------|-----|
| P0-1 | Dual H1: Environment + Ambiente (all themes) | `guides/*.md`, `GuideShell.astro` | Remove leading `# Title` from guides (layout owns H1) |
| P0-2 | Spanish body always visible in EN | `guides/*.md` | Wrap ES in `<div data-lang-es>`; EN body in `<div data-lang-en hidden>` |
| P0-3 | Spanish ANP table labels in EN | `guides/ambiente.md` | Localize headers: Decree / Area / Municipality (+ EN copy) |
| P0-4 | Duplicate EN leads | `GuideShell.astro` + `<!-- ENRICHED_V2 -->` leads | Single bilingual lead in GuideShell; strip MD `data-lang-en` leads |
| P0-5 | Footer right always Spanish title | `BaseLayout.astro` | Dual `data-lang-es/en` for footer section |

## P1 — clear i18n (fix with P0)

| ID | Issue | Paths | Fix |
|----|-------|-------|-----|
| P1-1 | Spanish-only table headers | `catastro.astro`, `comunidades.astro`, `fiscal.astro`, `inmobiliario.astro`, `turismo.astro` (Fuentes), `ontologia.astro` | Dual spans / `data-i18n` |
| P1-2 | NoteCards ES-only | `NoteCards.astro` | Gate title/meta/summary chrome |
| P1-3 | Expand `ui.ts` | `src/i18n/ui.ts` | Common keys: sources, municipality, decree, area, file, notes, type, locality, relatedMaps, desktopPaths, sampleDocs, … |
| P1-4 | Guide table header ES leaks | all `guides/*.md` | EN tables with File/Ext/Year/Desktop path |
| P1-5 | CTA links hard-coded ES on fiscal | `fiscal.astro` | Dual labels on Comunidades / Catálogo |

## P2 — later (UX / a11y / IA)

| ID | Issue | Paths | Notes |
|----|-------|-------|-------|
| P2-1 | Full literary EN of long guide prose | `planeacion.md`, `territorio.md`, `historia.md` | EN summaries + key tables now; full parity later |
| P2-2 | `document.title` stays Spanish | `BaseLayout` + toggle | Update title on lang switch |
| P2-3 | Nav `aria-label="Principal"` | `BaseLayout.astro` | i18n |
| P2-4 | `puertos` / `planes-archivo` raw CSV keys / MD dumps | those pages | Humanize headers |
| P2-5 | Map figcaptions often ES-primary | guide maps | Prefer `title_en` where gallery has it |
| P2-6 | IA clutter: quick-nav + 4 dropdowns | BaseLayout | Optional collapse on mobile audit |
| P2-7 | Mobile dropdown UX | `global.css` | Touch targets / close-on-nav |
| P2-8 | Stills filter options incomplete EN on first paint | `stills.astro` | Options with only `data-lang-es` |
| P2-9 | Ontology page largely ES | `ontologia.astro` | Dual body |
| P2-10 | ChatWidget placeholder via `data-i18n` on label vs textarea | ChatWidget | Verify placeholder path (`data-i18n-placeholder`) |

---

## Page checklist

| Route | i18n chrome | Body gate | Table headers | Notes |
|-------|-------------|-----------|---------------|-------|
| `/` | OK | OK | n/a | Good dual pattern |
| `/catalogo` | OK | OK | OK | Keep Drive links |
| `/archivos` | OK | OK | n/a | Drive catalog preserved |
| `/territorio`…`/fuentes` (guides) | H1 OK | **FAIL** | **ES-only** | P0 |
| `/comunidades` | OK | OK | Partial ES | P1 |
| `/turismo` | OK | OK | CSV keys; Fuentes ES | P1/P2 |
| `/inmobiliario` | OK | OK | Mixed ES/EN | P1 |
| `/catastro` | Lead OK | OK | ES Tipo/Notas; Fuentes | P1 |
| `/mapas` | OK | OK | OK | — |
| `/gis-atlas` | OK | OK | Partial | — |
| `/earth-studio` | OK | OK | OK | — |
| `/stills` | OK | OK | OK | P2 options |
| `/puertos` | Lead OK | Mixed raw | CSV keys | P2 |
| `/fiscal` | Lead OK | Partial | ES headers | P1 |
| `/planes-archivo` | Thin | Raw | CSV | P2 |
| `/ontologia` | Thin | ES | ES | P2 |
| ChatWidget | OK | — | — | Preserve |
| NoteCards | **FAIL** | ES | — | P1 |

---

## Preserve

- F+P cyan (`--fp-blue: #0080C0`) — do not change
- ChatWidget + `/api/chat` corpus
- Drive catalog / archivos folder links
- Grouped nav IA (Explorar / Temas / Lugar / Evidencia)

---

## Fix-now vs later

**Fix now (this pass):** P0-1…P0-5, P1-1…P1-5  
**Later:** P2-* (full guide literary EN, title sync, ontology, raw CSV pages, mobile polish)

---

## Implementation status (2026-09-15 pass)

### Done (P0 + clear P1)

- **P0-1** Removed duplicate guide `# Title` H1s; BaseLayout owns page H1
- **P0-2** All theme guides wrapped: `<div data-lang-es>` + `<div data-lang-en hidden>`
- **P0-3** `ambiente.md` full EN ANP tables (Decree / Area / Municipality)
- **P0-4** GuideShell single bilingual lead; stripped MD `ENRICHED_V2` EN leads
- **P0-5** BaseLayout footer section dual-lang
- **P1-1** Table headers gated on catastro, comunidades, fiscal, inmobiliario, turismo Fuentes, ontologia
- **P1-2** NoteCards uses `data-i18n` for workNotes / updated
- **P1-3** `ui.ts` expanded with table/chrome keys
- **P1-4** Sample doc table headers bilingual on guides (shared tails)
- **P1-5** Fiscal CTA dual labels

### Done (Drive-only + partial P2)

- Catalog/archivos: Drive-only UX (no Desktop, no Solo local)
- Fiscal Drive folder matched (14 files)

### Remains (P2)


- Full literary EN of long ES guide prose (planeacion / territorio / historia detail beyond summaries)
- `document.title` sync on toggle; nav aria-label i18n
- puertos / planes-archivo CSV humanization
- Ontology full body EN; stills option first-paint; mobile nav polish

---

## Product rule (2026-09-15 evening) — Drive-only catalog

- Public portal **never** shows Desktop / PC paths.
- No **Solo local** badge; unmatched priority docs show **Pendiente en Drive / Pending on Drive**.
- Downloads are Google Drive Ver/Descargar only.
- Excluded from public catalog: `_design_ref`, `11_bcs_hub` internals (except guide maps/stills), `dist`, `node_modules`, `preview_*.png`.
- Default catalog filter: **En Drive**.
