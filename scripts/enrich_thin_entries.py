#!/usr/bin/env python3
"""Second-pass enrichment for catalogue entries that are still filename-only after enrich_file_summaries.py.

For every thin public catalogue entry (summary < 120 chars and no extract_* source):
  images      -> stills.json / stills_intelligence.json (place, municipio, vision note) or maps_gallery.json
                 (title + source); otherwise OCR of visible text + dimensions
  esp         -> Google Earth Studio project: name, frames, fps, keyframes, POI/camera coordinates, stills covered
  zip/tar.gz  -> list of contents (+ CSV header of first table inside)
  doc/pptx/xls-> LibreOffice conversion -> text / header row
  csv/tsv     -> header (delimiter sniffed); data rows never copied
  shapefile parts, gpkg, kml -> ogrinfo layer summary (geometry, features, fields, CRS); .shp.xml metadata title/abstract
  qgs/qgz/qml/lyr -> QGIS/ArcGIS project/style: layers or fields referenced
  html        -> title + visible text
  pdf         -> more pages via pdftotext; else OCR (tesseract spa) of first pages (cached in scripts/_cache/ocr)
Entries that are internal tooling (scripts, logs, copy maps, backups) are excluded from the public catalogue
(catalog_exclusions.json, reason=non_document). Entries whose content cannot be obtained (0-byte, bot-challenge
or 404 pages saved as PDF, unreadable scans) are excluded (reason=no_content) and added to the data-gap wishlist
(data_gaps.json -> wishlist). Never invents content: every summary is text/metadata present in the file.
"""
import csv, hashlib, io, json, re, subprocess, sys, tarfile, tempfile, zipfile
from collections import defaultdict
from pathlib import Path

HUB = Path(__file__).resolve().parents[1]
LAKE = HUB.parent
D = HUB / "src/data"
CACHE = HUB / "scripts/_cache/ocr"
CACHE.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(HUB / "scripts"))
from enrich_file_summaries import good_lines, tidy, ex_xlsx, ex_struct  # noqa: E402

TOOLING_EXT = {"ps1", "py", "sh", "log", "yaml", "yml", "bat"}
TOOLING_NAME = re.compile(r"(_template\.esp$|COPY_TO_DESKTOP\.md$|COPYTOBOX_MAP\.tsv|DOWNLOAD_MANIFEST\.tsv|selection_manifest\.json|DEDUP_REPORT\.json|"
                          r"PARENT_COPYTOBOX\.md|SYNC_STATUS\.md|_v6_rows\.json|\.bak_\d+$)", re.I)
ROOT_PACKS = re.compile(r"^(BCS_[^/]+\.tar\.gz|11_bcs_hub_data_guide\.tar\.gz)$")


def sh(cmd, timeout=120):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except Exception:
        return ""


def ftype(p):
    return sh(["file", "-b", str(p)], 20).strip()


# ---------- reference data ----------
stills = json.loads((D / "stills.json").read_text(encoding="utf-8"))
st_by_id = {s["id"]: s for s in stills}
st_by_src = {s.get("source_filename"): s for s in stills if s.get("source_filename")}
st_by_batch = defaultdict(list)
for s in stills:
    st_by_batch[s.get("batch")].append(s)
intel = {r["id"]: r for r in json.loads((D / "stills_intelligence.json").read_text(encoding="utf-8"))["records"]}
ESR = LAKE / "13_territorial_intelligence/earth_studio_stills"
master = {r["id"]: r for r in csv.DictReader(open(ESR / "stills_master.csv", encoding="utf-8"))}
frame_map = {}
for mf in ("stills_manifest.csv", "stills_urban_coast_manifest.csv"):
    if (ESR / mf).exists():
        for r in csv.DictReader(open(ESR / mf, encoding="utf-8")):
            frame_map[(Path(r["esp_file"]).stem, int(r["frame_index"]))] = r
uc_master = {r["id"]: r for r in csv.DictReader(open(ESR / "stills_urban_coast_master.csv", encoding="utf-8"))} if (ESR / "stills_urban_coast_master.csv").exists() else {}
by_esp = defaultdict(list)
for (esp, _), r in frame_map.items():
    by_esp[esp].append(r)
dropped = {x["dropped"]: x for x in json.loads((D / "stills_dedup_report.json").read_text(encoding="utf-8")).get("near_dupe_pairs", [])}
maps = {m["file"]: m for m in json.loads((D / "maps_gallery.json").read_text(encoding="utf-8"))}


def still_text(s):
    r = intel.get(s["id"], {})
    v = r.get("vision") or {}
    sp = r.get("spatial") or {}
    parts = [f"Fotograma Google Earth Studio {s['id']} «{s['name']}» ({s.get('municipio') or 'BCS'}), "
             f"categoría {s.get('category')}, tema {s.get('theme')}; lat {s['lat']:.4f}, lon {s['lon']:.4f}, altitud cámara {int(s.get('alt_m') or 0)} m."]
    if s.get("notes"):
        parts.append(s["notes"].replace(";", ",") + ".")
    desc = v.get("summary") or v.get("description") or v.get("caption") or ""
    if isinstance(desc, str) and desc.strip():
        parts.append("Lectura visual: " + desc.strip())
    ctx = []
    if sp.get("nearest_settlement"):
        ns = sp["nearest_settlement"]
        ctx.append(f"localidad más cercana {ns.get('name')} ({int(ns.get('distance_m') or 0)} m)")
    if sp.get("coast_distance_m") is not None:
        ctx.append(f"a {int(sp['coast_distance_m'])} m de costa")
    if sp.get("in_anp"):
        ctx.append("dentro de ANP " + ", ".join(a.get("name", "") for a in sp["in_anp"]))
    if ctx:
        parts.append("Contexto espacial: " + "; ".join(ctx) + ".")
    return tidy(" ".join(parts), 700)


def ocr_image(path, psm="3"):
    out = sh(["tesseract", str(path), "-", "-l", "spa+eng", "--psm", psm], 180)
    return out


def img_dims(p):
    try:
        from PIL import Image
        with Image.open(p) as im:
            return im.size
    except Exception:
        return None


def ex_image(rel, p):
    name = p.name
    m = re.match(r"(S\d{4})_", name)
    if m and m.group(1) in st_by_id:
        return still_text(st_by_id[m.group(1)]), "extract_still"
    if name in st_by_src:
        return still_text(st_by_src[name]), "extract_still"
    if m and m.group(1) in master:
        mr = master[m.group(1)]
        return tidy(f"Fotograma Google Earth Studio {mr['id']} «{mr['name']}», categoría {mr.get('category')}, tema {mr.get('theme')}; "
                    f"lat {float(mr['lat']):.4f}, lon {float(mr['lon']):.4f}, altitud cámara {mr.get('alt_m')} m. Origen: {mr.get('source')}. "
                    + (mr.get('notes') or '') + ".", 600), "extract_still"
    mf = re.match(r"(BCS_stills_(?:uc_)?batch_\d+)_(\d+)\.(?:jpe?g|png)$", name)
    if mf and (mf.group(1), int(mf.group(2))) in frame_map:
        r = frame_map[(mf.group(1), int(mf.group(2)))]
        mr = master.get(r["still_id"]) or uc_master.get(r["still_id"]) or {}
        t = (f"Fotograma {int(mf.group(2))} del render Google Earth Studio {mf.group(1)} = still {r['still_id']} "
             f"«{mr.get('name') or r.get('slug')}» ({r.get('category')}); lat {float(r['lat']):.4f}, lon {float(r['lon']):.4f}, altitud {r.get('alt_m')} m. "
             + (mr.get("notes", "").replace(";", ",") + ". " if mr.get("notes") else ""))
        if r["still_id"] in dropped:
            dd = dropped[r["still_id"]]
            t += f"Descartado en la deduplicación como casi duplicado de {dd['kept']} «{dd['kept_name']}» (hamming {dd['hamming']})."
        return tidy(t, 700), "extract_still"
    if name in maps:
        mp = maps[name]
        wh = img_dims(p)
        o = ocr_cached(p, kind="img")
        t = (f"Mapa «{mp.get('title_es')}» — fuente: {mp.get('source')}. Tema {mp.get('theme')} (ver {mp.get('theme_href')}). "
             + (f"Imagen {wh[0]}×{wh[1]} px. " if wh else ""))
        ol = good_lines(o, 300) if o else ""
        if ol:
            t += "Texto visible (OCR): " + ol
        return tidy(t, 700), "extract_map"
    o = ocr_cached(p, kind="img")
    ol = good_lines(o, 400) if o else ""
    if ol and len(ol) > 60:
        wh = img_dims(p)
        return tidy((f"Imagen {wh[0]}×{wh[1]} px. " if wh else "") + "Texto visible (OCR): " + ol), "extract_ocr"
    return None, None


def ex_esp(rel, p):
    try:
        d = json.loads(p.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return None, None
    st = d.get("settings") or {}
    fr, dur = st.get("frameRate") or 30, st.get("duration") or 0
    dims = st.get("dimensions") or {}
    lons, lats, kfs, pois = [], [], 0, []

    def walk(o):
        nonlocal kfs
        if isinstance(o, dict):
            t = o.get("type")
            if t in ("longitude", "latitude") and o.get("keyframes"):
                vals = [k.get("value") for k in o["keyframes"] if isinstance(k.get("value"), (int, float))]
                (lons if t == "longitude" else lats).extend(vals)
                kfs = max(kfs, len(vals))
            if t == "poi":
                vv = {a.get("type"): a.get("value") for a in o.get("attributes", [])}
                if vv.get("longitudePOI") is not None:
                    pois.append((vv.get("latitudePOI"), vv.get("longitudePOI")))
            for v in o.values():
                if isinstance(v, (dict, list)):
                    walk(v)
        elif isinstance(o, list):
            for x in o:
                walk(x)
    walk(d)
    conv = lambda v, s: v * s - s / 2 if 0 <= v <= 1 else v  # Earth Studio normalises lon/lat to 0–1
    pts = [(conv(la, 180), conv(lo, 360)) for la, lo in zip(lats, lons)]
    name = st.get("name") or p.stem
    t = (f"Proyecto Google Earth Studio «{name}»: {dur} fotogramas a {fr} fps (≈{dur / fr:.0f} s), "
         f"{dims.get('width')}×{dims.get('height')} px, {kfs} keyframes de cámara.")
    pts = [x for x in pts if 21 <= x[0] <= 30 and -117 <= x[1] <= -108]  # keep only plausible BCS coordinates
    if pts:
        la = [x[0] for x in pts]; lo = [x[1] for x in pts]
        t += f" Recorrido de cámara entre lat {min(la):.3f}–{max(la):.3f} y lon {min(lo):.3f}–{max(lo):.3f}."
    mb = re.search(r"batch_(\d+)", name)
    if by_esp.get(name):
        rr = sorted(by_esp[name], key=lambda r: int(r["frame_index"]))
        nm = lambda r: (master.get(r["still_id"]) or uc_master.get(r["still_id"]) or {}).get("name") or r.get("slug")
        cats = sorted({r.get("category") or "" for r in rr} - {""})
        t += (f" Genera {len(rr)} stills {rr[0]['still_id']}–{rr[-1]['still_id']} (categorías {', '.join(cats)}): "
              + ", ".join(nm(r) for r in rr[:10]) + "…")
    elif mb and st_by_batch.get(f"batch_{mb.group(1)}"):
        ss = st_by_batch[f"batch_{mb.group(1)}"]
        munis = sorted({s.get("municipio") or "" for s in ss} - {""})
        t += f" Genera los stills {ss[0]['id']}–{ss[-1]['id']} ({len(ss)} vistas; municipios {', '.join(munis)}): " + ", ".join(s["name"] for s in ss[:10]) + "…"
    else:
        human = re.sub(r"^\d+_", "", name).replace("_to_", " → ").replace("_", " ")
        t += f" Tramo: {human}."
    return tidy(t, 700), "extract_esp"


PERSONAL = re.compile(r"padron|padrón|nomina|nómina|beneficiari|curp|rfc|empleado", re.I)


def _decode(b):
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        best = max(("cp1252", "cp850"), key=lambda enc: len(re.findall(r"[áéíóúñÁÉÍÓÚÑ]", b.decode(enc, errors="replace"))))
        return b.decode(best, errors="replace")


def table_header(fileobj, name):
    try:
        raw = _decode(fileobj.read(65536))
    except Exception:
        return ""
    lines = raw.splitlines()
    if not lines:
        return ""
    try:
        dialect = csv.Sniffer().sniff(lines[0] if len(lines) == 1 else "\n".join(lines[:5]), delimiters=",;\t|")
        delim = dialect.delimiter
    except Exception:
        delim = "\t" if name.lower().endswith(".tsv") else ","
    rows = list(csv.reader(lines[:40], delimiter=delim))
    head = ", ".join(h.strip().lstrip("\ufeff") for h in rows[0][:16] if h.strip())
    if len(head) < 60 and len(rows) > 1:
        if PERSONAL.search(name) and not re.search(r"diccionario", name, re.I):
            # transparency (SIPOT) formats: the row after "TÍTULO" holds the format title, never personal data
            for i, r in enumerate(rows[:6]):
                if r and re.search(r"T.TULO", r[0], re.I) and i + 1 < len(rows):
                    meta = [c.strip() for c in rows[i + 1] if c.strip()][:3]
                    head = (head + ". " if head else "") + "Formato de transparencia: " + " · ".join(x[:160] for x in meta) + " (datos personales no se copian)"
                    break
        else:
            best, bestn = 0, -1
            for ci in range(min(3, max(len(r) for r in rows))):
                col = [r[ci].strip() for r in rows[1:] if len(r) > ci and r[ci].strip()]
                txt = sum(1 for v in col if not re.fullmatch(r"[\d.,\s-]+", v))
                if txt > bestn:
                    best, bestn = ci, txt
            vals = [r[best].strip() for r in rows[1:] if len(r) > best and r[best].strip()][:14]
            if vals:
                head = (head + ". " if head else "") + f"Primeros valores de la columna {best + 1}: " + ", ".join(v[:40] for v in vals)
    return head


def ex_table(rel, p):
    with open(p, "rb") as f:
        head = table_header(f, p.name)
    try:
        n = sum(1 for _ in open(p, "rb")) - 1
    except Exception:
        n = 0
    if not head:
        return None, None
    return tidy(f"Tabla {p.suffix.lstrip('.').upper()}, {max(n, 0)} filas. Columnas: {head}.", 600), "extract_table"


def ex_zip(rel, p):
    try:
        z = zipfile.ZipFile(p)
    except Exception:
        return None, None
    names = [i for i in z.infolist() if not i.is_dir()]
    if not names:
        return None, None
    exts = defaultdict(int)
    for i in names:
        exts[Path(i.filename).suffix.lower().lstrip(".") or "sin ext"] += 1
    t = (f"Archivo ZIP con {len(names)} ficheros ({', '.join(f'{v} {k}' for k, v in sorted(exts.items(), key=lambda x: -x[1])[:6])}). "
         f"Contenido: " + ", ".join(Path(i.filename).name for i in names[:14]) + ("…" if len(names) > 14 else "") + ".")
    for i in names:
        if i.filename.lower().endswith((".csv", ".tsv", ".txt")) and i.file_size > 0:
            with z.open(i) as f:
                h = table_header(f, i.filename)
            if h:
                t += f" Primera tabla ({Path(i.filename).name}) columnas: {h}."
            break
    return tidy(t, 700), "extract_zip"


def ex_tar(rel, p):
    try:
        with tarfile.open(p, "r:*") as tf:
            mem = [m for m in tf.getmembers() if m.isfile()]
    except Exception:
        return None, None
    if not mem:
        return None, None
    exts = defaultdict(int)
    for m in mem:
        exts[Path(m.name).suffix.lower().lstrip(".") or "sin ext"] += 1
    t = (f"Paquete TAR.GZ con {len(mem)} ficheros ({', '.join(f'{v} {k}' for k, v in sorted(exts.items(), key=lambda x: -x[1])[:6])}). "
         "Contenido: " + ", ".join(Path(m.name).name for m in mem[:14]) + ("…" if len(mem) > 14 else "") + ".")
    return tidy(t, 700), "extract_zip"


def lo_convert(p, fmt):
    with tempfile.TemporaryDirectory() as td:
        sh(["soffice", "--headless", "--convert-to", fmt, "--outdir", td, str(p)], 240)
        outs = list(Path(td).iterdir())
        if not outs:
            return None
        return outs[0].read_bytes()


def ex_office(rel, p):
    e = p.suffix.lower()
    if e in (".doc", ".docx"):
        b = lo_convert(p, "txt:Text")
        if b:
            t = good_lines(b.decode("utf-8", errors="replace"), 600)
            return (t, "extract_doc") if t else (None, None)
    if e in (".pptx", ".ppt"):
        b = lo_convert(p, "pdf")
        if b:
            with tempfile.NamedTemporaryFile(suffix=".pdf") as tf:
                tf.write(b); tf.flush()
                t = good_lines(sh(["pdftotext", "-l", "6", "-q", tf.name, "-"]), 600)
            return (f"Presentación: {t}", "extract_doc") if t else (None, None)
    if e == ".xls":
        b = lo_convert(p, "xlsx")
        if b:
            with tempfile.NamedTemporaryFile(suffix=".xlsx") as tf:
                tf.write(b); tf.flush()
                t = ex_xlsx(Path(tf.name))
            return (t, "extract_table") if t else (None, None)
    if e == ".xlsx":
        ft = ftype(p)
        if "HTML" in ft:
            r = ex_html(rel, p)
            if r[1] and r[1].startswith("no_content"):
                return r
            title = re.findall(r"<title[^>]*>(.*?)</title>", p.read_text(encoding="utf-8", errors="replace"), re.S | re.I)
            if title and "Challenge" in title[0]:
                return None, "no_content:página de verificación anti-bot guardada en lugar de la hoja de cálculo"
            return None, "no_content:página HTML guardada con extensión .xlsx"
        if "Composite Document" in ft:
            b = lo_convert(p, "xlsx")
            if b:
                with tempfile.NamedTemporaryFile(suffix=".xlsx") as tf:
                    tf.write(b); tf.flush()
                    t = ex_xlsx(Path(tf.name))
                return (t, "extract_table") if t else (None, None)
        t = ex_xlsx(p)
        return (t, "extract_table") if t else (None, None)
    return None, None


_ogr = {}


def ogr_summary(p):
    key = str(p)
    if key in _ogr:
        return _ogr[key]
    out = sh(["ogrinfo", "-so", "-al", "-ro", str(p)], 120)
    layers = re.findall(r"^Layer name: (.+)$", out, re.M)
    geoms = re.findall(r"^Geometry: (.+)$", out, re.M)
    feats = re.findall(r"^Feature Count: (\d+)$", out, re.M)
    crs = re.findall(r'^(?:PROJCRS|GEOGCRS|PROJCS|GEOGCS)\["([^"]+)"', out, re.M)
    fields = []
    for ln in out.splitlines():
        m = re.match(r"^([A-Za-z_][\w ]{0,30}): (String|Integer|Integer64|Real|Date|DateTime)\b", ln)
        if m and m.group(1) not in ("Geometry Column", "FID Column"):
            fields.append(m.group(1))
    if not layers:
        _ogr[key] = None
        return None
    t = (f"{len(layers)} capa(s): " + "; ".join(f"{l} ({g}, {f} elementos)" for l, g, f in list(zip(layers, geoms or [''] * len(layers), feats))[:8])
         + (f". SRC: {crs[0]}" if crs else "") + (f". Campos: {', '.join(dict.fromkeys(fields))[:300]}" if fields else "") + ".")
    _ogr[key] = t
    return t


SIDE_ROLE = {"shx": "índice de geometrías", "dbf": "tabla de atributos", "prj": "proyección", "cpg": "codificación",
             "sbn": "índice espacial", "sbx": "índice espacial", "lyr": "estilo ArcGIS (.lyr)", "shp": "geometrías"}


def ex_gis(rel, p):
    e = p.suffix.lower().lstrip(".")
    if p.name.lower().endswith(".shp.xml"):
        t = p.read_text(encoding="utf-8", errors="replace")
        title = re.findall(r"<(?:title|resTitle)>(.*?)</(?:title|resTitle)>", t, re.S)
        abst = re.findall(r"<(?:abstract|idAbs|purpose|idPurp)>(.*?)</(?:abstract|idAbs|purpose|idPurp)>", t, re.S)
        clean = lambda s: re.sub(r"<[^>]+>|&lt;.*?&gt;", " ", s)
        body = " ".join(clean(x) for x in (title[:1] + abst[:2]))
        shp = p.with_name(p.name[:-4])
        o = ogr_summary(shp) if shp.exists() else None
        txt = good_lines(body, 400) if body.strip() else ""
        if txt or o:
            return tidy(f"Metadatos del shapefile {shp.name}: {txt} {('Capa: ' + o) if o else ''}", 700), "extract_gis"
        return None, None
    if e in ("gpkg", "kml", "geojson"):
        o = ogr_summary(p)
        return (tidy(f"{'GeoPackage' if e == 'gpkg' else e.upper()} con {o}", 700), "extract_gis") if o else (None, None)
    stem = p.with_suffix("")
    shp = None
    for cand in (stem.with_suffix(".shp"), stem.with_suffix(".SHP")):
        if cand.exists():
            shp = cand
    if shp is None:
        return None, None
    o = ogr_summary(shp)
    if not o:
        return None, None
    role = SIDE_ROLE.get(e, e)
    return tidy(f"Componente {e.upper()} ({role}) del shapefile {shp.name}. {o}", 700), "extract_gis"


def ex_qgis(rel, p):
    e = p.suffix.lower()
    try:
        if e == ".qgz":
            z = zipfile.ZipFile(p)
            n = [x for x in z.namelist() if x.endswith(".qgs")]
            t = z.read(n[0]).decode("utf-8", errors="replace") if n else ""
        else:
            t = p.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None, None
    if e in (".qgs", ".qgz"):
        names = list(dict.fromkeys(re.findall(r"<layername>(.*?)</layername>", t)))
        title = re.findall(r"<title>(.*?)</title>", t)
        if not names:
            return None, None
        return tidy(f"Proyecto QGIS{(' «' + title[0] + '»') if title and title[0] else ''} con {len(names)} capas: {', '.join(names[:20])}.", 700), "extract_gis"
    if e == ".qml":
        fields = list(dict.fromkeys(re.findall(r'(?:attr|field|name)="([A-Za-z_]\w*)"', t)))[:12]
        rtype = re.findall(r'renderer-v2[^>]*type="(\w+)"', t)
        return tidy(f"Estilo QGIS (.qml) para la capa {p.stem}: renderizador {rtype[0] if rtype else 'n/d'}; campos referidos: {', '.join(fields)}.", 500), "extract_gis"
    return None, None


def ex_html(rel, p):
    t = p.read_text(encoding="utf-8", errors="replace")
    title = re.findall(r"<title[^>]*>(.*?)</title>", t, re.S | re.I)
    if title and re.search(r"no se encontr|not found|404|challenge|captcha|access denied", title[0], re.I):
        return None, "no_content:" + re.sub(r"\s+", " ", title[0]).strip()[:120]
    if "drive.google.com" in t[:5000] or "Google Drive" in (title[0] if title else ""):
        names = list(dict.fromkeys(x for x in re.findall(r'data-tooltip="([^"]{4,160})"', t) if not re.match(r"(Modified|Owned|Shared|Download|More|Sort|Show)", x)))
        return tidy(f"Listado de carpeta Google Drive «{re.sub(' - Google Drive', '', title[0]).strip() if title else ''}»: " + ", ".join(names[:20]), 700), "extract_text"
    body = re.sub(r"(?is)<(script|style|nav|header|footer).*?</\1>", " ", t)
    body = re.sub(r"(?s)<[^>]+>", "\n", body)
    import html as H
    txt = good_lines(H.unescape(body), 600)
    if not txt:
        return None, None
    return tidy(f"Página web guardada «{H.unescape(title[0]).strip() if title else p.stem}»: {txt}", 700), "extract_text"


def ocr_cached(p, kind="pdf", pages=2):
    h = hashlib.sha1(f"{p.stat().st_size}:{p.name}:{kind}:{pages}".encode()).hexdigest()
    cf = CACHE / f"{h}.txt"
    if cf.exists():
        return cf.read_text(encoding="utf-8")
    txt = ""
    if kind == "img":
        txt = ocr_image(p)
    else:
        with tempfile.TemporaryDirectory() as td:
            sh(["pdftoppm", "-r", "150", "-scale-to", "3200", "-f", "1", "-l", str(pages), "-png", str(p), f"{td}/pg"], 300)
            for img in sorted(Path(td).glob("pg*.png")):
                txt += ocr_image(img, "3") + "\n"
    cf.write_text(txt, encoding="utf-8")
    return txt


def ex_pdf(rel, p):
    ft = ftype(p)
    if "PDF" not in ft:
        if "HTML" in ft:
            r = ex_html(rel, p)
            return r if r[0] else (None, r[1] or "no_content:página HTML guardada como PDF")
        if "JSON" in ft:
            t = ex_struct(p.with_suffix(".json")) if False else None
            try:
                d = json.loads(p.read_text(encoding="utf-8", errors="replace"))
                if isinstance(d, dict) and ("error" in d or "stackTrace" in d):
                    return None, "no_content:la descarga devolvió un error JSON del servidor, no el documento"
                t = tidy(f"Respuesta JSON (no es PDF) con claves: {', '.join(list(d.keys())[:20]) if isinstance(d, dict) else 'lista'}")
            except Exception:
                t = None
            return (t, "extract_struct") if t else (None, "no_content:fichero JSON con extensión .pdf")
        return None, f"no_content:no es un PDF válido ({ft[:60]})"
    info = sh(["pdfinfo", str(p)], 30)
    pages = int((re.findall(r"^Pages:\s+(\d+)", info, re.M) or ["0"])[0])
    title = (re.findall(r"^Title:\s+(.+)$", info, re.M) or [""])[0].strip()
    if "Challenge Validation" in title:
        return None, "no_content:página de verificación anti-bot guardada en lugar del documento"
    txt = good_lines(sh(["pdftotext", "-l", "20", "-q", str(p), "-"], 120), 600)
    if txt and len(txt) >= 120:
        return tidy(f"PDF de {pages} p. {txt}", 700), "extract_pdf"
    o = ocr_cached(p, "pdf", 2)
    ot = good_lines(o, 600)
    if ot and len(ot) >= 80:
        return tidy(f"PDF escaneado de {pages} p.; texto OCR de las primeras páginas (puede contener errores): {ot}", 700), "extract_ocr"
    return None, f"no_content:PDF escaneado/plano sin texto legible ({pages} p.)"


EX = {}
for e in ("jpg", "jpeg", "png", "webp"): EX[e] = ex_image
EX["esp"] = ex_esp
for e in ("csv", "tsv"): EX[e] = ex_table
EX["zip"] = ex_zip
EX["gz"] = ex_tar
for e in ("doc", "docx", "pptx", "ppt", "xls", "xlsx"): EX[e] = ex_office
for e in ("shp", "shx", "dbf", "prj", "cpg", "sbn", "sbx", "lyr", "gpkg", "kml", "geojson"): EX[e] = ex_gis
EX["xml"] = lambda r, p: ex_gis(r, p) if p.name.lower().endswith(".shp.xml") else (None, None)
for e in ("qgs", "qgz", "qml"): EX[e] = ex_qgis
EX["html"] = ex_html
EX["pdf"] = ex_pdf
def ex_json(rel, p):
    try:
        d = json.loads(p.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return None, None
    if isinstance(d, dict):
        parts = [f"JSON con claves: {', '.join(list(d.keys())[:15])}."]
        for k, v in d.items():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                keys = list(v[0].keys())[:8]
                lab = [str(x.get("name") or x.get("municipality") or x.get("title") or x.get("id") or "") for x in v[:10]]
                parts.append(f"«{k}»: {len(v)} registros (campos {', '.join(keys)})" + (f": {', '.join(l for l in lab if l)}" if any(lab) else "") + ".")
            elif isinstance(v, (str, int, float)) and len(str(v)) < 80:
                parts.append(f"{k}: {v}.")
        t = tidy(" ".join(parts), 600)
        return (t, "extract_struct") if len(t) >= 60 else (None, None)
    t = ex_struct(p)
    return (t, "extract_struct") if t else (None, None)


EX["json"] = ex_json


def is_thin(r, sums):
    cur = sums.get(r["p"]) or {}
    s = cur.get("sum_es") or r.get("sum_es") or ""
    src = str(cur.get("source", ""))
    return (len(s) < 120 or src == "heuristic") and not src.startswith("extract") and src != "visual_review"


# Summaries written from a visual review of the rendered page (scanned plans with no OCR-able text).
MANUAL = {
    "2012_Ayuntamiento-La-Paz_PSDU-Todos-Santos-Zonificacion-Normatividad.pdf":
        "Plano E-5 «Estrategia: estrategia territorial / normatividad» del Programa Subregional de Desarrollo Urbano de "
        "Todos Santos–El Pescadero–Las Playitas (La Paz). Lámina escaneada de 1 página; la carátula dice 2007 y escala 1:60,000. "
        "A la izquierda, el mapa de zonificación secundaria del corredor costero con claves de zona y leyenda (aprovechamiento, "
        "equipamiento, conservación, protección y vialidad). A la derecha, la tabla de compatibilidad de usos del suelo por zona "
        "(permitido / condicionado / prohibido). Resumen hecho por revisión visual: la lámina no tiene texto extraíble y la "
        "letra pequeña no se puede leer a esta resolución.",
}

# Broken downloads whose content is present in the lake under another file: removed from the catalogue, not wishlisted.
SUPERSEDED = {
    "2026_DataMexico_BCS.pdf": "10_data_lake/03_Stakeholders_Forum/01_Economic_Sectors/2026_DataMexico_profile_Baja-California-Sur-bs_text_extract.txt",
}


def main():
    sums = json.loads((D / "file_summaries.json").read_text(encoding="utf-8"))
    slim = json.loads((D / "catalog_slim.json").read_text(encoding="utf-8"))
    # Keep earlier exclusions: rows already removed from catalog_slim by apply_catalog_enrichment.py are not re-scanned.
    _ef = D / "catalog_exclusions.json"
    _prev = json.loads(_ef.read_text(encoding="utf-8")).get("paths", {}) if _ef.exists() else {}
    _in_slim = {r["p"] for r in slim}
    excl = {k: v for k, v in _prev.items() if k not in _in_slim}
    stats = defaultdict(int)
    memo = {}
    for i, r in enumerate(slim):
        p, e = r["p"], (r.get("e") or "").lower()
        fp = LAKE / p
        name = Path(p).name
        if e in TOOLING_EXT or TOOLING_NAME.search(name) or ROOT_PACKS.match(p) or e.startswith("bak_"):
            excl[p] = {"reason": "non_document", "detail": "herramienta interna / registro / copia de respaldo (no es documento fuente)"}
            continue
        if name in SUPERSEDED and (LAKE / SUPERSEDED[name]).is_file():
            excl[p] = {"reason": "superseded", "detail": f"descarga fallida; el contenido está en {SUPERSEDED[name]}"}
            continue
        if name in MANUAL:
            sums[p] = {"sum_es": MANUAL[name], "sum_en": "", "source": "visual_review"}
            stats["enriched"] += 1; stats["by:manual"] += 1
            continue
        if not is_thin(r, sums):
            continue
        if not fp.is_file():
            excl[p] = {"reason": "no_content", "detail": "el archivo no existe en el data lake"}
            continue
        if fp.stat().st_size == 0:
            excl[p] = {"reason": "no_content", "detail": "descarga fallida (0 bytes)"}
            continue
        if e == "bin":
            ft = ftype(fp)
            if "PNG" in ft or "JPEG" in ft:
                o = ocr_cached(fp, kind="img")
                ol = good_lines(o, 400)
                wh = img_dims(fp)
                if ol and len(ol) > 60:
                    sums[p] = {"sum_es": tidy(f"{name}: imagen {('%d×%d px' % wh) if wh else ''} (no documento) — texto visible (OCR): {ol}"), "sum_en": "", "source": "extract_ocr"}
                    stats["enriched"] += 1; stats["by:bin"] += 1
                    continue
            excl[p] = {"reason": "no_content", "detail": f"binario sin documento utilizable ({ft[:60]})"}
            continue
        fn = EX.get(e)
        if not fn:
            stats[f"unhandled:{e}"] += 1
            continue
        key = (name, fp.stat().st_size)
        if key in memo:
            txt, src = memo[key]
        else:
            try:
                txt, src = fn(p, fp)
            except Exception as ex:  # keep going; report
                txt, src = None, None
                print("ERR", p, ex, file=sys.stderr)
            memo[key] = (txt, src)
        if txt and len(txt) >= 60:
            title = re.sub(r"[_\-]+", " ", Path(p).stem)
            sums[p] = {"sum_es": f"{title}: {txt}", "sum_en": "", "source": src}
            stats["enriched"] += 1; stats[f"by:{e}"] += 1
        elif src and src.startswith("no_content:"):
            excl[p] = {"reason": "no_content", "detail": src.split(":", 1)[1]}
        else:
            stats[f"fail:{e}"] += 1
            excl[p] = {"reason": "no_content", "detail": "no se pudo extraer texto ni metadatos útiles"}
        if (i + 1) % 250 == 0:
            print(i + 1, dict(stats), file=sys.stderr, flush=True)
    (D / "file_summaries.json").write_text(json.dumps(sums, ensure_ascii=False, indent=1), encoding="utf-8")
    (HUB / "public/file_summaries.json").write_text(json.dumps(sums, ensure_ascii=False, indent=1), encoding="utf-8")
    (D / "catalog_exclusions.json").write_text(json.dumps({"note": "Entradas retiradas del catálogo público por enrich_thin_entries.py. non_document = herramienta interna; no_content = contenido no obtenible (ver wishlist en data_gaps.json).", "paths": excl}, ensure_ascii=False, indent=1), encoding="utf-8")
    stats["excluded_non_document"] = sum(1 for v in excl.values() if v["reason"] == "non_document")
    stats["excluded_superseded"] = sum(1 for v in excl.values() if v["reason"] == "superseded")
    stats["excluded_no_content"] = sum(1 for v in excl.values() if v["reason"] == "no_content")
    print(json.dumps(dict(stats), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
