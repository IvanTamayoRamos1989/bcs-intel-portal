# F+P participant fichas — hidden from public portal

**Status:** Public hide (backend / general knowledge only)  
**Path:** `08_fp_team_research/`  
**Date:** 2026-09-17 (Europe/Madrid)

## Intent
Foster + Partners participant fichas (roster, individual bios / LinkedIn notes) are for **portal backend / general knowledge only**. Nobody using the public BCS intel portal should see, search, or download them. They must not appear in the portal UI.

## What stays
- Files may remain on Google Drive and in non-public / on-disk data for Ivan’s knowledge.
- `src/data/stakeholders.json` keeps F+P people marked `internal_only` / `public: false` (not rendered as downloadable fichas).

## What is filtered
- Catalog / slim catalog / drive indexes / search folder list / chat RAG corpus
- `engagement_catalog.json` → `exclude_from_downloads` includes path prefix `08_fp_team_research/`, folder id, and Drive folder id
- Rebuild scripts skip or scrub this pack (`build_catalog.py`, `build_chat_corpus.py`, `build_drive_and_summaries.py`, `chat.mjs`)

## Success check
Searching the live portal for Moser, Narváez, Heath, or `fp_team_research` returns nothing public; no View/Download links.
