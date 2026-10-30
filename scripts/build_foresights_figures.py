#!/usr/bin/env python3
"""Build foresights visual assets (maps, diagrams, charts) from portal data + GIS.

Outputs under public/foresights/ and writes a visuals manifest into foresights.json
(src + public mirrors). Designed for weekly regeneration — no invented stats.

Preferred stack: matplotlib + shapely (pure Python). Full QGIS not required.
"""
from __future__ import annotations

import json
import math
import re
import shutil
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import numpy as np
from shapely.geometry import shape, Point

ROOT = Path(__file__).resolve().parents[1]
GIS = ROOT / "public" / "gis"
OUT = ROOT / "public" / "foresights"
STILLS_OUT = OUT / "stills"
FS_SRC = ROOT / "src" / "data" / "foresights.json"
FS_PUB = ROOT / "public" / "foresights.json"
FLIGHTS = ROOT / "src" / "data" / "flight_connections_bcs.json"
DMA_GJ = GIS / "focus_water_dmas.geojson"
MUNI_GJ = GIS / "osm_municipalities.geojson"
COAST_GJ = GIS / "osm_coastline.geojson"
STILLS_PTS = ROOT / "src" / "data" / "stills_points.json"
PUB = ROOT / "public"

# Place anchors (approx centroids for vocation labels)
PLACE_COORDS = {
    "los_cabos": (22.89, -109.91),
    "east_cape": (23.35, -109.45),
    "todos_santos": (23.45, -110.22),
    "la_paz": (24.14, -110.31),
    "loreto": (25.99, -111.35),
    "comondu": (25.03, -111.66),
    "mulege_north": (26.89, -111.98),
}

PLACE_COLORS = {
    "los_cabos": "#e11d48",
    "east_cape": "#f59e0b",
    "todos_santos": "#8b5cf6",
    "la_paz": "#0284c7",
    "loreto": "#059669",
    "comondu": "#ca8a04",
    "mulege_north": "#64748b",
}

THEME_COLORS = {
    "water": "#0284c7",
    "energy": "#ca8a04",
    "tourism": "#e11d48",
    "planning": "#7c3aed",
    "environment": "#059669",
    "land_use": "#0d9488",
}

SHORT_VOC = {
    "los_cabos": ("Motor turístico", "Tourism engine"),
    "east_cape": ("Flanco Golfo / ANP", "Gulf flank / ANP"),
    "todos_santos": ("Espina Pacífico", "Pacific spine"),
    "la_paz": ("Capital / servicios", "Capital / services"),
    "loreto": ("Turismo–conservación", "Tourism–conservation"),
    "comondu": ("Agro / inland", "Agri / inland"),
    "mulege_north": ("Corredor norte / H2", "North corridor / H2"),
}


def load_json(path: Path, default=None):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default if default is not None else {}


def plot_poly(ax, geom, **kwargs):
    if geom.geom_type == "Polygon":
        xs, ys = geom.exterior.xy
        ax.fill(xs, ys, **kwargs)
        ax.plot(xs, ys, color=kwargs.get("edgecolor", "#94a3b8"), linewidth=0.6, zorder=kwargs.get("zorder", 1))
    elif geom.geom_type == "MultiPolygon":
        for g in geom.geoms:
            plot_poly(ax, g, **kwargs)


def build_vocation_map(places: list) -> dict:
    """Static PNG: BCS municipalities + vocation place markers."""
    muni = load_json(MUNI_GJ, {"features": []})
    fig, ax = plt.subplots(figsize=(8.5, 11), dpi=140)
    ax.set_facecolor("#f0f9ff")
    fig.patch.set_facecolor("#ffffff")

    muni_tint = {
        "Los Cabos": "#fecdd3",
        "La Paz": "#bae6fd",
        "Loreto": "#a7f3d0",
        "Comondú": "#fde68a",
        "Mulegé": "#e2e8f0",
    }
    for feat in muni.get("features", []):
        name = (feat.get("properties") or {}).get("name", "")
        try:
            geom = shape(feat["geometry"])
        except Exception:
            continue
        plot_poly(
            ax,
            geom,
            facecolor=muni_tint.get(name, "#e2e8f0"),
            edgecolor="#64748b",
            alpha=0.55,
            zorder=1,
            linewidth=0,
        )

    # lightly draw coastline if present
    coast = load_json(COAST_GJ, {"features": []})
    for feat in coast.get("features", [])[:80]:
        try:
            geom = shape(feat["geometry"])
        except Exception:
            continue
        if geom.geom_type == "LineString":
            xs, ys = geom.xy
            ax.plot(xs, ys, color="#94a3b8", linewidth=0.4, alpha=0.5, zorder=2)
        elif geom.geom_type == "MultiLineString":
            for g in geom.geoms:
                xs, ys = g.xy
                ax.plot(xs, ys, color="#94a3b8", linewidth=0.4, alpha=0.5, zorder=2)

    place_by_id = {p["id"]: p for p in places}
    for pid, (lat, lon) in PLACE_COORDS.items():
        pl = place_by_id.get(pid)
        if not pl:
            continue
        color = PLACE_COLORS.get(pid, "#0080C0")
        ax.scatter([lon], [lat], s=120, c=color, zorder=5, edgecolors="white", linewidths=1.2)
        short_es, _ = SHORT_VOC.get(pid, ("", ""))
        label = pl.get("name_es", pid).split("/")[0].strip()
        # offset labels to reduce overlap
        offsets = {
            "los_cabos": (0.15, -0.55),
            "east_cape": (0.35, 0.15),
            "todos_santos": (-1.6, -0.15),
            "la_paz": (0.25, 0.25),
            "loreto": (0.25, 0.2),
            "comondu": (-1.8, -0.2),
            "mulege_north": (0.3, 0.25),
        }
        dx, dy = offsets.get(pid, (0.2, 0.2))
        ax.annotate(
            f"{label}\n{short_es}",
            xy=(lon, lat),
            xytext=(lon + dx, lat + dy),
            fontsize=7.5,
            color="#0f172a",
            fontweight="bold",
            ha="left" if dx >= 0 else "right",
            arrowprops=dict(arrowstyle="-", color=color, lw=0.8),
            zorder=6,
            bbox=dict(boxstyle="round,pad=0.25", fc="white", ec=color, alpha=0.92, lw=0.8),
        )

    ax.set_xlim(-115.3, -109.0)
    ax.set_ylim(22.5, 28.2)
    ax.set_aspect("equal")
    ax.set_xlabel("Lon")
    ax.set_ylabel("Lat")
    ax.set_title(
        "BCS place vocations / Vocaciones de lugar\n"
        "Polycentric backbone — Cabos is not all of BCS",
        fontsize=11,
        fontweight="bold",
        color="#0f172a",
        pad=10,
    )
    # legend
    handles = []
    for pid in PLACE_COORDS:
        if pid not in place_by_id:
            continue
        es, en = SHORT_VOC.get(pid, ("", ""))
        handles.append(
            mpatches.Patch(color=PLACE_COLORS[pid], label=f"{es} / {en}")
        )
    ax.legend(
        handles=handles,
        loc="upper left",
        fontsize=7,
        framealpha=0.95,
        title="Vocations EN/ES",
        title_fontsize=8,
    )
    ax.text(
        0.99,
        0.01,
        "Source: OSM municipalities (portal GIS) · foresights.json places\n"
        "Indicative place markers — not official zoning",
        transform=ax.transAxes,
        ha="right",
        va="bottom",
        fontsize=6.5,
        color="#64748b",
    )
    ax.grid(True, linestyle=":", alpha=0.35)
    out = OUT / "vocation_map.png"
    fig.tight_layout()
    fig.savefig(out, dpi=140, bbox_inches="tight")
    plt.close(fig)

    # GeoJSON for optional Leaflet
    gj = {
        "type": "FeatureCollection",
        "features": [],
    }
    for pid, (lat, lon) in PLACE_COORDS.items():
        pl = place_by_id.get(pid)
        if not pl:
            continue
        es, en = SHORT_VOC.get(pid, ("", ""))
        gj["features"].append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": pid,
                    "name_es": pl.get("name_es"),
                    "name_en": pl.get("name_en"),
                    "vocation_short_es": es,
                    "vocation_short_en": en,
                    "vocation_es": pl.get("vocation_es"),
                    "vocation_en": pl.get("vocation_en"),
                    "color": PLACE_COLORS.get(pid, "#0080C0"),
                },
            }
        )
    gj_path = OUT / "vocation_places.geojson"
    gj_path.write_text(json.dumps(gj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return {
        "id": "vocation_map",
        "type": "map",
        "path": "/foresights/vocation_map.png",
        "geojson": "/foresights/vocation_places.geojson",
        "caption_es": "Mapa de vocaciones de lugar (marcadores indicativos sobre municipios OSM).",
        "caption_en": "Place-vocation map (indicative markers on OSM municipalities).",
        "source_es": "GIS portal · osm_municipalities.geojson · foresights.json",
        "source_en": "Portal GIS · osm_municipalities.geojson · foresights.json",
    }


def build_signals_diagram(signals: list) -> dict:
    """Radial board: themes in ring, signals linked to place hints."""
    fig, ax = plt.subplots(figsize=(10, 8), dpi=140)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_xlim(-1.55, 1.55)
    ax.set_ylim(-1.35, 1.45)
    fig.patch.set_facecolor("#ffffff")

    ax.text(0, 1.32, "Signals · Señales", ha="center", fontsize=13, fontweight="bold", color="#0f172a")
    ax.text(0, 1.18, "Linked to themes & place pressure", ha="center", fontsize=8, color="#64748b")

    # center hub
    hub = plt.Circle((0, 0), 0.22, color="#0080C0", alpha=0.9, zorder=5)
    ax.add_patch(hub)
    ax.text(0, 0, "BCS\n2050", ha="center", va="center", color="white", fontsize=9, fontweight="bold", zorder=6)

    n = max(len(signals), 1)
    # Even radial placement so every signal is visible (no angle collisions)
    for i, sig in enumerate(signals):
        ang = 2 * math.pi * i / n - math.pi / 2
        r = 0.88 if i % 2 == 0 else 0.78
        x, y = r * math.cos(ang), r * math.sin(ang)
        theme = sig.get("theme") or "planning"
        color = THEME_COLORS.get(theme, "#64748b")
        ax.plot([0, x], [0, y], color=color, alpha=0.35, lw=1.5, zorder=2)
        ax.scatter([x], [y], s=180, c=color, zorder=4, edgecolors="white", linewidths=1.5)
        title = (sig.get("title_es") or sig.get("title_en") or sig.get("id") or "")[:42]
        if len(sig.get("title_es") or "") > 42:
            title += "…"
        # label outside
        lx, ly = 1.12 * math.cos(ang), 1.12 * math.sin(ang)
        ha = "left" if lx >= 0 else "right"
        ax.text(lx, ly, title, fontsize=6.5, color="#0f172a", ha=ha, va="center", wrap=False,
                bbox=dict(boxstyle="round,pad=0.2", fc="#f8fafc", ec=color, lw=0.7, alpha=0.95))

    # theme legend
    themes_used = sorted({s.get("theme") or "planning" for s in signals})
    handles = [mpatches.Patch(color=THEME_COLORS.get(t, "#64748b"), label=t) for t in themes_used]
    ax.legend(handles=handles, loc="lower center", ncol=min(5, len(handles)), fontsize=7, framealpha=0.95)

    ax.text(
        0.5,
        -0.02,
        "Source: foresights.json signals (news + portal). Not a causal model.",
        transform=ax.transAxes,
        ha="center",
        va="bottom",
        fontsize=6.5,
        color="#64748b",
    )
    out = OUT / "signals_diagram.png"
    fig.tight_layout()
    fig.savefig(out, dpi=140, bbox_inches="tight")
    plt.close(fig)
    return {
        "id": "signals_diagram",
        "type": "diagram",
        "path": "/foresights/signals_diagram.png",
        "caption_es": "Diagrama de señales de la semana (temas → presión territorial).",
        "caption_en": "This week’s signals diagram (themes → territorial pressure).",
        "source_es": "foresights.json · signals[]",
        "source_en": "foresights.json · signals[]",
    }


def parse_dma_hm3(text: str) -> float | None:
    if not text:
        return None
    t = text.replace("−", "-").replace("–", "-").replace(",", ".")
    m = re.search(r"(-?\d+(?:\.\d+)?)", t)
    if not m:
        return None
    return abs(float(m.group(1)))


def build_constraint_charts() -> list:
    """Bars from real portal numbers only — flights + DMA deficits."""
    visuals = []

    # --- Flights ---
    flights = load_json(FLIGHTS, {})
    airports = flights.get("airports") or []
    rows = []
    for a in airports:
        code = a.get("iata") or a.get("code")
        dests = a.get("destinations") or []
        if code and isinstance(dests, list):
            rows.append((code, len(dests), a.get("name") or code))
    if rows:
        rows.sort(key=lambda x: -x[1])
        fig, ax = plt.subplots(figsize=(7.5, 4.2), dpi=140)
        codes = [r[0] for r in rows]
        vals = [r[1] for r in rows]
        colors = ["#e11d48" if c == "SJD" else "#0284c7" if c == "LAP" else "#059669" for c in codes]
        bars = ax.bar(codes, vals, color=colors, edgecolor="white", width=0.55)
        for b, v in zip(bars, vals):
            ax.text(b.get_x() + b.get_width() / 2, v + 0.8, str(v), ha="center", va="bottom", fontweight="bold", fontsize=11)
        ax.set_ylabel("Non-stop destinations / Destinos sin escalas")
        ax.set_title("Air connectivity asymmetry · Asimetría aérea\n(FlightConnections inventory)", fontsize=11, fontweight="bold")
        ax.set_ylim(0, max(vals) * 1.2)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        retrieved = flights.get("retrieved") or ""
        ax.text(
            0.99,
            0.02,
            f"Source: flight_connections_bcs.json · FlightConnections.com · retrieved {retrieved}\n"
            "No invented routes — portal inventory only.",
            transform=ax.transAxes,
            ha="right",
            va="bottom",
            fontsize=6.5,
            color="#64748b",
        )
        out = OUT / "constraints_flights.png"
        fig.tight_layout()
        fig.savefig(out, dpi=140, bbox_inches="tight")
        plt.close(fig)
        visuals.append(
            {
                "id": "constraints_flights",
                "type": "chart",
                "path": "/foresights/constraints_flights.png",
                "caption_es": f"Destinos sin escalas: " + ", ".join(f"{c}={v}" for c, v, _ in rows) + ".",
                "caption_en": f"Non-stop destinations: " + ", ".join(f"{c}={v}" for c, v, _ in rows) + ".",
                "source_es": "src/data/flight_connections_bcs.json",
                "source_en": "src/data/flight_connections_bcs.json",
                "numbers": {c: v for c, v, _ in rows},
            }
        )

    # --- DMA deficits ---
    dma = load_json(DMA_GJ, {"features": []})
    dma_rows = []
    for feat in dma.get("features") or []:
        p = feat.get("properties") or {}
        val = parse_dma_hm3(p.get("dma") or "")
        if val is None:
            continue
        label = p.get("clave") or p.get("id") or "?"
        name = (p.get("name_es") or "").replace("Acuífero ", "").replace(f"({label})", "").strip()
        dma_rows.append((label, val, name or label, p.get("dma")))
    if dma_rows:
        dma_rows.sort(key=lambda x: -x[1])
        fig, ax = plt.subplots(figsize=(8, 4.5), dpi=140)
        labels = [f"{r[0]}\n{r[2][:18]}" for r in dma_rows]
        vals = [r[1] for r in dma_rows]
        bars = ax.barh(labels, vals, color="#0284c7", edgecolor="white", height=0.65)
        for b, v, r in zip(bars, vals, dma_rows):
            ax.text(v + 0.3, b.get_y() + b.get_height() / 2, f"−{v:g} hm³/año", va="center", fontsize=8, color="#0f172a")
        ax.set_xlabel("Absolute deficit magnitude (hm³/year) · Magnitud del déficit")
        ax.set_title(
            f"CONAGUA DMA deficit aquifers · {len(dma_rows)} markers in portal pack\n"
            "Acuíferos en déficit (pack GIS portal)",
            fontsize=11,
            fontweight="bold",
        )
        ax.invert_yaxis()
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.set_xlim(0, max(vals) * 1.35)
        ax.text(
            0.99,
            0.02,
            "Source: public/gis/focus_water_dmas.geojson · CONAGUA DMA 2024 (portal ontology)\n"
            "Counts/values as stored — no invented deficits.",
            transform=ax.transAxes,
            ha="right",
            va="bottom",
            fontsize=6.5,
            color="#64748b",
        )
        out = OUT / "constraints_dma.png"
        fig.tight_layout()
        fig.savefig(out, dpi=140, bbox_inches="tight")
        plt.close(fig)
        visuals.append(
            {
                "id": "constraints_dma",
                "type": "chart",
                "path": "/foresights/constraints_dma.png",
                "caption_es": f"{len(dma_rows)} acuíferos en déficit en el pack DMA del portal (magnitudes CONAGUA).",
                "caption_en": f"{len(dma_rows)} deficit aquifers in the portal DMA pack (CONAGUA magnitudes).",
                "source_es": "public/gis/focus_water_dmas.geojson",
                "source_en": "public/gis/focus_water_dmas.geojson",
                "numbers": {"dma_deficit_count": len(dma_rows), **{r[0]: r[1] for r in dma_rows}},
            }
        )

    # --- Stills count (real) ---
    stills = load_json(STILLS_PTS, [])
    n_stills = 0
    if isinstance(stills, list):
        for p in stills:
            thumb = p.get("thumb") or p.get("image")
            if thumb and (PUB / thumb.lstrip("/")).exists():
                n_stills += 1
    if n_stills:
        fig, ax = plt.subplots(figsize=(6.5, 3.2), dpi=140)
        cats = ["Territory stills\n(portal)", "DMA markers\n(deficit pack)", "Airports\nin flight inventory"]
        vals2 = [n_stills, len(dma_rows), len(rows)]
        colors2 = ["#8b5cf6", "#0284c7", "#e11d48"]
        bars = ax.bar(cats, vals2, color=colors2, edgecolor="white", width=0.55)
        for b, v in zip(bars, vals2):
            ax.text(b.get_x() + b.get_width() / 2, v + max(vals2) * 0.02, str(v), ha="center", fontweight="bold")
        ax.set_ylabel("Count · Conteo")
        ax.set_title("Portal constraint / evidence counts · Conteos del portal", fontsize=11, fontweight="bold")
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.set_ylim(0, max(vals2) * 1.25)
        ax.text(
            0.99,
            0.02,
            "Sources: stills_points.json · focus_water_dmas.geojson · flight_connections_bcs.json",
            transform=ax.transAxes,
            ha="right",
            va="bottom",
            fontsize=6.5,
            color="#64748b",
        )
        out = OUT / "constraints_counts.png"
        fig.tight_layout()
        fig.savefig(out, dpi=140, bbox_inches="tight")
        plt.close(fig)
        visuals.append(
            {
                "id": "constraints_counts",
                "type": "chart",
                "path": "/foresights/constraints_counts.png",
                "caption_es": f"Conteos reales del portal: {n_stills} stills, {len(dma_rows)} DMA, {len(rows)} aeropuertos.",
                "caption_en": f"Real portal counts: {n_stills} stills, {len(dma_rows)} DMA, {len(rows)} airports.",
                "source_es": "stills_points · focus_water_dmas · flight_connections_bcs",
                "source_en": "stills_points · focus_water_dmas · flight_connections_bcs",
                "numbers": {"stills": n_stills, "dma_markers": len(dma_rows), "airports": len(rows)},
            }
        )

    return visuals


def build_role_tensions() -> dict:
    """Simple boxes/arrows: 3 key tensions."""
    fig, ax = plt.subplots(figsize=(10, 5.5), dpi=140)
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 6)
    ax.axis("off")
    fig.patch.set_facecolor("#ffffff")
    ax.set_title(
        "Key tensions · Tensiones clave\n(role lenses × place vocations)",
        fontsize=12,
        fontweight="bold",
        color="#0f172a",
        pad=8,
    )

    boxes = [
        # (x, y, w, h, title_es, title_en, color)
        (0.4, 3.8, 2.8, 1.5, "Agua vs crecimiento", "Water vs growth", "#0284c7"),
        (3.6, 3.8, 2.8, 1.5, "Isla energética SIBCS", "SIBCS energy island", "#ca8a04"),
        (6.8, 3.8, 2.8, 1.5, "Cabos vs resto BCS", "Cabos vs rest of BCS", "#e11d48"),
        (0.4, 0.6, 2.8, 1.3, "Desal / tandeo / DMA", "Desal / rationing / DMA", "#bae6fd"),
        (3.6, 0.6, 2.8, 1.3, "CFE · apagones · H2", "CFE · outages · H2", "#fde68a"),
        (6.8, 0.6, 2.8, 1.3, "Vocaciones policéntricas", "Polycentric vocations", "#fecdd3"),
    ]
    for x, y, w, h, tes, ten, color in boxes:
        fancy = FancyBboxPatch(
            (x, y), w, h, boxstyle="round,pad=0.05,rounding_size=0.15",
            facecolor=color, edgecolor="#0f172a", linewidth=1.0, alpha=0.92,
        )
        ax.add_patch(fancy)
        ax.text(x + w / 2, y + h * 0.62, tes, ha="center", va="center", fontsize=9, fontweight="bold", color="#0f172a")
        ax.text(x + w / 2, y + h * 0.28, ten, ha="center", va="center", fontsize=7.5, color="#334155", style="italic")

    # arrows down
    for x in (1.8, 5.0, 8.2):
        ax.annotate(
            "",
            xy=(x, 2.05),
            xytext=(x, 3.7),
            arrowprops=dict(arrowstyle="->", color="#475569", lw=1.6),
        )

    ax.text(
        5,
        2.55,
        "Infra & evidence (portal)  ·  Infraestructura y evidencia (portal)",
        ha="center",
        fontsize=8,
        color="#64748b",
    )
    ax.text(
        5,
        0.15,
        "Source: foresights role_briefs tensions + system_view — schematic, not a simulation",
        ha="center",
        fontsize=6.5,
        color="#64748b",
    )
    out = OUT / "role_tensions.png"
    fig.tight_layout()
    fig.savefig(out, dpi=140, bbox_inches="tight")
    plt.close(fig)
    return {
        "id": "role_tensions",
        "type": "diagram",
        "path": "/foresights/role_tensions.png",
        "caption_es": "Esquema de tensiones: agua vs crecimiento, isla energética, Cabos vs resto.",
        "caption_en": "Tension sketch: water vs growth, energy island, Cabos vs rest.",
        "source_es": "foresights.json role_briefs · system_view",
        "source_en": "foresights.json role_briefs · system_view",
    }


def build_stills_strip(places: list) -> dict | None:
    """Copy 2–4 territory stills near vocation places into public/foresights/stills/."""
    pts = load_json(STILLS_PTS, [])
    if not isinstance(pts, list) or not pts:
        return None
    STILLS_OUT.mkdir(parents=True, exist_ok=True)
    # preference order for strip
    prefer = ["los_cabos", "la_paz", "loreto", "todos_santos", "comondu", "east_cape", "mulege_north"]
    place_ids = {p["id"] for p in places}
    picks = []
    used = set()
    for pid in prefer:
        if pid not in place_ids or pid not in PLACE_COORDS:
            continue
        lat, lon = PLACE_COORDS[pid]
        cands = []
        for p in pts:
            if not p.get("lat") or not p.get("lon"):
                continue
            thumb = p.get("thumb") or p.get("image")
            if not thumb:
                continue
            src = PUB / thumb.lstrip("/")
            if not src.exists():
                continue
            d = (p["lat"] - lat) ** 2 + (p["lon"] - lon) ** 2
            cands.append((d, p, src, thumb))
        if not cands:
            continue
        cands.sort(key=lambda x: x[0])
        for d, p, src, thumb in cands[:3]:
            if p["id"] in used:
                continue
            used.add(p["id"])
            dest_name = f"{pid}_{p['id']}.jpg"
            dest = STILLS_OUT / dest_name
            shutil.copy2(src, dest)
            picks.append(
                {
                    "place_id": pid,
                    "still_id": p["id"],
                    "name": p.get("name") or p["id"],
                    "path": f"/foresights/stills/{dest_name}",
                    "lat": p["lat"],
                    "lon": p["lon"],
                }
            )
            break
        if len(picks) >= 4:
            break

    if len(picks) < 2:
        return None
    return {
        "id": "stills_strip",
        "type": "image_strip",
        "caption_es": "Stills del territorio cerca de vocaciones (activos existentes del portal).",
        "caption_en": "Territory stills near vocations (existing portal assets only).",
        "source_es": "public/stills · stills_points.json",
        "source_en": "public/stills · stills_points.json",
        "items": picks,
    }


def write_leaflet_snippet():
    """Minimal HTML fragment note — page embeds Leaflet itself; geojson is enough."""
    pass


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    fs = load_json(FS_SRC, {})
    places = fs.get("places") or []
    signals = fs.get("signals") or []

    visuals = []
    print("building vocation map…")
    visuals.append(build_vocation_map(places))
    print("building signals diagram…")
    visuals.append(build_signals_diagram(signals))
    print("building constraint charts…")
    visuals.extend(build_constraint_charts())
    print("building role tensions…")
    visuals.append(build_role_tensions())
    print("building stills strip…")
    strip = build_stills_strip(places)
    if strip:
        visuals.append(strip)

    fs["visuals"] = visuals
    fs["visuals_built"] = True
    raw = json.dumps(fs, ensure_ascii=False, indent=2) + "\n"
    FS_SRC.write_text(raw, encoding="utf-8")
    FS_PUB.write_text(raw, encoding="utf-8")

    for v in visuals:
        p = v.get("path")
        if p:
            print(" ", p, "OK" if (PUB / p.lstrip("/")).exists() else "MISSING")
        if v.get("items"):
            print(f"  stills strip: {len(v['items'])} images")
    print(f"wrote visuals[{len(visuals)}] → {FS_SRC}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
