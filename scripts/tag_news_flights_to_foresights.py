#!/usr/bin/env python3
"""Tag news + flights into foresights signals / place cards / consensus seeds.

Writes:
  - src/data/foresights.json (+ public mirror): place_ids, provenance, enriched seeds
  - src/data/news.json: place_ids + feeds_into (signal ids / place links)
  - public/foresights_feeds.json: compact index for /noticias and /vuelos pages

Evidence-based only — no invented statistics. Uses keyword/place heuristics
aligned with update_bcs_foresights.py theme hints.
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FS = ROOT / "src" / "data" / "foresights.json"
PUB_FS = ROOT / "public" / "foresights.json"
NEWS = ROOT / "src" / "data" / "news.json"
FLIGHTS = ROOT / "src" / "data" / "flight_connections_bcs.json"
FEEDS = ROOT / "public" / "foresights_feeds.json"

PLACE_PATTERNS = [
    ("los_cabos", re.compile(r"los\s+cabos|cabo\s+san\s+lucas|san\s+jos[eé]\s+del\s+cabo|\bSJD\b|sanluqueñ|desaladora\s+d1|oomsapas\s+los\s+cabos", re.I)),
    ("east_cape", re.compile(r"east\s+cape|cabo\s+del\s+este|cabo\s+pulmo|san\s+jos[eé]\s+del\s+este|la\s+ribera", re.I)),
    ("todos_santos", re.compile(r"todos\s+santos|el\s+pescadero|pescadero", re.I)),
    ("la_paz", re.compile(r"la\s+paz|\bLAP\b|oomsapas\s+la\s+paz|cespes", re.I)),
    ("loreto", re.compile(r"\bloreto\b|\bLTO\b|nopol[oó]|san\s+javier", re.I)),
    ("comondu", re.compile(r"comond[uú]|constituci[oó]n|ciudad\s+constituci|vizca[ií]no\s+sur|santo\s+domingo", re.I)),
    ("mulege_north", re.compile(r"muleg[eé]|santa\s+rosal[ií]a|vizca[ií]no(?!\s+sur)|\bmulege\b", re.I)),
]

THEME_HINTS = [
    (re.compile(r"agua|desal|acu[ií]fer|conagua|oomsapas|tandeo|ptar|bombeo|fisam", re.I), "water"),
    (re.compile(r"energ|cfe|apag[oó]n|sibcs|sener|solar|hidr[oó]geno|\bh2\b|red\s+el[eé]ct", re.I), "energy"),
    (re.compile(r"turismo|hotel|playa|marina|ied|inversi[oó]n|amenidad", re.I), "tourism"),
    (re.compile(r"anp|semarnat|ambiental|pulmo|ecolog|conserv", re.I), "environment"),
    (re.compile(r"poel|pdu|pmd|ordenamiento|planeaci|pmdu|plan\s+parcial|uso\s+de\s+suelo", re.I), "planning"),
    (re.compile(r"vuelo|aeropuerto|conectividad\s+a[eé]rea|\bSJD\b|\bLAP\b|\bLTO\b|destino", re.I), "connectivity"),
]

# Airport → place vocation
AIRPORT_PLACE = {
    "SJD": "los_cabos",
    "LAP": "la_paz",
    "LTO": "loreto",
}

PLACE_LABELS = {
    "los_cabos": {"es": "Los Cabos", "en": "Los Cabos"},
    "east_cape": {"es": "Cabo Este", "en": "East Cape"},
    "todos_santos": {"es": "Todos Santos", "en": "Todos Santos"},
    "la_paz": {"es": "La Paz", "en": "La Paz"},
    "loreto": {"es": "Loreto", "en": "Loreto"},
    "comondu": {"es": "Comondú", "en": "Comondú"},
    "mulege_north": {"es": "Mulegé N.", "en": "Mulegé N."},
}

# Consensus seed enrichment (evidence-based from existing claims + role tensions)
SEED_ENRICH = [
    {
        "match": re.compile(r"suma de vocaciones|sum of complementary", re.I),
        "status": "emerging",
        "place_ids": ["los_cabos", "east_cape", "todos_santos", "la_paz", "loreto", "comondu", "mulege_north"],
        "opposing_lenses": ["tourism_investment", "territorial_development", "vision_spatial"],
        "next_evidence_es": "Comparar scorecards de /crecimiento por las 7 vocaciones y citar una métrica portal (DMA, vuelos o stills) por lugar.",
        "next_evidence_en": "Compare /crecimiento scorecards across the 7 vocations and cite one portal metric (DMA, flights or stills) per place.",
    },
    {
        "match": re.compile(r"agua y energ|water and energy", re.I),
        "status": "emerging",
        "place_ids": ["los_cabos", "la_paz", "east_cape", "loreto", "todos_santos"],
        "opposing_lenses": ["water_security", "energy_grid", "tourism_investment", "sustainability_infra"],
        "next_evidence_es": "Enlazar la señal de acoplamiento agua–energía con celdas gap de agua/energía en /crecimiento para Cabos y La Paz.",
        "next_evidence_en": "Link the water–energy coupling signal to water/energy gap cells on /crecimiento for Cabos and La Paz.",
    },
    {
        "match": re.compile(r"east cape|cabo pulmo", re.I),
        "status": "contested",
        "place_ids": ["east_cape", "los_cabos"],
        "opposing_lenses": ["environment_anp", "tourism_investment", "municipal_planning"],
        "next_evidence_es": "Abrir ficha East Cape en /crecimiento y cruzar con notas de planeación San José del Este en /noticias y catálogo 01_planning.",
        "next_evidence_en": "Open the East Cape /crecimiento card and cross-check San José del Este planning notes in /noticias and catalog 01_planning.",
    },
    {
        "match": re.compile(r"todos santos|pescadero|amenity migration|migraci[oó]n de amenidad", re.I),
        "status": "contested",
        "place_ids": ["todos_santos", "los_cabos"],
        "opposing_lenses": ["community_tenure", "municipal_planning", "tourism_investment"],
        "next_evidence_es": "Revisar gaps de infraestructura en scorecard Todos Santos y stills / foresights para ese place_id.",
        "next_evidence_en": "Review infrastructure gaps on the Todos Santos scorecard and stills/foresights for that place_id.",
    },
    {
        "match": re.compile(r"la paz debe|la paz must", re.I),
        "status": "emerging",
        "place_ids": ["la_paz"],
        "opposing_lenses": ["territorial_development", "municipal_planning", "tourism_investment"],
        "next_evidence_es": "Usar roll-up estatal + scorecard La Paz en /crecimiento y conectividad LAP en /vuelos como evidencia de rol capital.",
        "next_evidence_en": "Use state roll-up + La Paz scorecard on /crecimiento and LAP connectivity on /vuelos as capital-role evidence.",
    },
    {
        "match": re.compile(r"comond|agri/desal|segundo pilar", re.I),
        "status": "contested",
        "place_ids": ["comondu", "los_cabos"],
        "opposing_lenses": ["tourism_investment", "water_security", "territorial_development"],
        "next_evidence_es": "Marcar celdas gap agrícolas/DMA de Comondú en /crecimiento; no inventar hm³ — solo portal.",
        "next_evidence_en": "Flag Comondú agri/DMA gap cells on /crecimiento; do not invent hm³ — portal only.",
    },
    {
        "match": re.compile(r"capacidad de carga|carrying-capacity|faltan m[eé]tricas", re.I),
        "status": "gap",
        "place_ids": ["los_cabos", "la_paz", "loreto", "east_cape", "todos_santos", "comondu", "mulege_north"],
        "opposing_lenses": ["sustainability_infra", "water_security", "tourism_investment", "municipal_planning"],
        "next_evidence_es": "Inventariar celdas status=gap en growth_demand_supply.json y priorizar la que bloquee el próximo debate de IED.",
        "next_evidence_en": "Inventory status=gap cells in growth_demand_supply.json and prioritize the one blocking the next FDI debate.",
    },
]


def load(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def places_in_text(text: str) -> list[str]:
    found = []
    for pid, rx in PLACE_PATTERNS:
        if rx.search(text or ""):
            found.append(pid)
    return found


def theme_of(text: str) -> str:
    for rx, tag in THEME_HINTS:
        if rx.search(text or ""):
            return tag
    return "planning"


def main() -> int:
    fs = load(FS, {})
    news = load(NEWS, {"items": []})
    flights = load(FLIGHTS, {"airports": []})

    signals = fs.get("signals") or []
    places = fs.get("places") or []
    roles = {r["role_id"]: r for r in (fs.get("role_briefs") or []) if r.get("role_id")}
    seeds = fs.get("consensus_seeds") or []

    # --- Tag news ---
    news_by_id = {}
    for it in news.get("items") or []:
        blob = " ".join(
            str(it.get(k) or "")
            for k in ("title_es", "title_en", "blurb_es", "blurb_en", "source", "url")
        )
        pids = places_in_text(blob)
        topics = list(it.get("topics") or [])
        th = theme_of(blob)
        if th not in topics:
            topics.append(th)
        # Match signals by theme + place overlap or shared URL
        feeds = []
        for s in signals:
            score = 0
            if s.get("theme") == th:
                score += 2
            surls = set(s.get("source_urls") or [])
            if it.get("url") and it["url"] in surls:
                score += 5
            sblob = " ".join(str(s.get(k) or "") for k in ("title_es", "title_en", "why_es", "why_en"))
            sp = places_in_text(sblob) or s.get("place_ids") or []
            if set(pids) & set(sp):
                score += 2
            if score >= 2:
                feeds.append({"type": "signal", "id": s["id"], "score": score})
        feeds.sort(key=lambda x: -x["score"])
        feeds = feeds[:4]
        # Always offer place deep-links when places known
        for pid in pids:
            feeds.append({"type": "place", "id": pid})
        # Dedupe keep order
        seen = set()
        feeds_clean = []
        for f in feeds:
            key = (f["type"], f["id"])
            if key in seen:
                continue
            seen.add(key)
            feeds_clean.append({"type": f["type"], "id": f["id"]})
        it["place_ids"] = pids
        it["topics"] = topics
        it["feeds_into"] = feeds_clean
        news_by_id[it["id"]] = it

    # --- Tag signals with places + news + flights provenance ---
    airport_counts = {
        a["iata"]: a.get("counts", {}).get("total")
        for a in (flights.get("airports") or [])
        if a.get("iata")
    }
    for s in signals:
        blob = " ".join(str(s.get(k) or "") for k in ("title_es", "title_en", "why_es", "why_en", "theme"))
        pids = list(dict.fromkeys((s.get("place_ids") or []) + places_in_text(blob)))
        # Theme connectivity → flight airports
        flight_refs = []
        if s.get("theme") in ("tourism", "planning") or re.search(r"vuelo|aeropuerto|SJD|LAP|LTO|conectividad", blob, re.I):
            for iata, pid in AIRPORT_PLACE.items():
                if iata in blob or pid in pids or (s.get("theme") == "tourism" and iata == "SJD"):
                    if iata in airport_counts:
                        flight_refs.append(
                            {
                                "iata": iata,
                                "place_id": AIRPORT_PLACE[iata],
                                "destinations": airport_counts[iata],
                                "source": "flight_connections_bcs.json",
                            }
                        )
                        if AIRPORT_PLACE[iata] not in pids:
                            pids.append(AIRPORT_PLACE[iata])
        # News that feed this signal
        news_ids = []
        for nid, nit in news_by_id.items():
            for f in nit.get("feeds_into") or []:
                if f.get("type") == "signal" and f.get("id") == s.get("id"):
                    news_ids.append(nid)
                    break
            # URL overlap
            if nit.get("url") and nit["url"] in (s.get("source_urls") or []):
                if nid not in news_ids:
                    news_ids.append(nid)
        s["place_ids"] = pids
        s["provenance"] = {
            "news_ids": news_ids[:6],
            "flight_refs": flight_refs[:3],
        }

    # Ensure at least one connectivity signal carries flight refs if none did
    if not any((s.get("provenance") or {}).get("flight_refs") for s in signals):
        # Attach to tourism or first water/tourism signal + create provenance on a planning signal about growth
        target = next((s for s in signals if s.get("theme") == "tourism"), None) or (signals[0] if signals else None)
        if target:
            refs = [
                {
                    "iata": iata,
                    "place_id": pid,
                    "destinations": airport_counts.get(iata),
                    "source": "flight_connections_bcs.json",
                }
                for iata, pid in AIRPORT_PLACE.items()
                if airport_counts.get(iata) is not None
            ]
            prov = target.setdefault("provenance", {"news_ids": [], "flight_refs": []})
            prov["flight_refs"] = refs
            for pid in AIRPORT_PLACE.values():
                if pid not in (target.get("place_ids") or []):
                    target.setdefault("place_ids", []).append(pid)

    # --- Place cards: news + flight provenance ---
    for pl in places:
        pid = pl.get("id")
        nids = [nid for nid, nit in news_by_id.items() if pid in (nit.get("place_ids") or [])]
        flight_refs = []
        for iata, p in AIRPORT_PLACE.items():
            if p == pid and iata in airport_counts:
                flight_refs.append(
                    {
                        "iata": iata,
                        "destinations": airport_counts[iata],
                        "source": "flight_connections_bcs.json",
                    }
                )
        pl["provenance"] = {
            "news_ids": nids[:8],
            "flight_refs": flight_refs,
        }

    # --- Enrich consensus seeds ---
    enriched = []
    for seed in seeds:
        claim = (seed.get("claim_es") or "") + " " + (seed.get("claim_en") or "")
        meta = next((m for m in SEED_ENRICH if m["match"].search(claim)), None)
        out = dict(seed)
        if meta:
            out["status"] = meta.get("status") or out.get("status") or "emerging"
            out["place_ids"] = meta["place_ids"]
            out["opposing_lenses"] = [
                {
                    "role_id": rid,
                    "label_es": (roles.get(rid) or {}).get("role_label_es") or rid,
                    "label_en": (roles.get(rid) or {}).get("role_label_en") or rid,
                }
                for rid in meta["opposing_lenses"]
                if rid in roles or True
            ]
            out["next_evidence_es"] = meta["next_evidence_es"]
            out["next_evidence_en"] = meta["next_evidence_en"]
        else:
            # Fallback: infer places from claim text
            pids = places_in_text(claim)
            out["place_ids"] = pids or out.get("place_ids") or []
            out.setdefault("opposing_lenses", [])
            out.setdefault(
                "next_evidence_es",
                "Abrir /foresights#signals y /crecimiento para el lugar más citado en la afirmación.",
            )
            out.setdefault(
                "next_evidence_en",
                "Open /foresights#signals and /crecimiento for the place most cited in the claim.",
            )
        enriched.append(out)
    fs["consensus_seeds"] = enriched

    # --- Flights feed index for /vuelos page ---
    flight_feeds = []
    for iata, pid in AIRPORT_PLACE.items():
        sig_ids = [
            s["id"]
            for s in signals
            if any(r.get("iata") == iata for r in (s.get("provenance") or {}).get("flight_refs") or [])
            or pid in (s.get("place_ids") or [])
        ][:4]
        flight_feeds.append(
            {
                "iata": iata,
                "place_id": pid,
                "destinations": airport_counts.get(iata),
                "feeds_into_signals": sig_ids,
                "feeds_into_place": pid,
            }
        )

    fs["feeds_meta"] = {
        "updated": date.today().isoformat(),
        "news_tagged": sum(1 for it in news.get("items") or [] if it.get("place_ids") or it.get("feeds_into")),
        "signals_with_provenance": sum(1 for s in signals if (s.get("provenance") or {}).get("news_ids") or (s.get("provenance") or {}).get("flight_refs")),
        "flight_airports": list(AIRPORT_PLACE.keys()),
    }
    fs["signals"] = signals
    fs["places"] = places

    FS.write_text(json.dumps(fs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    PUB_FS.write_text(json.dumps(fs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    NEWS.write_text(json.dumps(news, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    feeds_doc = {
        "updated": date.today().isoformat(),
        "place_labels": PLACE_LABELS,
        "news": [
            {
                "id": it["id"],
                "place_ids": it.get("place_ids") or [],
                "feeds_into": it.get("feeds_into") or [],
                "topics": it.get("topics") or [],
            }
            for it in news.get("items") or []
        ],
        "flights": flight_feeds,
        "signals": [
            {
                "id": s["id"],
                "theme": s.get("theme"),
                "place_ids": s.get("place_ids") or [],
                "provenance": s.get("provenance") or {},
                "title_es": s.get("title_es"),
                "title_en": s.get("title_en"),
            }
            for s in signals
        ],
    }
    FEEDS.write_text(json.dumps(feeds_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        "tagged news=",
        fs["feeds_meta"]["news_tagged"],
        "signals_prov=",
        fs["feeds_meta"]["signals_with_provenance"],
        "seeds=",
        len(enriched),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
