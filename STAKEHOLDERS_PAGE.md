# Stakeholders page

**URLs:** https://bcs-intel-portal.netlify.app/stakeholders/ (canonical) · `/actores` → 301  
**Nav:** Evidencia → Actores / Stakeholders

## What it is
Internal engagement directory (51 rows from Excel Stakeholders sheet). Shows people + roles/contacts with optional `org` / `type` (`person` | `institution` | `business`).

**Not** the hidden F+P markdown pack `08_fp_team_research/` (those fichas stay out of catalog/search/chat downloads).

## Editing persistence
- API: `/api/stakeholders` → Netlify Function `stakeholders-api`
- Store: Netlify Blobs `bcs-portal` / key `stakeholders-directory`
- First GET seeds from `stakeholders_seed.json` into the blob; later GETs read the blob (`persistence: "blob"`)
- POST/PUT/DELETE require portal auth cookie (`bcs_portal_auth`); unauthenticated → 401
- CSV export: client-side from filtered rows

## Seed source
`src/data/stakeholders.json` (+ `netlify/functions/stakeholders_seed.json`) from  
`BCS_stakeholders_seed.xlsx` / sheet Stakeholders.
