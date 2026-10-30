#!/usr/bin/env python3
"""Build data_gaps.json -> wishlist from catalog_exclusions.json (reason=no_content).
One wishlist item per distinct document (mirror copies grouped). Curated metadata for known cases;
generic fallback derives the issuing body from the file name. No invented content: titles describe what the
file name / context says; unknown content is stated as unknown."""
import json, re
from collections import OrderedDict
from datetime import date
from pathlib import Path

HUB = Path(__file__).resolve().parents[1]
D = HUB / "src/data"

CURATED = [
    (r"(anx_)?(12CIMwJksG0DbEo8gVo_InISloqYzZrvU|1Np48DZTyIh51O6cHqpEuMv_IdhLCs-nM)\.bin$", dict(
        key="ppdu-los-planes-anexos",
        title="PPDU Los Planes – Ensenada de Muertos – El Sargento: Anexo Documental y Anexo Cartográfico",
        presumed_source="IMPLAN La Paz. Carpetas compartidas de Google Drive «Anexo Documental» (12CIMwJ…) y «Anexo Cartográfico» (1Np48D…), modificadas el 18 feb 2025, según el listado guardado de la carpeta del PPDU",
        why_it_matters="Son los anexos técnicos y cartográficos del Programa Parcial de Desarrollo Urbano del corredor costero oriente de La Paz. El documento principal está en el acervo, pero sin los planos de zonificación y la memoria técnica no se puede verificar usos de suelo ni densidades.",
        where_to_request="IMPLAN La Paz: pedir acceso de lectura a las dos carpetas compartidas de Drive, o solicitarlo por la Plataforma Nacional de Transparencia (sujeto obligado: H. Ayuntamiento de La Paz / IMPLAN).",
        url="https://drive.google.com/drive/folders/12CIMwJksG0DbEo8gVo_InISloqYzZrvU")),
    (r"setues_\d+\.pdf$", dict(
        key="setues-biblioteca-digital",
        title="Documentos de la Biblioteca Digital de la SETUES BCS (IDs 318–330, 400 y 428): contenido aún no identificado",
        presumed_source="Secretaría de Turismo y Economía de BCS (SETUES), Biblioteca Digital. Al descargarlos, el portal devolvió «No se encontró la página»",
        why_it_matters="Se buscaron como instrumentos de planeación y estadística de turismo y economía estatal. Hoy no hay ningún contenido verificable; hacen falta para completar la serie turística oficial del estado.",
        where_to_request="SETUES BCS, Biblioteca Digital (setues.bcs.gob.mx). Si los enlaces siguen rotos, pedirlos a la Unidad de Transparencia de la SETUES por la PNT, indicando los IDs.")),
    (r"Estenografica-Hospital-Santa-Rosalia", dict(
        key="estenografica-hospital-santa-rosalia",
        title="Versión estenográfica, Presidencia de la República, 25 oct 2024: Hospital de Santa Rosalía",
        presumed_source="Presidencia de la República (gob.mx/presidencia, versiones estenográficas). Se guardó una página de verificación anti-bot en lugar del texto",
        why_it_matters="Es la fuente primaria de los anuncios federales sobre el hospital de Santa Rosalía (Mulegé) registrados en el inventario de proyectos federales.",
        where_to_request="gob.mx/presidencia → Prensa → Versiones estenográficas, 25 oct 2024 (descarga manual desde un navegador)."),),
    (r"2026_DataMexico_BCS\.pdf$", dict(
        key="datamexico-bcs",
        title="Perfil económico de Baja California Sur en Data México",
        presumed_source="Data México (Secretaría de Economía). La descarga devolvió un error JSON del servidor",
        why_it_matters="Perfil oficial con empleo, comercio exterior, unidades económicas e inversión por entidad. Sirve para contrastar las cifras económicas del portal.",
        where_to_request="https://www.economia.gob.mx/datamexico/es/profile/geo/baja-california-sur (exportar a PDF o CSV desde el navegador).",
        url="https://www.economia.gob.mx/datamexico/es/profile/geo/baja-california-sur")),
    (r"AFAC_Estadistica-Operativa-Aeropuertos", dict(
        key="afac-estadistica-aeropuertos",
        title="AFAC, Estadística operativa de aeropuertos 2006–2026 (hoja de cálculo)",
        presumed_source="Agencia Federal de Aviación Civil (AFAC). Se guardó una página de verificación anti-bot en lugar del archivo .xlsx",
        why_it_matters="Es la serie oficial de pasajeros y operaciones de los aeropuertos de SJD, La Paz y Loreto. Se usa en la lectura de conectividad y demanda turística.",
        where_to_request="gob.mx/afac → Estadísticas → Estadística operativa de aeropuertos (descarga manual), o solicitud a la AFAC por la PNT.")),
]

AGENCY = [
    (r"DOF", "Diario Oficial de la Federación", "dof.gob.mx (búsqueda por fecha) o Biblioteca del DOF"),
    (r"SEMARNAT|CONANP", "SEMARNAT / CONANP", "dof.gob.mx por fecha de decreto, o simec.conanp.gob.mx"),
    (r"Ayuntamiento-Los-Cabos|Tesoreria-Los-Cabos", "H. Ayuntamiento de Los Cabos", "Portal de transparencia de Los Cabos o solicitud por la PNT"),
    (r"Ayuntamiento-La-Paz|IMPLAN-La-Paz", "H. Ayuntamiento de La Paz / IMPLAN La Paz", "IMPLAN La Paz o solicitud por la PNT"),
    (r"IMPLAN-Los-Cabos|LosCabos_POEL", "IMPLAN Los Cabos", "implanloscabos.mx o solicitud por la PNT"),
    (r"BOGE", "Boletín Oficial del Gobierno del Estado de BCS", "Secretaría General de Gobierno BCS, archivo del Boletín Oficial (consulta física o digital)"),
    (r"datosbcs", "Gobierno de BCS, portal de datos abiertos (datos.bcs.gob.mx)", "datos.bcs.gob.mx o la Unidad de Transparencia de la dependencia emisora"),
    (r"CONAGUA", "CONAGUA", "sigagis.conagua.gob.mx o la Unidad de Transparencia de CONAGUA"),
]


def generic(path, detail):
    name = Path(path).name
    stem = re.sub(r"[_\-]+", " ", Path(name).stem)
    src, where = "Emisor no identificado en el nombre del archivo", "Identificar al emisor y solicitarlo por la Plataforma Nacional de Transparencia"
    for rx, a, w in AGENCY:
        if re.search(rx, name, re.I):
            src, where = a, w
            break
    return dict(key="doc-" + re.sub(r"[^a-z0-9]+", "-", name.lower())[:60], title=stem,
                presumed_source=src,
                why_it_matters=f"El archivo existe en el acervo, pero sin texto legible ({detail}), así que no puede citarse ni consultarse en el chat. Hace falta una copia digital legible o una versión con texto.",
                where_to_request=where)


def main():
    ex = json.loads((D / "catalog_exclusions.json").read_text(encoding="utf-8"))["paths"]
    items = OrderedDict()
    for path, v in sorted(ex.items()):
        if v["reason"] != "no_content":
            continue
        meta = None
        for rx, m in CURATED:
            if re.search(rx, path):
                meta = dict(m)
                break
        if meta is None:
            meta = generic(path, v["detail"])
        k = meta.pop("key")
        it = items.setdefault(k, dict(id="wish-" + k, **meta, reason=v["detail"], removed_paths=[], status="por obtener",
                                      added=str(date.today())))
        it["removed_paths"].append(path)
    for p in (D / "data_gaps.json", HUB / "public/data_gaps.json"):
        if not p.exists():
            continue
        d = json.loads(p.read_text(encoding="utf-8"))
        d["wishlist"] = list(items.values())
        d["wishlist_note_es"] = ("Documentos retirados del catálogo público porque el archivo o su contenido no se pudo obtener. "
                                 "Generado por scripts/build_wishlist.py a partir de catalog_exclusions.json.")
        p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"wishlist_items": len(items), "removed_entries": sum(len(i["removed_paths"]) for i in items.values())}))


if __name__ == "__main__":
    main()
