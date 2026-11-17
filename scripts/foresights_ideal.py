#!/usr/bin/env python3
"""BCS Foresights — Visión 2050 (normative / regenerative scenario).

Builds src/data/foresights_ideal.json from the current Tendencia state
(foresights_vision.json), portal claims, and the growth demand–supply
rollup. For each main risk or driver in the Tendencia, it states:

  * the risk as the Tendencia measures it,
  * a regenerative target labelled as an aspiración,
  * levers already visible in portal data.

No invented figures: every number is copied from an existing claim,
series or official source already on the portal. Targets that lack a
sourced 2050 value stay qualitative and are labelled «aspiración».

Previous daily snapshots are archived to
src/data/foresights_ideal_editions/{date}.json (write-once for older
dates; today's file may be refreshed). Narrative history is also kept
inside the JSON, same-day snapshots replaced on rerun.

Usage:
    python3 scripts/foresights_ideal.py --date YYYY-MM-DD
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"
OUT = DATA / "foresights_ideal.json"
VISION = DATA / "foresights_vision.json"
GDS = DATA / "growth_demand_supply.json"
EDITIONS = DATA / "foresights_ideal_editions"

THEME_ORDER = [
    "agua",
    "costa_clima",
    "turismo",
    "economia",
    "energia",
    "movilidad",
    "vivienda",
    "gobernanza",
]

LABEL_ES = {
    "agua": "Agua",
    "costa_clima": "Costa y clima",
    "turismo": "Turismo",
    "economia": "Economía",
    "energia": "Energía",
    "movilidad": "Movilidad",
    "vivienda": "Vivienda",
    "gobernanza": "Gobernanza",
}
LABEL_EN = {
    "agua": "Water",
    "costa_clima": "Coast and climate",
    "turismo": "Tourism",
    "economia": "Economy",
    "energia": "Energy",
    "movilidad": "Mobility",
    "vivienda": "Housing",
    "gobernanza": "Governance",
}


def load_json(path: Path, default=None):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def claim_map(vision: dict) -> dict:
    return {c.get("id"): c for c in (vision.get("claims") or []) if c.get("id")}


def claim_text(claims: dict, cid: str, lang: str) -> str:
    c = claims.get(cid) or {}
    return (c.get(lang) or "").strip()


def dir_word_es(d: float) -> str:
    if d > 0.05:
        return "las notas del periodo apuntan más a alivios o avances"
    if d < -0.05:
        return "las notas del periodo apuntan más a tensiones o retrocesos"
    return "las notas del periodo son mixtas o neutras"


def dir_word_en(d: float) -> str:
    if d > 0.05:
        return "news in the period leans toward relief or progress"
    if d < -0.05:
        return "news in the period leans toward stress or setbacks"
    return "news in the period is mixed or neutral"


def signal_line(sig: dict, theme: str, lang: str) -> str:
    s = (sig or {}).get(theme) or {}
    count = s.get("count", 0)
    ewma = s.get("ewma")
    direction = s.get("direction", 0) or 0
    ewma_s = f"{ewma:.2f}" if isinstance(ewma, (int, float)) else "—"
    if lang == "es":
        return (
            f"{LABEL_ES[theme]} concentra {count} notas en la semana en curso "
            f"(EWMA {ewma_s}; dirección {direction:+.2f}: {dir_word_es(direction)})."
        )
    return (
        f"{LABEL_EN[theme]} accounts for {count} items in the current week "
        f"(EWMA {ewma_s}; direction {direction:+.2f}: {dir_word_en(direction)})."
    )


def is_stressed(s: dict | None) -> bool:
    if not s:
        return False
    d = s.get("direction") or 0
    z = s.get("z") or 0
    return d < -0.05 or z < -0.15


def pillars_for(vision: dict, gds: dict) -> list[dict]:
    claims = claim_map(vision)
    sigs = vision.get("signals") or {}
    gds_es = (gds.get("state_rollup") or {}).get("balance_read_es") or ""
    gds_en = (gds.get("state_rollup") or {}).get("balance_read_en") or ""
    dma = claim_text(claims, "dma", "es")
    dma_en = claim_text(claims, "dma", "en")
    desal = claim_text(claims, "desal", "es")
    desal_en = claim_text(claims, "desal", "en")
    tomas = claim_text(claims, "tomas", "es")
    tomas_en = claim_text(claims, "tomas", "en")
    nino = claim_text(claims, "nino", "es")
    nino_en = claim_text(claims, "nino", "en")
    setue = claim_text(claims, "setue_occ", "es")
    setue_en = claim_text(claims, "setue_occ", "en")
    ahlc = claim_text(claims, "ahlc", "es")
    ahlc_en = claim_text(claims, "ahlc", "en")
    pib = claim_text(claims, "pib", "es")
    pib_en = claim_text(claims, "pib", "en")
    ied = claim_text(claims, "ied", "es")
    ied_en = claim_text(claims, "ied", "en")
    imss = claim_text(claims, "imss", "es")
    imss_en = claim_text(claims, "imss", "en")
    foro = claim_text(claims, "foro", "es")
    foro_en = claim_text(claims, "foro", "en")
    sibcs = claim_text(claims, "sibcs", "es")
    sibcs_en = claim_text(claims, "sibcs", "en")
    gap = claim_text(claims, "gap", "es")
    gap_en = claim_text(claims, "gap", "en")
    poblacion = claim_text(claims, "poblacion", "es")
    poblacion_en = claim_text(claims, "poblacion", "en")

    templates = {
        "agua": {
            "risk_es": " ".join(
                x for x in [
                    "El techo hídrico es el principal condicionante de cualquier 2050.",
                    dma + "." if dma and not dma.endswith(".") else dma,
                    tomas + "." if tomas and not tomas.endswith(".") else tomas,
                    "La ENCIG 2025, citada en la cobertura local, indica que solo tres de cada diez personas en el estado tienen suministro constante.",
                    signal_line(sigs, "agua", "es"),
                ] if x
            ),
            "risk_en": " ".join(
                x for x in [
                    "The water ceiling is the main constraint on any 2050 path.",
                    dma_en + "." if dma_en and not dma_en.endswith(".") else dma_en,
                    tomas_en + "." if tomas_en and not tomas_en.endswith(".") else tomas_en,
                    "ENCIG 2025, cited in local coverage, finds that only three in ten people in the state have a constant supply.",
                    signal_line(sigs, "agua", "en"),
                ] if x
            ),
            "aspiration_es": (
                "Aspiración: un estado donde el crecimiento nuevo no se sostenga sobre acuíferos en déficit, "
                "el abasto continuo deje de ser la excepción y el reúso entre en la cuenta del margen hídrico. "
                "No se publica aquí una cifra-objetivo a 2050: el portal no tiene una meta oficial de equilibrio."
            ),
            "aspiration_en": (
                "Aspiration: a state where new growth is not carried by aquifers already in deficit, "
                "continuous supply is no longer the exception, and reuse counts toward the water margin. "
                "No 2050 target figure is published here: the portal has no official equilibrium goal."
            ),
            "levers_es": [
                x for x in [
                    (desal + " Es una palanca de abasto ya en obra, no una licencia para seguir extrayendo de acuíferos en déficit.") if desal else "",
                    "Cerrar y prevenir tomas clandestinas, con el volumen estimado de sustracción como señal de lo que hoy se pierde antes de llegar al usuario.",
                    "Atar permisos de crecimiento a la disponibilidad media anual por acuífero (NOM-011) y a fuentes que no finjan crédito sobre el déficit.",
                    "Usar el tablero de demanda y oferta del portal para no compensar en el papel un déficit local con un margen de otro municipio.",
                ] if x
            ],
            "levers_en": [
                x for x in [
                    (desal_en + " It is a supply lever already under construction, not a licence to keep drawing from aquifers in deficit.") if desal_en else "",
                    "Close and prevent illegal taps, taking the estimated diverted volume as a signal of what is lost before it reaches users.",
                    "Tie growth permits to mean annual availability per aquifer (NOM-011) and to sources that do not pretend credit against the deficit.",
                    "Use the portal’s demand–supply board so a local deficit is not offset on paper by headroom in another municipality.",
                ] if x
            ],
        },
        "costa_clima": {
            "risk_es": " ".join(
                x for x in [
                    "El techo costero ya es visible: oleaje, erosión, inundaciones y revisiones de lo construido sobre la línea de costa.",
                    nino + "." if nino and not nino.endswith(".") else nino,
                    "El portal no proyecta una línea de costa a 2050: no hay una serie comparable con el tramo mínimo exigido, y esa celda permanece insuficiente.",
                    signal_line(sigs, "costa_clima", "es"),
                ] if x
            ),
            "risk_en": " ".join(
                x for x in [
                    "The coastal ceiling is already visible: surge, erosion, flooding and reviews of what was built on the shoreline.",
                    nino_en + "." if nino_en and not nino_en.endswith(".") else nino_en,
                    "The portal does not project a 2050 shoreline: there is no comparable series with the required span, and that cell stays insufficient.",
                    signal_line(sigs, "costa_clima", "en"),
                ] if x
            ),
            "aspiration_es": (
                "Aspiración: una costa habitable y regenerativa, donde la restauración de barreras y playas "
                "y la retirada de lo construido en zona de riesgo precedan a cualquier nueva ocupación. "
                "Sin línea de costa modelada a 2050, la meta se enuncia en ese sentido, no como un metro de retroceso."
            ),
            "aspiration_en": (
                "Aspiration: a habitable, regenerative coast, where restoring barriers and beaches "
                "and retreating from risk zones come before any new occupation. "
                "With no modelled 2050 shoreline, the goal is stated in that sense, not as a metre of setback."
            ),
            "levers_es": [
                "Hacer valer las revisiones ambientales ya abiertas (como la del Hotel San Cristóbal en Punta Lobos) para que los escombros y el precedente no se diluyan.",
                "Situar relocalización y retiro en primera línea de las decisiones, no como remedio posterior a la siguiente marejada.",
                "Respetar techos de ANP y de ordenamiento costero antes de escalar hospitalidad en East Cape, Loreto y el Pacífico.",
            ],
            "levers_en": [
                "Follow through on environmental reviews already opened (such as Hotel San Cristóbal in Punta Lobos) so debris and precedent are not washed away.",
                "Put relocation and retreat at the front of decisions, not as a remedy after the next surge.",
                "Respect ANP and coastal-planning ceilings before scaling hospitality in East Cape, Loreto and the Pacific corridor.",
            ],
        },
        "turismo": {
            "risk_es": " ".join(
                x for x in [
                    "El motor turístico-residencial de Los Cabos y el corredor costero es el núcleo de la trayectoria actual: concentra demanda sobre techos de agua, red y costa.",
                    setue + "." if setue and not setue.endswith(".") else setue,
                    ahlc + "." if ahlc and not ahlc.endswith(".") else ahlc,
                    gds_es,
                    signal_line(sigs, "turismo", "es"),
                ] if x
            ),
            "risk_en": " ".join(
                x for x in [
                    "The Los Cabos tourism-residential engine and the coastal corridor are the core of the current path: they concentrate demand on water, grid and coastal ceilings.",
                    setue_en + "." if setue_en and not setue_en.endswith(".") else setue_en,
                    ahlc_en + "." if ahlc_en and not ahlc_en.endswith(".") else ahlc_en,
                    gds_en,
                    signal_line(sigs, "turismo", "en"),
                ] if x
            ),
            "aspiration_es": (
                "Aspiración: un turismo que quepa dentro de los techos de agua, energía y costa, "
                "y que no se sostenga clonando el modelo de Cabos a lo largo del estado. "
                "La ocupación y la derrama se leen como señales, no como una meta de volumen a 2050 que el portal no publica."
            ),
            "aspiration_en": (
                "Aspiration: tourism that fits within the water, energy and coastal ceilings, "
                "and that is not held together by cloning the Cabos model along the state. "
                "Occupancy and spending are read as signals, not as a 2050 volume target the portal does not publish."
            ),
            "levers_es": [
                "Condicionar nuevo crecimiento turístico o residencial a evidencia de margen hídrico y eléctrico, o a una fuente que no finja crédito NOM-011.",
                "Tratar el cierre de playas y la calidad de la costa como un límite de la vocación, no como un incidente de temporada.",
                "Desplazar peso relativo hacia La Paz, Loreto y el interior, cada uno con un rol distinto, no como un Cabos diluido.",
            ],
            "levers_en": [
                "Condition new tourism or residential growth on evidenced water and power margin, or on a source that does not pretend NOM-011 credit.",
                "Treat beach closures and coastal quality as a limit on the vocation, not as a seasonal incident.",
                "Shift relative weight toward La Paz, Loreto and the interior, each with a distinct role, not a diluted Cabos.",
            ],
        },
        "economia": {
            "risk_es": " ".join(
                x for x in [
                    "La economía estatal crece, pero no de forma pareja, y una parte del relato de inversión es todavía una propuesta, no una trayectoria medida.",
                    pib + "." if pib and not pib.endswith(".") else pib,
                    ied + "." if ied and not ied.endswith(".") else ied,
                    imss + "." if imss and not imss.endswith(".") else imss,
                    foro + "." if foro and not foro.endswith(".") else foro,
                    signal_line(sigs, "economia", "es"),
                ] if x
            ),
            "risk_en": " ".join(
                x for x in [
                    "The state economy is growing, but not evenly, and part of the investment story is still a proposal, not a measured path.",
                    pib_en + "." if pib_en and not pib_en.endswith(".") else pib_en,
                    ied_en + "." if ied_en and not ied_en.endswith(".") else ied_en,
                    imss_en + "." if imss_en and not imss_en.endswith(".") else imss_en,
                    foro_en + "." if foro_en and not foro_en.endswith(".") else foro_en,
                    signal_line(sigs, "economia", "en"),
                ] if x
            ),
            "aspiration_es": (
                "Aspiración: una economía policéntrica y regenerativa, donde la inversión no se concentre solo en clonar el motor de Cabos, "
                "y donde el empleo formal no quede a merced de una sola vocación costera. "
                "Las metas de crecimiento o de IED que circulan en foros se tratan como propuestas ajenas, no como cifras del portal."
            ),
            "aspiration_en": (
                "Aspiration: a polycentric, regenerative economy, where investment is not concentrated only on cloning the Cabos engine, "
                "and formal employment is not left at the mercy of a single coastal vocation. "
                "Growth or FDI goals circulating in forums are treated as outside proposals, not as portal figures."
            ),
            "levers_es": [
                "Dar peso a La Paz como capital de servicios y nodo agua–energía, a Comondú como producción agropecuaria con más margen relativo, y al norte como energía remota, no como residencial de amenidad sin evidencia.",
                "Leer el empleo formal y la inflación junto con los techos de agua y red, no como un tablero aparte.",
                "No usar una meta de foro (por ejemplo triplicar la IED) como si fuera una proyección ya aceptada.",
            ],
            "levers_en": [
                "Give weight to La Paz as a services capital and water–energy node, to Comondú as agricultural production with relative headroom, and to the north as remote energy, not amenity residential without evidence.",
                "Read formal employment and inflation together with the water and grid ceilings, not as a separate board.",
                "Do not treat a forum goal (for example tripling FDI) as if it were an already accepted projection.",
            ],
        },
        "energia": {
            "risk_es": " ".join(
                x for x in [
                    "BCS sigue como sistema aislado: el techo eléctrico es único y no se cancela con un margen de otro lugar.",
                    sibcs + "." if sibcs and not sibcs.endswith(".") else sibcs,
                    "El crecimiento turístico y el bombeo o la desalación compiten por el mismo sistema.",
                    signal_line(sigs, "energia", "es"),
                ] if x
            ),
            "risk_en": " ".join(
                x for x in [
                    "BCS remains an island grid: the power ceiling is one, and it is not cancelled by headroom elsewhere.",
                    sibcs_en + "." if sibcs_en and not sibcs_en.endswith(".") else sibcs_en,
                    "Tourism growth and pumping or desalination compete for the same system.",
                    signal_line(sigs, "energia", "en"),
                ] if x
            ),
            "aspiration_es": (
                "Aspiración: un sistema que deje atrás la condición de isla energética, con generación limpia, almacenamiento "
                "y demanda que quepa en el techo real del SIBCS. "
                "No se inventa aquí un pico en megawatts a 2050: donde la serie no alcanza, la Tendencia ya declara insuficiente."
            ),
            "aspiration_en": (
                "Aspiration: a system that leaves island-grid status behind, with clean generation, storage "
                "and demand that fits the real SIBCS ceiling. "
                "No 2050 peak in megawatts is invented here: where the series falls short, the Trend already marks it insufficient."
            ),
            "levers_es": [
                "Concluir y transparentar las licitaciones de generación remota ya visibles en el norte, sin convertirlas en un permiso residencial anticipado.",
                "Planear la desalación y el bombeo junto con la red, no como una suma posterior de megawatts faltantes.",
                "No añadir demanda turística o inmobiliaria en Cabos sin evidencia de margen en el SIBCS.",
            ],
            "levers_en": [
                "Complete and make transparent the remote-generation tenders already visible in the north, without turning them into an advance residential permit.",
                "Plan desalination and pumping together with the grid, not as a later sum of missing megawatts.",
                "Do not add tourism or real-estate demand in Cabos without evidenced SIBCS margin.",
            ],
        },
        "movilidad": {
            "risk_es": " ".join(
                x for x in [
                    "La conectividad aérea y terrestre revela hacia dónde se concentra el crecimiento —y dónde empieza a ceder.",
                    gap + "." if gap and not gap.endswith(".") else gap,
                    signal_line(sigs, "movilidad", "es"),
                ] if x
            ),
            "risk_en": " ".join(
                x for x in [
                    "Air and land connectivity show where growth is concentrating — and where it is starting to give way.",
                    gap_en + "." if gap_en and not gap_en.endswith(".") else gap_en,
                    signal_line(sigs, "movilidad", "en"),
                ] if x
            ),
            "aspiration_es": (
                "Aspiración: una conectividad al servicio de un estado policéntrico, no solo del eje SJD–Los Cabos. "
                "El tráfico de LAP y las rutas marítimas se leen como palancas ya observables, no como una meta de pasajeros a 2050."
            ),
            "aspiration_en": (
                "Aspiration: connectivity in the service of a polycentric state, not only of the SJD–Los Cabos axis. "
                "LAP traffic and maritime routes are read as already observable levers, not as a 2050 passenger target."
            ),
            "levers_es": [
                "Sostener el nodo de La Paz (LAP) como contrapeso medido al aeropuerto de Los Cabos, con los datos de GAP ya publicados.",
                "Integrar ferries y el cabotaje del Mar de Cortés como alternativa de carga y personas, cuando haya proyectos en curso y no como una cifra inventada.",
                "Leer la pavimentación y el aforo como servicio a comunidades, no solo como acceso a nuevas amenidades costeras.",
            ],
            "levers_en": [
                "Hold up the La Paz (LAP) node as a measured counterweight to Los Cabos airport, using GAP figures already published.",
                "Bring Sea of Cortez ferries and cabotage in as a freight and passenger alternative where projects are underway, not as an invented figure.",
                "Read paving and traffic counts as a service to communities, not only as access to new coastal amenities.",
            ],
        },
        "vivienda": {
            "risk_es": " ".join(
                x for x in [
                    "La vivienda queda expuesta cuando crece sobre zonas sin servicios o en riesgo costero e hídrico.",
                    poblacion + "." if poblacion and not poblacion.endswith(".") else poblacion,
                    signal_line(sigs, "vivienda", "es"),
                ] if x
            ),
            "risk_en": " ".join(
                x for x in [
                    "Housing is exposed when it grows in places without services or in coastal and water risk.",
                    poblacion_en + "." if poblacion_en and not poblacion_en.endswith(".") else poblacion_en,
                    signal_line(sigs, "vivienda", "en"),
                ] if x
            ),
            "aspiration_es": (
                "Aspiración: vivienda con servicios, fuera de la primera línea de riesgo, y alineada con el margen real de agua y energía. "
                "No se publica una meta de viviendas a 2050: el portal no tiene una serie comparable que lo permita."
            ),
            "aspiration_en": (
                "Aspiration: housing with services, off the first line of risk, and aligned with the real water and energy margin. "
                "No 2050 housing-unit target is published: the portal has no comparable series that would allow it."
            ),
            "levers_es": [
                "Priorizar relocalización de lo ya expuesto antes de abrir frente residencial nuevo en costa o en acuíferos en déficit.",
                "Cruzar cada desarrollo con el tablero de demanda y oferta y con los instrumentos de ordenamiento vigentes.",
                "Tratar el rezago y la falta de servicios como un techo, no como un rezago que el mercado resolverá solo.",
            ],
            "levers_en": [
                "Prioritise relocating what is already exposed before opening a new residential front on the coast or on aquifers in deficit.",
                "Cross-check every development with the demand–supply board and with current planning instruments.",
                "Treat backlog and the lack of services as a ceiling, not as a gap the market will close on its own.",
            ],
        },
        "gobernanza": {
            "risk_es": " ".join(
                x for x in [
                    "Sin instrumentos que atén el crecimiento a los techos medidos, la trayectoria actual se impone por inercia de permisos.",
                    signal_line(sigs, "gobernanza", "es"),
                ] if x
            ),
            "risk_en": " ".join(
                x for x in [
                    "Without instruments that bind growth to measured ceilings, the current path wins by the inertia of permits.",
                    signal_line(sigs, "gobernanza", "en"),
                ] if x
            ),
            "aspiration_es": (
                "Aspiración: decisiones públicas que hagan valer POEL, PDU, PMDU, consultas y techos de ANP "
                "como condiciones previas, no como trámites posteriores al hecho. "
                "La visión es alcanzable solo si esos instrumentos se usan con la evidencia que el portal ya reúne."
            ),
            "aspiration_en": (
                "Aspiration: public decisions that make POEL, PDU, PMDU, consultations and ANP ceilings "
                "prior conditions, not paperwork after the fact. "
                "The vision is achievable only if those instruments are used with the evidence the portal already holds."
            ),
            "levers_es": [
                "Cerrar con evidencia los huecos ya marcados (DMA de Loreto y el norte, cuartos de amenidad, PDU de Cabos, MW de bombeo) antes de escenarios públicos de mayor escala.",
                "Mantener la consulta pública y la entrega de instrumentos al Congreso como palancas visibles, no como un trámite de cierre.",
                "Usar la lectura restringida del tablero estatal como criterio de permiso, no solo como un texto de análisis.",
            ],
            "levers_en": [
                "Close already marked gaps with evidence (Loreto and northern DMA, amenity rooms, Cabos PDU, pumping MW) before larger public scenarios.",
                "Keep public consultation and the delivery of instruments to Congress as visible levers, not as closing paperwork.",
                "Use the state’s constrained board reading as a permit criterion, not only as an analysis text.",
            ],
        },
    }

    out = []
    for theme in THEME_ORDER:
        t = templates[theme]
        s = sigs.get(theme) or {}
        out.append({
            "id": theme,
            "label_es": LABEL_ES[theme],
            "label_en": LABEL_EN[theme],
            "emphasis": is_stressed(s) or (s.get("count") or 0) >= 8,
            "count": s.get("count", 0),
            "ewma": s.get("ewma"),
            "direction": s.get("direction"),
            "z": s.get("z"),
            "risk_es": t["risk_es"].strip(),
            "risk_en": t["risk_en"].strip(),
            "aspiration_es": t["aspiration_es"].strip(),
            "aspiration_en": t["aspiration_en"].strip(),
            "levers_es": t["levers_es"],
            "levers_en": t["levers_en"],
        })
    return out


def lead_for(vision: dict, lang: str) -> str:
    meta = vision.get("scenario_meta") or {}
    scenarios = vision.get("scenarios") or {}
    if not scenarios:
        if lang == "es":
            return (
                "Esta columna no describe lo más probable —eso está en Tendencia 2050—. "
                "Describe el 2050 ideal y alcanzable: regenerativo, proactivo, y anclado en lo que el portal ya midió."
            )
        return (
            "This column does not describe what is most likely —that is in Trend 2050—. "
            "It describes the ideal, achievable 2050: regenerative, proactive, and anchored in what the portal has already measured."
        )
    ranked = sorted(scenarios, key=lambda h: scenarios[h].get("p") or 0, reverse=True)
    top = ranked[0]
    p = scenarios[top].get("p") or 0
    label = (meta.get(top) or {}).get("label_es" if lang == "es" else "label_en") or top
    if lang == "es":
        return (
            f"Lo más probable, según la Tendencia de hoy, es el escenario «{label}» ({p*100:.0f} %). "
            "Esta Visión no discute ese cálculo: lo toma como el riesgo a mitigar. "
            "El 2050 que se busca es el ideal alcanzable —proactivo y regenerativo— para cada motor y cada techo que esa tendencia señala. "
            "Las metas se etiquetan como aspiraciones. Las cifras son las que ya están en el portal; donde no hay serie suficiente, no se inventa un número a 2050."
        )
    return (
        f"What is most likely, according to today’s Trend, is the “{label}” scenario ({p*100:.0f}%). "
        "This Vision does not contest that calculation: it takes it as the risk to mitigate. "
        "The 2050 it aims for is the achievable ideal — proactive and regenerative — for each driver and each ceiling that trend points to. "
        "Targets are labelled as aspirations. Figures are those already on the portal; where the series is short, no 2050 number is invented."
    )


def join_natural(names: list[str], lang: str) -> str:
    """Join 1/N proper names with a natural conjunction (y / and)."""
    clean = [n.strip() for n in names if str(n or "").strip()]
    if not clean:
        return ""
    if len(clean) == 1:
        return clean[0]
    conj = " y " if lang == "es" else " and "
    if len(clean) == 2:
        return conj.join(clean)
    return ", ".join(clean[:-1]) + conj + clean[-1]


def emphasis_clause(names: list[str], lang: str) -> str:
    """Grammatical 0/1/N sentence about themes in emphasis."""
    n = len([x for x in names if str(x or "").strip()])
    joined = join_natural(names, lang)
    if lang == "es":
        if n == 0:
            return "Hoy no hay ningún motor o techo en énfasis."
        if n == 1:
            return f"El motor o techo en énfasis es {joined}."
        return f"Los motores o techos en énfasis son {joined}."
    if n == 0:
        return "No drivers or ceilings are highlighted today."
    if n == 1:
        return f"The highlighted driver or ceiling is {joined}."
    return f"The highlighted drivers or ceilings are {joined}."


def change_for(vision: dict, pillars: list[dict], lang: str) -> str:
    scenarios = vision.get("scenarios") or {}
    ranked = sorted(scenarios, key=lambda h: scenarios[h].get("p") or 0, reverse=True)
    top = ranked[0] if ranked else None
    meta = vision.get("scenario_meta") or {}
    stressed = [p for p in pillars if p.get("emphasis")]
    names = [
        (x.get("label_es") if lang == "es" else x.get("label_en")) or ""
        for x in stressed
    ]
    if lang == "es":
        label = (meta.get(top) or {}).get("label_es") if top else "—"
        return (
            f"Se ajusta a la Tendencia de hoy: el escenario más probable es «{label}». "
            + emphasis_clause(names, "es")
        )
    label = (meta.get(top) or {}).get("label_en") if top else "—"
    return (
        f"It tracks today’s Trend: the leading scenario is “{label}”. "
        + emphasis_clause(names, "en")
    )


def archive(data: dict, today: str) -> None:
    date_id = str(data.get("updated") or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_id):
        return
    EDITIONS.mkdir(parents=True, exist_ok=True)
    dest = EDITIONS / f"{date_id}.json"
    if dest.exists() and date_id != today:
        print(f"archive exists, keeping {dest}")
        return
    slim = {k: data[k] for k in data if k not in {"history"}}
    dest.write_text(json.dumps(slim, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"archived ideal {dest}")


def build(today: str) -> dict:
    vision = load_json(VISION, {}) or {}
    gds = load_json(GDS, {}) or {}
    prior = load_json(OUT, {}) or {}
    pillars = pillars_for(vision, gds)
    conditions = (gds.get("state_rollup") or {})
    lead_es = lead_for(vision, "es")
    lead_en = lead_for(vision, "en")
    change_es = change_for(vision, pillars, "es")
    change_en = change_for(vision, pillars, "en")

    history = [h for h in (prior.get("history") or []) if h.get("updated") != today]
    snapshot = {
        "updated": today,
        "change_es": change_es,
        "change_en": change_en,
        "lead_es": lead_es,
        "lead_en": lead_en,
        "pillars": pillars,
    }
    history.append(snapshot)
    history.sort(key=lambda h: h.get("updated") or "")

    state = {
        "updated": today,
        "title_es": "Visión",
        "title_en": "Vision",
        "kicker_es": "El 2050 ideal y alcanzable, para mitigar los riesgos que señala la Tendencia.",
        "kicker_en": "The ideal, achievable 2050, mitigating the risks the Trend identifies.",
        "lead_es": lead_es,
        "lead_en": lead_en,
        "change_es": change_es,
        "change_en": change_en,
        "pillars": pillars,
        "conditions_es": conditions.get("must_be_true_es") or [],
        "conditions_en": conditions.get("must_be_true_en") or [],
        "gds_balance_es": conditions.get("balance_read_es") or "",
        "gds_balance_en": conditions.get("balance_read_en") or "",
        "tendencia_updated": vision.get("updated") or "",
        "tendencia_leading": None,
        "method_note_es": (
            "Visión normativa e interna, no un plan oficial ni un pronóstico. "
            "Cada meta está etiquetada como aspiración. "
            "Las cifras se copian de la Tendencia, de las fuentes del portal y del tablero de demanda y oferta; "
            "no se inventan objetivos numéricos a 2050."
        ),
        "method_note_en": (
            "A normative, internal vision — not an official plan and not a forecast. "
            "Each target is labelled as an aspiration. "
            "Figures are copied from the Trend, from portal sources and from the demand–supply board; "
            "no numeric 2050 targets are invented."
        ),
        "history": history,
    }
    scenarios = vision.get("scenarios") or {}
    if scenarios:
        top = max(scenarios, key=lambda h: scenarios[h].get("p") or 0)
        meta = (vision.get("scenario_meta") or {}).get(top) or {}
        state["tendencia_leading"] = {
            "id": top,
            "p": scenarios[top].get("p"),
            "label_es": meta.get("label_es"),
            "label_en": meta.get("label_en"),
        }
    return state


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--date", help="Date YYYY-MM-DD (default: today)")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    today = args.date or date.today().isoformat()
    prior = load_json(OUT, {}) or {}
    if prior:
        archive(prior, today)
    state = build(today)
    raw = json.dumps(state, ensure_ascii=False, indent=2) + "\n"
    if args.dry_run:
        print(raw)
        return 0
    OUT.write_text(raw, encoding="utf-8")
    archive(state, today)
    n_emp = sum(1 for x in state["pillars"] if x.get("emphasis"))
    print(
        f"wrote {OUT} updated={state['updated']} pillars={len(state['pillars'])} "
        f"emphasis={n_emp} leading={(state.get('tendencia_leading') or {}).get('label_es')}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
