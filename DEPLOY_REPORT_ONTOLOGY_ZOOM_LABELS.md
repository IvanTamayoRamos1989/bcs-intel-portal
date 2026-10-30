# Deploy — Ontology inverse-zoom labels + larger canvas (2026-09-17)

**Prod:** https://bcs-intel-portal.netlify.app/ontologia/  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6aabd8b40777c96e26702a00  
**Unique:** https://6aabd8b40777c96e26702a00--bcs-intel-portal.netlify.app  

Message: `Ontology: inverse-zoom labels + larger graph canvas`

## Changes
- Labels use **screen-space** sizing: `font-size = (BASE/z^0.55) / zoom` — zoom **in** → smaller on-screen text
- Dense focus: locked selection at high zoom shows labels only for selected + neighbours
- Graph canvas ~**78vh / 640px+**, pane ~**3:1** vs detail; **Ampliar** fullscreen toggle
- Doc: `ONTOLOGY_ZOOM_LABELS.md`

EN/ES, chat, auth, graph.json unchanged.
