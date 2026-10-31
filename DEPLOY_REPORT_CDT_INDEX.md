# City Digital Twin — operator sheet

Live site: https://bajacaliforniasur2050.com · Netlify: https://bcs-intel-portal.netlify.app

Password for the gate: `BCS2050`. The portal stays `noindex`. Guest path for operators: `FORO_GUEST_WALKTHROUGH.md`. `public/stills/` is gitignored and must stay on the deploy machine.

## Live paths

| Path | What it is |
|---|---|
| `/inicio` | Citizen chat. Specialist row sits under the questions. |
| `/gemelo` | Territorial twin. Aliases `/cdt`, `/decision`, `/decision-twin` redirect here. |
| `/vistas` | Five named views. Each opens the map and the twin. |
| `/metas` | Open questions, foresight signals, and data gaps. No progress percentage. |
| `/coordinacion` | Federal projects grouped by the institution line as written. |
| `/aprendizaje` | External cases. Evidence cards at `/aprendizaje#evidencia`. |
| `/foro` | Guest sheet for the Mar de Cortés forum. Prints as one A4 page. |
| `/studio` | Municipality pages: `/studio/los_cabos`, `/studio/la_paz`, `/studio/loreto`, `/studio/comondu`, `/studio/mulege`, `/studio/bcs`. `/lugares` opens this index. |
| `/mapas` | Maps, with a link to saved views. |
| `/rutas` | Site map inside the portal. |
| `/memoria` | Gap list, including Loreto 2025 air passengers and the Mulegé/Loreto 2026 revenue totals. |

## Still blank

- Loreto 2025 air travelers: **89,600**, filled from the state government release. Optional compare axis `aereo_2025` plots Los Cabos, La Paz and Loreto only. Comondú and Mulegé are omitted, not set to zero. Los Cabos on that axis stays 3,800,000 (rounded brief), not 3,765,000.
- Mulegé and Loreto 2026 revenue-law totals. The decrees are catalogued. The totals are not copied. Where to look next is on `/metas`.

## Phase 2 — do not invent

Checklist, file formats, and sources: `PHASE2_DATA_NEEDS.md`. Leave these out until a real file is ingested:

- AGEB polygons and block-level indicators
- Morphometrics (fractal dimension, betweenness, urban-form scores)
- Cadastre, parcel typologies, and lot desirability
- Climate beyond the aquifer balance already on the twin

## Phase reports

| Phase | Report | What it added |
|---|---|---|
| 1 | `DEPLOY_REPORT_CDT_P1.md` | Twin: five themes, scenarios, municipal compare, rules |
| 1.5 | `DEPLOY_REPORT_CDT_P1_5.md` | More indicators, goals, `/aprendizaje` |
| 1.6 | `DEPLOY_REPORT_CDT_P1_6.md` | Evidence cards, `/coordinacion`, source and year |
| 1.7 | `DEPLOY_REPORT_CDT_P1_7.md` | `/vistas`, `/metas`, print shortlist |
| 1.8 | `DEPLOY_REPORT_CDT_P1_8.md` | Municipality links, `/foro`, how-to |
| 1.9 | `DEPLOY_REPORT_CDT_P1_9.md` | Narrow layout, decision path, blank-series chip |
| 1.10 | `DEPLOY_REPORT_CDT_P1_10.md` | Site map, home specialist row, three external references |
| 1.11 | `DEPLOY_REPORT_CDT_P1_11.md` | One-sentence theme reads, A4 guest print |
| 1.12 | `DEPLOY_REPORT_CDT_P1_12.md` | Chat links, two open gaps, why-lines on `/foro` |
| 1.13 | `DEPLOY_REPORT_CDT_P1_13.md` | Link audit, this sheet, focus rings |
| 1.14 | `DEPLOY_REPORT_CDT_P1_14.md` | Loreto 2025 travelers from the state release; revenue laws still blank |
| 1.15 | `DEPLOY_REPORT_CDT_P1_15.md` | Loreto gap filled; optional three-airport compare axis |
| 1.16 | `DEPLOY_REPORT_CDT_P1_16.md` | Phase 2 checklist; chat answers for the air axis; both Los Cabos figures on the card |
| 1.17 | `DEPLOY_REPORT_CDT_P1_17.md` | Saved-view map state matches `/mapas`; each card previews its layers |
| 1.18 | `DEPLOY_REPORT_CDT_P1_18.md` | Ten-minute guest walk on `/foro`; the five views taught by name |
| 1.19 | `DEPLOY_REPORT_CDT_P1_19.md` | Evidence cards for desalination, C40 and UrbanShift; plain lines on each saved view |
| 1.20 | `DEPLOY_REPORT_CDT_P1_20.md` | Territory photos on saved views when stills are present; consultation shortcuts on Home |
