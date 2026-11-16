#!/usr/bin/env python3
"""BCS Foresights — Visión tendencia (quantitative layer + weekly state).

Builds src/data/foresights_vision.json from news.json, portal_facts.json,
aquifers, inmobiliario metrics, flight counts and the latest foresights edition.

The quantitative state is recomputed from the full evidence each week (EWMA,
direction, short series, Bayes). The narrative is revised incrementally:
this week's prose starts from last week's text; the script refreshes the
change line and the figure table, flags stale claims, and does not rewrite
the essay from scratch. A curated prose file may be supplied with
--prose-es / --prose-en for a human revision.

No invented figures: every series point and every news count carries a source.
Projections to 2030/2050 are written only when a comparable series has at
least four points and a span of eight years or more; otherwise the cell is
«insuficiente».
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"
OUT = DATA / "foresights_vision.json"

ALPHA = 0.35          # EWMA of weekly theme counts
LAMBDA_BAYES = 0.45   # likelihood sharpness
HOLT_ALPHA = 0.4
HOLT_BETA = 0.2
MIN_POINTS_REGRESSION = 4
MIN_YEARS_FOR_HORIZON = 8  # required span to publish 2030/2050

THEMES = [
    "agua",
    "costa_clima",
    "turismo",
    "economia",
    "energia",
    "movilidad",
    "vivienda",
    "gobernanza",
]

THEME_LABEL_ES = {
    "agua": "Agua",
    "costa_clima": "Costa / clima",
    "turismo": "Turismo",
    "economia": "Economía",
    "energia": "Energía",
    "movilidad": "Movilidad",
    "vivienda": "Vivienda",
    "gobernanza": "Gobernanza",
}
THEME_LABEL_EN = {
    "agua": "Water",
    "costa_clima": "Coast / climate",
    "turismo": "Tourism",
    "economia": "Economy",
    "energia": "Energy",
    "movilidad": "Mobility",
    "vivienda": "Housing",
    "gobernanza": "Governance",
}


THEME_RX = {
    "agua": re.compile(r"agua|desal|acu[ií]fer|conagua|oomsapas|tandeo|ptar|huachicol|toma clandest|alcantarill|pozo|pipas", re.I),
    "costa_clima": re.compile(r"hurac[aá]n|marea|oleaje|erosi[oó]n|ni[nñ]o|inund|costa|Vance|Polo|Rachel|Profepa|Punta Lobos|San Crist[oó]bal|nivel del mar|marea extrema|pleamar", re.I),
    "turismo": re.compile(r"turismo|hotel|ocupaci[oó]n|visitante|playa|marina|Baja 1000|FITURCA|derrama", re.I),
    "economia": re.compile(r"empleo|IMSS|inflaci|IED|inversi[oó]n|PIB|econom|Coppel|IMCO|Foro Mar de Cort[eé]s|competitiv", re.I),
    "energia": re.compile(r"energ|CFE|apag[oó]n|SIBCS|solar|hidr[oó]geno|subestaci|CENACE", re.I),
    "movilidad": re.compile(r"aeropuerto|vuelo|pasajer|GAP|SJD\b|ferry|carretera|conectivid", re.I),
    "vivienda": re.compile(r"vivienda|habitacional|SNIIV|CONAVI|rezago|relocaliz|Sierra Vista", re.I),
    "gobernanza": re.compile(r"POEL|PDU|PMDU|plan parcial|consulta p[uú]blica|Congreso|permiso|ordenamiento|Sepuimm|Fonatur|IMPLAN", re.I),
}

# Theme-specific direction. Default is 0 (neutral / mixed).
PLUS_RX = {
    "agua": re.compile(r"avance|conclu|aportará|sumará|clausur|rehabilit|nueva planta|capacidad conjunta|reúso|reuso", re.I),
    "costa_clima": re.compile(r"restaur|protecci[oó]n costera|recuper|sin fauna afectada|no detect[oó] descargas", re.I),
    "turismo": re.compile(r"sube|eleva|supera|crece|r[eé]cord|derrama|ocupación al|ocupación de|puntos m[aá]s", re.I),
    "economia": re.compile(r"sube|crece|r[eé]cord|triplic|duplic|competitiv|lugar 5|5\.[ºo]|inversi[oó]n extranjera", re.I),
    "energia": re.compile(r"licit|megavatio|solar|almacenamiento|hidr[oó]geno|nueva central|restaura", re.I),
    "movilidad": re.compile(r"crece|nueva ruta|retoma vuelos|\+|acumula .{0,20}crece", re.I),
    "vivienda": re.compile(r"asignad|entreg|meta|convenio|relocalizaci[oó]n", re.I),
    "gobernanza": re.compile(r"aprueba|consulta|iniciativa|entrega(do)? al Congreso|paquete econ[oó]mico", re.I),
}
MINUS_RX = {
    "agua": re.compile(r"tandeo|desabasto|escasez|huachicol|sustracci|clandestin|sin suministro|pipas|d[eé]ficit", re.I),
    "costa_clima": re.compile(r"inund|erosi[oó]n|colapso|demolici[oó]n|eleva el nivel|bajo el agua|rescates|evacuad", re.I),
    "turismo": re.compile(r"cae|cay[oó]|cierre|freno|menos visitante|por debajo", re.I),
    "economia": re.compile(r"cae|cay[oó]|menos empleo|inflaci[oó]n|suben los precios|p[eé]rdida|negativ", re.I),
    "energia": re.compile(r"apag[oó]n|alerta|falla|isla energ[eé]tica|sin energ[ií]a", re.I),
    "movilidad": re.compile(r"cae|cay[oó]|disminu|−|-(\d)", re.I),
    "vivienda": re.compile(r"rezago|riesgo|sin servicios|insuficient", re.I),
    "gobernanza": re.compile(r"pausa|frena|impugna|conflicto|sin permiso|aplaza", re.I),
}

# How a + direction in each theme supports each scenario.
SCENARIO_WEIGHTS = {
    "base": {
        "agua": 0.15, "costa_clima": -0.15, "turismo": 0.80, "economia": 0.50,
        "energia": 0.20, "movilidad": 0.40, "vivienda": 0.15, "gobernanza": 0.20,
    },
    "estres_hidrico_costero": {
        "agua": -0.90, "costa_clima": -0.90, "turismo": 0.15, "economia": -0.15,
        "energia": -0.40, "movilidad": 0.00, "vivienda": -0.25, "gobernanza": 0.10,
    },
    "diversificacion": {
        "agua": 0.20, "costa_clima": 0.10, "turismo": 0.15, "economia": 0.70,
        "energia": 0.55, "movilidad": 0.45, "vivienda": 0.30, "gobernanza": 0.40,
    },
}

SCENARIO_META = {
    "base": {
        "label_es": "Trayectoria actual",
        "label_en": "Current path",
        "blurb_es": "El motor turístico-residencial de Los Cabos y el corredor costero siguen creciendo, con alivios incrementales de desalación y red.",
        "blurb_en": "The Los Cabos tourism-residential engine and the coastal corridor keep growing, with incremental desal and grid relief.",
    },
    "estres_hidrico_costero": {
        "label_es": "Estrés hídrico-costero",
        "label_en": "Water-coastal stress",
        "blurb_es": "Los techos de agua, costa y red se adelantan al crecimiento: déficits de acuíferos, oleaje y erosión condicionan permisos y vocaciones.",
        "blurb_en": "Water, coast and grid ceilings arrive before growth: aquifer deficits, surge and erosion condition permits and vocations.",
    },
    "diversificacion": {
        "label_es": "Diversificación policéntrica",
        "label_en": "Polycentric diversification",
        "blurb_es": "La Paz, el interior y el norte ganan peso (foro regional, tráfico de LAP, energía remota) y el estado no se sostiene solo clonando Cabos.",
        "blurb_en": "La Paz, the interior and the north gain weight (regional forum, LAP traffic, remote energy) and the state is not held together by cloning Cabos.",
    },
}

FORMULAS_ES = [
    "Intensidad suavizada (EWMA): s_t = α x_t + (1 − α) s_{t−1}, con s_1 = x_1 y α = 0.35. x_t es el número de notas del feed que coinciden con el tema en la semana t.",
    "Dirección: d_t = (n⁺_t − n⁻_t) / max(n⁺_t + n⁻_t + n⁰_t, 1) ∈ [−1, 1], según un léxico fijo por tema aplicado al titular y a la entradilla. El valor por defecto es 0 (neutro o mixto).",
    "Señal combinada: z_t = s̃_t d_t, donde s̃_t = s_t / max(s̄, 1) y s̄ es la media de s en las semanas observadas.",
    "Tendencia (cuando hay serie comparable): regresión lineal y = a + b t o log-lineal ln y = a + b t, con intervalo de predicción ŷ₀ ± t_{n−2, 0.975} σ̂ √[1 + 1/n + (t₀ − t̄)² / Σ(t − t̄)²]. Alternativa de corto plazo: suavizado de Holt ℓ_t = α_H y_t + (1 − α_H)(ℓ_{t−1} + b_{t−1}), b_t = β(ℓ_t − ℓ_{t−1}) + (1 − β) b_{t−1}, con α_H = 0.4 y β = 0.2.",
    "Horizonte 2030/2050: solo se publica si la serie tiene al menos 4 puntos comparables y un tramo de 8 años o más. Si no, la celda es «insuficiente». No se mezclan metodologías distintas (p. ej. ocupación SETUE y ocupación de la asociación hotelera) en una sola recta.",
    "Bayes: P(H_i | D_t) ∝ P(D_t | H_i) P(H_i), con prior P(H_i) igual al posterior de la semana anterior (uniforme 1/3 en la primera semana) y verosimilitud P(D_t | H_i) = exp(λ Σ_k w_ik z_{k,t}), λ = 0.45. Los pesos w_ik están fijos y documentados en el estado semanal.",
    "Confianza de cada afirmación: alta si hay fuente estadística oficial y al menos dos citas o una serie de más de un año; media si hay una fuente oficial o gremial que cita la cifra; baja si la cifra depende de una sola nota de prensa o de un estimado.",
]

FORMULAS_EN = [
    "Smoothed intensity (EWMA): s_t = α x_t + (1 − α) s_{t−1}, with s_1 = x_1 and α = 0.35. x_t is the number of feed items matching the theme in week t.",
    "Direction: d_t = (n⁺_t − n⁻_t) / max(n⁺_t + n⁻_t + n⁰_t, 1) ∈ [−1, 1], from a fixed per-theme lexicon on title and blurb. Default 0 (neutral or mixed).",
    "Combined signal: z_t = s̃_t d_t, where s̃_t = s_t / max(s̄, 1) and s̄ is the mean of s over observed weeks.",
    "Trend (when a comparable series exists): linear y = a + b t or log-linear ln y = a + b t, with prediction interval ŷ₀ ± t_{n−2, 0.975} σ̂ √[1 + 1/n + (t₀ − t̄)² / Σ(t − t̄)²]. Short-term alternative: Holt smoothing ℓ_t = α_H y_t + (1 − α_H)(ℓ_{t−1} + b_{t−1}), b_t = β(ℓ_t − ℓ_{t−1}) + (1 − β) b_{t−1}, with α_H = 0.4 and β = 0.2.",
    "2030/2050 horizon: published only if the series has at least 4 comparable points and a span of 8 years or more. Otherwise the cell is “insufficient”. Different methodologies are not fitted on one line.",
    "Bayes: P(H_i | D_t) ∝ P(D_t | H_i) P(H_i), prior = last week’s posterior (uniform 1/3 in week one), likelihood P(D_t | H_i) = exp(λ Σ_k w_ik z_{k,t}), λ = 0.45. Weights w_ik are fixed and stored in the weekly state.",
    "Confidence: high if an official statistical source plus at least two citations or a multi-year series; medium if one official or industry source states the figure; low if it rests on a single press note or an estimate.",
]


def load_json(path: Path, default=None):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def week_monday(iso: str) -> str:
    y, m, d = map(int, iso[:10].split("-"))
    dt = date(y, m, d)
    return (dt - timedelta(days=dt.weekday())).isoformat()


def item_blob(it: dict) -> str:
    return " ".join(
        str(it.get(k) or "")
        for k in ("title_es", "title_en", "blurb_es", "blurb_en")
    ) + " " + " ".join(it.get("topics") or [])


def direction_for(theme: str, blob: str) -> int:
    plus = bool(PLUS_RX[theme].search(blob))
    minus = bool(MINUS_RX[theme].search(blob))
    if plus and not minus:
        return 1
    if minus and not plus:
        return -1
    return 0


def ewma(values: list[float], alpha: float = ALPHA) -> list[float]:
    if not values:
        return []
    out = [float(values[0])]
    for x in values[1:]:
        out.append(alpha * float(x) + (1 - alpha) * out[-1])
    return out


def student_t_975(df: int) -> float:
    """Two-sided 97.5% t critical value (coarse but documented)."""
    table = {
        1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447,
        7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 12: 2.179, 15: 2.131,
        20: 2.086, 30: 2.042, 60: 2.000,
    }
    if df <= 0:
        return 1.96
    if df in table:
        return table[df]
    keys = sorted(table)
    for k in keys:
        if df <= k:
            return table[k]
    return 1.96


def ols(t: list[float], y: list[float]) -> dict | None:
    n = len(y)
    if n < MIN_POINTS_REGRESSION or len(t) != n:
        return None
    t_bar = sum(t) / n
    y_bar = sum(y) / n
    sxx = sum((ti - t_bar) ** 2 for ti in t)
    sxy = sum((ti - t_bar) * (yi - y_bar) for ti, yi in zip(t, y))
    if sxx <= 0:
        return None
    b = sxy / sxx
    a = y_bar - b * t_bar
    resid = [yi - (a + b * ti) for ti, yi in zip(t, y)]
    sse = sum(r * r for r in resid)
    sst = sum((yi - y_bar) ** 2 for yi in y)
    sigma2 = sse / (n - 2) if n > 2 else 0.0
    sigma = math.sqrt(max(sigma2, 0.0))
    r2 = 1 - sse / sst if sst > 0 else 0.0
    return {
        "a": a, "b": b, "n": n, "t_bar": t_bar, "sxx": sxx,
        "sigma": sigma, "r2": r2, "df": n - 2,
    }


def predict_ols(fit: dict, t0: float) -> dict:
    tcrit = student_t_975(fit["df"])
    se = fit["sigma"] * math.sqrt(
        1 + 1 / fit["n"] + (t0 - fit["t_bar"]) ** 2 / max(fit["sxx"], 1e-12)
    )
    yhat = fit["a"] + fit["b"] * t0
    half = tcrit * se
    return {"point": yhat, "lo": yhat - half, "hi": yhat + half, "se": se}


def holt(y: list[float], alpha=HOLT_ALPHA, beta=HOLT_BETA) -> dict | None:
    if len(y) < MIN_POINTS_REGRESSION:
        return None
    level = y[0]
    trend = y[1] - y[0]
    fitted = [level]
    for t in range(1, len(y)):
        prev_level = level
        level = alpha * y[t] + (1 - alpha) * (level + trend)
        trend = beta * (level - prev_level) + (1 - beta) * trend
        fitted.append(level + trend)
    resid = [yi - fi for yi, fi in zip(y, fitted)]
    sigma = math.sqrt(sum(r * r for r in resid) / max(len(y) - 2, 1))
    return {"level": level, "trend": trend, "sigma": sigma, "fitted": fitted}


def holt_forecast(fit: dict, h: int, tcrit: float = 1.96) -> dict:
    yhat = fit["level"] + h * fit["trend"]
    # Residual-based interval that widens with horizon (simple, documented).
    half = tcrit * fit["sigma"] * math.sqrt(h)
    return {"point": yhat, "lo": yhat - half, "hi": yhat + half, "h": h}


def classify_confidence(official: bool, n_sources: int, multiyear: bool) -> str:
    if official and (n_sources >= 2 or multiyear):
        return "alta"
    if official or n_sources >= 2:
        return "media"
    return "baja"


def news_signals(items: list[dict]) -> tuple[list[str], dict]:
    weeks = sorted({week_monday(it["date"]) for it in items if it.get("date")})
    weekly: dict[str, dict] = {}
    for w in weeks:
        weekly[w] = {
            th: {"count": 0, "plus": 0, "minus": 0, "zero": 0} for th in THEMES
        }
        weekly[w]["total_items"] = 0
    for it in items:
        if not it.get("date"):
            continue
        w = week_monday(it["date"])
        weekly[w]["total_items"] += 1
        blob = item_blob(it)
        for th in THEMES:
            if not THEME_RX[th].search(blob):
                continue
            weekly[w][th]["count"] += 1
            d = direction_for(th, blob)
            if d > 0:
                weekly[w][th]["plus"] += 1
            elif d < 0:
                weekly[w][th]["minus"] += 1
            else:
                weekly[w][th]["zero"] += 1
    # EWMA + direction per theme, then z
    ewma_by_theme: dict[str, list[float]] = {}
    dir_by_theme: dict[str, list[float]] = {}
    for th in THEMES:
        xs = [weekly[w][th]["count"] for w in weeks]
        ewma_by_theme[th] = ewma(xs)
        dirs = []
        for w in weeks:
            cell = weekly[w][th]
            n = cell["plus"] + cell["minus"] + cell["zero"]
            dirs.append((cell["plus"] - cell["minus"]) / max(n, 1))
        dir_by_theme[th] = dirs
    mean_s = {th: (sum(ewma_by_theme[th]) / len(weeks) if weeks else 1) for th in THEMES}

    history = []
    posteriors = []
    prior = {k: 1 / 3 for k in SCENARIO_WEIGHTS}
    for i, w in enumerate(weeks):
        signals = {}
        z = {}
        for th in THEMES:
            s = ewma_by_theme[th][i]
            d = dir_by_theme[th][i]
            z_t = (s / max(mean_s[th], 1.0)) * d
            z[th] = z_t
            cell = weekly[w][th]
            signals[th] = {
                "count": cell["count"],
                "ewma": round(s, 4),
                "direction": round(d, 4),
                "z": round(z_t, 4),
                "plus": cell["plus"],
                "minus": cell["minus"],
                "zero": cell["zero"],
            }
        # Bayes
        scores = {}
        for hid, weights in SCENARIO_WEIGHTS.items():
            scores[hid] = math.exp(LAMBDA_BAYES * sum(weights[th] * z[th] for th in THEMES))
        ev = sum(prior[h] * scores[h] for h in scores)
        posterior = {h: (prior[h] * scores[h] / ev) if ev > 0 else prior[h] for h in scores}
        moved = {h: posterior[h] - prior[h] for h in posterior}
        history.append({
            "week": w,
            "total_items": weekly[w]["total_items"],
            "signals": signals,
            "scenarios": {h: {"p": round(posterior[h], 4), "delta": round(moved[h], 4)} for h in posterior},
        })
        posteriors.append(posterior)
        prior = posterior
    return weeks, {"weekly": weekly, "history": history, "current": history[-1] if history else None}


def parse_float(val) -> float | None:
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val)
    m = re.search(r"-?\d+(?:[.,]\d+)?", s.replace(",", ""))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def series_entry(
    id_: str, label_es: str, label_en: str, unit: str, points: list[dict],
    comparable: bool, note_es: str, note_en: str,
) -> dict:
    """points: {t (year as float), y, label, source}."""
    pts = [p for p in points if p.get("y") is not None]
    span_years = 0.0
    if len(pts) >= 2:
        ts = [p["t"] for p in pts]
        span_years = max(ts) - min(ts)
    can_horizon = comparable and len(pts) >= MIN_POINTS_REGRESSION and span_years >= MIN_YEARS_FOR_HORIZON
    fit = None
    if comparable and len(pts) >= MIN_POINTS_REGRESSION:
        fit = ols([p["t"] for p in pts], [p["y"] for p in pts])
    proj = {"y2030": "insuficiente", "y2050": "insuficiente", "reason_es": "", "reason_en": ""}
    if not can_horizon:
        if not comparable:
            proj["reason_es"] = "Las observaciones no son una serie metodológicamente comparable."
            proj["reason_en"] = "The observations are not a methodologically comparable series."
        elif len(pts) < MIN_POINTS_REGRESSION:
            proj["reason_es"] = f"Hay {len(pts)} punto(s); se piden al menos {MIN_POINTS_REGRESSION} para ajustar una tendencia."
            proj["reason_en"] = f"{len(pts)} point(s); at least {MIN_POINTS_REGRESSION} are required to fit a trend."
        else:
            proj["reason_es"] = f"El tramo observado es de {span_years:.1f} años; se piden {MIN_YEARS_FOR_HORIZON} o más para publicar 2030/2050."
            proj["reason_en"] = f"The observed span is {span_years:.1f} years; {MIN_YEARS_FOR_HORIZON} or more are required to publish 2030/2050."
    elif fit:
        p30 = predict_ols(fit, 2030)
        p50 = predict_ols(fit, 2050)
        proj = {
            "y2030": {k: round(p30[k], 3) for k in ("point", "lo", "hi")},
            "y2050": {k: round(p50[k], 3) for k in ("point", "lo", "hi")},
            "reason_es": "Regresión lineal con intervalo de predicción al 95 %.",
            "reason_en": "Linear regression with a 95% prediction interval.",
        }
    short = None
    if comparable and len(pts) >= MIN_POINTS_REGRESSION:
        hfit = holt([p["y"] for p in pts])
        if hfit:
            fwd = holt_forecast(hfit, 2)
            last = pts[-1]["y"]
            width = abs(fwd["hi"] - fwd["lo"])
            unstable = (
                (last > 0 and fwd["point"] < 0)
                or (last != 0 and width > 3 * abs(last))
                or (fit and fit.get("r2", 1) < 0.15)
            )
            if unstable:
                short = {
                    "method": "Holt",
                    "next_2_steps": "insuficiente",
                    "sigma": round(hfit["sigma"], 3),
                    "r2_ols": (round(fit["r2"], 3) if fit else None),
                    "note_es": "El ajuste de corto plazo es inestable (estacionalidad o residuos grandes; R² lineal bajo). No se publica un punto de Holt.",
                    "note_en": "The short-term fit is unstable (seasonality or large residuals; low linear R²). No Holt point is published.",
                }
            else:
                short = {
                    "method": "Holt",
                    "next_2_steps": {k: round(fwd[k], 3) for k in ("point", "lo", "hi")},
                    "sigma": round(hfit["sigma"], 3),
                    "note_es": "Pronóstico de corto plazo (dos pasos). No se extiende a 2030/2050.",
                    "note_en": "Short-term forecast (two steps). It is not extended to 2030/2050.",
                }
    return {
        "id": id_,
        "label_es": label_es,
        "label_en": label_en,
        "unit": unit,
        "points": pts,
        "comparable": comparable,
        "n": len(pts),
        "span_years": round(span_years, 2),
        "ols": ({"a": round(fit["a"], 4), "b": round(fit["b"], 4), "r2": round(fit["r2"], 3), "n": fit["n"]} if fit else None),
        "projection": proj,
        "short_term": short,
        "note_es": note_es,
        "note_en": note_en,
    }


def build_series(facts: list, inv: dict, aq: dict, flights: dict, news_items: list) -> list[dict]:
    def fact(metric_sub: str, year=None):
        hits = [f for f in facts if metric_sub.lower() in str(f.get("metric") or "").lower()]
        if year is not None:
            hits = [f for f in hits if str(f.get("year")) == str(year)]
        return hits

    # Occupancy — different methodologies, not comparable
    occ_pts = [
        {"t": 2024.0, "y": 76.0, "label": "2024 JLL", "source": "JLL, ocupación hotelera Los Cabos 2024"},
        {"t": 2025.0, "y": 70.0, "label": "2025 SETUE", "source": "SETUE, ocupación 2025 Los Cabos (estancia 4.7 días)"},
        {"t": 2026.04, "y": 74.0, "label": "ene-2026", "source": "FITURCA / ficha portal, ocupación Los Cabos ene-2026"},
        {"t": 2026.86, "y": 78.0, "label": "1–15 nov 2026 AHLC", "source": "Asociación de Hoteles de Los Cabos, dos primeras semanas de noviembre de 2026"},
    ]
    # SJD passengers — mixed defs
    sjd_pts = [
        {"t": 2024.0, "y": 4.66, "label": "2024 intl JLL", "source": "JLL, pasajeros internacionales SJD 2024 (millones)"},
        {"t": 2025.0, "y": 4.69, "label": "2025 intl JLL", "source": "JLL, pasajeros internacionales SJD 2025 (millones)"},
        {"t": 2025.0, "y": 3.8, "label": "2025 SETUE ~", "source": "SETUE, pasajeros 2025 SJD (~3.8 millones; 83.2% del estado)"},
        {"t": 2026.83, "y": 0.5209, "label": "oct 2026 GAP", "source": "GAP, 520.9 mil pasajeros en octubre de 2026 (−4.6% anual)"},
    ]
    # Keep SETUE and GAP as separate notes; mark series not comparable because units/definitions mix.
    lap_pts = [
        {"t": 2025.0, "y": 668800, "label": "2025 SETUE", "source": "SETUE, pasajeros 2025 LAP 668,800 (+10.9% anual)"},
        {"t": 2026.83, "y": 1190000, "label": "ene–oct 2026 GAP", "source": "GAP, 1.19 millones ene–oct 2026 (+8.7%)"},
    ]
    pib_pts = [
        # 2024 level and +3.5% vs 2023 ⇒ 2023 = 187152/1.035
        {"t": 2023.0, "y": round(187152 / 1.035, 1), "label": "2023 (implícito)", "source": "INEGI PIBE: 187,152 M MXN constantes en 2024, +3.5% frente a 2023"},
        {"t": 2024.0, "y": 187152, "label": "2024", "source": "INEGI PIBE, PIB constante BCS 2024"},
    ]
    ied_pts = [
        {"t": 2024.0, "y": 1353, "label": "2024", "source": "CNIE, IED BCS 2024 (millones de dólares)"},
        {"t": 2025.0, "y": 1578, "label": "2025", "source": "CNIE, IED BCS 2025 (millones de dólares; 5.º nacional en el corte citado)"},
    ]
    peak_pts = [
        {"t": 2023.0, "y": 675, "label": "2023 (675 MW)", "source": "PRODESEN / ficha portal, pico SIBCS 2023; también se consigna 660 MW netos"},
        {"t": 2024.0, "y": 689, "label": "2024", "source": "CENACE / PRODESEN, pico SIBCS 2024 (689 MW; instantáneo 688.5 MW el 10 sep 2024)"},
    ]
    pop_pts = [
        {"t": 2020.0, "y": 798447, "label": "Censo 2020", "source": "INEGI Censo 2020, población estatal (POBTOT) 798,447"},
    ]
    imss_pts = [
        {"t": 2025.75, "y": 224460 + 1539, "label": "sep 2025", "source": "IMSS, citado en prensa: 224,460 puestos en septiembre de 2026 son 1,539 menos que un año antes"},
        {"t": 2026.75, "y": 224460, "label": "sep 2026", "source": "IMSS, citado en prensa: 224,460 puestos en septiembre de 2026 (−1.1% anual en octubre)"},
    ]
    infl_pts = [
        {"t": 2026.75, "y": 0.01, "label": "sep 2026 mensual", "source": "INEGI, inflación mensual La Paz septiembre 2026: 0.01%"},
        {"t": 2026.83, "y": 1.17, "label": "oct 2026 mensual", "source": "INEGI, inflación mensual La Paz octubre 2026: 1.17% (anual 3.16%)"},
    ]
    qs = (inv.get("cabo_re_quarterly") or {}).get("quarters") or []
    cabo_pts = []
    for i, q in enumerate(qs):
        # 2025 Q1 = 2025.00, Q2=2025.25, ...
        lab = q.get("period") or ""
        m = re.match(r"(\d{4})\s*Q([1-4])", lab)
        if not m or q.get("volume_m_usd") is None:
            continue
        year, qq = int(m.group(1)), int(m.group(2))
        cabo_pts.append({
            "t": year + (qq - 1) * 0.25,
            "y": float(q["volume_m_usd"]),
            "label": lab,
            "source": "Cabo Real Estate Services, volumen bajo contrato (millones de USD), " + lab,
        })
    dma_pts = [
        {
            "t": 2023.0,
            "y": float(aq.get("deficit_sum_hm3") or 0),
            "label": "2023 CONAGUA",
            "source": f"CONAGUA, disponibilidad media anual: {aq.get('deficit_count')} acuíferos en déficit de {len(aq.get('aquifers') or [])}; suma {aq.get('deficit_sum_hm3')} hm³/año",
        }
    ]

    series = [
        series_entry(
            "ocupacion_los_cabos", "Ocupación hotelera en Los Cabos", "Hotel occupancy in Los Cabos", "%",
            occ_pts, False,
            "JLL 2024, SETUE 2025, ficha ene-2026 y Asociación de Hoteles (1–15 nov 2026) no comparten la misma metodología ni la misma ventana. No se ajusta una recta.",
            "JLL 2024, SETUE 2025, January 2026 and the Hotel Association (1–15 Nov 2026) do not share a method or window. No line is fitted.",
        ),
        series_entry(
            "pax_sjd", "Pasajeros en el aeropuerto de Los Cabos", "Los Cabos airport passengers", "millones o miles, ver puntos",
            sjd_pts, False,
            "JLL reporta pasajeros internacionales anuales; SETUE un total 2025 aproximado; GAP un mes y un acumulado 2026. No son una sola serie.",
            "JLL reports annual international passengers; SETUE an approximate 2025 total; GAP a 2026 month and year-to-date. Not one series.",
        ),
        series_entry(
            "pax_lap", "Pasajeros en el aeropuerto de La Paz", "La Paz airport passengers", "pasajeros",
            lap_pts, False,
            "SETUE 2025 (año) y GAP ene–oct 2026 (acumulado) cubren ventanas distintas.",
            "SETUE 2025 (calendar year) and GAP Jan–Oct 2026 (year-to-date) cover different windows.",
        ),
        series_entry(
            "empleo_imss", "Empleo formal IMSS en BCS", "Formal IMSS employment in BCS", "puestos",
            imss_pts, False,
            "Solo hay un corte comparable citado en prensa (septiembre 2025 implícito y septiembre 2026: 224,460). El −1.1% es la variación anual de octubre.",
            "Only one comparable press-cited cut (implicit Sep 2025 and Sep 2026: 224,460). The −1.1% is the October year-on-year change.",
        ),
        series_entry(
            "inflacion_la_paz", "Inflación mensual en La Paz", "Monthly inflation in La Paz", "%",
            infl_pts, False,
            "Dos meses de INEGI (sep y oct 2026). Insuficiente para una tendencia de mediano plazo.",
            "Two INEGI months (Sep and Oct 2026). Insufficient for a medium-term trend.",
        ),
        series_entry(
            "pib_constante", "PIB estatal a precios constantes", "State GDP at constant prices", "millones de MXN",
            pib_pts, True,
            "INEGI PIBE: 187,152 millones en 2024, +3.5% frente a 2023. El valor 2023 se obtiene de esa tasa oficial. Dos años no bastan para 2030/2050.",
            "INEGI PIBE: 187,152 million in 2024, +3.5% versus 2023. The 2023 level is implied by that official rate. Two years are not enough for 2030/2050.",
        ),
        series_entry(
            "ied_bcs", "IED en Baja California Sur", "FDI in Baja California Sur", "millones de USD",
            ied_pts, True,
            "CNIE: 1,353 (2024) y 1,578 (2025). Dos cortes anuales; no se proyecta a 2030/2050.",
            "CNIE: 1,353 (2024) and 1,578 (2025). Two annual cuts; no 2030/2050 projection.",
        ),
        series_entry(
            "pico_sibcs", "Pico de demanda del SIBCS", "SIBCS peak demand", "MW",
            peak_pts, False,
            "En 2023 el portal consigna 660 MW netos y 675 MW; en 2024, 689 MW (instantáneo 688.5). No se elige un único valor de 2023 para ajustar una recta.",
            "For 2023 the portal records both 660 MW net and 675 MW; for 2024, 689 MW (instantaneous 688.5). No single 2023 value is chosen for a fit.",
        ),
        series_entry(
            "poblacion_estatal", "Población estatal", "State population", "habitantes",
            pop_pts, True,
            "Solo está el Censo 2020 (798,447). Sin una serie CONAPO o un censo previo en el portal, 2030/2050 es insuficiente.",
            "Only the 2020 Census (798,447) is in the portal. Without a CONAPO series or a prior census, 2030/2050 is insufficient.",
        ),
        series_entry(
            "cabo_re_volumen", "Volumen residencial bajo contrato en Los Cabos", "Los Cabos residential volume under contract", "millones de USD",
            cabo_pts, True,
            "Seis trimestres (2025 Q1–2026 Q2) de Cabo Real Estate Services. La serie es corta y estacional: se reporta un Holt de corto plazo, no una proyección a 2030/2050.",
            "Six quarters (2025 Q1–2026 Q2) from Cabo Real Estate Services. The series is short and seasonal: a short-term Holt is reported, not a 2030/2050 projection.",
        ),
        series_entry(
            "dma_deficit", "Suma de balances DMA en acuíferos en déficit", "Sum of DMA balances in deficit aquifers", "hm³/año",
            dma_pts, True,
            f"Corte CONAGUA 2023: {aq.get('deficit_count')} de {len(aq.get('aquifers') or [])} acuíferos en déficit; suma {aq.get('deficit_sum_hm3')} hm³/año. Un solo año; no hay tendencia.",
            f"CONAGUA 2023 cut: {aq.get('deficit_count')} of {len(aq.get('aquifers') or [])} aquifers in deficit; sum {aq.get('deficit_sum_hm3')} hm³/year. A single year; no trend.",
        ),
    ]
    # flights snapshot (not a series)
    return series


def change_line(curr: dict, prev: dict | None, weeks_theme_jump: tuple[str, str] | str | None = None) -> tuple[str, str]:
    if not curr:
        return ("Sin cálculo esta semana.", "No calculation this week.")
    bits_es, bits_en = [], []
    # scenario move
    sc = curr["scenarios"]
    ranked = sorted(sc, key=lambda h: sc[h]["p"], reverse=True)
    top = ranked[0]
    delta_top = sc[top]["delta"]
    label = SCENARIO_META[top]["label_es"]
    label_en = SCENARIO_META[top]["label_en"]
    sign = "sube" if delta_top >= 0 else "baja"
    sign_en = "rises" if delta_top >= 0 else "falls"
    bits_es.append(
        f"El escenario con mayor probabilidad es «{label}» ({sc[top]['p']*100:.0f} %, {sign} {abs(delta_top)*100:.1f} puntos frente a la semana previa)."
    )
    bits_en.append(
        f"The leading scenario is “{label_en}” ({sc[top]['p']*100:.0f}%, {sign_en} {abs(delta_top)*100:.1f} points versus the previous week)."
    )
    # strongest theme z or count jump
    sigs = curr["signals"]
    top_th = max(THEMES, key=lambda th: sigs[th]["count"])
    bits_es.append(
        f"La mayor intensidad de notas de esta semana está en {THEME_LABEL_ES[top_th]} ({sigs[top_th]['count']} notas; EWMA {sigs[top_th]['ewma']:.2f}; dirección {sigs[top_th]['direction']:+.2f})."
    )
    bits_en.append(
        f"The week’s highest news intensity is in {THEME_LABEL_EN[top_th]} ({sigs[top_th]['count']} items; EWMA {sigs[top_th]['ewma']:.2f}; direction {sigs[top_th]['direction']:+.2f})."
    )
    if weeks_theme_jump:
        if isinstance(weeks_theme_jump, tuple):
            bits_es.append(weeks_theme_jump[0])
            bits_en.append(weeks_theme_jump[1])
        else:
            bits_es.append(weeks_theme_jump)
    return (" ".join(bits_es), " ".join(bits_en))


def word_count(text: str) -> int:
    return len(re.findall(r"\S+", text or ""))


def load_prose(path: Path | None) -> str:
    if path and path.exists():
        return path.read_text(encoding="utf-8").strip()
    return ""


def incremental_prose(prev_text: str, stale: list[str]) -> tuple[str, bool]:
    """Keep last week's narrative unless a curator replaced it. Flag only."""
    if not prev_text:
        return "", True
    return prev_text, bool(stale)


def build(args) -> dict:
    news = load_json(DATA / "news.json", {"items": []})
    items = news.get("items") or []
    facts_doc = load_json(DATA / "portal_facts.json", {"facts": []})
    facts = facts_doc.get("facts") or []
    inv = load_json(DATA / "inmobiliario_metrics.json", {})
    aq = load_json(DATA / "aquifers_bcs.json", {})
    flights = load_json(DATA / "flight_connections_bcs.json", {})
    gds = load_json(DATA / "growth_demand_supply.json", {})
    fs = load_json(DATA / "foresights.json", {})
    prior = load_json(OUT, {}) or {}
    claims_in = load_json(DATA / "foresights_vision_prose" / "claims.json", None)

    weeks, sig = news_signals(items)
    series = build_series(facts, inv, aq, flights, items)
    curr = sig["current"]
    prev_hist = (prior.get("quant_history") or [])
    prev_curr = prev_hist[-1] if prev_hist else None
    # jump note for economia this week if applicable
    jump = None
    if curr and len(sig["history"]) >= 2:
        prev_s = sig["history"][-2]["signals"]
        jumps, jumps_en = [], []
        for th in THEMES:
            dcount = curr["signals"][th]["count"] - prev_s[th]["count"]
            if abs(dcount) >= 5:
                jumps.append(f"{THEME_LABEL_ES[th]} {prev_s[th]['count']}→{curr['signals'][th]['count']}")
                jumps_en.append(f"{THEME_LABEL_EN[th]} {prev_s[th]['count']}→{curr['signals'][th]['count']}")
        if jumps:
            jump = (
                "Cambios de intensidad (≥5 notas): " + ", ".join(jumps) + ".",
                "Intensity changes (≥5 items): " + ", ".join(jumps_en) + ".",
            )
    change_es, change_en = change_line(curr, prev_curr, jump)

    today = args.date or date.today().isoformat()
    prose_es = load_prose(Path(args.prose_es) if args.prose_es else None) or (prior.get("narrative_es") or "")
    prose_en = load_prose(Path(args.prose_en) if args.prose_en else None) or (prior.get("narrative_en") or "")
    needs_curation = False
    if not args.prose_es and prior.get("narrative_es"):
        prose_es, needs_curation = incremental_prose(prior["narrative_es"], [])
    if not args.prose_en and prior.get("narrative_en"):
        prose_en, needs_en = incremental_prose(prior["narrative_en"], [])
        needs_curation = needs_curation or needs_en
    if not prose_es:
        needs_curation = True

    # Preserve earlier full narratives in history (do not drop previous weeks' prose)
    history = list(prior.get("history") or [])
    # Replace same-day snapshot if rerun
    history = [h for h in history if h.get("updated") != today]
    snapshot = {
        "updated": today,
        "week": curr["week"] if curr else None,
        "change_es": change_es,
        "change_en": change_en,
        "narrative_es": prose_es,
        "narrative_en": prose_en,
        "word_count_es": word_count(prose_es),
        "scenarios": curr["scenarios"] if curr else {},
        "signals": curr["signals"] if curr else {},
    }
    history.append(snapshot)
    history.sort(key=lambda h: h.get("updated") or "")

    state = {
        "updated": today,
        "period": {"news_from": min((it.get("date") or "9999") for it in items) if items else None,
                   "news_to": max((it.get("date") or "") for it in items) if items else None,
                   "n_news": len(items)},
        "title_es": "Visión tendencia",
        "title_en": "Trend vision",
        "kicker_es": "Lectura viva hacia 2050, actualizada cada semana con lo que ya está medido.",
        "kicker_en": "A living reading toward 2050, updated each week with what is already measured.",
        "change_es": change_es,
        "change_en": change_en,
        "narrative_es": prose_es,
        "narrative_en": prose_en,
        "word_count_es": word_count(prose_es),
        "word_count_en": word_count(prose_en),
        "needs_curation": needs_curation,
        "claims": claims_in or prior.get("claims") or [],
        "scenarios": curr["scenarios"] if curr else {},
        "scenario_meta": SCENARIO_META,
        "scenario_weights": SCENARIO_WEIGHTS,
        "signals": curr["signals"] if curr else {},
        "signals_week": curr["week"] if curr else None,
        "series": series,
        "parameters": {
            "alpha_ewma": ALPHA,
            "lambda_bayes": LAMBDA_BAYES,
            "holt_alpha": HOLT_ALPHA,
            "holt_beta": HOLT_BETA,
            "min_points": MIN_POINTS_REGRESSION,
            "min_years_horizon": MIN_YEARS_FOR_HORIZON,
        },
        "formulas_es": FORMULAS_ES,
        "formulas_en": FORMULAS_EN,
        "method_note_es": "Prospectiva interna. No es un plan oficial ni una predicción puntual de llegada a 2050. Las cifras salen del feed de noticias y de los datos ya publicados en el portal; donde la serie no alcanza, se declara insuficiente.",
        "method_note_en": "Internal foresight. Not an official plan and not a point forecast of arrival in 2050. Figures come from the news feed and from data already on the portal; where the series falls short, it is marked insufficient.",
        "edition_headline_es": fs.get("headline_es") or "",
        "edition_updated": fs.get("updated") or "",
        "gds_balance_es": (gds.get("state_rollup") or {}).get("balance_read_es") or "",
        "quant_history": sig["history"],
        "history": history,
    }
    return state


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--date", help="Edition date YYYY-MM-DD (default: today)")
    p.add_argument("--prose-es", help="Path to curated Spanish narrative")
    p.add_argument("--prose-en", help="Path to curated English narrative")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--quant-only", action="store_true")
    args = p.parse_args()
    state = build(args)
    if args.quant_only:
        print(json.dumps({
            "week": state.get("signals_week"),
            "n_news": state["period"]["n_news"],
            "change_es": state["change_es"],
            "scenarios": state["scenarios"],
            "signals": state["signals"],
            "series": [
                {
                    "id": s["id"], "n": s["n"], "comparable": s["comparable"],
                    "ols": s["ols"], "projection": s["projection"]["y2030"],
                    "reason": s["projection"]["reason_es"],
                    "short": s.get("short_term"),
                }
                for s in state["series"]
            ],
        }, ensure_ascii=False, indent=2))
        return 0
    raw = json.dumps(state, ensure_ascii=False, indent=2) + "\n"
    if args.dry_run:
        print(raw)
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(raw, encoding="utf-8")
    print(
        f"wrote {OUT} updated={state['updated']} words_es={state['word_count_es']} "
        f"needs_curation={state['needs_curation']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
