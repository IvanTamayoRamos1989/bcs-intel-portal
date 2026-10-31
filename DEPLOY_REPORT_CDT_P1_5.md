# Deploy — Territorial twin Phase 1.5 and city-learning page

**Pages:** `/gemelo/` (deeper board) and `/aprendizaje/` (external cases).
**Alias unchanged:** `/cdt`, `/decision`, `/decision-twin` still go to `/gemelo/`.

## What shipped

### `/gemelo`
- Plain-language intro: theme, then scenario, then compare, then recommendations. It points back to the citizen consultation on `/inicio` and to `/aprendizaje`.
- Guided chips set the URL (`theme`, `scenario`, `x`, `y`). The selection also keeps `muni`, so a copied link reopens the same board. **Copiar enlace** and **Imprimir** (print stylesheet hides the site chrome).
- Compare indicators, each with source and a data-quality line. Incomplete points stay off the chart:
  - Population 2020, INEGI, five municipalities.
  - Localities 2020, INEGI, five municipalities.
  - SNIIV housing registry 2025, five municipalities.
  - CONEVAL poverty percent 2020, five municipalities. The person base is not the Census base.
  - Annex I.33 2025 transfers, five municipalities (finance pack, cross-checked with the municipal sheet).
  - DataTur 2025 cruise calls and cruise passengers, summed only from ports in that municipality: Cabo San Lucas; Pichilingue plus La Paz; San Carlos; Santa Rosalía; Loreto plus Puerto Escondido. Not air passengers.
  - 2026 revenue law where the portal has it. Mulegé and Loreto stay blank.
- Goal strip: strategic questions and foresight open questions already in the portal, filtered by the active municipality and theme, with links to `/preguntas/…` and `/foresights/`.
- Cross-theme panel framed as an integrated solution (water, housing, mobility, economy, research). Rules already in the growth layer and the questions. Labeled decision support, not a simulation.
- Project strip: federal inventory rows whose published municipality text names the selection. Owner, reported status, and sexenio as the horizon. Not a calculated delivery date.
- Regional note points at CEPAL’s Urban and Cities Platform and does not copy its numbers.
- East Cape stays inside Los Cabos. Todos Santos–El Pescadero stays inside La Paz.

### `/aprendizaje`
External networks and cases, each marked **fuente externa**. Live URLs only (checked 31 Oct 2026): GPSC, UrbanShift (`shiftcities.org` and the Spanish site; the program is closing and is cited as an archive), C40 Knowledge Hub, ICLEI, USE, CEPAL Plataforma Urbana, World Bank urban-development overview. Cases: IFC Los Cabos water PDF, Water Alternatives on Cabo and La Paz, C40 Water Safe Cities, C40 coastal adaptation, two Mexico City C40 cases, UrbanShift Costa Rica, Brazil and Argentina. KPESIC is named as a historical bilingual LAC infrastructure platform and is not linked, because kpesic.com does not resolve.

Discoverable from Documentos, header search, the gemelo intro, the library, the home chat chip, and the chat corpus (`portal:aprendizaje-ciudades`). The chip asks a question so the assistant can answer and offer a follow-up.

## Skipped for lack of a municipal series

- 2025 air passengers: SJD and La Paz are published; Loreto is not. Left as a mobility KPI, not a compare axis.
- CONAVI housing backlog: statewide only.
- SIBCS peak: one grid, not five municipalities.
- Aquifer deficit: published per aquifer (0313, 0317, 0318, 0319, 0324), not as one municipal balance. Summing them would invent a municipal water account.
- AGEB, morphometrics, cadastre, parcel desirability, and calibrated climate or land-use models remain Phase 2.

## How to try

1. Open `/gemelo/?theme=movilidad&scenario=corridor_intensify&x=pob&y=crucero_arribos`.
2. Click Loreto. Read the goal strip, the integrated-solution lines, and the federal projects that name Loreto.
3. Switch the vertical axis to Ley de Ingresos 2026 and confirm Mulegé and Loreto drop off the chart.
4. Copy the link and use Imprimir.
5. Open `/aprendizaje/` and follow one external case, then return to `/agua/` or `/gemelo/`.
6. On `/inicio`, use the “otras ciudades” chip.
