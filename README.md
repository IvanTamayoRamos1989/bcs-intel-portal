# Guía BCS (`11_bcs_hub`)

Sitio Astro **público-facing** (español): guía de datos sintetizados para **entender Baja California Sur**.  
No es un dump de archivos, ni un hub de propuestas / stakeholders / visión de programa.

> **Borrador con `noindex`** hasta publicación. Banner: *Guía de datos · Baja California Sur*.  
> **BCS ≠ Baja California (norte).**

## Stack

- [Astro](https://astro.build/) estático + content collection `guides`
- Dependencias mínimas (`astro`)
- UI institucional: cyan `#0080C0` (F+P cover ref; see `_design_ref/DESIGN_SYSTEM.md`)

## Cómo correr

```bash
cd /workspace/BCSFP/11_bcs_hub
npm install
npm run dev
```

```bash
npm run build   # salida en dist/
```

## Rutas (navegación principal)

| Ruta | Propósito |
|------|-----------|
| `/` | Qué es este sitio |
| `/territorio` | 5 municipios, 2,543 localidades, POBTOT 798,447 |
| `/agua` | Acuíferos DMA, desalación como dato |
| `/energia` | SIBCS / capacidad eléctrica como hechos |
| `/ambiente` | ANPs principales |
| `/planeacion` | POERBCS 2026, PDU/POEL |
| `/economia` | Turismo, inversión, empleo |
| `/conectividad` | Aeropuertos, cruceros, Mex 1 / 19 |
| `/riesgos` | Sismos, tenencia ejidal (RAN) |
| `/historia` | Historia breve + cabeceras |
| `/fuentes` | Cómo leer las fuentes (sin PDFs en el sitio) |

Arquitectura documentada en `DATA_GUIDE_IA.md`.

## Contenido

```
src/content/guides/*.md   — páginas de la guía (fuente editable)
src/pages/[topic].astro   — render de cada guía
src/pages/index.astro     — inicio
```

Páginas antiguas del shadow programme (`/actores`, `/limitaciones`, `/blog`, …) pueden existir en el build pero **no** están en la navegación principal.

## Regla de datos

Solo cifras de `../13_territorial_intelligence/`, `../09_shadow_programme/T3_*`, `../12_ontology/FINDINGS_LINKED.md` y READMEs citados. Si falta: *dato no consolidado*.
