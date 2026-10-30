# BCS Portal — Netlify

**Public URL:** https://bcs-intel-portal.netlify.app  
**Admin:** https://app.netlify.com/projects/bcs-intel-portal  
**Production domain:** https://bajacaliforniasur2050.com  

> Current runbook (backup → data refresh → build → eval → staging → deploy → verify): see **OPERATIONS.md**.
> Production build must use `CONTEXT=production npm run build`. Draft deploys have no chat key (production-only env scope).

## CHANGELOG — Portal UX reorg v2 (2026-09-15)

### IA
- Replaced flat 16-link mega-nav with **4 grouped dropdowns**: Explorar · Temas · Lugar & mercado · Evidencia (+ quick links).
- Removed stub clutter from nav (`capacidad` / `demanda` / `limitaciones` / `actores` / `planes` → 301 redirects).
- Home: how-to-use steps, Archivos CTA, theme cards grouped to match IA.

### Content wired
- Theme guides enriched from TI (SWOT, plans, fiscal, hazards, tenure, histories) + related maps + catalog doc tables.
- `/mapas` organized by theme with captions, Desktop paths, links into lenses.
- New first-class pages: `/archivos` (Astro + Netlify form), `/gis-atlas`, `/earth-studio`, `/planes-archivo`, `/puertos`, `/fiscal`.
- `/comunidades` + top localities; `/inmobiliario` full 26-report table from INDEX.md.
- `/catalogo` folder + TI subpack drill-down chips; catalog still **2,678** files.

### Deploy
- `npm run build` → `npx netlify deploy --dir=dist --prod`
- Message: `Portal UX reorg v2 — full data organized`

## Share
Anyone with the public URL can browse the portal (ES|EN toggle).

## Downloads
`/archivos/` → Google Drive project folders + `/catalogo/` index.

## Uploads
Netlify Form `bcs-file-upload` on `/archivos/` (review in Netlify Forms UI).
