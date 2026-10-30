---
title: Riesgos
description: Sismicidad documentada y tenencia ejidal (RAN) en Baja California Sur
order: 8
updated: 2026-09-15
---

<div data-lang-es>

Síntesis de **sismicidad** documentada por el SSN y de **tenencia social (ejidos)** según RAN. No sustituye estudios de microzonificación ni un catastro completo.

## Sismicidad (evidencia en disco)

### Secuencia Loreto (abr 2024)

- Reporte especial SSN: magnitud máxima **M5.6** (18 abr 2024; ~26.16°N, 110.66°W; ~10 km).
- ~90 eventos hasta el 18 abr; mecanismo de rumbo; sentido en Loreto y costas de Sonora/Sinaloa.

### Enjambre sur de San José del Cabo (jul 2024 – oct 2025)

- Reporte SSN (8 oct 2025): **10,340** eventos localizados.
- Máximos: **M4.6** (1 sep 2025) y M4.3 (3 sep 2024).
- Asociado a la falla de San José del Cabo (mecanismos normales); profundidades ~5–18 km.

### Atlas estatal

Atlas Estatal de Riesgo BCS 2024 (Gobierno BCS / UABCS / Protección Civil), portal atlasriesgo.uabcs.mx, incluye mapa de peligrosidad por fallas y sismicidad. Capas vectoriales CENAPRED/SSN para geoproceso: **dato no consolidado** en el pack.

El POERBCS regula criterios (pendientes, minería, etc.) pero **no** es una capa sísmica.

## Tenencia de la tierra

Regímenes: privada, federal, estatal, municipal, **ejido** (propiedad social) y comunidad agraria. Las ANP son un **overlay** de restricción, no un tipo de tenencia.

### Ejidos certificados (RAN KML)

| Municipio | Ejidos en KML |
|---|---:|
| La Paz | 31 |
| Mulegé | 26 |
| Los Cabos | 19 |
| Comondú | 18 |
| Loreto | 2 |
| **Total** | **96** |

Todos tipificados como `Ejido` (programa Procede en el extracto; vintage ~ago 2020). Comunidades agrarias en este KML: **no aparecen** — no afirmar cero statewide sin refresco PHINA.

### Superficies de unidades de producción (INEGI 2007, vía PDUCP La Paz)

| Ámbito | Total ha | Ejidal | Privada |
|---|---:|---:|---:|
| BCS | 1,860,658 | 303,958 | 1,467,770 |
| La Paz | 734,239 | 97,286 | 620,766 |

Son superficies de **unidades de producción** (2007), no el % catastral 2026 del territorio municipal.



## Escorrentía superficial (modelo de terreno)

Capa de recorridos potenciales de escorrentía y concentración de flujo derivada de HydroSHEDS / HydroRIVERS (entrega 5 oct 2026). Es un **modelo de terreno**, no el mapa de inundaciones del Atlas Estatal de Riesgo. Ver [/agua/escorrentia/](/agua/escorrentia/) y el contexto documental del [Atlas UABCS](https://atlasriesgo.uabcs.mx/).

## Atlas y sismicidad

Mapas en galería `/mapas`: ciclones, fallas/sismicidad, inundaciones, tsunamis, vulnerabilidad, puntos críticos.

## Tenencia

- Ejidos RAN inventariados desde KML: **96** núcleos (Base de datos BCS 2050 — riesgos).
- CSV: Base de datos BCS 2050 — tenencia de la tierra.

## Fuentes en el acervo

- Base de datos BCS 2050 — riesgos
- Base de datos BCS 2050 — tenencia de la tierra
- Base de datos BCS 2050 — inteligencia territorial

<div class="fuentes-box">

## Fuentes

- Base de datos BCS 2050 — riesgos
- Base de datos BCS 2050 — tenencia de la tierra
- Reportes SSN en Base de datos BCS 2050 — sismicidad

</div>

## Atlas y tenencia

### Temas del atlas embebido

Ciclones, fallas/sismicidad, inundaciones, tsunamis, vulnerabilidad, puntos críticos — galería [/mapas](/mapas#riesgos).

### Tenencia

## Land tenure overview — BCS regimes

**Built:** 2026-09-15  
**Scope:** Baja California Sur only. No invented cadastral percentages.

## Regimes (how land is held)

| Regime | What it is | Custodian / instrument | Evidence in the portal |
|---|---|---|---|
| **Private (pequeña propiedad / privada)** | Dominio pleno under Art. 27 / civil registry; RPP municipal/state | Registro Público de la Propiedad y del Comercio (estado / municipio) | Cited in PDUCP La Paz (títulos de vivienda; Tabla 71 “Privada”); **no** parcel shapefile on disk |
| **Federal** | Nación: ZOFEMAT, islas, ANP federales, terrenos nacionales, some infraestructura | SEMARNAT / CONANP / SEDATU / SCT etc. | ANP shapefile + decretos Base de datos BCS 2050 — ambiente; ZOFEMAT **geometry GAP**; legal cites in Loreto PSDU / PDUCP |
| **State** | Bienes del Estado de BCS; some roads/equipamiento | Gobierno BCS | Documented as public regime in planning texts; no statewide state-property layer on disk |
| **Municipal** | Bienes del dominio público/privado municipal; áreas verdes, vialidad, equipamiento | Ayuntamientos | PDU/PSDU zoning sheets show municipal uses; no bienes-municipales inventory layer |
| **Ejido (propiedad social)** | Núcleo agrario certificado; asentamiento humano / parcelas / uso común | RAN / PHINA; Ley Agraria | **RAN KML 96 ejidos**; PSDU Barriles d-10 TENENCIA map; PDUCP Tabla 71 “Ejidal” |
| **Comunidad agraria** | Propiedad social distinta del ejido | RAN / PHINA | **Not present** in downloaded BCS KML (`tipo` all Ejido) — treat as **GAP**, not as “zero” |
| **ANP (overlay, not a tenure class)** | Restriction / veto of uses on top of any underlying tenure | CONANP programas de manejo | Shapefile 10 ANP federales; PM PDFs in Base de datos BCS 2050 — ambiente; ontology `const_anp_nucleos` / F07 |

## What we can say (evidenced numbers only)

From **PDUCP La Paz 2018**, Tabla 71 — *Superficie de las unidades de producción según tenencia de la tierra, 2007* (INEGI Censo Agrícola…), **not** full municipal cadastre:

| Ámbito | Total (ha) | Ejidal | Comunal | Privada | De Colonia | Pública |
|---|---:|---:|---:|---:|---:|---:|
| Baja California Sur | 1,860,658.1 | 303,957.6 | 42.0 | 1,467,770.3 | 76,075.9 | 12,812.3 |
| La Paz (municipio) | 734,239.1 | 97,286.3 | 0.0 | 620,766.0 | 4,887.3 | 11,299.5 |

**Caveat:** these are surfaces of **production units**, vintage **2007**. Do **not** convert to “% of municipal territory” or 2026 cadastral shares.

## Planning-map tenure layers on disk

| Asset | Geography | Notes |
|---|---|---|
| Base de datos BCS 2050 — planeación | Los Barriles–El Cardonal | Primary PSDU tenure sheet; scanned |
| PDU 2040 cartografía 400-series | Los Cabos | Zoning, not a tenure cadastre |
| RAN KML (this folder / `_raw/ran/`) | Statewide | Certified núcleo perimeters |

## Ontology link

- Constraint: `const_tenencia` (tenencia irregular / conflicto) in Base de datos BCS 2050 — ontología
- Does **not** override capacity candados F01–F04; tenure is a delivery / social-risk layer under F06–F08 coherence.

## GAPS

1. Municipal RPP / catastro vector (private parcels) — none on disk.  
2. ZOFEMAT / terrenos ganados al mar polygons — GAP.  
3. State / municipal bienes domain layers — GAP.  
4. Live PHINA refresh + RAN SHAPE — KML only (shp endpoint 404).  
5. Atlas / PDU “% tenure” for Los Cabos, Loreto, Comondú, Mulegé — not extracted as tables on disk.  
6. Do not invent colonia / irregular settlement % without source.


### Sismicidad reciente (pack)

Secuencias documentadas SSN (Loreto 2024 M5.6; SJD 2025 M4.6) en `_raw/ssn_cenapred/`.

Crosswalk: Base de datos BCS 2050 — riesgos

</div>

<div data-lang-en hidden>
Synthesis of **seismicity** (SSN) and **social tenure (ejidos)** per RAN materials in the pack. Does not replace microzonation or a full land-rights census. Hazard atlas themes (cyclones, etc.) appear in `/mapas` gallery captions.

## Tenure & strategy

Community/tenure tension is a standing ASSUMPTION lens on dossiers until cadastral evidence is complete — Kahn Filter for territory: who has secure access to land and water.

## Data sources

- Portal: `/riesgos`, `/mapas`, `/studio` (tenure ask), `/catastro`

<div class="fuentes-box">

## Sources

- Base de datos BCS 2050 — riesgos
- Base de datos BCS 2050 — tenencia de la tierra
- SSN reports under `_raw/ssn_cenapred/`

</div>

</div>

## <span data-lang-es>Mapas relacionados</span><span data-lang-en hidden>Related maps</span>

Filtrados por tema `riesgos` · ver galería completa en [/mapas](/mapas#riesgos).


<figure class="map-card">
<a href="/maps/atlas-ciclones.jpg" target="_blank" rel="noopener"><img src="/maps/atlas-ciclones.jpg" alt="Atlas — Ciclones" loading="lazy" /></a>
<figcaption class="cap"><strong>Atlas — Ciclones</strong><br/><small>Atlas estatal de riesgos BCS (CENAPRED / pack riesgos)</small></figcaption>
</figure>


<figure class="map-card">
<a href="/maps/atlas-fallas-sismicidad.jpg" target="_blank" rel="noopener"><img src="/maps/atlas-fallas-sismicidad.jpg" alt="Atlas — Fallas y sismicidad" loading="lazy" /></a>
<figcaption class="cap"><strong>Atlas — Fallas y sismicidad</strong><br/><small>Atlas estatal de riesgos BCS (CENAPRED / pack riesgos)</small></figcaption>
</figure>


<figure class="map-card">
<a href="/maps/atlas-inundaciones.jpg" target="_blank" rel="noopener"><img src="/maps/atlas-inundaciones.jpg" alt="Atlas — Inundaciones" loading="lazy" /></a>
<figcaption class="cap"><strong>Atlas — Inundaciones</strong><br/><small>Atlas estatal de riesgos BCS (CENAPRED / pack riesgos)</small></figcaption>
</figure>


<figure class="map-card">
<a href="/maps/atlas-riesgo-puntos-criticos.jpg" target="_blank" rel="noopener"><img src="/maps/atlas-riesgo-puntos-criticos.jpg" alt="Atlas — Puntos críticos de riesgo" loading="lazy" /></a>
<figcaption class="cap"><strong>Atlas — Puntos críticos de riesgo</strong><br/><small>Atlas estatal de riesgos BCS (CENAPRED / pack riesgos)</small></figcaption>
</figure>


<figure class="map-card">
<a href="/maps/atlas-tsunamis.jpg" target="_blank" rel="noopener"><img src="/maps/atlas-tsunamis.jpg" alt="Atlas — Tsunamis" loading="lazy" /></a>
<figcaption class="cap"><strong>Atlas — Tsunamis</strong><br/><small>Atlas estatal de riesgos BCS (CENAPRED / pack riesgos)</small></figcaption>
</figure>


<figure class="map-card">
<a href="/maps/atlas-vulnerabilidad.jpg" target="_blank" rel="noopener"><img src="/maps/atlas-vulnerabilidad.jpg" alt="Atlas — Vulnerabilidad" loading="lazy" /></a>
<figcaption class="cap"><strong>Atlas — Vulnerabilidad</strong><br/><small>Atlas estatal de riesgos BCS (CENAPRED / pack riesgos)</small></figcaption>
</figure>


<figure class="map-card">
<a href="/maps/psdu-barriles-riesgos.jpg" target="_blank" rel="noopener"><img src="/maps/psdu-barriles-riesgos.jpg" alt="PSDU Barriles — Riesgos" loading="lazy" /></a>
<figcaption class="cap"><strong>PSDU Barriles — Riesgos</strong><br/><small>Ayuntamiento La Paz — PSDU Los Barriles–El Cardonal</small></figcaption>
</figure>


<figure class="map-card">
<a href="/maps/psdu-barriles-tenencia.jpg" target="_blank" rel="noopener"><img src="/maps/psdu-barriles-tenencia.jpg" alt="PSDU Barriles — Tenencia de la tierra" loading="lazy" /></a>
<figcaption class="cap"><strong>PSDU Barriles — Tenencia de la tierra</strong><br/><small>Ayuntamiento La Paz — PSDU Los Barriles–El Cardonal</small></figcaption>
</figure>


## <span data-lang-es>Documentos de datos (muestra)</span><span data-lang-en hidden>Sample data documents</span>

| <span data-lang-es>Documento</span><span data-lang-en hidden>Document</span> | <span data-lang-es>Formato</span><span data-lang-en hidden>Format</span> | <span data-lang-es>Año</span><span data-lang-en hidden>Year</span> | <span data-lang-es>Fuente</span><span data-lang-en hidden>Source</span> |
|---|---|---|---|
| Earthquakes seismicity | md | — | Base de datos BCS 2050 — riesgos |
| Ejidos inventory | md | — | Base de datos BCS 2050 — tenencia de la tierra |
| Hazards crosswalk | md | — | Base de datos BCS 2050 — riesgos |
| Tenure overview | md | — | Base de datos BCS 2050 — tenencia de la tierra |
| Nucleos agrarios bcs RAN kml | csv | — | Base de datos BCS 2050 — tenencia de la tierra |
| Tenure maps index | csv | — | Base de datos BCS 2050 — tenencia de la tierra |

<span data-lang-es>[Ver más en catálogo](/catalogo?theme=riesgos) · carpeta temática en filtros.</span>
<span data-lang-en hidden>[See more in catalog](/catalogo?theme=riesgos) · theme folder in filters.</span>

