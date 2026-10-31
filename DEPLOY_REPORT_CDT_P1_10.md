# Deploy — Phase 1.10 discoverability, specialist row, evidence references

## What shipped

- The portal stays `noindex, nofollow` on every page, so there is no public XML sitemap and no `robots.txt`. The human site map is `/rutas`. It lists `/aprendizaje`, `/vistas`, `/gemelo`, `/coordinacion`, `/metas` and `/foro` first, then the same themes and documents already used by the menu. `/ayuda` names those six routes. Search finds `/rutas`. The footer links to the site map.
- On `/inicio` the citizen questions stay first. A compact second row, in the portal blue, links Gemelo, Vistas, Metas, Coordinación, Aprendizaje and Foro. It does not sit above the questions.
- `/mapas` has a small “Vistas guardadas” line to `/vistas`. Each saved view still has both buttons: open in the twin and open in maps.
- `/gemelo` still loads only Leaflet (`leaflet.css` and `leaflet.js`). It does not load the marker-cluster scripts used on `/mapas`. The map script stays immediately after Leaflet so the map can start. A preconnect to the OpenStreetMap tile host is the only extra hint. No new heavy asset was added.
- English covers the twin, path and how-to labels, the twelve open-question gap lines, and the foresight theme names on `/metas`. The language toggle applies `data-aria-es` / `data-aria-en` as well as the existing `data-lang-en` pairs.
- `/aprendizaje#evidencia` adds three external cards, checked on 31 October 2026 (HTTP 200): [Digital Twin Victoria](https://digitaltwin.vic.gov.au/public/) (a public spatial catalogue, not the BCS map), [ClimateView](https://www.climateview.global/en) (targets tied to measures, no progress percentage here), and [Open SDG](https://open-sdg.org/) (stable indicators and visible gaps; series are not imported). The same three links are on the print shortlist. `www.digitaltwin.vic.gov.au` did not resolve and is not linked.
- Chat chunk `portal:descubrimiento-p110` points at the site map, the home row, the maps entry and those three landings.

No new municipal figures, parcels, morphometrics or census blocks.

## How to try

1. Open `/inicio`. Ask nothing. Confirm the question cards come first and the blue specialist row is underneath.
2. Open `/mapas`, use “Vistas guardadas”, then open one view in maps and in the twin.
3. Open `/rutas` and `/ayuda` and follow Gemelo, Vistas, Metas, Coordinación, Aprendizaje and Foro.
4. Switch to English on `/metas` and `/gemelo` and read a gap line and a section label.
5. Open `/aprendizaje#evidencia` and the three new cards. Print the page if you need the short list.
