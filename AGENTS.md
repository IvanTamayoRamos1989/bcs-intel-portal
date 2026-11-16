# Regla de producto de BCS2050

Aplicable a ChatGPT/Codex, Claude, Grok, Antigravity y cualquier colaborador.

La experiencia pública del portal, tras el acceso, es una sola portada. Chat, Mapa 3D, Documentos y Foresight siguen existiendo en sus rutas, con toda la inteligencia del backend, pero ya no forman el menú visible.

1. **Portada** en `/` (visitantes con sesión; la ruta `/portada/` sirve el mismo contenido). Tres columnas iguales en escritorio, apiladas en el mismo orden en móvil:
   1. **Noticias.** El feed diario (`src/data/news.json`), de más reciente a más antigua, para leerse cada día.
   2. **Tendencia 2050.** Lo más probable que ocurra en BCS hacia 2050 dadas las circunstancias de hoy. Sale de la capa cuantitativa (EWMA, Holt, escenarios bayesianos, confianza). Se regenera cada día con el refresco de noticias. Muestra «Actualizada: &lt;fecha&gt;».
   3. **Visión.** El 2050 ideal y alcanzable, que mitiga los riesgos que señala la Tendencia: escenario normativo, proactivo y regenerativo. Para cada motor o techo de la Tendencia, una aspiración y sus palancas, ancladas en datos del portal, sin cifras inventadas. Las metas se etiquetan como aspiraciones. También se regenera cada día y muestra «Actualizada: &lt;fecha&gt;».
2. **Chat** en `/inicio/`. Conversación, respuestas y referencias. Fuera del menú de la portada.
3. **Mapa 3D** en `/consulta/`. Gemelo digital del estado.
4. **Documentos** en `/catalogo/`. Repositorio con buscador.
5. **Foresight** en `/foresights/`. Blog de prospectiva semanal: Tendencia 2050, Visión, la edición vigente y el archivo, cada una con su página permanente. La rutina semanal debe archivar la edición previa y revisar tendencia y visión de forma incremental, no reescribirlas de cero ni sobrescribir el archivo. No inventar contenido.

La contraseña de acceso se mantiene: `/` sin sesión es la puerta; con sesión, `/` muestra la portada. Un pie discreto en la portada enlaza a las herramientas. No volver a un menú Chat | Mapa 3D | Documentos | Foresight como cara pública del sitio. Para cambiar esta arquitectura se necesita una instrucción expresa de Iván.

La rutina diaria de noticias debe recomputar Tendencia 2050 y Visión (`python3 scripts/update_bcs_news.py`, que ya llama a `foresights_vision.py` y `foresights_ideal.py` con la fecha del día) y archivar las versiones previas.

Antes de entregar una mejora de UX, compilar el portal y ejecutar `node scripts/check_three_pages.mjs`. Verificar también el recorrido afectado en escritorio y móvil.
