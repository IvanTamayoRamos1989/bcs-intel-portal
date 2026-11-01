# Deploy — Phase 2.4 municipality fiche

## What shipped

- Tapping a municipality on `/gemelo` opens its fiche beside the map. The fiche shows the name, the chosen height figure with unit, source and year, or an em dash when that figure is missing, the demand, supply and balance texts already written for that place, and the scenario recommendation when it applies. It links the saved view and the theme’s learning page.
- The link keeps `muni` with theme, scenario, path, lever, height and comparison.
- The first visit shows one dismissible note on tilt, rotate, State, Layers and the four-step path. If motion is reduced, that note does not ask anyone to tilt.

`public/stills/` is gitignored and must stay on the deploy machine.

## Still needs a real Phase 2 file

- AGEB polygons and block indicators
- Parcel footprints, cadastre lots, and any desirability score
- Morphometrics
- A demand or supply figure that is not already written for that place

No new public pages. Blank fiscal cells stay blank.
