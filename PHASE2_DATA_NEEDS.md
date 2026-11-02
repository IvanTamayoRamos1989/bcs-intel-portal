# Phase 2 data needs

Checklist for the next territorial-twin layer. Nothing here is loaded. Do not invent polygons, scores, or climate series to fill the gap.

The twin today compares five municipalities. East Cape stays inside Los Cabos. Todos Santos–El Pescadero stays inside La Paz. A blank cell stays blank.

## 1. AGEB polygons

**Status (2026-11-02): urban blocks ingested.** INEGI Censo 2020 urban blocks (17,009, joined one to one by CVEGEO; 135 census rows without a polygon stay out) arrived in the BCS2050 Foster GIS handover of 2026-10-29. `scripts/build_manzanas_2020.py` turns them into `public/gis/manzanas_2020.geojson` (population, dwellings, persons per hectare, % dwellings with piped water inside). On the twin they rise by density from zoom 9. They cover urban blocks only (728,934 people, not the state total). The 2020 and 2025 AGEB frameworks are in the same handover and are not drawn yet.

What to obtain

- INEGI Marco Geoestadístico, integración urbana: AGEB and, if the question needs it, manzanas.
- Format: shapefile (`.shp` + `.dbf` + `.shx` + `.prj`) or GeoPackage (`.gpkg`). One layer for Baja California Sur, clipped to the state, with the official AGEB code (`CVEGEO` or the current INEGI field of that vintage).
- Vintage must be named (for example the 2020 census frame). Do not mix a 2010 boundary with 2020 population.
- Attribute join: population and housing totals from the Censo de Población y Vivienda 2020 tabulations at AGEB, same vintage as the polygons.

Likely source

- INEGI Marco Geoestadístico: https://www.inegi.org.mx/temas/mg/
- INEGI Censo 2020, Principales resultados por AGEB y manzana urbana.

What the twin would unlock

- A choropleth below the municipality. East Cape and Todos Santos could be drawn as the AGEBs that fall in those places, instead of being folded into Los Cabos and La Paz.
- The map color could follow an AGEB indicator that is actually in the joined table. No indicator is implied by the polygon alone.

Do not

- Draw AGEB outlines from a sketch.
- Allocate a municipal total down to AGEBs without the census table.

## 2. Morphometrics

These are measurements on a street and block network, not a downloadable “morphometrics file.”

What to obtain first

- The AGEB or manzana polygons above, plus the street centerlines (INEGI Red Nacional de Caminos, or the existing highway extract only if its geometry is the one being measured).
- Format: line GeoPackage for streets, polygon GeoPackage for blocks. Both in the same projected CRS (a Mexico ITRF/INEGI projected CRS, not a screenshot).
- A methods note that names the software, the radius, and the year of the network.

What a later UI could show, only after that geometry exists

- A block or AGEB measure such as betweenness on the street graph, or a fractal-dimension reading of the built edge.
- The value sits on the unit that was measured. It is not a municipal average invented from five towns.

Do not

- Publish a morphometric score for Los Cabos or La Paz from the municipal boundary.
- Treat the 500 m schematic cells already described on the housing theme as blocks or parcels.

## 3. Cadastre and parcel desirability

What to obtain

- Municipal cadastral parcels as polygons, from the cadastre or IMPLAN of each municipality that actually publishes them (Los Cabos, La Paz, Loreto, Comondú, Mulegé are separate offices; one city does not stand in for another).
- Format: shapefile, GeoPackage, or file geodatabase, with a parcel id, and only the attributes the office included (area, use, year of the roll).
- If a desirability or market score is wanted, it has to be a column in that file or a documented model with its inputs. The portal does not invent the score from population or from the revenue law.

Likely source

- Catastro municipal and the municipal IMPLAN. The portal page `/catastro` already points at those offices. It is not a parcel layer.
- Predial tables are not a substitute for polygons.

What the twin would unlock

- A parcel query: tap a lot, read the attributes that came with it.
- A desirability map only where that column exists, with the office and year on the card.

Do not

- Score lots from the housing backlog, from SNIIV, or from cruise passengers.
- Split a municipal total into fake parcels.

## 4. Climate beyond the aquifer balance

What is already on the twin

- CONAGUA mean annual availability (DMA) for the aquifers the portal already cites, as points or aquifer readings, not as a climate model.
- The runoff layers on `/mapas` are a terrain model. They are not a flood map.

What to obtain before a climate layer is added

- A named CONAGUA or SMN series: station observations or an official raster (precipitation, temperature, or drought), with year range, units, and the file (CSV of stations, or GeoTIFF / NetCDF).
- The station catalog (clave, name, lat/lon) from CONAGUA or SMN so a point on the map is a real station.
- If the layer is a scenario, the scenario name and the publishing office. A story about 2050 is not a dataset.

Likely source

- CONAGUA, including the aquifer availability the portal already uses, and climatological stations.
- Servicio Meteorológico Nacional for normals and station data.

What the twin would unlock

- A climate layer with a year and a unit, next to the aquifer reading, without replacing DMA.
- Station clicks that show the series in the file, not a downscaled guess.

Do not

- Turn the DMA deficit into rainfall, temperature, or a flood depth.
- Fill a missing station by interpolating a number that no file contains.

## Acceptance check before any of this is drawn

- The file is in the archive, with publisher, year, and CRS or table grain.
- The twin card names that publisher and year.
- Units with no row stay off the chart. They are not zero.
