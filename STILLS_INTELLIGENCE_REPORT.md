# Stills Intelligence Report

Generated: 2026-09-16T16:16:11.976088+00:00 (UTC)

## Method
1. Load `stills.json` (956 stills with images).
2. Spatial join vs GIS under `public/gis/` within ~1500 m (coast up to 20 km):
   highways, waterways, ANP federales, OSM protected, POER UGAs, RAN, RTP, towns/settlements, coastline, beaches, power.
3. Vision (optional): OpenAI vision on thumbnails when `BCS_CHAT_API_KEY` is available; resume via JSONL checkpoint.
4. Chat knowledge: per-still + per-municipio + corridor chunks → `public/chat_stills_knowledge.json`, merged into chat corpus.

## Counts
- Spatial analyzed: **956**
- Vision OK: **956**
- Vision pending: **False**
- Chat chunks: **964**

## Sample findings
- **Santa Rosalía** (Mulegé): Still Santa Rosalía (Mulegé), cat=cabecera. Carretera cercana: Manuel F. Montoya (secondary, a 112.1 m). Dentro de ANP federal: El Vizcaíno. UGA POER: 01 ANP Reserva de la Biosfera El Vizcaíno. Cerca de costa (~426.0 m).
- **Loreto** (Loreto): Still Loreto (Loreto), cat=cabecera. Carretera cercana: Avenida Benito Juárez (secondary, a 62.9 m). UGA POER: 30 PSDU Loreto-Nopoló-Notrí-Pto Escondido-Liguí-Ensenada Blanca. Cerca de costa (~413.8 m). Asentamiento cerc
- **Ciudad Constitución** (Comondú): Still Ciudad Constitución (Comondú), cat=cabecera. Carretera cercana: Calle Agustín Olachea Avilés (trunk, a 84.9 m). UGA POER: 16 AH Ciudad Constitución. Asentamiento cercano: Ciudad Constitución a 1644.4 m. Cauce cerca
- **La Paz** (La Paz): Still La Paz (La Paz), cat=cabecera. Carretera cercana: Calle Isabel la Católica (secondary, a 91.2 m). UGA POER: 41 PDU Centro de Población de La Paz. Cerca de costa (~1780.2 m). Asentamiento cercano: La Paz a 1720.9 m.
- **San José del Cabo** (Los Cabos): Still San José del Cabo (Los Cabos), cat=cabecera. Carretera cercana: secondary (secondary, a 42.2 m). UGA POER: 40 PDU San José del Cabo-Cabo San Lucas. Cerca de costa (~1773.5 m). Asentamiento cercano: San José del Cab
- ANP: **Santa Rosalía** — Still Santa Rosalía (Mulegé), cat=cabecera. Carretera cercana: Manuel F. Montoya (secondary, a 112.1 m). Dentro de ANP federal: El Vizcaíno. UGA POER: 01 ANP Reserva de la Biosfera El Vizcaíno. Cerca 
- ANP: **Guerrero Negro** — Still Guerrero Negro (Mulegé), cat=localidad. Carretera cercana: Avenida Emiliano Zapata (secondary, a 615.3 m). Dentro de ANP federal: El Vizcaíno. UGA POER: 01 ANP Reserva de la Biosfera El Vizcaíno
- ANP: **Benito Juárez** — Still Benito Juárez (BCS), cat=localidad. Dentro de ANP federal: El Vizcaíno. UGA POER: 01 ANP Reserva de la Biosfera El Vizcaíno. Asentamiento cercano: Benito Juárez a 77.1 m. La localidad tiene una 
- ANP: **Isla Natividad** — Still Isla Natividad (BCS), cat=localidad. Dentro de ANP federal: El Vizcaíno. Área protegida OSM: ?. Cerca de costa (~203.8 m). Asentamiento cercano: Isla Natividad a 62.3 m. La isla tiene una poblac
- ANP: **Francisco J. Mújica** — Still Francisco J. Mújica (BCS), cat=localidad. Carretera cercana: Carretera Santa Rosalía-Guerrero Negro (trunk, a 318.4 m). Dentro de ANP federal: El Vizcaíno. UGA POER: 01 ANP Reserva de la Biosfer

## Outputs
- `src/data/stills_intelligence.json`
- `public/stills_intelligence_slim.json`
- `public/chat_stills_knowledge.json`
- Checkpoint: `scripts/_cache/stills_intel_checkpoint.jsonl`
- Progress: `scripts/_cache/stills_intel_progress.json`

## Chatbot
Rebuild corpus with `python3 scripts/build_chat_corpus.py` (includes stills knowledge) and redeploy Netlify functions.
