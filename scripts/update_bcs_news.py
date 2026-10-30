#!/usr/bin/env python3
"""Refresh src/data/news.json with BCS-relevant headlines — MERGE ONLY, never truncate.

Daily routine (07:05 Madrid, weekdays):
    python3 scripts/update_bcs_news.py                    # search + merge + tag + rebuild chat corpus
    python3 scripts/update_bcs_news.py --merge new.json   # merge curated items (list or {"items": [...]})
    python3 scripts/update_bcs_news.py --no-search --merge new.json
    python3 scripts/update_bcs_news.py --check            # build guard (run by `npm run build`)
    python3 scripts/update_bcs_news.py --remove <url>     # deliberate removal (recorded in the ledger)

Rules (2026-10-08):
  * Existing items are never dropped. New items are merged in, deduplicated by normalised URL
    and normalised title (accent/case/punctuation-insensitive).
  * Retention: items from the last RETENTION_DAYS (365) stay in news.json; older items move to
    src/data/news_archive.json, which is still part of the chat corpus. Nothing is deleted.
  * Guard: aborts (exit 2, nothing written) if the merged feed + archive is smaller than before,
    if any previously known item would disappear, or if news.json cannot be parsed.
  * Ledger src/data/news_ledger.json records every item ever published; `--check` fails the build
    if a ledger item is missing from feed + archive (catches truncation by any tool or manual edit).
  * Never invents articles — only items with a real http(s) URL are kept. Search hits get a
    placeholder blurb and `_needs_review: true` until a human/routine writes a paraphrased summary.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "data" / "news.json"
ARCHIVE = ROOT / "src" / "data" / "news_archive.json"
LEDGER = ROOT / "src" / "data" / "news_ledger.json"
BACKUPS = ROOT / "scripts" / "_cache" / "news_backups"
RETENTION_DAYS = 365
KEEP_BACKUPS = 30

QUERIES = [
    "Baja California Sur agua desaladora OR acuífero site:bcsnoticias.mx",
    "Baja California Sur energía OR CFE OR apagones OR SIBCS",
    "Los Cabos POEL OR ordenamiento OR turismo",
    "Baja California Sur SEMARNAT OR CONAGUA OR SENER",
    "Loreto OR Comondú planeación OR PMDU OR desaladora",
    "El Sudcaliforniano Los Cabos playa OR turismo",
]

TOPIC_HINTS = [
    (re.compile(r"agua|desal|acu[ií]fer|conagua|oomsapas", re.I), "water"),
    (re.compile(r"energ|cfe|apag[oó]n|sibcs|sener|solar|el[eé]ctric", re.I), "energy"),
    (re.compile(r"turismo|hotel|playa|marina|crucero", re.I), "tourism"),
    (re.compile(r"anp|semarnat|ambiental|ecolog", re.I), "environment"),
    (re.compile(r"poel|pdu|pmd|ordenamiento|planeaci|pmdu", re.I), "planning"),
    (re.compile(r"suelo|concesi[oó]n|desarrollo inmobiliario|predio", re.I), "land_use"),
]


class Abort(Exception):
    pass


# ---------------------------------------------------------------- normalisation
def fold(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def norm_url(u: str) -> str:
    u = str(u or "").strip()
    if not u:
        return ""
    p = urllib.parse.urlsplit(u)
    host = p.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    if host.startswith("m.") or host.startswith("amp."):
        host = host.split(".", 1)[1]
    path = re.sub(r"/(amp)/?$", "/", p.path or "/").rstrip("/") or "/"
    q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True)
         if not re.match(r"^(utm_|fbclid|gclid|ref$|amp$|outputType$)", k, re.I)]
    query = urllib.parse.urlencode(sorted(q))
    return f"{host}{urllib.parse.unquote(path).lower()}" + (f"?{query}" if query else "")


def norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", fold(t)).strip()


def keys_of(it: dict) -> list[str]:
    ks = []
    u = norm_url(it.get("url", ""))
    if u:
        ks.append("u:" + u)
    t = norm_title(it.get("title_es") or it.get("title_en") or "")
    if len(t) >= 16:
        ks.append("t:" + t)
    return ks


def primary_key(it: dict) -> str:
    ks = keys_of(it)
    return ks[0] if ks else ""


# ---------------------------------------------------------------- io
def read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # never overwrite a file we could not read
        raise Abort(f"cannot parse {path.relative_to(ROOT)}: {e}")


def write_json_atomic(path: Path, data) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def backup(path: Path) -> None:
    if not path.exists():
        return
    BACKUPS.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    shutil.copy2(path, BACKUPS / f"{path.stem}_{ts}.json")
    olds = sorted(BACKUPS.glob(f"{path.stem}_*.json"))
    for p in olds[:-KEEP_BACKUPS]:
        p.unlink(missing_ok=True)


def items_of(doc) -> list[dict]:
    if isinstance(doc, list):
        return [x for x in doc if isinstance(x, dict)]
    return [x for x in (doc or {}).get("items") or [] if isinstance(x, dict)]


# ---------------------------------------------------------------- search
def guess_topics(text: str) -> list[str]:
    found = []
    for rx, tag in TOPIC_HINTS:
        if rx.search(text) and tag not in found:
            found.append(tag)
    return found or ["planning"]


def ddg_search(q: str, n: int = 5) -> list[dict]:
    """Best-effort DuckDuckGo HTML scrape; returns [{title,url}]. Empty list on failure."""
    url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": q})
    req = urllib.request.Request(url, headers={"User-Agent": "BCS-Portal-NewsBot/1.0 (+internal refresh)"})
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            html = resp.read().decode("utf-8", "replace")
    except Exception as e:
        print(f"  search failed for {q!r}: {e}", file=sys.stderr)
        return []
    items = []
    for m in re.finditer(r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', html, re.I | re.S):
        href = m.group(1)
        title = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        if "uddg=" in href:
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
            href = urllib.parse.unquote(qs.get("uddg", [href])[0])
        if not href.startswith("http"):
            continue
        items.append({"title": title, "url": href})
        if len(items) >= n:
            break
    return items


def search_items() -> list[dict]:
    out = []
    print("Queries:")
    for q in QUERIES:
        print(f"  • {q}")
        for hit in ddg_search(q, n=4):
            title, url = hit["title"], hit["url"]
            out.append({
                "id": re.sub(r"[^a-z0-9]+", "-", fold(title))[:48].strip("-") or "nota",
                "date": date.today().isoformat(),
                "date_kind": "found",  # publication date not verified; date the item was found
                "source": urllib.parse.urlparse(url).netloc.replace("www.", ""),
                "url": url,
                "title_es": title,
                "title_en": title,  # operator should translate on review
                "blurb_es": "(Pendiente de resumen — añadido por update_bcs_news.py)",
                "blurb_en": "(Summary pending — added by update_bcs_news.py)",
                "topics": guess_topics(title + " " + url),
                "_needs_review": True,
            })
    return out


# ---------------------------------------------------------------- merge
def valid_item(it: dict) -> bool:
    return bool(re.match(r"^https?://", str(it.get("url") or ""))) and bool(it.get("title_es") or it.get("title_en"))


def merge(existing: list[dict], archive: list[dict], incoming: list[dict], removed: set[str]):
    """Return (feed, archive, added). Existing items win; curated incoming items may replace a
    `_needs_review` placeholder with the same key (a review), never the other way round."""
    pool: list[dict] = []
    index: dict[str, int] = {}

    def find(it):
        for k in keys_of(it):
            if k in index:
                return index[k]
        return None

    def register(i, it):
        for k in keys_of(it):
            index.setdefault(k, i)

    for it in existing + archive:
        j = find(it)
        if j is None:
            pool.append(it)
            register(len(pool) - 1, it)
        # duplicates already present in the stored data are collapsed (first wins)
    added = 0
    for it in incoming:
        if not valid_item(it):
            print(f"  skip (no url/title): {it.get('title_es') or it.get('url')}", file=sys.stderr)
            continue
        if any(k in removed for k in keys_of(it)):
            continue
        it.setdefault("id", re.sub(r"[^a-z0-9]+", "-", fold(it.get("title_es", "")))[:48].strip("-"))
        it.setdefault("topics", guess_topics(it.get("title_es", "") + " " + it.get("url", "")))
        j = find(it)
        if j is None:
            pool.append(it)
            register(len(pool) - 1, it)
            added += 1
            print(f"    + {it.get('title_es', '')[:80]}")
        elif pool[j].get("_needs_review") and not it.get("_needs_review"):
            keep = {k: pool[j][k] for k in ("place_ids", "feeds_into") if k in pool[j]}
            pool[j] = {**it, **{k: v for k, v in keep.items() if k not in it}}
            register(j, it)
            print(f"    ~ reviewed {it.get('title_es', '')[:80]}")
    # unique ids
    seen_ids: dict[str, int] = {}
    for it in pool:
        base = it.get("id") or "nota"
        if base in seen_ids:
            seen_ids[base] += 1
            it["id"] = f"{base}-{seen_ids[base]}"
        else:
            seen_ids[base] = 0
    cutoff = (date.today() - timedelta(days=RETENTION_DAYS)).isoformat()
    feed = [it for it in pool if str(it.get("date") or "9999") >= cutoff]
    arch = [it for it in pool if str(it.get("date") or "9999") < cutoff]
    order = lambda x: (str(x.get("date") or ""), 0 if x.get("_needs_review") else 1)
    feed.sort(key=order, reverse=True)
    arch.sort(key=order, reverse=True)
    return feed, arch, added


# ---------------------------------------------------------------- ledger / guard
def load_ledger() -> dict:
    led = read_json(LEDGER, {"note": "", "items": {}, "removed": []})
    led.setdefault("items", {})
    led.setdefault("removed", [])
    led["note"] = ("Every news item ever published in the portal feed (key = normalised URL). "
                   "Checked by `update_bcs_news.py --check` during `npm run build`; remove items only "
                   "with `--remove <url>`.")
    return led


def ledger_add(led: dict, items: list[dict]) -> None:
    today = date.today().isoformat()
    for it in items:
        k = primary_key(it)
        if k and k not in led["items"]:
            led["items"][k] = {"url": it.get("url"), "title_es": it.get("title_es"), "date": it.get("date"), "first_seen": today}


def missing_from(led: dict, items: list[dict]) -> list[dict]:
    have = set()
    for it in items:
        have.update(keys_of(it))
    removed = set(led.get("removed") or [])
    return [v for k, v in led["items"].items() if k not in have and k not in removed]


def guard(prev_feed, prev_arch, feed, arch, led) -> None:
    prev_total, total = len(prev_feed) + len(prev_arch), len(feed) + len(arch)
    if total < prev_total:
        raise Abort(f"merged feed+archive has {total} items, previous had {prev_total} — refusing to shrink")
    moved = len(arch) - len(prev_arch)
    if len(feed) < len(prev_feed) - max(0, moved):
        raise Abort(f"news.json would drop from {len(prev_feed)} to {len(feed)} items (only {max(0, moved)} archived)")
    prev_keys = set()
    for it in prev_feed + prev_arch:
        prev_keys.add(primary_key(it))
    now_keys = set()
    for it in feed + arch:
        now_keys.update(keys_of(it))
    lost = [k for k in prev_keys if k and k not in now_keys]
    if lost:
        raise Abort(f"{len(lost)} existing items would disappear, e.g. {lost[:3]}")
    miss = missing_from(led, feed + arch)
    if miss:
        raise Abort(f"{len(miss)} ledger items missing from feed+archive, e.g. {[m.get('url') for m in miss[:3]]}")


# ---------------------------------------------------------------- commands
def run_post(no_tag: bool, no_corpus: bool) -> None:
    steps = []
    if not no_tag:
        steps.append([sys.executable, str(ROOT / "scripts" / "tag_news_flights_to_foresights.py")])
    if not no_corpus:
        steps.append([sys.executable, str(ROOT / "scripts" / "build_chat_corpus.py")])
    for cmd in steps:
        print("→", " ".join(Path(c).name for c in cmd))
        r = subprocess.run(cmd, cwd=ROOT)
        if r.returncode != 0:
            raise Abort(f"post step failed: {Path(cmd[-1]).name} (exit {r.returncode})")


def cmd_check() -> int:
    feed = items_of(read_json(OUT, {"items": []}))
    arch = items_of(read_json(ARCHIVE, {"items": []}))
    if not feed and not arch:
        raise Abort("news.json has no items")
    bad = [it.get("id") for it in feed + arch if not valid_item(it)]
    if bad:
        raise Abort(f"items without http(s) url/title: {bad[:5]}")
    led = load_ledger()
    first = not LEDGER.exists()
    miss = missing_from(led, feed + arch)
    if miss and not first:
        raise Abort(f"{len(miss)} published news items are missing from news.json + news_archive.json "
                    f"(truncated feed?), e.g. {[m.get('url') for m in miss[:3]]}. Restore from "
                    f"scripts/_cache/news_backups/ or use --remove <url> for a deliberate removal.")
    n0 = len(led["items"])
    ledger_add(led, feed + arch)
    if len(led["items"]) != n0 or first:
        write_json_atomic(LEDGER, led)
    print(f"news check ok: feed={len(feed)} archive={len(arch)} ledger={len(led['items'])} "
          f"needs_review={sum(1 for it in feed if it.get('_needs_review'))} newest={max((str(i.get('date')) for i in feed), default='-')}")
    return 0


def cmd_remove(urls: list[str]) -> int:
    doc = read_json(OUT, {"items": []})
    adoc = read_json(ARCHIVE, {"items": []})
    led = load_ledger()
    targets = {"u:" + norm_url(u) for u in urls}
    feed = [it for it in items_of(doc) if not (set(keys_of(it)) & targets)]
    arch = [it for it in items_of(adoc) if not (set(keys_of(it)) & targets)]
    gone = len(items_of(doc)) + len(items_of(adoc)) - len(feed) - len(arch)
    backup(OUT)
    led["removed"] = sorted(set(led["removed"]) | targets)
    if isinstance(doc, dict):
        doc["items"] = feed
    write_json_atomic(OUT, doc if isinstance(doc, dict) else {"items": feed})
    if ARCHIVE.exists() or arch:
        write_json_atomic(ARCHIVE, {"updated": date.today().isoformat(), "items": arch})
    write_json_atomic(LEDGER, led)
    print(f"removed {gone} item(s); recorded in ledger.removed")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--merge", action="append", default=[], help="JSON file with curated items to merge")
    ap.add_argument("--no-search", action="store_true", help="skip the web search")
    ap.add_argument("--no-tag", action="store_true", help="skip tag_news_flights_to_foresights.py")
    ap.add_argument("--no-corpus", action="store_true", help="skip build_chat_corpus.py")
    ap.add_argument("--dry-run", action="store_true", help="merge and guard, but write nothing")
    ap.add_argument("--check", action="store_true", help="validate feed vs ledger (build guard)")
    ap.add_argument("--remove", nargs="+", metavar="URL", help="deliberately remove items by URL")
    a = ap.parse_args()
    try:
        if a.check:
            return cmd_check()
        if a.remove:
            return cmd_remove(a.remove)

        doc = read_json(OUT, {"updated": "", "items": []})
        prev_feed = items_of(doc)
        prev_arch = items_of(read_json(ARCHIVE, {"items": []}))
        led = load_ledger()
        ledger_add(led, prev_feed + prev_arch)  # seed the ledger with what is published today

        incoming: list[dict] = []
        for f in a.merge:
            got = items_of(read_json(Path(f), []))
            print(f"merge file {f}: {len(got)} items")
            incoming += got
        if not a.no_search:
            incoming += search_items()

        feed, arch, added = merge(
            [dict(x) for x in prev_feed], [dict(x) for x in prev_arch], incoming, set(led["removed"])
        )
        guard(prev_feed, prev_arch, feed, arch, led)
        moved = len(arch) - len(prev_arch)
        print(f"merged: feed {len(prev_feed)} → {len(feed)}, archive {len(prev_arch)} → {len(arch)} "
              f"(+{added} new, {max(0, moved)} archived)")
        if a.dry_run:
            print("dry run: nothing written")
            return 0
        backup(OUT)
        out = {
            "updated": date.today().isoformat(),
            "source_note": (doc.get("source_note") if isinstance(doc, dict) else None)
            or "Mixed curated + daily refresh; review _needs_review items before publish.",
            "items": feed,
        }
        write_json_atomic(OUT, out)
        if arch or ARCHIVE.exists():
            backup(ARCHIVE)
            write_json_atomic(ARCHIVE, {
                "updated": date.today().isoformat(),
                "note": f"News older than {RETENTION_DAYS} days, moved out of news.json. Still indexed by the portal chat.",
                "items": arch,
            })
        ledger_add(led, feed + arch)
        write_json_atomic(LEDGER, led)
        print(f"Wrote {OUT.relative_to(ROOT)} ({len(feed)} items, +{added} new)")
        run_post(a.no_tag, a.no_corpus)
        return 0
    except Abort as e:
        print(f"ABORT: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
