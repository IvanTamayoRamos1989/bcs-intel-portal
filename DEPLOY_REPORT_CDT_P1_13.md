# Deploy — Phase 1.13 link audit, operator sheet, focus rings

## What shipped

- Link check of `/gemelo`, `/aprendizaje`, `/coordinacion`, `/vistas`, `/metas`, `/foro`, and `/studio`. Nav, footer, chat chips, and `netlify.toml` already point at pages that exist. `/cdt`, `/decision`, and `/decision-twin` still redirect to `/gemelo/`. `/places` and `/lugar` still redirect to `/studio/`. `/lugares` stays a page that opens the municipality index, including the place-name map. Search now lists Loreto, Comondú, Mulegé, and the state page next to Los Cabos and La Paz. No hyphenated studio slugs were found.
- `DEPLOY_REPORT_CDT_INDEX.md` is the operator sheet: live paths, password `BCS2050`, the two series that stay blank, and what Phase 2 still needs (AGEB, morphometrics, cadastre). The phase table stays underneath.
- The decision path keeps `aria-current="page"` on the active step. Keyboard focus on that step is a white ring with a dark halo, so it stays visible on the blue pill. The home specialist row uses the same idea: a white ring and a dark halo on the blue home background.
- Loreto 2025 air passengers stay blank. The SETUE OCR note in the archive mentions the Loreto airport and says the number is incomplete. It is not a citable 2025 municipal total.

No new pages. No new municipal figures.

## How to try

1. Tab through the path on `/gemelo`. The current step (Comparar) shows a focus ring.
2. On `/inicio`, tab to Gemelo, Vistas, Metas, Coordinación, Aprendizaje, and Foro. Each chip shows a focus ring.
3. Search for Loreto, Comondú, and Mulegé and open the municipality page.
4. Read `DEPLOY_REPORT_CDT_INDEX.md` for the live paths and the password.
