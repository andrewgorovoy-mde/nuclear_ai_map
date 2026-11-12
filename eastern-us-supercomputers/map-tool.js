// =====================================================================================
//  MAP TOOL — view state in the URL, and PDF exhibits built from the layers that are on.
//  Loaded after the inline script in explore.html and shares its globals (map, xr, TL, …).
//  The PDF is the browser's own "Save as PDF" of a print sheet laid out at true page size,
//  so the map on screen is exactly the map on paper.
// =====================================================================================
(() => {
  const $ = id => document.getElementById(id);
  const chk = id => $(`toggle-${id}`)?.checked;
  const TOGGLES = ["tva", "xai", "plants", "lines", "substations", "counts", "decisions", "juris", "c3", "air", "monitors", "noise", "schools", "ash", "wells", "sat"];
  const GRID_LAYERS = ["plants", "lines", "sat"];          // drawn for the grid year (timeline)
  const RECORD_LAYERS = ["counts", "decisions"];           // drawn for the xAI-record month

  // ---------- URL state ----------
  // #v=zoom/lat/lng&on=tva,xai&y=1990&m=2026-11&county=inc&air=pm&xt=solar&xj=federal&dv=2026-11-11
  const enc = v => encodeURIComponent(v).replace(/%2C/g, ",").replace(/%2F/g, "/");
  function stateParams() {
    const c = map.getCenter();
    const p = {
      v: `${+map.getZoom().toFixed(2)}/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}`,
      on: TOGGLES.filter(chk).join(","),
      y: TL.on ? TL.year : "",
      m: XR_MONTHS[xr.i],
      county: $("county-var").value,
      bg: $("bg-var").value,
      air: chk("air") ? $("air-var").value : "",
      xt: [...document.querySelectorAll("#plant-types input:not(:checked)")].map(b => b.dataset.type).join(","),
      xj: [...document.querySelectorAll("#xr-juris input:not(:checked)")].map(b => b.dataset.juris).join(","),
      // Tract layers and score: year, layer shown, category weights (score order), missing-data value.
      ty: SCORE.S.year,
      tv: SCORE.S.view,
      w: Object.keys(SCORE.CATS).map(c => SCORE.S.weights[c]).join(","),
      gap: SCORE.S.gap,
      dv: DATA_VERSION
    };
    return Object.entries(p).filter(([k, v]) => k === "on" || (v !== "" && v != null)).map(([k, v]) => `${k}=${enc(v)}`).join("&");
  }
  const viewUrl = () => `${location.origin}${location.pathname}#${stateParams()}`;
  let restoring = true, hashTimer = null;
  function writeHash(now) {
    if (restoring) return;
    clearTimeout(hashTimer);
    const go = () => history.replaceState(null, "", `#${stateParams()}`);
    now ? go() : (hashTimer = setTimeout(go, 250));
  }
  map.on("moveend", () => writeHash());
  document.querySelector(".panel").addEventListener("change", () => writeHash());
  $("xr-range").addEventListener("input", () => writeHash());
  document.addEventListener("score:change", () => writeHash());
  // Grid year: wrap the inline script's setYear/setMode (global function declarations).
  const _setYear = window.setYear, _setMode = window.setMode;
  window.setYear = y => { _setYear(y); writeHash(); };
  window.setMode = on => { _setMode(on); writeHash(); };

  const until = (cond, ms = 15000) => new Promise(res => {
    const t0 = Date.now();
    (function poll() { cond() || Date.now() - t0 > ms ? res(cond()) : setTimeout(poll, 100); })();
  });
  const fire = (el, type = "change") => el.dispatchEvent(new Event(type, { bubbles: true }));

  async function restore() {
    const q = new URLSearchParams(location.hash.slice(1));
    if (!location.hash.slice(1)) return q;
    const v = (q.get("v") || "").split("/").map(Number);
    if (v.length === 3 && v.every(Number.isFinite)) {
      autoFit = false;
      map.setView([v[1], v[2]], v[0], { animate: false });
    }
    if (q.has("air")) { $("air-var").value = q.get("air"); fire($("air-var")); }
    if (q.has("on")) {
      const on = new Set(q.get("on").split(",").filter(Boolean));
      // Coal ash sits on plant locations: wait for the plants before switching anything on.
      await until(() => plants.length > 0);
      TOGGLES.forEach(id => {
        const box = $(`toggle-${id}`);
        if (box && !box.disabled && box.checked !== on.has(id)) { box.checked = on.has(id); fire(box); }
      });
    }
    ["county", "bg"].forEach(k => {
      const sel = $(`${k}-var`);
      if (q.get(k) && [...sel.options].some(o => o.value === q.get(k))) { sel.value = q.get(k); fire(sel); }
    });
    if (q.get("xt")) {
      await until(() => document.querySelector("#plant-types input"));
      q.get("xt").split(",").forEach(t => { const b = document.querySelector(`#plant-types input[data-type="${t}"]`); if (b?.checked) { b.checked = false; fire(b); } });
    }
    if (q.get("xj")) q.get("xj").split(",").forEach(k => { const b = document.querySelector(`#xr-juris input[data-juris="${k}"]`); if (b?.checked) { b.checked = false; fire(b); } });
    await until(() => SCORE.S.ready);
    if (q.get("w")) q.get("w").split(",").map(Number).forEach((x, i) => { const c = Object.keys(SCORE.CATS)[i]; if (c && Number.isFinite(x)) SCORE.S.weights[c] = Math.min(3, Math.max(0, x)); });
    if (q.get("gap") && Number.isFinite(+q.get("gap"))) SCORE.S.gap = Math.min(100, Math.max(50, +q.get("gap")));
    if (q.get("tv") && (q.get("tv") in SCORE.S.inputs || ["score", "off"].includes(q.get("tv")))) SCORE.S.view = q.get("tv");
    if (q.get("ty")) SCORE.setYear(+q.get("ty"), { linkRecord: false });
    SCORE.syncControls(); SCORE.draw();
    const mi = XR_MONTHS.indexOf(q.get("m"));
    if (mi >= 0) { xr.i = mi; $("xr-range").value = mi; renderXr(); }
    if (q.get("y")) {
      await until(() => capacitySeries);
      _setMode(true);
      _setYear(+q.get("y"));
    }
    return q;
  }

  // ---------- Copy link ----------
  function toast(text) {
    const t = document.createElement("div");
    t.className = "copied";
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }
  $("copy-link").addEventListener("click", async () => {
    writeHash(true);
    try { await navigator.clipboard.writeText(viewUrl()); toast("Link copied: it reopens these layers and this view"); }
    catch (e) { prompt("Copy this link:", viewUrl()); }
  });

  // ---------- Layer registry: what each layer looks like on paper, and where it comes from ----------
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  // Readable publisher names for record sources that carry only a link.
  const PUBLISHER = {
    "storage.courtlistener.com": "Court filing, N.D. Miss. (via CourtListener)", "courtlistener.com": "Court docket (CourtListener)",
    "selc.org": "Southern Environmental Law Center", "opcgis.deq.state.ms.us": "Mississippi Dept. of Environmental Quality",
    "mississippifreepress.org": "Mississippi Free Press", "mississippitoday.org": "Mississippi Today", "thestar.com.my": "The Star (wire report)",
    "wkms.org": "WKMS", "yahoo.com": "Yahoo News (syndicated)", "earthjustice.org": "Earthjustice", "mitchellwilliamslaw.com": "Mitchell Williams law firm",
    "memphisflyer.com": "Memphis Flyer", "justice.gov": "U.S. Department of Justice", "desotocountynews.com": "DeSoto County News", "technology.org": "Technology.org"
  };
  const publisher = u => PUBLISHER[host(u)] || host(u);
  // Provenance for paper: same labels as the map, with the link written out.
  const printProv = r => {
    const tiers = String(r.tier || "").split("+").map(t => TIER_LABEL[t.trim()]).filter(Boolean).join(" + ");
    const bits = [r.status && `<b class="sh-st st--${r.status}">${esc(STATUS_LABEL[r.status] || r.status)}</b>`, tiers && esc(tiers),
      (r.as_of || r.date) && `as of ${esc(fmtDate(r.as_of || r.date))}`, r.source_read === "excerpt" && "checked from an excerpt only",
      r.verified_on ? `verified ${esc(fmtDate(r.verified_on))}` : "not yet re-verified"].filter(Boolean).join(" · ");
    return `<div class="sh-prov">${bits}${r.source_url ? `<a href="${esc(r.source_url)}">${esc(r.source_url)}</a>` : ""}</div>`;
  };
  const cite = (layer, source, url, tier, as_of, status, note) => ({ layer, source, url, tier, as_of, status, note });
  const li = (key, text) => (key ? `<li>${key}<span>${text}</span></li>` : `<li class="lg-note"><span>${text}</span></li>`);
  const triangle = '<svg class="shape" viewBox="0 0 20 20" width="12" height="12" aria-hidden="true"><path d="M10 1.5 L19 18 H1 Z" style="fill:var(--g-gas);stroke:var(--colossus);stroke-width:2.5px"/></svg>';
  const gridYear = () => (TL.on ? TL.year : TL.end);
  const recordsThrough = () => xrLabel();
  const NAACP = "https://storage.courtlistener.com/recap/gov.uscourts.msnd.52261/gov.uscourts.msnd.52261.1.0.pdf";
  const recordCites = (layer, rows) => {
    const seen = new Map();
    rows.forEach(r => {
      if (!r.source_url) return;
      const k = r.source_url, prev = seen.get(k);
      const d = r.as_of || r.date;
      if (!prev) seen.set(k, { ...r, n: 1, last: d });
      else { prev.n++; if (dateKey(d) > dateKey(prev.last)) prev.last = d; }
    });
    return [...seen.values()].map(r => cite(layer, r.source_name || publisher(r.source_url), r.source_url, r.tier, fmtDate(r.last),
      "", `${r.n} record${r.n > 1 ? "s" : ""} on the map${r.source_read === "excerpt" ? "; checked from an excerpt only" : ""}`));
  };

  // ---------- tract layer: score or a single input ----------
  const scoreInputs = () => SCORE.S.order.filter(id => SCORE.S.inputs[id].category in SCORE.CATS);
  const tractLabel = () => (SCORE.S.view === "score" ? `Injustice score, ${SCORE.S.year}` : `${SCORE.S.inputs[SCORE.S.view].label}, ${SCORE.S.year}`);
  const inputCite = (d, layer) => cite(layer, d.source.name, d.source.url?.startsWith("http") ? d.source.url : "", d.source.tier, d.basis?.[SCORE.S.year] || Object.keys(d.years).join(", "), "", d.notes?.[0]);
  const TRACT_LAYER = {
    id: "tract", label: tractLabel, on: () => SCORE.S.ready && SCORE.S.view !== "off", when: () => "Shelby + DeSoto tracts",
    legend: () => `<li class="sh-seq"><div class="tract-legend">${$("tract-legend").innerHTML}</div></li>` + li("", esc($("tract-note").textContent)) +
      (SCORE.S.view === "score" ? li("", `Weights: ${Object.entries(SCORE.CATS).map(([c, lab]) => `${lab} ${SCORE.S.weights[c]}`).join(", ")}. Missing data scored as ${SCORE.S.gap}. Screening index from public data, not a finding.`) : ""),
    cites: () => (SCORE.S.view === "score" ? scoreInputs().map(id => inputCite(SCORE.S.inputs[id], `Score: ${SCORE.CATS[SCORE.S.inputs[id].category]}`))
      : [inputCite(SCORE.S.inputs[SCORE.S.view], "Tract layer")]).concat([cite("Tract boundaries", "U.S. Census Bureau TIGERweb, 2020 census tracts", "https://tigerweb.geo.census.gov/", "official")]),
    extra: () => {
      if (SCORE.S.view !== "score") return "";
      const y = String(SCORE.S.year);
      const rows = Object.entries(SCORE.CATS).map(([c, lab]) => {
        const ids = scoreInputs().filter(id => SCORE.S.inputs[id].category === c);
        return `<tr class="sh-cat"><td colspan="4"><b>${lab}</b> · weight ${SCORE.S.weights[c]}</td></tr>` + ids.map(id => {
          const d = SCORE.S.inputs[id], has = !!d.years[y];
          return `<tr><td>${esc(d.label)}${SCORE.INPUT_WEIGHT[id] ? ` (counts ×${SCORE.INPUT_WEIGHT[id]} within ${lab})` : ""}</td><td>${has ? `Measured: ${esc(d.basis?.[y] || y)}` : `<b>No data for ${y}: scored as ${SCORE.S.gap}</b>`}</td>` +
            `<td>${Object.keys(d.years).join(", ")}</td><td>${esc(d.source.name)}</td></tr>`;
        }).join("");
      }).join("");
      const a = SCORE.countyAverages();
      return `<h3>Injustice score: what went into ${y}</h3>
        <p class="sh-small">Each input is ranked against every resident tract in every year 2019–2026 (share of tract-years less burdened, 0–100). Inputs are averaged within categories, and categories are combined with the weights shown. Missing data is never filled in or carried forward; it is scored as ${SCORE.S.gap}. Tracts with fewer than ${SCORE.S.meta.min_pop} residents are not scored. Average across tracts in ${y}: ${Math.round(a.withGap)} with gaps scored; ${a.noGap != null ? Math.round(a.noGap) : "n/a"} counting only measured data. A screening index from public data, not a finding of harm or liability. Full method: docs/injustice-score-method.md.</p>
        <table class="sh-cite"><thead><tr><th>Input</th><th>${y}</th><th>Years with data</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
  };

  const LAYERS = [
    TRACT_LAYER,
    { id: "substations", label: "Substations (today)", on: () => chk("substations"),
      legend: () => li('<span class="sub-icon"><span></span></span>', "Substation, present-day location; not scored"),
      cites: () => [cite("Substations", "OpenStreetMap contributors (ODbL), power=substation", "https://www.openstreetmap.org/copyright", "community", "", "", "Volunteer-mapped; most have no build date")] },
    { id: "monitors", label: "Regulatory air monitors", on: () => chk("monitors"), when: () => `${SCORE.S.year}`,
      legend: () => li('<i class="mon mon--ok"></i>', "Complete year of data") + li('<i class="mon mon--part"></i>', "Incomplete year") + li('<i class="mon mon--none"></i>', "Not measuring that year"),
      cites: () => [cite("Air monitors", "U.S. EPA AirData annual summaries", "https://aqs.epa.gov/aqsweb/airdata/download_files.html", "official", `${SCORE.S.year}`)] },
    { id: "schools", label: "Schools: chronic absenteeism", on: () => chk("schools"),
      legend: () => li('<span class="sch-icon"><span></span></span>', "School; click on the map for yearly rates"),
      cites: () => [cite("Schools", "TN Dept. of Education; Mississippi Report Card; NCES school locations", "https://www.tn.gov/education/districts/federal-programs-and-oversight/data/data-downloads.html", "official", "", "", "Weak stand-in for respiratory health")] },
    { id: "tva", label: "TVA power service area", on: () => chk("tva"),
      legend: () => li('<span class="key key-tva"></span>', "Service-area boundary; area outside is faded"),
      cites: () => [cite("TVA service area", "TVA, TVA_Power_Service_Area", "https://www.tva.com/", "official", "Dec 8, 2016")] },
    { id: "xai", label: "xAI sites", on: () => chk("xai"),
      legend: () => li('<span class="key key-dc"></span>', "Data center: Colossus 1 (Memphis), Colossus 2 (Whitehaven)") +
        li(triangle, "xAI gas turbines, Southaven, MS (behind the meter, not in EIA data)") +
        li('<span class="key key-xlink"></span>', "Turbines to the data center they power; schematic, not the cable route"),
      cites: () => [
        cite("xAI sites", "NAACP v. X.AI Corp., complaint (N.D. Miss. 3:26-cv-00074)", NAACP, "official", "Apr 14, 2026", "filed_allegation", "Allegations, not findings"),
        cite("xAI sites", "MDEQ Agreed Order (turbine inventory)", "https://opcgis.deq.state.ms.us/ensearchonline/get_doc.aspx?dt=order&id=1862315", "official", "Jul 30, 2026", "regulator_stated"),
        cite("xAI sites", "Mississippi Free Press: Permit Board grants 41 turbines", "https://www.mississippifreepress.org/mississippi-permit-board-grants-xais-request-for-41-southaven-gas-turbines-to-power-memphis-data-center/", "secondary", "Mar 10, 2026", "permitted"),
        cite("xAI sites", "Scientific American; Mississippi Today (via Our Tupelo)", "https://www.scientificamerican.com/article/spacexais-colossus-data-center-is-fueling-a-massive-backlash/", "secondary", "2026", "reported")
      ] },
    { id: "plants", label: "Power plants", on: () => chk("plants"), when: () => `${gridYear()}`,
      legend: () => [...document.querySelectorAll("#plant-types input:checked")].map(b => {
          const t = b.dataset.type;
          return li(shapeSvg(t, 12), `${PLANT_TYPES[t].label} <em>${document.querySelector(`[data-num="${t}"]`)?.textContent || ""}</em>`);
        }).join("") + li("", `Symbol size: capacity online in ${gridYear()}; symbol type: largest fuel`),
      cites: () => [cite("Power plants", "U.S. EIA Form 860 generator data, 2025", "https://www.eia.gov/electricity/data/eia860/", "official", "2025", "", "Retirements recorded only since 1995"),
        cite("Power plants", "U.S. EPA Clean Air Markets (emissions in plant details)", "https://campd.epa.gov/", "official", "2025")] },
    { id: "lines", label: "Transmission lines", on: () => chk("lines"), when: () => `${gridYear()}`,
      legend: () => [["v500", "500 kV"], ["v230", "220–287 kV"], ["v161", "100–161 kV"], ["vlow", "69 kV and below"], ["vna", "Voltage not listed"]]
          .map(([k, t]) => li(`<span class="key key-v key-${k}"></span>`, t)).join("") +
        (TL.on ? li('<span class="key key-v key-est"></span>', `Faded: in-service year estimated. Lines shown were in service by ${TL.year}`) : ""),
      cites: () => [cite("Transmission lines", "HIFLD Electric Power Transmission Lines", "https://hifld-geoplatform.hub.arcgis.com/", "official", "", "", "Clipped to the TVA area"),
        ...(TL.on ? [cite("Transmission lines", "In-service years: OpenStreetMap contributors (ODbL); the rest estimated", "https://www.openstreetmap.org/copyright", "official+derived", "", "estimated", lineShare ? `${Math.round(lineShare["0"] * 100)}% of line-miles have a recorded year` : "")] : [])] },
    { id: "counts", label: "Turbine counts", on: () => chk("counts"), when: () => recordsThrough(),
      legend: () => li('<span class="count-icon"><span>35</span></span>', "Latest turbine count at the site") +
        li('<span class="count-icon"><span class="alleged">35*</span></span>', "* the latest count is an allegation (court filing)"),
      cites: () => recordCites("Turbine counts", xr.counts.filter(c => dateKey(c.date) <= xrEnd())),
      extra: () => {
        const rows = ["southaven", "colossus1"].flatMap(site => countsAt(site).upto.map(c => ({ ...c, siteName: XR_SITES[site].name })));
        if (!rows.length) return "";
        return `<h3>Turbine counts on record through ${recordsThrough()}</h3><ol class="sh-list">${rows.map(c =>
          `<li><time>${esc(fmtDate(c.date))} · ${esc(c.siteName)}</time>${esc(c.label)}${printProv({ ...c, as_of: c.date })}</li>`).join("")}</ol>`;
      } },
    { id: "decisions", label: "Decisions", on: () => chk("decisions"), when: () => recordsThrough(),
      legend: () => li('<span class="lgi lgi--inj">!</span>', "Injunction motions and rulings (number at the site)") + li('<span class="lgi lgi--case">§</span>', "Lawsuits, court filings and rulings, notices of intent to sue, appeals") +
        li('<span class="lgi lgi--permit">P</span>', "Permits, applications, hearings, orders, votes") +
        li("", `Jurisdictions: ${[...xr.juris].map(k => XR_JURIS[k]).join(", ") || "none"}`),
      cites: () => recordCites("Decisions", eventsShown()),
      extra: () => {
        const ev = eventsShown();
        if (!ev.length) return "";
        return `<h3>Decisions on record through ${recordsThrough()} (${ev.length})</h3><p class="sh-small">Filings are allegations, not findings.</p><ol class="sh-list">${ev.map(e =>
          `<li><time>${esc(fmtDate(e.date))} · ${esc(XR_JURIS[e.jurisdiction])} · ${esc(e.type)}</time><b>${esc(e.actor)}</b>: ${esc(e.title)}${printProv(e)}</li>`).join("")}</ol>`;
      } },
    { id: "juris", label: "Who has authority", on: () => chk("juris"),
      legend: () => li('<span class="key key-county"></span>', "County line") + li('<span class="key key-city"></span>', "City line"),
      cites: () => [cite("Who has authority", "U.S. Census Bureau TIGERweb boundaries", "https://tigerweb.geo.census.gov/", "official")] },
    { id: "c3", label: "Colossus 3 (planned)", on: () => chk("c3"),
      legend: () => li('<span class="c3-icon"><span></span></span>', "Planned site, 2400 Stateline Rd W, Southaven; location geocoded from the address"),
      cites: () => [cite("Colossus 3", "NAACP v. X.AI Corp., complaint", NAACP, "official", "Apr 14, 2026", "alleged", "Location geocoded (Census geocoder); verify against county records")] },
    { id: "county", label: () => `Counties: ${$("county-var").selectedOptions[0].text}`, on: () => !!$("county-var").value,
      legend: () => `<li class="sh-seq"><div class="seq-legend">${$("county-legend").innerHTML}</div></li>` + li("", "Quintiles across TVA-area counties"),
      cites: () => [cite("Counties", "U.S. Census Bureau ACS 2020–2024 5-year (via Census Reporter); 2025 Gazetteer land area", "https://www.census.gov/programs-surveys/acs/news/data-releases/2024/release.html", "official", "2024", "estimated", "Survey estimates with margins of error")] },
    { id: "bg", label: () => `Block groups: ${$("bg-var").selectedOptions[0].text}`, on: () => !!$("bg-var").value,
      legend: () => `<li class="sh-seq"><div class="seq-legend">${$("bg-legend").innerHTML}</div></li>` + li("", "Quintiles; 2020–2024 figures may not describe who lives there now"),
      cites: () => [cite("Block groups", "U.S. Census Bureau ACS 2020–2024 5-year, block groups", "https://www.census.gov/programs-surveys/acs/", "official", "2024", "estimated", "90% margins of error in the map details")] },
    { id: "air", label: () => `Air-quality monitors: ${$("air-var").value === "pm" ? "PM2.5 annual mean (µg/m³)" : "ozone 4th-highest 8-hour (ppb)"}`, on: () => chk("air"),
      legend: () => li('<span class="key key-aq"></span>', "Meets standard") + li('<span class="key key-aq near"></span>', "Within 10% of standard") + li('<span class="key key-aq over"></span>', "▲ Above standard (PM2.5 9.0 µg/m³; ozone 70 ppb)"),
      cites: () => [cite("Air monitors", "U.S. EPA AirData annual summaries, 2025", "https://www.epa.gov/outdoor-air-quality-data", "official", "2025", "", "One year only; official compliance uses 3-year averages")] },
    { id: "noise", label: "Transportation noise (road, rail, air)", on: () => chk("noise"),
      legend: () => `<li class="sh-noise"><div class="sub-legend">${$("noise-legend").innerHTML}</div></li>`,
      cites: () => [cite("Transportation noise", "U.S. DOT BTS National Transportation Noise Map, 2022", "https://www.bts.gov/geospatial/national-transportation-noise-map", "official", "2022", "estimated", "Modeled; excludes turbines and industrial noise; for trends, not individual locations")] },
    { id: "ash", label: "Coal ash sites", on: () => chk("ash"),
      legend: () => li('<span class="ash-icon"><span></span></span>', "Kingston (2008 spill) and Allen (Memphis) coal-ash sites"),
      cites: () => [cite("Coal ash", "U.S. EPA: TVA Kingston Fossil Plant coal ash release", "https://www.epa.gov/node/133797", "official", "Dec 22, 2008", "documented"),
        cite("Coal ash", "Mississippi Free Press: Allen coal-ash remediation", "https://www.mississippifreepress.org/from-memphis-to-tunica-concerns-about-tvas-coal-ash-contamination-remediation-plans/", "secondary", "Jan 26, 2021", "documented", "Extent of aquifer contamination is disputed")] },
    { id: "wells", label: "Memphis aquifer wells", on: () => chk("wells"),
      legend: () => li('<span class="well-icon"><span></span></span>', "USGS monitoring well (water levels only)"),
      cites: () => [cite("Aquifer wells", "USGS National Water Information System", "https://waterdata.usgs.gov/nwis", "official", "", "", "No well shows what any one user withdraws")] },
    { id: "sat", label: "Satellite patches", on: () => chk("sat"), when: () => `${gridYear()}`,
      legend: () => li('<span class="key key-sat"></span>', "Satellite imagery around power plants and xAI sites"),
      cites: () => [cite("Satellite patches", "Esri World Imagery (Esri, Vantor, Earthstar Geographics)", "https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9", "secondary")] }
  ];
  const BASE_CITES = () => [
    cite("Basemap", "Esri World Light Gray Canvas (Esri, HERE, Garmin, © OpenStreetMap contributors)", "https://www.arcgis.com/home/item.html?id=291da5eab3a0412593b66d384379f89f", "secondary"),
    cite("State outlines", "U.S. Census Bureau cartographic boundaries via us-atlas 3.0.1", "https://github.com/topojson/us-atlas", "official")
  ];
  const labelOf = L_ => (typeof L_.label === "function" ? L_.label() : L_.label);
  const active = () => LAYERS.filter(l => l.on());

  // ---------- Export mode ----------
  const exportEl = $("export"), sheet = $("sheet"), slot = $("sh-map"), mapEl = $("map");
  const printBtn = $("ex-print"), statusEl = $("ex-status");
  const pageStyle = document.createElement("style");
  document.head.appendChild(pageStyle);
  const scale = L.control.scale({ position: "bottomleft", maxWidth: 140 });
  let prev = null, gateTimer = null, generatedAt = null;

  const PAPER = { letter: [11, 8.5], a4: [11.69, 8.27] };
  function applyPaper() {
    const [w, h] = PAPER[$("ex-paper").value];
    const land = $("ex-orient").value === "landscape";
    const pw = land ? w : h, ph = land ? h : w;
    sheet.style.setProperty("--pw", `${pw}in`);
    sheet.style.setProperty("--ph", `${ph}in`);
    sheet.dataset.orient = land ? "landscape" : "portrait";
    pageSize = `${$("ex-paper").value === "a4" ? "A4" : "letter"} ${land ? "landscape" : "portrait"}`;
    writePageRule();
  }
  // Every printed page carries the exhibit's title, time and page number, so loose pages can be put back together.
  let pageSize = "letter landscape";
  const cssStr = t => `"${String(t).replace(/[\\"]/g, "\\$&").replace(/[\r\n]+/g, " ")}"`;
  function writePageRule() {
    const title = ($("ex-title").value.trim() || "Untitled exhibit").slice(0, 90);
    const stamp = generatedAt ? fmtStamp(generatedAt) : "";
    const box = `font: 7pt "IBM Plex Mono", ui-monospace, monospace; color: #6a6a6a;`;
    pageStyle.textContent = `@page { size: ${pageSize}; margin: 0.45in;
      @bottom-left { content: ${cssStr(`The Counter Map · ${title} · Generated ${stamp}`)}; ${box} vertical-align: middle; }
      @bottom-right { content: "Page " counter(page) " of " counter(pages); ${box} vertical-align: middle; } }`;
  }

  function tilesBusy() {
    let busy = false;
    map.eachLayer(l => { if (l instanceof L.GridLayer && typeof l.isLoading === "function" && l.isLoading()) busy = true; });
    return busy;
  }
  function gate() {
    clearTimeout(gateTimer);
    printBtn.disabled = true;
    statusEl.textContent = "Loading map tiles…";
    const t0 = Date.now();
    (function poll() {
      if (!tilesBusy() && Date.now() - t0 > 400) { printBtn.disabled = false; statusEl.textContent = "Ready. Map tiles loaded."; return; }
      if (Date.now() - t0 > 10000) { printBtn.disabled = false; statusEl.textContent = "Some tiles are slow to load; check the preview before saving."; return; }
      gateTimer = setTimeout(poll, 200);
    })();
  }

  const fmtStamp = d => d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  function renderSheet() {
    const on = active();
    const by = $("ex-by").value.trim();
    $("sh-title").textContent = $("ex-title").value.trim() || "Untitled exhibit";
    const meta = [`Generated ${fmtStamp(generatedAt)}`];
    if (on.some(l => GRID_LAYERS.includes(l.id))) meta.push(`Grid shown as of ${gridYear()}`);
    if (on.some(l => RECORD_LAYERS.includes(l.id))) meta.push(`xAI record through ${recordsThrough()}`);
    if (TRACT_LAYER.on()) meta.push(`Tract year ${SCORE.S.year}`);
    meta.push(`Data version ${DATA_VERSION}`);
    if (by) meta.push(`Prepared by ${by}`);
    $("sh-meta").textContent = meta.join(" · ");
    const notes = $("ex-notes").value.trim();
    $("sh-notes").hidden = !notes;
    $("sh-notes").innerHTML = notes ? `<h3>Notes</h3><p>${esc(notes)}</p>` : "";

    const legendHtml = on.length
      ? on.map(l => `<div class="lg"><h4>${esc(labelOf(l))}${l.when ? ` <small>${esc(l.when())}</small>` : ""}</h4><ul>${l.legend()}</ul></div>`).join("")
      : `<p class="sh-small">No data layers are switched on: this page shows the basemap only.</p>`;
    $("sh-legend").innerHTML = legendHtml;
    $("sh-legend2").innerHTML = legendHtml;

    const url = viewUrl();
    $("sh-url").textContent = url;
    $("sh-url").href = url;
    const qr = $("sh-qr");
    qr.innerHTML = "";
    if (window.QRCode) new QRCode(qr, { text: url, width: 84, height: 84, correctLevel: QRCode.CorrectLevel.L });

    const cites = [...on.flatMap(l => l.cites()), ...BASE_CITES()];
    $("sh-cites").innerHTML = cites.map(c => `<tr><td>${esc(c.layer)}</td><td><b>${esc(c.source)}</b>${c.note ? `<span>${esc(c.note)}</span>` : ""}${c.url ? `<a href="${esc(c.url)}">${esc(c.url)}</a>` : ""}</td>` +
      `<td>${esc(String(c.tier || "").split("+").map(t => TIER_LABEL[t] || t).join(" + "))}${c.status ? "<br>" : ""}${c.status ? `<span class="sh-st st--${c.status}">${esc(STATUS_LABEL[c.status] || c.status)}</span>` : ""}</td><td>${esc(c.as_of || "")}</td></tr>`).join("");
    $("sh-extra").innerHTML = on.map(l => l.extra?.() || "").join("");
    writePageRule();
    $("sh-attr").innerHTML = `Map data: ${map.attributionControl._container.textContent.replace(/^.*?Leaflet\s*\|\s*/, "")}`;
    fitLegend();
  }
  // Long legends, step by step: tighter type, then a wider two-column legend, then the legend moves to page 2.
  // The legend is kept beside the map whenever it fits, since an exhibit's key belongs on the same page.
  function fitLegend() {
    const side = sheet.querySelector(".sh-side"), w0 = slot.clientWidth, h0 = slot.clientHeight;
    for (const step of [[], ["dense"], ["dense", "wide"], ["dense", "legend-p2"]]) {
      sheet.classList.remove("dense", "wide", "legend-p2");
      sheet.classList.add(...step);
      if (side.scrollHeight <= side.clientHeight + 1) break;
    }
    if (slot.clientWidth !== w0 || slot.clientHeight !== h0) map.invalidateSize({ pan: false });
  }

  function relayout() {
    const b = prev?.bounds || map.getBounds();
    applyPaper();
    map.invalidateSize({ pan: false });
    map.fitBounds(b, { padding: [0, 0], animate: false });
    renderSheet();
    gate();
  }

  function openExport() {
    if (document.body.classList.contains("exporting")) return;
    stopPlaying();
    map.closePopup();
    generatedAt = new Date();
    prev = { theme: document.documentElement.dataset.theme, autoFit, bounds: map.getBounds(), notes: map.hasLayer(recLayer) };
    autoFit = false;
    if (prev.theme !== "light") setTheme("light");
    map.removeLayer(recLayer);                     // private notes never go into an export
    document.body.classList.add("exporting");
    exportEl.hidden = false;
    slot.appendChild(mapEl);
    scale.addTo(map);
    relayout();
    map.on("moveend zoomend", onExportMove);
    $("ex-title").focus();
  }
  function closeExport() {
    if (!document.body.classList.contains("exporting")) return;
    map.off("moveend zoomend", onExportMove);
    const b = map.getBounds();
    document.body.classList.remove("exporting");
    exportEl.hidden = true;
    exportEl.before(mapEl);
    scale.remove();
    map.invalidateSize({ pan: false });
    map.fitBounds(b, { animate: false });
    if (prev.notes && chk("notes")) recLayer.addTo(map);
    if (prev.theme !== "light") setTheme(prev.theme);
    autoFit = false;
    writeHash(true);
  }
  function onExportMove() { prev.bounds = map.getBounds(); renderSheet(); gate(); }

  $("export-open").addEventListener("click", openExport);
  $("ex-close").addEventListener("click", closeExport);
  addEventListener("keydown", e => { if (e.key === "Escape" && document.body.classList.contains("exporting")) closeExport(); });
  ["ex-title", "ex-notes", "ex-by"].forEach(id => $(id).addEventListener("input", renderSheet));
  ["ex-paper", "ex-orient"].forEach(id => $(id).addEventListener("change", relayout));
  printBtn.addEventListener("click", () => { generatedAt = new Date(); renderSheet(); window.print(); });

  // ---------- Start: restore the linked view, then keep the URL current ----------
  restore().then(q => {
    restoring = false;
    if (location.hash.slice(1)) writeHash(true);
    if (q.get("export") === "1") {
      if (q.get("paper")) $("ex-paper").value = q.get("paper");
      if (q.get("orient")) $("ex-orient").value = q.get("orient");
      if (q.get("title")) $("ex-title").value = q.get("title");
      if (q.get("notes")) $("ex-notes").value = q.get("notes");
      openExport();
    }
  });
})();
