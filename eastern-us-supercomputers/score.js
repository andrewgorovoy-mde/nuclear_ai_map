// =====================================================================================
//  TRACT LAYERS + INJUSTICE SCORE — Shelby County, TN and DeSoto County, MS, 2019–2026.
//  Loaded after the inline script in explore.html (shares map, esc, prov, palette, …) and before map-tool.js.
//  Method: docs/injustice-score-method.md. Inputs: data/inputs/*.json (format: tools/INPUTS.md).
//
//  Rules the code must keep:
//   - A missing input is never filled or carried forward. It scores as the "data gap" value instead.
//   - Each input is ranked against all tract-years together (share strictly less burdened), so years compare.
//   - Tracts with almost no residents are never ranked or scored.
// =====================================================================================
const SCORE = (() => {
  const $ = id => document.getElementById(id);
  const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const CATS = {
    health: "Health", income: "Income", noise: "Noise", air: "Air pollution", infrastructure: "Infrastructure nearby", legal: "Legal activity"
  };
  // Within-category weights: absenteeism is a weak, confounded stand-in, so it counts a quarter as much.
  const INPUT_WEIGHT = { absenteeism: 0.25 };
  const S = {
    year: 2024, view: "score", gap: 75,
    weights: Object.fromEntries(Object.keys(CATS).map(k => [k, 1])),
    inputs: {}, order: [], meta: {}, shapes: null, layer: null, ready: false, ranks: {}
  };

  // ---------- data ----------
  const v = name => `${name}?v=${DATA_VERSION}`;
  const load = u => fetch(v(u)).then(r => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });

  async function init() {
    const [index, meta, shapes] = await Promise.all([load("data/inputs/index.json"), load("data/tract-meta.json"), load("data/tract-shapes.geojson")]);
    S.meta = meta;
    S.shapes = shapes;
    const files = await Promise.all(index.inputs.map(i => load(i.file).catch(e => (console.warn("Input unavailable:", e), null))));
    files.filter(Boolean).forEach(d => { S.inputs[d.id] = d; S.order.push(d.id); });
    S.order.forEach(rankInput);
    S.ready = true;
    buildControls();
    draw();
    document.dispatchEvent(new CustomEvent("score:ready"));
  }

  const resident = g => S.meta.tracts[g] && !S.meta.tracts[g].no_residents;
  const scored = d => d.category in CATS;
  const val = (d, y, g) => (d.years[y] ? d.years[y][g] : undefined);   // undefined = no data that year, null = not this tract

  // Percentile = share of all resident tract-years (within the input's rank group) that are strictly less burdened.
  function rankInput(id) {
    const d = S.inputs[id];
    if (!scored(d)) return;
    const groups = d.rank_groups || [Object.keys(d.years)];
    S.ranks[id] = {};
    groups.forEach(years => {
      const vals = [];
      years.forEach(y => d.years[y] && Object.entries(d.years[y]).forEach(([g, x]) => { if (x != null && resident(g)) vals.push(x); }));
      vals.sort((a, b) => a - b);
      const lower = x => { let lo = 0, hi = vals.length; while (lo < hi) { const m = (lo + hi) >> 1; vals[m] < x ? lo = m + 1 : hi = m; } return lo; };
      const higher = x => { let lo = 0, hi = vals.length; while (lo < hi) { const m = (lo + hi) >> 1; vals[m] <= x ? lo = m + 1 : hi = m; } return vals.length - lo; };
      years.forEach(y => { S.ranks[id][y] = { pct: x => 100 * (d.direction === "lower_worse" ? higher(x) : lower(x)) / vals.length, n: vals.length }; });
    });
  }

  // One input for one tract-year: measured percentile, or the gap value.
  function inputScore(id, y, g) {
    const x = val(S.inputs[id], String(y), g);
    if (x == null || !S.ranks[id][y]) return { gap: true, score: S.gap, raw: x === null ? null : undefined };
    return { gap: false, score: S.ranks[id][y].pct(x), raw: x };
  }

  function tractScore(g, y = S.year) {
    if (!resident(g)) return null;
    const cats = {};
    let num = 0, den = 0;
    Object.keys(CATS).forEach(c => {
      const ids = S.order.filter(id => S.inputs[id].category === c);
      if (!ids.length) return;
      let n = 0, w = 0, measured = 0;
      const parts = ids.map(id => {
        const r = inputScore(id, y, g), wi = INPUT_WEIGHT[id] ?? 1;
        n += r.score * wi; w += wi; if (!r.gap) measured++;
        return { id, ...r };
      });
      cats[c] = { score: n / w, parts, measured, total: ids.length };
      num += cats[c].score * S.weights[c]; den += S.weights[c];
    });
    return { score: den ? num / den : null, cats };
  }

  // County-wide averages, with gaps scored and with gap inputs left out (so readers can see what really moved).
  function countyAverages(y = S.year) {
    const res = Object.keys(S.meta.tracts).filter(resident);
    const withGap = res.map(g => tractScore(g, y).score);
    const noGap = res.map(g => {
      let num = 0, den = 0;
      Object.keys(CATS).forEach(c => {
        const parts = S.order.filter(id => S.inputs[id].category === c).map(id => ({ id, ...inputScore(id, y, g) })).filter(p => !p.gap);
        if (!parts.length) return;
        const w = parts.reduce((a, p) => a + (INPUT_WEIGHT[p.id] ?? 1), 0);
        num += parts.reduce((a, p) => a + p.score * (INPUT_WEIGHT[p.id] ?? 1), 0) / w * S.weights[c]; den += S.weights[c];
      });
      return den ? num / den : null;
    }).filter(x => x != null);
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    return { withGap: mean(withGap), noGap: noGap.length ? mean(noGap) : null };
  }

  // ---------- drawing ----------
  map.createPane("tracts");
  map.getPane("tracts").style.zIndex = 380;            // above the basemap and satellite patches, below lines and markers
  const svg = L.svg({ pane: "tracts", padding: 0.5 });
  const SEQ5 = ["#f1ede4", "#d8c9b0", "#b89a76", "#8a5c3c", "#4f2a1b"];      // warm burden ramp, light → dark
  const HATCH = "url(#tract-hatch)";

  function ensureHatch() {
    const root = svg._container;
    if (!root || root.querySelector("#tract-hatch")) return;
    root.insertAdjacentHTML("afterbegin", `<defs><pattern id="tract-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="#ffffff" fill-opacity="0.35"/><line x1="0" y1="0" x2="0" y2="6" stroke="#8c8c8c" stroke-width="1.2"/></pattern>
      <pattern id="tract-empty" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#e8e8e8" fill-opacity="0.5"/><circle cx="4" cy="4" r="0.9" fill="#9a9a9a"/></pattern></defs>`);
  }

  // Classes: score views use fixed 0–100 steps (comparable across years); raw views use quintiles of all tract-years.
  let breaks = [];
  function computeBreaks() {
    if (S.view === "score") { breaks = [20, 40, 60, 80]; return; }
    const d = S.inputs[S.view];
    const all = [];
    Object.values(d.years).forEach(o => Object.entries(o).forEach(([g, x]) => { if (x != null && resident(g)) all.push(x); }));
    all.sort((a, b) => a - b);
    breaks = [0.2, 0.4, 0.6, 0.8].map(q => all[Math.floor(q * (all.length - 1))]);
    if (d.direction === "lower_worse") breaks = breaks.slice();     // colors flip below
  }
  const classOf = x => { let i = 0; while (i < breaks.length && x >= breaks[i]) i++; return i; };

  function tractValue(g) {
    if (!resident(g)) return { kind: "empty" };
    if (S.view === "score") { const t = tractScore(g); return t?.score == null ? { kind: "gap" } : { kind: "value", x: t.score }; }
    const x = val(S.inputs[S.view], String(S.year), g);
    return x == null ? { kind: x === null ? "gapTract" : "gap" } : { kind: "value", x };
  }

  function styleFor(g, hover) {
    const t = tractValue(g);
    const base = { color: hover ? "#141414" : "#ffffff", weight: hover ? 2 : 0.6, opacity: 1, fillOpacity: 0.78 };
    if (t.kind === "empty") return { ...base, fillColor: "url(#tract-empty)", fillOpacity: 1 };
    if (t.kind !== "value") return { ...base, fillColor: HATCH, fillOpacity: 1 };
    let k = classOf(t.x);
    if (S.view !== "score" && S.inputs[S.view].direction === "lower_worse") k = 4 - k;
    if (S.view !== "score" && S.inputs[S.view].direction === "none") k = classOf(t.x);
    return { ...base, fillColor: SEQ5[k] };
  }

  function draw() {
    if (!S.ready) return;
    computeBreaks();
    if (!S.layer) {
      S.layer = L.geoJSON(S.shapes, {
        renderer: svg, pane: "tracts",
        style: f => styleFor(f.properties.geoid, false),
        onEachFeature: (f, layer) => {
          const g = f.properties.geoid;
          layer.on("mouseover", () => layer.setStyle(styleFor(g, true)));
          layer.on("mouseout", () => layer.setStyle(styleFor(g, false)));
          layer.on("click", e => L.popup({ maxWidth: 380, minWidth: 300, maxHeight: 420, autoPanPaddingTopLeft: panelPadding() })
            .setLatLng(e.latlng).setContent(popup(g)).openOn(map));
        }
      });
    }
    if (S.view === "off") { map.removeLayer(S.layer); renderLegend(); return; }
    if (!map.hasLayer(S.layer)) S.layer.addTo(map);
    ensureHatch();
    S.layer.eachLayer(l => l.setStyle(styleFor(l.feature.properties.geoid, false)));
    renderLegend();
  }

  // ---------- popup: everything that went into this tract's number ----------
  const fmt = (x, d) => (x == null ? "" : Math.abs(x) >= 1000 ? Math.round(x).toLocaleString("en-US") : (+x.toFixed(d?.unit?.startsWith("%") ? 1 : 2)).toString());
  function popup(g) {
    const m = S.meta.tracts[g];
    const head = `<div class="tr-pop"><h3>${esc(m.name)}, ${esc(m.county)}</h3><p class="tr-sub">Tract ${g} · ${m.pop != null ? `${Math.round(m.pop).toLocaleString("en-US")} residents (ACS 2020–24)` : ""}</p>`;
    if (m.no_residents) return head + `<p>No residents (fewer than ${S.meta.min_pop}). Not ranked or scored.</p></div>`;
    const t = tractScore(g);
    const rows = Object.entries(t.cats).map(([c, cat]) => `
      <tr class="tr-cat"><th>${CATS[c]}</th><td>${Math.round(cat.score)}</td><td>${cat.measured}/${cat.total} measured · weight ${S.weights[c]}</td></tr>` +
      cat.parts.map(p => {
        const d = S.inputs[p.id];
        const what = p.gap ? `<em class="tr-gap">no data ${S.year}: gap ${S.gap}</em>` : `${fmt(p.raw, d)} ${esc(d.unit)}`;
        return `<tr><td>${esc(d.label)}</td><td>${Math.round(p.score)}</td><td>${what}${d.basis?.[S.year] ? `<span>${esc(d.basis[S.year])}</span>` : ""}</td></tr>`;
      }).join("")).join("");
    const ctx = S.inputs.black_pct ? val(S.inputs.black_pct, String(S.year), g) : undefined;
    return head + `<p class="tr-score"><b>${Math.round(t.score)}</b> injustice score, ${S.year} <span>0–100 · screening index from public data, not a finding</span></p>
      <table class="tr-table"><thead><tr><th>Input</th><th>Score</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>
      ${ctx != null ? `<p class="tr-ctx">Context, not scored: Black residents ${ctx}% (ACS ${S.year - 4}–${S.year})</p>` : ""}</div>`;
  }

  // ---------- panel controls ----------
  function buildControls() {
    const viewSel = $("tract-view");
    const opt = id => `<option value="${id}">${esc(S.inputs[id].label)}</option>`;
    const byCat = c => S.order.filter(id => S.inputs[id].category === c);
    viewSel.innerHTML = `<option value="score">Injustice score</option><option value="off">Off</option>` +
      Object.entries({ ...CATS, context: "Context (not scored)" }).map(([c, lab]) => byCat(c).length ? `<optgroup label="${lab}">${byCat(c).map(opt).join("")}</optgroup>` : "").join("");
    viewSel.value = S.view;
    viewSel.addEventListener("change", () => setView(viewSel.value));

    $("tract-year").addEventListener("input", e => setYear(+e.target.value));
    $("score-weights").innerHTML = Object.entries(CATS).map(([c, lab]) => `
      <label class="wt"><span>${lab}</span><input type="range" min="0" max="3" step="0.5" value="${S.weights[c]}" data-cat="${c}"><output>${S.weights[c]}</output></label>`).join("") +
      `<label class="wt wt-gap"><span>Missing data counts as</span><input type="range" min="50" max="100" step="5" value="${S.gap}" id="gap-val"><output>${S.gap}</output></label>`;
    $("score-weights").addEventListener("input", e => {
      const el = e.target;
      if (el.dataset.cat) S.weights[el.dataset.cat] = +el.value;
      if (el.id === "gap-val") S.gap = +el.value;
      el.nextElementSibling.textContent = el.value;
      draw();
      document.dispatchEvent(new CustomEvent("score:change"));
    });
    // Quick buttons in each group: one tract layer at a time.
    document.querySelectorAll(".views").forEach(box => {
      box.innerHTML = box.dataset.views.split(",").filter(id => S.inputs[id])
        .map(id => `<button type="button" class="vbtn" data-view="${id}">${esc(S.inputs[id].label)}</button>`).join("");
      box.addEventListener("click", e => {
        const b = e.target.closest("[data-view]");
        if (b) setView(S.view === b.dataset.view ? "score" : b.dataset.view);
      });
    });
    syncControls();
  }
  function syncControls() {
    document.querySelectorAll(".vbtn").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === S.view)));
    $("tract-year").value = S.year;
    $("tract-year-out").textContent = S.year;
    $("tract-view").value = S.view;
    document.querySelectorAll("#score-weights [data-cat]").forEach(el => { el.value = S.weights[el.dataset.cat]; el.nextElementSibling.textContent = el.value; });
    const gv = $("gap-val"); if (gv) { gv.value = S.gap; gv.nextElementSibling.textContent = S.gap; }
    $("score-weights-wrap").hidden = S.view !== "score";
  }

  function renderLegend() {
    const el = $("tract-legend");
    if (S.view === "off" || !S.ready) { el.innerHTML = ""; $("tract-note").textContent = ""; return; }
    const d = S.view === "score" ? null : S.inputs[S.view];
    const flip = d?.direction === "lower_worse";
    const labs = S.view === "score" ? ["0–20", "20–40", "40–60", "60–80", "80–100"]
      : [null, ...breaks].map((b, i) => (i === 0 ? `< ${fmt(breaks[0], d)}` : `${fmt(b, d)}+`));
    const sw = SEQ5.map((c, i) => `<span><i style="background:${flip ? SEQ5[4 - i] : c}"></i>${labs[i]}</span>`).join("");
    el.innerHTML = `<div class="tl-sw">${sw}</div><div class="tl-sw"><span><i class="i-hatch"></i>No data for ${S.year}${S.view === "score" ? "" : ""}</span><span><i class="i-empty"></i>No residents</span></div>`;
    let note = "";
    if (S.view === "score") {
      const a = countyAverages();
      note = `Average across tracts in ${S.year}: ${Math.round(a.withGap)} with gaps scored at ${S.gap}` + (a.noGap != null ? `; ${Math.round(a.noGap)} counting only measured data.` : ".");
    } else {
      const has = d.years[String(S.year)];
      note = (has ? "" : `No ${d.label.toLowerCase()} data for ${S.year}. Years with data: ${Object.keys(d.years).join(", ")}. `) +
        `${d.unit}. ${d.direction === "lower_worse" ? "Lower is worse (darker). " : ""}Classes are quintiles across all years. ${d.notes?.[0] || ""}`;
    }
    $("tract-note").textContent = note;
  }

  function setYear(y, { linkRecord = true } = {}) {
    S.year = Math.min(2026, Math.max(2019, y));
    syncControls(); draw(); refreshPoints();
    // One main time control: the xAI record (turbine counts, decisions) follows to December of the tract year.
    if (linkRecord && typeof XR_MONTHS !== "undefined") {
      const target = S.year >= 2024 ? Math.min(XR_MONTHS.indexOf(`${S.year}-12`) < 0 ? XR_MONTHS.length - 1 : XR_MONTHS.indexOf(`${S.year}-12`), XR_MONTHS.indexOf("2026-11")) : 0;
      xr.i = target; $("xr-range").value = target; renderXr();
    }
    document.dispatchEvent(new CustomEvent("score:change"));
  }
  function setView(vw) { S.view = vw; syncControls(); draw(); document.dispatchEvent(new CustomEvent("score:change")); }

  // ---------- point layers that follow the tract year ----------
  const pts = { monitors: null, schools: null, substations: null };
  const POLL = { pm25: "PM2.5", no2: "NO2", so2: "SO2", o3: "Ozone", hcho: "Formaldehyde" };
  function monitorHtml(p) {
    const y = String(S.year);
    const rows = Object.entries(POLL).map(([k, lab]) => {
      const r = p[k]?.[y] || p.pollutants?.[k]?.[y];
      if (!r) return "";
      return `<span>${lab}: ${r.mean != null ? `${(+r.mean).toFixed(2)} ${esc(r.unit || "")}` : "no value"} · ${esc(r.completeness || "")}${r.valid_days != null ? ` (${r.valid_days}/${r.required_days ?? "?"} days)` : ""}</span>`;
    }).filter(Boolean).join("");
    return `<div class="state-pop"><strong>${esc(p.name || p.site_id)}</strong><span>EPA site ${esc(p.site_id || "")} · ${y}</span>${rows || "<span>No readings this year.</span>"}` +
      `${prov({ tier: "official", source_name: "EPA AirData", source_url: "https://aqs.epa.gov/aqsweb/airdata/download_files.html" })}</div>`;
  }
  function monitorClass(p) {
    const y = String(S.year), recs = Object.keys(POLL).map(k => p[k]?.[y] || p.pollutants?.[k]?.[y]).filter(Boolean);
    if (!recs.length) return "none";
    return recs.some(r => r.completeness === "complete") ? "ok" : "part";
  }
  async function pointLayer(kind) {
    if (pts[kind]) return pts[kind];
    const file = { monitors: "data/air-monitors.geojson", schools: "data/schools.geojson", substations: "data/substations.geojson" }[kind];
    const data = await load(file);
    if (kind === "substations") {
      pts[kind] = L.geoJSON(data, {
        attribution: "Substations © OpenStreetMap contributors (ODbL)",
        pointToLayer: (f, ll) => L.marker(ll, { icon: L.divIcon({ className: "sub-icon", html: "<span></span>", iconSize: [10, 10] }), title: f.properties.name || "Substation" }),
        onEachFeature: (f, l) => l.bindPopup(`<div class="state-pop"><strong>${esc(f.properties.name || "Substation")}</strong>` +
          [f.properties.operator && `Operator: ${esc(f.properties.operator)}`, f.properties.voltage && `Voltage: ${esc(f.properties.voltage)} V`, f.properties.start_date && `In service: ${esc(f.properties.start_date)}`,
           "Present-day location from OpenStreetMap; not scored"].filter(Boolean).map(r => `<span>${r}</span>`).join("") +
          `${prov({ tier: "community", source_name: `OpenStreetMap ${f.properties.osm}`, source_url: `https://www.openstreetmap.org/${f.properties.osm}` })}</div>`)
      });
    } else if (kind === "monitors") {
      pts[kind] = L.geoJSON(data, {
        attribution: "Monitors: U.S. EPA AirData",
        pointToLayer: (f, ll) => L.marker(ll, { icon: L.divIcon({ className: "mon-icon", html: `<i class="mon mon--${monitorClass(f.properties)}"></i>`, iconSize: [14, 14] }), zIndexOffset: 300 }),
        onEachFeature: (f, l) => l.bindPopup(() => monitorHtml(f.properties))
      });
    } else {
      pts[kind] = L.geoJSON(data, {
        attribution: "Schools: TN Dept. of Education; MS Dept. of Education; NCES",
        pointToLayer: (f, ll) => L.marker(ll, { icon: L.divIcon({ className: "sch-icon", html: "<span></span>", iconSize: [9, 9] }) }),
        onEachFeature: (f, l) => l.bindPopup(() => {
          const p = f.properties, rates = p.chronic_absent_pct || {};
          const rows = Object.entries(rates).map(([y, r]) => `<span>${y}: ${r == null ? "suppressed or not reported" : `${r}% chronically absent`}${p.county_mean?.[y] != null ? ` (county ${p.county_mean[y]}%)` : ""}</span>`).join("");
          return `<div class="state-pop"><strong>${esc(p.name)}</strong><span>${esc(p.district || "")}, ${esc(p.state || "")}</span>${rows}` +
            `<span>A weak stand-in for respiratory health: absence has many causes.</span></div>`;
        })
      });
    }
    return pts[kind];
  }
  function refreshPoints() {
    if (pts.monitors && map.hasLayer(pts.monitors)) pts.monitors.eachLayer(l => l.setIcon(L.divIcon({ className: "mon-icon", html: `<i class="mon mon--${monitorClass(l.feature.properties)}"></i>`, iconSize: [14, 14] })));
  }
  [["toggle-monitors", "monitors"], ["toggle-schools", "schools"], ["toggle-substations", "substations"]].forEach(([id, kind]) => {
    const box = $(id);
    if (!box) return;
    box.addEventListener("change", async () => {
      if (kind === "monitors") $("monitors-legend").hidden = !box.checked;
      try {
        const lay = await pointLayer(kind);
        box.checked ? (lay.addTo(map), refreshPoints()) : map.removeLayer(lay);
      } catch (e) { console.warn(`${kind} unavailable:`, e); box.checked = false; box.disabled = true; }
    });
  });

  init().catch(err => { console.warn("Tract layers unavailable:", err); $("tract-note").textContent = "Tract data could not be loaded."; });

  return { S, CATS, YEARS, monitorClass, INPUT_WEIGHT, tractScore, countyAverages, setYear, setView, draw, syncControls, inputScore, val, resident };
})();
