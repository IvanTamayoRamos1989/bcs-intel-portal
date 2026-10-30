# Deploy report — /inicio explore cards UX (2026-10-27)

**Final production deploy:** 6ae0e5b46d6e75229d85ddf9 (site bcs-intel-portal → bajacaliforniasur2050.com)
Intermediate iterations same day: 6ae0e4ac274bd2a3e0823c52, 6ae0e5105b9035b9454fa9e0, 6ae0e56121c142c58860822a.
Previous baseline: 6ae0e2ab7e02aff2b84ed0e3 (F+P blue theme).

Files touched: src/components/ChatWidget.astro (one appended CSS block "Landing cards UX", scoped to body.chat-home). Backup: _backups/ChatWidget.astro.20261027_184949.bak. Markup, copy, JS unchanged. /portal untouched.

## Root cause
- .bcs-chat-msgs is a flex column (flex:1, overflow auto, justify-content: safe center). Its children could flex-shrink, so the card grid's content overflowed visually beneath the composer instead of growing the scroll area → row 2 looked "covered" at 1440×900.
- Cards were vertical (64px-tall thumb + label + question) ≈197px rendered each; two rows + hero exceeded the space above the composer.

## Fix
- `.bcs-chat-msgs > * { flex-shrink: 0 }`; composer flex-shrink:0 + z-index → no overlap possible; worst case it scrolls.
- Desktop/tablet (≥561px): horizontal tiles — 88px thumbnail left (cover, full height), category label + question right; min-height 92px (80px on viewports ≤760 tall). Even 0.9rem gaps, 14px radius, thin white border, softer shadow, hover lift.
- Phones (≤560px): vertical 2-column cards with 16:7 thumbnail, 3-line clamp.
- Short desktop viewports (≤760px tall): slightly smaller hero title and gaps.

## Before / after (live measurements)
| Viewport | Before | After |
|---|---|---|
| 1440×900 | cards 197px tall, row 2 bottom 873 > composer top 725 (covered) | cards 101px, row 2 bottom 597 < 725, no scroll |
| 1280×720 | cards 165px, row 2 bottom 754 > 545 | cards 101px, row 2 bottom 493 < 545, no scroll |
| 390×844 | — | 2-col vertical cards; scrolls in message area (expected on phones) |

Checks: Hablar/Escuchar visible; clicking the Ciudad card sends the question and receives a bot answer.
Screenshots: ux_redesign_shots/inicio_cards_ux.png (1440×900), inicio_cards_ux_1280x720.png, inicio_cards_ux_mobile.png.
