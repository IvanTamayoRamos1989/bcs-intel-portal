# Regla de producto de BCS2050

Aplicable a ChatGPT/Codex, Claude, Grok, Antigravity y cualquier colaborador. La experiencia del portal tiene exactamente tres páginas, en este orden.

1. **Chat** en `/inicio/`. Portada de conversación al estilo ChatGPT. Solo conversación, respuestas y sus referencias. Una respuesta geográfica puede enlazar al Mapa 3D llevando el contexto. No montar el visor de mapas, ni siquiera en un desplegable, ni una barra o un explorador de documentos.
2. **Mapa 3D** en `/consulta/`. Gemelo digital del estado. Aquí se exploran lugares, capas, edificios, mediciones y fichas.
3. **Documentos** en `/catalogo/`. Repositorio con buscador. Aquí se encuentran y consultan documentos y fuentes.

Cada mejora debe encajar en una de estas tres páginas. No crear un cuarto destino de navegación ni volver a la portada de tres paneles. Las fuentes, descargas, acceso privado y enlaces históricos son recursos auxiliares. Para cambiar esta arquitectura se necesita una instrucción expresa de Iván que cambie la regla.

Antes de entregar una mejora de UX, compilar el portal y ejecutar `node scripts/check_three_pages.mjs`. Verificar también el recorrido afectado en escritorio y móvil.
