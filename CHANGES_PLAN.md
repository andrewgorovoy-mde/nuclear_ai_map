# Counter Map: change plan from the Nov 3 handoff

Source: `~/Downloads/counter_map_handoff/` (README, one-page PDF, `data/`, `schema/`, workbook v7), checked against the current code in `eastern-us-supercomputers/` (explore.html, story/*.js, *.geojson).

Line numbers refer to the current commit (`a1eb7cf`).

---

## 0. Answers we can already give the researchers (README §5)

The code answers most of the "ask the builder" questions. Send these back and close the gaps in `sources.csv` (I-01, I-02, I-03, E-01, E-03, E-04).

| Question | Answer from the code |
|---|---|
| Source of "Satellite patches around generation" | Esri World Imagery tiles (Esri, Vantor, Earthstar Geographics), masked into blobs around plants and sites. No analysis is done; it is basemap imagery. The imagery date is whatever Esri's current mosaic shows (explore.html:1522–1600). |
| Plants dataset | EIA-860 2025 (operable and retired generators). Emissions come from EPA Clean Air Markets Program Data, 2025 annual (tva-plants-timeline.geojson). |
| Transmission lines dataset | HIFLD Electric Power Transmission Lines. Years come from OpenStreetMap (ODbL) or are estimated. **The HIFLD copy and its download date are not recorded; record them.** |
| The "Under 100 kV" class | In the data, 869 lines are 69 kV, 3 are 46 kV and 417 have no voltage. The researchers' guess is right: it is effectively 69 kV. |
| Air monitors dataset | EPA AirData `annual_conc_by_monitor_2025`, 53 monitors |
| TVA boundary origin | The file property says "Tennessee Valley Authority, TVA_Power_Service_Area (2016-12-08)". Drop the 84 FR 48982 citation from the deck. |
| How line build years were estimated | renderNote() at explore.html:1117–1125. A line counts as in service once both of its ends exist; branch lines take the era of nearby lines; no estimate goes earlier than a floor year per voltage class. Method codes are 0–3 (YEAR_SOURCE at 854–859). |
| "2025 Loading…" | This is the timeline stats placeholder (explore.html:654–655), not the air layer. |
| Is the noise layer BTS 2022? | Yes. It is `NTAD_Noise_2022_CONUS_aviation_rail_road` (explore.html:1380). |

---

## P0: before anything is public

### 1. Status, tier and provenance on every item
- Add a shared record model (fields from `schema/record_schema.json`): `status`, `tier`, `as_of`, `verified_on`, `source_url`, `source_read`, and `geometry_precision` / `privacy` where relevant.
- Write one popup helper (`provenanceRow(rec)`) that renders a status chip ("alleged", "permitted", "regulator-stated", "ruled", …), the tier, an "as of" date and a source link. Add a muted "excerpt-level" flag when `source_read !== "full"`.
- Apply it to:
  - xAI turbine and Colossus 2 popups: `XAI_SITES`, explore.html:1207–1239
  - the site cards in `SITES` (673–716)
  - plants, lines, air monitors and counties. These get dataset-level provenance: tier Official, the data year, and the source.
- Mark derived numbers as Derived:
  - estimated line years (already faded; the popup should say "estimated")
  - `n × 25.7 MW` (layers.js:379)
  - `XAI_PEAK_GW = 1.775` (explore.html:1103)
  - the story's NOx glow (layers.js:416–437)
  - the ring3mi race shares (layers.js:388)

### 2. Correct claims in the code that conflict with the handoff
| Where | Now | Change to |
|---|---|---|
| explore.html:1216 | "3 in Aug 2025, 27 by Dec 2025, 69 … by Jul 2026" | "18 by Aug 29, 2025; 27 by Jan 6, 2026; 69 by Jul 15, 2026 (MDEQ Agreed Order, App. A)" |
| layers.js:102–105 `SOUTHAVEN` | `[2025.58,3]`, `[2026.36,46]`, `[2026.45,57]` … `[2026.66,58]` | Use the Appendix A snapshots: 18 (Aug 29, 2025), 27 (Jan 6, 2026), 51 (May 2), 58 (May 9), 60 (Jun 12), 69 (Jul 15). Show 46 and 59 only as dated press reports. Drop the post-retirement 58 unless it is sourced (see the "11 shut down Aug 31, 2026" row). |
| layers.js:102 `LOWRY` | `[2025.45,26]` | No 26 appears in the handoff. Source it or remove it. Keep 16 (Aug 2024, alleged), 35 (Mar 31 / Apr 9, 2025, alleged / observed) and 15 (Jul 2, 2025, permitted). |
| explore.html:1218 | "11 shut down Aug 31, 2026" | Not in the handoff. Find a source or remove it. |
| explore.html:1219 | "NAACP v. xAI … pending" | "Filed Apr 14, 2026 (3:26-cv-00074). DOJ's motion to dismiss denied Oct 19; xAI's motion to dismiss denied Oct 30. No finding of liability; injunction ruling pending." |
| chapters.js:267 | "In June the Justice Department moved … As of October 2026 the case is unresolved." | Add the Oct 19 and Oct 30 rulings, using the same wording as the row above. |
| chapters.js:280 | "35 turbines … 1,200–2,000 tons of NOx" (SELC) | Separate the two sites. Colossus 1: 35 alleged. Southaven: the complaint *alleges* a potential to emit about 1,700 t/yr NOx from 27 turbines. Label it as an allegation. |
| explore.html:1217 | 41-turbine permit, "under appeal" | Keep it, and add "SELC appealed Apr 9, 2026". |
| explore.html:1218 / chapters.js:250 | MDEQ "let them run … as mobile" | Add that MDEQ and MZX agree there was no *state* violation; the federal court held at the dismissal stage that the turbines are not mobile sources. Do not present this as settled law. |
| chapters.js:286 ("hum") | TV-crew and resident dB readings | Label them "informal readings, not calibrated measurements". |
| story/README.md:7 | "open story.html" | "open index.html" |

### 3. Relabel the noise layer
- explore.html:637: "Transportation noise, 2022" → "Transportation noise only (road, rail, air) · 2022".
- Legend (638–642): add the line "Does not model turbines or industrial noise."
- layers.js:509–511 (story noiseTiles): use the same caveat in the attribution and the on-map label.

### 4. Privacy guardrails
- Colonial Hills buyouts are not on the map yet. If they are added, use a neighborhood polygon only, with `privacy: aggregate_only`. Do not use parcels, sellers or addresses.
- Add a short code comment or constants list: "do not ship" (parcel purchases, plaintiffs, Cherokee sites without consent).
- The "Add a record" form collects a free-text **Name**. Make it opt-in, default to anonymous, and never show it in public popups until moderation exists.
- Review the named testimonies (chapters.js:42–73). They are published quotes, but confirm none of these people is a plaintiff in Haley or NAACP before launch.

### 5. "Add a record": make it real or relabel it
- Today it saves only to localStorage (`counter-map-records`, explore.html:1604–1684), so nobody else sees the records.
- **Minimum before launch:** change the note to "Private notes, saved only in this browser", and keep the word "community" off it.
- **Real version (needs a backend decision, see the questions below):**
  - shared storage
  - submit → pending → approved moderation
  - provenance fields: who (optional), when observed, how measured, device
  - a consent checkbox and an anonymity option
  - takedown requests
  - CSV/GeoJSON export that carries provenance
  - stored records follow `record_schema.json` with `layer: "community"`, `tier: "self_reported"`

---

## P1: next release

### 6. Decisions layer (new)
- Load `data/events.json` (23 events) as `decisions.json`. Put pins at site locations, or show it as a timeline strip when there is no geometry.
- Filter by type and by jurisdiction (TVA, Mississippi, Shelby County/TN, federal court).
- **Data prep needed:** events.json has no `jurisdiction` field. Derive one from `actor`. It also needs `tier`, `source_read` and `verified_on`.
- Hook into the explorer timeline (`setYear`, explore.html:1143–1154). This requires extending `TL.end` past 2025 (see item 13).

### 7. Turbine layer with a time slider
- Replace the hard-coded counts with `turbine_counts.json`, keeping two series: Southaven (Appendix A snapshots) and Colossus 1.
- Draw press figures (46, 59) as dated callouts, not as points on the series. Each popup shows the count, the snapshot date and the status.
- **Data prep needed:** turbine_counts lacks the May 9 (58) and Jul 15 (69) snapshots that the README cites. Its 69 is dated Jul 30, the order date. Add both rows. Optionally add the retirement schedule (Aug 18, 2026 → Jul 14, 2027; 13 SMT-130 units run to Dec 31, 2026) so the slider shows the count going down.

### 8. People layer at block-group level
- The story already uses tracts (story/data/tracts-memphis.geojson, ACS B03002). Rebuild it at block group for Boxtown/SW Memphis and Southaven from ACS 2020–2024.
- Show margins of error in popups.
- Add a flag where homes may be changing hands (neighborhood scale only).
- Reproduce the Reuters 5-mile figures and cite the table. Remove any ZIP-code claims (none found in the code today).

### 9. Jurisdiction overlay and "who has authority"
- Add layers for state, county, city (Memphis, Southaven) and the TVA area (already present).
- Add an `authority` field per facility: TVA board (power); MDEQ / Permit Board (Southaven); Shelby County Health Dept / APCB (Colossus 1); federal court and DOJ (CAA). MLGW and TDEC say they have no authority (excerpt-level).

### 10. Environment additions
- Kingston coal-ash spill (Dec 22, 2008, about 5.4 M yd³) and Allen ash ponds (arsenic 2017; aquifer link disputed). The plant points exist already; add an event/site layer with dates.
- Oak Ridge Reservation NPL boundary (listed Dec 21, 1989) from EPA. The story's ellipse (layers.js:144) stays labeled "approximate".
- Air monitors: add the distance from each Shelby/DeSoto monitor to the nearest turbine site in its popup.
- USGS Memphis-aquifer wells from SIM 3415 table 1 (the DeSoto and Shelby wells nearest the sites).
- `sites.csv` has no coordinates. Geocode and verify them by hand.

### 11. "About this data" panel
- The current panel (explore.html:664–667, renderNote) covers only plants and lines. Expand it to list every layer, generated from a `sources.json` built out of `data/sources.csv`. Each entry gets publisher, link, data year, tier and known caveats.
- Add the satellite-patch source (see section 0) and the noise caveat.

---

## P2: later

12. Water layer (aquifer, permit SOP-24025, MLGW sales), once the records requests return.
13. Extend the timeline and Replay past 2025:
    - `TL.end`: explore.html:836 and 984; slider max at 661; eyebrow at 559
    - the "Replay 1910–2025" chip: chapters.js:33
14. Export sheets that carry provenance and "verified on" dates.
15. Cherokee town sites (Chota, Tanasi): only with consent from the Eastern Band. Nothing is cleared yet.

---

## Fixes to send back to the research package

- `turbine_counts.*`: add the May 9 (58) and Jul 15 (69) Appendix A rows. Its 69 is dated Jul 30 (the order date).
- `decisions_timeline.csv` / `events.json`:
  - The Jul 30, 2026 row still says "order not read", but citation #22 says it was read in full.
  - Add a `jurisdiction` field.
- `sources.csv` D-04 says "Home purchases near **Colossus 2**". Colossus 2 is in Whitehaven, TN; the purchases are in Colonial Hills, Southaven, near the plant.
- `verified_on` is empty on every row.
- Section 0 answers close gaps 8 and 10, and open question I-01 (the boundary is TVA 2016-12-08; drop the FR citation).

## Decisions needed from you

1. **Backend for shared records:**
   - Vercel plus a hosted database (e.g., Neon Postgres or Upstash)
   - a form service
   - or keep records local and relabel them for now
2. **Scope of the first pass:** P0 only, or P0 plus the Decisions and turbine layers.
3. **Unsourced figures** (Colossus "26", "11 shut down Aug 31, 2026", the post-retirement 58, the 1.775 GW peak): do you have sources, or should they be removed?
