#!/usr/bin/env python3
"""Statewide Earth Studio stills intelligence: spatial join + optional vision.

Outputs:
  - src/data/stills_intelligence.json
  - public/stills_intelligence_slim.json
  - public/chat_stills_knowledge.json
  - STILLS_INTELLIGENCE_REPORT.md
  - scripts/_cache/stills_intel_checkpoint.jsonl (resume)

Vision uses OpenAI-compatible API via BCS_CHAT_API_KEY from
/home/box/agent-data/box-secrets.json (never printed). Prefer thumbs.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GIS = ROOT / "public" / "gis"
PUBLIC = ROOT / "public"
STILLS_JSON = ROOT / "src" / "data" / "stills.json"
CACHE = ROOT / "scripts" / "_cache"
CHECKPOINT = CACHE / "stills_intel_checkpoint.jsonl"
PROGRESS = CACHE / "stills_intel_progress.json"
OUT_FULL = ROOT / "src" / "data" / "stills_intelligence.json"
OUT_SLIM = PUBLIC / "stills_intelligence_slim.json"
OUT_CHAT = PUBLIC / "chat_stills_knowledge.json"
OUT_REPORT = ROOT / "STILLS_INTELLIGENCE_REPORT.md"
SECRETS = Path("/home/box/agent-data/box-secrets.json")

BUFFER_M = 1500.0  # ~1.5 km
EARTH_M_PER_DEG_LAT = 111_320.0

VISION_PROMPT = """You are analyzing a nadir (top-down) aerial photo of Baja California Sur, Mexico.
Return ONLY compact JSON (no markdown) with these keys:
- settlement_density: none|sparse|moderate|dense
- tourism_resort: boolean
- land_cover: desert|scrub|agriculture|urban|coastal|mixed|mountain|other
- coast_visible: boolean
- water_features: list of short strings (arroyo, lagoon, ocean, none, etc.)
- roads_visible: none|dirt|paved|highway
- infrastructure: list (port, airstrip, power, marina, mine, greenhouse, none, etc.)
- degradation_signs: list (erosion, clearing, sprawl, dumping, none, etc.)
- notes_es: one short Spanish sentence
- notes_en: one short English sentence
- confidence: 0-1
Be factual; if unsure use conservative values."""


def load_api_key() -> str | None:
    # env first
    for k in ("BCS_CHAT_API_KEY", "OPENAI_API_KEY"):
        v = os.environ.get(k)
        if v:
            return v.strip()
    if SECRETS.is_file():
        try:
            card = json.loads(SECRETS.read_text()).get("card") or {}
            v = card.get("BCS_CHAT_API_KEY") or card.get("OPENAI_API_KEY")
            if v:
                return str(v).strip()
        except Exception:
            pass
    return None


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def local_m_per_deg(lat: float) -> tuple[float, float]:
    m_lat = EARTH_M_PER_DEG_LAT
    m_lon = EARTH_M_PER_DEG_LAT * max(0.2, math.cos(math.radians(lat)))
    return m_lat, m_lon


def load_geojson(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def geom_from_feature(f, shapely_geom, shape):
    g = f.get("geometry")
    if not g:
        return None
    try:
        return shape(g)
    except Exception:
        return None


class SpatialIndex:
    """Lightweight spatial index over GeoJSON layers using Shapely STRtree."""

    def __init__(self):
        from shapely import STRtree
        from shapely.geometry import shape

        self.shape = shape
        self.STRtree = STRtree
        self.layers = {}

    def add_layer(self, key: str, path: Path, name_keys: list[str], extra_keys: list[str] | None = None):
        if not path.is_file():
            print(f"  skip missing {path.name}", flush=True)
            return
        gj = load_geojson(path)
        geoms = []
        meta = []
        for f in gj.get("features") or []:
            geom = geom_from_feature(f, None, self.shape)
            if geom is None or geom.is_empty:
                continue
            props = f.get("properties") or {}
            name = ""
            for k in name_keys:
                v = props.get(k)
                if v is not None and str(v).strip():
                    name = str(v).strip()
                    break
            extras = {}
            for k in (extra_keys or []):
                if k in props and props[k] not in (None, ""):
                    extras[k] = props[k]
            geoms.append(geom)
            meta.append({"name": name, "props": extras, "geom": geom})
        if not geoms:
            print(f"  empty {path.name}", flush=True)
            return
        tree = self.STRtree(geoms)
        self.layers[key] = {"tree": tree, "meta": meta, "geoms": geoms}
        print(f"  indexed {key}: {len(geoms)} features", flush=True)

    def nearest(self, key: str, pt, max_m: float, lat: float) -> dict | None:
        pack = self.layers.get(key)
        if not pack:
            return None
        m_lat, m_lon = local_m_per_deg(lat)
        # degree buffer approx
        buf_deg = max_m / min(m_lat, m_lon)
        # query candidates
        try:
            idxs = pack["tree"].query(pt.buffer(buf_deg))
        except Exception:
            idxs = list(range(len(pack["geoms"])))
        best = None
        best_d = None
        for i in idxs:
            m = pack["meta"][int(i)]
            g = m["geom"]
            # approximate planar distance in meters near point
            d_deg = pt.distance(g)
            # convert using average meters
            d_m = d_deg * ((m_lat + m_lon) / 2.0)
            if d_m > max_m:
                continue
            if best_d is None or d_m < best_d:
                best_d = d_m
                best = {"name": m["name"], "distance_m": round(d_m, 1), **m["props"]}
        return best

    def containing(self, key: str, pt) -> list[dict]:
        pack = self.layers.get(key)
        if not pack:
            return []
        out = []
        try:
            idxs = pack["tree"].query(pt)
        except Exception:
            idxs = list(range(len(pack["geoms"])))
        for i in idxs:
            m = pack["meta"][int(i)]
            try:
                if m["geom"].covers(pt) or m["geom"].contains(pt) or m["geom"].intersects(pt):
                    out.append({"name": m["name"], **m["props"]})
            except Exception:
                continue
        return out


def spatial_for_still(idx: SpatialIndex, lat: float, lon: float) -> dict:
    from shapely.geometry import Point

    pt = Point(lon, lat)
    spat = {
        "buffer_m": BUFFER_M,
        "nearest_highway": idx.nearest("highways", pt, BUFFER_M, lat),
        "nearest_waterway": idx.nearest("waterways", pt, BUFFER_M, lat),
        "nearest_town": idx.nearest("towns", pt, BUFFER_M * 2, lat),
        "nearest_settlement": idx.nearest("settlements", pt, BUFFER_M * 3, lat),
        "nearest_power": idx.nearest("power", pt, BUFFER_M * 2, lat),
        "nearest_beach": idx.nearest("beaches", pt, BUFFER_M * 2, lat),
        "coast_distance_m": None,
        "in_anp": idx.containing("anp", pt),
        "in_osm_protected": idx.containing("protected", pt),
        "in_uga": idx.containing("uga", pt),
        "in_ran": idx.containing("ran", pt),
        "in_rtp": idx.containing("rtp", pt),
    }
    coast = idx.nearest("coast", pt, 20000, lat)  # up to 20 km
    if coast:
        spat["coast_distance_m"] = coast.get("distance_m")
        spat["near_coast"] = coast["distance_m"] <= BUFFER_M * 2
    else:
        spat["near_coast"] = False
    spat["near_town"] = bool(
        (spat["nearest_town"] and spat["nearest_town"]["distance_m"] <= BUFFER_M)
        or (spat["nearest_settlement"] and spat["nearest_settlement"]["distance_m"] <= BUFFER_M)
    )
    spat["protected_any"] = bool(spat["in_anp"] or spat["in_osm_protected"] or spat["in_rtp"])
    return spat


def load_checkpoint() -> dict[str, dict]:
    done = {}
    if CHECKPOINT.is_file():
        for line in CHECKPOINT.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
                sid = row.get("id")
                if sid:
                    done[sid] = row
            except json.JSONDecodeError:
                continue
    return done


def append_checkpoint(row: dict):
    CACHE.mkdir(parents=True, exist_ok=True)
    with CHECKPOINT.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_progress(n_done, n_total, n_vision, n_spatial, status):
    CACHE.mkdir(parents=True, exist_ok=True)
    PROGRESS.write_text(
        json.dumps(
            {
                "updated": datetime.now(timezone.utc).isoformat(),
                "done": n_done,
                "total": n_total,
                "vision_ok": n_vision,
                "spatial_ok": n_spatial,
                "status": status,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def b64_image(path: Path) -> str | None:
    if not path.is_file():
        return None
    data = path.read_bytes()
    # skip huge
    if len(data) > 4_500_000:
        return None
    mime = "image/jpeg"
    if path.suffix.lower() == ".png":
        mime = "image/png"
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


def call_vision(client, model: str, image_data_url: str, still: dict) -> dict | None:
    context = (
        f"Place: {still.get('name')}; municipio: {still.get('municipio')}; "
        f"category: {still.get('category')}; theme: {still.get('theme')}; "
        f"lat={still.get('lat')}, lon={still.get('lon')}."
    )
    try:
        resp = client.chat.completions.create(
            model=model,
            temperature=0.1,
            max_tokens=450,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": VISION_PROMPT + "\n\n" + context},
                        {"type": "image_url", "image_url": {"url": image_data_url, "detail": "low"}},
                    ],
                }
            ],
        )
        text = (resp.choices[0].message.content or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:].strip()
        return json.loads(text)
    except Exception as e:
        return {"error": type(e).__name__, "message": str(e)[:200]}


def summarize_spatial_es(still, spat) -> str:
    parts = [f"Still {still.get('name')} ({still.get('municipio') or 'BCS'}), cat={still.get('category')}."]
    hw = spat.get("nearest_highway")
    if hw:
        parts.append(
            f"Carretera cercana: {hw.get('name') or hw.get('ref') or hw.get('highway')} "
            f"({hw.get('highway')}, a {hw.get('distance_m')} m)."
        )
    if spat.get("in_anp"):
        names = ", ".join(x.get("name") or x.get("NOMBRE") or "?" for x in spat["in_anp"][:3])
        parts.append(f"Dentro de ANP federal: {names}.")
    if spat.get("in_osm_protected"):
        names = ", ".join(x.get("name") or "?" for x in spat["in_osm_protected"][:3])
        parts.append(f"Área protegida OSM: {names}.")
    if spat.get("in_uga"):
        names = ", ".join(
            (x.get("name") or x.get("NOMBRE_UGA") or x.get("CLAVE_UGA") or "?") for x in spat["in_uga"][:2]
        )
        parts.append(f"UGA POER: {names}.")
    if spat.get("near_coast"):
        parts.append(f"Cerca de costa (~{spat.get('coast_distance_m')} m).")
    elif spat.get("coast_distance_m") is not None:
        parts.append(f"Distancia a costa ~{spat.get('coast_distance_m')} m.")
    tw = spat.get("nearest_town") or spat.get("nearest_settlement")
    if tw:
        parts.append(f"Asentamiento cercano: {tw.get('name')} a {tw.get('distance_m')} m.")
    ww = spat.get("nearest_waterway")
    if ww:
        parts.append(f"Cauce cercano: {ww.get('name') or ww.get('waterway')} a {ww.get('distance_m')} m.")
    return " ".join(parts)


def build_chat_chunks(records: list[dict]) -> list[dict]:
    """Per-still + per-municipio + per-corridor summaries for RAG."""
    chunks = []
    by_muni = defaultdict(list)
    by_cat = defaultdict(list)

    for r in records:
        still = r.get("still") or {}
        spat = r.get("spatial") or {}
        vision = r.get("vision") or {}
        sid = still.get("id") or r.get("id")
        name = still.get("name") or sid
        muni = still.get("municipio") or "Sin municipio"
        by_muni[muni].append(r)
        by_cat[still.get("category") or "other"].append(r)

        es = r.get("summary_es") or summarize_spatial_es(still, spat)
        en = r.get("summary_en") or es
        if vision and not vision.get("error"):
            if vision.get("notes_es"):
                es = es + " Visión: " + vision["notes_es"]
            if vision.get("notes_en"):
                en = en + " Vision: " + vision["notes_en"]
            es += (
                f" Cobertura={vision.get('land_cover')}; asentamiento={vision.get('settlement_density')};"
                f" turismo={vision.get('tourism_resort')}; costa_visible={vision.get('coast_visible')}."
            )
        chunks.append(
            {
                "id": f"still:{sid}",
                "title": f"Still territorial: {name}",
                "path": f"stills/{still.get('batch')}/{sid}",
                "theme": "territorio",
                "sum_es": es[:900],
                "sum_en": en[:900],
                "drive_url": None,
                "type": "still",
                "municipio": muni,
                "lat": still.get("lat"),
                "lon": still.get("lon"),
            }
        )

    for muni, rows in sorted(by_muni.items()):
        n = len(rows)
        n_coast = sum(1 for r in rows if (r.get("spatial") or {}).get("near_coast"))
        n_prot = sum(1 for r in rows if (r.get("spatial") or {}).get("protected_any"))
        n_town = sum(1 for r in rows if (r.get("spatial") or {}).get("near_town"))
        n_vis = sum(1 for r in rows if (r.get("vision") and not r["vision"].get("error")))
        covers = defaultdict(int)
        for r in rows:
            v = r.get("vision") or {}
            if v.get("land_cover"):
                covers[v["land_cover"]] += 1
        cover_txt = ", ".join(f"{k}:{v}" for k, v in sorted(covers.items(), key=lambda x: -x[1])[:5])
        body_es = (
            f"Stills Earth Studio en municipio {muni}: {n} fotogramas analizados. "
            f"Cerca de costa: {n_coast}. En/near área protegida: {n_prot}. "
            f"Cerca de asentamiento: {n_town}. Con visión IA: {n_vis}. "
            f"Coberturas vistas: {cover_txt or 'n/d'}. "
            f"Fuente: stills_intelligence (GIS OSM/ANP/POER + visión)."
        )
        body_en = (
            f"Earth Studio stills in municipality {muni}: {n} frames analyzed. "
            f"Near coast: {n_coast}. In/near protected: {n_prot}. "
            f"Near settlement: {n_town}. With AI vision: {n_vis}. "
            f"Land covers: {cover_txt or 'n/a'}."
        )
        chunks.append(
            {
                "id": f"stillmuni:{muni}",
                "title": f"Stills por municipio — {muni}",
                "path": f"stills/municipio/{muni}",
                "theme": "territorio",
                "sum_es": body_es[:900],
                "sum_en": body_en[:900],
                "drive_url": None,
                "type": "still_summary",
                "municipio": muni,
            }
        )

    # Corridor-ish: stills near primary/trunk/motorway
    corridor_rows = []
    for r in records:
        hw = (r.get("spatial") or {}).get("nearest_highway") or {}
        if hw.get("highway") in ("motorway", "trunk", "primary") and hw.get("distance_m", 99999) <= 2000:
            corridor_rows.append(r)
    if corridor_rows:
        refs = defaultdict(int)
        for r in corridor_rows:
            hw = r["spatial"]["nearest_highway"]
            label = hw.get("ref") or hw.get("name") or hw.get("highway")
            refs[str(label)] += 1
        top = ", ".join(f"{k} ({v})" for k, v in sorted(refs.items(), key=lambda x: -x[1])[:8])
        body = (
            f"Corredores carreteros (stills ≤2 km de motorway/trunk/primary): {len(corridor_rows)} fotogramas. "
            f"Refs/nombres: {top}. Útil para inteligencia territorial de conectividad BCS."
        )
        chunks.append(
            {
                "id": "still:corridors",
                "title": "Stills cerca de corredores carreteros BCS",
                "path": "stills/corridors",
                "theme": "conectividad",
                "sum_es": body[:900],
                "sum_en": body[:900],
                "drive_url": None,
                "type": "still_summary",
            }
        )

    # Statewide overview
    n = len(records)
    n_vis = sum(1 for r in records if r.get("vision") and not r["vision"].get("error"))
    body = (
        f"Estudio statewide de stills Earth Studio BCS: {n} puntos con cruce GIS "
        f"(carreteras, ANP, POER UGA, costa, asentamientos, cauces, energía). "
        f"Visión IA completada en {n_vis}/{n}. Consultar stills por municipio o lugar."
    )
    chunks.append(
        {
            "id": "still:overview",
            "title": "Inteligencia territorial — stills Earth Studio BCS",
            "path": "stills/intelligence/overview",
            "theme": "territorio",
            "sum_es": body,
            "sum_en": body.replace("Estudio statewide", "Statewide study").replace(
                "con cruce GIS", "with GIS join"
            ).replace("Visión IA completada en", "AI vision completed for").replace(
                "Consultar stills por municipio o lugar.",
                "Query stills by municipality or place.",
            ),
            "drive_url": None,
            "type": "still_summary",
        }
    )
    return chunks


def write_outputs(records: list[dict], vision_pending: bool):
    OUT_FULL.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "count": len(records),
        "vision_pending": vision_pending,
        "buffer_m": BUFFER_M,
        "records": records,
    }
    OUT_FULL.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    slim = []
    for r in records:
        still = r.get("still") or {}
        spat = r.get("spatial") or {}
        vision = r.get("vision") or {}
        slim.append(
            {
                "id": still.get("id"),
                "name": still.get("name"),
                "municipio": still.get("municipio"),
                "lat": still.get("lat"),
                "lon": still.get("lon"),
                "category": still.get("category"),
                "thumb": still.get("thumb"),
                "near_coast": spat.get("near_coast"),
                "protected_any": spat.get("protected_any"),
                "highway": (spat.get("nearest_highway") or {}).get("highway"),
                "highway_name": (spat.get("nearest_highway") or {}).get("name")
                or (spat.get("nearest_highway") or {}).get("ref"),
                "land_cover": vision.get("land_cover") if vision and not vision.get("error") else None,
                "summary_es": (r.get("summary_es") or "")[:280],
            }
        )
    OUT_SLIM.write_text(json.dumps(slim, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    chunks = build_chat_chunks(records)
    OUT_CHAT.write_text(json.dumps(chunks, ensure_ascii=False, indent=2), encoding="utf-8")

    # Report
    n_vis = sum(1 for r in records if r.get("vision") and not r["vision"].get("error"))
    samples = []
    for r in records[:5]:
        samples.append(f"- **{r['still'].get('name')}** ({r['still'].get('municipio')}): {r.get('summary_es','')[:220]}")
    # pick a few interesting
    for r in records:
        if (r.get("spatial") or {}).get("in_anp") and len(samples) < 10:
            samples.append(
                f"- ANP: **{r['still'].get('name')}** — {r.get('summary_es','')[:200]}"
            )

    report = f"""# Stills Intelligence Report

Generated: {payload['generated']} (UTC)

## Method
1. Load `{STILLS_JSON.name}` ({len(records)} stills with images).
2. Spatial join vs GIS under `public/gis/` within ~{BUFFER_M:.0f} m (coast up to 20 km):
   highways, waterways, ANP federales, OSM protected, POER UGAs, RAN, RTP, towns/settlements, coastline, beaches, power.
3. Vision (optional): OpenAI vision on thumbnails when `BCS_CHAT_API_KEY` is available; resume via JSONL checkpoint.
4. Chat knowledge: per-still + per-municipio + corridor chunks → `public/chat_stills_knowledge.json`, merged into chat corpus.

## Counts
- Spatial analyzed: **{len(records)}**
- Vision OK: **{n_vis}**
- Vision pending: **{vision_pending}**
- Chat chunks: **{len(chunks)}**

## Sample findings
{chr(10).join(samples[:12])}

## Outputs
- `{OUT_FULL.relative_to(ROOT)}`
- `{OUT_SLIM.relative_to(ROOT)}`
- `{OUT_CHAT.relative_to(ROOT)}`
- Checkpoint: `{CHECKPOINT.relative_to(ROOT)}`
- Progress: `{PROGRESS.relative_to(ROOT)}`

## Chatbot
Rebuild corpus with `python3 scripts/build_chat_corpus.py` (includes stills knowledge) and redeploy Netlify functions.
"""
    OUT_REPORT.write_text(report, encoding="utf-8")
    return chunks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-vision", action="store_true", help="Skip vision API even if key present")
    ap.add_argument("--limit", type=int, default=0, help="Process at most N stills (0=all)")
    ap.add_argument("--vision-limit", type=int, default=0, help="Max vision calls this run (0=all pending)")
    ap.add_argument("--checkpoint-every", type=int, default=25)
    ap.add_argument("--model", default="gpt-4o-mini")
    ap.add_argument("--sleep", type=float, default=0.15, help="Delay between vision calls")
    ap.add_argument("--spatial-only-refresh", action="store_true", help="Recompute spatial for all, keep vision")
    args = ap.parse_args()

    stills = json.loads(STILLS_JSON.read_text(encoding="utf-8"))
    stills = [s for s in stills if s and s.get("lat") is not None and s.get("lon") is not None]
    if args.limit:
        stills = stills[: args.limit]
    print(f"stills to process: {len(stills)}", flush=True)

    print("Building spatial indexes…", flush=True)
    idx = SpatialIndex()
    idx.add_layer("highways", GIS / "osm_highways.geojson", ["name", "ref"], ["highway", "ref"])
    idx.add_layer("waterways", GIS / "osm_waterways.geojson", ["name"], ["waterway"])
    idx.add_layer("towns", GIS / "osm_towns.geojson", ["name"], ["place", "population"])
    idx.add_layer("settlements", GIS / "settlements.geojson", ["name"], ["municipio", "tier", "pobtot"])
    idx.add_layer("power", GIS / "osm_power_lines.geojson", ["name", "operator"], ["power", "voltage"])
    idx.add_layer("beaches", GIS / "osm_beaches.geojson", ["name"], [])
    idx.add_layer("coast", GIS / "osm_coastline.geojson", ["name"], [])
    idx.add_layer("anp", GIS / "anp_federales.geojson", ["NOMBRE"], ["CAT_MANEJO", "NOMBRE"])
    idx.add_layer("protected", GIS / "osm_protected.geojson", ["name"], ["protect_class"])
    idx.add_layer("uga", GIS / "poer_ugas.geojson", ["NOMBRE_UGA", "CLAVE_UGA"], ["CLAVE_UGA", "CLASIFICAC", "UGA_MUN"])
    idx.add_layer("ran", GIS / "ran_nucleos.geojson", ["NOM_NUC", "Name", "name"], [])
    idx.add_layer("rtp", GIS / "rtp_conabio.geojson", ["NOMBRE", "Name", "name"], [])

    done = load_checkpoint()
    print(f"checkpoint rows: {len(done)}", flush=True)

    api_key = None if args.no_vision else load_api_key()
    client = None
    if api_key:
        try:
            from openai import OpenAI

            client = OpenAI(api_key=api_key)
            print(f"vision enabled model={args.model}", flush=True)
        except Exception as e:
            print(f"vision client unavailable: {type(e).__name__}", flush=True)
            client = None
    else:
        print("vision pending (no API key or --no-vision)", flush=True)

    records_by_id = {}
    # seed from checkpoint
    for sid, row in done.items():
        records_by_id[sid] = row

    n_spatial = 0
    n_vision = 0
    vision_calls = 0
    total = len(stills)

    for i, still in enumerate(stills):
        sid = still["id"]
        existing = records_by_id.get(sid)

        need_spatial = (
            existing is None
            or args.spatial_only_refresh
            or not existing.get("spatial")
        )
        if need_spatial:
            spat = spatial_for_still(idx, float(still["lat"]), float(still["lon"]))
            n_spatial += 1
        else:
            spat = existing["spatial"]

        vision = (existing or {}).get("vision")
        vision_status = (existing or {}).get("vision_status") or ("ok" if vision and not vision.get("error") else "pending")

        if client and vision_status != "ok":
            if args.vision_limit and vision_calls >= args.vision_limit:
                pass
            else:
                thumb = still.get("thumb") or ""
                img_path = ROOT / "public" / thumb.lstrip("/")
                if not img_path.is_file():
                    # try full
                    full = still.get("image") or ""
                    img_path = ROOT / "public" / full.lstrip("/")
                data_url = b64_image(img_path)
                if data_url:
                    vision = call_vision(client, args.model, data_url, still)
                    vision_calls += 1
                    if vision and not vision.get("error"):
                        vision_status = "ok"
                        n_vision += 1
                    else:
                        vision_status = "error"
                    time.sleep(args.sleep)
                else:
                    vision_status = "missing_image"

        summary_es = summarize_spatial_es(still, spat)
        summary_en = summary_es  # spatial text is ES-first; chat builder adds vision EN
        if vision and not vision.get("error"):
            if vision.get("notes_es"):
                summary_es = summary_es + " " + vision["notes_es"]
            if vision.get("notes_en"):
                summary_en = summary_es if not vision.get("notes_en") else (
                    summarize_spatial_es(still, spat) + " " + vision["notes_en"]
                )

        row = {
            "id": sid,
            "still": {
                "id": sid,
                "name": still.get("name"),
                "municipio": still.get("municipio"),
                "lat": still.get("lat"),
                "lon": still.get("lon"),
                "category": still.get("category"),
                "theme": still.get("theme"),
                "batch": still.get("batch"),
                "thumb": still.get("thumb"),
                "image": still.get("image"),
            },
            "spatial": spat,
            "vision": vision,
            "vision_status": vision_status,
            "summary_es": summary_es,
            "summary_en": summary_en,
            "updated": datetime.now(timezone.utc).isoformat(),
        }
        records_by_id[sid] = row

        # Always rewrite checkpoint line by appending (resume reads last wins)
        if need_spatial or (vision_status in ("ok", "error", "missing_image") and (
            existing is None or existing.get("vision_status") != vision_status or need_spatial
        )):
            append_checkpoint(row)

        if (i + 1) % args.checkpoint_every == 0 or (i + 1) == total:
            write_progress(i + 1, total, n_vision, n_spatial, "running")
            print(
                f"  [{i+1}/{total}] spatial_new={n_spatial} vision_new={n_vision} vision_calls={vision_calls}",
                flush=True,
            )

    # Ordered records for this stills list
    records = [records_by_id[s["id"]] for s in stills if s["id"] in records_by_id]
    vision_pending = any(r.get("vision_status") != "ok" for r in records)
    chunks = write_outputs(records, vision_pending=vision_pending)
    write_progress(len(records), total, sum(1 for r in records if r.get("vision_status") == "ok"), n_spatial, "complete")
    print(
        f"DONE records={len(records)} vision_ok={sum(1 for r in records if r.get('vision_status')=='ok')} "
        f"chat_chunks={len(chunks)} pending_vision={vision_pending}",
        flush=True,
    )


if __name__ == "__main__":
    main()
