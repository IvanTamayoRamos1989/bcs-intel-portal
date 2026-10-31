# Deploy — Phase 1.20 territory photos and home shortcuts

## What shipped

- Each saved view can show one territory photo when `public/stills/stills.geojson` is on the machine. The photo’s point has to sit in that view’s frame (for East Cape, inside the East Cape focus polygons). The caption is the feature’s own name. The image path has to already start with `/stills/`. Grid photos are skipped. If the file is missing or empty, the card stays text. The map and twin links are unchanged.
- Against the deploy copy of the stills file, the five matches are: La Paz (agua), La Paz cut-across junction (corridor), Puerto Adolfo López Mateos (ports), Santa Rosalía (housing), and Buenavista (East Cape, municipio Los Cabos).
- Home keeps the chat first and the specialist links. Under the questions there are three shortcuts: evidence, the five views, and the ten-minute walk, each with one plain line in Spanish and English.
- Chat guide `portal:consulta-ruta-p120` answers «evidencia», «casos de otras ciudades», «recorrido foro», and «hoja invitados», and ends with a follow-up. Desalination and C40, Loreto air passengers, and the five view names still retrieve their own guides.

`public/stills/` is gitignored and must stay on the deploy machine. A checkout without that file builds text-only view cards; the thumbnails appear when the stills are present at build time.

No new public pages. No AGEB polygons, morphometrics, cadastre, or a new climate series.

## How to try

1. On a machine with the stills file, open `/vistas/`. Each card shows one small photo and the place name already on that photo. Without the file, the cards are text only.
2. Open `/inicio`. Under the questions, read Evidencia, Vistas, and Recorrido. The specialist row is still there.
3. In the chat, ask “evidencia”, “casos de otras ciudades”, “recorrido foro”, and “hoja invitados”. Then ask “desalación Los Cabos”, “pasajeros Loreto”, and “cinco vistas” and confirm those still open their own guides.
