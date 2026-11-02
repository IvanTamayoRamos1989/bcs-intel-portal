# Deploy — 3-pane shell

## What changed

After login the portal opens `/inicio` as one window: chat on the left, the territorial twin in the center, and the file index on the right. The old pages stay where they are. `/gemelo` is still the long board. The header maze is not the home.

The chat is the existing portal chat (same corpus, same cookie, same follow-up). A reply dispatches `bcs:chat-answer`. The shell reads the question and the cited files.

## How chat, map and files connect

- **Map.** The center pane starts the same MapLibre terrain helper as the twin (`/gemelo/cdt3d.js`). If WebGL fails, Leaflet draws the same layers. Calles uses OpenStreetMap tiles. Satélite uses the public Esri imagery tiles. Neither needs a Google key. Theme chips and the Capas list turn on layers that already exist in the twin catalog. Nothing is invented for blocks, parcels, street form or a climate series. Qué falta still points at `/gemelo/#listo`.
- **Place.** A municipality chip, or a question that names Los Cabos, La Paz, Loreto, Comondú, Mulegé, Todos Santos or East Cape, frames that municipality. “El Novillo” turns on federal projects and flies to the published La Paz point for that project. The note on the map says that point is the municipality, not the worksite.
- **Files.** `public/shell/files.json` is built from the catalog, the news items and the stills metadata already in the repo. Search filters that list. A chat answer pins up to eight matching files under “De esta respuesta”. Drive files and news open in a new tab. A still previews in the pane, and says so if the image is not on this machine.

## How to verify

1. Sign in. The window is chat, map, files.
2. Ask about Presa El Novillo. The map frames La Paz’s published project point and the file list shows the Novillo document.
3. Turn a theme chip and the Calles / Satélite switch. The map changes.
4. Search a file name in the right pane and open it.
5. On a narrow screen, use Consulta, Mapa and Archivos.

## Follow-ups for a later PR

- The file index matches names and links. It does not yet rank by the chat’s full evidence text, and folders are capped in the tree until you search.
- Satellite and street tiles depend on those public hosts. The terrain remains when they fail.
- The long twin board (recipes, consultation, copy view, host checklist) is still `/gemelo`, not a second copy inside the shell.
