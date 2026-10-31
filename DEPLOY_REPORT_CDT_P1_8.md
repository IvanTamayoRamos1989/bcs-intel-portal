# Deploy — Phase 1.8 dossiers, growth links, and a guest sheet

## What shipped

- Municipal pages (`/studio/…`, reached from `/lugares`) link to `/gemelo/?muni=` for that municipality and to the matching saved view: Cabos and La Paz → corredor, Loreto and Mulegé → puertos, Comondú → contexto de vivienda. The state page links to the twin and the full view list.
- On the twin, the selected municipality links to its dossier, to `/crecimiento/#` that vocation, and to its saved view. Demand-and-supply recommendations link to the same vocation anchor (`/crecimiento/#los_cabos` and the other place ids).
- `/gemelo`, `/aprendizaje`, `/vistas`, `/metas` and `/coordinacion` each open with one paragraph and three steps. Theme, scenario and municipality controls stay real buttons, with a visible focus ring on the twin.
- `/foro` is a four-link sheet for side-panel guests: twin (water and living standard already selected), saved views, learning (print leaves the external list), and coordination. The consultation chat, search, and the documents menu include it. No personal data.

## How to try

1. `/studio/loreto/` → Ver en el gemelo. The URL should include `muni=Loreto`.
2. On that twin page, open Demanda y oferta and confirm it lands on `/crecimiento/#loreto`.
3. `/foro/` and print `/aprendizaje/`.
4. Tab through the twin themes and confirm the focus ring.

`npm run build` must stay green. No new figures.
