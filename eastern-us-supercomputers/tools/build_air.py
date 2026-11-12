#!/usr/bin/env python3
"""Build the air-pollution inputs for the tract injustice score (format: tools/INPUTS.md).

Writes
  data/inputs/pm25_model.json   CDC/EPA downscaler PM2.5, annual mean of daily tract estimates, 2019-2022
  data/inputs/o3_model.json     CDC/EPA downscaler ozone (daily 8-hr max), annual mean, 2019-2022
  data/air-monitors.geojson     EPA AirData regulatory monitors near Memphis, per-year annual records 2018-2026
  data/inputs/monitor_gap.json  km from each tract to the nearest operating PM2.5 / NO2 / SO2 / O3 monitor, 2019-2025

Sources (all public, no API key):
  - CDC Environmental Public Health Tracking, "Daily Census Tract-Level PM2.5 / Ozone Concentrations"
    (EPA Fused Air Quality Surface downscaler), Socrata on data.cdc.gov. Aggregated server-side with SoQL.
    2016-2020 sets are on 2010 tracts and are carried to 2020 tracts with the Census relationship file
    (area-weighted by AREALAND_PART, same method as build_tracts.py).
  - EPA AirData annual_conc_by_monitor_YYYY.zip and aqs_monitors.zip (NAAQS primary monitor flag).

Monitor value rule: one record per site, pollutant and year, taken from the NAAQS-standard row of the
site's NAAQS-primary POC (flag from aqs_monitors.zip, which reflects CURRENT status). If that POC has no row
in a year, the most complete non-SPM POC is used and the record says "inferred". A more complete
non-primary POC (for example a special-purpose continuous T640/T640X) never replaces the primary.

Usage:  python3 tools/build_air.py          (downloads are cached in tools/.cache/)
"""
import csv, datetime, io, json, math, os, sys, urllib.parse, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, ".cache")
OUT_DIR = os.path.join(ROOT, "data", "inputs")
TRACTS = os.path.join(ROOT, "data", "tracts.geojson")
COUNTIES = {"47157": "Shelby County, TN", "28033": "DeSoto County, MS"}
UA = {"User-Agent": "counter-map-data-build/0.1"}
TODAY = datetime.date.today().isoformat()

def fetch(url, name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print("  downloading", name, file=sys.stderr)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r, open(path + ".part", "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
        os.replace(path + ".part", path)
    return path

def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", os.path.relpath(path, ROOT), file=sys.stderr)

# ---------- tracts ----------
def ring_centroid(ring):
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        c = x0 * y1 - x1 * y0
        a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
    return a / 2, cx, cy

def point_in_ring(x, y, ring):
    inside = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside

def tract_points():
    """GEOID -> (lat, lng, centroid_inside). Area-weighted centroid of all polygon parts (holes subtracted).
    Signed areas are made consistent per ring (outer positive, holes negative)."""
    out = {}
    for f in json.load(open(TRACTS))["features"]:
        g = f["properties"]["geoid"] if "geoid" in f["properties"] else f["properties"]["GEOID"]
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        A = X = Y = 0.0
        for poly in polys:
            for i, ring in enumerate(poly):
                a, cx, cy = ring_centroid(ring)
                s = (1 if i == 0 else -1) * (1 if a > 0 else -1)
                A += s * a; X += s * cx; Y += s * cy
        lng, lat = X / (6 * A), Y / (6 * A)
        inside = lambda x, y: any(point_in_ring(x, y, p[0]) and not any(point_in_ring(x, y, h) for h in p[1:]) for p in polys)
        if inside(lng, lat):
            out[g] = (lat, lng, "centroid")
            continue
        # centroid falls outside an irregular tract: use the midpoint of the widest interior run of the
        # horizontal line through the centroid (a point guaranteed to lie inside the polygon)
        xs = sorted(x0 + (lat - y0) * (x1 - x0) / (y1 - y0)
                    for p in polys for ring in p for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1])
                    if (y0 > lat) != (y1 > lat))
        runs = [(b - a, (a + b) / 2) for a, b in zip(xs[::2], xs[1::2])]
        out[g] = (lat, max(runs)[1], "interior point (centroid outside polygon)")
    return out

def km(lat1, lng1, lat2, lng2):
    p = math.radians
    h = math.sin(p(lat2 - lat1) / 2) ** 2 + math.cos(p(lat1)) * math.cos(p(lat2)) * math.sin(p(lng2 - lng1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))

def crosswalk():
    path = fetch("https://www2.census.gov/geo/docs/maps-data/data/rel2020/tract/tab20_tract20_tract10_natl.txt", "tract20_tract10.txt")
    xw = {}
    for r in csv.DictReader(open(path, encoding="utf-8-sig"), delimiter="|"):
        g20 = r["GEOID_TRACT_20"]
        if g20[:5] in COUNTIES:
            xw.setdefault(g20, []).append((r["GEOID_TRACT_10"], float(r["AREALAND_PART"] or 0)))
    return xw

# ---------- 1. CDC/EPA downscaler (modeled) ----------
# pollutant -> [(dataset, years, ctfips is numeric)]
# Tract vintage is detected per year from the GEOIDs returned: in the 2016-2020 sets, 2016-2019 are on
# 2010 tracts but data year 2020 is already on 2020 tracts (checked 2026-11: 290 of 290 GEOIDs are 2020 tracts).
MODEL = {
    "pm25": {"field": "ds_pm", "sets": [("96sd-hxdt", (2019, 2020), False), ("vpk8-vfhm", (2021, 2022), False)]},
    "o3":   {"field": "ds_o3", "sets": [("hf2a-3ebq", (2019, 2020), True),  ("b72x-p96c", (2021, 2022), False)]},
}
MIN_DAYS = 300      # a tract-year built from fewer daily estimates is treated as missing (null)

def model_year(ds, field, year, numeric):
    """{ctfips(11): (mean, mean_sd, n_days)} for our two counties, aggregated by Socrata."""
    rows = []
    for c in COUNTIES:
        if numeric:     # ctfips and year are number columns in this dataset (leading zero dropped)
            where = f"ctfips between {int(c) * 10**6} and {int(c) * 10**6 + 999999} and year={year}"
        else:
            where = f"starts_with(ctfips,'{c}') and year='{year}'"
        q = urllib.parse.urlencode({"$select": f"ctfips,year,avg({field}_pred) as v,avg({field}_stdd) as sd,count(*) as n",
                                    "$where": where, "$group": "ctfips,year", "$limit": 5000})
        rows += json.load(open(fetch(f"https://data.cdc.gov/resource/{ds}.json?{q}", f"downscaler_{ds}_{year}_{c}.json")))
    out = {}
    for r in rows:
        g = str(int(float(r["ctfips"]))).zfill(11)
        if str(int(float(r["year"]))) != str(year):
            sys.exit(f"{ds}: unexpected year {r['year']}")
        out[g] = (num(r["v"]), num(r["sd"]), int(float(r["n"])))
    return out

def build_model(key, label, unit, tracts):
    spec, xw = MODEL[key], crosswalk()
    t10 = {g10 for parts in xw.values() for g10, _ in parts if g10[:5] in COUNTIES}
    years, unc, basis, short = {}, {}, {}, []
    for ds, yrs, numeric in spec["sets"]:
        for y in yrs:
            raw = model_year(ds, spec["field"], y, numeric)
            if not raw:
                continue
            ids = set(raw)
            if ids <= set(tracts) and len(ids) > len(ids & t10):
                vint = 2020
            elif ids <= t10 and len(ids) > len(ids & set(tracts)):
                vint = 2010
            else:
                sys.exit(f"{ds} {y}: cannot tell tract vintage of {len(ids)} GEOIDs")
            ok = {g: v for g, v in raw.items() if v[0] is not None and v[2] >= MIN_DAYS}
            short += [(y, g, v[2]) for g, v in raw.items() if v[2] < MIN_DAYS]
            vals, sds = {}, {}
            for g20 in tracts:
                if vint == 2020:
                    v = ok.get(g20)
                    vals[g20] = round(v[0], 2) if v else None
                    sds[g20] = round(v[1], 2) if v and v[1] is not None else None
                else:   # area-weighted (land) over the 2010 tracts that overlap this 2020 tract and have a value
                    parts = [(g10, w) for g10, w in xw.get(g20, []) if w > 0 and g10 in ok]
                    ws = sum(w for _, w in parts)
                    vals[g20] = round(sum(ok[g][0] * w for g, w in parts) / ws, 2) if ws else None
                    sds[g20] = round(sum(ok[g][1] * w for g, w in parts) / ws, 2) if ws else None
            years[str(y)], unc[str(y)] = vals, sds
            basis[str(y)] = ("2020 tracts" if vint == 2020 else
                             "2010 tracts, area-weighted (land area) to 2020 tracts with the Census relationship file (approx.)")
            basis[str(y)] += f"; data.cdc.gov {ds}"
    name = "PM2.5" if key == "pm25" else "Ozone"
    notes = [
        "Modeled estimates, not monitor readings: EPA's downscaler fuses air-quality model output with monitor data to estimate each tract's daily level.",
        "Modeled estimates end in 2022; there is no value for 2023-2026 (the source has not been published past 2022).",
        f"Annual mean of all daily estimates for the year ({'daily 24-hour average' if key == 'pm25' else 'daily maximum 8-hour average, all days of the year, not just ozone season'}).",
        "2019 is published on 2010 tracts and was carried to 2020 tracts by land-area weighting, so values are approximate where tracts were split or merged (2020-2022 are published on 2020 tracts).",
        "Uncertainty is the average of the model's daily prediction standard deviations, not the standard error of the annual mean (which would be much smaller).",
        f"Tract-years with fewer than {MIN_DAYS} daily estimates are left null.",
    ]
    if key == "o3":
        notes.append("Units are ppb; EPA monitor files (data/air-monitors.geojson) report ozone in ppm (0.044 ppm = 44 ppb).")
    srcset = ", ".join(s[0] for s in spec["sets"])
    return {
        "id": f"{key}_model", "label": label, "category": "air", "unit": unit, "direction": "higher_worse",
        "geography": "tract", "years": years, "uncertainty": unc, "basis": basis,
        "source": {"name": f"Daily Census Tract-Level {name} Concentrations (EPA downscaler)",
                   "publisher": "CDC National Environmental Public Health Tracking / U.S. EPA",
                   "url": f"https://data.cdc.gov/d/{spec['sets'][1][0]}", "datasets": srcset,
                   "tier": "official", "retrieved": TODAY},
        "notes": notes,
    }, short

# ---------- 2. EPA AirData monitors ----------
AIR_YEARS = list(range(2018, 2027))
PARTIAL_YEARS = {2026}
CENTER = (35.1495, -90.0490)        # downtown Memphis
MAP_RADIUS_KM = 60                  # sites shown on the map
SEARCH_RADIUS_KM = 150              # sites considered for nearest-monitor distance
# key -> (parameter code, pollutant standard used ("" = no NAAQS), metric description)
POLL = {
    "pm25": ("88101", "PM25 Annual 2012", "annual mean of daily (24-hour) values, FRM/FEM"),
    "no2":  ("42602", "NO2 Annual 1971", "annual mean of hourly values"),
    "so2":  ("42401", "SO2 1-hour 2010", "annual mean of daily maximum 1-hour values"),
    "o3":   ("44201", "Ozone 8-hour 2015", "annual (monitoring season) mean of daily maximum 8-hour averages"),
    "hcho": ("43502", "", "annual mean of samples (no NAAQS; air toxic)"),
}
EVENT_PREF = ["Concurred Events Excluded", "Events Excluded", "No Events", "Events Included"]

def airdata_rows(year):
    path = fetch(f"https://aqs.epa.gov/aqsweb/airdata/annual_conc_by_monitor_{year}.zip", f"airdata_annual_{year}.zip")
    z = zipfile.ZipFile(path)
    codes = {p[0] for p in POLL.values()}
    for r in csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8")):
        if r["Parameter Code"] in codes:
            yield r

def monitor_meta():
    """(site, param, poc) -> dict(primary, type, networks, method) from aqs_monitors (current status)."""
    path = fetch("https://aqs.epa.gov/aqsweb/airdata/aqs_monitors.zip", "airdata_monitors.zip")
    z = zipfile.ZipFile(path)
    codes = {p[0] for p in POLL.values()}
    out = {}
    for r in csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8")):
        if r["Parameter Code"] not in codes:
            continue
        site = r["State Code"] + r["County Code"] + r["Site Number"]
        out[(site, r["Parameter Code"], int(r["POC"]))] = {
            "primary": r["NAAQS Primary Monitor"] == "Y", "type": r["Monitor Type"],
            "networks": r["Networks"], "method": r["Last Method"], "last": r["Last Sample Date"]}
    return out

def build_monitors():
    meta = monitor_meta()
    sites, cand = {}, {}            # cand[(site, key, year)][poc] -> best row for that POC
    code2key = {v[0]: k for k, v in POLL.items()}
    for y in AIR_YEARS:
        for r in airdata_rows(y):
            lat, lng = float(r["Latitude"]), float(r["Longitude"])
            d = km(*CENTER, lat, lng)
            if d > SEARCH_RADIUS_KM:
                continue
            site = r["State Code"] + r["County Code"] + r["Site Num"]
            key = code2key[r["Parameter Code"]]
            std = POLL[key][1]
            if std and r["Pollutant Standard"] != std:
                continue
            if not std and r["Sample Duration"] not in ("24 HOUR", "8 HOUR", "3 HOURS", "4 HOUR", "1 HOUR"):
                continue
            s = sites.setdefault(site, {"site_id": site, "name": r["Local Site Name"], "county": f"{r['County Name']}, {r['State Name']}",
                                        "city": r["City Name"], "lat": round(lat, 5), "lng": round(lng, 5), "km_from_memphis": round(d, 1)})
            s["name"] = r["Local Site Name"] or s["name"]
            poc = int(r["POC"])
            slot = cand.setdefault((site, key, y), {})
            prev = slot.get(poc)
            rank = lambda row: (EVENT_PREF.index(row["Event Type"]) if row["Event Type"] in EVENT_PREF else 9)
            if prev is None or rank(r) < rank(prev):
                slot[poc] = r
    records = {}
    for (site, key, y), pocs in cand.items():
        code = POLL[key][0]
        prim = [p for p in pocs if meta.get((site, code, p), {}).get("primary")]
        # The primary flag is current status. If, this year, a now-retired POC with the SAME method as the
        # current primary also reported, the current primary was then most likely the collocated QA sampler
        # (e.g. NCore PM2.5 2018-2020: POC 1 FRM every 3rd day, POC 2 FRM every 6th). Use the one sampling most often.
        older = []
        if prim:
            pm = pocs[prim[0]]["Method Name"]
            plast = meta[(site, code, prim[0])]["last"][:4]
            older = [p for p in pocs if p != prim[0] and pm and pocs[p]["Method Name"] == pm
                     and meta.get((site, code, p), {}).get("last", "9999")[:4] < plast]
        if older:
            poc = max([prim[0]] + older, key=lambda p: (int(pocs[p]["Required Day Count"] or 0), int(pocs[p]["Valid Day Count"] or 0), -p))
            basis = ("inferred: same-method POC sampling most often this year (a since-retired POC was operating, "
                     "so the current primary was likely the collocated sampler)")
        elif prim:
            poc, basis = prim[0], "NAAQS primary monitor (current AQS flag)"
            if any(meta.get((site, code, p), {}).get("last", "9999")[:4] < plast for p in pocs if p != poc):
                basis += "; other since-retired POCs also operated this year, so the primary that year is not certain"
        else:
            ok = [p for p in pocs if meta.get((site, code, p), {}).get("type") != "SPM"] or list(pocs)
            # most valid days; collocated QA samplers (1-in-6/1-in-12 schedule) lose on this naturally
            poc = max(ok, key=lambda p: (int(pocs[p]["Valid Day Count"] or 0), -p))
            basis = ("inferred: most complete non-special-purpose POC (current primary POC has no data this year)"
                     if any(m.get("primary") for (s2, c2, _), m in meta.items() if s2 == site and c2 == code)
                     else "inferred: most complete non-special-purpose POC (no primary flag in AQS)")
            if not POLL[key][1]:
                basis = "no NAAQS; most complete POC"
        r = pocs[poc]
        vd, rd = int(r["Valid Day Count"] or 0), int(r["Required Day Count"] or 0)
        comp = "complete" if r["Completeness Indicator"] == "Y" else ("incomplete" if vd > 0 else "none")
        rec = {"mean": round(float(r["Arithmetic Mean"]), 4 if key in ("o3",) else 3), "unit": r["Units of Measure"],
               "completeness": comp, "valid_days": vd, "required_days": rd, "poc": poc,
               "method": r["Method Name"] or meta.get((site, code, poc), {}).get("method", ""),
               "event_type": r["Event Type"], "primary_basis": basis}
        if key == "o3":
            rec["fourth_max"] = num(r["4th Max Value"])
        if y in PARTIAL_YEARS:
            rec["partial_year"] = True
        others = sorted(p for p in pocs if p != poc)
        if others:
            rec["other_pocs_not_used"] = [{"poc": p, "mean": round(float(pocs[p]["Arithmetic Mean"]), 3),
                                           "valid_days": int(pocs[p]["Valid Day Count"] or 0),
                                           "required_days": int(pocs[p]["Required Day Count"] or 0),
                                           "method": pocs[p]["Method Name"],
                                           "monitor_type": meta.get((site, code, p), {}).get("type", "")} for p in others]
        records.setdefault(site, {}).setdefault(key, {})[str(y)] = rec
    # fill "none" for years a monitored pollutant has no row (inside its site's record span)
    for site, polls in records.items():
        for key, yrs in polls.items():
            for y in AIR_YEARS:
                yrs.setdefault(str(y), {"mean": None, "unit": None, "completeness": "none", "valid_days": 0,
                                        "required_days": None, **({"partial_year": True} if y in PARTIAL_YEARS else {})})
            polls[key] = dict(sorted(yrs.items()))
    return sites, records

def check_monitors(records):
    """Guards for known pitfalls (see module docstring)."""
    nc = records.get("471570075", {}).get("pm25", {}).get("2024")
    if nc and nc["mean"] is not None:
        assert nc["poc"] == 2 and abs(nc["mean"] - 7.75) < 0.05 and nc["completeness"] == "incomplete", \
            f"NCore 2024 PM2.5 should come from FRM POC 2 (7.75, incomplete), got {nc}"

# ---------- 3. monitor gap ----------
GAP_YEARS = list(range(2019, 2026))     # 2026 omitted: Shelby County monitors are not yet in the 2026 file (reporting lag)
GAP_POLL = ["pm25", "no2", "so2", "o3"]

def build_gap(tracts, sites, records):
    years, detail, used = {}, {}, set()
    for y in GAP_YEARS:
        ops = {k: [(s, sites[s]) for s in records if records[s].get(k, {}).get(str(y), {}).get("valid_days", 0) > 0] for k in GAP_POLL}
        for k, lst in ops.items():
            if not lst:
                sys.exit(f"no operating {k} monitor within {SEARCH_RADIUS_KM} km in {y}")
        years[str(y)], detail[str(y)] = {}, {}
        for g, (lat, lng, _) in tracts.items():
            dd = {}
            for k in GAP_POLL:
                best = min(ops[k], key=lambda t: km(lat, lng, t[1]["lat"], t[1]["lng"]))
                dd[k] = round(km(lat, lng, best[1]["lat"], best[1]["lng"]), 2)
                used.add(best[0])
            detail[str(y)][g] = dd
            years[str(y)][g] = round(sum(dd.values()) / len(dd), 2)
    return {
        "id": "monitor_gap", "label": "Distance to nearest regulatory air monitor (mean of PM2.5, NO2, SO2, ozone)",
        "category": "air", "unit": "km", "direction": "higher_worse", "geography": "tract", "years": years,
        "detail": detail,
        "source": {"name": "EPA AirData annual concentration by monitor; aqs_monitors", "publisher": "U.S. EPA",
                   "url": "https://aqs.epa.gov/aqsweb/airdata/download_files.html", "tier": "official", "retrieved": TODAY},
        "notes": [
            "Straight-line km from the tract's center point to the nearest EPA regulatory monitor that reported any valid data for the pollutant that year (complete or not), averaged over PM2.5, NO2, SO2 and ozone. Per-pollutant distances are in 'detail'.",
            "Tract center is the area-weighted centroid of the 2020 tract polygon; where that centroid falls outside an irregular tract, a point inside the tract on the same latitude is used.",
            f"Monitors within {SEARCH_RADIUS_KM} km of Memphis were considered (PM2.5 FRM/FEM 88101, NO2 42602, SO2 42401, ozone 44201).",
            "The only SO2 monitor in the area is the Memphis NCore site, so the SO2 distance is the distance to NCore for every tract.",
            "2026 is omitted: Shelby County's monitors had not yet reported any 2026 data to EPA's AirData files, so a 2026 value would show a false gap.",
        ],
    }, used

# ---------- main ----------
def main():
    tracts = tract_points()
    assert len(tracts) == 290, len(tracts)
    outside = [g for g, t in tracts.items() if t[2] != "centroid"]
    if outside:
        print("  centroid falls outside its polygon:", outside, file=sys.stderr)

    pm, short_pm = build_model("pm25", "Modeled PM2.5, annual mean", "µg/m³", tracts)
    o3, short_o3 = build_model("o3", "Modeled ozone (daily 8-hr max), annual mean", "ppb", tracts)
    for k, s in (("pm25", short_pm), ("o3", short_o3)):
        if s:
            print(f"  {k}: {len(s)} source tract-years under {MIN_DAYS} days, e.g. {s[:3]}", file=sys.stderr)
    write(os.path.join(OUT_DIR, "pm25_model.json"), pm)
    write(os.path.join(OUT_DIR, "o3_model.json"), o3)

    sites, records = build_monitors()
    check_monitors(records)
    gap, used = build_gap(tracts, sites, records)
    write(os.path.join(OUT_DIR, "monitor_gap.json"), gap)

    feats = []
    for sid in sorted(sites):
        s = sites[sid]
        if s["km_from_memphis"] > MAP_RADIUS_KM and sid not in used:
            continue
        props = dict(s)
        props["pollutants"] = records.get(sid, {})
        props["years_partial"] = sorted(str(y) for y in PARTIAL_YEARS)
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [s["lng"], s["lat"]]}, "properties": props})
    write(os.path.join(ROOT, "data", "air-monitors.geojson"), {
        "type": "FeatureCollection",
        "metadata": {
            "source": "U.S. EPA AirData annual_conc_by_monitor_2018..2026.zip and aqs_monitors.zip", "retrieved": TODAY,
            "url": "https://aqs.epa.gov/aqsweb/airdata/download_files.html",
            "notes": [
                f"Regulatory monitors within {MAP_RADIUS_KM} km of downtown Memphis (plus any farther site that is a tract's nearest monitor).",
                "One record per site, pollutant and year from the NAAQS-standard row: PM2.5 'PM25 Annual 2012' (µg/m³), NO2 'NO2 Annual 1971' (ppb), SO2 'SO2 1-hour 2010' (ppb, mean of daily 1-hour maxima), ozone 'Ozone 8-hour 2015' (ppm, mean of daily 8-hour maxima). Formaldehyde has no NAAQS.",
                "The value comes from the site's NAAQS-primary POC (instrument). Other POCs at the site, such as special-purpose continuous T640/T640X monitors, are listed under other_pocs_not_used and never replace it. Where AQS gives events-excluded and events-included rows, the events-excluded row is used (see event_type).",
                "Hernando (DeSoto) PM2.5 comes from a continuous Teledyne T640 monitor (POC 3), which AQS flags as the site's NAAQS-primary monitor; T640s tend to read higher than filter samplers, and a parallel 'corrected' T640 record (POC 23, shown under other_pocs_not_used) runs about 1 µg/m³ lower (2023: 10.6 vs 11.8).",
                "The primary-monitor flag is AQS's current designation; for earlier years where it may have been different, primary_basis says so.",
                "completeness: 'complete' = EPA completeness indicator Y; 'incomplete' = some valid days but below EPA's completeness rule; 'none' = no data that year.",
                "2026 is a partial year (file dated 2026-07-13; Shelby County sites have not reported 2026 data yet).",
            ]},
        "features": feats})

    # ---- sanity printout ----
    for name, obj in (("pm25_model", pm), ("o3_model", o3), ("monitor_gap", gap)):
        for y, v in obj["years"].items():
            vals = [x for x in v.values() if x is not None]
            print(f"  {name} {y}: {len(vals)}/{len(v)} tracts, {min(vals):.2f}-{max(vals):.2f}", file=sys.stderr)
    for g in ("47157980300", "28033070421"):
        print(" ", g, "pm25", {y: pm["years"][y].get(g) for y in pm["years"]}, file=sys.stderr)
        print(" ", g, "o3", {y: o3["years"][y].get(g) for y in o3["years"]}, file=sys.stderr)
        print(" ", g, "gap", {y: gap["detail"][y][g] for y in gap["detail"]}, file=sys.stderr)

if __name__ == "__main__":
    main()
