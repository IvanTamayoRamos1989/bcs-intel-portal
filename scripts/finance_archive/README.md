# Archivo de Finanzas de BCS

El portal publica una entrega fechada en `public/finanzas-publicas`, con enlaces desde `/fiscal` y `/gemelo`. El archivo original completo vive fuera de Git; no publicar bases SQLite, credenciales ni HTML de terceros como código ejecutable.

## Recopilación

Definir `BCS_FINANCE_ARCHIVE` como ruta del archivo local. Si no se define, se utiliza `.finance-archive` bajo el directorio de ejecución.

```text
python scripts/finance_archive/collect.py --workers 6
python scripts/finance_archive/enrich_pdf.py
python scripts/finance_archive/prepare_portal.py
python scripts/finance_archive/test_collect.py
node scripts/check_finanzas.mjs
```

El recolector usa únicamente GET, respeta robots del dominio principal y parte de su mapa del sitio. Conserva bytes originales por SHA-256, URL, fecha UTC, tipo, tamaño, página de procedencia y errores. Resuelve enlaces PDF incrustados y concatenaciones de selectores observadas en el código público; nunca ejecuta ese JavaScript. Las combinaciones de selectores son candidatas hasta verificar su descarga. Los portales externos se registran sin recorrerlos; se descargan sus documentos gubernamentales enlazados.

La cola es reanudable. `--retry-errors` vuelve a intentar los errores. `progress.json` distingue pendientes, activos, descargados y errores. No equivale a una copia exhaustiva de bases internas, documentos no enlazados ni todos los selectores posibles. Los archivos mayores de 512 MiB requieren descarga específica y quedan registrados como error.

## Entrega al portal

Solo se incluyen documentos descargados y con contenido legible; la primera entrega contiene PDF con extractos automáticos de la primera página. Los extractos pueden contener errores OCR. Tema y años se detectan en título/URL, sin atribuirles automáticamente un ejercicio fiscal. No se geolocalizan importes ni se distribuyen entre municipios.

`catalog.json`, su equivalente de carga `catalog.js` y `catalog.csv` deben regenerarse conjuntamente desde la base de archivo, conservando identidad URL, SHA-256 y fuentes. Nunca convertir candidatos o errores en documentos disponibles. El registro local conserva todos los formatos y los pendientes; el portal presenta la fecha y límites de la entrega.

`prepare_portal.py` regenera estos tres archivos sin sobrescribir la interfaz ni los importes previamente verificados. Requiere `pypdf` para la extracción previa. El inventario completo se exporta a `BCS_FINANCE_ARCHIVE/catalog`; revisar los cambios y ejecutar los controles antes de publicar una nueva entrega.

`budget-2026-q2.json` y `budget.js` contienen exclusivamente la fila **Total de Egresos**, página 2, del informe LDF de clasificación funcional del Gobierno de BCS, 1 de enero–30 de junio de 2026, en pesos. Se revisó la página renderizada. Conciliaciones: aprobado + ajustes = modificado; modificado − devengado = subejercicio. El aprobado coincide con `fiscal_docs.state_pe_2026`. El porcentaje mostrado no es evaluación de desempeño. Los demás importes del catálogo no están validados.

## Validación

`check_finanzas.mjs` comprueba conciliación financiera, procedencia, unicidad, estado de descarga, extractos y recursos de la interfaz. Los seis casos del recolector comprueban normalización, visores PDF, selectores y sus índices de cabecera. El módulo no cambia el chat ni sus cifras existentes.

La publicación debe seguir `OPERATIONS.md` y conservar los assets y funciones de producción. El repositorio omite `public/stills`; una compilación sin esos recursos no es un paquete completo para sustituir producción.
