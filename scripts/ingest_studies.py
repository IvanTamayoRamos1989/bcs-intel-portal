#!/usr/bin/env python3
"""Ingest capacity studies (Phase 0, offline) into static portal data.

Input : <STUDIES_DIR>/<municipio>/<study_id>.json   (default /workspace/shared/bcs_studies)
Output: src/data/studies/<municipio>.json            (BCS-owned shape, summary)
        src/data/studies/units/<study_id>.json      (per-unit rows + optional EPSG:4326 geometry)

Mapping is a WHITELIST: only the fields below are copied; everything else
(schema ids, version strings, generator/model fields, ids of upstream jobs,
file paths, tracebacks) is dropped. A study is rejected (not published) if any
kept string still looks like a path/URL to a local machine, or contains a token
whose SHA-256 is in the forbidden list (same list as check_forbidden_terms.mjs).

Kept sections (whitelisted keys only, nulls preserved so gaps stay visible):
status/status_reason, narrative, caveat, units, totals (scalars + source/assumption/
pending reference lists + null placeholders), null_reasons_es, layers applied / not
applied, breakdowns (by_*), checks (incl. note/reason), growth (history, observed,
null horizon + note), water (aquifers, null per-capita demand + note), assumptions,
pending_assumptions (id, text, status) and data_gaps.

If STUDIES_DIR does not exist (e.g. CI), existing src/data/studies/*.json are
left untouched so the build stays reproducible.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "data" / "studies"
STUDIES_DIR = Path(os.environ.get("BCS_STUDIES_DIR", "/workspace/shared/bcs_studies"))
FORBIDDEN_SHA256 = {
    "e509dc8b2493027f47eca0d365050fe7bffb0c776e56538e6057af2d70853172",
    *[h.strip().lower() for h in os.environ.get("FORBIDDEN_TERM_SHA256", "").split(",") if h.strip()],
}
ACCEPTED_SCHEMAS = {"bcs.capacity_study.v0", "bcs.capacity_study.v0.1"}
STATUS = {"ok", "partial", "infeasible"}
PATHLIKE = re.compile(r"([A-Za-z]:\\|\\\\|/(home|Users|workspace|tmp|var|mnt)/|Desktop|file://|localhost|127\.0\.0\.1|Traceback)", re.I)
TOKEN = re.compile(r"[^\W_]+", re.U)

UNIT_KEYS = ["id", "unit_kind", "area_m2", "excluded_area_m2", "buildable_area_m2", "excluded_by", "far_assumed",
             "cos_assumed", "gross_floor_m2", "dwellings_est", "assumption_refs", "source_refs", "pending_assumption_refs"]
CHECK_KEYS = ["id", "label_es", "result", "measured", "threshold", "tolerance", "unit", "source_ref", "assumption_ref",
              "pending_assumption_refs", "note_es", "reason_es"]
SOURCE_KEYS = ["title", "owner", "dataset", "year", "source_date", "licence", "url", "method", "caveat"]
ASSUMPTION_KEYS = ["id", "text_es", "value", "unit", "basis", "origin", "used", "requires_bcs_confirmation"]
REF_LIST_KEYS = ["source_refs", "assumption_refs", "pending_assumption_refs"]
# Nested sections kept so that gaps stay visible. Nulls are KEPT here on purpose (a null = "no data", not "zero").
LAYER_APPLIED_KEYS = ["layer", "role", "use", "field", "subset_es", "source_ref", "assumption_ref", "pending_assumption_refs"]
LAYER_NOT_APPLIED_KEYS = ["layer", "role", "reason_es", "source_ref"]
BREAKDOWN_ROW_KEYS = ["value", "belt_id", "name_es", "area_m2", "buildable_area_m2", "note_es", *REF_LIST_KEYS]
GROWTH_KEYS = ["base_year", "population", "horizon_year", "population_horizon", "population_horizon_note_es",
               "floating_population", "floating_population_note_es", "source_ref", "note_es"]
GROWTH_POINT_KEYS = ["year", "population", "source_ref"]
GROWTH_OBSERVED_KEYS = ["from_year", "to_year", "cagr_pct", "source_ref", "note_es"]
WATER_KEYS = ["source_ref", "note_es", "method_es", "per_capita_demand", "per_capita_demand_note_es"]
AQUIFER_KEYS = ["clave", "nombre", "R_hm3", "DNC_hm3", "VCAS_hm3", "VEALA_hm3", "VAPTYR_hm3", "VAPRH_hm3", "dma_hm3",
                "status", "source_page", "source_ref"]
DATA_GAP_KEYS = ["item", "status", "where_es"]
NULLABLE_TOTALS = {"gross_floor_m2", "dwellings_est"}


class Reject(Exception):
    pass


def forbidden_token(s: str) -> bool:
    for t in TOKEN.findall(s):
        parts = [t] + re.split(r"(?<=[a-z])(?=[A-Z])", t)
        for p in parts:
            if hashlib.sha256(p.lower().encode()).hexdigest() in FORBIDDEN_SHA256:
                return True
    return False


def scrub(v, where="$"):
    """Recursively validate kept values; raise Reject on leaks."""
    if isinstance(v, str):
        if forbidden_token(v):
            raise Reject(f"forbidden internal term at {where}")
        if PATHLIKE.search(v):
            raise Reject(f"path/host-like string at {where}")
        return v
    if isinstance(v, list):
        return [scrub(x, f"{where}[{i}]") for i, x in enumerate(v)]
    if isinstance(v, dict):
        for k in v:
            if forbidden_token(str(k)) or PATHLIKE.search(str(k)):
                raise Reject(f"leaky key under {where}")
        return {k: scrub(x, f"{where}.{k}") for k, x in v.items()}
    return v


def pick(d: dict, keys: list[str], keep_null: bool = False) -> dict:
    if not isinstance(d, dict):
        return {}
    return {k: d[k] for k in keys if k in d and (keep_null or d[k] is not None)}


def str_list(v) -> list[str]:
    return [str(x) for x in v if isinstance(x, (str, int))] if isinstance(v, list) else []


def map_totals(t) -> dict:
    """Scalars + the reference lists (source/assumption/pending refs) + null placeholders for unestimated values."""
    if not isinstance(t, dict):
        return {}
    out = {}
    for k, v in t.items():
        if isinstance(v, bool):
            continue
        if isinstance(v, (int, float, str)):
            out[k] = v
        elif v is None and (k in NULLABLE_TOTALS or k.endswith("_est") or k.endswith("_m2")):
            out[k] = None
        elif k in REF_LIST_KEYS:
            out[k] = str_list(v)
    return out


def map_breakdowns(b) -> dict:
    if not isinstance(b, dict):
        return {}
    out = {}
    for name, rows in b.items():
        if isinstance(rows, list) and re.fullmatch(r"by_[a-z0-9_]+", str(name)):
            kept = [pick(r, BREAKDOWN_ROW_KEYS) for r in rows if isinstance(r, dict)]
            if kept:
                out[name] = kept
    return out


def map_growth(g) -> dict:
    if not isinstance(g, dict):
        return {}
    out = pick(g, GROWTH_KEYS, keep_null=True)
    hist = [pick(h, GROWTH_POINT_KEYS) for h in g.get("history") or [] if isinstance(h, dict)]
    if hist:
        out["history"] = hist
    if isinstance(g.get("observed"), dict):
        out["observed"] = pick(g["observed"], GROWTH_OBSERVED_KEYS)
    return out


def map_water(w) -> dict:
    if not isinstance(w, dict):
        return {}
    out = pick(w, WATER_KEYS, keep_null=True)
    aq = [pick(a, AQUIFER_KEYS) for a in w.get("aquifers") or [] if isinstance(a, dict)]
    if aq:
        out["aquifers"] = aq
    return out


def collect_refs(obj, key="pending_assumption_refs", acc=None) -> set:
    acc = set() if acc is None else acc
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key and isinstance(v, list):
                acc.update(str(x) for x in v if isinstance(x, str))
            elif k not in ("units", "parcels", "geometry"):
                collect_refs(v, key, acc)
    elif isinstance(obj, list):
        for x in obj:
            collect_refs(x, key, acc)
    return acc


def map_pending(raw: dict, assumptions: list[dict]) -> list[dict]:
    """Every assumption the study flags as needing BCS confirmation, or that any section cites as pending."""
    by_id = {a.get("id"): a for a in assumptions if a.get("id")}
    ids = {a["id"] for a in assumptions if a.get("id") and a.get("requires_bcs_confirmation") is True}
    ids |= collect_refs(raw)
    for u in (raw.get("units") or [])[:1]:  # units share refs; sample instead of scanning 15k rows
        ids |= set(str_list((u or {}).get("pending_assumption_refs")))
    out = []
    for i in sorted(ids):
        a = by_id.get(i, {})
        out.append({"id": i, "text_es": a.get("text_es") or "(el estudio no incluye el texto de este supuesto)",
                    "basis": a.get("basis"), "status": "pendiente de confirmar por BCS",
                    "used": a.get("used")})
    return [{k: v for k, v in p.items() if v is not None} for p in out]


def map_sources(src) -> list[dict]:
    out = []
    items = src.items() if isinstance(src, dict) else enumerate(src or [])
    for key, s in items:
        if isinstance(s, str):
            out.append({"ref": str(key), "title": s})
        elif isinstance(s, dict):
            out.append({"ref": str(s.get("ref", key)), **pick(s, SOURCE_KEYS)})
    return out


def bcs_citations(municipio: str) -> dict:
    """BCS-owned clean citations from our own request manifest (by source ref). Preferred over study-echoed text."""
    m = STUDIES_DIR / "_requests" / municipio / "manifest.json"
    try:
        src = json.loads(m.read_text(encoding="utf-8")).get("sources") or {}
    except (OSError, json.JSONDecodeError):
        return {}
    return {str(k): pick(v, SOURCE_KEYS) for k, v in src.items() if isinstance(v, dict)}


def apply_citations(sources: list[dict], cites: dict) -> list[dict]:
    out = []
    for s in sources:
        c = cites.get(s.get("ref"))
        out.append({"ref": s["ref"], **c} if c else s)
    return out


def reproject_units(units: list[dict], geoms: dict) -> dict | None:
    """Optional geometry: engine returns EPSG:32612; portal ships EPSG:4326."""
    if not geoms:
        return None
    try:
        from pyproj import Transformer
        from shapely.geometry import mapping, shape
        from shapely.ops import transform
    except ImportError:
        return None
    tr = Transformer.from_crs(32612, 4326, always_xy=True).transform
    feats = []
    for u in units:
        g = geoms.get(u["id"])
        if g:
            gg = transform(tr, shape(g)).simplify(0.00002)
            feats.append({"type": "Feature", "properties": {"id": u["id"]}, "geometry": mapping(gg)})
    return {"type": "FeatureCollection", "features": feats} if feats else None


def map_study(raw: dict, municipio: str) -> dict:
    schema = raw.get("schema")
    if schema not in ACCEPTED_SCHEMAS:
        raise Reject(f"unknown contract {schema!r}")
    if raw.get("status") not in STATUS:
        raise Reject(f"bad status {raw.get('status')!r}")
    units_in = raw.get("units") or raw.get("parcels") or []
    geoms = {}
    units = []
    for u in units_in:
        if not isinstance(u, dict) or "id" not in u:
            continue
        if isinstance(u.get("geometry"), dict):
            geoms[u["id"]] = u["geometry"]
        units.append(pick(u, UNIT_KEYS))
    checks = [pick(c, CHECK_KEYS, keep_null=True) for c in raw.get("checks") or [] if isinstance(c, dict)]
    assumptions = [pick(a, ASSUMPTION_KEYS) for a in raw.get("assumptions") or [] if isinstance(a, dict)]
    null_reasons = raw.get("null_reasons_es") if isinstance(raw.get("null_reasons_es"), dict) else {}
    study = {
        "study_id": str(raw.get("study_id") or ""),
        "municipio": municipio,
        "status": raw["status"],
        "status_reason_es": raw.get("status_reason_es"),
        "created": raw.get("created"),
        "lod": raw.get("lod") or "schematic",
        "question_es": raw.get("question") or raw.get("question_es"),
        "narrative_es": raw.get("narrative_es"),
        "caveat_es": raw.get("caveat_es") or "Estudio esquemático de capacidad; no es un dictamen ni sustituye al PDU vigente.",
        "units_count": (raw.get("units_info") or {}).get("count") if isinstance(raw.get("units_info"), dict) else None,
        "units_note_es": (raw.get("units_info") or {}).get("note_es") if isinstance(raw.get("units_info"), dict) else None,
        "units": units,
        "totals": map_totals(raw.get("totals")),
        "null_reasons_es": {str(k): v for k, v in null_reasons.items() if isinstance(v, str)},
        "layers_applied": [pick(x, LAYER_APPLIED_KEYS) for x in raw.get("layers_applied") or [] if isinstance(x, dict)],
        "layers_not_applied": [pick(x, LAYER_NOT_APPLIED_KEYS) for x in raw.get("layers_not_applied") or [] if isinstance(x, dict)],
        "breakdowns": map_breakdowns(raw.get("breakdowns")),
        "checks": checks,
        "growth": map_growth(raw.get("growth")),
        "water": map_water(raw.get("water")),
        "assumptions": assumptions,
        "pending_assumptions": map_pending(raw, assumptions),
        "data_gaps": [pick(g, DATA_GAP_KEYS) for g in raw.get("data_gaps") or [] if isinstance(g, dict)],
        "sources": apply_citations(map_sources(raw.get("sources")), bcs_citations(municipio)),
    }
    study = {k: v for k, v in study.items() if v not in (None, "", [], {})}
    study = scrub(study)
    geo = reproject_units(units_in, geoms)
    if geo:
        study["geometry_4326"] = geo
    return study


def main() -> int:
    if not STUDIES_DIR.is_dir():
        print(f"studies: source folder absent; keeping existing {OUT.relative_to(ROOT)}")
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    published = rejected = 0
    for mdir in sorted(p for p in STUDIES_DIR.iterdir() if p.is_dir() and not p.name.startswith("_")):
        muni = mdir.name
        studies = []
        for f in sorted(mdir.glob("*.json")):
            try:
                studies.append(map_study(json.loads(f.read_text(encoding="utf-8")), muni))
                published += 1
            except (Reject, json.JSONDecodeError) as e:
                rejected += 1
                print(f"studies: REJECT {muni}/{f.name}: {e}", file=sys.stderr)
        # Per-unit rows (and optional geometry) are bulky (~15k cells) and not needed by the page: write them to
        # src/data/studies/units/<study_id>.json (outside the page glob) and keep the summary file small.
        (OUT / "units").mkdir(exist_ok=True)
        for st in studies:
            bulk = {k: st.pop(k) for k in ("units", "geometry_4326") if k in st}
            if bulk:
                (OUT / "units" / f"{st['study_id'] or muni}.json").write_text(
                    json.dumps({"study_id": st["study_id"], "municipio": muni, **bulk}, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")
        doc = {"municipio": muni, "generated": datetime.now().astimezone().strftime("%Y-%m-%d"), "studies": studies}
        (OUT / f"{muni}.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"studies: published={published} rejected={rejected}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
