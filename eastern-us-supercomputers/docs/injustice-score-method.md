# Injustice score and tract layers: data inventory and proposed method

Method decisions recorded Nov 11, 2026. Area: the 290 census tracts (2020 boundaries) in Shelby County, TN and DeSoto County, MS.
Exposure start dates differ by site: Colossus 1 (Memphis) mid-2024; xAI turbines in Southaven about Aug 2025.

## 1. What data exists, by layer

"Post" means a data year after the site's exposure start. Everything listed was fetched and checked unless marked otherwise.

| Layer | Best public source | Geography | Years (baseline → post) | Post-exposure data? | Notes |
|---|---|---|---|---|---|
| Asthma | CDC PLACES (BRFSS model) | Tract | 2018–2023 | **No** | Modeled, with confidence intervals. CDC: cannot detect local effects. 2018–21 carried from 2010 tracts (approx.). |
| Cancer | CDC PLACES | Tract | 2018–2023 | **No** | Definition changed in 2022 (adds melanoma): two separate series, never one trend. |
| COPD (added) | CDC PLACES | Tract | 2018–2023 | **No** | Same caveats as asthma. |
| ER visits (asthma) | CDC Tracking Network (TN hospital data) | Tract, Shelby only | 2012–16 … 2015–19 | **No** | No public data for DeSoto at any level. Newer data only via paid data-use agreements (TN, MS, HCUP). |
| Stand-in: school chronic absenteeism | TN Dept. of Education; MS Report Card | School points | TN 2018-19 → 2024-25; MS → 2025-26 | **Yes**, both sites | Weak, confounded proxy (asthma is one cause of absence among many). Only health-adjacent series that varies within a county after exposure. |
| Stand-in: respiratory deaths, preterm birth | CDC WONDER (provisional), MSDH, March of Dimes | County | → 2024 (MSDH, PeriStats); WONDER → 2025–26 (not yet pulled) | WONDER only | County-level: the same value for every tract, so county trend panel only, not in the tract score. WONDER county queries require accepting CDC's data-use agreement. |
| Race | ACS 5-year | Tract | 2017–21 … 2020–24 | Barely (2020–24 includes a few post months) | Shown, **not in the score**. |
| Income / poverty | ACS 5-year | Tract | 2017–21 … 2020–24 | Barely | Margins of error are large at tract level; shown with each value. |
| Air: modeled PM2.5, ozone | CDC/EPA downscaler | Tract | 2018–2022 | **No** | 2023 onward drawn as "no modeled estimate", never carried forward on the air layer itself. |
| Air: regulatory monitors | EPA AirData | Points | 2018–2025 (2026 preliminary) | Yes, but far away | Nearest monitor 14.5 km from Colossus 1, 18.6 km from Southaven. No NO2, SO2, formaldehyde or PM2.5 monitor near either site. |
| Air: monitoring gap | Derived from EPA monitor list | Tract | 2018–2025 | Yes | Distance from each tract to the nearest working monitor, per pollutant and year. |
| Air: NO2 from satellite (TROPOMI) | ESA / NASA | ~5 km grid | 2018 → present | **Yes** | Only continuous before/after air source. Column NO2, not ground level. Needs a free NASA Earthdata login. |
| Air: community sensors | MCAP / CEEJH PurpleAir, SCHD South Memphis station | Points | 2025–26 | Yes | Non-regulatory, disputed by SCHD. Separate toggle, labeled. PurpleAir history needs an API key. |
| Air: City of Memphis tests, Jun 2025 | City of Memphis | 3 points, 1 day each | 2025 | — | All "not detected", but detection limits far above normal outdoor levels. Shown with that caveat. |
| Noise | BTS / Esri transportation noise model | 30 m grid | 2016, 2020 (values); 2018, 2022 (tiles only) | **No** for turbines | Road, rail, air only; cannot show turbine noise. Values ≤45 dB mean "below model threshold". |
| Noise: turbines | Haley v. X.AI complaint | Points | 2026 | Alleged | Behind a court login; press figures conflict. |
| Turbines | xAI record (MDEQ order, complaint, permits) | Points | Aug 2024 → Jul 2026, dated | **Yes** | Already on the map. |
| Generation sites | EIA-860 | Points | Operating and retirement years | Yes | Allen, TVA Southaven CC, solar farms. |
| Substations | OpenStreetMap | Points | Today only (25 of 135 dated) | — | Present-day locations, labeled as such. |
| Powerlines / transmission | HIFLD + OSM years | Lines | Build years (partly estimated) | Yes | Already on the map. |
| Permits and decisions | Our decisions record | Points (3 sites) | Nov 2024 → Oct 2026, dated | **Yes** | Icons by type: permit, appeal, lawsuit, ruling, injunction motion. |
| Authority | Census TIGERweb | Lines | Current | — | Shown, not in the score. |
| Testimonies | Users' notes; future published testimony | Points | — | — | Shown, not in the score. |

## 2. Score method (as built)

**Unit and years.** One score per tract per year, 2019 through 2026, on 2020 tracts.

**Components** (race, authority and testimonies excluded, as specified):

| Category | Inputs | Direction |
|---|---|---|
| Health | Asthma, cancer, COPD (PLACES); asthma ER (Shelby, 2015–19); school chronic absenteeism minus the county average that year, from schools within 8 km in the same state, inverse-distance weighted | Higher = worse |
| Income | Median household income in 2024 dollars (BLS CPI-U), poverty rate | Lower income / more poverty = worse |
| Noise | Transportation noise, tract mean dB | Louder = worse |
| Air | Modeled PM2.5 and ozone; satellite NO2 (if enabled) | Higher = worse |
| Infrastructure proximity | Fossil capacity (coal, gas, oil, other) online that year, including xAI turbines, weighted by distance: weight = e^(−d / 2 km), and exactly zero beyond 8 km (5 mi). xAI turbines: highest count recorded in the year, or the most recent earlier record if none (a permit counts as its permitted units), times the average unit size. Substations and transmission lines are shown but **not scored**: almost none have dates, so they can't be placed in time | Closer and larger = worse |
| Legal activity | Events at each site from their date onward, weighted by type and by distance from the site: weight = e^(−d / 5 km), zero beyond 15 km. Injunction motions and rulings count 3; lawsuits, court filings and rulings, notices of intent to sue and appeals count 2; permits, applications, hearings, orders and votes count 1. Events tied to no site and property purchases are not counted | More and closer = worse |

**Scaling: ranked across all years together.** Each input is converted to a percentile against every tract in every year from 2019 to 2026 combined: the share of all tract-years with a strictly less burdened value (0 = least burdened, 100 = most). Ties get the same rank, and a value of zero (for example, no plant within 8 km) ranks 0. Cancer is ranked separately within 2019–2021 and within 2022–2023 because its definition changed. Ranking all years together means a tract's score can rise over time, for example when turbines arrive nearby. Ranking each year separately would hide that. Inputs in a category are averaged, and categories are combined with the user's slider weights (default equal). The result is a 0–100 score that says how a tract-year compares with all tract-years in the two counties. It is not an absolute measure of harm.

**Missing data counts as a burden (decided Nov 11, 2026).**
- No value is ever carried forward or filled in. A 2023 asthma estimate is never shown as 2025 data.
- An input with no data for a tract in a year gets a fixed "data gap" score. Its own slider runs from 50 to 100; the default is 75 (worse than typical).
- This applies to the years after a source stops: health and modeled air after 2023/2022, ER visits after 2019. It also applies to tracts the source never covers, such as DeSoto County for ER visits.
- The tract details and the PDF list every input, either with its value and data year or as "no data: scored as gap (75)".

**Tracts with no residents are not scored.** Tracts with fewer than 100 residents (ACS 2020–2024) are left out of the ranking and the score and drawn as "no residents": 47157980100, 47157980200, 47157980300 (Colossus 1's own tract) and 47157980402.

**Reading the score over time.** Because gaps count as burden, a year can look better or worse just because a source reported or stopped reporting (noise exists only for 2020, ER visits only for 2019, health through 2023). The tract details and PDF mark every category in every year as measured or gap, and the map also reports the county-wide average with gaps left out, so readers can see what actually changed.

**Air monitoring gap is scored (decided Nov 11, 2026).** Distance from the tract to the nearest working regulatory monitor, per pollutant (PM2.5, NO2, SO2, ozone) and year, is an input in the Air category. Farther means worse.

**School absenteeism is scored at a low default weight (decided Nov 11, 2026).** It counts within Health at a quarter of the weight of the other health inputs: each school's rate minus its county's average that year, averaged over schools within 8 km in the same state (closer schools count more). Tennessee and Mississippi are never mixed. School years count in the year they end; 2019-20 and 2020-21 are left out (COVID). Tennessee has no 2025-26 data yet and Mississippi has none for 2024-25 at school level, so in those years that state's tracts score as a gap.

**Shown with the score, every time:** the weights used, the data year behind every input, and a statement that the score is a screening index built from public data, not a finding of harm or liability.

**Optional:** a disparity readout that shows the average score by tract racial makeup (race is shown alongside, not used to compute the score). Useful for disparate-impact arguments; off unless wanted.

## 3. Access being set up (only the project owner can do these)
- **NASA Earthdata login** (free): satellite NO2, 2018 to present. Strongly recommended.
- **CDC WONDER**: county respiratory deaths and preterm births through 2025–26 require accepting CDC's data-use agreement in the browser.
- **PurpleAir API key**: sensor history near both sites.
- **CourtListener / PACER login**: the Haley noise complaint and other filings.
- **Data requests** (slow, may cost money): TN Dept. of Health and MS State Dept. of Health hospital discharge and ER data.
