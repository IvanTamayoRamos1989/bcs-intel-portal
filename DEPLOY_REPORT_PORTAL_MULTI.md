# Deploy — portal multi-feature (2026-09-16)

**Prod:** https://bcs-intel-portal.netlify.app  
**Deploy:** https://app.netlify.com/projects/bcs-intel-portal/deploys/6aab00e966839379881a2a59

## URLs
| Page | URL |
|------|-----|
| Summary | https://bcs-intel-portal.netlify.app/resumen/ |
| Explore | https://bcs-intel-portal.netlify.app/explorar/ |
| Catalog | https://bcs-intel-portal.netlify.app/catalogo/ |
| News | https://bcs-intel-portal.netlify.app/noticias/ |
| Plans archive | https://bcs-intel-portal.netlify.app/planes-archivo/ |
| Aliases | `/summary`→`/resumen/`, `/news`→`/noticias/`, `/fuentes`→`/catalogo/` |

## Changes
1. **EN mode** — catalog `isEn()` uses `data-lang`; picks `sum_en`; engagement `<select>` labels sync on lang toggle; plans status/geography bilingual (vigente→in force, estado→state).
2. **Docs ≠ stakeholders** — theme PDFs (INEGI/CONEVAL/plans/DMA…) labeled by Territory themes even if duplicated under engagement folders; engagement browse skips theme docs.
3. **Plans archive** — Ver/Descargar Drive when matched (`plans_drive_links.json`, 21/46); else catalog search.
4. **Fuentes removed** — nav, search, guide deleted; 301 → catalogo.
5. **News** — `/noticias` + `src/data/news.json` (12 real items) + `scripts/update_bcs_news.py`.
6. **Summary dashboard** — `/resumen` KPI grid (pop, DMA×4, SIBCS peak, air arrivals, ANP, stills 956, ontology 90, PE 2026, files) + mun bar chart.
7. **Nav** — Summary → Explore → Themes → Place & market → Evidence (+ News) · quick: Catalog, Maps, Territory photos.

## Sample news sources
BCS Noticias, El Sudcaliforniano (OEM), Ayuntamiento Los Cabos, Gobierno BCS, CFE / Hoja de Ruta, Tribuna de México, WE NEWS, Cúspide México, El Mundo Digital, El Pueblo Tve.
