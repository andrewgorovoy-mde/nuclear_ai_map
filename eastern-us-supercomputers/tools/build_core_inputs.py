#!/usr/bin/env python3
"""Build the score inputs that come from census, CDC and the map's own records:

  health:         asthma, copd, cancer (CDC PLACES, from data/tracts.geojson); asthma_er (CDC Tracking Network, Shelby only)
  income:         income (median household, 2024 dollars), poverty (share below poverty line)
  context:        black_pct (shown, never scored)
  infrastructure: generation_proximity (fossil capacity online nearby, incl. xAI turbines)
  legal:          legal_activity (permits, filings, rulings near the tract)

Writes data/inputs/<id>.json in the format described in tools/INPUTS.md. Run tools/build_tracts.py first.
"""
import csv, io, json, math, os, re, sys, urllib.request, zipfile, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, ".cache")
OUTDIR = os.path.join(ROOT, "data", "inputs")
UA = {"User-Agent": "counter-map-data-build/0.1"}
TODAY = datetime.date.today().isoformat()
YEARS = [str(y) for y in range(2019, 2027)]
COUNTIES = {"47157": ("TN", "tn", "Tennessee"), "28033": ("MS", "ms", "Mississippi")}

def fetch(url, name, data=None):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print("  downloading", name, file=sys.stderr)
        req = urllib.request.Request(url, headers=UA, data=data)
        with urllib.request.urlopen(req, timeout=600) as r, open(path, "wb") as f:
            f.write(r.read())
    return path

def write(obj):
    os.makedirs(OUTDIR, exist_ok=True)
    obj.setdefault("geography", "tract")
    path = os.path.join(OUTDIR, f"{obj['id']}.json")
    json.dump(obj, open(path, "w"), separators=(",", ":"), ensure_ascii=False)
    cov = {y: sum(v is not None for v in d.values()) for y, d in obj["years"].items()}
    print(f"  {obj['id']}: {cov}")

TRACTS = json.load(open(os.path.join(ROOT, "data", "tracts.geojson")))
GEOIDS = [f["properties"]["geoid"] for f in TRACTS["features"]]

# ---------- geometry helpers ----------
def ring_centroid(ring):
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        c = x1 * y2 - x2 * y1
        a += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c
    return (cx / (3 * a), cy / (3 * a), abs(a / 2)) if a else (ring[0][0], ring[0][1], 0)

def centroid(geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    best = max((ring_centroid(p[0]) for p in polys), key=lambda c: c[2])   # largest part
    return best[1], best[0]                                                    # lat, lng

CENTROID = {f["properties"]["geoid"]: centroid(f["geometry"]) for f in TRACTS["features"]}

def km(a, b):
    (la1, lo1), (la2, lo2) = a, b
    p = math.pi / 180
    h = math.sin((la2 - la1) * p / 2) ** 2 + math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))

# ---------- 2010 -> 2020 tract relationship ----------
def crosswalk():
    path = os.path.join(CACHE, "tract20_tract10.txt")
    xw = {}
    for r in csv.DictReader(open(path, encoding="utf-8-sig"), delimiter="|"):
        g20 = r["GEOID_TRACT_20"]
        if g20[:5] in COUNTIES:
            land10 = float(r["AREALAND_TRACT_10"] or 0)
            part = float(r["AREALAND_PART"] or 0)
            xw.setdefault(g20, []).append((r["GEOID_TRACT_10"], part, part / land10 if land10 else 0))
    return xw
XW = crosswalk()

# ---------- health: CDC PLACES (already on 2020 tracts in tracts.geojson) ----------
def health():
    props = {f["properties"]["geoid"]: f["properties"] for f in TRACTS["features"]}
    meta = {
        "asthma": ("Adult asthma (current)", "CASTHMA"),
        "copd": ("Adult COPD", "COPD"),
        "cancer": ("Adult cancer (non-skin)", "CANCER"),
    }
    for key, (label, mid) in meta.items():
        years, unc, basis = {}, {}, {}
        for y in YEARS:
            vals = {g: props[g].get(key, {}).get(y) for g in GEOIDS}
            if not any(vals.values()):
                continue
            years[y] = {g: (v[0] if v else None) for g, v in vals.items()}
            unc[y] = {g: (round((v[2] - v[1]) / 2, 2) if v and v[1] is not None and v[2] is not None else None) for g, v in vals.items()}
            basis[y] = next((v[3] for v in vals.values() if v), "")
        obj = {
            "id": key, "label": label, "category": "health", "unit": "% of adults", "direction": "higher_worse",
            "years": years, "uncertainty": unc, "basis": basis,
            "source": {"name": f"CDC PLACES, measure {mid}", "publisher": "U.S. Centers for Disease Control and Prevention",
                       "url": "https://www.cdc.gov/places/", "tier": "official", "retrieved": TODAY},
            "notes": ["Modeled estimates from a national survey (BRFSS), not counts of local diagnoses. CDC says the model cannot detect effects of local sources.",
                      "Uncertainty is half the 95% confidence interval.",
                      "Latest data year is 2023; later years have no data."],
        }
        if key == "cancer":
            obj["rank_groups"] = [["2019", "2020", "2021"], ["2022", "2023"]]
            obj["notes"].append("The survey question changed in 2022 (now includes melanoma). 2019–2021 and 2022–2023 are ranked separately and must not be read as one trend.")
        write(obj)

# ---------- health: asthma ED visits, CDC Tracking Network (Tennessee hospital discharge data) ----------
def asthma_er():
    url = "https://ephtracking.cdc.gov/apigateway/api/v1/getCoreHolder/900/137/1/47/2/2016,2017,2018,2019/0/0"
    rows = json.load(open(fetch(url, "epht_900.json")))["tableResult"]
    v10 = {r["geoId"]: (float(r["dataValue"]) if r["dataValue"] not in (None, "", "Suppressed") and r.get("suppressionFlag") == "0" else None)
           for r in rows if r["temporal"] == "2019" and r["geoId"].startswith("47157")}
    out = {}
    for g in GEOIDS:
        if not g.startswith("47157"):
            out[g] = None          # DeSoto: no public ER data at any level
            continue
        parts = [(g10, w) for g10, w, _ in XW.get(g, []) if w > 0 and v10.get(g10) is not None]
        wsum = sum(w for _, w in parts)
        out[g] = round(sum(v10[g10] * w for g10, w in parts) / wsum, 1) if wsum else None
    write({
        "id": "asthma_er", "label": "Asthma emergency visits, age-adjusted", "category": "health",
        "unit": "visits per 10,000 people per year", "direction": "higher_worse",
        "years": {"2019": out}, "basis": {"2019": "2015–2019 average; 2010 tracts, area-weighted to 2020 (approx.)"},
        "source": {"name": "CDC Environmental Public Health Tracking Network, measure 900 (Tennessee hospital discharge data)",
                   "publisher": "CDC; Tennessee Department of Health", "url": "https://ephtracking.cdc.gov/", "tier": "official", "retrieved": TODAY},
        "notes": ["Shelby County only. Mississippi publishes no ER data for DeSoto County at any level.",
                  "The latest public period is 2015–2019. Newer data requires paid data-use agreements with the state health departments.",
                  "Small tracts are suppressed by the source."],
    })

# ---------- income and poverty: ACS 5-year ----------
CPI = {2019: 255.657, 2020: 258.811, 2021: 270.970, 2022: 292.655, 2023: 304.702, 2024: 313.689}   # BLS CPI-U annual averages

def acs_seq(year, state_ab, state_name, seq):
    base = f"https://www2.census.gov/programs-surveys/acs/summary_file/{year}/data/5_year_seq_by_state/{state_name}/Tracts_Block_Groups_Only/"
    geo = fetch(base + f"g{year}5{state_ab}.csv", f"g{year}5{state_ab}.csv")
    z = zipfile.ZipFile(fetch(base + f"{year}5{state_ab}{seq}000.zip", f"{year}5{state_ab}{seq}000.zip"))
    logrec = {}
    for r in csv.reader(open(geo, encoding="latin-1")):
        if r[2] == "140":
            logrec[r[4]] = next(x for x in r if x.startswith("14000US"))[-11:]
    est = {logrec[r[5]]: r for r in csv.reader(io.TextIOWrapper(z.open(f"e{year}5{state_ab}{seq}000.txt"), encoding="latin-1")) if r[5] in logrec}
    moe = {logrec[r[5]]: r for r in csv.reader(io.TextIOWrapper(z.open(f"m{year}5{state_ab}{seq}000.txt"), encoding="latin-1")) if r[5] in logrec}
    return est, moe

def num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if x < -1e5 else x

def acs_old(year):
    """2015-19 and 2016-20 from the sequence-based summary files. Column positions from the sequence lookup (1-indexed)."""
    rec = {}
    for fips, (_, ab, name) in COUNTIES.items():
        race, _ = acs_seq(year, ab, name, "0004")         # B03002 starts at column 38
        pov, _ = acs_seq(year, ab, name, "0047")          # B17001 starts at column 7
        inc, incm = acs_seq(year, ab, name, "0058")       # B19013 at column 177
        for g in race:
            if not g.startswith(fips):
                continue
            rec[g] = {"pop": num(race[g][37]), "black": num(race[g][40]),
                      "pov_u": num(pov.get(g, [None] * 8)[6]), "pov_b": num(pov.get(g, [None] * 8)[7]),
                      "inc": num(inc.get(g, [None] * 177)[176]), "inc_m": num(incm.get(g, [None] * 177)[176])}
    return rec

def acs_new(year):
    rec = {}
    tab = lambda t: {r["GEO_ID"][-11:]: r for r in csv.DictReader(open(os.path.join(CACHE, f"acs_{year}_{t}.dat")), delimiter="|")}
    inc, race, pov = tab("b19013"), tab("b03002"), tab("b17001")
    for g in race:
        rec[g] = {"pop": num(race[g]["B03002_E001"]), "black": num(race[g]["B03002_E004"]),
                  "pov_u": num(pov.get(g, {}).get("B17001_E001")), "pov_b": num(pov.get(g, {}).get("B17001_E002")),
                  "inc": num(inc.get(g, {}).get("B19013_E001")), "inc_m": num(inc.get(g, {}).get("B19013_M001"))}
    return rec

def to_2020(rec10):
    """Carry 2010-tract records onto 2020 tracts: counts apportioned by land share; median income weighted by apportioned population."""
    out = {}
    for g20 in GEOIDS:
        parts = [(rec10[g10], share) for g10, _, share in XW.get(g20, []) if g10 in rec10 and share > 0]
        if not parts:
            continue
        s = lambda k: sum((r[k] or 0) * sh for r, sh in parts) if all(r[k] is not None for r, _ in parts) else None
        popw = [(r["inc"], (r["pop"] or 0) * sh) for r, sh in parts if r["inc"] is not None]
        wsum = sum(w for _, w in popw)
        out[g20] = {"pop": s("pop"), "black": s("black"), "pov_u": s("pov_u"), "pov_b": s("pov_b"),
                    "inc": sum(v * w for v, w in popw) / wsum if wsum else None, "inc_m": None}
    return out

def income_poverty_race():
    vint = {2019: to_2020(acs_old(2019)), 2020: acs_old(2020)}
    for y in (2021, 2022, 2023, 2024):
        vint[y] = acs_new(y)
    inc, incu, pov, blk, basis = {}, {}, {}, {}, {}
    for y, rec in vint.items():
        k = str(y)
        f = CPI[2024] / CPI[y]
        inc[k] = {g: (round(rec[g]["inc"] * f) if g in rec and rec[g]["inc"] is not None else None) for g in GEOIDS}
        incu[k] = {g: (round(rec[g]["inc_m"] * f) if g in rec and rec[g]["inc_m"] is not None else None) for g in GEOIDS}
        pov[k] = {g: (round(100 * rec[g]["pov_b"] / rec[g]["pov_u"], 1) if g in rec and rec[g]["pov_u"] else None) for g in GEOIDS}
        blk[k] = {g: (round(100 * rec[g]["black"] / rec[g]["pop"], 1) if g in rec and rec[g]["pop"] else None) for g in GEOIDS}
        basis[k] = f"ACS {y - 4}–{y} 5-year" + ("; 2010 tracts carried to 2020 (approx.)" if y == 2019 else "")
    src = {"name": "American Community Survey 5-year estimates (tables B19013, B17001, B03002)", "publisher": "U.S. Census Bureau",
           "url": "https://www.census.gov/programs-surveys/acs/data/summary-file.html", "tier": "official", "retrieved": TODAY}
    common = ["Each year is a 5-year average ending in that year (e.g., 2024 = 2020–2024), so recent changes show up slowly.",
              "2025 and 2026 have no data yet."]
    write({"id": "income", "label": "Median household income", "category": "income", "unit": "2024 dollars", "direction": "lower_worse",
           "years": inc, "uncertainty": incu, "basis": basis, "source": src,
           "notes": ["Adjusted to 2024 dollars with the BLS CPI-U annual average.", "Uncertainty is the 90% margin of error (not available for 2015–2019 and 2016–2020 here)."] + common})
    write({"id": "poverty", "label": "People below the poverty line", "category": "income", "unit": "% of people", "direction": "higher_worse",
           "years": pov, "basis": basis, "source": src, "notes": common})
    write({"id": "black_pct", "label": "Black residents (non-Hispanic)", "category": "context", "unit": "% of residents", "direction": "none",
           "years": blk, "basis": basis, "source": src, "notes": ["Shown for context and disparity analysis. Never part of the score."] + common})

# ---------- infrastructure: fossil generation nearby ----------
DECAY_KM = 2.0      # weight = exp(-distance / 2 km): 1 at the source, 0.37 at 2 km, 0.08 at 5 km
CUTOFF_KM = 8.0     # and exactly 0 beyond 8 km (~5 mi), so distant tracts are not ranked above zero
def decay(d, k, cutoff):
    return math.exp(-d / k) if d <= cutoff else 0.0
FOSSIL = {1, 2, 5}  # fuel index in tva-plants-timeline: coal, gas, other (biomass/oil/other)

def generation_proximity():
    plants = json.load(open(os.path.join(ROOT, "tva-plants-timeline.geojson")))
    turbines = json.load(open(os.path.join(ROOT, "data", "turbines.json")))
    sources = []   # (lat, lng, {year: MW}, label)
    for f in plants["features"]:
        lng, lat = f["geometry"]["coordinates"]
        if not (34.6 < lat < 35.6 and -90.5 < lng < -89.4):
            continue
        mw = {y: sum(g[2] for g in f["properties"]["g"] if g[3] in FOSSIL and g[0] <= int(y) and (not g[1] or int(y) < g[1])) for y in YEARS}
        if any(mw.values()):
            sources.append((lat, lng, mw, f["properties"]["n"]))
    # xAI turbines (not in EIA data). Turbines are equipment that stays until removed, so a year uses the highest count
    # recorded in that year; a year with no record uses the most recent earlier record (its date is listed in turbine_basis).
    UNIT_MW = {"colossus1": 421.4 / 35, "southaven": 1775 / 69}
    SITE_LL = {"colossus1": (35.05991, -90.15632), "southaven": (34.98203, -90.04071)}
    global TURBINE_BASIS
    TURBINE_BASIS = {}
    for site, ll in SITE_LL.items():
        recs = sorted((c for c in turbines["counts"] if c["site"] == site), key=lambda c: c["date"])
        mw = {}
        for y in YEARS:
            inyear = [c for c in recs if c["date"][:4] == y]
            earlier = [c for c in recs if c["date"][:4] < y]
            pick = max(inyear, key=lambda c: c["count"]) if inyear else (earlier[-1] if earlier else None)
            mw[y] = round(pick["count"] * UNIT_MW[site], 1) if pick else 0
            if pick:
                TURBINE_BASIS.setdefault(y, []).append(f"{site}: {pick['count']} units ({pick['status']}, record dated {pick['date']})")
        sources.append((ll[0], ll[1], mw, f"xAI turbines, {site}"))
    years = {y: {g: round(sum(m[y] * decay(km(CENTROID[g], (la, lo)), DECAY_KM, CUTOFF_KM) for la, lo, m, _ in sources), 2) for g in GEOIDS} for y in YEARS}
    write({
        "id": "generation_proximity", "label": "Fossil-fuel generation nearby", "category": "infrastructure",
        "unit": "MW, distance-weighted", "direction": "higher_worse", "years": years,
        "basis": {y: "xAI turbines: " + "; ".join(v) for y, v in TURBINE_BASIS.items()},
        "source": {"name": "EIA Form 860 generators (coal, gas, oil, other fossil) and the map's xAI turbine record", "publisher": "U.S. EIA; MDEQ; court filings",
                   "url": "https://www.eia.gov/electricity/data/eia860/", "tier": "official", "retrieved": TODAY},
        "notes": ["Capacity online that year at each plant, weighted by distance from the tract's center: full weight at the plant, about a third at 2 km, under a tenth at 5 km, and zero beyond 8 km (5 mi).",
                  "xAI turbines are behind the meter and absent from EIA data. Their capacity is the highest unit count on record in each year times the average unit size (Colossus 1: 421.4 MW / 35 units; Southaven: about 1,775 MW / 69 units, an estimate). Count records include allegations; see the turbine counts layer.",
                  "A year with no turbine record of its own uses the most recent earlier record (a permit counts as its permitted units); the record used is listed per year. Removals between records are not captured.",
                  f"Sources counted: {', '.join(sorted({s[3] for s in sources}))}."],
    })

# ---------- legal activity: permits, filings, rulings ----------
LEGAL_DECAY_KM = 5.0
LEGAL_CUTOFF_KM = 15.0
SKIP_TYPES = ("Private transaction",)          # property purchases are reported in the record but are not legal activity

def legal_weight(e):
    """Injunctions weigh most, then court cases (filings, rulings, notices of intent to sue, appeals), then permits and hearings."""
    # Only events that move for, or rule on, an injunction (not ones that merely mention a pending one).
    if re.search(r"\b(moved for|denied|granted|motion for)\b.{0,40}\binjunction", e["title"], re.I):
        return 3, "injunction"
    if any(k in e["type"].lower() for k in ("court", "notice", "appeal")):
        return 2, "case"
    return 1, "permit/decision"

def legal_activity():
    ev = json.load(open(os.path.join(ROOT, "data", "decisions.json")))["events"]
    SITE_LL = {"colossus1": (35.05991, -90.15632), "southaven": (34.98203, -90.04071), "colossus2": (34.99798, -90.03487)}
    used = [e for e in ev if e.get("site") in SITE_LL and e["type"] not in SKIP_TYPES]
    years = {}
    for y in YEARS:
        ys = [e for e in used if e["date"][:4] <= y]     # cumulative: cases and permits stay relevant once filed
        years[y] = {g: round(sum(legal_weight(e)[0] * decay(km(CENTROID[g], SITE_LL[e["site"]]), LEGAL_DECAY_KM, LEGAL_CUTOFF_KM) for e in ys), 3) for g in GEOIDS}
    weights = {e["id"]: legal_weight(e) for e in used}
    write({
        "id": "legal_activity", "label": "Legal cases, permits and decisions nearby", "category": "legal",
        "unit": "weighted events, distance-weighted, cumulative", "direction": "higher_worse", "years": years,
        "detail": {"event_weights": {k: {"weight": w, "kind": kind} for k, (w, kind) in weights.items()}},
        "source": {"name": "The map's decisions record (votes, permits, filings, rulings)", "publisher": "Court records, agencies and news, as cited per event",
                   "url": "data/decisions.json", "tier": "official+secondary", "retrieved": TODAY},
        "notes": ["Each event counts from its date onward. Injunction motions and rulings count 3; lawsuits, court filings and rulings, notices of intent to sue and appeals count 2; permits, applications, hearings, orders and votes count 1.",
                  "Weighted by distance from the site the event concerns: full weight at the site, about a third at 5 km, zero beyond 15 km.",
                  f"{len(used)} of {len(ev)} events are counted. Not counted: events tied to no site (e.g., a TVA board vote, a federal rule) and property purchases.",
                  "A count of legal activity, not a finding: filings are allegations."],
    })

def tract_meta():
    """Population and centroid per tract. Tracts with almost no residents are excluded from ranking and scoring."""
    acs24 = {r["GEO_ID"][-11:]: num(r["B03002_E001"]) for r in csv.DictReader(open(os.path.join(CACHE, "acs_2024_b03002.dat")), delimiter="|")}
    props = {f["properties"]["geoid"]: f["properties"] for f in TRACTS["features"]}
    meta = {g: {"name": props[g]["name"], "county": props[g]["county"], "lat": round(CENTROID[g][0], 5), "lng": round(CENTROID[g][1], 5),
                "pop": acs24.get(g), "no_residents": (acs24.get(g) or 0) < 100} for g in GEOIDS}
    json.dump({"min_pop": 100, "tracts": meta}, open(os.path.join(ROOT, "data", "tract-meta.json"), "w"), separators=(",", ":"))
    print("  no-resident tracts:", [(g, meta[g]["pop"]) for g, m in meta.items() if m["no_residents"]])

if __name__ == "__main__":
    health()
    asthma_er()
    income_poverty_race()
    generation_proximity()
    legal_activity()
    tract_meta()
