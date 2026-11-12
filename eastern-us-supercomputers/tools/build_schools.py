#!/usr/bin/env python3
"""Build the school chronic-absenteeism input for the injustice score.

Writes
  data/schools.geojson           one point per school in Shelby County, TN and DeSoto County, MS,
                                 with its chronic absenteeism rate per school year (null = suppressed/missing)
                                 and the county average of school rates per year.
  data/inputs/absenteeism.json   per tract and score year: inverse-distance-weighted "excess" absenteeism,
                                 i.e. school rate minus the same-county mean of school rates that year
                                 (weights 1/(d_km+1)^2, schools within 8 km of the tract's internal point).

Sources (all public, no API key):
  - Tennessee Dept. of Education, school chronic absenteeism (suppressed) files, 2018-19 and 2021-22 .. 2024-25.
  - Mississippi Dept. of Education, Mississippi Succeeds Report Card (msrc.mdek12.org), component CHRABS.
  - School locations: NCES Common Core of Data directory via the Urban Institute Education Data API.
  - Tract internal points: U.S. Census Bureau TIGERweb, 2020 tracts.

School year -> score year: a school year counts in the calendar year in which it ENDS (2018-19 -> 2019).
2019-20 and 2020-21 are excluded (COVID). Tracts only use schools in their own state.

Usage:  python3 tools/build_schools.py          (downloads are cached in tools/.cache/)
"""
import csv, datetime, io, json, math, os, re, statistics, sys, time, urllib.error, urllib.parse, urllib.request, zipfile
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, ".cache")
OUT_POINTS = os.path.join(ROOT, "data", "schools.geojson")
OUT_INPUT = os.path.join(ROOT, "data", "inputs", "absenteeism.json")
TRACTS = os.path.join(ROOT, "data", "tracts.geojson")
COUNTIES = {"47157": "Shelby County, TN", "28033": "DeSoto County, MS"}
UA = {"User-Agent": "counter-map-data-build/0.1"}
# tn.gov and msrc.mdek12.org refuse some non-browser clients
BROWSER_UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
TODAY = datetime.date.today().isoformat()
MAX_KM = 8.0

def fetch(url, name, headers=UA, delay=0):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print("  downloading", name, file=sys.stderr)
        if delay:
            time.sleep(delay)
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=600) as r:
            data = r.read()
        with open(path, "wb") as f:
            f.write(data)
    return path

def num(v):
    try:
        x = float(str(v).strip())
    except (TypeError, ValueError):
        return None          # "*", "**", "<5%", "<10 students", blank -> suppressed / missing
    return x if 0 <= x <= 100 else None

# ---------- minimal .xlsx reader (first sheet) ----------
XNS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
def xlsx_rows(path):
    z = zipfile.ZipFile(path)
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(XNS + "si"):
            ss.append("".join(t.text or "" for t in si.iter(XNS + "t")))
    sheet = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))[0]
    for row in ET.fromstring(z.read(sheet)).iter(XNS + "row"):
        cells = {}
        for c in row.findall(XNS + "c"):
            ci = 0
            for ch in re.match(r"[A-Z]+", c.get("r")).group():
                ci = ci * 26 + ord(ch) - 64
            t, v = c.get("t"), c.find(XNS + "v")
            if t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(XNS + "t"))
            elif v is None:
                val = None
            elif t == "s":
                val = ss[int(v.text)]
            else:
                val = v.text
            cells[ci - 1] = val
        if cells:
            yield [cells.get(i) for i in range(max(cells) + 1)]

def table(path):
    if path.endswith(".csv"):
        rows = list(csv.reader(io.open(path, encoding="iso-8859-1")))
    else:
        rows = list(xlsx_rows(path))
    head = [h.strip().lower() for h in rows[0]]
    return [dict(zip(head, r)) for r in rows[1:]]

# ---------- Tennessee ----------
TN_BASE = "https://www.tn.gov/content/dam/tn/education/"
TN_PAGE = "https://www.tn.gov/education/districts/federal-programs-and-oversight/data/data-downloads.html"
# score year -> (school year, path). 2019-20 (accountability/2020/) and 2020-21 (accountability/2021/) excluded: COVID.
TN_FILES = {
    2019: ("2018-19", "accountability/2019/school_chronic_absenteeism_suppressed.csv"),
    2022: ("2021-22", "accountability/2021-22/school_chronic_absenteeism_suppressed_upd8-19.xlsx"),
    2023: ("2022-23", "accountability/school_chronic_absenteeism_suppressed_2023.xlsx"),
    2024: ("2023-24", "data/school_chronic_absenteeism_suppressed_2024.xlsx"),
    2025: ("2024-25", "data/school_chronic_absenteeism_suppressed_2025.xlsx"),
}

def tn_rates():
    """{score_year: {(system, school): (rate or None, name, system_name)}}"""
    out = {}
    for y, (sy, p) in TN_FILES.items():
        ext = os.path.splitext(p)[1]
        rows = table(fetch(TN_BASE + p, f"tn_chronic_school_{sy}{ext}", BROWSER_UA))
        d = out[y] = {}
        for r in rows:
            grp = (r.get("student_group") or r.get("subgroup") or "").strip()
            if grp != "All Students" or (r.get("grade_band") or "").strip() != "All Grades":
                continue
            try:
                key = (int(float(r["system"])), int(float(r["school"])))
            except (TypeError, ValueError):
                continue
            raw = (r.get("pct_chronically_absent") or "").strip()
            d[key] = (num(raw), r.get("school_name"), r.get("system_name"), raw)
    return out

# ---------- Mississippi ----------
MS_URL = "https://msrc.mdek12.org/details?EntityID={eid}&Component=CHRABS&SchoolYear={sy}"
# MSRC SchoolYear=Y is displayed as "Y-(Y+1)". Score year = Y+1.
# 2017 (2017-18 -> score 2018, outside 2019..2026) and 2020 (2020-21, COVID) are not used; 2019 and 2024 have no CHRABS data.
MS_YEARS = {2019: 2018, 2022: 2021, 2023: 2022, 2024: 2023, 2026: 2025}
MS_RE = re.compile(r'data-tippy-content="(State|District|School)<br />Chronically Absent Students: ([0-9.]+)%"'
                   r'.*?style="width: ([0-9.]+)%', re.S)

def msrc(eid, sy):
    """-> {"School": (display value, width value), "District": ..., "State": ...} from the overview bars."""
    name = f"msrc_{eid}_{sy}.html"
    try:
        path = fetch(MS_URL.format(eid=eid, sy=sy), name, BROWSER_UA, delay=1.0)
    except urllib.error.HTTPError as e:   # MSRC answers 500 for entities it does not know
        print(f"  MSRC {eid} {sy}: HTTP {e.code}", file=sys.stderr)
        if e.code != 500:
            raise
        open(os.path.join(CACHE, name), "w").close()
        return {}
    html = open(path, encoding="utf-8", errors="replace").read()
    cut = html.find("by Subgroup")
    found = {}
    for lab, disp, width in MS_RE.findall(html[:cut] if cut > 0 else html):
        found.setdefault(lab, (float(disp), float(width)))
    return found

# ---------- school locations (NCES CCD via Urban Institute) ----------
CCD_YEARS = [2024, 2023, 2022, 2021, 2018]     # newest first: coordinates come from the newest year listing the school
def ccd():
    schools = {}
    for st in ("47", "28"):
        for y in CCD_YEARS:
            url = f"https://educationdata.urban.org/api/v1/schools/ccd/directory/{y}/?fips={st}"
            res = json.load(open(fetch(url, f"ccd_directory_{y}_{st}.json")))
            if res.get("next"):
                sys.exit(f"CCD {y} fips={st}: paged result not handled")
            for r in res["results"]:
                if r.get("county_code") not in COUNTIES or r.get("latitude") is None:
                    continue
                s = schools.setdefault(r["ncessch"], {"years": [], "seasch": set()})
                s["years"].append(y)
                s["seasch"].add(r["seasch"])
                if "lat" not in s:
                    s.update(seasch_latest=r["seasch"], lat=r["latitude"], lon=r["longitude"], name=r["school_name"], district=r["lea_name"],
                             county=r["county_code"], state="TN" if st == "47" else "MS", ccd_year=y,
                             virtual=r.get("virtual") == 1, school_type=r.get("school_type"),
                             grades=[r.get("lowest_grade_offered"), r.get("highest_grade_offered")])
    return schools

def tn_key(seasch):
    a, b = seasch.split("-")
    return int(a), int(b)

def ms_eid(seasch):                    # "1700-1700044" -> "1700-044"
    a, b = seasch.split("-")
    return f"{a}-{b[-3:]}"

# ---------- tracts ----------
def tract_points():
    where = " OR ".join(f"(STATE='{c[:2]}' AND COUNTY='{c[2:]}')" for c in COUNTIES)
    url = ("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query?"
           + urllib.parse.urlencode({"where": where, "outFields": "GEOID,INTPTLAT,INTPTLON",
                                     "returnGeometry": "false", "f": "json"}))
    feats = json.load(open(fetch(url, "tracts_2020_intpt.json")))["features"]
    pts = {f["attributes"]["GEOID"]: (float(f["attributes"]["INTPTLAT"]), float(f["attributes"]["INTPTLON"])) for f in feats}
    ids = [f["properties"]["geoid"] for f in json.load(open(TRACTS))["features"]]
    missing = set(ids) - set(pts)
    if missing:
        sys.exit(f"no internal point for tracts {sorted(missing)}")
    return ids, pts

def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))

def main():
    log = lambda *a: print(*a, file=sys.stderr)
    schools = ccd()
    tn = tn_rates()

    # --- attach rates ---
    # Several NCES records can carry the same state id (a school re-registered after a move or a district change).
    # Each state record goes to one NCES record only: the one listed in the newest CCD year.
    tn_matched, ms_claimed, tn_low = set(), set(), {}
    for nces, s in sorted(schools.items(), key=lambda kv: (-kv[1]["ccd_year"], kv[0])):
        s["rates"], s["flags"] = {}, []
        if s["state"] == "TN":
            keys = [tn_key(s["seasch_latest"])] + sorted({tn_key(x) for x in s["seasch"]} - {tn_key(s["seasch_latest"])})
            s["state_id"] = s["seasch_latest"]
            for y in TN_FILES:
                hit = [k for k in keys if k in tn[y] and (y, k) not in tn_matched]
                if hit:
                    s["rates"][y] = tn[y][hit[0]][0]
                    tn_matched.add((y, hit[0]))
                    if tn[y][hit[0]][3] in ("**", "<5%"):
                        tn_low.setdefault(y, []).append(nces)
        else:
            eids = {ms_eid(x) for x in s["seasch"]}
            if len(eids) > 1:
                log("  MS school with several MSRC ids:", nces, eids)
            s["state_id"] = eid = ms_eid(s["seasch_latest"])
            if eid in ms_claimed:
                log("  MSRC id already used by a newer NCES record:", nces, eid)
                continue
            ms_claimed.add(eid)
            s["ms_width"] = {}
            for y, sy in MS_YEARS.items():
                got = msrc(eid, sy).get("School")
                if got is not None:
                    s["rates"][y], s["ms_width"][y] = got[0], got[1]
                    if abs(round(got[1], 1) - got[0]) > 0.1001:
                        log("  MSRC display/width mismatch", eid, sy, got)

    # --- MS: exact duplicate values across years (possible MSRC display bug) ---
    dup_pairs = {}
    for s in schools.values():
        if s["state"] != "MS":
            continue
        w = s.pop("ms_width", {})
        ys = sorted(w)
        for i, a in enumerate(ys):
            for b in ys[i + 1:]:
                if w[a] == w[b]:
                    s.setdefault("dup_years", set()).update((a, b))
                    dup_pairs[(a, b)] = dup_pairs.get((a, b), 0) + 1
    # MSRC district and state bars: same check
    ms_agg = {}
    for y, sy in MS_YEARS.items():
        got = msrc("1700-044", sy)
        ms_agg[y] = {k: got.get(k, (None, None))[1] for k in ("District", "State")}
    agg_dups = [(lab, a, b) for lab in ("District", "State") for i, a in enumerate(sorted(ms_agg))
                for b in sorted(ms_agg)[i + 1:] if ms_agg[a][lab] is not None and ms_agg[a][lab] == ms_agg[b][lab]]

    # --- which schools count: in-county, not virtual, has at least one rate ---
    for s in schools.values():
        if s["virtual"]:
            s["flags"].append("virtual school: location is an office address, not used in the score")
    used = {n: s for n, s in schools.items() if not s["virtual"] and any(v is not None for v in s["rates"].values())}

    def usable(s, y):
        v = s["rates"].get(y)
        return None if v is None or y in s.get("dup_years", ()) else v

    # --- county mean of school rates per year (same schools as the IDW) ---
    years = sorted(set(TN_FILES) | set(MS_YEARS))
    county_mean = {}
    for c in COUNTIES:
        for y in years:
            vals = [usable(s, y) for s in used.values() if s["county"] == c]
            vals = [v for v in vals if v is not None]
            if vals:
                county_mean.setdefault(c, {})[y] = (round(statistics.mean(vals), 2), len(vals))

    # --- tract IDW of excess ---
    ids, pts = tract_points()
    out_years, detail = {}, {}
    for y in years:
        states = {c for c in COUNTIES if y in county_mean.get(c, {})}
        if not states:
            continue
        vy = out_years[str(y)] = {}
        dy = detail[str(y)] = {}
        for g in ids:
            c = g[:5]
            if c not in states:
                vy[g] = None            # source covers the year, but not this state
                continue
            num_, den, n = 0.0, 0.0, 0
            for s in used.values():
                if s["state"] != ("TN" if c == "47157" else "MS"):
                    continue
                v = usable(s, y)
                if v is None:
                    continue
                d = km(pts[g], (s["lat"], s["lon"]))
                if d > MAX_KM:
                    continue
                w = 1.0 / (d + 1.0) ** 2
                num_ += w * (v - county_mean[s["county"]][y][0])
                den += w
                n += 1
            vy[g] = round(num_ / den, 2) if n else None
            dy[g] = n

    # --- unmatched TN rows in all-Shelby districts (Memphis-Shelby, the six municipal districts) ---
    shelby_systems = {k[0] for s in schools.values() if s["state"] == "TN" for k in map(tn_key, s["seasch"])}
    unmatched_tn = []
    for y in TN_FILES:
        for k, (v, name, sysname, _) in tn[y].items():
            if k[0] in shelby_systems and (y, k) not in tn_matched and k[1] != 0:
                unmatched_tn.append((y, k, name, sysname, v))

    # --- write schools.geojson ---
    feats = []
    for nces, s in sorted(schools.items(), key=lambda kv: (kv[1]["state"], kv[1]["name"])):
        low = sorted(str(y) for y, ns in tn_low.items() if nces in ns)
        if low:
            s["flags"].append("rate published only as '**' or '<5%' (very low, masked by TN) in " + ", ".join(low) + "; stored as null")
        if not any(v is not None for v in s["rates"].values()) and not s["virtual"] and not low:
            continue                    # no published rate in any used year (suppressed, closed early, admin sites, etc.)
        props = {"name": s["name"], "district": s["district"], "state": s["state"], "county": COUNTIES[s["county"]],
                 "nces_id": nces, "state_id": s["state_id"], "grades": s["grades"], "ccd_year": s["ccd_year"],
                 "used_in_score": nces in used,
                 "chronic_absent_pct": {str(y): s["rates"].get(y) for y in (TN_FILES if s["state"] == "TN" else MS_YEARS)}}
        if s.get("dup_years"):
            props["dup_years"] = sorted(str(y) for y in s["dup_years"])
            s["flags"].append("identical value in several MSRC years (possible display bug); those years not used in the score")
        if s["flags"]:
            props["flags"] = s["flags"]
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(s["lon"], 6), round(s["lat"], 6)]},
                      "properties": props})
    fc = {"type": "FeatureCollection", "features": feats, "properties": {
        "built": TODAY,
        "county_mean_pct": {COUNTIES[c]: {str(y): {"mean": m, "n_schools": n} for y, (m, n) in v.items()} for c, v in county_mean.items()},
        "school_years": {"TN": {str(y): sy for y, (sy, _) in TN_FILES.items()},
                         "MS": {str(y): f"{sy}-{str(sy + 1)[2:]}" for y, sy in MS_YEARS.items()}},
        "sources": {
            "TN": f"Tennessee Dept. of Education, school chronic absenteeism (suppressed) files, All Students / All Grades rows: {TN_PAGE}",
            "MS": "Mississippi Dept. of Education, Mississippi Succeeds Report Card, Chronically Absent Students (CHRABS), school bar: https://msrc.mdek12.org/",
            "locations": "NCES Common Core of Data school directory 2018-2024 via Urban Institute Education Data API",
        },
        "notes": [
            "Keys of chronic_absent_pct are score years: the calendar year in which the school year ends (2018-19 -> 2019).",
            "null = suppressed or not reported. 2019-20 and 2020-21 are not included (COVID).",
            "TN and MS define and count chronic absenteeism differently; do not compare rates across the state line.",
        ]}}
    json.dump(fc, open(OUT_POINTS, "w"), separators=(",", ":"))

    # --- write input ---
    dup_list = sorted(f"{s['name']} ({s['state_id']}): {', '.join(str(y) for y in sorted(s['dup_years']))}"
                      for s in schools.values() if s.get("dup_years"))
    notes = [
        "Each school's chronic absenteeism rate minus the mean of all school rates in its county that year, averaged over schools within 8 km of the tract's internal point with weights 1/(km+1)^2. Positive = more chronic absence than the county's schools that year. No school within 8 km = null.",
        "Weak, confounded stand-in for respiratory health. Absence is driven by poverty, housing instability, transportation, school climate, illness of all kinds and reporting practice; asthma is one cause among many. School level also matters (high schools run higher than elementary schools). Schools draw students from beyond the nearby tracts, and magnet, charter and choice schools draw citywide.",
        "School year counts in the calendar year it ends: 2018-19 -> 2019, 2021-22 -> 2022, 2022-23 -> 2023, 2023-24 -> 2024, 2024-25 -> 2025, 2025-26 -> 2026.",
        "2019-20 and 2020-21 are excluded: COVID closures and remote learning distort attendance. 2020 and 2021 have no data.",
        "Tennessee (TN Dept. of Education) and Mississippi (MS Report Card) define enrollment periods, minimum days and suppression differently. Tracts use only schools in their own state and each school is compared with its own county; do not compare values across the state line.",
        "Tennessee years: 2019, 2022-2025. Mississippi years: 2019, 2022-2024, 2026. 2026 exists only for Mississippi (TN 2025-26 not yet published); 2025 exists only for Tennessee (MSRC shows no 2024-25 chronic absenteeism). In each year, tracts of the state without data are null.",
        "MSRC labels its year selector 'SchoolYear=Y' as Y-(Y+1). Its state bars for 2018-19 (13.05%), 2021-22 (28.02%) and 2025-26 (26.51%) match MDE's rounded published rates (13%, 28%, 26.5%). Its 2023-24 values (state 23.91%, DeSoto district 26.43%) are 0.4-0.5 points below MDE's 2023-24 report (24.4%, 26.82%); the cause is unknown (different calculation, later revision or a display issue). Mississippi 2024 uses MSRC as published and is the least-verified year.",
        "MDE's 2024-25 report (statewide 27.6%, DeSoto district 31.6%) is not on MSRC at school level, so Mississippi has no 2025 value.",
        "Per news reports (WLOX, Sept 2026), Mississippi's 2025-26 rate was calculated from students in school less than 63% of the day, and MDE switches to the federal 50%-of-day rule in 2026-27. Whether 2025-26 is comparable with earlier Mississippi years is not stated. Comparing each school with its own county that year absorbs statewide level shifts, not changes in who counts as absent.",
        "Virtual schools are kept on the map but not used: their location is an office address.",
        "detail gives the number of schools used for each tract and year.",
    ]
    low_used = {y: sum(1 for n in ns if n in used or schools[n]["county"] == "47157" and not schools[n]["virtual"]) for y, ns in sorted(tn_low.items())}
    notes.append("Tennessee masks very low school rates ('**' before 2024-25, '<5%' in 2024-25). They are stored as null, so the county mean and nearby-school averages leave out the best-attendance schools (mostly suburban: Germantown, Collierville, Arlington, Bartlett). Values near those schools are biased upward. Masked Shelby schools per score year: "
                 + ", ".join(f"{y}: {n}" for y, n in low_used.items()) + ".")
    if dup_list:
        notes.append("Possible MSRC display bug: these DeSoto schools show the exact same rate in more than one year; those school-years are not used: " + "; ".join(dup_list) + ".")
    if agg_dups:
        notes.append("MSRC also shows identical district/state rates across years: " + "; ".join(f"{lab} {a} = {b}" for lab, a, b in agg_dups) + " (score years).")
    doc = {
        "id": "absenteeism",
        "label": "School chronic absenteeism vs county (nearby schools)",
        "category": "health",
        "unit": "percentage points vs county",
        "direction": "higher_worse",
        "geography": "tract",
        "years": out_years,
        "detail": detail,
        "basis": {y: "TN schools only" if y == "2025" else ("MS schools only" if y == "2026" else "each state's own schools")
                  for y in out_years},
        "source": {"name": "School chronic absenteeism: TN Dept. of Education data downloads; Mississippi Succeeds Report Card; school locations from NCES CCD (Urban Institute Education Data API)",
                   "publisher": "Tennessee Department of Education; Mississippi Department of Education",
                   "url": TN_PAGE, "tier": "official", "retrieved": TODAY},
        "notes": notes,
    }
    os.makedirs(os.path.dirname(OUT_INPUT), exist_ok=True)
    json.dump(doc, open(OUT_INPUT, "w"), indent=1)

    # --- report ---
    log(f"wrote {OUT_POINTS}: {len(feats)} schools; {OUT_INPUT}")
    for st, c in (("TN", "47157"), ("MS", "28033")):
        n_all = sum(1 for s in schools.values() if s["state"] == st)
        n_rate = sum(1 for s in schools.values() if s["state"] == st and s["rates"])
        log(f"{st}: CCD schools in county {n_all}, with a rate in some year {n_rate}, used {sum(1 for s in used.values() if s['state'] == st)}")
        for y in years:
            if y not in county_mean.get(c, {}):
                continue
            tv = [out_years[str(y)][g] for g in ids if g[:5] == c]
            got = sorted(v for v in tv if v is not None)
            nsch = county_mean[c][y][1]
            log(f"  {y}: county mean {county_mean[c][y][0]} (n={nsch}); tracts with value {len(got)}/{len(tv)}"
                + (f"; excess min {got[0]} median {round(statistics.median(got), 2)} max {got[-1]}" if got else ""))
    log("MS duplicate year pairs:", dup_pairs, "aggregate dups:", agg_dups)
    log("MS district/state width values by score year:", ms_agg)
    log(f"TN rows in Shelby school systems not matched to a Shelby CCD school: {len(unmatched_tn)} (systems 985-988 are statewide; rows outside Shelby are expected)")
    for u in sorted(unmatched_tn):
        log("   ", u)
    for g in ("47157980300", "28033070421"):
        log(g, {y: (out_years[y].get(g), detail[y].get(g)) for y in out_years})

if __name__ == "__main__":
    main()
