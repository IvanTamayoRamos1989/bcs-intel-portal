# Deploy — Phase 2.9 twin pace and a short entry

## What shipped

- The second 3D map on `/gemelo` is created only while Compare is on, and only on a wide screen. Clearing the comparison removes it. Terrain tiles and layer files are shared, so the two views do not each start a fresh download.
- A layer that is not in the active theme or scenario is not fetched until it is turned on in Capas, or until a comparison needs it.
- `/inicio`, under Antes de decidir, has one line: layers, side-by-side scenarios, the municipal fiche and meeting openings. It links to the diagnosis and to `/gemelo#presets`.

`public/stills/` is gitignored and must stay on the deploy machine. This phase adds no image files.

## Still needs a real Phase 2 file

- AGEB polygons and block indicators
- Parcel footprints, cadastre lots, and any desirability score
- Morphometrics
- A forecast that would change a figure because the twin drew a second map

No new public pages. Blank fiscal cells stay blank. The phase list is `DEPLOY_REPORT_CDT_P2_INDEX.md`.
