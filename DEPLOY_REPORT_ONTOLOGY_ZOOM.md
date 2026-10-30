# Deploy — Ontology graph zoom readability (2026-09-16)

**Prod:** https://bcs-intel-portal.netlify.app/ontologia/  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6aaafa0acfc85631ce8eef2c  
**Unique:** https://6aaafa0acfc85631ce8eef2c--bcs-intel-portal.netlify.app  

Message: `Ontology graph: clearer zoom readability`

## Thresholds / styles
- `LABEL_ZOOM`: **1.15 → 0.85** (labels appear sooner on zoom-in)
- Hard hide bulk labels below **z &lt; 0.55**
- `DETAIL_ZOOM`: **1.25** — larger nodes, thicker edges, bolder fonts
- Node size: ~10 (low) → 14 (mid) → up to 26 (high); DQ diamonds scale up
- Font: 9 → up to 16; weight 600 at detail/focus; color `#0d1b24`
- Text outline (2–3px white) + roundrectangle background opacity up to ~0.95
- Edges: width/opacity scale with zoom; focus edges bezier + blue
- Focus dim: non-neighbors **opacity ~0.12** (nodes), **0.08** (edges)
- Hover: soft 1-hop preview when nothing locked; click locks focus
- Layout: cose repulsion 18k / idealEdge 110; concentric minNodeSpacing 28, spacingFactor 1.15
- Zoom: min **0.15**, max **4.5**, wheelSensitivity **0.18**, fit padding **40**
- New control: **Zoom a selección / Zoom to selection**
- Preserved: Decision core default, type filters, search, hide isolates, EN/ES

Ontology content (`graph.json`) unchanged.
