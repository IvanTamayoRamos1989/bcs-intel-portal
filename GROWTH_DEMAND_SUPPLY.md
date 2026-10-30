# Growth demand–supply by place vocation

**Prod:** https://bcs-intel-portal.netlify.app/crecimiento/  
**Aliases:** `/demand-supply`, `/oferta-demanda` → `/crecimiento/`  
**Data:** `src/data/growth_demand_supply.json` (+ `public/growth_demand_supply.json`)  
**Figure:** `public/growth/balance_overview.png`

## Intent

Ivan’s **prerequisite before scenarios**: for each place vocation, structure what growth **asks for** (demand) vs what the territory **can give** (supply / carrying capacity). Qualitative balance reads only; **no invented statistics**. Cells without a portal number are `status: gap` with named missing evidence.

Decision twin / public scenario switcher stays **deferred** (`DECISION_TWIN_DEFERRED.md`).

## Place vocations (same backbone as Foresights)

| Place | Indicative vocation |
|-------|---------------------|
| Los Cabos | Tourism–growth engine; water & energy stress |
| East Cape | Coastal growth pressure; ANP / Cabo Pulmo tension |
| Todos Santos–El Pescadero | Pacific amenity spine |
| La Paz | Capital / services; water–energy coupling |
| Loreto | Tourism + conservation mid-peninsula |
| Constitución / Comondú | Agri / inland services; desal & irrigation pilots |
| Mulegé / north (optional) | Sparse corridor; remote energy / H2 signals |

## Evidence rules

| Side | Themes | Portal sources only |
|------|--------|---------------------|
| **Demand** | Air connectivity, tourism assets, settlement/coastal pressure, economic/fiscal signals, news themes | `flight_connections_bcs.json`, `tourism_detail.json`, `municipios.json`, `news.json`, foresights places, GIS focus layers |
| **Supply** | Water (DMA, desal notes), energy (SIBCS island), land/planning (PDU/POEL/PMD), environment/ANPs | `focus_water_dmas.geojson`, guides `/agua` `/energia`, `municipios.json` locks/strengths, foresights, candados notes |

If a cell lacks a number → `status: "gap"` + `evidence_missing_es/en`. Never invent DMA, MW, rooms, or arrivals.

## Balance reads (qualitative)

| Code | Meaning |
|------|---------|
| `constrained` | Demand presses hard against evidenced supply locks |
| `contested` | Growth vs conservation / thin infra — outcome unsettled |
| `headroom` | Relative room vs Cabos corridor (still has locks) |
| `unknown` | Evidence too thin for a directional read |

## State roll-up

`state_rollup` answers: how local imbalances add up (they **do not cancel** — NOM-011 per aquifer; SIBCS is one ceiling), and **what must be true** for vocations to sum to a coherent 2050.

## Page + Ask

- UI: `/crecimiento` — cards per place, simple bars where numbers exist, EN/ES, mobile-safe.
- Nav: next to Resumen / Prospectiva.
- CTAs from `/foresights` and `/resumen`.
- Ask corpus: `portal:crecimiento-demand-supply` (+ focus-places note points here). Rebuild: `python3 scripts/build_chat_corpus.py`.

## Weekly foresights hook

When refreshing foresights (`scripts/update_bcs_foresights.py`), the edition should **reference demand–supply gaps** where signals touch water/energy/tourism pressure. See `FORESIGHTS_PLAN.md` § Growth demand–supply.

## Guardrails

- Auth gate, mobile bottom chat, F+P fichas hidden: unchanged.
- No public Decision twin / scenario switcher.
- San José del Este decks remain qualitative catalog pointers, not fake metrics.
