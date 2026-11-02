# Deploy — the shell map is only Baja California Sur

## What was wrong

Diseño urbano turns on Ciudades / pueblos. That file included towns on the Sinaloa coast (Los Mochis and the villages inland of it), drawn in orange. Roads, power lines and the coastline file had the same leak. The camera could also zoom out far enough to show the mainland, because the street and satellite tiles cover the whole continent.

## What changed

- Towns, roads, coast, power lines, protected areas and waterways in `public/gis` now keep a feature only when it touches the published state boundary, or sits within 25 km of it. Sinaloa and Sonora towns are gone. Cabo Frailes and the Vizcaíno lagoon stay.
- The twin map, shared with `/gemelo`, draws an ocean mask outside that boundary, and it will not zoom out to Hermosillo or further north. Calles and Satélite still switch inside the state.
- The file list skips a document whose title is about Sinaloa, Los Mochis, Hermosillo, Culiacán, Navojoa or Guasave and does not mention Baja California Sur. National files used for BCS figures stay.

`/inicio` is still the window. `/gemelo` is still the long board.

## How to verify

1. Open `/inicio`. The map frames the state. The orange cluster on the Sinaloa coast is gone.
2. Turn on Diseño urbano. The towns that appear are in the state.
3. Zoom out. The view stops at the state, and the water mask covers the mainland.
