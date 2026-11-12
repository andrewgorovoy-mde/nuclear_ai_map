#!/usr/bin/env python3
"""Build data/tracts.geojson: census tracts in Shelby County, TN and DeSoto County, MS,
with a year-by-year record of each measure used by the map's tract layers and injustice score.

Every value keeps its source year and, where the source gives one, its uncertainty.
Missing values stay missing (null); nothing is filled with zero.

Sources (all public, no API key):
  - Tract shapes: U.S. Census Bureau TIGERweb, 2020 tracts.
  - Race, income, poverty: ACS 5-year table-based summary files, 2017-21 to 2020-24 (2020 tracts).
  - Asthma, cancer, COPD: CDC PLACES, BRFSS data years 2018-2023. Data years 2018-2021 are published
    on 2010 tracts and are carried to 2020 tracts with the Census tract relationship file
    (area-weighted, flagged "approx").

Usage:  python3 tools/build_tracts.py          (downloads are cached in tools/.cache/)
"""
import csv, io, json, os, sys, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, ".cache")
OUT = os.path.join(ROOT, "data", "tracts.geojson")
COUNTIES = {"47157": "Shelby County, TN", "28033": "DeSoto County, MS"}
UA = {"User-Agent": "counter-map-data-build/0.1"}

def fetch(url, name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print("  downloading", name, file=sys.stderr)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r, open(path, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
    return path

def num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if x < -1e5 else x          # ACS uses large negative sentinels for "not available"

# ---------- tract shapes (2020) ----------
def tracts():
    where = " OR ".join(f"(STATE='{c[:2]}' AND COUNTY='{c[2:]}')" for c in COUNTIES)
    url = ("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query?"
           + urllib.parse.urlencode({"where": where, "outFields": "GEOID,NAME,AREALAND", "outSR": 4326,
                                     "f": "geojson", "geometryPrecision": 5}))
    return json.load(open(fetch(url, "tracts_2020.geojson")))

# ---------- ACS 5-year (2020 tracts) ----------
ACS_YEARS = [2021, 2022, 2023, 2024]          # 5-year windows ending in these years
def acs_table(year, table):
    url = f"https://www2.census.gov/programs-surveys/acs/summary_file/{year}/table-based-SF/data/5YRData/acsdt5y{year}-{table}.dat"
    path = os.path.join(CACHE, f"acs_{year}_{table}.dat")
    if not os.path.exists(path):           # stream the national file, keep only our tracts
        os.makedirs(CACHE, exist_ok=True)
        print("  downloading + filtering", os.path.basename(url), file=sys.stderr)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=900) as r, open(path, "w") as f:
            for i, line in enumerate(io.TextIOWrapper(r, encoding="utf-8")):
                if i == 0 or line.startswith(tuple(f"1400000US{c}" for c in COUNTIES)):
                    f.write(line)
    rows = list(csv.DictReader(open(path), delimiter="|"))
    return {r["GEO_ID"][-11:]: r for r in rows}

def acs():
    out = {}
    for y in ACS_YEARS:
        inc, race, pov = acs_table(y, "b19013"), acs_table(y, "b03002"), acs_table(y, "b17001")
        label = f"{y - 4}-{y}"
        for g in inc.keys() | race.keys() | pov.keys():
            o = out.setdefault(g, {})
            i, r, p = inc.get(g, {}), race.get(g, {}), pov.get(g, {})
            tot, blk, wht = num(r.get("B03002_E001")), num(r.get("B03002_E004")), num(r.get("B03002_E003"))
            pu, pb = num(p.get("B17001_E001")), num(p.get("B17001_E002"))
            o.setdefault("income", {})[label] = [num(i.get("B19013_E001")), num(i.get("B19013_M001"))]
            o.setdefault("black_pct", {})[label] = [round(100 * blk / tot, 1) if tot else None, None]
            o.setdefault("white_pct", {})[label] = [round(100 * wht / tot, 1) if tot else None, None]
            o.setdefault("pop", {})[label] = [tot, num(r.get("B03002_M001"))]
            o.setdefault("poverty_pct", {})[label] = [round(100 * pb / pu, 1) if pu else None, None]
    return out

# ---------- CDC PLACES ----------
# release -> (dataset id, BRFSS data year, tract vintage)
PLACES = {2020: ("4ai3-zynv", 2018, 2010), 2021: ("373s-ayzu", 2019, 2010), 2022: ("nw2y-v4gm", 2020, 2010),
          2023: ("em5e-5hvn", 2021, 2010), 2024: ("ai6z-tcin", 2022, 2020), 2025: ("cwsq-ngmh", 2023, 2020)}
MEASURES = {"CASTHMA": "asthma", "CANCER": "cancer", "COPD": "copd"}

def places_release(rel):
    ds, year, vint = PLACES[rel]
    rows = []
    for c in COUNTIES:
        q = urllib.parse.urlencode({"countyfips": c, "$where": "measureid in('CASTHMA','CANCER','COPD')", "$limit": 20000})
        rows += json.load(open(fetch(f"https://data.cdc.gov/resource/{ds}.json?{q}", f"places_{rel}_{c}.json")))
    # Pin the data year: the current-release dataset ids are reused when CDC publishes the next release.
    bad = {r.get("year") for r in rows} - {str(year)}
    if bad:
        sys.exit(f"PLACES {ds}: expected data year {year}, got {bad}. The dataset id may have rolled to a new release.")
    return year, vint, rows

def crosswalk():
    path = fetch("https://www2.census.gov/geo/docs/maps-data/data/rel2020/tract/tab20_tract20_tract10_natl.txt", "tract20_tract10.txt")
    xw = {}
    for r in csv.DictReader(open(path, encoding="utf-8-sig"), delimiter="|"):
        g20 = r["GEOID_TRACT_20"]
        if g20[:5] in COUNTIES:
            xw.setdefault(g20, []).append((r["GEOID_TRACT_10"], float(r["AREALAND_PART"] or 0)))
    return xw

def places():
    xw, out = crosswalk(), {}
    for rel in PLACES:
        year, vint, rows = places_release(rel)
        by = {}
        for r in rows:
            v = num(r.get("data_value"))
            if v is None:
                continue
            by.setdefault(r["measureid"], {})[r["locationid"]] = [v, num(r.get("low_confidence_limit")), num(r.get("high_confidence_limit"))]
        for mid, key in MEASURES.items():
            vals = by.get(mid, {})
            if vint == 2020:
                for g, v in vals.items():
                    out.setdefault(g, {}).setdefault(key, {})[str(year)] = v + ["2020 tracts"]
            else:   # area-weighted from the 2010 tracts that overlap each 2020 tract (land area only)
                for g20, parts in xw.items():
                    parts = [(g10, w) for g10, w in parts if w > 0 and g10 in vals]
                    wsum = sum(w for _, w in parts)
                    if not wsum:
                        continue
                    avg = lambda k: round(sum(vals[g10][k] * w for g10, w in parts) / wsum, 1) if all(vals[g10][k] is not None for g10, _ in parts) else None
                    out.setdefault(g20, {}).setdefault(key, {})[str(year)] = [avg(0), avg(1), avg(2), "approx: from 2010 tracts"]
    return out

def main():
    fc = tracts()
    a, p = acs(), places()
    for f in fc["features"]:
        g = f["properties"]["GEOID"]
        props = {"geoid": g, "name": f["properties"]["NAME"], "county": COUNTIES[g[:5]],
                 "land_sqmi": round(f["properties"]["AREALAND"] / 2589988.11, 2)}
        props.update(a.get(g, {}))
        props.update(p.get(g, {}))
        f["properties"] = props
    fc["properties"] = {
        "built": __import__("datetime").date.today().isoformat(),
        "sources": {
            "shapes": "U.S. Census Bureau TIGERweb, 2020 census tracts",
            "acs": "ACS 5-year table-based summary files B19013, B03002, B17001; values are [estimate, margin of error]",
            "places": "CDC PLACES releases 2020-2025 (BRFSS 2018-2023), crude prevalence [value, low CI, high CI, tract basis]",
        },
        "breaks": {
            "cancer": "Definition changed with data year 2022 (adds melanoma). Do not compare 2021 and earlier with 2022 and later.",
            "places_tracts": "Data years 2018-2021 were modeled on 2010 tracts and are area-weighted onto 2020 tracts here (approximate).",
            "places_model": "PLACES is a small-area model; CDC says it cannot detect effects of local interventions or sources.",
        },
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(fc, open(OUT, "w"), separators=(",", ":"))
    print(f"wrote {OUT}: {len(fc['features'])} tracts, {os.path.getsize(OUT) // 1024} KB")

if __name__ == "__main__":
    main()
