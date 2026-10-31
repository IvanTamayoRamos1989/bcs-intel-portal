# Deploy — Phase 1.9 narrow layout, decision path, blank series

## What shipped

- `/gemelo` on a narrow screen stacks the theme rail, shortens the map, and lets scenarios scroll sideways. The comparison quality cards stack. `/foro`, `/vistas`, `/metas`, `/coordinacion` and `/aprendizaje` already flow in one column; long institution names wrap.
- A shared path sits on those pages: 1 Aprender → 2 Ver vista → 3 Comparar → 4 Coordinar. The current step is highlighted when the page is one of those four.
- If a compare axis has no figure for every municipality (2026 revenue law), the twin shows **Sin serie municipal en el acervo** and links to `/metas`. The mobility theme uses the same chip for Loreto 2025 air passengers. No number is filled in.
- Chat chunk `portal:ruta-decision-p19` answers questions about the guest sheet, saved views, open questions, coordination and peer learning with those links and a follow-up.
- `DEPLOY_REPORT_CDT_INDEX.md` lists phases 1 through 1.9 and their paths.

## How to try

1. At about 390px wide, open `/gemelo/?x=pob&y=ley` and scroll the themes and the chart. The revenue-law card links to open questions.
2. Open the mobility theme and use the Loreto air-passenger chip.
3. From `/foro`, follow 1 → 2 → 3 → 4 and confirm the highlight moves.
