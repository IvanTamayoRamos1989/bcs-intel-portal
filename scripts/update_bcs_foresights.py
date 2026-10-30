#!/usr/bin/env python3
"""Weekly BCS Foresights edition refresher.

Reads news.json + catalog_slim (01_planning recent) + optional flight counts +
foresights_swarm/*.md. Regenerates src/data/foresights.json (+ public mirror).

Fails safely: if little new material, keeps prior signals/places, bumps `updated`,
and writes a bilingual «little change» summary.

Never invents news URLs — only keeps http(s) URLs already present in news.json
or prior edition.

When writing summaries/signals, prefer linking demand–supply gaps on
/crecimiento (growth_demand_supply.json) rather than inventing capacity figures.
See GROWTH_DEMAND_SUPPLY.md and FORESIGHTS_PLAN.md § Growth demand–supply.
"""
from __future__ import annotations

import json
import subprocess
import re
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "data" / "foresights.json"
PUB = ROOT / "public" / "foresights.json"
NEWS = ROOT / "src" / "data" / "news.json"
CATALOG = ROOT / "src" / "data" / "catalog_slim.json"
FLIGHTS = ROOT / "src" / "data" / "flight_connections_bcs.json"
SWARM = ROOT / "foresights_swarm"

ROLE_IDS = [
    "territorial_development",
    "vision_spatial",
    "sustainability_infra",
    "water_security",
    "energy_grid",
    "tourism_investment",
    "municipal_planning",
    "environment_anp",
    "community_tenure",
]

THEME_HINTS = [
    (re.compile(r"agua|desal|acu[ií]fer|conagua|oomsapas|tandeo|ptar", re.I), "water"),
    (re.compile(r"energ|cfe|apag[oó]n|sibcs|sener|solar|hidr[oó]geno|h2", re.I), "energy"),
    (re.compile(r"turismo|hotel|playa|marina|ied|inversi[oó]n", re.I), "tourism"),
    (re.compile(r"anp|semarnat|ambiental|pulmo|ecolog", re.I), "environment"),
    (re.compile(r"poel|pdu|pmd|ordenamiento|planeaci|pmdu|plan parcial", re.I), "planning"),
]


def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def guess_theme(text: str) -> str:
    for rx, tag in THEME_HINTS:
        if rx.search(text):
            return tag
    return "planning"


def recent_news(items: list, days: int = 35) -> list:
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    out = [it for it in items if str(it.get("date") or "") >= cutoff and it.get("url")]
    out.sort(key=lambda x: x.get("date", ""), reverse=True)
    return out


def planning_hits(catalog: list, limit: int = 8) -> list:
    hits = []
    for it in catalog if isinstance(catalog, list) else []:
        p = (it.get("p") or "") + " " + (it.get("n") or "")
        if "01_planning" not in p and not (it.get("f") == "01_planning"):
            continue
        blob = p.lower()
        if any(k in blob for k in ("san-jose-del-este", "san jose del este", "2026-09", "poel", "pmdu", "plan")):
            hits.append(it)
    hits.sort(key=lambda x: x.get("n") or "", reverse=True)
    return hits[:limit]


def parse_swarm_files() -> dict:
    """Best-effort extract of bilingual snippets from swarm markdown."""
    meta = {"files": [], "system_view_es": None, "system_view_en": None, "notes": []}
    if not SWARM.is_dir():
        return meta
    for path in sorted(SWARM.glob("*.md")):
        if path.name.upper() == "README.MD" or path.name == "README.md":
            continue
        meta["files"].append(path.name)
        text = path.read_text(encoding="utf-8", errors="replace")
        meta["notes"].append(f"{path.name}:{len(text)}c")
        if path.name.startswith("system_view"):
            # first substantial paragraph after title
            paras = [p.strip() for p in re.split(r"\n\s*\n", text) if len(p.strip()) > 80]
            for p in paras:
                if p.startswith("#") or p.startswith("**Agent"):
                    continue
                # strip markdown bold markers lightly
                clean = re.sub(r"\*\*([^*]+)\*\*", r"\1", p)
                clean = re.sub(r"\n+", " ", clean).strip()
                if len(clean) > 100:
                    meta["system_view_en"] = clean[:1200]
                    break
    return meta


def build_signals_from_news(news_items: list, prior_signals: list, planning: list) -> tuple[list, bool]:
    """Return (signals, little_change)."""
    if len(news_items) < 3 and not planning:
        # keep prior, mark little change
        return prior_signals or [], True

    # Cluster by theme from top recent items
    by_theme: dict[str, list] = {}
    for it in news_items[:18]:
        blob = f"{it.get('title_es','')} {it.get('blurb_es','')}"
        th = guess_theme(blob)
        by_theme.setdefault(th, []).append(it)

    signals = []
    for th, items in by_theme.items():
        if not items:
            continue
        urls = [it["url"] for it in items[:5] if it.get("url")]
        titles_es = "; ".join(it.get("title_es", "")[:60] for it in items[:3])
        titles_en = "; ".join(it.get("title_en") or it.get("title_es", "")[:60] for it in items[:3])
        sid = f"sig-{th}-{items[0].get('date','week')}"
        signals.append({
            "id": sid[:48],
            "title_es": f"Señal {th}: {items[0].get('title_es','')[:90]}",
            "title_en": f"{th} signal: {(items[0].get('title_en') or items[0].get('title_es',''))[:90]}",
            "theme": th,
            "why_es": f"Agrupación semanal ({len(items)} notas). Destacados: {titles_es}. Implicación para vocaciones de lugar y techos agua/red.",
            "why_en": f"Weekly cluster ({len(items)} notes). Highlights: {titles_en}. Implication for place vocations and water/grid ceilings.",
            "source_urls": urls,
            "portal_paths": ["/noticias", "/foresights", f"/{'agua' if th=='water' else 'energia' if th=='energy' else 'turismo' if th=='tourism' else 'ambiente' if th=='environment' else 'planeacion'}"],
        })

    if planning:
        p0 = planning[0]
        signals.insert(0, {
            "id": "sig-planning-catalog",
            "title_es": f"Catálogo planeación: {p0.get('n','')[:80]}",
            "title_en": f"Planning catalog: {p0.get('n','')[:80]}",
            "theme": "planning",
            "why_es": (p0.get("sum_es") or "Material reciente en 01_planning.")[:420],
            "why_en": (p0.get("sum_en") or "Recent material in 01_planning.")[:420],
            "source_urls": [],
            "portal_paths": ["/catalogo", "/planeacion", p0.get("p") or "01_planning"],
        })

    # Prefer richer prior signals if new auto signals are thin
    if len(signals) < 3 and prior_signals:
        return prior_signals, True
    return signals[:10], False


def main() -> int:
    prior = load_json(OUT, {})
    news = load_json(NEWS, {"items": []})
    catalog = load_json(CATALOG, [])
    flights = load_json(FLIGHTS, {})
    swarm = parse_swarm_files()

    items = recent_news(news.get("items") or [])
    planning = planning_hits(catalog)
    refresh = "--refresh-signals" in sys.argv
    prior_signals = prior.get("signals") or []
    if prior_signals and not refresh:
        # Keep curated/hand-merged signals; only bump metadata unless forced
        signals, little = prior_signals, (len(items) < 2)
        if len(items) >= 2:
            little = False  # still refresh summary dates
    else:
        signals, little = build_signals_from_news(items, prior_signals, planning)

    today = date.today().isoformat()
    period_from = (date.today() - timedelta(days=30)).isoformat()
    if items:
        period_from = min(it.get("date", period_from) for it in items[-5:]) if items else period_from
        # use oldest among recent window start
        period_from = min((it.get("date") or period_from) for it in items) if items else period_from

    # Preserve places / roles from prior (or swarm-merged edition) — script does not wipe backbone
    places = prior.get("places") or []
    roles = prior.get("role_briefs") or []
    seeds = prior.get("consensus_seeds") or []
    watch = prior.get("watchlist") or []

    system_view_es = prior.get("system_view_es") or ""
    system_view_en = swarm.get("system_view_en") or prior.get("system_view_en") or ""

    # Optional flight note in watchlist
    try:
        airports = flights.get("airports") or []
        sjd = next((a for a in airports if a.get("iata") == "SJD"), None)
        if sjd and not any("SJD" in (w.get("item_en") or "") for w in watch):
            n = len(sjd.get("destinations") or [])
            watch = list(watch) + [{
                "item_es": f"Conectividad SJD: {n} destinos sin escalas (inventario portal vuelos).",
                "item_en": f"SJD connectivity: {n} non-stop destinations (portal flights inventory).",
            }]
    except Exception:
        pass

    if little:
        headline_es = prior.get("headline_es") or "Prospectiva BCS — poco cambio esta semana"
        headline_en = prior.get("headline_en") or "BCS Foresights — little change this week"
        summary_es = (
            f"Poco material nuevo desde la edición anterior ({prior.get('updated', '?')}). "
            "Se mantienen vocaciones de lugar, lentes de rol y señales previas; se actualiza la fecha. "
            "Revisar /noticias y catálogo 01_planning en la próxima ronda."
        )
        summary_en = (
            f"Little new material since the previous edition ({prior.get('updated', '?')}). "
            "Place vocations, role lenses and prior signals kept; date refreshed. "
            "Review /noticias and 01_planning catalog next round."
        )
    else:
        headline_es = prior.get("headline_es") or "Prospectiva semanal BCS 2050"
        headline_en = prior.get("headline_en") or "Weekly BCS 2050 foresight"
        nthemes = len({s.get("theme") for s in signals})
        summary_es = (
            f"Edición regenerada {today}: {len(signals)} señales · {len(items)} notas recientes · "
            f"{len(planning)} hits de planeación · {nthemes} temas. "
            "Columna vertebral = vocaciones de lugar; lentes de rol = debate. No es plan oficial."
        )
        summary_en = (
            f"Edition regenerated {today}: {len(signals)} signals · {len(items)} recent notes · "
            f"{len(planning)} planning hits · {nthemes} themes. "
            "Backbone = place vocations; role lenses = debate. Not an official plan."
        )

    data = {
        "updated": today,
        "period": {"from": period_from, "to": today},
        "headline_es": headline_es,
        "headline_en": headline_en,
        "summary_es": summary_es,
        "summary_en": summary_en,
        "system_view_es": system_view_es,
        "system_view_en": system_view_en,
        "signals": signals,
        "places": places,
        "role_briefs": roles,
        "consensus_seeds": seeds,
        "watchlist": watch,
        "method_note_es": prior.get("method_note_es")
            or "Inteligencia interna / prospectiva en borrador. No es un plan oficial.",
        "method_note_en": prior.get("method_note_en")
            or "Internal intelligence / draft foresight. Not an official plan.",
        "swarm_sources": [f for f in (swarm.get("files") or prior.get("swarm_sources") or []) if not re.search(r"mies", str(f), re.I)],
        "little_change": little,
    }

    raw = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    PUB.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(raw, encoding="utf-8")
    PUB.write_text(raw, encoding="utf-8")
    print(f"wrote {OUT} updated={today} signals={len(signals)} places={len(places)} little_change={little}")
    if swarm.get("files"):
        print("swarm:", ", ".join(swarm["files"]))


    # U5: tag news + flights into signals/places/seeds (provenance) after edition write
    tag_script = ROOT / "scripts" / "tag_news_flights_to_foresights.py"
    if tag_script.exists():
        try:
            subprocess.run([sys.executable, str(tag_script)], check=False)
        except Exception as e:
            print("warn: tag_news_flights_to_foresights failed:", e)

    # Regenerate visual figures (map / diagrams / charts) from current edition + GIS
    fig_script = ROOT / "scripts" / "build_foresights_figures.py"
    if fig_script.exists():
        venv_py = ROOT / ".venv-foresights" / "bin" / "python"
        py = str(venv_py) if venv_py.exists() else sys.executable
        try:
            subprocess.run([py, str(fig_script)], check=False)
        except Exception as e:
            print("warn: figure build skipped:", e)

    gds = ROOT / "src" / "data" / "growth_demand_supply.json"
    if gds.exists():
        print("growth_demand_supply=present path=/crecimiento (gaps for weekly cross-ref)")
    else:
        print("growth_demand_supply=MISSING — see GROWTH_DEMAND_SUPPLY.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
