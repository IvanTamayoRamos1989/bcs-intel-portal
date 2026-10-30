# FlightConnections ingest — BCS airports

**Retrieved:** 2026-09-17 (Europe/Madrid)  
**Source:** [FlightConnections.com](https://www.flightconnections.com/)  
**Portal page:** `/vuelos` (Air connectivity)  
**Data file:** `src/data/flight_connections_bcs.json`  
**Diagrams:** `public/connectivity/{sjd,lap,lto}_flightconnections.png` (screenshots; cite FlightConnections)

## Method

1. Loaded airport pages with a real Chromium session (AWS WAF blocks plain curl/WebFetch intermittently):
   - SJD: `https://www.flightconnections.com/flights-from-san-jose-del-cabo-sjd`
   - LAP: `https://www.flightconnections.com/flights-from-la-paz-lap`
   - LTO: `https://www.flightconnections.com/flights-from-loreto-lto`
2. Extracted the **popular non-stop** destination list (`a.popular-destination` under the default Non-stop / 0-stops filter).
3. Trimmed SJD to the page’s stated planned count (**56**). LAP/LTO lists matched planned counts (**7** / **5**) exactly.
4. Country buckets: MX / US / CA / EU / other from flag/country labels on the page.
5. Optional durations: FAQ table on SJD (MEX, LAX, GDL, TIJ, DFW) where shown.
6. Screenshots of the route-map viewport saved under `public/connectivity/` with attribution on `/vuelos`.

**Do not invent routes.** If a page fails to load, publish only verified airports and note the failure.

## Destination counts (non-stop)

| IATA | Airport | Total | MX | US | CA | EU | Other |
|------|---------|------:|---:|---:|---:|---:|------:|
| **SJD** | Los Cabos / San José del Cabo | **56** | 13 | 31 | 10 | 1 | 1 (PTY) |
| **LAP** | La Paz (Manuel Márquez de León) | **7** | 6 | 1 | 0 | 0 | 0 |
| **LTO** | Loreto | **5** | 1 | 3 | 1 | 0 | 0 |

### SJD notes

- Page meta / body: *non-stop passenger flights scheduled to 56 destinations in 4 countries*; *13 domestic*; Last updated on page: **09-02-2026**.
- EU: Frankfurt (FRA) via Condor (seasonal; 0 flights/month at retrieval).
- Other: Panama City (PTY) via Copa.
- Includes seasonal / announced routes showing **0 flights / month** this month (e.g. IAD, PDX, FRA, several Canadian cities).

### LAP destinations

MEX, TIJ, GDL, NLU, CUL, LAX, MTY (MTY listed with 0 flights/month).

### LTO destinations

TIJ, LAX, PHX, DFW, YYC (YYC listed with 0 flights/month — seasonal).

## Portal integration

- Page `/vuelos` — per-airport cards, searchable tables, diagram images, clear citation banner.
- Nav: **Lugar & mercado** → Vuelos / Flights; also header search.
- Summary (`/resumen`): air-arrivals KPI links to `/vuelos`; added SJD non-stop count card.
- `/puertos` and guide `conectividad.md` link to `/vuelos` (PMD/FITURCA figures retained as separate source).
- Chat corpus: `portal:flight-connections-bcs` + `portal:flights-from-{SJD,LAP,LTO}` via `scripts/build_chat_corpus.py`.

## Disclaimer (shown in UI)

> Non-stop routes per FlightConnections.com (retrieved 2026-09-17). Schedules change; verify on source.

## Re-ingest

```bash
# Prefer Chromium/puppeteer over curl (WAF).
# Then refresh JSON + diagrams, rebuild corpus, deploy:
cd /workspace/BCSFP/11_bcs_hub
npm run build
npx netlify deploy --dir=dist --prod
```

Auth, chat sidebar, stakeholders, and F+P fichas hide are unchanged by this ingest.
