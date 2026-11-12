#!/usr/bin/env python3
"""Build data/inputs/noise.json: modeled transportation noise (road + rail + aviation) per 2020 census tract.

Source: BTS National Transportation Noise Map, 2020 vintage, as republished by Esri Living Atlas
("USA Transportation Noise - Rail, Road, and Aviation 2020", item 29d9fc21fce543c7a841664945263e00).
The service is TilesOnly (no identify / getSamples / exportImage), so we read its raw cache tiles:
level 11 of the service's own tiling scheme (~30 m pixels, Web Mercator, 256x256 LERC2 float32 tiles,
values = dB(A) 24-hour LAeq). Esri replaced the model's "below 45 dB" NoData with 45.0, so 45 is a
floor meaning "below the modeled threshold", not a measurement.

Per tract (polygons from data/tracts.geojson, 2020 GEOIDs):
  - a pixel belongs to a tract if its center falls inside the tract polygon (even-odd rule);
  - value = energy mean 10*log10(mean(10^(L/10))), with floor pixels counted as 45 dB;
  - detail: share of tract pixels >= 55 dB, >= 65 dB, and at the 45 dB floor.
Pixels are weighted equally (Mercator pixel area varies < 1% across the two counties).
Pixels flagged invalid by the LERC mask are excluded; a tract with no valid pixels gets null.

The data vintage is 2020, so values are written under year "2020" only (no other year is filled).

Not used: CDC EHTN "CONUS_road_and_aviation_noise" (layers 24 MS / 41 TN). Its layer description says the
aviation (AEDT) and road (HPMS/TNM) inventories are for 2014, which is outside the 2019-2026 score years.

Requires numpy and Esri's `lerc` package (pip install lerc numpy). The tiles use LERC2 v6 lossless-float
coding, which is not practical to decode in pure stdlib Python.

Usage:  python3 tools/build_noise.py          (tiles are cached in tools/.cache/noise_tiles/)
"""
import datetime, json, math, os, sys, time, urllib.error, urllib.request

try:
    import numpy as np
    import lerc
except ImportError as e:
    sys.exit(f"build_noise.py needs numpy and lerc ({e}). Install with: pip install lerc numpy")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, ".cache")
TILES = os.path.join(CACHE, "noise_tiles")
TRACTS = os.path.join(ROOT, "data", "tracts.geojson")
OUT = os.path.join(ROOT, "data", "inputs", "noise.json")
UA = {"User-Agent": "counter-map-data-build/0.1"}
SERVICE = ("https://tiledimageservices.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/"
           "USA_Transportation_Noise___Rail_Road_and_Aviation_2020/ImageServer")
ITEM = "https://www.arcgis.com/home/item.html?id=29d9fc21fce543c7a841664945263e00"
LEVEL = 11
FLOOR = 45.0
YEAR = "2020"
DELAY = 0.25            # seconds between uncached tile requests

def get(url, timeout=120):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()

def fetch(url, name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print("  downloading", name, file=sys.stderr)
        data = get(url)
        with open(path, "wb") as f:
            f.write(data)
    return path

# ---------- tiling scheme ----------
def tiling():
    info = json.load(open(fetch(SERVICE + "?f=json", "noise_service.json")))
    ti = info["tileInfo"]
    lod = next(l for l in ti["lods"] if l["level"] == LEVEL)
    assert ti["spatialReference"].get("latestWkid", ti["spatialReference"].get("wkid")) == 3857, ti["spatialReference"]
    return ti["origin"]["x"], ti["origin"]["y"], lod["resolution"], ti["rows"], ti["cols"]

def merc(lon, lat):
    return (lon * 20037508.342789244 / 180,
            math.log(math.tan((90 + lat) * math.pi / 360)) * 6378137)

# ---------- tiles ----------
missing_tiles = []
def tile(row, col):
    """Decoded tile as (float32 array, bool valid mask) or None if the server has no tile."""
    os.makedirs(TILES, exist_ok=True)
    path = os.path.join(TILES, f"{LEVEL}_{row}_{col}.lerc")
    if not os.path.exists(path):
        url = f"{SERVICE}/tile/{LEVEL}/{row}/{col}"
        try:
            data = get(url)
        except urllib.error.HTTPError as e:
            print(f"  tile {row}/{col}: HTTP {e.code}", file=sys.stderr)
            missing_tiles.append((row, col, e.code))
            return None
        time.sleep(DELAY)
        if not data.startswith(b"Lerc2 "):
            print(f"  tile {row}/{col}: not a LERC2 blob ({data[:40]!r})", file=sys.stderr)
            missing_tiles.append((row, col, "not-lerc"))
            return None
        with open(path, "wb") as f:
            f.write(data)
    blob = open(path, "rb").read()
    res = lerc.decode(blob)
    if res[0] != 0:
        raise RuntimeError(f"LERC decode failed for tile {row}/{col}: code {res[0]}")
    arr = np.asarray(res[1], dtype=np.float64)
    m = res[2] if len(res) > 2 else None
    valid = np.ones(arr.shape, bool) if m is None or getattr(m, "size", 0) == 0 else np.asarray(m).astype(bool)
    return arr, valid

def mosaic(r0, r1, c0, c1, n_rows, n_cols):
    H, W = (r1 - r0 + 1) * n_rows, (c1 - c0 + 1) * n_cols
    val = np.full((H, W), np.nan)
    ok = np.zeros((H, W), bool)
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            t = tile(r, c)
            if t is None:
                continue
            a, v = t
            sl = (slice((r - r0) * n_rows, (r - r0 + 1) * n_rows), slice((c - c0) * n_cols, (c - c0 + 1) * n_cols))
            val[sl], ok[sl] = a, v
    return val, ok

# ---------- point in polygon (even-odd over all rings, so holes are handled) ----------
def inside(px, py, rings):
    res = np.zeros(px.shape, bool)
    for ring in rings:
        xs, ys = ring[:, 0], ring[:, 1]
        x2, y2 = np.roll(xs, -1), np.roll(ys, -1)
        for xa, ya, xb, yb in zip(xs, ys, x2, y2):
            if ya == yb:
                continue
            cond = (ya > py) != (yb > py)
            xi = xa + (py - ya) * (xb - xa) / (yb - ya)
            res ^= cond & (px < xi)
    return res

def main():
    ox, oy, res, n_rows, n_cols = tiling()
    feats = json.load(open(TRACTS))["features"]
    tracts = []
    for f in feats:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        rings = [np.array([merc(lon, lat) for lon, lat in ring[:-1]]) for poly in polys for ring in poly]
        tracts.append((f["properties"]["geoid"], rings))
    allx = np.concatenate([r[:, 0] for _, rs in tracts for r in rs])
    ally = np.concatenate([r[:, 1] for _, rs in tracts for r in rs])
    # global pixel indices (column from origin x, row from origin y downward)
    gc0, gc1 = int((allx.min() - ox) // res), int((allx.max() - ox) // res)
    gr0, gr1 = int((oy - ally.max()) // res), int((oy - ally.min()) // res)
    r0, r1, c0, c1 = gr0 // n_rows, gr1 // n_rows, gc0 // n_cols, gc1 // n_cols
    print(f"tiles rows {r0}-{r1}, cols {c0}-{c1}: {(r1-r0+1)*(c1-c0+1)} tiles", file=sys.stderr)
    val, ok = mosaic(r0, r1, c0, c1, n_rows, n_cols)
    base_r, base_c = r0 * n_rows, c0 * n_cols

    def sample(lon, lat):
        x, y = merc(lon, lat)
        return float(val[int((oy - y) // res) - base_r, int((x - ox) // res) - base_c])

    values, detail, npix = {}, {}, {}
    for geoid, rings in tracts:
        xs = np.concatenate([r[:, 0] for r in rings]); ys = np.concatenate([r[:, 1] for r in rings])
        a0, a1 = int((xs.min() - ox) // res), int((xs.max() - ox) // res)
        b0, b1 = int((oy - ys.max()) // res), int((oy - ys.min()) // res)
        cols = np.arange(a0, a1 + 1); rows = np.arange(b0, b1 + 1)
        PX, PY = np.meshgrid(ox + (cols + 0.5) * res, oy - (rows + 0.5) * res)
        m = inside(PX, PY, rings)
        sub_v = val[b0 - base_r:b1 - base_r + 1, a0 - base_c:a1 - base_c + 1]
        sub_ok = ok[b0 - base_r:b1 - base_r + 1, a0 - base_c:a1 - base_c + 1] & ~np.isnan(sub_v)
        L = sub_v[m & sub_ok]
        npix[geoid] = (int(m.sum()), int(L.size))
        if L.size == 0:
            values[geoid] = None
            continue
        Lc = np.maximum(L, FLOOR)
        values[geoid] = round(float(10 * np.log10(np.mean(10 ** (Lc / 10)))), 2)
        detail[geoid] = {"p55": round(float(np.mean(L >= 55)), 4),
                         "p65": round(float(np.mean(L >= 65)), 4),
                         "floor_share": round(float(np.mean(L <= FLOOR + 1e-3)), 4)}

    # ---------- checks printed to stderr ----------
    got = [v for v in values.values() if v is not None]
    print(f"tracts: {len(values)}, with value: {len(got)}, null: {len(values) - len(got)}", file=sys.stderr)
    print(f"energy-mean dB range {min(got):.2f} - {max(got):.2f}", file=sys.stderr)
    small = sorted(npix.items(), key=lambda kv: kv[1][0])[:3]
    print("fewest pixels:", small, file=sys.stderr)
    partial = {g: n for g, n in npix.items() if n[1] < n[0]}
    if partial:
        print("tracts with some invalid/missing pixels:", partial, file=sys.stderr)
    print(f"  probe Memphis International runway (-89.9767, 35.0424): {sample(-89.9767, 35.0424):.1f} dB", file=sys.stderr)
    for g in ("47157980300", "28033070421"):
        print(f"  {g}: {values.get(g)} {detail.get(g)} pixels={npix.get(g)}", file=sys.stderr)
    top = sorted(((v, g) for g, v in values.items() if v is not None), reverse=True)[:5]
    print("top 5:", top, file=sys.stderr)
    if missing_tiles:
        print("missing tiles:", missing_tiles, file=sys.stderr)

    out = {
        "id": "noise",
        "label": "Modeled transportation noise (road, rail, aviation)",
        "category": "noise",
        "unit": "dB(A), 24-hour LAeq, energy mean",
        "direction": "higher_worse",
        "geography": "tract",
        "years": {YEAR: dict(sorted(values.items()))},
        "detail": {YEAR: dict(sorted(detail.items()))},
        "basis": {YEAR: ("2020 tracts; BTS 2020 noise raster (~30 m) sampled at pixel centers inside each tract "
                         "polygon, energy-averaged; pixels weighted equally")},
        "source": {"name": "National Transportation Noise Map 2020 (road, rail and aviation combined)",
                   "publisher": "U.S. DOT Bureau of Transportation Statistics; Esri Living Atlas tile copy",
                   "url": ITEM, "service": SERVICE, "tier": "official",
                   "retrieved": datetime.date.today().isoformat()},
        "notes": [
            "Transportation noise only (road, rail, aviation). It cannot capture gas-turbine, generator or other industrial noise.",
            "Modeled, not measured. BTS says to use this map for trends and comparisons, not to judge noise at individual locations.",
            "45 dB is the model floor: Esri set areas below the modeled threshold to 45, so 45 means 'below threshold', not a reading. Floor pixels are counted as 45 in the average.",
            "Tract value is the energy mean, 10*log10(mean(10^(dB/10))), which weights loud pixels more than a plain average of dB.",
            "detail gives each tract's share of area at or above 55 dB (p55), at or above 65 dB (p65), and at the 45 dB floor (floor_share).",
            "Data year is 2020 only; other years have no value. Tract area includes any river or water inside the tract boundary.",
        ],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print("wrote", OUT, file=sys.stderr)

if __name__ == "__main__":
    main()
