# Decision twin — public surface deferred

**Status:** Public Decision twin UI removed from the BCS intel portal (2026-09-16).

## Why
Scenarios are useful later, but premature as a product surface. Next step is to **analyze demand and supply of growth** (water, energy, land, infrastructure, and related constraints) on the backend — only then assume and present scenarios.

## What was removed (public)
- Nav link «Gemelo de decisión» / «Decision twin» (BaseLayout quick links + `navGroups`)
- Header search entry for `/decision`
- CTA card on `/resumen`
- Public pages `/decision`, `/gemelo`, `/decision-twin` → **301 to `/resumen/`**
- Chat corpus pitch that sent users to `/decision` (replaced with a soft Focus-places note)
- Maps layer group label «Decision focus» → quiet **«Focus places» / «Lugares de foco»** (no scenario switcher advertised)

## What was retained (backend / later)
- `src/data/scenarios.json` (+ `public/scenarios.json`)
- Focus GeoJSON: `public/gis/focus_*.geojson`
- `public/gis/layers.json` entries for those layers (group `focus`)
- `DEPLOY_REPORT_DECISION_TWIN_P1.md` (historical; deferred note at top)
- Maps URL deep-link helpers for focus layers remain available for internal GIS work

## Next step
Demand & supply of growth analysis → then revisit scenarios / decision twin as a deliberate product surface.
