# Deploy report — /inicio F+P blue (2026-10-27)

- Deploy id: 6ae0e2ab7e02aff2b84ed0e3 (site bcs-intel-portal, --prod)
- Unique URL: https://6ae0e2ab7e02aff2b84ed0e3--bcs-intel-portal.netlify.app
- Live: https://bajacaliforniasur2050.com/inicio

## Files touched
- src/components/ChatWidget.astro: added a scoped `body.chat-home` override block ("Landing F+P blue") at the end of <style>. No /portal selectors changed.
- Backup: _backups/20261027_184145/ChatWidget.astro

## Changes
- Page background and chat panel: solid #0083C4 (overrides the earlier var(--paper) cream on body.chat-home and .bcs-chat-panel).
- Header "BCS 2050", title, subtitle, MUNICIPIOS / MAPAS OFICIALES / FOTOS AÉREAS, "EMPIEZA A EXPLORAR": white or soft white.
- English / Resto del portal: white outline pills.
- 6 explore cards: white cards, kicker label in #0083C4, dark text.
- Input: white card; Enviar in #0083C4. User and bot chat bubbles are white cards with dark text, so answers stay readable on blue.

## Smoke (headless Chrome via Playwright, after password)
- body bg rgb(0,131,196); title color white; 6 cards present; Hablar and Escuchar buttons present.
- Screenshot (1440x900): ux_redesign_shots/inicio_fp_blue.png
- Residual: Hablar/Escuchar pills keep their original light-grey/cream styling inside the white input card. At short viewports (about 600px tall) the input card covers the second row of cards (existing layout, not caused by this change).
