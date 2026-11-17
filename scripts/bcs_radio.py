#!/usr/bin/env python3
"""Radio BCS2050 — builds today's edition: 3 rotating ~10-minute topic deep dives, each in ES + EN, as static MP3 chapters.

    python3 scripts/bcs_radio.py                 # today's edition (script + audio), both languages
    python3 scripts/bcs_radio.py --topics 4               # more deep dives today
    python3 scripts/bcs_radio.py --topic agua --topic crimen --force
    python3 scripts/bcs_radio.py --script-only   # write the scripts, skip TTS
    python3 scripts/bcs_radio.py --force         # rebuild an edition that already exists

Content comes ONLY from portal data: news.json (with outlet names), Tendencia 2050
(foresights_vision.json), Visión (foresights_ideal.json), Foresight (foresights.json), the
document library (library.json), the ontology (ontology_factors.json) and, optionally, public
video titles from the 'Expres de Unic' YouTube channel. Themes rotate using public/radio/history.json
so editions do not repeat; new news items are always preferred.

Writing: Grok (chat completions) with a strict no-invention rule + a numeric fact guard.
Voices: Grok text-to-speech (POST https://api.x.ai/v1/tts), host 'rex', co-host 'eve'.
Music: short stingers cut from CC0 / public-domain / CC BY recordings (credits in
public/radio/credits.json and RADIO_MUSIC_CREDITS.md). XAI_API_KEY is read server-side only.

Output: public/radio/editions/<date>/<topic>/{es,en}/NN.mp3 + script.json, edition.json, public/radio/latest.json,
public/radio/archive.json (all editions' scripts kept; MP3s kept for the last KEEP_AUDIO editions).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"
OUT = ROOT / "public" / "radio"
CACHE = ROOT / "scripts" / "_cache" / "radio"
MUSIC_SRC = ROOT / "scripts" / "_cache" / "radio_music_src"
KEEP_AUDIO = 14  # editions (days) whose MP3s stay on the site = the 24/7 rotation; scripts are kept forever
MODEL = os.environ.get("BCS_RADIO_MODEL", "grok-4.3")
VOICES = {"host": "rex", "cohost": "eve"}
NAMES = {"host": "Tomás", "cohost": "Luz"}
UA = "BCS2050Radio/1.0 (bajacaliforniasur2050.com)"

THEMES = {
    "urbanismo": ("Urbanismo", "Urbanism", r"urban|ciudad|city|implan|pdu|vivienda|housing|densidad|density|plan de desarrollo urbano|zonific|zoning|land_use|uso de suelo"),
    "desarrollo": ("Desarrollo", "Development", r"desarroll|develop|proyecto|project|inversi|investment|masterplan|plan maestro"),
    "medio_ambiente": ("Medio ambiente", "Environment", r"environment|ambient|ecolog|reserva|protected|área natural|anp|manglar|mangrove|ballena|whale|tortuga|turtle|coral|el niño|erosi|semarnat|conanp|profepa|clima|climate|hurac|hurricane"),
    "agua": ("Agua", "Water", r"water|agua|acuífer|aquifer|desalin|oomsapas|conagua|cea|huachicol|drenaje|sanea"),
    "social": ("Social", "Society", r"social|comunidad|community|salud|health|educa|school|escuela|pobreza|poverty|migra|trabajador|worker|mujer|women|cultura|culture"),
    "infraestructura": ("Infraestructura", "Infrastructure", r"infraestruct|infrastructure|energ|electric|cfe|planta|plant|carretera|highway|obra|works|puente|bridge|energy"),
    "turismo": ("Turismo", "Tourism", r"touris|turis|hotel|crucer|cruise|visitant|visitor|ocupaci|occupancy|fitur|tourism"),
    "conectividad": ("Conectividad", "Connectivity", r"aeropuert|airport|vuelo|flight|aerol|airline|ruta|route|conectiv|connectiv|internet|puerto|port|ferry"),
    "transporte": ("Transporte", "Transport", r"transport|movilidad|mobility|tráfico|traffic|camión|bus|transpeninsular|vialidad|road|taxi|uber"),
    "economia": ("Economía", "Economy", r"econom|empleo|employment|jobs|pib|gdp|comercio|trade|empresa|business|inmobiliar|real estate|pesca|fishing|minería|mining"),
    "finanzas": ("Finanzas", "Finance", r"finanz|financ|presupuest|budget|ingresos|revenue|deuda|debt|impuest|tax|predial|ley de ingresos|paquete económico"),
    "crimen": ("Seguridad", "Security", r"crimen|crime|delito|seguridad|security|homicid|robo|theft|violen|polic|fiscal[ií]a|guardia nacional|narco"),
    "politica": ("Política", "Politics", r"polític|politic|congreso|congress|cabildo|council|gobernador|governor|alcald|mayor|elecci|election|ley |law|informe|reform"),
}


# ------------------------------------------------------------------ helpers
def load(p: Path, default=None):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def dump(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(p)


def norm(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def clip(s: str, n: int) -> str:
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[: n - 1].rsplit(" ", 1)[0] + "…"


def key() -> str:
    k = os.environ.get("XAI_API_KEY", "")
    if not k:
        sys.exit("bcs_radio: XAI_API_KEY is not set (server-side env only)")
    return k


def http_json(url: str, payload: dict, timeout=240) -> dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={
        "Authorization": f"Bearer {key()}", "Content-Type": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as e:  # 429/5xx/timeouts: back off
            if attempt == 3:
                raise
            print(f"  retry {attempt+1}: {e}")
            time.sleep(4 * (attempt + 1))
    return {}


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def duration(p: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                         capture_output=True, text=True).stdout.strip()
    return round(float(out or 0), 2)


# ------------------------------------------------------------------ music (licensed only)
MUSIC = [
    {"id": "romanza", "file": "romanza_espanola.src", "start": 2, "len": 16,
     "title": "Romanza española", "artist": "Composer unknown; courtesy of Alias Guitar",
     "license": "CC0 1.0", "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
     "source": "https://commons.wikimedia.org/wiki/File:Romanza_espa%C3%B1ola.ogg",
     "url": "https://upload.wikimedia.org/wikipedia/commons/8/89/Romanza_espa%C3%B1ola.ogg"},
    {"id": "romance", "file": "romance_anonimo.src", "start": 0, "len": 15,
     "title": "Romance Anónimo (Jeux interdits)", "artist": "Composer unknown; performed by Jim Greeninger",
     "license": "CC0 1.0", "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
     "source": "https://commons.wikimedia.org/wiki/File:Romance_An%C3%B3nimo_(Jeux_interdits).ogg",
     "url": "https://upload.wikimedia.org/wikipedia/commons/3/33/Romance_An%C3%B3nimo_%28Jeux_interdits%29.ogg"},
    {"id": "cielito", "file": "cielito_lindo.src", "start": 6, "len": 14,
     "title": "Cielito lindo (Quirino Mendoza y Cortés)", "artist": "Synth rendition by Pracchia-78",
     "license": "Public domain", "license_url": "https://commons.wikimedia.org/wiki/File:Anonimo_-_Cielito_lindo.ogg",
     "source": "https://commons.wikimedia.org/wiki/File:Anonimo_-_Cielito_lindo.ogg",
     "url": "https://upload.wikimedia.org/wikipedia/commons/d/d4/Anonimo_-_Cielito_lindo.ogg"},
    {"id": "horizon", "file": "port_horizon.src", "start": 20, "len": 16,
     "title": "Port Horizon", "artist": "Kevin MacLeod (incompetech.com)",
     "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/",
     "source": "https://commons.wikimedia.org/wiki/File:Port_Horizon_(ISRC_USUAN1700015).mp3",
     "url": "https://upload.wikimedia.org/wikipedia/commons/b/bc/Port_Horizon_%28ISRC_USUAN1700015%29.mp3"},
    {"id": "bossa", "file": "bossa_antigua.src", "start": 4, "len": 16,
     "title": "Bossa Antigua", "artist": "Kevin MacLeod (incompetech.com)",
     "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/",
     "source": "https://commons.wikimedia.org/wiki/File:Bossa_Antigua_(ISRC_USUAN1700069).mp3",
     "url": "https://upload.wikimedia.org/wikipedia/commons/6/60/Bossa_Antigua_%28ISRC_USUAN1700069%29.mp3"},
    {"id": "beachbum", "file": "beach_bum.src", "start": 2, "len": 14,
     "title": "Beach Bum", "artist": "Kevin MacLeod (incompetech.com)",
     "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/",
     "source": "https://commons.wikimedia.org/wiki/File:Beach_Bum_(ISRC_USUAN1100347).mp3",
     "url": "https://upload.wikimedia.org/wikipedia/commons/e/e1/Beach_Bum_%28ISRC_USUAN1100347%29.mp3"},
    {"id": "surf", "file": "surf_shimmy.src", "start": 0, "len": 14,
     "title": "Surf Shimmy", "artist": "Kevin MacLeod (incompetech.com)",
     "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/",
     "source": "https://commons.wikimedia.org/wiki/File:Surf_Shimmy_(ISRC_USUAN1700018).mp3",
     "url": "https://upload.wikimedia.org/wikipedia/commons/c/c3/Surf_Shimmy_%28ISRC_USUAN1700018%29.mp3"},
    {"id": "waves", "file": "pebble_beach.src", "start": 0, "len": 38, "bed": True,
     "title": "On a pebble beach (waves)", "artist": "earthcalling",
     "license": "Public domain", "license_url": "https://commons.wikimedia.org/wiki/File:On_a_pebble_beach.ogg",
     "source": "https://commons.wikimedia.org/wiki/File:On_a_pebble_beach.ogg",
     "url": "https://upload.wikimedia.org/wikipedia/commons/7/73/On_a_pebble_beach.ogg"},
]


def build_music() -> dict:
    mdir = OUT / "music"
    mdir.mkdir(parents=True, exist_ok=True)
    MUSIC_SRC.mkdir(parents=True, exist_ok=True)
    for m in MUSIC:
        src = MUSIC_SRC / m["file"]
        dst = mdir / f"{m['id']}.mp3"
        if not dst.exists() and not src.exists():  # stingers are committed; sources only needed to re-cut them
            subprocess.run(["curl", "-sf", "-A", UA, "-o", str(src), m["url"]], timeout=180)
            time.sleep(3)  # be gentle with Wikimedia (429s)
        if not dst.exists() and src.exists():
            L = m["len"]
            af = f"afade=t=in:d={1.5 if m.get('bed') else 0.8},afade=t=out:st={L-3}:d=3,loudnorm=I={-26 if m.get('bed') else -19}:TP=-2"
            ffmpeg("-ss", str(m["start"]), "-t", str(L), "-i", str(src), "-af", af, "-ac", "2", "-ar", "44100",
                   "-c:a", "libmp3lame", "-b:a", "96k", str(dst))
        for kind, L, fo in (("short", 7, 2.5), ("break", 30, 4)):  # chapter transition / ~30 s music break
            out = mdir / f"{kind}_{m['id']}.mp3"
            if not m.get("bed") and not out.exists() and src.exists():
                ffmpeg("-ss", str(m["start"] + (0 if kind == "short" else 3)), "-t", str(L), "-i", str(src), "-af",
                       f"afade=t=in:d=0.6,afade=t=out:st={L-fo}:d={fo},loudnorm=I=-19:TP=-2", "-ac", "2", "-ar", "44100",
                       "-c:a", "libmp3lame", "-b:a", "96k", str(out))
        bed = mdir / f"bed_{m['id']}.mp3"
        if not m.get("bed") and not bed.exists() and src.exists():  # 45 s soft bed for under the opening voice
            ffmpeg("-ss", str(m["start"]), "-t", "45", "-i", str(src), "-af",
                   "afade=t=in:d=2,afade=t=out:st=41:d=4,loudnorm=I=-24:TP=-3", "-ac", "2", "-ar", "44100",
                   "-c:a", "libmp3lame", "-b:a", "80k", str(bed))
    credits = [{k: m[k] for k in ("id", "title", "artist", "license", "license_url", "source")} for m in MUSIC]
    dump(OUT / "credits.json", {"note": "Only CC0, public-domain or CC BY recordings; short excerpts (stingers and soft beds) with fades.",
                                "music": credits,
                                "voices": "Grok text-to-speech (xAI): voices 'rex' (host) and 'eve' (co-host)."})
    md = ["# Radio BCS2050 — music credits", "",
          "Only CC0, public-domain or CC BY recordings are used, as short excerpts (14–38 s) with fades.", "",
          "| Track | Artist | License | Source |", "|---|---|---|---|"]
    md += [f"| {m['title']} | {m['artist']} | [{m['license']}]({m['license_url']}) | {m['source']} |" for m in MUSIC]
    (ROOT / "RADIO_MUSIC_CREDITS.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    return {m["id"]: f"/radio/music/{m['id']}.mp3" for m in MUSIC}


# ------------------------------------------------------------------ topics
# Each theme: Visión pillar it maps to, its signature music (bed under the opening) and its stingers.
TOPIC = {
    "urbanismo": ("vivienda", "horizon", ["romanza", "bossa", "romance"]),
    "desarrollo": ("vivienda", "romanza", ["horizon", "surf", "romance"]),
    "medio_ambiente": ("costa_clima", "romance", ["romanza", "horizon", "cielito"]),
    "agua": ("agua", "romanza", ["romance", "horizon", "bossa"]),
    "social": ("gobernanza", "cielito", ["romanza", "bossa", "romance"]),
    "infraestructura": ("energia", "horizon", ["surf", "bossa", "romanza"]),
    "turismo": ("turismo", "beachbum", ["surf", "bossa", "cielito"]),
    "conectividad": ("movilidad", "surf", ["horizon", "beachbum", "bossa"]),
    "transporte": ("movilidad", "surf", ["beachbum", "horizon", "romanza"]),
    "economia": ("economia", "bossa", ["cielito", "surf", "romance"]),
    "finanzas": ("economia", "bossa", ["romanza", "horizon", "cielito"]),
    "crimen": ("gobernanza", "romance", ["horizon", "romanza", "bossa"]),
    "politica": ("gobernanza", "cielito", ["bossa", "romance", "horizon"]),
}
# Fixed chapter plan of every deep dive (titles come from here, never from the model).
CHAPTERS = [
    ("entrada", "Entrada", "Cold open", 120),
    ("acto1", "Acto 1 · Lo que está pasando", "Act 1 · What's happening", 300),
    ("acto2", "Acto 2 · El hilo oculto", "Act 2 · The hidden thread", 280),
    ("sabias", "¿Sabías que…?", "Did you know?", 210),
    ("acto3", "Acto 3 · Hacia 2050", "Act 3 · Toward 2050", 260),
    ("cierre", "Para llevar", "The takeaway", 120),
]


# ------------------------------------------------------------------ sources
def theme_of(text: str) -> list[str]:
    t = norm(text)
    return [k for k, (_, _, rx) in THEMES.items() if re.search(norm(rx), t)]


def matches(theme: str, text: str) -> bool:
    return bool(re.search(norm(THEMES[theme][2]), norm(text)))


def expres_de_unic() -> list[dict]:
    """Public video titles from the Expres de Unic channel (fact source only). Optional, cached daily."""
    cache = CACHE / "expres_de_unic.json"
    cached = load(cache, None)
    if cached and cached.get("date") == date.today().isoformat():
        return cached["items"]
    items = []
    try:
        r = subprocess.run(["yt-dlp", "--flat-playlist", "--playlist-end", "20", "-J",
                            "https://www.youtube.com/@Expresdeunic/videos"], capture_output=True, text=True, timeout=90)
        for e in (json.loads(r.stdout).get("entries") or []):
            if e.get("title"):
                items.append({"id": f"edu-{e['id']}", "outlet": "Expres de Unic",
                              "url": f"https://www.youtube.com/watch?v={e['id']}", "title": e["title"]})
    except Exception as ex:
        print(f"  Expres de Unic skipped: {ex}")
    dump(cache, {"date": date.today().isoformat(), "items": items})
    return items


def all_news() -> list[dict]:
    items = []
    for f in ("news.json", "news_archive.json"):
        items += (load(DATA / f, {"items": []}) or {}).get("items", [])
    items = [n for n in items if n.get("url") and not n.get("_needs_review") and (n.get("blurb_es") or n.get("blurb_en"))]
    return sorted(items, key=lambda n: n.get("date", ""), reverse=True)


def news_text(n: dict) -> str:
    return " ".join([n.get("title_es", ""), n.get("title_en", ""), n.get("blurb_es", "")[:500], " ".join(n.get("topics") or [])])


def pick_topics(today: str, hist: dict, n: int, news: list[dict]) -> list[str]:
    used, last = set(hist.get("used", [])), hist.get("theme_last", {})
    fresh = {k: sum(1 for x in news[:150] if x["id"] not in used and matches(k, news_text(x))) for k in THEMES}
    order = sorted(THEMES, key=lambda k: (last.get(k, ""), hashlib.md5((today + k).encode()).hexdigest()))
    out = [k for k in order if fresh[k] >= 2][:n]
    return out + [k for k in order if k not in out][: n - len(out)]


def topic_pack(theme: str, hist: dict, news: list[dict], edu: list[dict]) -> dict:
    """Everything the portal knows about one theme, split by chapter."""
    used = set(hist.get("used", []))
    mine = [x for x in news if matches(theme, news_text(x))]
    fresh = [x for x in mine if x["id"] not in used]
    now = (fresh or mine)[:4]
    older = [x for x in mine if x not in now][:9]

    def item(x, n=650):
        return {"id": x["id"], "outlet": x.get("source", ""), "date": x.get("date", ""), "url": x["url"],
                "title_es": x.get("title_es", ""), "title_en": x.get("title_en", ""),
                "facts_es": clip(x.get("blurb_es", ""), n), "facts_en": clip(x.get("blurb_en", ""), n)}

    v = load(DATA / "foresights_vision.json", {}) or {}
    i = load(DATA / "foresights_ideal.json", {}) or {}
    f = load(DATA / "foresights.json", {}) or {}
    pillar_id = TOPIC[theme][0]
    pil = next((p for p in i.get("pillars", []) if p.get("id") == pillar_id), {})
    claims = [c for c in v.get("claims", []) if matches(theme, c.get("es", "") + " " + c.get("en", ""))][:6] or v.get("claims", [])[:3]
    sigs = [x for x in (f.get("signals") or []) if matches(theme, json.dumps(x, ensure_ascii=False))][:3]
    watch = [w for w in (f.get("watchlist") or []) if matches(theme, w.get("item_es", "") + w.get("item_en", ""))][:4]
    facts = [x for x in (load(DATA / "portal_facts.json", {}) or {}).get("facts", [])
             if matches(theme, " ".join(str(x.get(k, "")) for k in ("metric", "theme", "source")))][:12]
    lib = [x for x in (load(DATA / "library.json", {}) or {}).get("items", [])
           if x.get("relevance") and x.get("id") not in used and matches(theme, " ".join([x.get("title", ""), x.get("relevance", ""), " ".join(x.get("tags") or []), x.get("topic_es", "")]))][:3]
    nodes = [x for x in (load(DATA / "ontology_factors.json", {}) or {}).get("nodes", [])
             if x.get("summary") and matches(theme, x.get("label", "") + " " + x.get("summary", ""))][:3]
    eds = [e for e in edu if matches(theme, e["title"])][:2]
    data = {
        "tendencia_claims": [{"es": c.get("es"), "en": c.get("en"), "source": ", ".join(c.get("sources") or [])} for c in claims],
        "foresight_signals": [{"es": clip(s.get("title_es", "") + ". " + s.get("why_es", ""), 600),
                               "en": clip(s.get("title_en", "") + ". " + s.get("why_en", ""), 600)} for s in sigs],
        "portal_facts": [{"metric": x.get("metric"), "value": x.get("value"), "unit": x.get("unit"), "year": x.get("year"),
                          "source": x.get("source")} for x in facts],
        "library": [{"id": x["id"], "title": x["title"], "org": x.get("org"), "year": x.get("year"),
                     "why": clip(x.get("relevance", ""), 260), "url": x.get("url", "")} for x in lib],
        "ontology": [{"id": x["id"], "label": x.get("label"), "summary": clip(x.get("summary", ""), 360)} for x in nodes],
    }
    vision = {"pillar": {k: pil.get(k) for k in ("label_es", "label_en", "risk_es", "risk_en", "aspiration_es",
                                                 "aspiration_en", "levers_es", "levers_en")},
              "tendencia_kicker": {"es": clip(v.get("narrative_es", ""), 700), "en": clip(v.get("narrative_en", ""), 700)},
              "conditions": {"es": (i.get("conditions_es") or [])[:4], "en": (i.get("conditions_en") or [])[:4]},
              "watchlist": [{"es": w.get("item_es"), "en": w.get("item_en")} for w in watch]}
    rot = int(hashlib.md5((date.today().isoformat() + theme).encode()).hexdigest(), 16)
    gnodes = [x for x in (load(DATA / "graph.json", {}) or {}).get("nodes", []) if x.get("summary") and x.get("id") not in used
              and matches(theme, " ".join([x.get("label", ""), x.get("summary", ""), x.get("summary_en", "")]))]
    graph = [{"id": x["id"], "es": f"{x.get('label','')}: {clip(x.get('summary',''), 300)}",
              "en": f"{x.get('label_en') or x.get('label','')}: {clip(x.get('summary_en') or x.get('summary',''), 300)}"}
             for x in (gnodes[rot % len(gnodes):] + gnodes[:rot % len(gnodes)])[:4]] if gnodes else []
    fs_arch = []
    for fp in sorted((DATA / "foresights_editions").glob("*.json")):
        e = load(fp, {}) or {}
        sig = [x for x in (e.get("signals") or []) if isinstance(x, dict) and matches(theme, json.dumps(x, ensure_ascii=False))]
        txt_es = " ".join([e.get("headline_es", "")] + [x.get("title_es", "") for x in sig[:2]])
        if matches(theme, txt_es):
            fs_arch.append({"es": f"{fp.stem}: {clip(txt_es, 400)}",
                            "en": f"{fp.stem}: {clip(' '.join([e.get('headline_en', '')] + [x.get('title_en', '') for x in sig[:2]]), 400)}"})
    places = [clip(json.dumps({k: v for k, v in pl.items() if k not in ("geometry", "coords", "bbox", "center")}, ensure_ascii=False), 900)
              for pl in (load(DATA / "place_dossiers.json", {}) or {}).get("places", []) if matches(theme, json.dumps(pl, ensure_ascii=False))]
    places = (places[rot % len(places):] + places[:rot % len(places)])[:2] if places else []
    municipios = {}
    if theme in ("economia", "finanzas", "social", "politica", "urbanismo", "desarrollo", "crimen"):
        municipios = {k: {kk: vv for kk, vv in v.items() if not isinstance(vv, (list, dict))}
                      for k, v in (load(DATA / "municipios.json", {}) or {}).items() if isinstance(v, dict)}
    tourism = []
    if theme in ("turismo", "desarrollo", "economia"):
        hotels = (load(DATA / "tourism_detail.json", {}) or {}).get("hotels", [])
        tourism = [{k: h.get(k) for k in ("name", "municipio", "locality", "brand_operator", "notes") if h.get(k)}
                   for h in (hotels[rot % max(1, len(hotels)):] + hotels[:rot % max(1, len(hotels))])[:5]]
    return {"theme": theme, "graph": graph, "fs_archive": fs_arch[-5:], "places": places, "municipios": municipios,
            "tourism": tourism, "now": [item(x) for x in now], "older": [item(x, 380) for x in older],
            "data": data, "vision": vision, "expres_de_unic": eds,
            "ids": [x["id"] for x in now] + [x["id"] for x in lib] + [e["id"] for e in eds] + [g["id"] for g in graph]}


def chapter_sources(pack: dict, ch: str, L: str) -> dict:
    tl = lambda x: {k[:-3]: v for k, v in x.items() if not k.endswith("_es" if L == "en" else "_en")}
    headlines = [x[f"title_{L}"] or x["title_es"] for x in pack["now"] + pack["older"][:4]]
    if ch == "entrada":
        n0 = pack["now"][:2]
        return {"topic_headlines": headlines, "hook_material": [tl(x) for x in n0],
                "one_portal_fact": (pack["data"]["portal_facts"] or [None])[0]}
    if ch == "cierre":
        return {"topic_headlines": headlines, "aspiration": pack["vision"]["pillar"].get(f"aspiration_{L}")}
    if ch == "acto1":
        return {"latest_news": [tl(x) for x in pack["now"]]}
    if ch == "acto2":
        return {"earlier_news": [tl(x) for x in pack["older"]], "foresight_archive": [x[L] for x in pack["fs_archive"]],
                "knowledge_graph": [g[L] for g in pack["graph"]], "expres_de_unic_video_titles": pack["expres_de_unic"]}
    if ch == "sabias":
        d = pack["data"]
        return {"tendencia_claims": [{"text": c[L], "source": c["source"]} for c in d["tendencia_claims"]],
                "foresight_signals": [s[L] for s in d["foresight_signals"]], "portal_facts": d["portal_facts"],
                "library_documents": d["library"], "ontology": d["ontology"], "places": pack["places"],
                "municipalities": pack["municipios"], "tourism_inventory": pack["tourism"]}
    vv = pack["vision"]
    return {"vision_pillar": {k[:-3]: v for k, v in vv["pillar"].items() if v and k.endswith("_" + L)},
            "tendencia_2050": vv["tendencia_kicker"][L], "conditions": vv["conditions"][L],
            "watchlist": [w[L] for w in vv["watchlist"]]}


# ------------------------------------------------------------------ writing
STYLE = """You write one chapter of 'Radio BCS2050', a deep-dive radio show about Baja California Sur (Mexico) on its
way to 2050. Today's episode is a ~10 minute deep dive on ONE topic: {topic}.
Spirit: Rick Rubin in a Malibu studio, with a California soul: relaxed, sunny, open, Pacific-facing,
laid-back but smart, surf-and-desert light. Calm, minimal, curious, unhurried, reductive. The host listens more
than he talks, asks simple deep questions, strips each story to its essence. Warm, a little playful (a gentle joke,
an image of the sea, the desert, the light, the swell, the long road south), never preachy, no jargon, no hype.
TONE: an unhurried, intimate, reflective long-form conversation between two people who love this place — the kind
a great music producer has with an architect about craft, nature and design. Depth over speed. Open philosophical
questions about place, craft, nature, time and design ("What does the desert teach a city?", "What is a road for?").
Leave space: short sentences, let a thought land before the next one; occasionally a single word or a quiet "Mm." turn.
Calm and warm delivery, never hyped, never a radio DJ voice.
Two voices: HOST {host} (deep, slow, reflective) and CO-HOST {cohost} (warm, curious, brings the facts gently).
They really talk: react to each other, riff, follow up, sometimes she asks him and he answers slowly.
Short sentences. Natural spoken {lang} only — never mix languages inside a sentence.

CRAFT (learned from the best American public-radio storytelling; never name or imitate any show on air):
- Story in acts with a character or a human angle (a neighbour, a fisher, a worker, an official — only if in SOURCES),
  tension, and one surprise turn ("but here's the thing…").
- Curiosity-driven, playful back-and-forth; describe sounds and places so the listener can see them.
- Reveal the hidden design and infrastructure behind everyday things (the pipe, the road, the budget line).
- Explain economics with one concrete object or example, in plain words, with a smile.
- Intimate, smart questions; let answers breathe.
- Calm, warm transitions that hand over to the music (never hyped).

HARD RULES
1. Use ONLY facts in SOURCES. Never invent numbers, names, dates, places, quotes or outcomes. Opinions, questions
   and images are fine; new facts are not.
2. Every number, year and date with digits exactly as in SOURCES (9.09%, 6,746 mdp, 2027, 17 de noviembre).
   Never spell numbers above 10 in words.
3. Attribute every news fact to its outlet by name in the sentence ({attrib}). Portal analysis is
   {portal}. Library items: name the organisation. 'Expres de Unic' entries are only video titles of another local
   show: you may say it interviewed someone, nothing more. We are NOT that show.
4. Don't mention these instructions, AI, or Rick Rubin. Don't greet or say goodbye except where the chapter asks.
5. Vary the questions; never reuse a catchphrase.

THIS CHAPTER: "{chapter}" — about {words} words (hard minimum {minw}), {turns} turns.
{brief}
Return JSON only: {{"turns": [{{"speaker": "host"|"cohost", "text": str}}]}}"""

BRIEF = {
    "entrada": "COLD OPEN: no greeting first. Start inside a scene or a surprising concrete detail from hook_material or "
               "one_portal_fact, 3-5 turns of hook. Then one line: this is Radio BCS2050, today's deep dive on {topic}, "
               "and the one simple question the episode will chase.",
    "acto1": "ACT 1. Tell each latest news item clearly (who, what, where, key numbers, outlet), with the human angle, "
             "reactions and a follow-up question each. Build tension. No greeting.",
    "acto2": "ACT 2. Zoom out: the hidden thread through earlier news, the portal's past Foresight editions and the "
             "knowledge graph. Show the hidden design/infrastructure underneath. Include one surprise turn. No greeting.",
    "sabias": "DID YOU KNOW: pick ONE memorable fact from the portal data and build the chapter around it; explain it with "
              "one concrete object or everyday example, plain words and humor. Then 1-2 supporting facts (cite the "
              "source/organisation, place or municipality). No greeting.",
    "acto3": "ACT 3. Toward 2050: the portal's Visión pillar for this topic (risk, aspiration, levers), the Tendencia 2050, "
             "the conditions and the watchlist. Where is it heading vs. where could it go? What would it take? No greeting.",
    "apertura": "Quiet welcome to Radio BCS2050 on {date}. Name today's deep dive ({topic}) and why it matters, in images. "
                "Tease 2-3 of the headlines. End on the one simple question this episode will chase.",
    "hoy": "Tell each latest news item clearly (who, what, where, key numbers, outlet), one after another, with reactions "
           "and a follow-up question each. Go deep, not wide: what is underneath each story?",
    "hilo": "Zoom out over the earlier news: what thread runs through the last weeks and months? Connect stories by date "
            "and outlet, notice patterns and contradictions. No greeting.",
    "datos": "What the portal's own intelligence says: Tendencia 2050 claims (with their sources), Foresight signals, "
             "portal facts, library documents (name the organisation) and the ontology. Make the numbers feel human.",
    "horizonte": "Toward 2050: the portal's Visión pillar for this topic (risk, aspiration, levers), the Tendencia 2050, "
                 "the conditions and the watchlist. Where is it heading vs. where could it go? What would it take?",
    "cierre": "THE TAKEAWAY: distil the episode into one sentence listeners can carry. Then a calm, quiet handover "
              "to the music: stay with us, more Radio BCS2050 after the music (in the show's language).",
}


def write_chapter(pack: dict, ch: tuple, L: str, today: str, feedback: str = "", draft: dict | None = None):
    cid, t_es, t_en, w = ch
    from datetime import date as _d
    dd = _d.fromisoformat(today)
    mes = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
           "noviembre", "diciembre"][dd.month - 1]
    dstr = f"{dd.day} de {mes} de {dd.year}" if L == "es" else dd.strftime("%B %-d, %Y")
    topic = THEMES[pack["theme"]][0 if L == "es" else 1]
    if L == "en":
        w = int(w * 0.92)
    src = chapter_sources(pack, cid, L)
    sysmsg = STYLE.format(topic=topic, host=NAMES["host"], cohost=NAMES["cohost"],
                          lang="Mexican Spanish" if L == "es" else "English",
                          attrib='"según Diario Humano…", "informa Meganoticias…"' if L == "es" else '"Gringo Gazette reports…"',
                          portal='"la Tendencia 2050 del portal", "la Visión del portal", "el Foresight del portal"' if L == "es"
                          else '"the portal\'s Trend 2050", "the portal\'s Vision", "the portal\'s Foresight"',
                          chapter=t_es if L == "es" else t_en, words=w, minw=int(w * 0.85),
                          turns=f"{max(4, w // 32)}-{max(6, w // 22)}", brief=BRIEF[cid].format(date=dstr, topic=topic))
    user = "SOURCES:\n" + json.dumps({"date": dstr, "topic": topic, **src}, ensure_ascii=False)
    if draft:
        user += f"\n\nYOUR CURRENT DRAFT:\n{json.dumps(draft, ensure_ascii=False)}\n\nREVISE IT (return the whole JSON):\n{feedback}"
    r = http_json("https://api.x.ai/v1/chat/completions", {
        "model": MODEL, "temperature": 0.8, "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": sysmsg}, {"role": "user", "content": user}]})
    txt = r["choices"][0]["message"]["content"]
    out = json.loads(txt[txt.find("{"): txt.rfind("}") + 1])
    return out, json.dumps(src, ensure_ascii=False) + dstr, w


NUM = re.compile(r"\d[\d.,]*\d|\d")
SPELLED = re.compile(r"(?<!\d )\b(veint\w*|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien(?:to)?s?|"
                     r"\w+cientos?|mil|millon(?:es)?|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b", re.I)


def numkey(s: str) -> str:
    return re.sub(r"[.,]", "", s)


def words(turns: list) -> int:
    return sum(len(t.get("text", "").split()) for t in turns)


def fact_guard(turns: list, src_text: str, today: str) -> list[str]:
    allowed = {numkey(m) for m in NUM.findall(src_text + " " + today)} | {str(x) for x in range(0, 11)} | {"2050"}
    bad = []
    for t in turns:
        for m in NUM.findall(t.get("text", "")):
            if numkey(m) not in allowed:
                bad.append(f"'{m}' not in SOURCES: {t['text'][:140]}")
        for m in SPELLED.findall(t.get("text", "")):
            bad.append(f"'{m}' spelled out (use digits from SOURCES): {t['text'][:140]}")
    return bad


def make_chapter(pack: dict, ch: tuple, L: str, today: str) -> list:
    out, src_text, w = write_chapter(pack, ch, L, today)
    turns = out.get("turns", [])
    if words(turns) < w * 0.8:
        out, src_text, _ = write_chapter(pack, ch, L, today, f"Only {words(turns)} words; reach at least {w}. Keep every turn "
                                         "and ADD turns: more back-and-forth, follow-ups, images, and SOURCES facts not yet told.",
                                         {"turns": turns})
        turns = out.get("turns", turns)
    bad = fact_guard(turns, src_text, today)
    if bad:
        out, src_text, _ = write_chapter(pack, ch, L, today, "Fix ONLY these sentences (use exact digits from SOURCES or drop "
                                         "the number); keep everything else word for word:\n" + "\n".join(bad), {"turns": turns})
        turns = out.get("turns", turns)
        bad = fact_guard(turns, src_text, today)
        turns = [t for t in turns if not any(b.endswith(t.get("text", "")[:140]) for b in bad)]
    clean = []
    for t in turns:
        txt = re.sub(r"\[[a-z_ ]+\]|<[^>]+>", "", t.get("text", "")).strip()
        if txt:
            clean.append({"speaker": "cohost" if t.get("speaker") == "cohost" else "host", "text": txt})
    return clean


# ------------------------------------------------------------------ audio
def tts(text: str, voice: str, lang: str) -> Path:
    cache = CACHE / "tts" / (hashlib.sha1(f"{voice}|{lang}|{TTS_SPEED}|{text}".encode()).hexdigest() + ".mp3")
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        body = {"text": text, "voice_id": voice, "language": lang, "speed": TTS_SPEED}
        req = urllib.request.Request("https://api.x.ai/v1/tts", data=json.dumps(body).encode(), headers={
            "Authorization": f"Bearer {key()}", "Content-Type": "application/json"})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read()
                tmp = cache.with_suffix(".part")
                tmp.write_bytes(data)
                tmp.replace(cache)
                break
            except Exception as e:
                if attempt == 4:
                    raise
                time.sleep(4 * (attempt + 1))
    return cache


def render_chapter(turns: list, lang: str, dest: Path, bed: Path | None) -> float:
    with ThreadPoolExecutor(6) as ex:
        clips = list(ex.map(lambda t: tts(t["text"], VOICES[t["speaker"]], lang), turns))
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        parts = []
        sil = td / "sil.wav"
        ffmpeg("-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "0.8", str(sil))
        for k, c in enumerate(clips):
            w = td / f"t{k}.wav"
            ffmpeg("-i", str(c), "-ar", "24000", "-ac", "1", str(w))
            parts += [w, sil]
        lst = td / "list.txt"
        lst.write_text("".join(f"file '{p}'\n" for p in parts))
        voice = td / "voice.wav"
        ffmpeg("-f", "concat", "-safe", "0", "-i", str(lst), "-ar", "24000", "-ac", "1", str(voice))
        if bed:  # topic's signature music + waves under the opening, ducked low, 2.5 s lead-in
            waves = OUT / "music" / "waves.mp3"
            ffmpeg("-i", str(voice), "-stream_loop", "-1", "-i", str(bed), "-stream_loop", "-1", "-i", str(waves),
                   "-filter_complex",
                   "[0:a]adelay=2500,apad=pad_dur=2[v];"
                   "[1:a]aresample=24000,pan=mono|c0=0.5*c0+0.5*c1,volume=0.30[m];"
                   "[2:a]aresample=24000,pan=mono|c0=0.5*c0+0.5*c1,volume=0.30[w];"
                   "[m][w]amix=inputs=2:duration=longest[bg];"
                   "[v][bg]amix=inputs=2:duration=first:dropout_transition=3:weights=1 1,loudnorm=I=-17:TP=-1.5",
                   "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k", str(dest))
        else:
            ffmpeg("-i", str(voice), "-af", "loudnorm=I=-17:TP=-1.5", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k", str(dest))
    return duration(dest)


# ------------------------------------------------------------------ main
def build_episode(theme: str, pack: dict, today: str, lang: str, music: dict, script_only: bool) -> dict:
    t0 = time.time()
    with ThreadPoolExecutor(len(CHAPTERS)) as ex:
        chapters = list(ex.map(lambda ch: make_chapter(pack, ch, lang, today), CHAPTERS))
    edir = OUT / "editions" / today / theme / lang
    edir.mkdir(parents=True, exist_ok=True)
    sig, stings = TOPIC[theme][1], TOPIC[theme][2]
    bed = OUT / "music" / f"bed_{sig}.mp3"
    tracks, total = [], 0.0
    for k, (ch, turns) in enumerate(zip(CHAPTERS, chapters), 1):
        f = edir / f"{k:02d}.mp3"
        dur = 0.0 if script_only else render_chapter(turns, lang, f, bed if k == 1 and bed.exists() else None)
        pick = (stings + [sig])[(k - 1) % (len(stings) + 1)]
        sting = None if k == len(CHAPTERS) else (f"/radio/music/break_{pick}.mp3" if k == MID_BREAK_AFTER
                                                 else f"/radio/music/short_{pick}.mp3")
        total += dur + (duration(ROOT / "public" / sting.lstrip("/")) if sting else 0)
        tracks.append({"n": k, "id": ch[0], "title": ch[1] if lang == "es" else ch[2],
                       "src": f"/radio/editions/{today}/{theme}/{lang}/{k:02d}.mp3", "duration": dur, "sting": sting})
    title = f"{THEMES[theme][0 if lang == 'es' else 1]} · Radio BCS2050"
    dump(edir / "script.json", {"topic": theme, "lang": lang, "title": title,
                                "chapters": [{"id": c[0], "title": c[1] if lang == "es" else c[2], "turns": t}
                                             for c, t in zip(CHAPTERS, chapters)]})
    print(f"  [{theme}/{lang}] {sum(words(t) for t in chapters)} words, {total/60:.1f} min ({time.time()-t0:.0f}s)")
    return {"title": title, "duration": round(total, 1), "tracks": tracks,
            "script": f"/radio/editions/{today}/{theme}/{lang}/script.json", "words": sum(words(t) for t in chapters)}


STING_LEN: dict = {}
TTS_SPEED = 0.94  # unhurried
MID_BREAK_AFTER = 3  # chapters 1-3 ≈ 5 min of talk, then a ~30 s music break

ID_TEXT = {
    "es": ["Estás escuchando Radio BCS2050. Baja California Sur, con espíritu de California.",
           "Radio BCS2050. Del desierto al Pacífico, sin prisa.",
           "Esto es Radio BCS2050. Quédate: viene más, después de la música."],
    "en": ["You're listening to Radio BCS2050. Baja California Sur, with a California soul.",
           "Radio BCS2050. From the desert to the Pacific, no rush.",
           "This is Radio BCS2050. Stay with us, more after the music."],
}


def build_ids() -> dict:
    """Station IDs: a short voice line over a soft music bed. Built once per language/variant."""
    out = {}
    for lang, lines in ID_TEXT.items():
        for k, line in enumerate(lines):
            dest = OUT / "music" / f"id_{lang}_{k+1}.mp3"
            if not dest.exists():
                v = tts(line, VOICES["host" if k % 2 == 0 else "cohost"], lang)
                bed = OUT / "music" / f"bed_{['bossa', 'horizon', 'romanza'][k]}.mp3"
                ffmpeg("-i", str(v), "-i", str(bed), "-filter_complex",
                       "[0:a]aresample=44100,adelay=1200|1200,apad=pad_dur=2.5[v];[1:a]aresample=44100,volume=0.45[b];"
                       "[v][b]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-17:TP=-1.5",
                       "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", str(dest))
                d = duration(dest)
                ffmpeg("-i", str(dest), "-af", f"afade=t=out:st={max(0, d-2)}:d=2", "-c:a", "libmp3lame", "-b:a", "64k",
                       str(dest.with_suffix(".tmp.mp3")))
                dest.with_suffix(".tmp.mp3").replace(dest)
            out.setdefault(lang, []).append(f"/radio/music/{dest.name}")
    return out


EPOCH = "2026-11-17T00:00:00Z"


def build_station() -> None:
    """24/7 loop per language over every edition still holding audio: station ID → episode (chapters with short
    transitions and a mid break) → ~30 s music break → next episode. The player joins at (now - EPOCH) % total."""
    ids = build_ids()
    lens: dict = {}

    def dur(url: str) -> float:
        if url not in lens:
            lens[url] = duration(ROOT / "public" / url.lstrip("/"))
        return lens[url]

    breaks = [f"/radio/music/break_{m['id']}.mp3" for m in MUSIC if not m.get("bed")]
    eds = sorted((p.name for p in (OUT / "editions").iterdir() if (p / "edition.json").exists()), reverse=True)
    for lang in ("es", "en"):
        items, n = [], 0
        for d in eds:
            e = load(OUT / "editions" / d / "edition.json", {}) or {}
            for ep in e.get("episodes", []):
                lv = ep.get("languages", {}).get(lang)
                if not lv or not all((ROOT / "public" / t["src"].lstrip("/")).exists() for t in lv["tracks"]):
                    continue
                meta = {"date": d, "topic": ep["topic"], "name": ep["name_es" if lang == "es" else "name_en"]}
                items.append({"src": ids[lang][n % len(ids[lang])], "d": dur(ids[lang][n % len(ids[lang])]), "kind": "id"})
                for t in lv["tracks"]:
                    items.append({"src": t["src"], "d": t["duration"] or dur(t["src"]), "kind": "talk", "ch": t["title"], **meta})
                    if t.get("sting"):
                        items.append({"src": t["sting"], "d": dur(t["sting"]), "kind": "music", **meta})
                b = breaks[n % len(breaks)]
                items.append({"src": b, "d": dur(b), "kind": "music"})
                n += 1
        total = round(sum(x["d"] for x in items), 2)
        dump(OUT / f"station_{lang}.json", {"epoch": EPOCH, "total": total, "episodes": n, "items": items,
                                            "updated": date.today().isoformat()})
        print(f"  station {lang}: {n} deep dives, loop {total/3600:.2f} h")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", default=date.today().isoformat())
    ap.add_argument("--lang", choices=["es", "en", "both"], default="both")
    ap.add_argument("--topics", type=int, default=3, help="deep dives per edition (default 3)")
    ap.add_argument("--topic", action="append", choices=list(THEMES), help="force specific topic(s)")
    ap.add_argument("--script-only", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--station-only", action="store_true", help="only rebuild the 24/7 loop files")
    a = ap.parse_args()
    today, t0 = a.date, time.time()
    if a.station_only:
        build_music()
        build_station()
        return 0
    ed_dir = OUT / "editions" / today
    if (ed_dir / "edition.json").exists() and not a.force:
        print(f"Radio BCS2050 {today}: edition exists (use --force to rebuild)")
        return 0
    music = build_music()
    for mid, url in music.items():
        STING_LEN[url] = duration(OUT / "music" / f"{mid}.mp3")
    hist = load(OUT / "history.json", {"used": [], "theme_last": {}, "editions": []})
    if a.force and ed_dir.exists():  # rebuilding today: forget today's own picks first
        prev = load(ed_dir / "edition.json", {}) or {}
        hist["used"] = [u for u in hist.get("used", []) if u not in set(prev.get("source_ids", []))]
        hist["theme_last"] = {k: v for k, v in hist.get("theme_last", {}).items() if v != today}
        shutil.rmtree(ed_dir)
    news, edu = all_news(), expres_de_unic()
    topics = a.topic or pick_topics(today, hist, a.topics, news)
    print(f"Radio BCS2050 {today}: deep dives {topics}")
    packs = {}
    for th in topics:  # sequential so two topics never tell the same fresh story
        packs[th] = topic_pack(th, hist, news, edu)
        hist = {**hist, "used": list(set(hist.get("used", [])) | set(packs[th]["ids"]))}
    langs = ["es", "en"] if a.lang == "both" else [a.lang]
    jobs = [(th, L) for th in topics for L in langs]
    with ThreadPoolExecutor(3) as ex:
        res = dict(zip(jobs, ex.map(lambda j: build_episode(j[0], packs[j[0]], today, j[1], music, a.script_only), jobs)))
    episodes = []
    for th in topics:
        p = packs[th]
        srcs = [{"outlet": x["outlet"], "title": x["title_es"], "url": x["url"], "date": x["date"]} for x in p["now"] + p["older"]]
        srcs += [{"outlet": f"{x.get('org','')} ({x.get('year','')})", "title": x["title"], "url": x.get("url", "")} for x in p["data"]["library"]]
        srcs += [{"outlet": "Expres de Unic", "title": e["title"], "url": e["url"]} for e in p["expres_de_unic"]]
        srcs += [{"outlet": "Portal BCS 2050", "title": "Tendencia 2050 · Visión · Foresight · Ontología", "url": "/foresights/"}]
        episodes.append({"topic": th, "name_es": THEMES[th][0], "name_en": THEMES[th][1], "signature": music[TOPIC[th][1]],
                         "languages": {L: res[(th, L)] for L in langs}, "sources": srcs})
    edition = {"date": today, "format": "deep-dives", "engine": {"script": f"xAI {MODEL}", "voices": "xAI Grok TTS (rex, eve)"},
               "episodes": episodes, "source_ids": sorted(set(i for p in packs.values() for i in p["ids"])),
               "credits": "/radio/credits.json"}
    dump(ed_dir / "edition.json", edition)
    if a.script_only:
        return 0
    dump(OUT / "latest.json", edition)
    hist["used"] = sorted(set(hist.get("used", [])))
    for th in topics:
        hist.setdefault("theme_last", {})[th] = today
    hist["editions"] = sorted(set(hist.get("editions", [])) | {today})
    dump(OUT / "history.json", hist)
    eds = sorted(p.name for p in (OUT / "editions").iterdir() if (p / "edition.json").exists())
    for old in eds[:-KEEP_AUDIO]:
        for mp3 in (OUT / "editions" / old).rglob("*.mp3"):
            mp3.unlink()
    arch = []
    for d in reversed(eds):
        e = load(OUT / "editions" / d / "edition.json", {})
        arch.append({"date": d, "audio": d in eds[-KEEP_AUDIO:], "edition": f"/radio/editions/{d}/edition.json",
                     "topics": [{"topic": x["topic"], "name_es": x["name_es"], "name_en": x["name_en"],
                                 "duration": {L: v["duration"] for L, v in x["languages"].items()}}
                                for x in e.get("episodes", [])]})
    dump(OUT / "archive.json", {"editions": arch})
    build_station()
    print(f"Wrote public/radio/latest.json ({today}) in {(time.time()-t0)/60:.1f} min")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
