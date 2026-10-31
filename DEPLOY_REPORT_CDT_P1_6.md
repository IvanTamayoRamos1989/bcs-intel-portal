# Deploy — Phase 1.6 evidence, coordination, and quality

Checked outbound landings on 31 Oct 2026 from this environment (curl, browser user agent, redirects followed).

## What shipped

### Evidence pack on `/aprendizaje#evidencia`
Each card is labeled fuente externa. Numbers from those sites are not copied.

| Site | URL used | Check |
|---|---|---|
| WRI Aqueduct 4.0 | https://www.wri.org/aqueduct | 200 |
| MapBiomas México | https://mexico.mapbiomas.org/ | 200 |
| WRI Resource Watch | https://resourcewatch.org/ | 200 |
| DataMéxico | https://www.economia.gob.mx/datamexico/ | 200. `www.datamexico.org` answers 405 to HEAD and 301 on GET to this page |
| Data Commons | https://datacommons.org/ | 200 |

### `/coordinacion`
Federal inventory grouped by the institution line as published (44 projects). Each row shows the work, municipality text, reported status, and sexenio. Notes and evidence gaps from the inventory are shown. Amounts stay on `/proyectos-federales`. No delivery date is calculated. Linked from the twin, stakeholders, the relationship map, search, and Temas → Para especialistas.

### `/gemelo` quality and open questions
- Compare axes show a strip with name, year, source, and whether all five municipalities are covered.
- Goal strip counts strategic questions already tagged to each of the five themes. A question may count in more than one theme.
- Foresight signals stay on their own labels (tourism, water, energy, environment, land use, planning). They are not retagged as new targets.

### Citizen path
On the consultation chat, two links sit above the suggested questions: `/aprendizaje` and `/gemelo/?theme=vivienda&scenario=water_first&x=pob&y=pobreza_pct`. The corpus chunk `portal:evidencia-coordinacion-p16` explains the new pages and ends with a follow-up question.

## Still out of scope

AGEB, morphometrics, cadastre, parcel scores, and any KPI that is not already a municipal or clearly attributed series in the archive.

## How to try

1. `/aprendizaje/#evidencia` — open Aqueduct or DataMéxico, then return. The page does not quote their figures.
2. `/coordinacion/` — CFE, CONAGUA, and SICT each list several works with status and sexenio.
3. `/gemelo/?x=pob&y=ley` — the quality strip says 2026 and incomplete coverage; the chart drops Mulegé and Loreto.
4. `/inicio` — use “Aprender de otras ciudades” or “Gemelo: agua y nivel de vida” without typing.
