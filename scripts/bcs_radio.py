#!/usr/bin/env python3
"""Radio BCS2050 — builds today's edition (ES + EN) as static MP3 segments.

    python3 scripts/bcs_radio.py                 # today's edition (script + audio), both languages
    python3 scripts/bcs_radio.py --date 2026-11-17 --lang es
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

Output: public/radio/editions/<date>/{es,en}/NN.mp3 + script.json, public/radio/latest.json,
public/radio/archive.json (all editions' scripts kept; audio kept for the last KEEP_AUDIO editions).
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
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"
OUT = ROOT / "public" / "radio"
CACHE = ROOT / "scripts" / "_cache" / "radio"
MUSIC_SRC = ROOT / "scripts" / "_cache" / "radio_music_src"
KEEP_AUDIO = 3
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
    credits = [{k: m[k] for k in ("id", "title", "artist", "license", "license_url", "source")} for m in MUSIC]
    dump(OUT / "credits.json", {"note": "Only CC0, public-domain or CC BY recordings; short excerpts with fades.",
                                "music": credits,
                                "voices": "Grok text-to-speech (xAI): voices 'rex' (host) and 'eve' (co-host)."})
    md = ["# Radio BCS2050 — music credits", "",
          "Only CC0, public-domain or CC BY recordings are used, as short excerpts (14–38 s) with fades.", "",
          "| Track | Artist | License | Source |", "|---|---|---|---|"]
    md += [f"| {m['title']} | {m['artist']} | [{m['license']}]({m['license_url']}) | {m['source']} |" for m in MUSIC]
    (ROOT / "RADIO_MUSIC_CREDITS.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    return {m["id"]: f"/radio/music/{m['id']}.mp3" for m in MUSIC}


# ------------------------------------------------------------------ sources
def theme_of(text: str) -> list[str]:
    t = norm(text)
    return [k for k, (_, _, rx) in THEMES.items() if re.search(norm(rx), t)]


def expres_de_unic() -> list[dict]:
    """Public video titles (and descriptions when given) from the Expres de Unic channel. Optional."""
    cache = CACHE / "expres_de_unic.json"
    cached = load(cache, None)
    if cached and cached.get("date") == date.today().isoformat():
        return cached["items"]
    items = []
    try:
        r = subprocess.run(["yt-dlp", "--flat-playlist", "--playlist-end", "12", "-J",
                            "https://www.youtube.com/@Expresdeunic/videos"],
                           capture_output=True, text=True, timeout=90)
        for e in (json.loads(r.stdout).get("entries") or []):
            if e.get("title"):
                items.append({"id": f"edu-{e['id']}", "source": "Expres de Unic",
                              "url": f"https://www.youtube.com/watch?v={e['id']}",
                              "title": e["title"], "text": clip(e.get("description") or "", 300)})
    except Exception as ex:
        print(f"  Expres de Unic skipped: {ex}")
    dump(cache, {"date": date.today().isoformat(), "items": items})
    return items


def gather(today: str, hist: dict) -> dict:
    used = set(hist.get("used", []))
    news = [n for n in (load(DATA / "news.json", {"items": []}) or {}).get("items", [])
            if n.get("url") and not n.get("_needs_review") and (n.get("blurb_es") or n.get("blurb_en"))]
    news.sort(key=lambda n: n.get("date", ""), reverse=True)

    # Theme rotation: least-recently covered themes first, then the ones with fresh news.
    last = hist.get("theme_last", {})
    by_theme: dict[str, list] = {k: [] for k in THEMES}
    for n in news:
        txt = " ".join([n.get("title_es", ""), n.get("title_en", ""), n.get("blurb_es", "")[:400],
                        " ".join(n.get("topics") or [])])
        for th in theme_of(txt):
            by_theme[th].append(n)
    order = sorted(THEMES, key=lambda k: (last.get(k, ""), hashlib.md5((today + k).encode()).hexdigest()))
    themes = [k for k in order if any(n["id"] not in used for n in by_theme[k][:60])][:5] or order[:5]

    picked, seen = [], set()
    for th in themes:
        fresh = [n for n in by_theme[th] if n["id"] not in used and n["id"] not in seen]
        for n in fresh[:2] or by_theme[th][:1]:
            seen.add(n["id"])
            picked.append({"id": n["id"], "theme": th, "source": n.get("source", ""), "date": n.get("date", ""),
                           "url": n["url"], "title_es": n.get("title_es", ""), "title_en": n.get("title_en", ""),
                           "text_es": clip(n.get("blurb_es", ""), 700), "text_en": clip(n.get("blurb_en", ""), 700)})

    v = load(DATA / "foresights_vision.json", {}) or {}
    i = load(DATA / "foresights_ideal.json", {}) or {}
    f = load(DATA / "foresights.json", {}) or {}
    tendencia = {"id": "tendencia", "source": "Tendencia 2050 (portal BCS 2050)",
                 "text_es": clip(" ".join([v.get("kicker_es", ""), v.get("edition_headline_es", "") or "", v.get("narrative_es", "")]), 1500),
                 "text_en": clip(" ".join([v.get("kicker_en", ""), v.get("narrative_en", "")]), 1500)}
    pillars = i.get("pillars") or []
    pr = int(hashlib.md5(today.encode()).hexdigest(), 16)
    pil = pillars[pr % len(pillars)] if pillars else {}
    vision = {"id": "vision", "source": "Visión (portal BCS 2050)",
              "text_es": clip(i.get("lead_es", "") + " " + " ".join(str(pil.get(k, "")) for k in pil if k.endswith("_es")), 1400),
              "text_en": clip(i.get("lead_en", "") + " " + " ".join(str(pil.get(k, "")) for k in pil if k.endswith("_en")), 1400)}
    wl = f.get("watchlist") or []
    foresight = {"id": "foresight", "source": "Foresight (portal BCS 2050)",
                 "text_es": clip(f.get("headline_es", "") + ". " + " ".join(w.get("item_es", "") for w in wl[:3]), 1100),
                 "text_en": clip(f.get("headline_en", "") + ". " + " ".join(w.get("item_en", "") for w in wl[:3]), 1100)}

    lib = [x for x in (load(DATA / "library.json", {}) or {}).get("items", []) if x.get("title") and x.get("relevance")]
    docs = [x for x in lib if x.get("id") not in used]
    doc = docs[pr % len(docs)] if docs else None
    nodes = [n for n in (load(DATA / "ontology_factors.json", {}) or {}).get("nodes", []) if n.get("summary")]
    onodes = [n for n in nodes if n.get("id") not in used]
    node = onodes[(pr // 7) % len(onodes)] if onodes else None
    extra = []
    if doc:
        extra.append({"id": doc["id"], "source": f"Biblioteca del portal: {doc.get('org','')} ({doc.get('year','')})",
                      "title": doc["title"], "text": clip(doc.get("relevance", ""), 300), "url": doc.get("url", "")})
    if node:
        extra.append({"id": node["id"], "source": "Ontología del portal", "title": node.get("label", ""),
                      "text": clip(node.get("summary", ""), 400)})
    edu = [e for e in expres_de_unic() if e["id"] not in used][:3]
    return {"date": today, "themes": themes, "news": picked, "tendencia": tendencia, "vision": vision,
            "foresight": foresight, "extra": extra, "expres_de_unic": edu}


# ------------------------------------------------------------------ writing
STYLE = """You write 'Radio BCS2050', a radio show about Baja California Sur (Mexico) and its path to 2050.
Spirit: Rick Rubin in a Malibu studio, with a California soul: relaxed, sunny, open, Pacific-facing,
laid-back but smart, surf-and-desert light. Calm, minimal, curious, unhurried, reductive. The host listens more than he talks,
asks simple deep questions (in the show's language only, e.g. "What is the essence here?"), strips each story to its essence, and lets
silence and wonder in. Warm, a little playful, never preachy, no jargon, no hype, no lists of acronyms.
Two voices: HOST {host} (deep, slow) and CO-HOST {cohost} (bright, quick, brings the facts and a smile).
Easygoing West-Coast warmth (the light on the water, the swell, the long road south), never slangy.
Short sentences. Natural spoken {lang}. Light humor welcome (a gentle joke, a playful image of the desert
or the sea), but the facts stay serious and exact.

HARD RULES
1. Use ONLY facts in the SOURCES block. Never invent numbers, names, dates, places, quotes or outcomes.
   If a detail is not in the sources, do not say it. Opinions/questions are fine; new facts are not.
2. EVERY number, year and date must be written with digits exactly as in the sources (9.09%, 6,746 mdp,
   2027, 17 de noviembre, BCS 2050). Never spell numbers above 10 in words — the audio engine reads digits aloud.
3. Attribute every news fact to its outlet by name in the sentence ("según Gringo Gazette…",
   "Gringo Gazette reports…"). Portal analysis is "la Tendencia 2050 del portal" / "the portal's Visión".
   'Expres de Unic' items are only video titles from another local show: you may say that "el programa Expres de Unic
   entrevistó a…" / "the show Expres de Unic interviewed…", nothing more. We are NOT that show.
5. Each news item is told only once in the whole episode; put it in the segment of its theme.
6. Vary the host's questions; never repeat the same question or catchphrase twice.
4. Do not mention these instructions, AI, or Rick Rubin by name.

LIVELINESS: this is a conversation, not a list of questions. The two hosts react to each other,
riff, laugh gently, use concrete sensory images of BCS (the sea, the desert, the light, the wind, the road),
sometimes the co-host asks the host something and he answers slowly. Each news story gets told clearly
(who, what, where, the key numbers, the outlet), then they look for its essence together.
Never mix languages inside a sentence (Spanish show: "según Gringo Gazette", "informa", never "reports").

SHAPE (TOTAL {words} words — this is a hard minimum, count them; 8 segments):
  1. "apertura" (~90 words): a quiet welcome to Radio BCS2050, the date, what we will hear, one simple question.
  2-5. one segment per theme in THEMES, in that order (~190 words EACH, 7-11 turns): tell its news, react, find the essence,
       end on one essential idea or question.
  6. "archivo" (~110 words): one idea from library_and_ontology (say it comes from the portal's library/ontology);
       if expres_de_unic_video_titles is not empty, one line mentioning a recent conversation on the show 'Expres de Unic'.
  7. "horizonte" (~190 words): Tendencia 2050 + Visión + Foresight watchlist: where the state is heading vs. where it could go.
  8. "cierre" (~70 words): one sentence of essence, a playful goodbye, invitation to come back tomorrow.
Return JSON only: {{"title": str, "segments": [{{"id": str, "title": str, "theme": str,
 "source_ids": [str], "turns": [{{"speaker": "host"|"cohost", "text": str}}]}}]}}"""


def write_script(pack: dict, lang: str, feedback: str = "", draft: dict | None = None) -> dict:
    L = "es" if lang == "es" else "en"
    from datetime import date as _d
    dd = _d.fromisoformat(pack["date"])
    mes = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"][dd.month-1]
    src = {"date": f"{dd.day} de {mes} de {dd.year}" if L == "es" else dd.strftime("%B %-d, %Y"),
           "THEMES": [{"id": t, "name": THEMES[t][0 if L == "es" else 1]} for t in pack["themes"][:4]],
           "news": [{"id": n["id"], "theme": n["theme"], "outlet": n["source"], "date": n["date"],
                     "title": n[f"title_{L}"] or n["title_es"], "facts": n[f"text_{L}"] or n["text_es"]} for n in pack["news"]],
           "tendencia_2050": pack["tendencia"][f"text_{L}"], "vision": pack["vision"][f"text_{L}"],
           "foresight": pack["foresight"][f"text_{L}"], "library_and_ontology": pack["extra"],
           "expres_de_unic_video_titles": pack["expres_de_unic"]}
    sysmsg = STYLE.format(host=NAMES["host"], cohost=NAMES["cohost"],
                          lang="Mexican Spanish" if L == "es" else "English", words=1250 if L == "es" else 1150)
    user = "SOURCES:\n" + json.dumps(src, ensure_ascii=False) + (
        f"\n\nYOUR CURRENT DRAFT:\n{json.dumps(draft, ensure_ascii=False)}\n\nREVISE THE DRAFT (return the whole revised JSON):\n{feedback}"
        if draft else "")
    r = http_json("https://api.x.ai/v1/chat/completions", {
        "model": MODEL, "temperature": 0.8, "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": sysmsg}, {"role": "user", "content": user}]})
    txt = r["choices"][0]["message"]["content"]
    txt = txt[txt.find("{"): txt.rfind("}") + 1]
    return json.loads(txt), json.dumps(src, ensure_ascii=False)


NUM = re.compile(r"\d[\d.,]*\d|\d")


def numkey(s: str) -> str:
    return re.sub(r"[.,]", "", s)


SPELLED = re.compile(r"(?<!\d )\b(veint\w*|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien(?:to)?s?|"
                     r"\w+cientos?|mil|millon(?:es)?|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b", re.I)


def fact_guard(script: dict, src_text: str, today: str) -> list[str]:
    allowed = {numkey(m) for m in NUM.findall(src_text)} | {numkey(m) for m in NUM.findall(today)}
    allowed |= {str(x) for x in range(0, 11)} | {"2050"}
    bad = []
    for s in script.get("segments", []):
        for t in s.get("turns", []):
            for m in NUM.findall(t.get("text", "")):
                if numkey(m) not in allowed:
                    bad.append(f"'{m}' in: {t['text'][:120]}")
            for m in SPELLED.findall(t.get("text", "")):
                bad.append(f"'{m}' spelled out (use digits from SOURCES) in: {t['text'][:120]}")
    return bad


def words(script: dict) -> int:
    return sum(len(t.get("text", "").split()) for s in script.get("segments", []) for t in s.get("turns", []))


def make_script(pack: dict, lang: str) -> dict:
    script, src_text = write_script(pack, lang)
    for _ in range(2):
        if words(script) >= 1050:
            break
        print(f"  [{lang}] only {words(script)} words, asking for a fuller draft")
        script, src_text = write_script(pack, lang, f"The draft has only {words(script)} words; it must reach at least 1200. Keep every "
                                        "existing turn and ADD turns: more back-and-forth, reactions, sensory images, follow-up questions, "
                                        "and remaining facts from SOURCES not yet told. Same rules: no new facts, digits only.", script)
    bad = fact_guard(script, src_text, pack["date"])
    if bad:
        print(f"  [{lang}] fact guard: {len(bad)} unsupported numbers, rewriting")
        script, src_text = write_script(pack, lang, "Fix ONLY these sentences (numbers not in SOURCES or spelled out; correct them "
                                        "with the exact digits from SOURCES or remove the number). Keep everything else word for word:\n"
                                        + "\n".join(bad), script)
        bad = fact_guard(script, src_text, pack["date"])
        for s in script.get("segments", []):  # last resort: drop turns that still carry unsupported numbers
            s["turns"] = [t for t in s["turns"] if not any(b.endswith(t["text"][:120]) for b in bad)]
    for s in script["segments"]:
        for t in s["turns"]:
            t["speaker"] = "cohost" if t.get("speaker") == "cohost" else "host"
            t["text"] = re.sub(r"\[[a-z_ ]+\]|<[^>]+>", "", t["text"]).strip()  # no stray speech tags
    script["segments"] = [s for s in script["segments"] if s.get("turns")]
    return script


# ------------------------------------------------------------------ audio
def tts(text: str, voice: str, lang: str, dest: Path) -> None:
    cache = CACHE / "tts" / (hashlib.sha1(f"{voice}|{lang}|{text}".encode()).hexdigest() + ".mp3")
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        body = {"text": text, "voice_id": voice, "language": lang}
        req = urllib.request.Request("https://api.x.ai/v1/tts", data=json.dumps(body).encode(), headers={
            "Authorization": f"Bearer {key()}", "Content-Type": "application/json"})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    cache.write_bytes(r.read())
                break
            except Exception as e:
                if attempt == 3:
                    raise
                print(f"  tts retry {attempt+1}: {e}")
                time.sleep(4 * (attempt + 1))
    shutil.copy(cache, dest)


def render_segment(seg: dict, lang: str, dest: Path, bed: Path | None) -> float:
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        parts = []
        sil = td / "sil.wav"
        ffmpeg("-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "0.45", str(sil))
        for k, t in enumerate(seg["turns"]):
            p = td / f"t{k}.mp3"
            tts(t["text"], VOICES[t["speaker"]], lang, p)
            w = td / f"t{k}.wav"
            ffmpeg("-i", str(p), "-ar", "24000", "-ac", "1", str(w))
            parts += [w, sil]
        lst = td / "list.txt"
        lst.write_text("".join(f"file '{p}'\n" for p in parts))
        voice = td / "voice.wav"
        ffmpeg("-f", "concat", "-safe", "0", "-i", str(lst), "-ar", "24000", "-ac", "1", str(voice))
        if bed:  # waves under the opening, ducked low and faded out
            ffmpeg("-i", str(voice), "-stream_loop", "-1", "-i", str(bed), "-filter_complex",
                   "[1:a]aresample=24000,pan=mono|c0=0.5*c0+0.5*c1,volume=0.35[b];"
                   "[0:a]apad=pad_dur=1.5[v];[v][b]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-17:TP=-1.5",
                   "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", str(dest))
        else:
            ffmpeg("-i", str(voice), "-af", "loudnorm=I=-17:TP=-1.5", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", str(dest))
    return duration(dest)


# ------------------------------------------------------------------ main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", default=date.today().isoformat())
    ap.add_argument("--lang", choices=["es", "en", "both"], default="both")
    ap.add_argument("--script-only", action="store_true")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    today = a.date
    ed_dir = OUT / "editions" / today
    if (ed_dir / "edition.json").exists() and not a.force:
        print(f"Radio BCS2050 {today}: edition exists (use --force to rebuild)")
        return 0
    music = build_music()
    hist = load(OUT / "history.json", {"used": [], "theme_last": {}, "editions": []})
    if a.force and today in hist.get("editions", []):  # rebuilding: don't treat this edition's own picks as used
        prev = load(ed_dir / "edition.json", {}) or {}
        hist["used"] = [u for u in hist["used"] if u not in set(prev.get("source_ids", []))]
    pack = gather(today, hist)
    print(f"Radio BCS2050 {today}: themes {pack['themes'][:4]}, {len(pack['news'])} news items")
    stings = ["bossa", "romanza", "surf", "cielito", "beachbum", "romance", "horizon"]
    edition = {"date": today, "engine": {"script": f"xAI {MODEL}", "voices": "xAI Grok TTS (rex, eve)"},
               "themes": pack["themes"][:4], "languages": {}, "source_ids": [], "sources": []}
    langs = ["es", "en"] if a.lang == "both" else [a.lang]
    for lang in langs:
        script = make_script(pack, lang)
        ldir = ed_dir / lang
        ldir.mkdir(parents=True, exist_ok=True)
        tracks, total = [], 0.0
        for k, seg in enumerate(script["segments"], 1):
            f = ldir / f"{k:02d}.mp3"
            dur = 0.0 if a.script_only else render_segment(seg, lang, f, (MUSIC_SRC / "pebble_beach.src") if k == 1 else None)
            total += dur
            tracks.append({"n": k, "id": seg.get("id", f"s{k}"), "title": seg.get("title", ""), "theme": seg.get("theme", ""),
                           "src": f"/radio/editions/{today}/{lang}/{k:02d}.mp3", "duration": dur,
                           "sting": None if k == len(script["segments"]) else music[stings[(k - 1) % len(stings)]]})
        dump(ldir / "script.json", script)
        edition["languages"][lang] = {"title": script.get("title", "Radio BCS2050"), "duration": round(total, 1),
                                      "tracks": tracks, "script": f"/radio/editions/{today}/{lang}/script.json"}
        print(f"  [{lang}] {len(tracks)} segments, {total/60:.1f} min")
    ids = [n["id"] for n in pack["news"]] + [x["id"] for x in pack["extra"]] + [e["id"] for e in pack["expres_de_unic"]]
    edition["source_ids"] = ids
    edition["sources"] = [{"outlet": n["source"], "title": n["title_es"], "url": n["url"], "date": n["date"]} for n in pack["news"]] + \
        [{"outlet": x["source"], "title": x["title"], "url": x.get("url", "")} for x in pack["extra"]] + \
        [{"outlet": "Expres de Unic", "title": e["title"], "url": e["url"]} for e in pack["expres_de_unic"]] + \
        [{"outlet": "Portal BCS 2050", "title": "Tendencia 2050 · Visión · Foresight", "url": "/foresights/"}]
    edition["intro_bed"] = music["waves"]
    edition["credits"] = "/radio/credits.json"
    dump(ed_dir / "edition.json", edition)
    if a.script_only:
        return 0
    dump(OUT / "latest.json", edition)
    hist["used"] = sorted(set(hist.get("used", [])) | set(ids))
    for th in pack["themes"][:4]:
        hist.setdefault("theme_last", {})[th] = today
    hist["editions"] = sorted(set(hist.get("editions", [])) | {today})
    dump(OUT / "history.json", hist)
    # archive: every edition's scripts stay; audio only for the newest KEEP_AUDIO editions
    eds = sorted(p.name for p in (OUT / "editions").iterdir() if (p / "edition.json").exists())
    for old in eds[:-KEEP_AUDIO]:
        for mp3 in (OUT / "editions" / old).rglob("*.mp3"):
            mp3.unlink()
    arch = []
    for d in reversed(eds):
        e = load(OUT / "editions" / d / "edition.json", {})
        arch.append({"date": d, "themes": e.get("themes", []), "audio": d in eds[-KEEP_AUDIO:],
                     "edition": f"/radio/editions/{d}/edition.json",
                     "titles": {l: v.get("title") for l, v in e.get("languages", {}).items()}})
    dump(OUT / "archive.json", {"editions": arch})
    print(f"Wrote public/radio/latest.json ({today})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
