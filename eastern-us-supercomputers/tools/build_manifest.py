#!/usr/bin/env python3
"""Write data/substations.geojson (OpenStreetMap) and data/inputs/index.json (the list of built score inputs)."""
import json, os, glob, datetime, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, ".cache")

def substations():
    path = os.path.join(CACHE, "osm_power.json")
    if not os.path.exists(path):
        q = '[out:json][timeout:90];(nwr["power"="substation"](34.75,-90.35,35.45,-89.6););out center tags;'
        req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({"data": q}).encode(),
                                     headers={"User-Agent": "counter-map-data-build/0.1", "Accept": "application/json"})
        open(path, "wb").write(urllib.request.urlopen(req, timeout=180).read())
    els = json.load(open(path))["elements"]
    feats = []
    for e in els:
        t = e.get("tags", {})
        if t.get("power") != "substation":
            continue
        lat, lng = (e["lat"], e["lon"]) if "lat" in e else (e["center"]["lat"], e["center"]["lon"])
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lng, 5), round(lat, 5)]},
                      "properties": {"name": t.get("name"), "operator": t.get("operator"), "voltage": t.get("voltage"),
                                     "substation": t.get("substation"), "start_date": t.get("start_date"), "osm": f"{e['type']}/{e['id']}"}})
    out = {"type": "FeatureCollection", "properties": {
        "source": "OpenStreetMap contributors (ODbL), power=substation", "retrieved": datetime.date.fromtimestamp(os.path.getmtime(path)).isoformat(),
        "note": "Present-day locations as mapped by volunteers; most have no build date, so they are shown but not scored."}, "features": feats}
    json.dump(out, open(os.path.join(ROOT, "data", "substations.geojson"), "w"), separators=(",", ":"))
    print(f"  substations: {len(feats)}")

def manifest():
    items = []
    for p in sorted(glob.glob(os.path.join(ROOT, "data", "inputs", "*.json"))):
        if p.endswith("index.json"):
            continue
        d = json.load(open(p))
        items.append({"id": d["id"], "label": d["label"], "category": d["category"], "unit": d["unit"], "direction": d["direction"],
                      "years": sorted(d["years"]), "file": f"data/inputs/{os.path.basename(p)}"})
    json.dump({"built": datetime.date.today().isoformat(), "inputs": items}, open(os.path.join(ROOT, "data", "inputs", "index.json"), "w"), indent=1)
    print(f"  index: {[i['id'] for i in items]}")

if __name__ == "__main__":
    substations()
    manifest()

# ---------- light tract shapes for the map (geometry + GEOID only) ----------
def simplify(pts, tol):
    """Douglas-Peucker on one ring (lng/lat degrees)."""
    if len(pts) < 5:
        return pts
    def d(p, a, b):
        (x, y), (x1, y1), (x2, y2) = p, a, b
        dx, dy = x2 - x1, y2 - y1
        if dx == dy == 0:
            return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
        t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
        return ((x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2) ** 0.5
    keep, stack = {0, len(pts) - 1}, [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        best, k = 0, None
        for m in range(i + 1, j):
            dd = d(pts[m], pts[i], pts[j])
            if dd > best:
                best, k = dd, m
        if k is not None and best > tol:
            keep.add(k); stack += [(i, k), (k, j)]
    out = [pts[i] for i in sorted(keep)]
    return out if len(out) >= 4 else pts

def shapes(tol=0.0001):   # ~10 m
    src = json.load(open(os.path.join(ROOT, "data", "tracts.geojson")))
    feats = []
    for f in src["features"]:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        polys = [[[[round(x, 5), round(y, 5)] for x, y in simplify(r, tol)] for r in p] for p in polys]
        feats.append({"type": "Feature", "properties": {"geoid": f["properties"]["geoid"]},
                      "geometry": {"type": "MultiPolygon", "coordinates": polys}})
    path = os.path.join(ROOT, "data", "tract-shapes.geojson")
    json.dump({"type": "FeatureCollection", "features": feats}, open(path, "w"), separators=(",", ":"))
    print(f"  tract shapes: {os.path.getsize(path) // 1024} KB")

if __name__ == "__main__":
    shapes()
