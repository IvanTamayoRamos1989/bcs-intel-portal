# Deploy — Phase 1.17 saved views match the map

## What shipped

- Each of the five saved views uses a `scenario=` id from `scenarios.json` and `layers=` ids from the GIS catalog. The build throws if a view names one the map does not load.
- `/vistas` shows one line, in Spanish and English, of the layers that link actually turns on and which frame it uses. East Cape keeps the south frame of «Trayectoria actual» and turns on only East Cape and federal protected areas, in place of the other baseline layers. Housing context has no scenario, so the frame stays statewide.
- Opening a saved view on `/mapas` no longer stops after the layers turn on. The layer groups that contain those layers open, and the page scrolls to the map. The frame is applied again once the map has its size: south scenarios stay on the south, and the housing view stays on the whole state.
- `/foro` uses the same gemelo address as the view «Agua primero en el sur»: `theme=vivienda`, `scenario=water_first`, `x=pob`, `y=pobreza_pct`. That address is checked against the twin’s themes, scenarios, axes, and municipality names.

No new public pages. No AGEB, morphometrics, or cadastre.

## How to try

1. Open `/vistas/`. Each card has a blue line naming the layers. East Cape says those layers replace the scenario layers. Housing says there is no scenario.
2. Open «Agua primero en el sur» on the map. Acuíferos, corredor, East Cape, cauces and coastline are on, and the frame is the south.
3. From `/foro/`, the first link is the same gemelo address as that view. Theme, scenario and both axes match the card.
