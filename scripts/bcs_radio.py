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
from datetime import date, timedelta
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
# Host roster: every Grok TTS voice (GET /v1/tts/voices, 28 voices) has one fixed on-air name.
MALE = {"rex": "Tomás", "altair": "Andrés", "atlas": "Mateo", "castor": "Diego", "cosmo": "Joaquín", "helios": "Rafa",
        "helix": "Emilio", "kepler": "Javier", "leo": "Leo", "lumen": "Gabriel", "lux": "Nico", "naksh": "Samuel",
        "orion": "Óscar", "perseus": "Pablo", "rigel": "Ramón", "sal": "Salvador", "sirius": "Sergio", "zagan": "Bruno",
        "zenith": "Julián"}
FEMALE = {"eve": "Luz", "ara": "Marina", "aurora": "Aurora", "carina": "Carmen", "celeste": "Celeste", "iris": "Isabel",
          "liora": "Lía", "luna": "Paloma", "ursa": "Rosa"}
# 19 pairs (one male + one female each), pair 0 = Tomás (rex) + Luz (eve); the lead alternates by pair.
PAIRS = [((m, f) if k % 2 == 0 else (f, m)) for k, (m, f) in
         enumerate(zip(MALE, [list(FEMALE)[k % len(FEMALE)] for k in range(len(MALE))]))]
VNAME = {**MALE, **FEMALE}
# pitch-preserving atempo per voice, measured against a reference read (slow voices brought to a natural pace);
# rex = Tomás +9 %, eve = Luz unchanged
TEMPO = {'altair': 1.1, 'ara': 1.07, 'atlas': 1.07, 'aurora': 1.04, 'carina': 1.04, 'castor': 1.01, 'cosmo': 1.02, 'helios': 1.07, 'helix': 1.02, 'iris': 1.02, 'kepler': 1.1, 'leo': 1.1, 'liora': 1.1, 'lumen': 1.01, 'luna': 1.09, 'lux': 1.09, 'naksh': 1.04, 'orion': 1.09, 'perseus': 1.1, 'rex': 1.09, 'rigel': 1.1, 'sal': 1.07, 'ursa': 1.1, 'zagan': 1.1}
CAST_FILE = Path(__file__).resolve().parent.parent / "public" / "radio" / "cast.json"
UA = "BCS2050Radio/1.0 (bajacaliforniasur2050.com)"

THEMES = {
    "urbanismo": ("Urbanismo", "Urbanism", r"urban|ciudad|city|implan|pdu|vivienda|housing|densidad|density|plan de desarrollo urbano|zonific|zoning|land_use|uso de suelo"),
    "desarrollo": ("Desarrollo", "Development", r"desarrollo inmobiliario|desarrolladora|developer|proyecto turístico|proyecto inmobiliario|inversi|investment|masterplan|plan maestro|fraccionamiento|condominio|resort project"),
    "medio_ambiente": ("Medio ambiente", "Environment", r"environment|ambient|ecolog|reserva|protected|área natural|anp|manglar|mangrove|ballena|whale|tortuga|turtle|coral|el niño|erosi|semarnat|conanp|profepa|clima|climate|hurac|hurricane"),
    "agua": ("Agua", "Water", r"water|agua|acuífer|aquifer|desalin|oomsapas|conagua|cea|huachicol|drenaje|sanea"),
    "social": ("Social", "Society", r"social|comunidad|community|salud|health|dengue|hospital|imss|issste|paciente|patient|educa|school|escuela|pobreza|poverty|migra|trabajador|worker|mujer|women|cultura|culture"),
    "infraestructura": ("Infraestructura", "Infrastructure", r"infraestruct|infrastructure|energ|electric|cfe|apag|blackout|planta desaladora|desalination plant|carretera|highway|obra pública|public works|puente|bridge|pavimenta|paving|concreto hidráulico|calle|street|drenaje|sewer"),
    "turismo": ("Turismo", "Tourism", r"touris|turis|hotel|crucer|cruise|visitant|visitor|ocupaci|occupancy|fitur|tourism"),
    "conectividad": ("Conectividad", "Connectivity", r"aeropuert|airport|vuelo|flight|aerol|airline|ruta aérea|air route|conectividad|connectivity|internet|fibra|puerto|seaport|ferry|crucero|cruise"),
    "transporte": ("Transporte", "Transport", r"transport|movilidad|mobility|tráfico|traffic|camión|bus|transpeninsular|vialidad|road|taxi|uber"),
    "economia": ("Economía", "Economy", r"econom|empleo|employment|jobs|pib|gdp|comercio|trade|empresa|business|inmobiliar|real estate|pesca|fishing|minería|mining"),
    "finanzas": ("Finanzas", "Finance", r"finanz|financ|presupuest|budget|ingresos|revenue|deuda|debt|impuest|tax|predial|ley de ingresos|paquete económico"),
    "crimen": ("Seguridad", "Security", r"crimen|crime|delito|huachicol|clandestin|clausur|seguridad|security|homicid|robo|theft|violen|polic|fiscal[ií]a|guardia nacional|narco"),
    "politica": ("Política", "Politics", r"polític|politic|congreso|congress|cabildo|council|gobernador|governor|alcald|mayor\b|elecci|election|informe de gobierno|reforma|partido|senador|diputad"),
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
    # ---- added 18 Nov 2026: more CC BY 3.0 tracks by Kevin MacLeod (Wikimedia Commons) so every episode sounds different
    {"id": "airportlounge", "file": "airportlounge.src", "start": 4, "len": 16, "title": "Airport Lounge", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Airport_Lounge_(ISRC_USUAN1100806).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/0/05/Airport_Lounge_%28ISRC_USUAN1100806%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "ambler", "file": "ambler.src", "start": 1, "len": 16, "title": "Ambler", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Ambler_(ISRC_USUAN1300019).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/e/e1/Ambler_%28ISRC_USUAN1300019%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "aridfoothills", "file": "aridfoothills.src", "start": 4, "len": 16, "title": "Arid Foothills", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Arid_Foothills_(ISRC_USUAN1100437).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/0/0d/Arid_Foothills_%28ISRC_USUAN1100437%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "backbaylounge", "file": "backbaylounge.src", "start": 4, "len": 16, "title": "Backbay Lounge", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Backbay_Lounge_(ISRC_USUAN1700068).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/e/e2/Backbay_Lounge_%28ISRC_USUAN1700068%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "clearair", "file": "clearair.src", "start": 4, "len": 16, "title": "Clear Air", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Clear_Air_(ISRC_USUAN1100626).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/4/45/Clear_Air_%28ISRC_USUAN1100626%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "desertcity", "file": "desertcity.src", "start": 4, "len": 16, "title": "Desert City", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Desert_City_(ISRC_USUAN1100564).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/3/30/Desert_City_%28ISRC_USUAN1100564%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "fluidscape", "file": "fluidscape.src", "start": 4, "len": 16, "title": "Fluidscape", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Fluidscape_(ISRC_USUAN1100393).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/1/1b/Fluidscape_%28ISRC_USUAN1100393%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "gymnopedie1", "file": "gymnopedie1.src", "start": 4, "len": 16, "title": "Gymnopedie No. 1", "artist": "Kevin MacLeod (incompetech.com), after Erik Satie", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Gymnopedie_No._1_(ISRC_USUAN1100787).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/2/2a/Gymnopedie_No._1_%28ISRC_USUAN1100787%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "jazzbrunch", "file": "jazzbrunch.src", "start": 4, "len": 16, "title": "Jazz Brunch", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Jazz_Brunch_(ISRC_USUAN1700074).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/9/9b/Jazz_Brunch_%28ISRC_USUAN1700074%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "lagoav1", "file": "lagoav1.src", "start": 4, "len": 16, "title": "Lagoa v1", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Lagoa_v1_(ISRC_USUAN1100864).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/7/7b/Lagoa_v1_%28ISRC_USUAN1100864%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "leblon", "file": "leblon.src", "start": 4, "len": 16, "title": "Leblon", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Leblon_(ISRC_USUAN1100866).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/a/a3/Leblon_%28ISRC_USUAN1100866%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "localforecasts", "file": "localforecasts.src", "start": 4, "len": 16, "title": "Local Forecast - Slower", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Local_Forecast_-_Slower_(ISRC_USUAN1300011).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/0/04/Local_Forecast_-_Slower_%28ISRC_USUAN1300011%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "longstroll", "file": "longstroll.src", "start": 4, "len": 16, "title": "Long Stroll", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Long_Stroll_(ISRC_USUAN1100174).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/9/9f/Long_Stroll_%28ISRC_USUAN1100174%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "mariachisnooze", "file": "mariachisnooze.src", "start": 1, "len": 16, "title": "Mariachi Snooze", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Mariachi_Snooze_(ISRC_USUAN1100166).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/5/5d/Mariachi_Snooze_%28ISRC_USUAN1100166%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "mellowtron", "file": "mellowtron.src", "start": 1, "len": 16, "title": "Mellowtron", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Mellowtron_(ISRC_USUAN1300020).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/7/7a/Mellowtron_%28ISRC_USUAN1300020%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "sambaisobel", "file": "sambaisobel.src", "start": 4, "len": 16, "title": "Samba Isobel", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Samba_Isobel_(ISRC_USUAN1700071).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/1/13/Samba_Isobel_%28ISRC_USUAN1700071%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "sidewalkshade", "file": "sidewalkshade.src", "start": 4, "len": 16, "title": "Sidewalk Shade", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Sidewalk_Shade_(ISRC_USUAN1200103).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/7/7b/Sidewalk_Shade_%28ISRC_USUAN1200103%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "smoothlovin", "file": "smoothlovin.src", "start": 4, "len": 16, "title": "Smooth Lovin", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Smooth_Lovin_(ISRC_USUAN1700077).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/9/99/Smooth_Lovin_%28ISRC_USUAN1700077%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "somewheresunny", "file": "somewheresunny.src", "start": 1, "len": 16, "title": "Somewhere Sunny", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Somewhere_Sunny_(ISRC_USUAN1100493).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/0/0c/Somewhere_Sunny_%28ISRC_USUAN1100493%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "walkingalong", "file": "walkingalong.src", "start": 4, "len": 16, "title": "Walking Along", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Walking_Along_(ISRC_USUAN1100020).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/c/c8/Walking_Along_%28ISRC_USUAN1100020%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "aperohour", "file": "aperohour.src", "start": 4, "len": 16, "title": "Apero Hour", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Apero_Hour_(ISRC_USUAN1700070).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/9/94/Apero_Hour_%28ISRC_USUAN1700070%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "gardenmusic", "file": "gardenmusic.src", "start": 4, "len": 16, "title": "Garden Music", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Garden_Music_(ISRC_USUAN1500081).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/9/95/Garden_Music_%28ISRC_USUAN1500081%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "inspired", "file": "inspired.src", "start": 4, "len": 16, "title": "Inspired", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Inspired_(ISRC_USUAN1600022).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/a/a1/Inspired_%28ISRC_USUAN1600022%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "lewisanddekalb", "file": "lewisanddekalb.src", "start": 4, "len": 16, "title": "Lewis and Dekalb", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Lewis_and_Dekalb_(ISRC_USUAN1600027).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/9/97/Lewis_and_Dekalb_%28ISRC_USUAN1600027%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "shadesofspring", "file": "shadesofspring.src", "start": 4, "len": 16, "title": "Shades of Spring", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Shades_of_Spring_(ISRC_USUAN1100080).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/1/13/Shades_of_Spring_%28ISRC_USUAN1100080%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "slowjam", "file": "slowjam.src", "start": 4, "len": 16, "title": "Slow Jam", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Slow_Jam_(ISRC_USUAN1600015).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/5/53/Slow_Jam_%28ISRC_USUAN1600015%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "tranquilitybas", "file": "tranquilitybas.src", "start": 4, "len": 16, "title": "Tranquility Base", "artist": "Kevin MacLeod (incompetech.com)", "legacy": False, "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0/", "source": "https://commons.wikimedia.org/wiki/File:Tranquility_Base_(ISRC_USUAN1100614).mp3", "url": "https://upload.wikimedia.org/wikipedia/commons/c/c3/Tranquility_Base_%28ISRC_USUAN1100614%29.mp3?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original"},
    {"id": "gull", "file": "gull.src", "start": 0, "len": 18, "amb": True,
     "title": "Gull 1 (gull calls)", "artist": "avphillips",
     "license": "Public domain", "license_url": "https://commons.wikimedia.org/wiki/File:Gull_1.ogg",
     "source": "https://commons.wikimedia.org/wiki/File:Gull_1.ogg",
     "url": "https://upload.wikimedia.org/wikipedia/commons/4/43/Gull_1.ogg"},
    {"id": "citybird", "file": "citybird.src", "start": 0, "len": 65, "amb": True,
     "title": "Bird sings in the morning with cars in the background", "artist": "ezwa",
     "license": "Public domain", "license_url": "https://commons.wikimedia.org/wiki/File:Bird_sings_in_the_morning_with_cars_in_the_background.ogg",
     "source": "https://commons.wikimedia.org/wiki/File:Bird_sings_in_the_morning_with_cars_in_the_background.ogg",
     "url": "https://upload.wikimedia.org/wikipedia/commons/c/c3/Bird_sings_in_the_morning_with_cars_in_the_background.ogg"},
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
        if m.get("amb"):
            if not src.exists():
                subprocess.run(["curl", "-sf", "-A", UA, "-o", str(src), m["url"]], timeout=180)
            continue
        if not dst.exists() and not src.exists():  # stingers are committed; sources only needed to re-cut them
            subprocess.run(["curl", "-sf", "-A", UA, "-o", str(src), m["url"]], timeout=180)
            time.sleep(3)  # be gentle with Wikimedia (429s)
        if not dst.exists() and src.exists():
            L = m["len"]
            af = f"afade=t=in:d={1.5 if m.get('bed') else 0.8},afade=t=out:st={L-3}:d=3,loudnorm=I={-26 if m.get('bed') else -19}:TP=-2"
            ffmpeg("-ss", str(m["start"]), "-t", str(L), "-i", str(src), "-af", af, "-ac", "2", "-ar", "44100",
                   "-c:a", "libmp3lame", "-b:a", "96k", str(dst))
        for kind, L, fo in (("short", 7, 2.5), ("break", 30, 4)) if m.get("legacy", True) else (("break", 30, 4),):
            out = mdir / f"{kind}_{m['id']}.mp3"
            if not m.get("bed") and not out.exists() and src.exists():
                ffmpeg("-ss", str(m["start"] + (0 if kind == "short" else 3)), "-t", str(L), "-i", str(src), "-af",
                       f"afade=t=in:d=0.6,afade=t=out:st={L-fo}:d={fo},loudnorm=I=-19:TP=-2", "-ac", "2", "-ar", "44100",
                       "-c:a", "libmp3lame", "-b:a", "96k", str(out))
        bed = mdir / f"bed_{m['id']}.mp3"
        if m.get("legacy", True) and not m.get("bed") and not bed.exists() and src.exists():  # 45 s bed under station IDs
            ffmpeg("-ss", str(m["start"]), "-t", "45", "-i", str(src), "-af",
                   "afade=t=in:d=2,afade=t=out:st=41:d=4,loudnorm=I=-24:TP=-3", "-ac", "2", "-ar", "44100",
                   "-c:a", "libmp3lame", "-b:a", "80k", str(bed))
        under = mdir / f"under_{m['id']}.mp3"
        if not m.get("bed") and not under.exists() and src.exists():  # <=150 s bed that plays (looped) under the dialogue
            UL = max(20.0, min(150.0, duration(src) - m["start"] - 1))
            ffmpeg("-ss", str(m["start"]), "-t", f"{UL:.1f}", "-i", str(src), "-af",
                   f"afade=t=in:d=4,afade=t=out:st={UL-6:.1f}:d=6,lowpass=f=5000,loudnorm=I=-24:TP=-3", "-ac", "1", "-ar", "24000",
                   "-c:a", "libmp3lame", "-b:a", "40k", str(under))
    build_ambience()
    credits = [{k: m[k] for k in ("id", "title", "artist", "license", "license_url", "source")} for m in MUSIC]
    credits.append({"id": "wind", "title": "Desert wind (ambience)", "artist": "Generated for Radio BCS2050 (filtered noise)",
                    "license": "CC0 1.0", "license_url": "https://creativecommons.org/publicdomain/zero/1.0/", "source": "https://bajacaliforniasur2050.com"})
    dump(OUT / "credits.json", {"note": "Only CC0, public-domain or CC BY recordings; short excerpts, soft beds under the dialogue and ambience, with fades.",
                                "music": credits,
                                "voices": "Grok text-to-speech (xAI): voices 'rex' (host) and 'eve' (co-host)."})
    md = ["# Radio BCS2050 — music credits", "",
          "Only CC0, public-domain or CC BY recordings are used, as excerpts with fades (soft beds under the voices, ~30 s breaks).", "",
          "| Track | Artist | License | Source |", "|---|---|---|---|"]
    md += [f"| {m['title']} | {m['artist']} | [{m['license']}]({m['license_url']}) | {m['source']} |" for m in MUSIC]
    md += ["| Desert wind (ambience) | Generated for Radio BCS2050 from filtered noise | CC0 1.0 | scripts/bcs_radio.py |"]
    (ROOT / "RADIO_MUSIC_CREDITS.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    return {m["id"]: f"/radio/music/{m['id']}.mp3" for m in MUSIC}


AMB_LEN = 75


def build_ambience() -> None:
    """~75 s ambience loops (fade in/out so loops breathe): coast (PD waves + PD gulls), city (PD birds + cars),
    desert wind (generated here from filtered noise, CC0)."""
    mdir, srcd = OUT / "music", MUSIC_SRC
    coast, city, wind = mdir / "amb_coast.mp3", mdir / "amb_city.mp3", mdir / "amb_wind.mp3"
    tail = f"afade=t=in:d=3,afade=t=out:st={AMB_LEN-4}:d=4,loudnorm=I=-26:TP=-4"
    enc = ["-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "48k"]
    if not coast.exists() and (srcd / "pebble_beach.src").exists() and (srcd / "gull.src").exists():
        ffmpeg("-stream_loop", "2", "-i", str(srcd / "pebble_beach.src"), "-i", str(srcd / "gull.src"), "-filter_complex",
               "[1:a]volume=0.35,adelay=9000|9000,apad[g];[0:a][g]amix=inputs=2:duration=first:normalize=0,"
               f"atrim=0:{AMB_LEN},{tail}", *enc, str(coast))
    if not city.exists() and (srcd / "citybird.src").exists():
        ffmpeg("-stream_loop", "1", "-i", str(srcd / "citybird.src"), "-af", f"atrim=0:{AMB_LEN},highpass=f=120,{tail}", *enc, str(city))
    if not wind.exists():
        ffmpeg("-f", "lavfi", "-i", f"anoisesrc=color=brown:amplitude=0.6:duration={AMB_LEN}:seed=7", "-af",
               f"lowpass=f=520,highpass=f=60,volume='0.55+0.45*sin(2*PI*t/11)':eval=frame,{tail}", *enc, str(wind))


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
AMBIENCE = {"medio_ambiente": "coast", "turismo": "coast", "conectividad": "coast", "agua": "wind", "desarrollo": "wind"}
# everything else: city


# Fixed chapter plan of every deep dive (titles come from here, never from the model).
CHAPTERS = [  # ~20 min of continuous conversation per episode; music only under the voices, break between episodes
    ("entrada", "Entrada", "Cold open", 190),
    ("acto1", "Acto 1 · Lo que está pasando", "Act 1 · What's happening", 450),
    ("personas", "Las personas y los lugares", "People and places", 360),
    ("acto2", "Acto 2 · El hilo oculto", "Act 2 · The hidden thread", 400),
    ("sabias", "¿Sabías que…?", "Did you know?", 320),
    ("diseno", "El diseño invisible", "The hidden design", 350),
    ("acto3", "Acto 3 · Hacia 2050", "Act 3 · Toward 2050", 400),
    ("cierre", "Para llevar", "The takeaway", 200),
]


# ------------------------------------------------------------------ sources
def theme_of(text: str) -> list[str]:
    t = norm(text)
    return [k for k, (_, _, rx) in THEMES.items() if re.search(norm(rx), t)]


TAGS = {"water": {"agua": 2}, "environment": {"medio_ambiente": 2}, "tourism": {"turismo": 2}, "energy": {"infraestructura": 2},
        "land_use": {"urbanismo": 2}, "connectivity": {"conectividad": 1.5, "transporte": 1}, "planning": {"urbanismo": 1, "desarrollo": 0.5}}
_CLS: dict = {}


def classify(n: dict) -> dict:
    """Score each theme for a news item: title hits weigh 3, blurb hits 1, portal topic tags 0.5-2.
    The primary theme is the best score; a strong secondary (>= 4) also counts."""
    if n["id"] in _CLS:
        return _CLS[n["id"]]
    title = norm(" ".join([n.get("title_es", ""), n.get("title_en", "")]))
    blurb = norm(n.get("blurb_es", "")[:600])
    sc = {}
    for k, (_, _, rx) in THEMES.items():
        r = re.compile(norm(rx))
        v = 3 * len(set(r.findall(title))) + min(3, len(set(r.findall(blurb))))
        for tg in n.get("topics") or []:
            v += TAGS.get(tg, {}).get(k, 0)
        if v:
            sc[k] = v
    best = max(sc, key=sc.get) if sc else None
    out = {k: v for k, v in sc.items() if k == best or v >= 4}
    _CLS[n["id"]] = out
    return out


def in_theme(theme: str, n: dict) -> bool:
    return theme in classify(n)


def primary(n: dict):
    c = classify(n)
    return max(c, key=c.get) if c else None


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


def plan_episodes(today: str, hist: dict, news: list[dict]) -> list[str]:
    """The day's typed line-up: news first, then portal data, then the trend and the vision."""
    last = hist.get("theme_last", {})
    nt = pick_topics(today, hist, DAILY_PLAN["noticias"], news)
    dt = sorted(PF_THEMES, key=lambda k: (last.get("datos-" + k, ""), hashlib.md5((today + "d" + k).encode()).hexdigest()))
    return ([f"noticias-{t}" for t in nt] + [f"datos-{t}" for t in dt[:DAILY_PLAN["datos"]]] +
            ["tendencia"] * DAILY_PLAN["tendencia"] + ["vision"] * DAILY_PLAN["vision"])


def pick_topics(today: str, hist: dict, n: int, news: list[dict]) -> list[str]:
    used, last = set(hist.get("used", [])), hist.get("theme_last", {})
    fresh = {k: sum(1 for x in news[:150] if x["id"] not in used and primary(x) == k) for k in THEMES}
    order = sorted(THEMES, key=lambda k: (last.get(k, ""), hashlib.md5((today + k).encode()).hexdigest()))
    out = [k for k in order if fresh[k] >= 2][:n]
    return out + [k for k in order if k not in out][: n - len(out)]


def topic_pack(theme: str, hist: dict, news: list[dict], edu: list[dict]) -> dict:
    """Everything the portal knows about one theme, split by chapter."""
    used = set(hist.get("used", []))
    mine = [x for x in news if in_theme(theme, x)]
    first = [x for x in mine if primary(x) == theme]  # the episode leads with stories that are mainly about it
    fresh = [x for x in first if x["id"] not in used] or [x for x in mine if x["id"] not in used]
    now = (fresh or first or mine)[:4]
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
                "foresight_signals": [s[L] for s in d["foresight_signals"]], "portal_facts": d["portal_facts"]}
    if ch == "personas":
        return {"places": pack["places"], "municipalities": pack["municipios"], "tourism_inventory": pack["tourism"],
                "people_in_the_news": [tl(x) for x in pack["now"][:2]]}
    if ch == "diseno":
        d = pack["data"]
        return {"library_documents": d["library"], "ontology": d["ontology"], "knowledge_graph": [g[L] for g in pack["graph"]]}
    vv = pack["vision"]
    return {"vision_pillar": {k[:-3]: v for k, v in vv["pillar"].items() if v and k.endswith("_" + L)},
            "tendencia_2050": vv["tendencia_kicker"][L], "conditions": vv["conditions"][L],
            "watchlist": [w[L] for w in vv["watchlist"]]}


# ------------------------------------------------------------------ episode types
# Each daily episode has ONE type, so listeners always know what they are hearing:
#   noticias  = reality reported by the news feed (outlet + date)
#   datos     = reality measured in the portal's own database (GIS, CONAGUA/DMA, INEGI, documents, ontology)
#   tendencia = the portal's Tendencia 2050: a PROBABLE trend, not a fact
#   vision    = the portal's Visión 2050: an IDEAL, achievable future, not a forecast
KINDS = {"noticias": ("Noticias", "News"), "datos": ("Datos del portal", "Portal data"), "serie": ("Datos del portal", "Portal data"),
         "tendencia": ("Tendencia 2050", "Trend 2050"), "vision": ("Visión 2050", "Vision 2050")}
DAILY_PLAN = {"noticias": 3, "datos": 2, "tendencia": 1, "vision": 1}  # 7 episodes x ES/EN, ~20 min each
KIND_MUSIC = {"tendencia": "economia", "vision": "medio_ambiente"}  # music/ambience for state-wide episodes
PF_THEMES = {"agua": ["agua"], "medio_ambiente": ["ambiente", "riesgos"], "turismo": ["turismo"], "economia": ["economia"],
             "conectividad": ["conectividad"], "urbanismo": ["territorio", "planeacion"],
             "infraestructura": ["energia", "proyectos-federales"]}
STATUS = {
    "noticias": ("REALITY reported by the news. Signpost it: 'según la nota de <outlet> del <fecha>…' / 'according to "
                 "<outlet>'s report from <date>…'. Use ONLY the news items in SOURCES; no portal analysis, no forecasts."),
    "datos": ("REALITY measured in the portal's database. Signpost it: 'los datos del portal muestran…', 'según la capa / "
              "el documento / la base de <fuente> que integra el portal…' (EN: 'the portal's data shows…'). Name the original "
              "source (CONAGUA, INEGI, DOF…) and year when given. No news, no forecasts."),
    "tendencia": ("a PROBABLE TREND, not a fact. Say clearly and repeatedly that this is the portal's Tendencia 2050: "
                  "'la tendencia del portal apunta a…', 'es una probabilidad, no un hecho' (EN: 'the portal's Trend 2050 "
                  "points to… it is a probability, not a fact'). Give probabilities exactly as in SOURCES; when a claim cites "
                  "a measured source, say it is the data behind the trend."),
    "vision": ("an IDEAL but ACHIEVABLE FUTURE, not a forecast and not a fact. Say clearly that this is the portal's Visión "
               "2050: 'la visión del portal propone…', 'es un futuro deseable y posible, no una predicción' (EN: 'the portal's "
               "Vision 2050 proposes… a desirable, achievable future, not a prediction'). When a lever or risk cites a measured "
               "fact, say so."),
}
STATUS["serie"] = STATUS["datos"] + (" Say what the map shows in words (what is drawn, where it concentrates). Flag data "
                                     "gaps and limits honestly. If a record is a projection or a plan, say so explicitly.")
KIND_CHAPTERS = {
    "noticias": [("entrada", "Entrada", "Cold open", 190), ("titulares", "Lo que pasó", "What happened", 450),
                 ("mas", "Más noticias", "More news", 400), ("contexto", "El contexto", "The context", 380),
                 ("lugares", "Dónde y a quién", "Where and who", 330), ("claves", "Qué significa", "What it means", 380),
                 ("pendientes", "Lo que falta saber", "What we still don't know", 330), ("cierre", "Para pensar", "Food for thought", 210)],
    "datos": [("entrada", "Entrada", "Cold open", 190), ("cifras", "Las cifras", "The numbers", 430),
              ("territorio", "El territorio", "The territory", 400), ("documentos", "Los documentos", "The documents", 380),
              ("sistema", "Cómo se conecta", "How it connects", 360), ("sabias", "¿Sabías que…?", "Did you know?", 340),
              ("lectura", "Cómo leer los datos", "How to read the data", 340), ("cierre", "Para pensar", "Food for thought", 210)],
    "tendencia": [("entrada", "Entrada", "Cold open", 190), ("cambio", "Qué cambió esta semana", "What changed this week", 400),
                  ("escenarios", "Los escenarios", "The scenarios", 420), ("senales", "Las señales", "The signals", 400),
                  ("datos_base", "Los datos detrás", "The data behind it", 400), ("vigilar", "Qué vigilar", "What to watch", 350),
                  ("incertidumbre", "Lo que podría cambiar", "What could change it", 330), ("cierre", "Para pensar", "Food for thought", 210)],
    "vision": [("entrada", "Entrada", "Cold open", 190), ("pilares1", "Agua y costa", "Water and coast", 420),
               ("pilares2", "Turismo y economía", "Tourism and economy", 420), ("pilares3", "Energía y movilidad", "Energy and mobility", 400),
               ("pilares4", "Vivienda y gobierno", "Housing and governance", 400), ("condiciones", "Las condiciones", "The conditions", 380),
               ("palancas", "Las palancas", "The levers", 330), ("cierre", "Para pensar", "Food for thought", 210)],
}
PILLAR_GROUPS = {"pilares1": ["agua", "costa_clima"], "pilares2": ["turismo", "economia"],
                 "pilares3": ["energia", "movilidad"], "pilares4": ["vivienda", "gobernanza"]}
KIND_BRIEF = {
    "entrada": "COLD OPEN: lead with ONE hook from SOURCES (the most surprising or important item: what, where, who, "
               "source, status) in a quick, lively exchange. Then this is Radio BCS2050, a friendly hello, the two hosts "
               "introduce themselves by first name ({host} and {cohost}), today's episode '{topic}', the concrete question "
               "it will answer, and a teaser of something surprising coming later in the episode.",
    "titulares": "The latest news, one story at a time: what, where, who, when, outlet, why it matters for BCS; a reaction "
                 "and a follow-up question for each. No greeting.",
    "mas": "More of today's news not yet told, same method (outlet + date for each). No greeting.",
    "contexto": "Earlier news on this topic: what thread connects them over the weeks (dates and outlets). Facts only from "
                "these news items. No greeting.",
    "lugares": "Where these stories happen and who is involved (municipalities, institutions, companies, people named in "
               "the news). Practical consequences for residents, only as reported. No greeting.",
    "claves": "What the news means, explained simply: causes and consequences stated in the reports, who decides, what "
              "changes for people. Clearly separate what was reported from your own questions. No greeting.",
    "pendientes": "What the reports leave open: unanswered questions, next dates or decisions mentioned, what to follow. "
                  "One reflective question for the audience. No greeting.",
    "cifras": "The key figures from the portal's database for this topic, one per turn, each with its original source and "
              "year, explained with an everyday comparison. No greeting.",
    "territorio": "The territory in the data: places, municipalities, aquifers or layers in SOURCES, where things are and "
                  "how they differ. No greeting.",
    "documentos": "The documents in the portal's library: name the organisation and year, what each says and why it "
                  "matters. No greeting.",
    "sistema": "How the pieces connect, from the portal's ontology and knowledge graph: what depends on what. No metaphors. "
               "No greeting.",
    "sabias": "DID YOU KNOW: one surprising fact from the data, explained clearly with its source; then 1-2 related facts. "
              "Light humor. No greeting.",
    "lectura": "How to read these data: what each measure means, its year and source, its limits (what it does NOT tell "
               "us). One reflective question for the audience. No greeting.",
    "mapa": "WHAT THE MAP SHOWS: walk the listener through the portal's map layers for this topic in plain words — what "
            "is drawn, how many features, where they concentrate, what the categories mean, the source. One layer at a time. "
            "No greeting.",
    "lagunas": "WHAT WE STILL DON'T KNOW: the data gaps and limits (missing layers, estimates, outdated years, model caveats), "
               "said honestly, and why they matter for decisions. One reflective question for the audience. No greeting.",
    "cambio": "What changed this week in the portal's Tendencia 2050 (headline, change, leading theme), framed as a "
              "probable trend. No greeting.",
    "escenarios": "The scenarios and their probabilities and weekly changes, exactly as in SOURCES; what each scenario "
                  "means in plain words. Always: probabilities, not facts. No greeting.",
    "senales": "The signals the trend reads: the claims and signals in SOURCES, each with its source; say which are "
               "measured facts and which are interpretation. No greeting.",
    "datos_base": "The measured data behind the trend (claims with sources, series), clearly labelled as the data behind "
                  "the trend. No greeting.",
    "vigilar": "What to watch in the coming weeks (watchlist), and what would confirm or weaken the trend. No greeting.",
    "incertidumbre": "What could change the trend and how confident the portal is (confidence levels, method note). "
                     "One reflective question for the audience. No greeting.",
    "pilares1": "The Vision's pillars in SOURCES: for each, the documented risk (a fact, say so), the aspiration (the "
                "ideal) and the levers. Make the difference between fact and aspiration explicit. No greeting.",
    "pilares2": "Same method for these pillars: risk (fact) → aspiration (ideal) → levers. No greeting.",
    "pilares3": "Same method for these pillars: risk (fact) → aspiration (ideal) → levers. No greeting.",
    "pilares4": "Same method for these pillars: risk (fact) → aspiration (ideal) → levers. No greeting.",
    "condiciones": "The Vision's conditions: what must be true for this future to happen, explained one by one. No greeting.",
    "palancas": "Which levers are already under way (as documented) and which are only proposals; who would have to act. "
                "One reflective question for the audience. No greeting.",
    "cierre": "FOOD FOR THOUGHT: in plain words, without figures, recall the episode's 1-2 key points by name (places, "
              "institutions, issues — no meta-talk about the format; name the content type in one short phrase only), "
              "say what it changes for people in BCS, and ask the audience 1-2 direct, concrete reflective "
              "questions (e.g. '¿Y tú, qué harías…?'). Warm, brief, no preaching. Then: stay with us, more Radio "
              "BCS2050 after the music (in the show's language).",
}


# ------------------------------------------------------------------ portal data series (permanent catalog)
# slug: (title_es, title_en, music theme, record regex, map-layer id regex)
SERIES = {
    "acuiferos": ("Acuíferos y disponibilidad de agua", "Aquifers and water availability", "agua",
                  r"acu[ií]fer|aquifer|dma|disponibilidad|conagua", r"acuiferos|focus_water"),
    "presas_desalacion": ("Presas, desalación y abasto", "Dams, desalination and supply", "agua",
                          r"presa|dam\b|desal|abasto|oomsapas|planta de tratamiento|reuse|re[uú]so", r"presas|focus_water"),
    "escorrentia": ("Escorrentía y cuencas", "Runoff and watersheds", "agua",
                    r"escorrent|runoff|cuenca|watershed|arroyo|hidrosheds|hydrosheds", r"escorrentia|waterways"),
    "energia_red": ("Plantas, red eléctrica y subestaciones", "Power plants, grid and substations", "infraestructura",
                    r"energ|el[eé]ctric|subestaci|substation|cfe|cenace|planta|power|sibcs|apag", r"energy|power"),
    "proyectos_federales": ("Proyectos federales en el estado", "Federal projects in the state", "infraestructura",
                            r"federal|sexenio|proyecto|project|inversi[oó]n p[uú]blica", r"federal_projects"),
    "localidades": ("Localidades y población", "Towns and population", "urbanismo",
                    r"localidad|locality|poblaci|population|inegi|censo|census|habitantes|vivienda", r"settlements|towns|municipalities"),
    "edificios": ("El mapa de los edificios", "The map of buildings", "urbanismo",
                  r"edific|building|altura|height|footprint|densidad|density|pisos|storey", r"edificios|density|vivienda_multifamiliar"),
    "vivienda": ("Vivienda y mercado inmobiliario", "Housing and the property market", "desarrollo",
                 r"vivienda|housing|inmobiliar|real estate|invi|listing|precio|renta|multifamiliar", r"market|vivienda"),
    "anp": ("Áreas naturales protegidas y vegetación", "Protected areas and vegetation", "medio_ambiente",
            r"anp|protegid|protected|reserva|biosfera|conanp|vegetaci|vegetation|rtp|conabio|manglar", r"anp|protected|rtp|cobertura"),
    "costa": ("Costa, playas y riesgo costero", "Coast, beaches and coastal risk", "medio_ambiente",
              r"costa|coast|playa|beach|erosi|oleaje|surge|litoral|nivel del mar|sea level", r"coast|beaches|haz_coast"),
    "ciclones_inundaciones": ("Ciclones, inundaciones y drenaje pluvial", "Hurricanes, floods and storm drains", "medio_ambiente",
                              r"cicl[oó]n|cyclone|hurac|hurricane|inund|flood|pluvial|drenaje|storm", r"inundaciones|desagues|haz_cyclone"),
    "calor_sequia": ("Calor, sequía e incendios", "Heat, drought and wildfire", "medio_ambiente",
                     r"calor|heat|sequ[ií]a|drought|incendi|fire|temperatura|temperature|clima|climate", r"haz_heat|haz_drought|haz_fire|temperature"),
    "turismo_inventario": ("El inventario turístico", "The tourism inventory", "turismo",
                           r"hotel|cuartos|rooms|turis|touris|ocupaci|occupancy|visitant|crucer|cruise", r"zzz"),
    "aeropuertos": ("Aeropuertos y rutas aéreas", "Airports and air routes", "conectividad",
                    r"aeropuert|airport|ruta|route|vuelo|flight|pasajer|passenger|iata|sjd|lap\b|lto", r"ports_air|transport_nodes"),
    "carreteras": ("Carreteras, tráfico y cuellos de botella", "Roads, traffic and bottlenecks", "transporte",
                   r"carreter|highway|road|tr[aá]fico|traffic|sict|tdpa|cuello|bottleneck|velocidad|speed", r"highway|traffic|bottleneck|limites"),
    "movilidad_urbana": ("Ciclovías, carga eléctrica y movilidad urbana", "Bike lanes, EV charging and urban mobility", "transporte",
                         r"ciclov|bike|bicicleta|carga|charging|el[eé]ctrico|movilidad|mobility|transporte p[uú]blico|bus", r"ciclovias|reparto|estaciones_carga"),
    "crecimiento_urbano": ("Crecimiento urbano por municipio", "Urban growth by municipality", "urbanismo",
                           r"crecimiento|growth|mancha urbana|urban|expansi|municipio|demanda|supply|oferta", r"density_muni|focus_corridor|focus_east|focus_places"),
    "ordenamiento": ("Ordenamiento ecológico y planes urbanos", "Ecological zoning and urban plans", "urbanismo",
                     r"ordenamiento|poer|uga|zonific|zoning|plan de desarrollo|pdu|programa|instrumento", r"poer|ran_nucleos"),
    "tierra_agricultura": ("Tierra agrícola, ejidos y economía rural", "Farmland, ejidos and rural economy", "economia",
                           r"agr[ií]col|farm|ejid|n[uú]cleo agrario|ran\b|pesca|fishing|ganad|rural|cultivo", r"agricultura|ran_nucleos"),
    "brechas_datos": ("Lo que el portal todavía no sabe", "What the portal still doesn't know", "economia",
                      r"brecha|gap|falta|missing|no disponible|unavailable|pendiente|caveat|limit", r"zzz"),
}
SERIES_CHAPTERS = [("entrada", "Entrada", "Cold open", 190), ("cifras", "Las cifras", "The numbers", 430),
                   ("mapa", "Qué muestra el mapa", "What the map shows", 420), ("territorio", "El territorio", "The territory", 380),
                   ("documentos", "Los documentos", "The documents", 340), ("sabias", "¿Sabías que…?", "Did you know?", 330),
                   ("lagunas", "Lo que falta saber", "What we still don't know", 340), ("cierre", "Para pensar", "Food for thought", 210)]
DATA_FILES = {  # file: (label for the source, list key or None)
    "aquifers_bcs.json": ("CONAGUA, disponibilidad de acuíferos (DOF 2023)", "aquifers"),
    "maps_gallery.json": ("mapas del atlas del portal", None), "analysis_layers.json": ("capas de análisis del portal", None),
    "data_inventory.json": ("inventario de datos del portal", "datasets"), "data_gaps.json": ("brechas de datos del portal", "gaps"),
    "top_localities.json": ("INEGI, censo de población y vivienda 2020", None), "tierra_agua.json": ("capas de tierra y agua", None),
    "escorrentia.json": ("modelo de escorrentía del portal", None), "growth_demand_supply.json": ("análisis de crecimiento, demanda y oferta", None),
    "inmobiliario_metrics.json": ("métricas inmobiliarias del portal", None), "flight_connections_bcs.json": ("rutas aéreas sin escalas", "airports"),
    "ports_demand.json": ("demanda de aeropuertos y puertos", "airports"), "federal_projects.json": ("proyectos federales", "projects"),
    "territorio_social.json": ("capas de territorio social", None), "geokg_summary.json": ("modelo de crecimiento urbano con imágenes Sentinel-2", None),
    "plans_archive.json": ("archivo de planes e instrumentos", "plans"), "strategic_questions.json": ("preguntas estratégicas del portal", "questions"),
    "tourism_detail.json": ("inventario turístico", "hotels"),
}
_SKIP_KEYS = re.compile(r"^(path|file|files|src|url|urls|p|n|geometry|coords|bbox|center|color|icon|id|ontology_id|source_file|"
                        r"source_page|desktop|markdown|fich\w*|drive\w*)$", re.I)


def _records(obj, key=None) -> list:
    if key and isinstance(obj, dict):
        obj = obj.get(key, [])
    if isinstance(obj, list):
        return [x for x in obj if isinstance(x, dict)]
    if isinstance(obj, dict):  # dict of dicts or a single record with list fields
        vals = [v for v in obj.values() if isinstance(v, dict)]
        return vals if len(vals) >= 3 else [obj]
    return []


def _clean(x, depth=0):
    if isinstance(x, dict):
        return {k: _clean(v, depth + 1) for k, v in x.items() if not _SKIP_KEYS.match(str(k)) and v not in (None, "", [], {})}
    if isinstance(x, list):
        return [_clean(v, depth + 1) for v in x[:8]]
    if isinstance(x, str) and re.search(r"\.(pdf|md|json|geojson|qgz|xlsx|csv|jpg|png)\b|/[\w-]+/", x):
        return None
    return x


def gis_summary() -> dict:
    """What each map layer shows: name, meaning, legend, source and simple counts (cached)."""
    cache = CACHE / "gis_summary.json"
    if cache.exists() and time.time() - cache.stat().st_mtime < 7 * 86400:
        return load(cache, {})
    gis = ROOT / "public" / "gis"
    out = {}
    layers = load(gis / "layers.json", []) or []
    al = {x.get("id"): x for x in (load(DATA / "analysis_layers.json", []) or [])}
    for f in sorted((gis / "analysis").glob("*.geojson")):
        meta = al.get(f.stem) or al.get(f.stem.replace("haz_", "")) or {}
        layers.append({"id": "analysis_" + f.stem, "url": f"/gis/analysis/{f.name}",
                       **{k: v for k, v in meta.items() if k not in ("id", "url")},
                       "name_es": meta.get("name_es") or f.stem.replace("_", " ")})
    for ly in layers:
        info = {k: v for k, v in ly.items() if k in ("name_es", "name_en", "legend_es", "legend_en", "label_ciudadano", "que_significa",
                                                     "source_es", "source_en", "group_es", "group_en", "fuente", "source")}
        fp = gis / str(ly.get("url", "")).replace("/gis/", "", 1)
        try:
            if fp.suffix == ".geojson" and fp.exists() and fp.stat().st_size < 40e6:
                feats = (load(fp, {}) or {}).get("features", [])
                info["features"] = len(feats)
                props: dict = {}
                for ft in feats[:5000]:
                    for k, v in (ft.get("properties") or {}).items():
                        if isinstance(v, str) and len(v) < 60:
                            props.setdefault(k, {}).setdefault(v, 0)
                            props[k][v] += 1
                cats = {k: dict(sorted(v.items(), key=lambda kv: -kv[1])[:8]) for k, v in props.items()
                        if 1 < len(v) <= 25 and not _SKIP_KEYS.match(k)}
                names = next((list(v)[:12] for k, v in props.items() if re.match(r"(name|nombre|nom_\w+|NOMBRE|nom)$", k)), [])
                if cats:
                    info["categories"] = dict(list(cats.items())[:4])
                if names:
                    info["examples"] = names
        except Exception:  # noqa: BLE001
            pass
        out[ly["id"]] = info
    bi = load(gis / "edificios" / "index.json", {}) or {}
    out["edificios"] = {"name_es": "Edificios (huellas y alturas)", **{k: v for k, v in bi.items() if isinstance(v, (str, int, float))}}
    cache.parent.mkdir(parents=True, exist_ok=True)
    dump(cache, out)
    return out


def series_pack(slug: str, hist: dict) -> dict:
    t_es, t_en, mus, rx, lrx = SERIES[slug]
    R = re.compile(rx, re.I)
    recs = []
    for f, (label, key) in DATA_FILES.items():
        for x in _records(load(DATA / f, {}) or {}, key):
            c = _clean(x)
            txt = json.dumps(c, ensure_ascii=False)
            if c and R.search(txt):
                recs.append({"dataset": label, "record": json.loads(clip(txt, 700)) if txt.endswith("}") and len(txt) <= 700 else clip(txt, 700)})
    facts = [{**{k: x.get(k) for k in ("metric", "value", "unit", "year")}, "source": source_label(x.get("source", ""))}
             for x in (load(DATA / "portal_facts.json", {}) or {}).get("facts", [])
             if R.search(" ".join(str(x.get(k, "")) for k in ("metric", "theme", "source", "id")))]
    gis = gis_summary()
    maps = [v for k, v in gis.items() if re.search(lrx, k) or R.search(json.dumps(v, ensure_ascii=False)[:400])][:8]
    lib = [{"title": x["title"], "org": x.get("org"), "year": x.get("year"), "why": clip(x.get("relevance", ""), 260)}
           for x in (load(DATA / "library.json", {}) or {}).get("items", [])
           if R.search(" ".join([x.get("title", ""), x.get("relevance", ""), " ".join(x.get("tags") or [])]))][:6]
    onto = [{"label": x.get("label"), "summary": clip(x.get("summary", ""), 300)}
            for x in (load(DATA / "ontology_factors.json", {}) or {}).get("nodes", []) if x.get("summary") and R.search(x.get("label", "") + x.get("summary", ""))][:4]
    graph = [{"label": x.get("label"), "summary": clip(x.get("summary", ""), 300)}
             for x in (load(DATA / "graph.json", {}) or {}).get("nodes", []) if x.get("summary") and R.search(x.get("label", "") + x.get("summary", ""))][:4]
    gaps = [r_ for r_ in recs if r_["dataset"] in ("brechas de datos del portal",)][:6]
    muni = {k: {kk: vv for kk, vv in v.items() if not isinstance(vv, (list, dict))}
            for k, v in (load(DATA / "municipios.json", {}) or {}).items() if isinstance(v, dict)}
    places = [clip(json.dumps(_clean({k: v for k, v in pl.items()}), ensure_ascii=False), 700)
              for pl in (load(DATA / "place_dossiers.json", {}) or {}).get("places", []) if R.search(json.dumps(pl, ensure_ascii=False))][:3]
    other = [r_ for r_ in recs if r_ not in gaps]
    return {"theme": slug, "kind": "serie", "ids": [], "now": [], "older": [], "label_es": f"Datos del portal · {t_es}",
            "label_en": f"Portal data · {t_en}", "series": {"facts": facts[:40], "records": other[:30], "maps": maps, "library": lib,
                                                              "ontology": onto + graph, "gaps": gaps, "municipios": muni, "places": places}}


def series_sources(pack: dict, ch: str, L: str) -> dict:
    d = pack["series"]
    f, rc = d["facts"], d["records"]
    return {"entrada": {"key_facts": f[:3], "key_records": rc[:2], "map": d["maps"][:1]},
            "cifras": {"portal_facts": f[:16], "records": rc[:6]},
            "mapa": {"map_layers": d["maps"], "note": "describe what each map shows: what is drawn, where it concentrates, what the colours/categories mean"},
            "territorio": {"records": rc[6:18], "municipalities": d["municipios"], "places": d["places"]},
            "documentos": {"library_documents": d["library"], "ontology_and_graph": d["ontology"], "records": rc[18:24]},
            "sabias": {"portal_facts": f[16:32] or f[:8], "records": rc[24:30] or rc[:4]},
            "lagunas": {"data_gaps": d["gaps"], "map_layers_with_limits": [{k: v for k, v in m.items() if "legend" in k or "name" in k} for m in d["maps"]],
                        "facts": f[:6]},
            "cierre": {"topic": pack["label_" + L], "what_was_covered": [x.get("metric") for x in f[:10]] + [m.get("name_" + L) or m.get("name_es") for m in d["maps"][:4]]}}[ch]


def music_theme(eid: str) -> str:
    """Music/ambience theme for an episode id ('noticias-agua' -> 'agua'; 'tendencia' -> its KIND_MUSIC)."""
    kind, _, theme = eid.partition("-")
    if theme in SERIES:
        return SERIES[theme][2]
    if theme in TOPIC:
        return theme
    return KIND_MUSIC.get(kind, eid if eid in TOPIC else "economia")


def chapters_for(pack: dict) -> list:
    return SERIES_CHAPTERS if pack.get("kind") == "serie" else KIND_CHAPTERS.get(pack.get("kind", ""), CHAPTERS)


def plain(text: str, L: str) -> str:
    """Strip statistical jargon from portal prose before it reaches the script writer."""
    text = re.sub(r";?\s*EWMA\s*[\d.,]+", "", text or "")
    text = re.sub(r"\bEWMA\b", "intensidad reciente" if L == "es" else "recent intensity", text)
    return re.sub(r";?\s*z\s*=?\s*-?[\d.]+", "", text)


def source_label(src: str) -> str:
    """Speakable source names: never read file paths or URLs on air."""
    m = re.match(r"guides/([a-z_-]+)\.md", src or "")
    if m:
        return f"guía temática del portal ({m.group(1).replace('-', ' ')})"
    m = re.match(r"https?://(?:www\.)?([^/]+)", src or "")
    return m.group(1) if m else (src or "")


def kind_pack(kind: str, theme: str | None, hist: dict, news: list[dict], edu: list[dict]) -> dict:
    """Sources for one typed episode; each type sees only its own kind of material."""
    if kind == "noticias" and theme == "semana":  # the week's most relevant news across all themes
        today_ = max((n.get("date", "") for n in news), default=date.today().isoformat())
        since = (date.fromisoformat(today_) - timedelta(days=7)).isoformat()
        week = [n for n in news if n.get("date", "") > since]
        def weight(n):
            sc = classify(n)
            return (max(sc.values()) if sc else 0) + 0.5 * len(n.get("feeds_into") or []) + (1 if n.get("place_ids") else 0)
        ranked, seen_t = [], {}
        for n in sorted(week, key=weight, reverse=True):  # relevance, at most 2 stories per theme
            t = primary(n) or "otro"
            if seen_t.get(t, 0) < 2:
                ranked.append(n)
                seen_t[t] = seen_t.get(t, 0) + 1
        def item(x, n_=650):
            return {"id": x["id"], "outlet": x.get("source", ""), "date": x.get("date", ""), "url": x["url"],
                    "title_es": x.get("title_es", ""), "title_en": x.get("title_en", ""),
                    "facts_es": clip(x.get("blurb_es", ""), n_), "facts_en": clip(x.get("blurb_en", ""), n_)}
        p = {"theme": "semana", "now": [item(x) for x in ranked[:7]], "older": [item(x, 380) for x in ranked[7:15]],
             "expres_de_unic": [], "ids": [x["id"] for x in ranked[:7]]}
        tn = ("Lo más relevante de la semana", "The week's most relevant news")
    elif kind in ("noticias", "datos"):
        p = topic_pack(theme, hist, news, edu)
        tn = THEMES[theme]
    else:
        p = {"theme": theme or kind, "ids": [], "now": [], "older": []}
        tn = ("", "")
    p["kind"] = kind
    p["label_es"] = KINDS[kind][0] + (f" · {tn[0]}" if tn[0] else "")
    p["label_en"] = KINDS[kind][1] + (f" · {tn[1]}" if tn[1] else "")
    v = load(DATA / "foresights_vision.json", {}) or {}
    i = load(DATA / "foresights_ideal.json", {}) or {}
    if kind == "noticias" and theme != "semana":
        p["now"] = p["now"] + [x for x in p["older"] if x not in p["now"]][:2]  # a fuller news slate
    if kind == "datos":
        pf = [x for x in (load(DATA / "portal_facts.json", {}) or {}).get("facts", [])
              if x.get("theme") in PF_THEMES.get(theme, [])]
        rot = int(hashlib.md5((date.today().isoformat() + theme).encode()).hexdigest(), 16)
        pf = (pf[rot % len(pf):] + pf[:rot % len(pf)])[:30] if pf else p["data"]["portal_facts"]
        p["data"]["portal_facts"] = [{**{k: x.get(k) for k in ("metric", "value", "unit", "year")},
                                      "source": source_label(x.get("source", ""))} for x in pf]
        if theme == "agua":
            aq = (load(DATA / "aquifers_bcs.json", {}) or {}).get("aquifers", [])
            p["aquifers"] = [{"clave": a.get("clave"), "nombre": a.get("nombre"), "dma_hm3": round(a["dma_hm3"], 2),
                              "status": a.get("status"), "source": a.get("source")} for a in aq if a.get("dma_hm3") is not None][:20]
    if kind == "tendencia":
        sig = v.get("signals_week") or v.get("signals") or []
        p["trend"] = {
            "updated": v.get("updated"), "title": {L: v.get(f"title_{L}") for L in ("es", "en")},
            "kicker": {L: clip(v.get(f"kicker_{L}", ""), 600) for L in ("es", "en")},
            "change": {L: plain(clip(v.get(f"change_{L}", ""), 900), L) for L in ("es", "en")},
            "narrative": {L: plain(clip(v.get(f"narrative_{L}", ""), 1500), L) for L in ("es", "en")},
            "scenarios": {L: [{"scenario": (v.get("scenario_meta") or {}).get(k, {}).get(f"label_{L}", k),
                                "what_it_means": (v.get("scenario_meta") or {}).get(k, {}).get(f"blurb_{L}", ""),
                                "probability": f"{x['p'] * 100:.1f} %",
                                "weekly_change": f"{x['delta'] * 100:+.1f} " + ("puntos" if L == "es" else "points")}
                               for k, x in (v.get("scenarios") or {}).items() if isinstance(x, dict) and "p" in x]
                          for L in ("es", "en")},
            "claims": [{"es": c.get("es"), "en": c.get("en"), "confidence": c.get("confidence"),
                        "source": ", ".join(c.get("sources") or [])} for c in v.get("claims", [])],
            "signals": [clip(json.dumps(x, ensure_ascii=False), 400) for x in (sig if isinstance(sig, list) else [sig])][:8],
            "method": {L: clip(v.get(f"method_note_{L}", ""), 600) for L in ("es", "en")},
            "watchlist": [{"es": w.get("item_es"), "en": w.get("item_en")} for w in ((load(DATA / "foresights.json", {}) or {}).get("watchlist") or [])][:8],
        }
    if kind == "vision":
        p["ideal"] = {
            "updated": i.get("updated"), "title": {L: i.get(f"title_{L}") for L in ("es", "en")},
            "kicker": {L: clip(i.get(f"kicker_{L}", ""), 600) for L in ("es", "en")},
            "lead": {L: clip(i.get(f"lead_{L}", ""), 900) for L in ("es", "en")},
            "pillars": {pl.get("id"): {k: pl.get(k) for k in ("label_es", "label_en", "risk_es", "risk_en", "aspiration_es",
                                                               "aspiration_en", "levers_es", "levers_en")} for pl in i.get("pillars", [])},
            "conditions": {L: i.get(f"conditions_{L}") or [] for L in ("es", "en")},
        }
    return p


GENERIC_TITLE = re.compile(r"^(fuentes de datos|datos del portal|datos de|portal data|data on|data sources|"
                           r"informaci[oó]n del portal)", re.I)


def episode_meta(ed_dir: Path, ep: dict, avoid: str = "") -> None:
    """Podcast-style episode title + short show notes (ES/EN) from the finished scripts; sets ep in place."""
    text = {}
    for L in ("es", "en"):
        sc = load(ed_dir / ep["topic"] / L / "script.json", {}) or {}
        t = " ".join(x["text"] for c in sc.get("chapters", [])[:4] for x in c["turns"])
        text[L] = re.sub(r"\[[a-z-]+\]|</?soft>", "", t)[:5000]
    if not text["es"]:
        return
    kind = KINDS.get(ep.get("kind"), ("", ""))
    try:
        r = http_json("https://api.x.ai/v1/chat/completions", {
            "model": MODEL, "temperature": 0.5, "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content":
                "You title podcast episodes. From the transcript, write a specific, informative episode title (max 70 "
                "characters, no clickbait, no colon-subtitle clichés) that states the episode's single most concrete "
                "finding or story — what, where, ideally with one key figure from the transcript (e.g. '22 de 39 "
                "acuíferos de BCS en déficit', 'Los Cabos concentra la conectividad aérea del estado'). Never generic "
                "titles about sources or data ('Fuentes de datos…', 'Datos del portal sobre…', 'Portal data on…'). Show notes of "
                "1-2 plain sentences (max 220 characters) saying what the listener will learn. Use ONLY facts in the "
                "transcript; no numbers that are not in it. The episode type is '" + kind[1] + "'. Return JSON "
                '{"title_es","title_en","desc_es","desc_en"} (Mexican Spanish / English).'},
                {"role": "user", "content": json.dumps({"type_es": kind[0], "topic_es": ep.get("name_es"), "transcript_es": text["es"],
                                                        "transcript_en": text["en"], **({"too_generic_do_not_reuse": avoid} if avoid else {})},
                                                       ensure_ascii=False)}]})
        txt = r["choices"][0]["message"]["content"]
        m = json.loads(txt[txt.find("{"): txt.rfind("}") + 1])
        if any(GENERIC_TITLE.search(m.get(k, "")) for k in ("title_es", "title_en")) and not avoid:
            return episode_meta(ed_dir, ep, m.get("title_es") or m.get("title_en") or "generic")  # one retry
        for k in ("title_es", "title_en", "desc_es", "desc_en"):
            if m.get(k):
                ep[k] = clip(str(m[k]).strip(), 90 if k.startswith("title") else 260)
    except Exception as e:  # noqa: BLE001  titles are a nicety; never fail the edition
        print(f"  WARN: title for {ep['topic']} failed: {e}", file=sys.stderr)


def number_episodes(today: str, episodes: list, hist: dict) -> None:
    """Sequential podcast numbers across editions; a same-day rebuild reuses the day's numbers."""
    base = hist.setdefault("ep_base", {})
    if today not in base:
        base[today] = hist.get("ep_total", 0) + 1
    for k, ep in enumerate(episodes):
        ep["number"] = base[today] + k
    hist["ep_total"] = max(hist.get("ep_total", 0), base[today] + len(episodes) - 1)


def kind_sources(pack: dict, ch: str, L: str) -> dict:
    kind = pack["kind"]
    if kind == "serie":
        return series_sources(pack, ch, L)
    tl = lambda x: {k[:-3]: v for k, v in x.items() if not k.endswith("_es" if L == "en" else "_en")}
    if kind == "noticias":
        now, older = [tl(x) for x in pack["now"]], [tl(x) for x in pack["older"]]
        heads = [x["title"] for x in now]
        return {"entrada": {"headlines": heads, "lead_story": now[:1]}, "titulares": {"latest_news": now[:3]},
                "mas": {"more_news": now[3:] or older[:3], "already_told": heads[:3]},
                "contexto": {"earlier_news": older, "expres_de_unic_video_titles": pack["expres_de_unic"]},
                "lugares": {"news": now}, "claves": {"news": now}, "pendientes": {"news": now + older[:3]},
                "cierre": {"headlines": heads}}[ch]
    if kind == "datos":
        d = pack["data"]
        pf = d["portal_facts"]
        return {"entrada": {"one_fact": pf[:2]}, "cifras": {"portal_facts": pf[:14]},
                "territorio": {"places": pack["places"], "municipalities": pack["municipios"],
                               "aquifers": pack.get("aquifers", []), "tourism_inventory": pack["tourism"]},
                "documentos": {"library_documents": d["library"], "foresight_archive": [x[L] for x in pack["fs_archive"]]},
                "sistema": {"ontology": d["ontology"], "knowledge_graph": [g[L] for g in pack["graph"]]},
                "sabias": {"portal_facts": pf[14:30] if len(pf) > 20 else pf}, "lectura": {"portal_facts": pf, "aquifers": pack.get("aquifers", [])[:6]},
                "cierre": {"topic": pack["label_" + L], "what_was_measured": sorted({x["metric"] for x in pf if x.get("metric")})[:15]}}[ch]
    if kind == "tendencia":
        t = pack["trend"]
        cl = [{"text": c[L], "confidence": c["confidence"], "source": c["source"]} for c in t["claims"]]
        return {"entrada": {"title": t["title"][L], "kicker": t["kicker"][L], "updated": t["updated"], "change": t["change"][L]},
                "cambio": {"change": t["change"][L], "updated": t["updated"]},
                "escenarios": {"scenarios": t["scenarios"][L], "narrative": t["narrative"][L]},
                "senales": {"signals": t["signals"], "claims": cl[:7]}, "datos_base": {"claims": cl},
                "vigilar": {"watchlist": [w[L] for w in t["watchlist"]], "change": t["change"][L]},
                "incertidumbre": {"method": t["method"][L], "claims": cl, "scenarios": t["scenarios"][L]},
                "cierre": {"title": t["title"][L], "kicker": t["kicker"][L],
                           "scenarios": [{"scenario": x["scenario"], "what_it_means": x["what_it_means"]} for x in t["scenarios"][L]]}}[ch]
    iv = pack["ideal"]
    pil = lambda ids: [{k[:-3] if k.endswith(("_es", "_en")) else k: v for k, v in iv["pillars"].get(x, {}).items()
                        if not k.endswith("_es" if L == "en" else "_en")} for x in ids]
    if ch in PILLAR_GROUPS:
        return {"pillars": pil(PILLAR_GROUPS[ch])}
    return {"entrada": {"title": iv["title"][L], "kicker": iv["kicker"][L], "lead": iv["lead"][L]},
            "condiciones": {"conditions": iv["conditions"][L]},
            "palancas": {"pillars_levers": [{"pillar": x.get("label"), "levers": x.get("levers")} for x in pil(list(iv["pillars"]))]},
            "cierre": {"title": iv["title"][L], "kicker": iv["kicker"][L],
                       "aspirations": [{"pillar": x.get("label"), "aspiration": x.get("aspiration")} for x in pil(list(iv["pillars"]))]}}[ch]


# ------------------------------------------------------------------ writing
STYLE = """You write one chapter of 'Radio BCS2050', a deep-dive radio show about Baja California Sur (Mexico) on its
way to 2050. Today's episode (~20 minutes) is: {topic}.
{kind_rule}
EDITORIAL PRIORITY: inform clearly first, then help the listener understand why it matters for Baja California Sur.
Use plain, precise journalistic {lang}, not poetic or philosophical language. Every chapter opens with its concrete
reported news or documented finding: WHAT happened/was found, WHERE, WHO is involved, WHEN (only if supplied), the named
SOURCE, then WHY IT MATTERS for BCS. Spread those details across natural turns; do not cram them into a list.
If a chapter contains only portal analysis, label it as analysis/aspiration, state the documented finding first and
explain what is known vs what remains uncertain. Never turn a scenario into a reported outcome.
Keep the useful details, chronology, responsibilities, practical consequences and open questions. Explain unfamiliar
terms simply. No invented scenes, sensory padding, sea/desert metaphors, lyrical images or grand philosophical questions.
Not pure data: after the facts, help listeners care and think. Awareness and reflection are welcome in short, grounded
beats (one per chapter at most), and the episode asks the AUDIENCE 1-3 direct reflective questions in total
('¿Y usted/tú qué opinas…?', 'What would you…?'), mainly in the closing chapter. Clear narration: listeners must always
know whether something is reported news, portal data, a probable trend or an ideal vision.
Tone: warm, sunny, playful and curious; two friends explaining the news intelligently and having fun doing it.
Humor and laughter come from natural reactions, never from tragedy or affected people. Never preach or hype.
Two voices: HOST {host} (warm, curious, steers the conversation) and CO-HOST {cohost} (quick, witty, brings the facts).
In the opening chapter they greet the audience and introduce themselves by first name once, in the episode's language
(Spanish: 'Soy {host}…' / 'y yo soy {cohost}'; English: 'I'm {host}…' / 'and I'm {cohost}'); later they call each
other by name now and then. Never use any other host names.
In English episodes translate every Spanish label from SOURCES ('guía temática del portal' → 'the portal's topic guide',
'hm³/año' → 'cubic hectometres a year'). Never say acronyms such as DMA aloud: say 'water availability' / 'disponibilidad
de agua' instead.
ENTERTAINMENT (keep the audience listening; this must be FUN, not a lecture):
- Real host chemistry: friendly banter, light teasing, playful disagreement that resolves with the facts, shared
  laughs. Humor comes from the situation and the hosts' reactions — never forced jokes, puns on tragedy, or mockery.
- Curiosity hooks and teasers that pay off later (Spanish: 'y en un momento te cuento por qué…', 'aguántame tantito…';
  English: 'hold that thought…', 'stick around for this one…'). Stay 100 % in the episode's language.
- Surprising, concrete comparisons a listener can picture (only with numbers from SOURCES; a comparison object
  without digits like 'more than a soccer stadium' is fine only when it does not add a new fact).
- Short anecdotes and local references tied to REAL places named in SOURCES (La Paz, Los Cabos, Loreto, Mulegé,
  Comondú, the malecón, the Transpeninsular…), never invented events or people.
- Recurring mini-segments the hosts name out loud, e.g. «El dato que nadie te contó» / "The number nobody told you",
  «¿Y eso con qué se come?» / "So what does that mean for me?", «Mapa en mano» / "Map in hand".
- Varied rhythm: quick back-and-forth runs, then a slower explanatory turn; a question to the listener mid-episode.
Still professional: facts accurate and attributed, the source (news vs portal data) and status (reality / trend /
vision) stay clear, no invented facts, no poetic excess.
MOOD: bright, warm, sunny and optimistic — two friends who are genuinely happy to be talking about this place.
They laugh easily, get excited by a good detail, tease each other kindly, and find hope even in hard news,
while keeping the reporting accurate and useful. Use these delivery tags naturally, 2-4 per chapter (at least one [laugh] or [chuckle]):
[laugh], [chuckle], [pause], [breath], [sigh], and <soft>…</soft> around a quiet phrase. No other tags.
THIS IS A REAL TWO-PERSON CONVERSATION, not a reading:
- Natural turns: mostly full spoken sentences of 10-35 words, with an occasional longer reflective turn (up to 50)
  and an occasional tiny reaction. Never choppy one-line ping-pong. Alternate speakers; never 3 turns in a row by one voice.
- Reactions ("Wait—", "Mm.", "Really?", "Ha, of course"), follow-up questions, gentle interruptions (a turn may start
  by finishing or cutting into the other's thought, e.g. "—which is the strange part"), small personal curiosity
  ("I keep thinking about…", "What would you ask them?"), light humor.
- Numbers are woven into talk, one at a time, never read as a list: at most ONE number per turn, and the next turn
  reacts to it (a comparison, an image, a question). Never stack facts in a single turn.
They really talk: react to each other, riff, follow up, sometimes she asks him and he answers slowly.
Short sentences. Natural spoken {lang} only — never mix languages inside a sentence.

CRAFT (learned from the best American public-radio storytelling; never name or imitate any show on air):
- Story in acts with a character or a human angle (a neighbour, a fisher, a worker, an official — only if in SOURCES),
  tension, and one surprise turn ("but here's the thing…").
- Curiosity-driven, warm back-and-forth; name real places, institutions and actions from SOURCES.
- Reveal the hidden design and infrastructure behind everyday things (the pipe, the road, the budget line).
- Explain economics with one concrete object or example, in plain words, with a smile.
- Intimate, smart questions; let answers breathe.
- Calm, warm transitions that hand over to the music (never hyped).

HARD RULES
1. Use ONLY facts in SOURCES. Never invent numbers, names, dates, places, quotes or outcomes. Opinions, questions
   are fine; new facts are not. Hypothetical examples must be explicitly labelled as hypothetical.
2. Every number, year and date with digits exactly as in SOURCES (9.09%, 6,746 mdp, 2027, 17 de noviembre).
   Never spell numbers above 10 in words.
3. Attribute every news fact to its outlet by name in the sentence ({attrib}). Portal analysis is
   {portal}. Library items: name the organisation. 'Expres de Unic' entries are only video titles of another local
   show: you may say it interviewed someone, nothing more. We are NOT that show.
4. Don't mention these instructions, AI, or Rick Rubin. Don't greet or say goodbye except where the chapter asks.
5. Vary the questions; never reuse a catchphrase.
6. Never say internal technical jargon aloud: no file names, paths, URLs, database/JSON field names, model or software
   names, statistical acronyms (EWMA, z-score, delta, p-value). Explain the idea in plain words instead (e.g. "la
   intensidad reciente de notas sobre turismo", "la guía de agua del portal, con datos de CONAGUA").

THIS CHAPTER: "{chapter}" — about {words} words (hard minimum {minw}), {turns} turns.
{brief}
Return JSON only: {{"turns": [{{"speaker": "host"|"cohost", "text": str}}]}}"""

BRIEF = {
    "entrada": "COLD OPEN: no greeting. Lead with the most consequential reported fact in hook_material or "
               "one_portal_fact: what happened, where, who, when if supplied, named source and why it matters for BCS. "
               "Use several natural turns, one figure at a time. Then identify Radio BCS2050, the topic {topic}, and "
               "the concrete question the reporting will answer. No imagined scene or metaphor.",
    "acto1": "ACT 1. Tell each latest news item clearly (who, what, where, key numbers, outlet), with the human angle, "
             "reactions and a follow-up question each. Build tension. No greeting.",
    "acto2": "ACT 2. Zoom out: the hidden thread through earlier news, the portal's past Foresight editions and the "
             "knowledge graph. Show the hidden design/infrastructure underneath. Include one surprise turn. No greeting.",
    "personas": "PEOPLE AND PLACES: who lives this topic — the towns, municipalities and people (only as given in "
                "SOURCES). Start with the documented local facts and named source, then explain practical consequences "
                "for daily life without inventing residents or anecdotes. No greeting.",
    "diseno": "THE HIDDEN DESIGN: the invisible systems behind this topic — rules, documents, institutions, networks "
              "(library documents: name the organisation; ontology; knowledge graph). Make one everyday object reveal the "
              "system behind it, without metaphor. State the documented rule or finding and source first. No greeting.",
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
    "cierre": "THE TAKEAWAY: briefly restate the established finding and named source in plain language, without figures. "
              "Explain what it changes for BCS, who is responsible and what remains unknown (only as in SOURCES). "
              "No new claims, no metaphor, no list. Reflection at most one short closing exchange, then a warm handover "
              "to the music: stay with us, more Radio BCS2050 after the music (in the show's language).",
}


def write_chapter(pack: dict, ch: tuple, L: str, today: str, feedback: str = "", draft: dict | None = None):
    cid, t_es, t_en, w = ch
    from datetime import date as _d
    dd = _d.fromisoformat(today)
    mes = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
           "noviembre", "diciembre"][dd.month - 1]
    dstr = f"{dd.day} de {mes} de {dd.year}" if L == "es" else dd.strftime("%B %-d, %Y")
    kind = pack.get("kind")
    topic = pack[f"label_{L}"] if kind else THEMES[pack["theme"]][0 if L == "es" else 1]
    src = kind_sources(pack, cid, L) if kind else chapter_sources(pack, cid, L)
    kind_rule = (f"EPISODE TYPE: {KINDS[kind][0 if L == 'es' else 1]}. Everything in it is {STATUS[kind]}" if kind else "")
    brief = (KIND_BRIEF if kind else BRIEF)[cid]
    sysmsg = STYLE.format(topic=topic, host=pack.get("names", NAMES)["host"], cohost=pack.get("names", NAMES)["cohost"],
                          lang="Mexican Spanish" if L == "es" else "English",
                          attrib='"según Diario Humano…", "informa Meganoticias…"' if L == "es" else '"Gringo Gazette reports…"',
                          portal='"la Tendencia 2050 del portal", "la Visión del portal", "el Foresight del portal"' if L == "es"
                          else '"the portal\'s Trend 2050", "the portal\'s Vision", "the portal\'s Foresight"',
                          chapter=t_es if L == "es" else t_en, words=int(w * 1.5), minw=w, kind_rule=kind_rule,
                          turns=f"{max(6, w // 24)}-{max(8, w // 16)}", brief=brief.format(date=dstr, topic=topic, host=pack.get("names", NAMES)["host"],
                                                                              cohost=pack.get("names", NAMES)["cohost"]))
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


def conversation_lint(turns: list, cid: str) -> list[str]:
    msgs, run = [], 1
    for k, t in enumerate(turns):
        txt = t.get("text", "")
        n = len(NUM.findall(txt))
        if n > 2 or (n > 1 and cid in ("entrada", "cierre")):
            msgs.append(f"turn {k+1} stacks {n} numbers (one per turn, then a reaction): {txt[:90]}")
        if len(txt.split()) > 45:
            msgs.append(f"turn {k+1} is a monologue ({len(txt.split())} words; keep turns short): {txt[:90]}")
        if k and t.get("speaker") == turns[k - 1].get("speaker"):
            run += 1
            if run == 3:
                msgs.append(f"turns {k-1}-{k+1}: same speaker three times in a row")
        else:
            run = 1
    if cid == "cierre" and any(NUM.search(t.get("text", "")) for t in turns):
        msgs.append("the takeaway must contain no numbers")
    return msgs


WRONG_STATUS = {"serie": r"tendencia 2050|trend 2050|visi[oó]n 2050|vision 2050", "tendencia": r"\bvisi[oó]n\b|\bvision\b|aspiraci|ideal", "noticias": r"tendencia 2050|trend 2050|visi[oó]n 2050|vision 2050", "datos": r"tendencia 2050|trend 2050|visi[oó]n 2050|vision 2050"}


JARGON = re.compile(r"\bEWMA\b|z-?score|\bdelta\b|p-?value|\bjson\b|\bgrok\b|\bxai\b|\bllm\b|\.md\b|\.json\b|https?://|www\.|"
                    r"\b[a-z]+_[a-z_]+\b|guides/", re.I)


def jargon_lint(turns: list, cid: str) -> list[str]:
    """No internal jargon on air, and the closing asks the audience at most 2 questions."""
    msgs = [f"turn {k+1} says internal jargon '{m.group(0)}' aloud; explain it in plain words: {t['text'][:90]}"
            for k, t in enumerate(turns) for m in [JARGON.search(t.get("text", ""))] if m]
    if cid == "cierre":
        q = sum(1 for t in turns if "?" in t.get("text", ""))
        if q > 2:
            msgs.append(f"the closing asks {q} questions; keep only the 1-2 best reflective questions for the audience")
    return msgs


def status_lint(turns: list, kind: str | None) -> list[str]:
    """An episode never mislabels its own status (a trend called a vision, etc.)."""
    if kind not in WRONG_STATUS:
        return []
    return [f"turn {k+1} mislabels the content (this episode is {KINDS[kind][1]}, say so consistently): {t['text'][:90]}"
            for k, t in enumerate(turns) if re.search(WRONG_STATUS[kind], t.get("text", ""), re.I)]


def make_chapter(pack: dict, ch: tuple, L: str, today: str) -> list:
    out, src_text, w = write_chapter(pack, ch, L, today)
    turns = out.get("turns", [])
    lint = conversation_lint(turns, ch[0]) + status_lint(turns, pack.get("kind")) + jargon_lint(turns, ch[0])
    if lint:
        out, src_text, _ = write_chapter(pack, ch, L, today, "Make it more of a real conversation. Fix:\n" + "\n".join(lint) +
                                         f"\nKeep the same facts and AT LEAST {w} words; split long turns, add reactions and follow-ups.",
                                         {"turns": turns})
        turns = out.get("turns", turns)
    for _ in range(2):
        if words(turns) >= w * 0.9:
            break
        out, src_text, _ = write_chapter(pack, ch, L, today, f"Only {words(turns)} words; reach at least {w}. Keep every turn "
                                         "and ADD natural conversational turns: reactions, follow-ups, laughter, practical explanations, and SOURCES facts not yet told "
                                         "(one number per turn at most).",
                                         {"turns": turns})
        turns = out.get("turns", turns)
    turns = [t for t in turns if not JARGON.search(t.get("text", ""))]
    if ch[0] == "cierre":
        qs = [k for k, t in enumerate(turns) if "?" in t.get("text", "")]
        drop = set(qs[1:-1]) if len(qs) > 2 else set()  # keep the first and the last question
        turns = [t for k, t in enumerate(turns) if k not in drop]
    return polish(pack, ch, L, today, turns, src_text)


def polish(pack: dict, ch: tuple, L: str, today: str, turns: list, src_text: str) -> list:
    if ch[0] == "cierre":  # the takeaway carries no figures
        turns = [t for t in turns if not NUM.search(t.get("text", ""))]
    bad = fact_guard(turns, src_text, today)
    if bad:
        out, src_text, _ = write_chapter(pack, ch, L, today, "Fix ONLY these sentences (use exact digits from SOURCES or drop "
                                         "the number); keep everything else word for word:\n" + "\n".join(bad), {"turns": turns})
        turns = out.get("turns", turns)
        bad = fact_guard(turns, src_text, today)
        turns = [t for t in turns if not any(b.endswith(t.get("text", "")[:140]) for b in bad)]
    clean = []
    for t in turns:
        txt = re.sub(r"\[(?!(?:laugh|chuckle|pause|long-pause|breath|sigh)\])[a-z_ -]+\]|<(?!/?soft>)[^>]+>", "",
                     t.get("text", "")).strip()
        if txt:
            clean.append({"speaker": "cohost" if t.get("speaker") == "cohost" else "host", "text": txt})
    return clean


MIN_EP, TARGET_EP = 19.75 * 60, 20.75 * 60  # every episode must run a full ~20 min, checked on the rendered audio


def extend_chapter(pack: dict, ch: tuple, L: str, today: str, turns: list, add: int) -> list:
    out, src_text, _ = write_chapter(pack, ch, L, today,
        f"The episode runs short. Keep EVERY existing turn word for word and in the same order, and ADD about {add} words "
        "of NEW turns where they fit naturally: reactions, follow-ups, laughter, a concrete implication or place, a follow-up question to the "
        "other host, and SOURCES facts not yet told (exact digits, one number per turn). Turns of 10-35 words; never three "
        "turns in a row by one speaker." + (" No numbers at all in this chapter." if ch[0] == "cierre" else ""), {"turns": turns})
    new = out.get("turns", [])
    if words(new) <= words(turns) + 20:
        return turns
    new = polish(pack, ch, L, today, new, src_text + " " + json.dumps(turns, ensure_ascii=False))
    return new if words(new) > words(turns) else turns


def fit_length(theme: str, pack: dict, today: str, lang: str, chapters: list, durs: list, edir: Path) -> list:
    """Measure the rendered episode; while it is under MIN_EP, lengthen the chapters furthest below their word target
    and re-render only those. Returns the (possibly longer) chapters; durs is updated in place."""
    c = ep_cast(today, theme)
    amb, V = cast_amb(theme), cast_voices(c)
    for rnd in range(4):
        total = sum(durs)
        if total >= MIN_EP:
            break
        wps = max(1.5, sum(words(t) for t in chapters) / max(1.0, total))
        need = int((TARGET_EP - total) * wps)
        CH = chapters_for(pack)
        order = sorted(range(len(chapters)), key=lambda k: words(chapters[k]) / CH[k][3])
        pick = [k for k in order if CH[k][0] != "cierre"][:max(2, min(6, -(-need // 140)))]
        share = {k: CH[k][3] for k in pick}
        add = {k: max(60, int(need * 1.15 * share[k] / sum(share.values()))) for k in pick}
        print(f"  [{theme}/{lang}] {total/60:.1f} min < {MIN_EP/60:.1f}: +{need} words over chapters {[k+1 for k in pick]} (round {rnd+1})")
        with ThreadPoolExecutor(len(pick)) as ex:
            new = dict(zip(pick, ex.map(lambda k: extend_chapter(pack, CH[k], lang, today, chapters[k], add[k]), pick)))
        for k, t in new.items():
            if t is not chapters[k]:
                chapters[k] = t
                durs[k] = render_chapter(t, lang, edir / f"{k+1:02d}.mp3", k == 0, cast_bed(c, k + 1, len(chapters)), amb, V)
    return chapters


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


def render_chapter(turns: list, lang: str, dest: Path, opening: bool, under: Path | None, amb: Path | None,
                   voices: dict | None = None) -> float:
    V = voices or VOICES
    with ThreadPoolExecutor(6) as ex:
        clips = list(ex.map(lambda t: tts(t["text"], V[t["speaker"]], lang), turns))
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        parts = []
        sil = td / "sil.wav"
        ffmpeg("-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "0.8", str(sil))
        for k, c in enumerate(clips):
            w = td / f"t{k}.wav"
            tempo = TEMPO.get(V[turns[k]["speaker"]])
            ffmpeg("-i", str(c), *(["-af", f"atempo={tempo}"] if tempo else []), "-ar", "24000", "-ac", "1", str(w))
            parts += [w, sil]
        lst = td / "list.txt"
        lst.write_text("".join(f"file '{p}'\n" for p in parts))
        voice = td / "voice.wav"
        ffmpeg("-f", "concat", "-safe", "0", "-i", str(lst), "-ar", "24000", "-ac", "1", str(voice))
        lead = 2.5 if opening else 0.6
        D = duration(voice) + lead + 1.8
        ins, labels = ["-i", str(voice)], []
        mv, av = (0.30, 0.22) if opening else (0.13, 0.16)  # music / ambience level before ducking
        for k, (f, vol) in enumerate(((under, mv), (amb, av))):
            if f and f.exists():
                ins += ["-stream_loop", "-1", "-i", str(f)]
                labels.append(f"[{len(labels)+1}:a]aresample=24000,aformat=channel_layouts=mono,volume={vol}[b{k}];")
        if not labels:
            ffmpeg("-i", str(voice), "-af", "loudnorm=I=-17:TP=-1.5", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k", str(dest))
            return duration(dest)
        tags = "".join(re.findall(r"\[b\d\]", "".join(labels)))
        fc = ("".join(labels) +
              (f"{tags}amix=inputs={len(labels)}:duration=longest:normalize=0[bg0];" if len(labels) > 1 else f"{tags}anull[bg0];") +
              f"[bg0]atrim=0:{D:.2f},afade=t=in:d=1.2,afade=t=out:st={D-2.2:.2f}:d=2.2[bg];"
              f"[0:a]adelay={int(lead*1000)},apad=whole_dur={D:.2f},asplit[v][vk];"
              "[bg][vk]sidechaincompress=threshold=0.02:ratio=8:attack=30:release=600:makeup=1[duck];"
              "[v][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-17:TP=-1.5")
        ffmpeg(*ins, "-filter_complex", fc, "-t", f"{D:.2f}", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k", str(dest))
    return duration(dest)


# ------------------------------------------------------------------ cast: hosts + music per episode
def bed_pool() -> list:
    return [m["id"] for m in MUSIC if not (m.get("bed") or m.get("amb"))]


def load_cast() -> dict:
    return load(CAST_FILE, {}) or {}


def ep_cast(day: str, eid: str) -> dict:
    """Hosts (voice pair) and music (3 beds that change between acts + the break after the episode)."""
    c = load_cast().get(f"{day}/{eid}") or {}
    return {"pair": c.get("pair", 0), "beds": c.get("beds") or [TOPIC[music_theme(eid)][1]], "break": c.get("break")}


def cast_voices(c: dict) -> dict:
    a, b = PAIRS[c["pair"]]
    return {"host": a, "cohost": b}


def cast_names(c: dict) -> dict:
    v = cast_voices(c)
    return {k: VNAME[x] for k, x in v.items()}


def cast_bed(c: dict, k: int, n: int) -> Path:
    """Bed under chapter k (1-based) of n: the bed changes between acts (opening / middle / closing third)."""
    beds = c["beds"]
    return OUT / "music" / f"under_{beds[min(len(beds) - 1, (k - 1) * len(beds) // max(1, n))]}.mp3"


def cast_amb(eid: str) -> Path:
    return OUT / "music" / f"amb_{AMBIENCE.get(music_theme(eid), 'city')}.mp3"


def catalog_order(today: str | None = None, today_topics: list | None = None) -> list:
    """Loop order of the station (newest edition first, edition order inside), as 'date/topic' keys."""
    eds = sorted((p.name for p in (OUT / "editions").iterdir() if (p / "edition.json").exists()), reverse=True)
    if today and today not in eds:
        eds = sorted(eds + [today], reverse=True)
    out = []
    for d in eds:
        e = load(OUT / "editions" / d / "edition.json", {}) or {}
        if e and e.get("format") != "podcast-episodes":
            continue
        tops = [x["topic"] for x in e.get("episodes", [])]
        if d == today and today_topics:
            tops += [t for t in today_topics if t not in tops]
        out += [f"{d}/{t}" for t in tops]
    return out


def assign_cast(order: list, fresh: set) -> dict:
    """Give each episode a host pair and music so neighbours in the loop never share a pair or a track.
    Fresh keys get a rotating voice pair; older episodes keep their recorded pair (pair 0 = Tomás + Luz)."""
    cast, pool, n = load_cast(), bed_pool(), len(order)
    for key in fresh:
        cast.pop(key, None)
    pair_use = {k: 0 for k in range(len(PAIRS))}
    track_use = {m: 0 for m in pool}
    for c in cast.values():
        pair_use[c.get("pair", 0)] = pair_use.get(c.get("pair", 0), 0) + 1
        for m in c.get("beds", []) + [c.get("break")]:
            if m in track_use:
                track_use[m] += 1
    for i, key in enumerate(order):
        if key in cast and cast[key].get("beds") and cast[key].get("break"):
            continue
        nb = [cast.get(order[(i - 1) % n]) or {}, cast.get(order[(i + 1) % n]) or {}] if n > 1 else []
        if key in fresh:
            bad = {x.get("pair") for x in nb}
            pair = min((p for p in range(len(PAIRS)) if p not in bad), key=lambda p: (pair_use[p], p))
        else:
            pair = (cast.get(key) or {}).get("pair", 0)
        busy = {m for x in nb for m in x.get("beds", []) + [x.get("break")]}
        h = int(hashlib.sha1(key.encode()).hexdigest(), 16)
        rank = sorted((m for m in pool if m not in busy), key=lambda m: (track_use[m], (h + pool.index(m) * 7919) % 997))
        beds, brk = rank[:3], rank[3]
        cast[key] = {"pair": pair, "beds": beds, "break": brk,
                     "hosts": [VNAME[v] for v in PAIRS[pair]], "voices": list(PAIRS[pair])}
        pair_use[pair] += 1
        for m in beds + [brk]:
            track_use[m] += 1
    dump(CAST_FILE, dict(sorted(cast.items())))
    return cast


# ------------------------------------------------------------------ main
def build_episode(theme: str, pack: dict, today: str, lang: str, music: dict, script_only: bool) -> dict:
    t0 = time.time()
    CH = chapters_for(pack)
    with ThreadPoolExecutor(len(CH)) as ex:
        chapters = list(ex.map(lambda ch: make_chapter(pack, ch, lang, today), CH))
    edir = OUT / "editions" / today / ".staging" / theme / lang  # swapped into place only when every episode succeeded
    shutil.rmtree(edir, ignore_errors=True)
    edir.mkdir(parents=True, exist_ok=True)
    sig, stings = TOPIC[music_theme(theme)][1], TOPIC[music_theme(theme)][2]
    c = ep_cast(today, theme)
    amb, V = cast_amb(theme), cast_voices(c)
    durs = [0.0 if script_only else render_chapter(t, lang, edir / f"{k:02d}.mp3", k == 1, cast_bed(c, k, len(chapters)), amb, V)
            for k, t in enumerate(chapters, 1)]
    if not script_only:
        chapters = fit_length(theme, pack, today, lang, chapters, durs, edir)
    tracks, total = [], 0.0
    for k, (ch, turns) in enumerate(zip(CH, chapters), 1):
        dur = durs[k - 1]
        pick = (stings + [sig])[(k - 1) % (len(stings) + 1)]
        sting = None  # continuous conversation; the station puts an ID + music break between episodes
        total += dur + (duration(ROOT / "public" / sting.lstrip("/")) if sting else 0)
        tracks.append({"n": k, "id": ch[0], "title": ch[1] if lang == "es" else ch[2],
                       "src": f"/radio/editions/{today}/{theme}/{lang}/{k:02d}.mp3", "duration": dur, "sting": sting})
    title = f"{pack.get('label_' + lang) or THEMES[theme][0 if lang == 'es' else 1]} · Radio BCS2050"
    dump(edir / "script.json", {"topic": theme, "lang": lang, "title": title, "hosts": cast_names(c), "voices": V,
                                "music": c["beds"],
                                "chapters": [{"id": c[0], "title": c[1] if lang == "es" else c[2], "turns": t}
                                             for c, t in zip(CH, chapters)]})
    print(f"  [{theme}/{lang}] {sum(words(t) for t in chapters)} words, {total/60:.1f} min ({time.time()-t0:.0f}s)")
    return {"title": title, "duration": round(total, 1), "tracks": tracks,
            "script": f"/radio/editions/{today}/{theme}/{lang}/script.json", "words": sum(words(t) for t in chapters)}


STING_LEN: dict = {}
TTS_SPEED = 0.94  # unhurried

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
SWITCH_HOUR = 12  # new schedules go on air at the next 12:00 Europe/Madrid, so the live loop never jumps mid-day
STORE = Path(os.environ.get("BCS_RADIO_STORE", "/cursor/stores/store-fc6b39be-e5cc-45bc-92bf-16b8f06bfaac/radio_bcs2050"))
STORE_CAP_MB = 3000  # permanent catalog (~7 MB per episode-language)


def next_switch(now=None) -> str:
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Europe/Madrid")
    now = now or datetime.now(tz)
    t = now.replace(hour=SWITCH_HOUR, minute=0, second=0, microsecond=0)
    if t <= now:
        t += timedelta(days=1)
    return t.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ts(iso: str) -> float:
    from datetime import datetime
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def station_srcs() -> set:
    out = set()
    for lang in ("es", "en"):
        for sc in (load(OUT / f"station_{lang}.json", {}) or {}).get("schedules", []):
            out |= {x["src"] for x in sc["items"]}
    return out


MIN_LOOP = 3
DAILY_TOPICS = 8  # a full daily line-up: the loop carries only the newest edition


def on_air_dates() -> set:
    out = set()
    for sc in (load(OUT / "station_es.json", {}) or {}).get("schedules", []):
        out |= {x["date"] for x in sc["items"] if x.get("date")}
    return out


def build_station(apply_now: bool = False) -> None:
    """24/7 loop per language over every edition still holding audio: station ID → episode (chapters with short
    transitions and a mid break) → ~30 s music break → next episode. The player joins at (now - EPOCH) % total."""
    ids = build_ids()
    lens: dict = {}

    def dur(url: str) -> float:
        if url not in lens:
            lens[url] = duration(ROOT / "public" / url.lstrip("/"))
        return lens[url]

    breaks = [f"/radio/music/break_{m['id']}.mp3" for m in MUSIC if not (m.get("bed") or m.get("amb"))]
    eds = sorted((p.name for p in (OUT / "editions").iterdir() if (p / "edition.json").exists()), reverse=True)
    # the station carries only the newest dated edition (older ones stay in the archive); an older edition is added
    # only if the newest has fewer than MIN_LOOP episodes with audio (e.g. a partial build)
    def has_audio(d):
        return sum(1 for ep in (load(OUT / "editions" / d / "edition.json", {}) or {}).get("episodes", [])
                   if all((ROOT / "public" / t["src"].lstrip("/")).exists()
                          for lv in ep.get("languages", {}).values() for t in lv["tracks"]))
    eds = [d for d in eds if has_audio(d)  # permanent catalog: every podcast edition with audio, newest first
           and (load(OUT / "editions" / d / "edition.json", {}) or {}).get("format") == "podcast-episodes"]
    cast = load_cast()
    for lang in ("es", "en"):
        items, n = [], 0
        for d in eds:
            e = load(OUT / "editions" / d / "edition.json", {}) or {}
            for ep in e.get("episodes", []):
                lv = ep.get("languages", {}).get(lang)
                if not lv or not all((ROOT / "public" / t["src"].lstrip("/")).exists() for t in lv["tracks"]):
                    continue
                meta = {"date": d, "topic": ep["topic"], "name": ep["name_es" if lang == "es" else "name_en"]}
                if ep.get(f"title_{lang}"):
                    meta["title"] = ep[f"title_{lang}"]
                if ep.get("number"):
                    meta["num"] = ep["number"]
                if ep.get("kind"):
                    meta["type"] = "datos" if ep["kind"] == "serie" else ep["kind"]
                if ep.get("hosts"):
                    meta["hosts"] = ep["hosts"]
                items.append({"src": ids[lang][n % len(ids[lang])], "d": dur(ids[lang][n % len(ids[lang])]), "kind": "id"})
                for t in lv["tracks"]:
                    items.append({"src": t["src"], "d": t["duration"] or dur(t["src"]), "kind": "talk", "ch": t["title"], **meta})
                    if t.get("sting"):
                        items.append({"src": t["sting"], "d": dur(t["sting"]), "kind": "music", **meta})
                cb = (cast.get(f"{d}/{ep['topic']}") or {}).get("break")
                b = f"/radio/music/break_{cb}.mp3" if cb else breaks[n % len(breaks)]
                items.append({"src": b, "d": dur(b), "kind": "music"})
                n += 1
        total = round(sum(x["d"] for x in items), 2)
        new = {"start": EPOCH, "total": total, "episodes": n, "items": items, "built": date.today().isoformat()}
        prev = load(OUT / f"station_{lang}.json", {}) or {}
        scheds = prev.get("schedules") or ([{"start": prev["epoch"], "total": prev["total"], "episodes": prev.get("episodes"),
                                            "items": prev["items"]}] if prev.get("items") else [])
        nowt = time.time()
        active = max((x for x in scheds if _ts(x["start"]) <= nowt), key=lambda x: _ts(x["start"]), default=None)
        if apply_now or not active:
            new["start"] = EPOCH if not active else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(nowt))
            scheds = [new]
        elif [x["src"] for x in active["items"]] == [x["src"] for x in items]:
            scheds = [active]  # nothing new: keep the running loop
        else:
            new["start"] = next_switch()
            scheds = [active, new]
        dump(OUT / f"station_{lang}.json", {"schedules": scheds, "updated": date.today().isoformat()})
        print(f"  station {lang}: {n} deep dives, loop {total/3600:.2f} h, on air from {scheds[-1]['start']}")


def rerender(ed_date: str, topic: str, lang: str) -> bool:
    """Rebuild one episode's MP3s from its committed script.json (TTS cache makes this cheap when warm)."""
    sc = load(OUT / "editions" / ed_date / topic / lang / "script.json")
    if not sc or not os.environ.get("XAI_API_KEY"):
        return False
    c = ep_cast(ed_date, topic)
    n = len(sc["chapters"])
    for k, ch in enumerate(sc["chapters"], 1):
        render_chapter(ch["turns"], lang, OUT / "editions" / ed_date / topic / lang / f"{k:02d}.mp3", k == 1,
                       cast_bed(c, k, n), cast_amb(topic), sc.get("voices") or cast_voices(c))
    return True


def sync() -> int:
    """Before a build: restore any episode MP3 the station needs (persistent store first, then re-render from the
    script), back up episode audio to the store (newest first, capped), and drop store copies older than KEEP_AUDIO."""
    need = sorted(x for x in station_srcs() if x.startswith("/radio/editions/"))
    missing = [x for x in need if not (ROOT / "public" / x.lstrip("/")).exists()]
    restored = 0
    for x in missing:
        b = STORE / x.split("/radio/", 1)[1]
        try:
            ok = b.exists()
        except OSError:
            ok = False
        if ok:
            dst = ROOT / "public" / x.lstrip("/")
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(b, dst)
            restored += 1
    left = [x for x in missing if not (ROOT / "public" / x.lstrip("/")).exists()]
    for key_ in sorted({tuple(x.split("/")[3:6]) for x in left}):
        print(f"  re-rendering {'/'.join(key_)} from script.json")
        rerender(*key_)
    try:
        backup_store()
    except OSError as e:  # the store is a network mount; never fail a build on it
        print(f"  WARN: store backup skipped ({e})")
    print(f"radio sync: {len(need)} episode files in the loop, {restored} restored from store, "
          f"{len([x for x in missing if not (ROOT / 'public' / x.lstrip('/')).exists()])} still missing")
    return 0


def backup_store() -> None:
    if STORE.parent.exists():
        eds = sorted((p.name for p in (OUT / "editions").iterdir() if p.is_dir()), reverse=True)
        used = 0
        for d in eds:
            for f in sorted((OUT / "editions" / d).rglob("*.json")):  # scripts + edition manifests (tiny)
                if ".staging" not in f.parts:
                    b = STORE / "editions" / f.relative_to(OUT / "editions")
                    b.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(f, b)
            for f in sorted((OUT / "editions" / d).rglob("*.mp3")):
                used += f.stat().st_size
                if used > STORE_CAP_MB * 1e6:
                    break
                b = STORE / "editions" / f.relative_to(OUT / "editions")
                if not b.exists() or b.stat().st_size != f.stat().st_size:
                    b.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(f, b)
        # permanent catalog: nothing is removed from the store


def check_dist() -> int:
    missing = [x for x in station_srcs() if not (ROOT / "dist" / x.lstrip("/")).exists()]
    if missing:
        print(f"RADIO CHECK FAILED: {len(missing)} station files missing from dist, e.g. {missing[:3]}", file=sys.stderr)
        return 1
    print(f"radio: OK ({len(station_srcs())} station files present in dist)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", default=date.today().isoformat())
    ap.add_argument("--lang", choices=["es", "en", "both"], default="both")
    ap.add_argument("--topics", type=int, default=DAILY_TOPICS, help=f"deep dives per edition (default {DAILY_TOPICS})")
    ap.add_argument("--topic", action="append", help="force specific episode id(s): noticias-<theme>, datos-<theme>, tendencia, vision")
    ap.add_argument("--script-only", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--station-only", action="store_true", help="only rebuild the 24/7 loop files")
    ap.add_argument("--apply-now", action="store_true", help="put the new loop on air now instead of at the next 12:00 Madrid")
    ap.add_argument("--replace", action="store_true", help="with --topic: rebuild only those topics inside today's edition")
    ap.add_argument("--rerender", action="store_true", help="with --extend: re-mix every episode with current voice settings")
    ap.add_argument("--weekly-news", action="store_true",
                    help="add ONE ~20 min episode on the week's most relevant news to the catalog (Monday routine)")
    ap.add_argument("--data-series", action="store_true", help="(re)build the 20 'Datos del portal' catalog episodes (SERIES)")
    ap.add_argument("--meta", action="store_true", help="(re)write episode titles, show notes and numbers for --date")
    ap.add_argument("--extend", action="store_true", help="lengthen built episodes of --date that measure under ~19.5 min")
    ap.add_argument("--sync", action="store_true", help="restore/back up episode audio (run before astro build)")
    ap.add_argument("--check-dist", action="store_true", help="fail if any station file is missing from dist")
    a = ap.parse_args()
    if a.weekly_news:
        a.topic, a.replace, a.apply_now = ["noticias-semana"], True, True
    if a.data_series:
        a.topic, a.replace, a.apply_now = (a.topic or [f"serie-{k}" for k in SERIES]), True, True
    today, t0 = a.date, time.time()
    if a.sync:
        return sync()
    if a.check_dist:
        return check_dist()
    if a.meta:
        ed_dir = OUT / "editions" / today
        ed = load(ed_dir / "edition.json", {}) or {}
        with ThreadPoolExecutor(4) as ex:
            list(ex.map(lambda e: episode_meta(ed_dir, e), ed.get("episodes", [])))
        hist = load(OUT / "history.json", {})
        number_episodes(today, ed["episodes"], hist)
        dump(OUT / "history.json", hist)
        dump(ed_dir / "edition.json", ed)
        if (load(OUT / "latest.json", {}) or {}).get("date") == today:
            dump(OUT / "latest.json", ed)
        write_archive()
        build_station(a.apply_now)
        return 0
    if a.extend:
        build_music()
        return extend_existing(today, a.topic, a.apply_now, a.rerender)
    if a.station_only:
        build_music()
        build_station(a.apply_now)
        return 0
    ed_dir = OUT / "editions" / today
    if (ed_dir / "edition.json").exists() and not (a.force or a.replace):
        print(f"Radio BCS2050 {today}: edition exists (use --force to rebuild)")
        return 0
    music = build_music()
    for mid, url in music.items():
        STING_LEN[url] = duration(OUT / "music" / f"{mid}.mp3")
    hist = load(OUT / "history.json", {"used": [], "theme_last": {}, "editions": []})
    keep_eps, prev_eps = [], (load(ed_dir / "edition.json", {}) or {}).get("episodes", []) if a.replace else []
    if a.replace and a.topic and (ed_dir / "edition.json").exists():
        prev = load(ed_dir / "edition.json", {}) or {}
        keep_eps = [e for e in prev.get("episodes", []) if e["topic"] not in a.topic]
        hist["used"] = [u for u in hist.get("used", []) if u not in set(prev.get("source_ids", []))] + \
            [i for e in keep_eps for i in e.get("source_ids", [])]
    elif a.force and ed_dir.exists():  # rebuilding today: forget today's own picks first
        prev = load(ed_dir / "edition.json", {}) or {}
        hist["used"] = [u for u in hist.get("used", []) if u not in set(prev.get("source_ids", []))]
        hist["theme_last"] = {k: v for k, v in hist.get("theme_last", {}).items() if v != today}
    news, edu = all_news(), expres_de_unic()
    topics = a.topic or plan_episodes(today, hist, news)
    print(f"Radio BCS2050 {today}: episodes {topics}")
    packs = {}
    for th in topics:  # sequential so two episodes never tell the same fresh story
        kind, _, theme = th.partition("-")
        if kind == "serie" or (kind == "datos" and theme in SERIES):
            packs[th] = series_pack(theme, hist)
        elif kind in KINDS:
            packs[th] = kind_pack(kind, theme or None, hist, news, edu)
        else:
            packs[th] = topic_pack(th, hist, news, edu)
        hist = {**hist, "used": list(set(hist.get("used", [])) | set(packs[th]["ids"]))}
    assign_cast(catalog_order(today, [e["topic"] for e in keep_eps] + topics), {f"{today}/{t}" for t in topics})
    for th in topics:
        packs[th]["names"] = cast_names(ep_cast(today, th))
    langs = ["es", "en"] if a.lang == "both" else [a.lang]
    jobs = [(th, L) for th in topics for L in langs]
    def safe(j):  # one failed episode drops its topic, not the whole edition
        try:
            return build_episode(j[0], packs[j[0]], today, j[1], music, a.script_only)
        except Exception as e:  # noqa: BLE001
            print(f"  WARN: {j[0]}/{j[1]} failed: {e}", file=sys.stderr)
            return None
    with ThreadPoolExecutor(4) as ex:
        res = dict(zip(jobs, ex.map(safe, jobs)))
    failed = {th for (th, L), v in res.items() if v is None}
    topics = [th for th in topics if th not in failed]
    keep_eps += [e for e in prev_eps if e["topic"] in failed]  # a failed rebuild keeps the old episode
    if not topics:
        print("Radio BCS2050: every episode failed; the station is unchanged", file=sys.stderr)
        return 1
    stage = ed_dir / ".staging"
    for th in topics:  # all episodes rendered: swap staging into place
        shutil.rmtree(ed_dir / th, ignore_errors=True)
        shutil.move(str(stage / th), str(ed_dir / th))
    shutil.rmtree(stage, ignore_errors=True)
    if a.force and not keep_eps:
        for d in ed_dir.iterdir():
            if d.is_dir() and d.name not in topics:
                shutil.rmtree(d)
    episodes = []
    for th in topics:
        p = packs[th]
        kind = p.get("kind")
        srcs = []
        if kind in (None, "noticias"):
            srcs += [{"outlet": x["outlet"], "title": x["title_es"], "url": x["url"], "date": x["date"]} for x in p["now"] + p["older"]]
            srcs += [{"outlet": "Expres de Unic", "title": e["title"], "url": e["url"]} for e in p.get("expres_de_unic", [])]
        if kind in (None, "datos"):
            srcs += [{"outlet": f"{x.get('org','')} ({x.get('year','')})", "title": x["title"], "url": x.get("url", "")} for x in p["data"]["library"]]
            srcs += [{"outlet": "Portal BCS 2050", "title": "Base de datos del portal (GIS, CONAGUA, INEGI, ontología)", "url": "/explorar/"}]
        if kind == "tendencia":
            srcs += [{"outlet": "Portal BCS 2050", "title": "Tendencia 2050", "url": "/foresights/"}]
        if kind == "vision":
            srcs += [{"outlet": "Portal BCS 2050", "title": "Visión 2050", "url": "/foresights/"}]
        if kind == "serie":
            sd = p["series"]
            srcs += [{"outlet": "Portal BCS 2050", "title": t} for t in sorted({x["dataset"] for x in sd["records"] + sd["gaps"]})]
            srcs += [{"outlet": "Portal BCS 2050 · mapa", "title": m.get("name_es") or ""} for m in sd["maps"] if m.get("name_es")]
            srcs += [{"outlet": f"{x.get('org','')} ({x.get('year','')})", "title": x["title"]} for x in sd["library"]]
        if kind is None:
            srcs += [{"outlet": "Portal BCS 2050", "title": "Tendencia 2050 · Visión · Foresight · Ontología", "url": "/foresights/"}]
        episodes.append({"topic": th, "kind": kind or "tema", "theme": p.get("theme"),
                         "name_es": p.get("label_es") or THEMES[th][0], "name_en": p.get("label_en") or THEMES[th][1],
                         "signature": music[TOPIC[music_theme(th)][1]],
                         "hosts": list(cast_names(ep_cast(today, th)).values()), "music": ep_cast(today, th)["beds"],
                         "languages": {L: res[(th, L)] for L in langs}, "sources": srcs, "source_ids": p["ids"]})
    if keep_eps:
        order = {e["topic"]: k for k, e in enumerate(load(ed_dir / "edition.json", {}).get("episodes", []))}
        episodes = sorted(keep_eps + episodes, key=lambda e: order.get(e["topic"], 99))
    if not a.script_only:
        with ThreadPoolExecutor(4) as ex:
            list(ex.map(lambda e: e.get("title_es") or episode_meta(ed_dir, e), episodes))
    number_episodes(today, episodes, hist)
    edition = {"date": today, "format": "podcast-episodes", "engine": {"script": f"xAI {MODEL}", "voices": "xAI Grok TTS (rotating host pairs, see /radio/cast.json)"},
               "episodes": episodes, "source_ids": sorted(set(i for e in episodes for i in e.get("source_ids", []))),
               "credits": "/radio/credits.json"}
    dump(ed_dir / "edition.json", edition)
    if a.script_only:
        return 0
    newest = max(p.name for p in (OUT / "editions").iterdir() if (p / "edition.json").exists())
    if today >= newest:
        dump(OUT / "latest.json", edition)
    hist["used"] = sorted(set(hist.get("used", [])))
    for th in topics:
        for k in {th, th.partition("-")[2] if th.startswith("noticias-") else th}:
            hist.setdefault("theme_last", {})[k] = max(today, hist.get("theme_last", {}).get(k, ""))
    hist["editions"] = sorted(set(hist.get("editions", [])) | {today})
    dump(OUT / "history.json", hist)
    eds = write_archive()
    newer = not on_air_dates() or today > max(on_air_dates())
    build_station(a.apply_now or newer)
    keep = station_srcs()
    sync()  # permanent catalog: episode audio is never deleted
    print(f"Wrote public/radio/latest.json ({today}) in {(time.time()-t0)/60:.1f} min")
    return 0


def write_archive() -> list:
    eds = sorted(p.name for p in (OUT / "editions").iterdir() if (p / "edition.json").exists())
    arch = []
    for d in reversed(eds):
        e = load(OUT / "editions" / d / "edition.json", {})
        arch.append({"date": d, "audio": True, "edition": f"/radio/editions/{d}/edition.json",
                     "topics": [{"topic": x["topic"], "name_es": x["name_es"], "name_en": x["name_en"], "kind": x.get("kind"),
                                 "number": x.get("number"), "title_es": x.get("title_es"), "title_en": x.get("title_en"),
                                 "duration": {L: v["duration"] for L, v in x["languages"].items()}}
                                for x in e.get("episodes", [])]})
    dump(OUT / "archive.json", {"editions": arch})
    return eds


def extend_existing(today: str, topics: list | None, apply_now: bool, rerender_all: bool = False) -> int:
    """Lengthen already-built 8-chapter episodes that measure under MIN_EP, keeping every existing turn."""
    ed_dir = OUT / "editions" / today
    ed = load(ed_dir / "edition.json", {}) or {}
    hist = load(OUT / "history.json", {"used": []})
    news, edu = all_news(), expres_de_unic()
    jobs = []
    for ep in ed.get("episodes", []):
        if topics and ep["topic"] not in topics:
            continue
        for L, lv in ep["languages"].items():
            sc = load(ed_dir / ep["topic"] / L / "script.json", {}) or {}
            if [c["id"] for c in sc.get("chapters", [])] != [c[0] for c in KIND_CHAPTERS.get(ep.get("kind"), CHAPTERS)]:
                print(f"  {ep['topic']}/{L}: old chapter format, rebuild it with --topic {ep['topic']} --replace")
                continue
            durs = [duration(ROOT / "public" / t["src"].lstrip("/")) for t in lv["tracks"]]
            print(f"  {ep['topic']}/{L}: {sum(durs)/60:.1f} min")
            if sum(durs) < MIN_EP or rerender_all:
                jobs.append((ep, L, lv, sc, durs))

    assign_cast(catalog_order(), set())  # older episodes get varied music (their recorded voices stay)

    def run(j):
        ep, L, lv, sc, durs = j
        own = set(ep.get("source_ids", []))
        h = {**hist, "used": [u for u in hist.get("used", []) if u not in own]}
        kind = ep.get("kind")
        if kind == "serie":
            pack = series_pack(ep["topic"].partition("-")[2], h)
        else:
            pack = (kind_pack(kind, ep.get("theme") if kind in ("noticias", "datos") else None, h, news, edu)
                    if kind in KINDS else topic_pack(ep["topic"], h, news, edu))
        pack["names"] = sc.get("hosts") or cast_names(ep_cast(today, ep["topic"]))
        src, stage = ed_dir / ep["topic"] / L, ed_dir / ".staging" / ep["topic"] / L
        shutil.rmtree(stage, ignore_errors=True)
        shutil.copytree(src, stage)
        if rerender_all:  # re-mix every chapter with the current voice settings (TTS cache: no new API calls)
            cc = ep_cast(today, ep["topic"])
            n = len(sc["chapters"])
            for k, c in enumerate(sc["chapters"]):
                durs[k] = render_chapter(c["turns"], L, stage / f"{k+1:02d}.mp3", k == 0, cast_bed(cc, k + 1, n),
                                         cast_amb(ep["topic"]), sc.get("voices") or cast_voices(cc))
            sc["music"] = cc["beds"]
            print(f"  [{ep['topic']}/{L}] re-mixed: {sum(durs)/60:.1f} min")
        try:
            chapters = fit_length(ep["topic"], pack, today, L, [c["turns"] for c in sc["chapters"]], durs, stage)
        except Exception as e:  # noqa: BLE001 — e.g. no script-model credit: keep the re-mix as it is
            print(f"  WARN: {ep['topic']}/{L} not lengthened: {e}", file=sys.stderr)
            chapters = [c["turns"] for c in sc["chapters"]]
        for c, t in zip(sc["chapters"], chapters):
            c["turns"] = t
        dump(stage / "script.json", sc)
        shutil.rmtree(src)
        shutil.move(str(stage), str(src))
        for t, d in zip(lv["tracks"], durs):
            t["duration"] = d
        lv["duration"], lv["words"] = round(sum(durs), 1), sum(words(t) for t in chapters)
        print(f"  [{ep['topic']}/{L}] now {sum(durs)/60:.1f} min, {lv['words']} words")

    with ThreadPoolExecutor(3) as ex:
        list(ex.map(run, jobs))
    shutil.rmtree(ed_dir / ".staging", ignore_errors=True)
    dump(ed_dir / "edition.json", ed)
    if (load(OUT / "latest.json", {}) or {}).get("date") == today:
        dump(OUT / "latest.json", ed)
    write_archive()
    build_station(apply_now)
    sync()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
