# Deploy — Phase 2.3 cross-theme reading

## What shipped

- On `/gemelo`, the active theme shows how it presses the other four, using the sentences already written for that theme. The scenario note, or the lever if one is set, stays in front. The reading is qualitative. It does not create a figure, and a blank cell stays blank.
- Each scenario lists its ontology nodes by the name already in the graph. They have no coordinate of their own, so the chip opens that name in `/ontologia`. If the node is Los Cabos, La Paz or Loreto, “Ver en el mapa” selects the municipality already on the twin.
- Home’s “Antes de decidir” opens the diagnosis, and a recommendation link opens that step. The site map lists both.

`public/stills/` is gitignored and must stay on the deploy machine.

## Still needs a real Phase 2 file

- AGEB polygons and block indicators
- Parcel footprints, cadastre lots, and any desirability score
- Morphometrics
- Coordinates for ontology nodes that are not already a municipality on the twin
- A simulation that would change one theme’s number because another theme moved

No new public pages. Blank fiscal cells stay blank.
