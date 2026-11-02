# Deploy — smartphone shell

## What changed

On a narrow screen, `/inicio` shows one pane at a time. The bottom bar is Consulta, Mapa and Archivos. Each button is at least 52px tall, and the bar sits above the home indicator.

The map fills the space under the status bar. Calles, Satélite and the theme chips are at least 44px, in a card at the bottom of the map so the state stays visible. Capas opens in that same card.

The chat box stays at the bottom of Consulta. Messages scroll. The page height follows the visible screen, so the keyboard does not cover the box. The file search, each file row and the preview stay inside the width of the phone.

The desktop window is unchanged: chat, map and files side by side. The map is still only Baja California Sur.

## How to verify

1. Open `/inicio` at about 390×844. Only the map is showing, with the three tabs underneath.
2. Tap Consulta, type, and confirm the box stays above the keyboard. Tap Mapa: Calles and Satélite are easy to hit.
3. Ask about Presa El Novillo, then open Mapa and Archivos. The point is on the state and the Novillo file is listed.
4. Turn the phone sideways and back. The map refits. Nothing scrolls sideways.
