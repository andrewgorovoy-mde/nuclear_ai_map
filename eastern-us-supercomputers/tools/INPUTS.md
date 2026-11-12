# Score input file format

Every scored input is one JSON file in `data/inputs/<id>.json`, built by a script in `tools/` (stdlib Python, downloads cached in `tools/.cache/`, reproducible by re-running).

```json
{
  "id": "pm25_model",
  "label": "Modeled PM2.5, annual mean",
  "category": "air",                 // health | income | noise | air | infrastructure | legal
  "unit": "µg/m³",
  "direction": "higher_worse",       // or "lower_worse"
  "geography": "tract",
  "years": {                         // score years 2019..2026; a year with NO data is simply absent
    "2019": { "47157000100": 8.91, "...": null }   // null = source covers the year but not this tract
  },
  "uncertainty": { "2019": { "47157000100": 0.42 } },   // optional, same shape (SD, MOE or CI half-width; say which in notes)
  "basis": { "2019": "2010 tracts, area-weighted to 2020 (approx.)" },  // optional per-year note
  "source": { "name": "...", "publisher": "...", "url": "...", "tier": "official", "retrieved": "YYYY-MM-DD" },
  "notes": ["Short, plain-language caveats shown to users."]
}
```

Rules
- Tract IDs are 11-digit 2020 GEOIDs from `data/tracts.geojson` (290 tracts: Shelby 47157, DeSoto 28033).
- Never fill, carry forward or interpolate a missing year. Absent year = no data. The score handles gaps.
- Raw values only. Percentiles and weights are computed later; don't normalize.
- 2010-tract sources: carry to 2020 tracts with the Census relationship file
  `https://www2.census.gov/geo/docs/maps-data/data/rel2020/tract/tab20_tract20_tract10_natl.txt`
  (area-weighted by AREALAND_PART), and say so in `basis`.
- Point layers shown on the map (monitors, schools, …) go in `data/<name>.geojson` with dated properties.
- Never write personal data (names, emails, phones) into any output.
