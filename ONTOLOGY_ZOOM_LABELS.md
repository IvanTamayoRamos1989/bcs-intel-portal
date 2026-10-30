# Ontology graph — inverse-zoom labels & larger canvas

**Page:** `/ontologia/` · Cytoscape in `src/pages/ontologia.astro`  
**Modes:** Decision core + Full graph (same `applyZoomStyles`)

## Problem
Zooming in scaled labels with the graph (model font-size grew / stayed large on screen), so dense clusters (e.g. desalination / water-energy / CONANP) overlapped and became unreadable. The canvas was also short (~520px).

## Label behavior (screen-space)
On every `zoom` / `pan` event, `applyZoomStyles()` sets:

| Quantity | Formula (clamped) |
|----------|-------------------|
| Target screen font | `BASE_SCREEN_FONT / z^0.55` → ~7–12 px |
| Model `font-size` | `screenFont / zoom` so rendered size ≈ screen target |
| Focus labels | ~+1.5 px screen, still inverse to zoom |
| `text-max-width` | `~88 / zoom` (~2-line wrap) |
| Bulk labels | Hidden below `LABEL_ZOOM` (0.72) |
| Dense + focus | At `z ≥ DETAIL_ZOOM` with a locked selection, only selected + neighbours keep labels |
| Long names | Ellipsis truncate below detail zoom; full wrap when zoomed in / focused |
| Stacking | Per-type `text-margin-y` offsets |

`min-zoomed-font-size` is `0` so Cytoscape does not hide the inverse-scaled fonts.

## Bigger window
- Graph pane ~**3:1** vs detail card (`minmax(0,3fr)` / `minmax(180px,240px)`)
- Canvas height **`min(78vh, 860px)`**, min-height **640px** (mobile ~70vh / 520px)
- Detail card matches graph height
- **Ampliar / Expand** → near-fullscreen overlay (`Escape` to close); `cy.resize()` after toggle
- Accounts for chat sidebar via existing `body.has-chat-sidebar` main reflow

## Layout spacing
Slightly more cose / concentric spacing so default fit is less cramped (repulsion 22k, ideal edge 125, minNodeSpacing 36).

## Unchanged
EN/ES UI, chat sidebar, auth, type filters, search, hide isolates, Zoom to selection, graph.json content.
