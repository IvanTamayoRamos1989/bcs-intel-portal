# Deploy — phone shell, second pass

## What changed

On a narrow screen the map stays mostly visible. Calles, Satélite and Capas sit in a small bar. Capas opens a short sheet. Cerrar capas, or a tap on the map, puts it away.

After a reply in Consulta, the phone moves to Mapa and shows one line: “El mapa ya muestra ese lugar.” Archivos keeps a count of the files that belong to that answer. If you are already reading Archivos, the phone does not pull you away. It marks Mapa instead.

The BCS2050 title and the link to the rest of the portal leave the phone map. ES / EN stays at the top left.

The page does not bounce or refresh when you pull the map. Its height follows the visible screen, including the iOS address bar. In landscape the three names sit in a rail on the left so the map keeps its height. A drag that starts on the map does not change tabs. Chips on Satélite use white text on a dark bar.

The wide window is unchanged. The map is still only Baja California Sur.

## How to verify

1. At about 390×844, open Capas. The state is still on screen. Close the sheet with one thumb.
2. From Consulta, ask about Presa El Novillo. The view goes to Mapa, the point is on La Paz, and Archivos shows a count. Open Archivos: the Novillo file is there.
3. Turn on Satélite. The buttons stay readable.
4. At about 844×390 the three names are a side rail and the map still fills the rest.

## What a third pass could still tighten

- Remember the last phone tab after a reload.
- A quieter toast if the answer did not move the map.
- Haptics are not available here.
- The chat’s own suggested questions are still a long list above the box.
