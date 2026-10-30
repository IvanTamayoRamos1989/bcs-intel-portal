# Portal BCS — Arquitectura de información v2

**Sitio:** `11_bcs_hub`  
**Propósito:** Portal de inteligencia territorial / datos BCSFP navegables (metáfora Drive)  
**UI:** Español + English (toggle ES|EN, localStorage)  
**Diseño:** F+P `#0080C0`  
**Fecha:** 2026-09-15

## Nav agrupada

1. **Explorar** — Inicio, Catálogo, Archivos  
2. **Temas** — Territorio, Planeación, Agua, Energía, Ambiente, Conectividad, Riesgos, Economía  
3. **Lugar & mercado** — Comunidades, Turismo, Inmobiliario, Catastro, Puertos, Fiscal  
4. **Evidencia** — Mapas, GIS atlas, Earth Studio, Ontología, Historia, Planes archivo, Fuentes  

## Rutas nuevas / reforzadas

| Ruta | Contenido |
|---|---|
| `/archivos/` | Drive download + Netlify form upload (Astro) |
| `/gis-atlas` | QGIS pack 14_gis_atlas |
| `/earth-studio` | Stills / ESP / KML summary |
| `/planes-archivo` | plans_master.csv archive |
| `/puertos` | ports_demand TI |
| `/fiscal` | fiscal_municipal + docs |
| `/mapas` | Gallery by theme → theme pages |
| Legacy | `/capacidad` `/demanda` `/limitaciones` `/actores` `/planes` → redirects |

## Datos

- `catalog.json` / `catalog_slim.json` (~2678) / `folders_summary.json`
- `maps_gallery.json` (themed), `theme_docs.json`, `re_reports.json`
- `gis_atlas.json`, `earth_studio.json`, `plans_archive.json`, `fiscal_docs.json`
- `ports_demand.json`, `tourism_detail.json`, `top_localities.json`, `histories.json`
