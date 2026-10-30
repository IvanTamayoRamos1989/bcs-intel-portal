# BCS Portal — UX redesign — Pass 4 (DRAFT)

**Date:** 2026-09-24 (Europe/Madrid)  
**Latest draft:** https://6ab5336d983f871c25ea823b--bcs-intel-portal.netlify.app  
**Prod rollback:** `6ab526dcf367773d192fe790` · https://bajacaliforniasur2050.com  
**Password:** `BCS2050`

## Changes

### 1) Municipio dossiers (Studio → Lugares)
- Single title via `hidePageHead` (no duplicate large title).
- Breadcrumb: **Territorio / Lugares / {municipio}** (URL `/studio/…` unchanged).
- Nav label Studio → **Lugares / Places**.
- Ámbito on `/studio/*` navigates to matching municipio hub; chip syncs from path.
- Plain blurbs; “Tenencia” → “Propiedad del suelo”; dossier JSON cleaned of jargon.

### 2) Ontología
- Removed YAML/path/version callout.
- Short intro; taller hero graph; type chips + colour legend; side sheet; technical node id hidden.

### 3) Mapa
- Default: Claro + límites municipales + Proyectos federales only.
- Other layers off; accordion opens Proyectos/Lugares.
- Softer strokes; no WGS84/4326; advanced tools collapsed; cleaner layer names.

### 4) Chat Ámbito
- Compact chips wrap so **Mulegé** stays visible.

### 5) Jargon sweep
- Softened Cabos≠BCS / scorecards / headroom / tenure / GIS / file paths on key pages. No invented data. No MIES.

## Screenshots

`/workspace/BCSFP/11_bcs_hub/ux_redesign_shots/`

- `pass4_desktop_dossier_los_cabos.png`
- `pass4_desktop_ontologia.png`
- `pass4_desktop_mapa_default.png`
- `pass4_mobile_mapa.png`
- `pass4_desktop_chat.png`

## Remaining issues

- Ontology type chips depend on runtime type keys — verify all types appear.
- Some layer groups may still expand depending on `<details>` state.
- Ámbito path-sync is client-side (hard refresh may flash BCS first).
- Do **not** promote until sign-off.

## Promote (after approval)

```bash
cd /workspace/BCSFP/11_bcs_hub && npx netlify deploy --prod --dir=dist --message "UX redesign iOS pass4 — promote draft 6ab5336d983f871c25ea823b"
```

## Pass 5 (DRAFT) — 2026-09-24

**Draft URL:** https://6ab5350241d647346b564f8c--bcs-intel-portal.netlify.app

### Fixes
1. **Ontología layout:** toolbar on top (scope + type chips + search/zoom/reset); canvas ~70vh; detail sheet right; type chips for all node types; plain Spanish relation labels (Regulado por / Limita a / Abastece a / Informa la decisión); cytoscape fit after layoutstop.
2. **Dossier nav:** `/studio` moved under Territorio (out of Más) → dossier highlights Territorio.
3. **Mapa:** Solo fotos / Ajustar BCS / Pantalla completa + Opacidad polígonos → floating icon toolbar on map; panel stays layers-only.

### Screenshots
- `ux_redesign_shots/pass5_desktop_ontologia.png`
- `ux_redesign_shots/pass5_mobile_ontologia.png`
- `ux_redesign_shots/pass5_desktop_dossier_los_cabos.png`
- `ux_redesign_shots/pass5_desktop_mapa.png`

### Remaining issues
- Mobile ontology: node labels still cluttered when neighborhood is fitted; chips scroll horizontally but toolbar height still eats viewport.
- Type chips: All chip still has both ES/EN spans in DOM (lang toggle should hide one).
- Map toolbar icons are emoji (camera/fit/fullscreen) — could refine to SVG later.
- Ontology “Grafo completo” not separately verified in shots (core mode only).

### Promote (only after Ivan sign-off)
```bash
cd /workspace/BCSFP/11_bcs_hub && npx netlify deploy --prod --dir=dist --message "UX redesign iOS — promote pass5"
```

## Pass 5 PUBLISHED — 2026-09-24 (Europe/Madrid)

**Production URL:** https://bajacaliforniasur2050.com  
**New prod deploy id:** `6ab54946a9c8ddeb0a114772`  
**Unique URL:** https://6ab54946a9c8ddeb0a114772--bcs-intel-portal.netlify.app  
**Rollback deploy id:** `6ab526dcf367773d192fe790`

### Prod changes at publish
- `BORRADOR` badge gated: omitted when `CONTEXT=production` at build; runtime host check removes/hides on `bajacaliforniasur2050.com`.

### Verification
- Gate (unauth): password page (`Acceso`) ✓
- Login BCS2050 ✓
- Inicio: loads, **no BORRADOR** ✓ — shot `ux_redesign_shots/prod_desktop_inicio.png`
- `/proyectos-federales` ✓
- `/mapas` floating toolbar + leaflet ✓
- `/ontologia` 34 nodes, type chips ✓
- `/studio/los_cabos` Territorio active ✓
- `POST /api/chat` `{message}` → answer ✓
- `/api/voice-token` → token ✓

### Rollback
```bash
# Via Netlify UI: publish deploy 6ab526dcf367773d192fe790
# or CLI restore that deploy id
```
