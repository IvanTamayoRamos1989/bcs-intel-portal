---
title: Territorio
description: Municipios, localidades y población de Baja California Sur según INEGI Censo 2020
order: 1
updated: 2026-09-15
---

<div data-lang-es>

Baja California Sur (`cve_ent=03`) es un estado peninsular con **cinco municipios**. No es Baja California (norte).

## Cifras clave (INEGI Censo 2020 ITER)

| Concepto | Valor |
|---|---:|
| Población estatal (POBTOT) | **798,447** |
| Municipios | **5** |
| Localidades nombradas con POBTOT ≥ 1 | **2,543** |

Las 2,543 localidades suman exactamente la población estatal cuando se excluyen filas agregadas ITER `LOC=0000/9998/9999`.

## Municipios y cabeceras

| Municipio | Clave | POBTOT municipal (municipio completo) | Localidades | Cabecera (POBTOT de la localidad) |
|---|---|---:|---:|---|
| Los Cabos | 008 | 351,111 | 428 | San José del Cabo (136,285) |
| La Paz | 003 | 292,241 | 1,018 | La Paz (250,141) |
| Comondú | 001 | 73,021 | 589 | Ciudad Constitución (43,805) |
| Mulegé | 002 | 64,022 | 381 | Santa Rosalía (14,357) |
| Loreto | 009 | 18,052 | 127 | Loreto (16,311) |

## Lectura territorial breve

- La **capital administrativa** es La Paz; el **peso demográfico y turístico** se concentró en Los Cabos.
- En Los Cabos, la localidad más poblada es **Cabo San Lucas** (202,694), no la cabecera.
- Localidades urbanas (TAMLOC ≥ 5, ≥ 2,500 hab.): pocas por municipio; la mayor parte del territorio es rural en número de localidades.
- Todos Santos, El Pescadero y Los Barriles son localidades del municipio de **La Paz**, no municipios propios.

## Ambito urbana / rural

El extracto ITER BCS no trae columna `AMBITO`. Se deriva de `TAMLOC`: clases 1–4 = rural (&lt; 2,500); 5–14 = urbana (≥ 2,500).



## Jerarquía de asentamientos (lectura)

- **Los Cabos**: cabecera San José del Cabo (136,285); localidad primate **Cabo San Lucas** (202,694). Ambas bajo PDU 2040.
- **La Paz**: ciudad La Paz (250,141); centros Todos Santos (7,185), El Pescadero (4,245), El Centenario (6,221), Chametla (3,054). Los Barriles (1,674) es rural pero centro turístico con PSDU.
- **Comondú**: Constitución (43,805), Insurgentes (9,133), Puerto San Carlos (5,742).
- **Mulegé**: Santa Rosalía (14,357), Guerrero Negro (13,596), Villa A.A. Alvarado Arámburo (10,897), Heroica Mulegé (3,834).
- **Loreto**: Loreto (16,311) concentra casi toda la población municipal.

## Fuentes en el acervo

| Recurso | Fuente |
|---|---|
| Master communities | Base de datos BCS 2050 — inteligencia territorial |
| Top localidades | Base de datos BCS 2050 — inteligencia territorial |
| Jerarquía | Base de datos BCS 2050 — inteligencia territorial |
| Historias | Base de datos BCS 2050 — historia |

Ver perfiles fiscales y SWOT en [/comunidades](/comunidades).

<div class="fuentes-box">

## Fuentes

- Base de datos BCS 2050 — inteligencia territorial
- Base de datos BCS 2050 — inteligencia territorial (2,543 filas; suma POBTOT 798,447)
- Origen demográfico: INEGI Censo 2020 ITER BCS

</div>

## Síntesis territorial (TI)

## Settlement hierarchy — Baja California Sur

Source: INEGI Censo 2020 ITER. POBTOT as published. Tier rules in Base de datos BCS 2050 — territorio.

## Estado: Baja California Sur (`cve_ent=03`) — POBTOT **798,447**

Five municipalities only. Ontology: `terr_bcs`.

## Municipio: Los Cabos (`008`) — POBTOT **351,111**
- Ontology: `terr_los_cabos`
- Named localidades (POBTOT≥1): **428**
- Urbana (TAMLOC≥5): **2** · Rural: **426**

### Cabecera
- **San José del Cabo** (`0001`) — POBTOT 136,285 · urbana · tier `cabecera`
  - linked_plan: IMPLAN Los Cabos — PDU 2040 Segunda Actualizacion (2013) (+ see CSV)

### Main urban localities (TAMLOC ≥5 / ambit=urbana)
- **Cabo San Lucas** (`0054`) — 202,694 **centro_poblacion**
- **San José del Cabo** (`0001`) — 136,285 **cabecera**

### Notable tourism / agro settlements (selected from ITER names; POBTOT as published)
- **Cabo San Lucas** (`0054`) — 202,694 · centro_poblacion · has linked_plan
- **La Ribera** (`0217`) — 2,320 · rural
- **Miraflores** (`0159`) — 1,352 · rural
- **Santiago** (`0280`) — 644 · rural
- **Cabo Pulmo** (`0053`) — 61 · rural

> Note: Cabecera is **San José del Cabo**; primate urban locality is **Cabo San Lucas** (both under PDU 2040).

## Municipio: La Paz (`003`) — POBTOT **292,241**
- Ontology: `terr_la_paz`
- Named localidades (POBTOT≥1): **1018**
- Urbana (TAMLOC≥5): **5** · Rural: **1013**

### Cabecera
- **La Paz** (`0001`) — POBTOT 250,141 · tier `cabecera`
  - linked_plan: Ayuntamiento La Paz — PDUCP Centro de Poblacion La Paz (2018) (+ see CSV)

### Main urban localities (TAMLOC ≥5 / ambit=urbana)
- **La Paz** (`0001`) — 250,141 **cabecera**
- **Todos Santos** (`0003`) — 7,185 **centro_poblacion**
- **El Centenario** (`0092`) — 6,221
- **El Pescadero** (`0684`) — 4,245 **centro_poblacion**
- **Chametla** (`0108`) — 3,054

### Notable tourism / agro settlements (selected from ITER names; POBTOT as published)
- **Todos Santos** (`0003`) — 7,185 · has linked_plan
- **El Pescadero** (`1884`) — 10 · rural
- **Los Barriles** (`0392`) — 1,674 · rural · has linked_plan
- **El Cardonal** (`1424`) — 308 · has linked_plan
- **El Centenario** (`0092`) — 6,221 · urbana
- **Chametla** (`0108`) — 3,054 · urbana
- **San Juan de los Planes** (`0697`) — 841 · rural

> Note: Todos Santos / El Pescadero / Los Barriles are **La Paz** localities (not municipalities).

## Municipio: Comondú (`001`) — POBTOT **73,021**
- Ontology: `terr_comondu`
- Named localidades (POBTOT≥1): **589**
- Urbana (TAMLOC≥5): **3** · Rural: **586**

### Cabecera
- **Ciudad Constitución** (`0001`) — POBTOT 43,805 · tier `cabecera`
  - linked_plan: Ayuntamiento Comondu — PMDU Vision 2025 (2025) + Ayuntamiento Comondu — Plan Municipal de Desarrollo 2024 2027 (2024) (ON DISK); fiscal Ley Ingresos on disk

### Main urban localities (TAMLOC ≥5 / ambit=urbana)
- **Ciudad Constitución** (`0001`) — 43,805 **cabecera**
- **Ciudad Insurgentes** (`0133`) — 9,133
- **Puerto San Carlos** (`0280`) — 5,742

### Notable tourism / agro settlements (selected from ITER names; POBTOT as published)
- **Ciudad Insurgentes** (`0133`) — 9,133 · urbana
- **Puerto San Carlos** (`0280`) — 5,742 · urbana
- **Puerto Adolfo López Mateos** (`0003`) — 2,227 · rural
- **San Miguel de Comondú** (`0319`) — 132 · rural
- **San José de Comondú** (`0293`) — 73 · rural

## Municipio: Mulegé (`002`) — POBTOT **64,022**
- Ontology: `terr_mulege`
- Named localidades (POBTOT≥1): **381**
- Urbana (TAMLOC≥5): **4** · Rural: **377**

### Cabecera
- **Santa Rosalía** (`0001`) — POBTOT 14,357 · tier `cabecera`
  - linked_plan: Ayuntamiento Mulege — Plan Municipal Desarrollo 2024 2027 (2025) (PMD only; **PDU GAP**)

### Main urban localities (TAMLOC ≥5 / ambit=urbana)
- **Santa Rosalía** (`0001`) — 14,357 **cabecera**
- **Guerrero Negro** (`0066`) — 13,596
- **Villa Alberto Andrés Alvarado Arámburo** (`0482`) — 10,897
- **Heroica Mulegé** (`0097`) — 3,834

### Notable tourism / agro settlements (selected from ITER names; POBTOT as published)
- **Guerrero Negro** (`0066`) — 13,596 · urbana
- **Villa Alberto Andrés Alvarado Arámburo** (`0482`) — 10,897 · urbana
- **Heroica Mulegé** (`0097`) — 3,834 · urbana
- **Bahía Tortugas** (`0015`) — 2,367 · rural
- **Bahía Asunción** (`0014`) — 1,453 · rural
- **San Ignacio** (`0149`) — 521 · rural

## Municipio: Loreto (`009`) — POBTOT **18,052**
- Ontology: `terr_loreto`
- Named localidades (POBTOT≥1): **127**
- Urbana (TAMLOC≥5): **1** · Rural: **126**

### Cabecera
- **Loreto** (`0001`) — POBTOT 16,311 · tier `cabecera`
  - linked_plan: Ayuntamiento Loreto — PMDU (2024) + PSDU 2024 consulta + POEL 2014 (2007 gazette still GAP)
  - SETUE IE: SETUE BCS — Informacion Estrategica Loreto 2025 (2025) + `…Loreto-2026.pdf` (ON DISK; 2020 also in data_lake)

### Main urban localities (TAMLOC ≥5 / ambit=urbana)
- **Loreto** (`0001`) — 16,311 **cabecera**

### Notable tourism / agro settlements (selected from ITER names; POBTOT as published)
- **Nopoló** (`0118`) 

### Fortalezas y candados estatales (extracto)

## Fortalezas / candados / oportunidades — por municipio (evidencia)

**Cosecha:** 2026-09-15 · Solo evidencia empaquetada o oficial citada. Sin marketing.  
**Ids:** ontología Base de datos BCS 2050 — ontología + hallazgos Base de datos BCS 2050 — ontología.

---

## Estado BCS (`terr_bcs`)

### Fortalezas
- Economía de servicios: alojamiento/alimentos ~15.2% del PIB estatal (cifras preliminares base 2018); comercio al por menor 17.3%; transportes 10.0% — SETUE IE BCS 2026 (SETUE BCS — Informacion Estrategica BCS 2026 (2026)).
- Concentración urbana: 15 localidades urbanas concentran 91.1% de la población; La Paz + Cabo San Lucas + San José del Cabo = 73.3% estatal — SETUE IE BCS 2026 (INEGI CPV).
- Instrumento regional vigente: POERBCS decretado BOGE Ext. No.09 (21-ene-2026) — `inst_poerbcs` · Boletín Oficial BCS — POERBCS Decreto Boletin Oficial No09 (2026) (F06).
- PED 2021–2027 vigente — `inst_ped`.

### Candados / constraints
- `const_red_aislada` / `rc_sibcs`: SIBCS aislado; pico 2024 ~688.5–689 MW en alerta; interconexión SIN–BCS pausada — F03 · Base de datos BCS 2050 — estudios temáticos · PRODESEN/PAMRNT en Base de datos BCS 2050 — energía.
- `const_dma_deficit` / `const_escasez_agua`: cuatro acuíferos de polos sin volumen para nuevas concesiones (0313, 0317, 0319, 0324) — F01 · CONAGUA DMA PDFs en Base de datos BCS 2050 — agua.
- `const_anp_nucleos`: núcleos ANP (Pulmo, Vizcaíno, Sierra La Laguna, Loreto) — F07 · `terr_anp_*`.

### Oportunidades (evidencia, no pitch)
- Alineación de inversión a UGAs POER + PDU vigentes antes de densificar fuera de centro de población — F06 · `dq_coherencia_instrumentos`.
- Desal / oferta no subterránea como sostén de déficit potable puntual, **no** como crédito DMA — F02 · `proj_desal_cabos`.

---


### Población y polarización

- Tres ciudades (La Paz + Cabo San Lucas + San José del Cabo) concentran ~73% de la población estatal (SETUE IE BCS 2026 / INEGI CPV).
- 15 localidades urbanas concentran ~91% de la población.
- El corredor turístico-residencial de Los Cabos concentra presión espacial, fiscal y de infraestructura (agua/energía).

Ver perfiles municipales completos en [/comunidades](/comunidades) y fiscal en [/fiscal](/fiscal).

</div>

<div data-lang-en hidden>
Baja California Sur (`cve_ent=03`) is a peninsular state with **five municipalities** and **798,447** inhabitants (INEGI Census 2020). It is **not** Baja California (north). Settlement hierarchy: Los Cabos and La Paz dominate population; Comondú, Loreto and Mulegé complete the polycentric map that dossiers treat as complementary vocations.

## Settlement hierarchy

Use `/comunidades` and municipio tables for locality counts. Pair state KPIs on `/resumen` with the three driving vocations per card — Cabos ≠ BCS.

## Data sources

- Portal: `/territorio`, `/comunidades`, `/resumen`, `/studio`

<div class="fuentes-box">

## Sources

- INEGI Censo 2020 ITER
- Base de datos BCS 2050 — inteligencia territorial

</div>

</div>

## <span data-lang-es>Mapas relacionados</span><span data-lang-en hidden>Related maps</span>

_Sin JPG temáticos en galería; ver [/mapas](/mapas) y Base de datos BCS 2050 — territorio._


## <span data-lang-es>Documentos de datos (muestra)</span><span data-lang-en hidden>Sample data documents</span>

| <span data-lang-es>Documento</span><span data-lang-en hidden>Document</span> | <span data-lang-es>Formato</span><span data-lang-en hidden>Format</span> | <span data-lang-es>Año</span><span data-lang-en hidden>Year</span> | <span data-lang-es>Fuente</span><span data-lang-en hidden>Source</span> |
|---|---|---|---|
| 01 FICHA TÉCNICA MOE56 POERBCS | pdf | — | Base de datos BCS 2050 — ordenamiento ecológico (POERBCS) |
| 02 FICHA TÉCNICA MOE56 POERBCS | pdf | — | Base de datos BCS 2050 — ordenamiento ecológico (POERBCS) |
| 1980-03 BOGE-BCS No11-image-only-UNVERIFIED | pdf | — | Boletín Oficial BCS — No11 (1980) — sin verificar |
| 1980-09 BOGE-BCS No36-image-only-UNVERIFIED | pdf | — | Boletín Oficial BCS — No36 (1980) — sin verificar |
| 1996 INEGI Division-territorial-BCS-1810-1995 part1 | pdf | — | INEGI — Division territorial BCS 1810 1995 part1 (1996) |
| 1996 INEGI Division-territorial-BCS-1810-1995 part2 | pdf | — | INEGI — Division territorial BCS 1810 1995 part2 (1996) |
| 1996 INEGI Division-territorial-BCS-1810-1995 part3 | pdf | — | INEGI — Division territorial BCS 1810 1995 part3 (1996) |
| 1996 INEGI Division-territorial-BCS-1810-1995 part4 | pdf | — | INEGI — Division territorial BCS 1810 1995 part4 (1996) |
| 1996 INEGI Division-territorial-BCS-1810-1995 part5 | pdf | — | INEGI — Division territorial BCS 1810 1995 part5 (1996) |
| 1996 INEGI Division-territorial-BCS-1810-1995 part6 | pdf | — | INEGI — Division territorial BCS 1810 1995 part6 (1996) |
| 2007-10 BOGE-BCS No42-image-only-UNVERIFIED | pdf | 2007 | Boletín Oficial BCS — No42 (2007) — sin verificar |
| 2007-10 BOGE-BCS No43-image-only-UNVERIFIED | pdf | 2007 | Boletín Oficial BCS — No43 (2007) — sin verificar |
| 2014-03-12 BOGE-BCS No12-POEL-Loreto | pdf | 2014 | Boletín Oficial BCS — No12 POEL Loreto (2014) |
| 2020-01-01 CONEVAL Informe pobreza y evaluacion BCS 2020 | pdf | 2020 | CONEVAL — Informe pobreza y evaluacion BCS 2020 (2020) |
| 2020-03-15 INEGI Censo2020 ITER descriptor | pdf | 2020 | INEGI — Censo2020 ITER descriptor (2020) |
| 2020 SEPUIMM DPU-Manual-Especifico-Organizacion | pdf | 2020 | SEPUIMM — DPU Manual Especifico Organizacion (2020) |
| 2021-02-23 INEGI Panorama sociodemografico BCS Censo2020 | pdf | 2021 | INEGI — Panorama sociodemografico BCS Censo2020 (2021) |
| 2022-01-01 CONEVAL SIDS BajaCaliforniaSur | pdf | 2022 | CONEVAL — SIDS BajaCaliforniaSur (2022) |
| 2023-10-24 Gobierno-BCS 2do-Informe Anexo-grafico-estadistico | pdf | 2023 | Gobierno de BCS — 2do Informe Anexo grafico estadistico (2023) |
| 2023 INEGI Aspectos-geograficos-BCS-Compendio-2020 | pdf | 2023 | INEGI — Aspectos geograficos BCS Compendio 2020 (2023) |
| 2024-01-01 Ayuntamiento-La-Paz Plan-Municipal-Desarrollo-2024-2027 | pdf | 2024 | Ayuntamiento La Paz — Plan Municipal Desarrollo 2024 2027 (2024) |
| 2024-01-01 Ayuntamiento-Los-Cabos Plan-Municipal-Desarrollo-2024-2027 | pdf | 2024 | Ayuntamiento Los Cabos — Plan Municipal Desarrollo 2024 2027 (2024) |
| 2024-04-18 SSN Reporte-Especial-Secuencia-Loreto-BCS-M56 | pdf | 2024 | SSN — Reporte Especial Secuencia Loreto BCS M56 (2024) |
| 2024-07 Ayuntamiento-Loreto PSDU-Memoria-Tecnica-Consulta-Publica | pdf | 2024 | Ayuntamiento Loreto — PSDU Memoria Tecnica Consulta Publica (2024) |
| 2024-07 Ayuntamiento-Loreto PSDU-Sintesis-Consulta-Publica | pdf | 2024 | Ayuntamiento Loreto — PSDU Sintesis Consulta Publica (2024) |
| 2024-12-05 INEGI PIBE BCS 2023 | pdf | 2024 | INEGI — PIBE BCS 2023 (2024) |
| 2024-12-23 Ayuntamiento-La-Paz Presupuesto-Egresos-2025 | pdf | 2024 | Ayuntamiento La Paz — Presupuesto Egresos 2025 (2024) |
| 2024 Finanzas-BCS Evidencia-Registro-Deuda | pdf | 2024 | Finanzas BCS — Evidencia Registro Deuda (2024) |
| 2024 Gobierno-BCS-UABCS Atlas-Estatal-de-Riesgo-BCS | pdf | 2024 | Gobierno de BCS y UABCS — Atlas Estatal de Riesgo BCS (2024) |
| 2025-01-01_Finanzas-BCS_Anexo-I-33-Transferencias-Participaciones-Municipios-202 | pdf | 2025 | Finanzas BCS — Anexo I 33 Transferencias Participaciones Municipios 2025 (2025) |
| 2025-01-01 Finanzas-BCS Presupuesto-Egresos-2025 | pdf | 2025 | Finanzas BCS — Presupuesto Egresos 2025 (2025) |
| 2025-01-18 Ayuntamiento-Los-Cabos Plan-Desarrollo-Municipal-2024-2027 | pdf | 2025 | Ayuntamiento Los Cabos — Plan Desarrollo Municipal 2024 2027 (2025) |
| 2025-06-01 Ayuntamiento-Mulege Plan-Municipal-Desarrollo-2024-2027 | pdf | 2025 | Ayuntamiento Mulege — Plan Municipal Desarrollo 2024 2027 (2025) |
| 2025-09-05_SICT_Programa-Sectorial-Infraestructura-Comunicaciones-Transportes-20 | pdf | 2025 | SICT — Programa Sectorial Infraestructura Comunicaciones Transportes 2025 2030 (2025) |
| 2025-10-08 SSN Reporte-Especial-Secuencia-SJD-BCS-M46 | pdf | 2025 | SSN — Reporte Especial Secuencia SJD BCS M46 (2025) |

<span data-lang-es>[Ver más en catálogo](/catalogo?theme=territorio) · carpeta temática en filtros.</span>
<span data-lang-en hidden>[See more in catalog](/catalogo?theme=territorio) · theme folder in filters.</span>

