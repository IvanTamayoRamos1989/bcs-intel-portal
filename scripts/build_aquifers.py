#!/usr/bin/env python3
"""Build src/data/aquifers_bcs.json — all 39 BCS aquifers (DOF 9 Nov 2023 Acuerdo DMA 653
acuíferos, p.3 of the local PDF) + municipality only where a CONAGUA document states it.

Sources (local, in BCSFP/02_water/):
  2023-11-09_SEMARNAT_Acuerdo-DMA-653-acuiferos.pdf  (statewide table, p.3)
  2024-01-01_CONAGUA_Actualizacion-DMA-Acuifero-*.pdf (0313-0325, south pack)
  DR_0306.pdf, DR_0319.pdf, DR_0329.pdf, DR_0332.pdf  (CONAGUA DR fichas)
Never invents a municipality: if no document in the acervo states it -> null + caveat.
"""
import json, re, subprocess
from pathlib import Path

HUB = Path(__file__).resolve().parents[1]
LAKE = HUB.parent
DOF = LAKE / "02_water/2023-11-09_SEMARNAT_Acuerdo-DMA-653-acuiferos.pdf"

NAMES = {"0308": "Las Pocitas-San Hilario", "0309": "El Conejo-Los Viejos",
         "0315": "Plutarco Elías Calles", "0333": "San Marcos-Palo Verde"}

# Municipality as stated in the CONAGUA document (sentence "Geopolíticamente…"), page of DMA formula.
MUNI = {
  "0306": dict(municipios=["Comondú", "Loreto", "La Paz"], muni_text="Mayor parte en Comondú; extremos norte y oriental en Loreto; porciones sur y suroriental en La Paz", doc="DR_0306.pdf", page=35),
  "0313": dict(municipios=["La Paz"], muni_text="Totalmente dentro del municipio de La Paz", doc="2024-01-01_CONAGUA_Actualizacion-DMA-Acuifero-Todos-Santos-0313.pdf", page=28),
  "0314": dict(municipios=["La Paz", "Los Cabos"], muni_text="En su mayoría La Paz; pequeña porción montañosa al oriente en Los Cabos", doc="2024-01-01_CONAGUA_Actualizacion-DMA-Acuifero-El-Pescadero-0314.pdf", page=30),
  "0317": dict(municipios=["Los Cabos"], muni_text="En su totalidad en el municipio de Los Cabos", doc="2024-01-01_CONAGUA_Actualizacion-DMA-Acuifero-Cabo-San-Lucas-0317.pdf", page=27),
  "0318": dict(municipios=["Los Cabos"], muni_text="Parte oriental del municipio de Los Cabos", doc="2024-01-01_CONAGUA_Actualizacion-DMA-Acuifero-Cabo-Pulmo-0318.pdf", page=30),
  "0319": dict(municipios=["Los Cabos"], muni_text="Totalmente dentro del municipio de Los Cabos", doc="2024-01-01_CONAGUA_Actualizacion-DMA-Acuifero-San-Jose-del-Cabo-0319.pdf", page=31),
  "0320": dict(municipios=["Los Cabos"], muni_text="Comprende superficie del municipio de Los Cabos (Santiago, Los Barriles, La Rivera, Buena Vista…)", doc="2024-01-01_CONAGUA_Actualizacion-DMA-Acuifero-Santiago-0320.pdf", page=23),
  "0322": dict(municipios=["La Paz"], muni_text="Municipio de La Paz", doc="2024-01-01_CONAGUA_Actualizacion-DMA-Acuifero-El-Carrizal-0322.pdf", page=29),
  "0323": dict(municipios=["La Paz"], muni_text="Superficie completa en el municipio de La Paz", doc="2024-01-01_CONAGUA_Actualizacion-DMA-Acuifero-Los-Planes-0323.pdf", page=27),
  "0324": dict(municipios=["La Paz"], muni_text="Superficie completa en el municipio de La Paz", doc="2024-01-01_CONAGUA_Actualizacion-DMA-Acuifero-La-Paz-0324.pdf", page=30),
  "0325": dict(municipios=["La Paz"], muni_text="Municipio de La Paz", doc="2024-01-01_CONAGUA_Actualizacion-DMA-Acuifero-El-Coyote-0325.pdf", page=26),
  "0329": dict(municipios=["Loreto"], muni_text="La ficha DR no trae frase geopolítica; los estudios SARH de 1978 citados en ella lo ubican en el entonces municipio de Comondú (Loreto se creó en 1992). Asignación a Loreto = ubicación actual, por confirmar", doc="DR_0329.pdf", page=29, muni_caveat=True),
  "0332": dict(municipios=["Mulegé"], muni_text="Totalmente dentro del municipio de Mulegé", doc="DR_0332.pdf", page=26),
}

def num(s):
    return float(s.replace(",", ""))

def main():
    txt = subprocess.run(["pdftotext", "-layout", "-f", "3", "-l", "3", str(DOF), "-"], capture_output=True, text=True).stdout
    rows = []
    rx = re.compile(r"^[A-ZÁÉÍÓÚÑ .]*?\b(03[0-3]\d)\s+(.*?)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*$")
    for line in txt.splitlines():
        m = rx.match(line)
        if not m:
            continue
        cve, name = m.group(1), m.group(2).strip()
        R, DNC, VCAS, VEALA, VAPTYR, VAPRH, POS, NEG = (num(m.group(i)) for i in range(3, 11))
        name = NAMES.get(cve) or name.title().replace(" Del ", " del ").replace(" De ", " de ")
        dma = POS if POS > 0 else NEG
        r = dict(clave=cve, nombre=name, R=R, DNC=DNC, VCAS=VCAS, VEALA=VEALA, VAPTYR=VAPTYR, VAPRH=VAPRH,
                 dma_hm3=round(dma, 6), status="disponible" if dma > 0 else "deficit",
                 source="DOF 9 nov 2023 — Acuerdo DMA 653 acuíferos (CONAGUA/SEMARNAT)",
                 source_file="02_water/2023-11-09_SEMARNAT_Acuerdo-DMA-653-acuiferos.pdf", source_page=3)
        mu = MUNI.get(cve)
        if mu:
            r.update(municipios=mu["municipios"], municipio_texto=mu["muni_text"],
                     ficha_file="02_water/" + mu["doc"], ficha_page=mu["page"],
                     municipio_por_confirmar=bool(mu.get("muni_caveat")))
        else:
            r.update(municipios=[], municipio_texto=None, ficha_file=None, ficha_page=None,
                     municipio_por_confirmar=True)
        rows.append(r)
    seen = {r["clave"] for r in rows}
    missing = [f"03{i:02d}" for i in range(1, 40) if f"03{i:02d}" not in seen]
    assert not missing, f"unparsed aquifers: {missing}"
    rows.sort(key=lambda r: r["clave"])
    by_muni = {}
    for r in rows:
        for m in r["municipios"]:
            by_muni.setdefault(m, []).append(r["clave"])
    out = dict(
        updated="2026-10-05",
        title_es="Acuíferos de Baja California Sur — disponibilidad media anual (DMA)",
        method_es="NOM-011-CONAGUA-2015: DMA = R − DNC − VEAS (VEAS = VCAS + VEALA + VAPTYR + VAPRH). Cifras en hm³/año.",
        caveat_es=("DMA es un balance legal–administrativo de volumen concesionable, no un aforo físico. Un remanente "
                   "positivo en un acuífero no compensa el déficit de otro. Municipio asignado solo cuando una ficha "
                   "CONAGUA del acervo lo declara; el resto queda 'por verificar'. Para La Paz 0324 el Acuerdo DOF "
                   "17 ago 2023 publica −27.83 hm³ (otra programación de VAPRH); no se promedian."),
        licence="Información pública gubernamental (DOF / CONAGUA)",
        aquifers=rows, by_municipio=by_muni,
        deficit_count=sum(1 for r in rows if r["dma_hm3"] < 0),
        deficit_sum_hm3=round(sum(r["dma_hm3"] for r in rows if r["dma_hm3"] < 0), 3),
    )
    for p in (HUB / "src/data/aquifers_bcs.json", HUB / "public/aquifers_bcs.json"):
        p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(rows), "aquifers;", out["deficit_count"], "in deficit; sum", out["deficit_sum_hm3"], by_muni)

if __name__ == "__main__":
    main()


def fmt(v):
    s = f"{v:+.2f}".replace("-", "−")
    return f"**{s}**" if v < 0 else s


def write_guide(out):
    p = HUB / "src/content/guides/agua.md"
    s = p.read_text(encoding="utf-8")
    rows = out["aquifers"]
    order = ["Los Cabos", "La Paz", "Comondú", "Loreto", "Mulegé"]
    es = ['<a id="acuiferos"></a>', "", "## Todos los acuíferos de BCS y su municipio (DOF 2023)", "",
          "Baja California Sur tiene **39 acuíferos** oficiales (claves 0301–0339). El Acuerdo DOF del 9 nov 2023 "
          f"publica la DMA de todos: **{out['deficit_count']} en déficit** (suma ≈ {abs(out['deficit_sum_hm3']):.2f} hm³/año) "
          "y el resto con remanente. El municipio se indica solo cuando la ficha CONAGUA del acervo lo declara.", "",
          "### Por municipio (fichas CONAGUA en el acervo)", "",
          "| Municipio | Acuíferos (DMA hm³/año) |", "|---|---|"]
    en = ["## All BCS aquifers and their municipality (DOF 2023)", "",
          f"BCS has **39 official aquifers** (0301–0339). DOF 9 Nov 2023 publishes DMA for all: **{out['deficit_count']} in deficit** "
          f"(sum ≈ {abs(out['deficit_sum_hm3']):.2f} hm³/yr). Municipality shown only where a CONAGUA sheet in the archive states it.", "",
          "| Municipality | Aquifers (DMA hm³/yr) |", "|---|---|"]
    for m in order:
        cl = [r for r in rows if m in r["municipios"]]
        cell = "; ".join(f"{r['clave']} {r['nombre']} {fmt(r['dma_hm3'])}{' (por confirmar)' if r['municipio_por_confirmar'] else ''}" for r in cl) or "—"
        es.append(f"| {m} | {cell} |")
        en.append(f"| {m} | {cell} |")
    es += ["", "Loreto–0329: asignación por ubicación actual, por confirmar (la ficha DR 0329 cita estudios de 1978 cuando el área era parte de Comondú).",
           "Santo Domingo 0306 abarca principalmente Comondú, con extremos en Loreto y La Paz; El Pescadero 0314 toca una porción de Los Cabos.", "",
           "### Tabla estatal completa (39 acuíferos)", "",
           "| Clave | Acuífero | DMA (hm³/año) | Municipio (ficha CONAGUA) | Ficha / página |", "|---|---|---:|---|---|"]
    for r in rows:
        mu = ", ".join(r["municipios"]) + (" (por confirmar)" if r["municipio_por_confirmar"] and r["municipios"] else "") if r["municipios"] else "por verificar"
        fi = f"`{Path(r['ficha_file']).name}` p.{r['ficha_page']}" if r["ficha_file"] else "DOF 2023 p.3"
        es.append(f"| {r['clave']} | {r['nombre']} | {fmt(r['dma_hm3'])} | {mu} | {fi} |")
    es += ["", "**Ficha de fuente.** Fuente: Acuerdo DMA 653 acuíferos, DOF 9 nov 2023 (`02_water/2023-11-09_SEMARNAT_Acuerdo-DMA-653-acuiferos.pdf`, p.3) y fichas CONAGUA 2024 / DR. "
           "Método: NOM-011-CONAGUA-2015, DMA = R − DNC − VEAS. Advertencia: balance legal de volumen concesionable, no aforo físico; un remanente no compensa el déficit de otro acuífero; La Paz 0324 tiene además el Acuerdo DOF 17 ago 2023 (−27.83 hm³ con reserva VAPRH).", ""]
    en += ["", "Method: NOM-011-CONAGUA-2015 (DMA = R − DNC − VEAS). Source: DOF 9 Nov 2023 (p.3) + CONAGUA 2024/DR sheets. Caveat: legal concessionable-volume balance, not a physical gauge.", ""]
    for tag, body in (("ES", es), ("EN", en)):
        s = re.sub(rf"<!-- AQUIFERS_{tag}:START -->.*?<!-- AQUIFERS_{tag}:END -->",
                   f"<!-- AQUIFERS_{tag}:START -->\n" + "\n".join(body) + f"\n<!-- AQUIFERS_{tag}:END -->", s, flags=re.S)
    p.write_text(s, encoding="utf-8")


if __name__ == "__main__":
    write_guide(json.loads((HUB / "src/data/aquifers_bcs.json").read_text(encoding="utf-8")))
