# Mobile UX — bottom chat sheet

**Breakpoint:** `max-width: 900px` (same as nav hamburger / GIS drawer).

## Behavior

| Viewport | Chat | Main content |
|----------|------|--------------|
| **Mobile** (≤900px) | Bottom sheet **3-state**: collapsed (FAB) → partial (~48vh) → full (~100vh). Header toggles + swipe on head; Escape steps down; place strip preserved. | Full width. No `padding-right` for sidebar; header spans 100%. Filters stack; tables scroll horizontally. Bottom padding clears the FAB. |
| **Desktop** (≥901px) | Always-open slim right sidebar (320px). No FAB / close. | `padding-right: 320px`; sticky header inset from the right. |

## Files
- `src/components/ChatWidget.astro` — layout, CSS, open/close JS
- `src/styles/global.css` — `body.has-chat-sidebar` desktop vs mobile
- `src/layouts/BaseLayout.astro` — unchanged shell (`has-chat-sidebar` class)

## Unchanged
- EN/ES i18n labels (`chatOpen`, `chatClose`, …)
- Auth gate, Drive links, `/api/chat` triple-link payload

## Verify (~390px width)
`/catalogo`, `/resumen`, `/mapas`, `/stakeholders` — readable full width with chat collapsed.
