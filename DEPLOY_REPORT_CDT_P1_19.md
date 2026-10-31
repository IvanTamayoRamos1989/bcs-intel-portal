# Deploy — Phase 1.19 evidence cards, plain map lines, nav key

## What shipped

- `/aprendizaje#evidencia` adds five external cards, in Spanish and English, checked on 31 October 2026: IFC Los Cabos water partnership (2023), McEvoy on desalination in Baja California Sur (2014), C40 Water Safe Cities, C40 coastal adaptation, and UrbanShift Costa Rica. Each card is one teaching sentence, the source, the year when the page states it, the full address, and the line that those figures are not Baja California Sur figures. The CEPAL homepage names a public-land-bank piece and does not publish an article address, so that card is not added. KPESIC is still not linked.
- Each saved view on `/vistas` has one plain line, in Spanish and English, saying what a non-specialist will see on the map. The scenario and layer links are unchanged. No thumbnail: this checkout has no still photos.
- The duplicate `navStudio` label is gone, so the build no longer warns about it.
- The chat guide `portal:evidencia-desal-p119` answers desalination in Los Cabos, uncounted water, C40 and UrbanShift, points at `/aprendizaje#evidencia`, and ends with a follow-up. Loreto air passengers and the five view names still retrieve their own guides.

`public/stills/` is gitignored and must stay on the deploy machine.

No new public pages. No AGEB polygons, morphometrics, cadastre, or a new climate series.

## How to try

1. Open `/aprendizaje#evidencia`. The first five cards are the new ones. Each title is a link that opens the external page.
2. Open `/vistas/`. Each card starts with a plain sentence about the place and the layers.
3. In the chat, ask “desalación Los Cabos”, “agua no contabilizada”, and “casos C40”. The context is the new guide. “pasajeros Loreto” and “cinco vistas” still open their own guides.
