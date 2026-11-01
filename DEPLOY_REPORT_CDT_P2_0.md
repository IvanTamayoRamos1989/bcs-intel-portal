# Deploy — Phase 2.0 3D twin

## What shipped

- `/gemelo` explores the state on the same terrain as the atlas (MapLibre, local Terrarium tiles, then the public elevation tiles). Pitch, bearing and a statewide frame are on the map. If the browser has no WebGL, the same layers stay on the flat map.
- Capas are grouped by the five themes, plus a short base note. Each layer shows its source and year, or says the year is not recorded. Switching theme turns on that theme’s layers and keeps the scenario layers.
- The four scenarios stay the ones in `scenarios.json`. «Qué cambia» names the layers, the municipalities under stress, and a cross-theme note from figures already on the twin. «Comparar con» highlights the layers that belong only to the other scenario. The link keeps `theme`, `scenario` and `compare`.
- `#limites` says what the 3D view can do now, and that it still cannot do block maps, parcels, cadastre or form metrics. Chat guide `portal:gemelo-3d-p20` answers “gemelo 3d”, “capas del gemelo” and “escenarios”.

`public/stills/` is gitignored and must stay on the deploy machine.

## Still needs a real Phase 2 file

- AGEB polygons and block indicators
- Parcel form, cadastre lots, and any desirability score
- Morphometrics (fractal dimension, betweenness, urban-form scores)
- A climate series beyond the aquifer balance already on the twin
- Municipal extrusions and scenario levers that are not layer presets

No new public pages. Blank fiscal cells stay blank. Comondú and Mulegé stay off the 2025 air series.
