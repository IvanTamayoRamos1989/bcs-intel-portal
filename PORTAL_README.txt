PORTAL BCS — Inteligencia territorial / Territorial intelligence
================================================================
MachineId: 22b13f96-0356-4dac-aef5-c3fb1a0d0925
Built: 2026-09-15

WHAT THIS IS
------------
Static multipage Astro site that opens BCSFP data like a browsable
Google Drive (folders 00_catalog → 14_gis_atlas + 13_territorial_intelligence
subpacks) PLUS thematic intelligence pages (agua, energía, inmobiliario, etc.).

NOT an F+P commercial proposal. Spanish UI default + English via toggle.

HOW TO OPEN
-----------
Preferred (paths like /maps/ and /catalog_slim.json work):
  cd portal   (or the folder that contains this README next to index.html)
  npx --yes serve -p 4173 .
  Then open http://localhost:4173/

Alternatively open index.html via any static file server.
Opening file:// directly may break absolute /maps/ and catalog fetch.

ES | EN LANGUAGE TOGGLE
-----------------------
Header button «ES | EN» on every page. Choice persists in localStorage
key: bcs_portal_lang. Default: Spanish.

DRIVE-LIKE BROWSING
-------------------
Home = folder cards with file counts → /catalogo?folder=01_planning etc.
Catalog lists ~2678 indexed files with Desktop\BCSFP\... paths.
Large PDFs are NOT embedded; copy the Desktop path to open on your PC.

MAPS
----
/mapas embeds 35 JPG from public/maps/ (also beside this README under maps/).

KEY PAGES
---------
/ /catalogo /territorio /planeacion /agua /energia /ambiente
/conectividad /riesgos /economia /inmobiliario /turismo
/comunidades /catastro /mapas /ontologia /fuentes

Desktop target for sync:
  C:\Users\Usuario\Desktop\BCSFP\11_bcs_hub\portal\
