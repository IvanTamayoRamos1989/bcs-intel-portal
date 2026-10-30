#!/usr/bin/env python3
"""BCS2050 Library ingest -> src/data/library.json (catalog for /biblioteca)
and src/data/library_chunks.json (page-cited extracts appended to chat corpus).

Inputs: ../13_library (MASTER.csv, FILES/**.pdf, _text/*.txt from pdftotext).
Content validation: a PDF is indexed only if its text matches its catalog title
(many pipeline downloads are wrong files / landing pages / identical copies).
"""
import csv, glob, hashlib, json, os, re, sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT.parent / "13_library"
TXT = LIB / "_text"
OUT_CAT = ROOT / "src/data/library.json"
OUT_CHUNKS = ROOT / "src/data/library_chunks.json"
REPORT = LIB / "INGEST_REPORT.json"

TOPICS = {
 "01_REGIONAL_PLANNING": ("Planeación regional y ordenamiento territorial", "Regional planning", "ordenamiento territorial regional planeacion region policentrica rural urbano territorial planning"),
 "02_URBAN_PLANNING_DESIGN": ("Planeación y diseño urbano", "Urban planning & design", "planeacion urbana diseno urbano zonificacion densidad espacio publico informalidad urban design zoning density public space"),
 "03_TRANSIT_ORIENTED_DEVELOPMENT": ("Desarrollo orientado al transporte (DOT)", "Transit-oriented development", "dot tod transporte publico brt movilidad caminabilidad estacionamiento transit mobility walkability parking"),
 "04_URBAN_REGIONAL_ECONOMICS": ("Economía urbana y regional", "Urban & regional economics", "economia urbana aglomeracion suelo vivienda captura plusvalias finanzas municipales land value housing economy"),
 "05_INFRASTRUCTURE_DEVELOPMENT": ("Desarrollo de infraestructura", "Infrastructure development", "infraestructura transporte energia renovables puertos aeropuertos digital infrastructure energy renewables ports"),
 "06_PPP_INFRASTRUCTURE_FINANCE": ("APP y financiamiento de infraestructura", "PPP & infrastructure finance", "app asociacion publico privada ppp financiamiento riesgos value for money blended finance infraestructura finance"),
 "07_COASTAL_DEVELOPMENT": ("Desarrollo costero y turismo", "Coastal development", "costa costero turismo capacidad de carga manejo integrado zona costera nivel del mar huracanes manglar coastal tourism carrying capacity iczm"),
 "08_WATER_STRESSED_REGIONS": ("Regiones con estrés hídrico", "Water-stressed regions", "agua escasez desalacion desalinizacion reuso acuifero sequia tarifas gestion integrada water scarcity desalination reuse aquifer drought"),
 "09_CLIMATE_RESILIENCE_SUSTAINABILITY": ("Resiliencia climática y sostenibilidad", "Climate resilience & sustainability", "clima cambio climatico adaptacion resiliencia soluciones basadas en la naturaleza infraestructura verde climate adaptation resilience nature-based"),
 "10_GOVERNANCE_IMPLEMENTATION": ("Gobernanza e implementación", "Governance & implementation", "gobernanza metropolitana ley de planeacion participacion indicadores prospectiva governance participation foresight"),
 "11_MEXICO_BCS": ("México y Baja California Sur", "Mexico & BCS", "mexico baja california sur bcs sedatu inegi conagua banobras fonatur imco pdu poet"),
 "12_INTERNATIONAL_CASES": ("Casos internacionales", "International cases", "casos internacionales arizona california mediterraneo canarias baleares chile australia golfo singapur international cases"),
 "13_DATASETS_INDICATORS": ("Datos e indicadores", "Datasets & indicators", "datos abiertos indicadores gis indices open data indicators datasets"),
}
GENERAL_KW = ("water agua coast costa tourism turismo mexico méxico baja desalination desal planning plan policy "
              "recommend recomend key finding lesson governance infrastructure climate resilien arid island "
              "municipal region density transit land housing finance ppp aquifer drought hurricane").split()
KEY_SEC = re.compile(r"executive summary|key messages|key findings|resumen ejecutivo|mensajes clave|recommendations|recomendaciones|conclusions|conclusiones|overview|introducci[oó]n|abstract", re.I)
STOPT = set("the of and for in on a an to de la el los las y en del por con para un una guide report edition vol volume new towards toward from its".split())


# Manual adjudication after reading first pages (2026-09-28). Relabel = the downloaded
# file is a different, identifiable publication: cite it by its real title, no catalog URL.
SKIP = {
 "01_T1_2012_OECD_SecondTierCities": "skip_content_title_mismatch",   # OECD Skills Strategy
 "05_T2_2010_UNSD_InfrastructureStatistics": "skip_content_title_mismatch",  # household survey samples
 "08_T1_2012_UNHabitat_AridCities": "skip_content_title_mismatch",   # UN-Habitat COVID-19 plan
 "10_T1_2010_FIG_LandAdministration": "skip_content_title_mismatch",  # GNSS positioning
 "11_T1_2016_BCS_LeyDesarrolloUrbano": "skip_duplicate_wrong_file",  # privacy notice (same as LeyIngresos)
 "10_T1_2008_UCLG_GOLDI": "skip_duplicate_wrong_file",
}
RELABEL = {
 "01_T1_2017_ECLAC_DesarrolloTerritorialALC": dict(title="Planificación para el desarrollo territorial sostenible en América Latina y el Caribe", org="CEPAL / ILPES", year=""),
 "01_T1_2019_UNHabitat_RuralUrbanLinkages": dict(title="Urban-Rural Linkages: Guiding Principles — Framework for Action to Advance Integrated Territorial Development", org="UN-Habitat", year=""),
 "01_T2_2020_ESPOIN_TerritorialCohesion": dict(title="INTERCO — Indicators of territorial cohesion (ESPON 2013, Final Report Part C)", org="ESPON", year=""),
 "04_T2_2021_OECD_OceanAccounts": dict(title="OECD work in support of a sustainable ocean", org="OECD", year=""),
 "05_T1_2020_ITF_DecarbonisingTransport": dict(title="Decarbonising Transport in Latin American cities: a review of policies and key challenges", org="ITF / OECD", year=""),
 "07_T1_2020_OECD_TourismResilience": dict(title="OECD Tourism Trends and Policies 2020", org="OECD", year="2020"),
 "08_T1_2010_OECD_WaterPricing": dict(title="Sustainable Management of Water Resources in Agriculture", org="OECD", year=""),
 "08_T1_2012_EPA_WaterReuse": dict(title="2012 Guidelines for Water Reuse", org="US EPA", year="2012"),
 "09_T1_2022_UNHabitat_WorldCitiesReport": dict(title="World Cities Report 2024: Cities and Climate Action", org="UN-Habitat", year="2024"),
 "10_T1_2017_IMCO_SNA": dict(title="Boletín IMCO: el Sistema Nacional Anticorrupción no ha sido prioridad en este sexenio", org="IMCO", year="2023"),
 "10_T1_2018_OECD_ForesightToolkit": dict(title="Foresight and Anticipatory Governance in Practice", org="OECD Strategic Foresight Unit", year=""),
 "10_T1_2019_UCLG_GOLDV": dict(title="Guidelines for Voluntary Local Reviews, Vol. 2: Towards a New Generation of VLRs", org="UN-Habitat / UCLG", year="2021"),
 "13_T1_2024_INEGI_SNIEG": dict(title="Manual del Banco de Información Económica (BIE)", org="INEGI", year=""),
 "09_T1_2011_IUCN_EbA": dict(title="Economics of Coastal Zone Management in the Pacific", org="IUCN (Ram-Bidesi, Lal, Conner)", year="2011"),
 "04_T1_2020_IMCO_Predial": dict(title="IMCO: México podría duplicar la recaudación de predial al impulsar la modernización catastral", org="IMCO", year=""),
 "03_T1_2016_NACTO_GlobalStreetDesignGuide": dict(title="Guía global de diseño de calles (Global Street Design Guide, edición en español)", org="Global Designing Cities Initiative / NACTO", year="", keep_url=True),
}

def fold(s):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "").lower()) if unicodedata.category(c) != "Mn")

def toks(s):
    return [t for t in re.findall(r"[a-z0-9]{3,}", fold(s)) if t not in STOPT]

def clean(s):
    s = s.replace("\ufffd", " ")
    s = re.sub(r"-\n(?=[a-z])", "", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()

def clip(s, n):
    s = (s or "").strip()
    if len(s) <= n: return s
    return s[: n - 1].rsplit(" ", 1)[0] + "…"

def load_master():
    rows = []
    with open(LIB / "BCS2050_LIB_MASTER.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            r = {k.strip(): (v or "").strip() for k, v in r.items() if k}
            if not r.get("ID"): continue
            # Repair shifted rows (Access holding a URL)
            if r.get("Access", "").startswith("http"):
                r["PDF_link"] = r.get("PDF_link") or r["Access"]; r["Access"] = ""
            rows.append(r)
    return rows

def title_match(title, org, text):
    tt = toks(title)
    if not tt: return 0.0
    hay = set(re.findall(r"[a-z0-9]{3,}", fold(text)))
    hit = sum(1 for t in tt if t in hay)
    return hit / len(tt)

def main():
    master = load_master()
    by_fn = {r.get("Suggested_filename"): r for r in master}
    pdfs = sorted(glob.glob(str(LIB / "FILES/**/*.pdf"), recursive=True))
    # sha groups
    sha = {}
    for p in pdfs:
        h = hashlib.sha256(open(p, "rb").read()).hexdigest()
        sha[p] = h
    groups = defaultdict(list)
    for p, h in sha.items(): groups[h].append(p)
    # existing corpus dedupe: sha of lake PDFs of same size (precomputed list)
    lake_dups = {}
    sizes = defaultdict(list)
    for p in pdfs: sizes[os.path.getsize(p)].append(p)
    for rootd, ds, fs in os.walk(ROOT.parent):
        rp = str(rootd)
        if "/13_library" in rp or "node_modules" in rp or "/dist" in rp or "_bak" in rp:
            ds[:] = []; continue
        for fn in fs:
            if not fn.lower().endswith(".pdf"): continue
            fp = os.path.join(rootd, fn)
            try: s = os.path.getsize(fp)
            except OSError: continue
            if s in sizes:
                h = hashlib.sha256(open(fp, "rb").read()).hexdigest()
                for lp in sizes[s]:
                    if sha[lp] == h: lake_dups.setdefault(lp, os.path.relpath(fp, ROOT.parent))
    docs = {}
    for p in pdfs:
        fn = os.path.basename(p)
        r = by_fn.get(fn)
        if r is None:
            # fuzzy by filename tokens
            best, bs = None, 0
            for m in master:
                sf = m.get("Suggested_filename") or ""
                s = len(set(toks(sf)) & set(toks(fn)))
                if s > bs: best, bs = m, s
            r = best if bs >= 3 else {"ID": "", "Title": fn, "Folder": Path(p).parts[-3]}
        txtp = TXT / (Path(fn).stem + ".txt")
        text = txtp.read_text(encoding="utf-8", errors="replace") if txtp.exists() else ""
        pages = text.split("\f")
        head = " ".join(pages[:6])
        docs[p] = dict(row=r, text=text, pages=pages, match=title_match(r.get("Title", ""), r.get("Author/Institution", ""), head + " " + " ".join(pages[-2:])))
    status = {}
    for h, ps in groups.items():
        if len(ps) > 1:
            ps_sorted = sorted(ps, key=lambda q: -docs[q]["match"])
            keep = ps_sorted[0] if docs[ps_sorted[0]]["match"] >= 0.6 else None
            for q in ps:
                if q != keep: status[q] = "skip_duplicate_wrong_file"
    for p, d in docs.items():
        if p in status: continue
        n = len(clean(d["text"]))
        if n < 4000: status[p] = "skip_no_text_or_landing"
        elif d["match"] < 0.5: status[p] = "skip_content_title_mismatch"
        elif p in lake_dups: status[p] = "skip_already_in_corpus"
        else: status[p] = "indexed"
    for p in docs:
        stem = Path(p).stem
        if stem in SKIP: status[p] = SKIP[stem]
        elif stem in RELABEL and status[p] in ("indexed", "skip_content_title_mismatch", "skip_duplicate_wrong_file"):
            status[p] = "indexed"; docs[p]["relabel"] = RELABEL[stem]
    # Build chunks
    chunks = []
    lib_items = {}
    for p, d in docs.items():
        r = d["row"]; st = status[p]
        folder = r.get("Folder") or Path(p).parts[-3]
        tes, ten, tkw = TOPICS.get(folder, (folder, folder, ""))
        rid = r.get("ID") or Path(p).stem
        rl = d.get("relabel")
        if rl and not rl.get("keep_url"): rid = rid + "-ALT"
        lib_items.setdefault(rid, {})
        lib_items[rid].update(dict(file=os.path.relpath(p, LIB), file_status=st, pages=len([x for x in d["pages"] if x.strip()]),
                                   match=round(d["match"], 2), sha256=sha[p], lake_copy=lake_dups.get(p)))
        if st != "indexed": continue
        title = r.get("Title") or Path(p).stem
        org = r.get("Author/Institution") or ""
        year = r.get("Year") or ""
        url = r.get("Link") or r.get("PDF_link") or ""
        if rl:
            title, org, year = rl["title"], rl["org"], rl["year"]
            if not rl.get("keep_url"): url = ""
            lib_items[rid].update(dict(alt=dict(title=title, org=org, year=year, folder=folder, orig=r.get("ID"))))
        tagline = f"[biblioteca library BCS2050 {tkw} {r.get('Tags','').replace('|',' ')} {org}]"
        tt = set(toks(title + " " + r.get("Tags", "") + " " + tkw))
        kw = set(GENERAL_KW) | tt
        scored = []
        for i, pg in enumerate(d["pages"]):
            c = clean(pg)
            if len(c) < 700: continue
            low = fold(c)
            dots = c.count(". . .") + c.count("....") + pg.count("\ufffd") // 8 + c.count("…") // 3 + len(re.findall(r"\s\d{1,3}\s\d\.\d", c)) // 4
            if dots > 5: continue
            if re.search(r"\b(references|bibliography|bibliografia|referencias|index)\b", low[:200]): continue
            npg = len(d["pages"])
            if npg > 20 and i >= npg * 0.94: continue  # back matter / publication lists
            digits = sum(ch.isdigit() for ch in c) / max(len(c), 1)
            if digits > 0.12: continue  # tables of numbers / TOCs / series lists
            if low.count("e-mail") + low.count("isbn") + low.count("http") + low.count("doi.org") > 3: continue
            if len(re.findall(r"\(lc/|\bet al\b|\bpp\. ", low)) > 3: continue
            words = re.findall(r"[a-z]{3,}", low)
            if not words: continue
            kwc = sum(1 for w in words if w in kw or any(w.startswith(k) for k in ("desal", "aquif", "acuif", "coast", "touris", "turis")))
            s = kwc / (len(words) ** 0.5)
            if KEY_SEC.search(c[:600]): s += 3
            s += min(4, len(re.findall(r"principle|principio|recommendation|recomendaci|lesson|lecci[oó]n|key message|mensaje clave|objective a\.|policy option", low))) * 0.8
            if i < 3: s -= 2  # covers / copyright
            scored.append((s, i, c))
        if not scored: status[p] = "skip_no_text_or_landing"; lib_items[rid]["file_status"] = status[p]; continue
        npages = len(d["pages"])
        N = min(8, max(3, npages // 25))
        top = sorted(scored, key=lambda x: -x[0])[:N]
        top = sorted(top, key=lambda x: x[1])
        # summary card: first key-section page, else best page
        key_pages = [x for x in scored if KEY_SEC.search(x[2][:600])]
        sp = (key_pages[0] if key_pages else top[0])
        def window(c, n=760):
            sents = re.split(r"(?<=[.;:])\s+", c)
            best, bs = c[:n], -1
            for j in range(len(sents)):
                w = ""
                for s2 in sents[j:]:
                    if len(w) + len(s2) > n: break
                    w += s2 + " "
                if len(w) < 200: continue
                sc = sum(1 for x in re.findall(r"[a-z]{3,}", fold(w)) if x in kw)
                if sc > bs: best, bs = w, sc
            return clip(best, n)
        head = f"Biblioteca BCS2050 — «{title}» ({org}{', ' + year if year else ''})."
        rel = r.get("Relevance_BCS2050", "")
        summary = (f"{head} Tipo: {r.get('Type','')}; idioma {r.get('Language','')}; tema: {tes}. " +
                   (f"Relevancia para BCS 2050: {rel} " if not (rl and not rl.get("keep_url")) else f"(Archivo recibido en lugar de la referencia {r.get('ID')}.) ") + f"Extracto (p. {sp[1]+1}): {window(sp[2], 620)} " +
                   (f"Fuente pública: {url} " if url else "") + tagline)
        base_id = "lib:" + re.sub(r"[^A-Za-z0-9]", "", rid)
        common = dict(theme="biblioteca", drive_url=None, type="library", href=url or "/biblioteca/",
                      lib_id=rid, org=org, year=year, topic=folder)
        chunks.append(dict(id=base_id, title=f"Biblioteca: {title} ({org}{', ' + year if year else ''})"[:160],
                           path=f"13_library/{folder}/{os.path.basename(p)}", sum_es=clip(summary, 1300), **common))
        for s, i, c in top:
            if i == sp[1]: continue
            body = f"{head} p. {i+1}: {window(c)} {tagline}"
            chunks.append(dict(id=f"{base_id}:p{i+1}", title=f"Biblioteca: {title} — p. {i+1}"[:160],
                               path=f"13_library/{folder}/{os.path.basename(p)}#p{i+1}", sum_es=clip(body, 1100), **common))
    # Topic reading-list cards (whole catalog incl. not-downloaded items)
    by_folder = defaultdict(list)
    for r in master: by_folder[r.get("Folder", "")].append(r)
    for folder, rs in sorted(by_folder.items()):
        if folder not in TOPICS: continue
        tes, ten, tkw = TOPICS[folder]
        t1 = [r for r in rs if r.get("Tier") == "1"]
        items = "; ".join(f"{r['ID']} {clip(r.get('Title',''),90)} ({r.get('Author/Institution','')}, {r.get('Year','')})" for r in t1[:14])
        chunks.append(dict(id=f"lib:topic:{folder}", title=f"Biblioteca BCS2050 — lecturas clave: {tes}",
                           path=f"13_library/{folder}", theme="biblioteca", type="library", drive_url=None,
                           href=f"/biblioteca/?tema={folder}", topic=folder,
                           sum_es=clip(f"Biblioteca BCS2050, tema «{tes}» ({ten}): {len(rs)} referencias catalogadas ({len(t1)} Tier 1). "
                                       f"Lecturas Tier 1: {items}. Catálogo completo en /biblioteca. [biblioteca library lecturas reading list {tkw}]", 1400)))
    # Reading paths + glossary from INDEX
    rp = (LIB / "BCS2050_LIB_ReadingPaths.md").read_text(encoding="utf-8", errors="replace")
    for sec in re.split(r"\n(?=## )", rp)[1:]:
        lines = sec.strip().splitlines()
        h = lines[0].lstrip("# ").strip()
        chunks.append(dict(id="lib:path:" + re.sub(r"[^a-z0-9]", "", fold(h))[:30], title=f"Biblioteca BCS2050 — ruta de lectura: {h}",
                           path="13_library/BCS2050_LIB_ReadingPaths.md", theme="biblioteca", type="library", drive_url=None, href="/biblioteca/#rutas",
                           sum_es=clip(f"Ruta de lectura (10 imprescindibles) — {h}: " + " ".join(l.strip() for l in lines[1:] if l.strip()) +
                                       " [biblioteca library ruta lectura reading path imprescindibles must-read]", 1300)))
    idx = (LIB / "BCS2050_LIB_00_INDEX.md").read_text(encoding="utf-8", errors="replace")
    m = re.search(r"## Glossary.*?\n(.*?)\n## ", idx, re.S)
    if m:
        gl = clean(m.group(1).replace("**", ""))
        for k, part in enumerate([gl[:1200], gl[1200:2400], gl[2400:3600]]):
            if part.strip():
                chunks.append(dict(id=f"lib:glossary:{k}", title=f"Biblioteca BCS2050 — glosario ({k+1})", path="13_library/BCS2050_LIB_00_INDEX.md#glossary",
                                   theme="biblioteca", type="library", drive_url=None, href="/biblioteca/#glosario",
                                   sum_es=clip("Glosario de planeación BCS2050: " + part + " [glosario glossary definicion ordenamiento pdu poet dot tod brt app ppp iczm iwrm]", 1300)))
    # Compendio fuentes web MX (Spanish, sections)
    comp = (LIB / "COMPENDIO_FUENTES_WEB_MX.md").read_text(encoding="utf-8", errors="replace")
    for sec in re.split(r"\n(?=## )", comp)[1:]:
        lines = sec.strip().splitlines(); h = lines[0].lstrip("# ").strip()
        body = clean(" ".join(lines[1:]).replace("**", ""))
        body = re.split(r"\s#\s", body)[0]
        if len(body) < 120: continue
        urlm = re.search(r"https?://\S+", body)
        for k in range(0, min(len(body), 2400), 1100):
            chunks.append(dict(id=f"lib:mx:{re.sub(r'[^A-Za-z0-9]','',h)[:28]}:{k//1100}", title=f"Compendio fuentes web MX — {h}"[:160],
                               path="13_library/COMPENDIO_FUENTES_WEB_MX.md", theme="biblioteca", type="library", drive_url=None,
                               href=(urlm.group(0).rstrip(').,') if urlm else "/biblioteca/"),
                               sum_es=clip(f"Compendio BCS2050 de fuentes web mexicanas — {h}: {body[k:k+1100]} [biblioteca mexico fuentes web gob.mx]", 1300)))
    # Catalog JSON for the page
    items = []
    for r in master:
        rid = r["ID"]; li = lib_items.get(rid, {})
        folder = r.get("Folder", "")
        items.append(dict(id=rid, folder=folder, topic_es=TOPICS.get(folder, (folder,))[0], topic_en=TOPICS.get(folder, (folder, folder))[1],
                          tier=r.get("Tier", ""), title=r.get("Title", ""), org=r.get("Author/Institution", ""), year=r.get("Year", ""),
                          type=r.get("Type", ""), lang=r.get("Language", ""), url=r.get("Link", ""), pdf_url=r.get("PDF_link", ""),
                          access=r.get("Access", ""), tags=[t.strip() for t in r.get("Tags", "").split("|") if t.strip()],
                          relevance=r.get("Relevance_BCS2050", ""), status=("indexed" if li.get("file_status") == "indexed" else ("downloaded" if li else "catalog")),
                          pages=li.get("pages") if li.get("file_status") == "indexed" else None))
    for rid, li in lib_items.items():
        if li.get("alt") and li.get("file_status") == "indexed":
            a = li["alt"]; f = a["folder"]
            items.append(dict(id=rid, folder=f, topic_es=TOPICS.get(f, (f,))[0], topic_en=TOPICS.get(f, (f, f))[1], tier="", title=a["title"], org=a["org"], year=a["year"],
                              type="Documento", lang="", url="", pdf_url="", access="", tags=[], relevance=f"Archivo recibido al descargar la referencia {a['orig']}; se indexa con su título real.",
                              status="indexed", pages=li.get("pages")))
    for it in items:
        o = re.split(r"\s[(\[]|/|;|,", it["org"] or "")[0].strip()
        it["org_key"] = o[:60]
    paths = []
    for sec in re.split(r"\n(?=## )", rp)[1:]:
        lines = sec.strip().splitlines()
        paths.append(dict(title=lines[0].lstrip("# ").strip(), items=[re.sub(r"^\d+\.\s*", "", l.strip()) for l in lines[1:] if re.match(r"^\s*\d+\.", l)]))
    glossary = []
    if m:
        for g in re.findall(r"\d+\.\s+\*\*(.+?)\*\*\s+—\s+(.+)", m.group(1)):
            glossary.append(dict(term=g[0].strip(), definition=g[1].strip()))
    payload = {"generated": "2026-09-28", "topics": {k: {"es": v[0], "en": v[1]} for k, v in TOPICS.items()},
               "paths": paths, "glossary": glossary, "items": items}
    # Public-text guard: never ship the uppercase token of an internal platform name
    # (also avoids substring hits such as all-caps "ECONOMIES").
    for c in chunks:
        for k in ("sum_es", "title"):
            if isinstance(c.get(k), str):
                c[k] = re.sub(r"\b\w*MIES\w*\b", lambda m: m.group(0).capitalize(), c[k])
    OUT_CAT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (ROOT / "public" / "library_catalog.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    OUT_CHUNKS.write_text(json.dumps(chunks, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    rep = dict(status=Counter(status.values()), files={os.path.relpath(p, LIB): dict(status=status[p], match=round(docs[p]["match"], 2), id=docs[p]["row"].get("ID"), title=docs[p]["row"].get("Title"), lake_copy=lake_dups.get(p)) for p in pdfs},
               chunks=len(chunks), chunk_bytes=len(json.dumps(chunks, ensure_ascii=False, separators=(",", ":")).encode()))
    REPORT.write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(dict(status=rep["status"], chunks=rep["chunks"], chunk_bytes=rep["chunk_bytes"], by_type=Counter(c["id"].split(":")[1] if c["id"].count(":")>1 and c["id"].split(":")[1] in ("topic","path","glossary","mx") else "doc" for c in chunks))))

if __name__ == "__main__":
    main()
