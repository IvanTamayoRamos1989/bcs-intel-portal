# Deploy — Phase 3.0 legible terrain and urban blocks

## What shipped

- The twin frames the whole state when tilted. Los Cabos no longer falls off the bottom edge. A municipality frame leaves room for the fiche.
- New default base, Relieve: an elevation tint and hillshade from the same DEM, with place names that do not overlap. Calles and Satélite stay. On Calles the twin draws no second set of names.
- Towns are sized by the population in the file. Roads are drawn by class.
- Panel 1 has a new layer: INEGI Censo 2020 urban blocks, 17,009 blocks, rising by persons per hectare from zoom 9. Tapping a block opens its population, dwellings, density, piped water (2020) and CVEGEO. The height is not a building height. A blank census cell stays blank.

## Source

BCS2050 Foster GIS handover, 2026-10-29 (`inegi_censo_2020_manzanas_gis`). Rebuild with `python3 scripts/build_manzanas_2020.py <package root>`.

## Still needs a real file

- Building footprints and parcels (the La Paz municipal package names them; it is not in the repo yet)
- Morphometrics
- A climate series beyond the aquifer balance
