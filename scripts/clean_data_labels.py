#!/usr/bin/env python3
"""Replace internal repo paths / *.json names in the display fields of portal data JSON by plain
source labels (scripts/source_labels.py). Idempotent; runs in `npm run build` before the corpus and
Astro build so regenerated data never shows internal paths. Location fields are not touched.

  python3 scripts/clean_data_labels.py [--check]
"""
from __future__ import annotations
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from source_labels import clean_display, DISPLAY_KEYS, VALUE_KEY_FILES  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DIRS = [ROOT / "src" / "data", ROOT / "public", ROOT / "netlify" / "functions"]
SKIP = {"chat_corpus.json", "catalog.json", "catalog_slim.json", "file_summaries.json", "drive_index.json"}  # document catalog text (not source labels); corpus is rebuilt


def main() -> int:
    check = "--check" in sys.argv
    changed = []
    for d in DIRS:
        for f in sorted(d.glob("*.json")):
            if f.name in SKIP or f.name.startswith("_"):
                continue
            raw = f.read_text(encoding="utf-8")
            try:
                data = json.loads(raw)
            except Exception:
                continue
            keys = DISPLAY_KEYS | ({"value"} if f.name in VALUE_KEY_FILES else set())
            new = clean_display(data, keys)
            if new != data:
                changed.append(str(f.relative_to(ROOT)))
                if not check:
                    compact = "\n" not in raw.strip()
                    f.write_text(json.dumps(new, ensure_ascii=False, separators=(",", ":")) if compact
                                 else json.dumps(new, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"clean_data_labels: {'would change' if check else 'cleaned'} {len(changed)} file(s)" + ("".join(f"\n  {c}" for c in changed)))
    return 1 if (check and changed) else 0


if __name__ == "__main__":
    sys.exit(main())
