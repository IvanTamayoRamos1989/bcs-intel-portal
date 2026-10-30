# UX clarity — `/vuelos` maps + lean clipping pass

**When:** 2026-09-17 (Europe/Madrid)  
**Trigger:** Ivan — maps/diagrams cut off; information must stay fully visible.

## Root cause (`/vuelos`)

FlightConnections diagrams used:

```css
.air-diagram img {
  max-height: 420px;
  object-fit: cover;   /* crops the network map */
  object-position: top;
}
```

That clipped the saved screenshots (`public/connectivity/*_flightconnections.png`), leaving chrome / a white gap and hiding the route network — worse in the ~320px chat-sidebar content column.

No live iframe was involved; the page already preferred static screenshots.

## Fixes

### `/vuelos` (SJD, LAP, LTO)

- Full diagram: `width: 100%`, `height: auto`, `object-fit: contain`, **no** short `max-height` crop.
- Click image → lightbox (`<dialog>`) for full-size network view.
- “Ampliar mapa / Expand map” affordance + “Abrir en FlightConnections” text link beside caption.
- Destination tables: scrollable wrap (`overflow: auto`), `min-width` so columns aren’t crushed, **sticky** `<thead>`.

### Global (lean)

- `main { overflow: visible }` + `main img { max-width: 100%; height: auto }` so tall images aren’t clipped with the always-open chat sidebar.
- `.table-wrap`: horizontal scroll + sticky header support.
- `/mapas` GIS: with `body.has-chat-sidebar`, `#gis-map` `min-height: 560px` / `height: min(75vh, 860px)`; `main.wide` capped to viewport minus sidebar.

## Preserved

Auth gate, always-open chat sidebar (~320px), stakeholders, F+P fichas hide, triple-link chat behavior.

## Deploy

**Prod:** https://bcs-intel-portal.netlify.app/vuelos/  
**Deploy id:** 6aabafa6721b0d9c9beabfd5  
**Unique:** https://6aabafa6721b0d9c9beabfd5--bcs-intel-portal.netlify.app/vuelos/
