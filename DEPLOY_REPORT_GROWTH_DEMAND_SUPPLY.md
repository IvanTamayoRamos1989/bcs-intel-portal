# Deploy — Growth demand–supply

**When:** 2026-09-20 (Europe/Madrid)  
**Prod site:** https://bajacaliforniasur2050.com  
**Netlify:** https://bcs-intel-portal.netlify.app  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6aaffeda7a3d3d017fbf8140

## URLs

| Surface | URL |
|---------|-----|
| Page ES | https://bajacaliforniasur2050.com/crecimiento/ |
| Alias EN | https://bajacaliforniasur2050.com/demand-supply/ → `/crecimiento/` |
| Alias ES | https://bajacaliforniasur2050.com/oferta-demanda/ → `/crecimiento/` |
| Data | https://bajacaliforniasur2050.com/growth_demand_supply.json |
| Figure | https://bajacaliforniasur2050.com/growth/balance_overview.png |

Also mirrored on `bcs-intel-portal.netlify.app`.

## Delivered

1. `src/data/growth_demand_supply.json` (+ public copy) — 7 places, 46 ok cells, 22 gaps; state roll-up
2. `/crecimiento` page — scorecards, DMA/flights/balance charts, EN/ES, mobile-safe
3. Nav next to Resumen/Prospectiva; CTAs from `/foresights` and `/resumen`
4. Ask corpus chunk `portal:crecimiento-demand-supply` (+ focus-places points here)
5. `public/growth/balance_overview.png`
6. `GROWTH_DEMAND_SUPPLY.md` method note
7. Weekly hook in `FORESIGHTS_PLAN.md` + `scripts/update_bcs_foresights.py`

## Guardrails kept

- Decision twin / scenarios public routes still redirect to `/resumen/`
- F+P fichas stay hidden
- No invented statistics (gaps named)

