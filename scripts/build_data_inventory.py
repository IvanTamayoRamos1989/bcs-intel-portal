#!/usr/bin/env python3
"""Build the portal data inventory / lineage: src/data/data_inventory.json (+ public/ mirror).

One machine-readable record per portal dataset and per key figure:
  id, title, file, used_on, source, source_date, licence, owner (publisher), custodian, method, caveat, refresh.
Also records the catalogue file-count reconciliation (single source of truth: catalog.json).
Re-run after any data refresh:  python3 scripts/build_data_inventory.py
"""
import json, os, datetime
from pathlib import Path

HUB = Path(__file__).resolve().parents[1]
D = HUB / "src/data"
CUSTODIAN = "Equipo del portal BCS 2050 (GC1) — ver OPERATIONS.md"
LIC_GOV = "Información pública gubernamental (México); citar fuente"
LIC_INEGI = "Términos de Libre Uso de la Información del INEGI"
LIC_PRIV = "Informe privado/comercial — solo cita, sin redistribución"
LIC_INT = "Elaboración interna del portal (no publicar como dato oficial)"

def mtime(f):
    p = HUB / f
    return datetime.date.fromtimestamp(p.stat().st_mtime).isoformat() if p.exists() else None

DATASETS = [
  # id, file, title, used_on, source, owner, licence, method, caveat, refresh script
  ("ds-catalog", "src/data/catalog.json", "Catálogo de archivos del acervo", ["/catalogo", "/explorar", "/resumen"],
   "Escaneo del acervo local BCSFP", "Equipo del portal", LIC_INT,
   "scripts/build_catalog.py recorre BCSFP (excluye carpetas internas/confidenciales) y registra ruta, tipo, tamaño, fecha",
   "Inventario de archivos, no de contenidos verificados; espejos en 10_data_lake duplican algunos documentos", "scripts/build_catalog.py"),
  ("ds-catalog-slim", "src/data/catalog_slim.json", "Catálogo ligero (cliente)", ["/catalogo"],
   "Derivado de catalog.json", "Equipo del portal", LIC_INT, "Proyección de catalog.json + enlaces Drive + resúmenes",
   "Debe tener el mismo número de filas que catalog.json", "scripts/build_drive_and_summaries.py"),
  ("ds-file-summaries", "src/data/file_summaries.json", "Resúmenes por archivo", ["/catalogo", "chat"],
   "Texto extraído de los propios archivos (PDF/MD/CSV/XLSX/KML/imagen EXIF)", "Equipo del portal", LIC_INT,
   "pdftotext primeras páginas; encabezados de tablas; metadatos (scripts/enrich_file_summaries.py); 2.ª pasada: imágenes/stills, Earth Studio, ZIP, Office, GIS, HTML, OCR (scripts/enrich_thin_entries.py)",
   "Extracto automático, no resumen editorial; tablas: columnas y valores de ejemplo de tablas no personales (nunca se copian datos personales); planos escaneados: OCR o revisión visual, que puede contener errores", "scripts/enrich_file_summaries.py"),
  ("ds-chat-corpus", "netlify/functions/chat_corpus.json", "Corpus del asistente (RAG)", ["chat"],
   "Guías, hechos, archivos con texto, biblioteca, ontología, stills, actores, acuíferos", "Equipo del portal", LIC_INT,
   "scripts/build_chat_corpus.py; búsqueda BM25 + compuerta de relevancia (netlify/lib/rag.mjs)",
   "Solo se indexan archivos con texto real; las cifras del asistente deben venir de estos fragmentos", "scripts/build_chat_corpus.py"),
  ("ds-portal-facts", "src/data/portal_facts.json", "Hechos del portal (tablas de guías)", ["chat", "/guías"],
   "Tablas de src/content/guides/*.md + 13_federal_projects", "Equipo del portal", LIC_INT,
   "scripts/extract_portal_facts.py extrae filas de tablas markdown", "Hereda fuente y fecha de cada guía", "scripts/extract_portal_facts.py"),
  ("ds-escorrentia", "src/data/escorrentia.json", "Escorrentía y agua de lluvia (modelo de terreno)", ["/agua/escorrentia", "/mapas", "/studio/*", "chat"],
   "HydroSHEDS v1.1 / HydroRIVERS v1 (WWF); SRTM; geoBoundaries; empaquetado Ivan Tamayo Ramos 2026-10-05", "WWF HydroSHEDS / Ivan Tamayo Ramos", LIC_GOV,
   "Red HydroRIVERS recortada al estado; trayectorias D8 sobre DIR 3″ desde retícula de semillas; ver escorrentia.json method_es",
   "NO es mapa oficial de inundación: sin profundidad, caudal ni área inundada; acumulación = celdas aportantes", "scripts/build_escorrentia.py"),
  ("ds-aquifers", "src/data/aquifers_bcs.json", "Acuíferos de BCS — DMA (39)", ["/agua", "/studio/*", "chat"],
   "DOF 9 nov 2023 Acuerdo DMA 653 acuíferos (p.3) + fichas CONAGUA 2024 / DR", "CONAGUA / SEMARNAT", LIC_GOV,
   "NOM-011-CONAGUA-2015: DMA = R − DNC − VEAS", "Balance legal de volumen concesionable, no aforo; municipio solo si la ficha lo declara", "scripts/build_aquifers.py"),
  ("ds-municipios", "src/data/municipios.json", "Ficha municipal (población, localidades, cabecera, ingresos)", ["/studio/*", "/resumen", "chat"],
   "INEGI Censo de Población y Vivienda 2020 (ITER); Leyes de Ingresos 2026; Anexo I33 2025", "INEGI / Congreso BCS / SHCP", LIC_INEGI,
   "POBTOT municipal y por localidad", "Población 2020: no incluye población flotante/turística", None),
  ("ds-growth", "src/data/growth_demand_supply.json", "Demanda–oferta por lugar", ["/crecimiento", "/studio/*"],
   "Celdas de datasets del portal (vuelos, turismo, agua, energía)", "Equipo del portal", LIC_INT,
   "Cada celda cita su dataset; celdas sin evidencia quedan marcadas como brecha", "Lectura cualitativa del balance; no es un modelo", None),
  ("ds-federal", "src/data/federal_projects.json", "Inventario de proyectos federales BCS (44)", ["/proyectos-federales", "/studio/*", "chat"],
   "Comunicados oficiales gob.mx/bcs.gob.mx, DOF, CFE, prensa", "Gobierno de México / Gobierno de BCS", LIC_GOV,
   "Curaduría manual con URL de fuente principal por proyecto", "Montos citados = anuncios, no ejercido; estado puede cambiar", None),
  ("ds-flights", "src/data/flight_connections_bcs.json", "Conectividad aérea (destinos y vuelos)", ["/vuelos", "/crecimiento"],
   "Horarios publicados de aerolíneas / aeropuertos (corte 2026-09-17)", "Aerolíneas / GAP / ASA", LIC_GOV,
   "Conteo de destinos sin escalas y frecuencias mensuales", "Foto de un corte; estacionalidad no capturada", None),
  ("ds-tourism", "src/data/tourism_detail.json", "Turismo: hoteles, golf, marinas", ["/turismo"],
   "SETUE BCS Información Estratégica; DATATUR; catálogos", "SETUE / SECTUR", LIC_GOV, "Inventario de activos y series publicadas",
   "Catálogo no exhaustivo de establecimientos", None),
  ("ds-realestate", "src/data/inmobiliario_metrics.json", "Indicadores inmobiliarios", ["/inmobiliario"],
   "JLL Reporte Anual Los Cabos 2025; Cabo RE; FITURCA; CONAVI/SNIIV", "JLL / Cabo RE / CONAVI", LIC_PRIV,
   "Cifras citadas de informes", "Informes privados con metodología propia; no comparables entre sí", None),
  ("ds-stakeholders", "src/data/stakeholders.json", "Directorio de actores institucionales", ["/stakeholders", "chat"],
   "BCS_stakeholders_seed.xlsx (Ivan Tamayo Ramos)", "Equipo del portal", LIC_INT,
   "Lista curada de instituciones y titulares", "Cargos cambian: verificar antes de contactar", None),
  ("ds-organigrama", "src/data/los_cabos_organigrama.json", "Organigrama H. XV Ayuntamiento de Los Cabos 2024–2027", ["/studio/los_cabos", "chat"],
   "Organigrama General, BOGE #14 (29 feb 2024)", "H. XV Ayuntamiento de Los Cabos", LIC_GOV,
   "Transcripción de la imagen oficial", "Recuadros sin nombre se dejan vacíos", None),
  ("ds-library", "src/data/library.json", "Biblioteca BCS2050 (915 referencias)", ["/biblioteca", "chat"],
   "Editoriales/organismos de cada referencia (World Bank, CEPAL, OCDE, ONU-Hábitat, etc.)", "Varios", "Según cada documento (Open/Closed/Mixed)",
   "Ficha bibliográfica + extractos con página para documentos indexados", "Solo los documentos con texto indexado aportan extractos al asistente", "scripts/build_library.py"),
  ("ds-gis", "src/data/gis_atlas.json", "Atlas GIS (capas)", ["/mapas"], "INEGI, CONANP, RAN, CONABIO, SEMARNAT", "Varios", LIC_GOV,
   "Capas vectoriales convertidas a GeoJSON", "Escalas y fechas distintas por capa", None),
  ("ds-foresights", "src/data/foresights.json", "Prospectiva (señales)", ["/foresights", "/studio/*"], "Revisión de fuentes del acervo",
   "Equipo del portal", LIC_INT, "Síntesis cualitativa con fuentes", "Lectura interpretativa, no dato oficial", "scripts/update_bcs_foresights.py"),
  ("ds-news", "src/data/news.json", "Noticias", ["/noticias", "/studio/*"], "Medios citados por enlace", "Medios", "Derechos del medio — solo enlace y titular",
   "Selección manual", "No verificado por el portal", None),
]

FIGURES = [
  # id, label, value, unit, page/place, source, date, method, caveat, where shown
  ("fig-pob-bcs", "Población BCS", "798,447", "habitantes", "INEGI CPV 2020", "INEGI Censo de Población y Vivienda 2020", "2020", "Conteo censal POBTOT", "No incluye población flotante", ["/resumen", "/studio/bcs"]),
  ("fig-pob-los-cabos", "Población Los Cabos", "351,111", "habitantes", "INEGI ITER 2020", "INEGI CPV 2020", "2020", "POBTOT municipal", "Crecimiento posterior a 2020 no reflejado", ["/studio/los_cabos"]),
  ("fig-pob-la-paz", "Población La Paz", "292,241", "habitantes", "INEGI ITER 2020", "INEGI CPV 2020", "2020", "POBTOT municipal", "", ["/studio/la_paz"]),
  ("fig-pob-comondu", "Población Comondú", "73,021", "habitantes", "INEGI ITER 2020", "INEGI CPV 2020", "2020", "POBTOT municipal", "", ["/studio/comondu"]),
  ("fig-pob-mulege", "Población Mulegé", "64,022", "habitantes", "INEGI ITER 2020", "INEGI CPV 2020", "2020", "POBTOT municipal", "", ["/studio/mulege"]),
  ("fig-pob-loreto", "Población Loreto", "18,052", "habitantes", "INEGI ITER 2020", "INEGI CPV 2020", "2020", "POBTOT municipal", "", ["/studio/loreto"]),
  ("fig-dma-deficit-sur", "Suma de déficits DMA (7 acuíferos pack sur)", "63.88", "hm³/año", "Fichas CONAGUA 2024 (0313–0325)", "CONAGUA Actualización DMA 2024", "2024", "Suma de DMA negativas", "Un remanente no compensa el déficit de otro acuífero", ["/agua"]),
  ("fig-dma-bcs-deficit", "Acuíferos BCS en déficit", "22 de 39", "acuíferos", "DOF 9 nov 2023, p.3", "CONAGUA/SEMARNAT Acuerdo DMA 653 acuíferos", "2023-11-09", "Conteo de DMA < 0", "Balance legal", ["/agua"]),
  ("fig-desal-cabos", "Desaladora Los Cabos", "250 l/s ≈ 7.88 hm³/año", "", "DOF 27 oct 2020 convocatoria APP; ficha ProyectosMéxico 2021", "CONAGUA / Proyectos México", "2020–2021", "Conversión a factor de planta 100%", "Estado as-built y consumo energético no consolidados", ["/agua"]),
  ("fig-sibcs-pico", "Pico de demanda SIBCS", "688.5 MW (10 sep 2024)", "MW", "PAMRNT 2025–2039 Cuadro 4.1.9", "CENACE", "2024", "Demanda instantánea máxima", "No es capacidad instalada", ["/energia"]),
  ("fig-sibcs-consumo", "Consumo neto SIBCS", "3,257", "GWh", "PRODESEN 2024–2038 Cap.3", "SENER", "2023", "Consumo neto anual", "PLADESE usa otra contabilidad (3,079 GWh 2024)", ["/energia"]),
  ("fig-pib-2024", "PIB BCS 2024 (constante)", "187,152", "millones de pesos", "INEGI PIBE 2024", "INEGI", "2025-12-05", "Valores constantes base 2018", "El PIBE 2023 publicó 181,155 mdp para 2023", ["/economia"]),
  ("fig-ied-2025", "IED BCS 2025", "1,578", "millones de dólares", "Secretaría de Economía / CNIE", "Secretaría de Economía", "2025", "Flujos de IED", "Cifras preliminares revisables", ["/economia"]),
  ("fig-esc-red-km", "Red de drenaje BCS (HydroRIVERS)", "16,588.1", "km", "estadisticas.json del paquete BCS_Escorrentia_2026", "HydroRIVERS v1 recortado al estado", "2026-10-05", "Suma CLIPPED_KM de 2,900 tramos", "Modelo de terreno, no mapa oficial de inundación", ["/agua/escorrentia"]),
  ("fig-esc-seeds", "Semillas D8 de escorrentía", "4,574", "puntos", "estadisticas_stormwater.json", "HydroSHEDS DIR 3″", "2026-10-05", "Retícula 45 celdas; 4,428 salidas costeras y 146 sumideros", "Conteos de rutas muestreadas, no volúmenes", ["/agua/escorrentia"]),
  ("fig-files", "Archivos en el catálogo", None, "archivos", "catalog.json", "Escaneo del acervo", None, "Conteo de catalog.json (fuente única)", "Incluye espejos de 10_data_lake", ["/resumen", "/catalogo", "/explorar"]),
]

def main():
    cat = json.loads((D / "catalog.json").read_text(encoding="utf-8"))
    slim = json.loads((D / "catalog_slim.json").read_text(encoding="utf-8"))
    fs = json.loads((D / "folders_summary.json").read_text(encoding="utf-8"))
    n_cat, n_slim = len(cat["files"]), len(slim)
    datasets = []
    for (i, f, t, used, src, owner, lic, method, caveat, script) in DATASETS:
        datasets.append(dict(id=i, title=t, file=f, used_on=used, source=src, source_date=None, file_updated=mtime(f),
                             licence=lic, owner=owner, custodian=CUSTODIAN, method=method, caveat=caveat,
                             refresh=script, exists=(HUB / f).exists()))
    figures = []
    for (i, label, val, unit, page, src, date, method, caveat, where) in FIGURES:
        if i == "fig-files":
            val = f"{n_cat:,}"
            date = fs.get("generated_at", "")[:10]
        figures.append(dict(id=i, label=label, value=val, unit=unit, page=page, source=src, date=date,
                            method=method, caveat=caveat, shown_on=where))
    out = dict(
        generated=datetime.date.today().isoformat(),
        purpose_es="Inventario y linaje de datos del portal: fuente, fecha, licencia, propietario, método y advertencia de cada dataset y cifra clave.",
        catalog_count=dict(
            catalog_json=n_cat, catalog_slim_json=n_slim, folders_summary_total=fs.get("total_files"),
            reconciled=(n_cat == n_slim == fs.get("total_files")),
            excluded_from_public_catalog=fs.get("excluded_from_public_catalog"),
            note_es=("Fuente única: catalog.json. Antes del 5 oct 2026 catalog_slim tenía 6,747 filas (25 archivos de "
                     "13_federal_projects/ faltaban porque se regeneraba desde una copia vieja); ahora se deriva siempre de catalog.json. "
                     "El 5 oct 2026 se retiraron del catálogo público las entradas sin contenido: herramientas internas, registros y "
                     "copias de respaldo (non_document); descargas fallidas cuyo contenido está en otro archivo (superseded); y archivos "
                     "cuyo contenido no se pudo obtener (no_content). Estos últimos pasan a la lista de documentos por obtener de "
                     "data_gaps.json (wishlist, visible en /memoria). Lista completa en el repositorio: src/data/catalog_exclusions.json."),
        ),
        datasets=datasets, figures=figures,
    )
    for p in (D / "data_inventory.json", HUB / "public/data_inventory.json"):
        p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(out["catalog_count"]), len(datasets), "datasets", len(figures), "figures")

if __name__ == "__main__":
    main()
