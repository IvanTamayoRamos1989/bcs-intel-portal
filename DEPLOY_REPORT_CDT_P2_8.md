# Deploy — Phase 2.8 twin and atlas

## What shipped

- On `/gemelo`, Open in atlas goes to `/explorar` with the current theme, the atlas layers that theme already matches, and the chosen municipality.
- On `/explorar`, Decision twin returns to `/gemelo` at the diagnosis step, with that theme and municipality when they are known.
- A layer with no atlas counterpart is left out. The two pages stay separate.

`public/stills/` is gitignored and must stay on the deploy machine. This phase adds no image files.

## Still needs a real Phase 2 file

- AGEB polygons and block indicators
- Parcel footprints, cadastre lots, and any desirability score
- Morphometrics
- A forecast that would change a figure because the atlas was opened

No new public pages. Blank fiscal cells stay blank.
