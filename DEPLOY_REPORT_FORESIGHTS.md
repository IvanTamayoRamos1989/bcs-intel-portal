# Deploy — Foresights / Prospectiva

**Prod:** https://bcs-intel-portal.netlify.app/foresights/  
**Custom:** https://bajacaliforniasur2050.com/foresights/  
**Aliases:** `/prospectiva`, `/foresight` → `/foresights/`  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6aaeeec3e77aff44d39b2561  
**When:** 2026-09-19 (Europe/Madrid)

## Delivered
- `FORESIGHTS_PLAN.md` — 4 layers + place vocations backbone + swarm merge + weekly runbook
- `src/data/foresights.json` (+ public) — signals, 7 places, 9 role lenses, consensus, watchlist, system_view
- Swarm merged: `places_claude.md`, `roles_astra.md`, `system_view_antigravity.md`, `signals_kimi.md`
- Page `/foresights` — EN/ES, places first, disclaimer, links to News/Catalog/Ontology/Stakeholders/Maps/Flights
- Nav: Resumen → Prospectiva / Foresights; header search entry
- `scripts/update_bcs_foresights.py` — weekly; preserves places/roles/curated signals unless `--refresh-signals`
- Chat corpus `portal:foresights` → Ask points to `/foresights`

## Weekly update (parent registers routine)
```bash
cd /workspace/BCSFP/11_bcs_hub
python3 scripts/update_bcs_foresights.py
# optional: python3 scripts/update_bcs_foresights.py --refresh-signals
npm run build && npx netlify deploy --dir=dist --functions netlify/functions --prod --message "Foresights weekly"
```

## Preserved
Auth gate · mobile bottom chat · F+P fichas hidden · stakeholders · no public Decision twin
