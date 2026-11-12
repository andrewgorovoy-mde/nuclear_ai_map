// =====================================================================================
//  MAP LAYERS — one entry per id used in chapters.js `layers`.
//  Every layer is a factory: create(ctx) → { enter(opts), update(state), exit() }.
//    state = { year, progress, step, chapter }
//  Two drawing vocabularies, on purpose:
//    rigid  → Leaflet SVG lines/pins: thin ink, exact geometry, "technical"
//    soft   → ctx.zones canvas: blurred glows for zones of impact, "ephemeral"
// =====================================================================================
import { PLACES } from "./chapters.js?v=2026-11-11b";

const L = window.L;
const BLUE = "86, 168, 255";     // soft impact / environment
const ORANGE = "240, 132, 88";   // focal / human cost / xAI
const clamp01 = v => Math.max(0, Math.min(1, v));
const ramp = (y, a, b) => clamp01((y - a) / (b - a));   // 0 before a, 1 after b

// ---------- shared helpers ----------
function pin(ll, label, { kind = "ink", sub = "", side = "right" } = {}) {
  return L.marker(ll, {
    icon: L.divIcon({
      className: `s-pin s-pin--${kind} s-pin--${side}`,
      html: `<i></i><span><b>${label}</b>${sub ? `<em>${sub}</em>` : ""}</span>`,
      iconSize: [10, 10], iconAnchor: [5, 5]
    }),
    interactive: false, keyboard: false
  });
}
const ink = (lls, opts = {}) => L.polyline(lls, { className: "ink", interactive: false, weight: 1, ...opts });

// Points along a path, cut at fraction k (0..1) of its length — for routes that draw themselves.
function partial(path, k) {
  if (k <= 0) return [path[0]];
  const seg = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
  let left = seg.reduce((a, b) => a + b, 0) * Math.min(1, k);
  const out = [path[0]];
  for (let i = 0; i < seg.length; i++) {
    if (left >= seg[i]) { out.push(path[i + 1]); left -= seg[i]; continue; }
    const t = left / seg[i];
    out.push([path[i][0] + (path[i + 1][0] - path[i][0]) * t, path[i][1] + (path[i + 1][1] - path[i][1]) * t]);
    break;
  }
  return out;
}

// Ellipse polygon in km around a centre, rotated (degrees clockwise from north).
function ellipse([lat, lng], aKm, bKm, bearing, n = 96) {
  const rot = bearing * Math.PI / 180, kmLat = 110.57, kmLng = 111.32 * Math.cos(lat * Math.PI / 180);
  return Array.from({ length: n }, (_, i) => {
    const t = i / n * 2 * Math.PI, x = bKm * Math.cos(t), y = aKm * Math.sin(t);
    const east = x * Math.cos(rot) + y * Math.sin(rot), north = -x * Math.sin(rot) + y * Math.cos(rot);
    return [lat + north / kmLat, lng + east / kmLng];
  });
}

// A noisy version of ellipse(): the radius wobbles at several frequencies (fixed per seed, so the
// edge is stable as you zoom), plus small noisy islands scattered just past the rim.
function raggedRings(center, aKm, bKm, bearing, seed = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const kmLat = 110.57, kmLng = 111.32 * Math.cos(center[0] * Math.PI / 180), rot = bearing * Math.PI / 180;
  const toLL = (east, north) => [center[0] + north / kmLat, center[1] + east / kmLng];
  const waves = [[5, 0.09], [9, 0.06], [17, 0.04], [31, 0.025], [57, 0.015]].map(([f, a]) => [f, a, rnd() * 6.28]);
  const blob = (cx, cy, ra, rb, n, wv) => Array.from({ length: n }, (_, i) => {
    const t = i / n * 2 * Math.PI;
    const k = 1 + wv.reduce((acc, [f, a, ph]) => acc + a * Math.sin(f * t + ph), 0);
    const x = cx + rb * k * Math.cos(t), y = cy + ra * k * Math.sin(t);
    return toLL(x * Math.cos(rot) + y * Math.sin(rot), -x * Math.sin(rot) + y * Math.cos(rot));
  });
  const rings = [blob(0, 0, aKm, bKm, 420, waves)];
  for (let i = 0; i < 14; i++) {
    const t = rnd() * 2 * Math.PI, d = 1.04 + rnd() * 0.22, r = 0.25 + rnd() * 0.7;
    const isl = [[3, 0.25, rnd() * 6.28], [7, 0.12, rnd() * 6.28]];
    rings.push(blob(bKm * d * Math.cos(t), aKm * d * Math.sin(t), r, r * (0.6 + rnd() * 0.6), 48, isl));
  }
  return rings;
}

// Soft glow primitives for the zones canvas (g = 2D context, pt = {x, y} in container px).
function glow(g, pt, r, rgb, a) {
  if (a <= 0.01 || r < 1) return;
  const grd = g.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r);
  grd.addColorStop(0, `rgba(${rgb}, ${0.55 * a})`);
  grd.addColorStop(0.45, `rgba(${rgb}, ${0.32 * a})`);
  grd.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = grd;
  g.beginPath(); g.arc(pt.x, pt.y, r, 0, Math.PI * 2); g.fill();
}
function glowPath(g, pts, width, rgb, a) {
  if (a <= 0.01 || pts.length < 2) return;
  g.save();
  g.lineCap = "round"; g.lineJoin = "round";
  for (const [w, al] of [[width * 2.4, 0.12], [width * 1.3, 0.22], [width * 0.6, 0.35]]) {
    g.strokeStyle = `rgba(${rgb}, ${al * a})`; g.lineWidth = w;
    g.shadowColor = `rgba(${rgb}, ${0.5 * a})`; g.shadowBlur = width;
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
  }
  g.restore();
}
const kmToPx = (map, lat, km) => km * 1000 / (40075016 * Math.cos(lat * Math.PI / 180) / (256 * 2 ** map.getZoom()));

// Turbine counts on site. Southaven: units added by each snapshot in the inventory (Appendix A) of MDEQ's
// Agreed Order with MZX Tech, Jul 30, 2026. Colossus 1: NAACP complaint (alleged, 16 and 35), Shelby County permit (15).
// Mirrors data/turbines.json; see that file for status and links.
// SOURCE NEEDED: Colossus 1's 26 (mid-2025), Southaven's 3 (early Aug 2025) and 58 (after the Aug 31, 2026 shutdowns)
// are not in the Nov 2026 research package.
const TURBINES = {
  LOWRY: [[2024.6, 16], [2025.25, 35], [2025.45, 26], [2025.5, 15]],
  SOUTHAVEN: [[2025.58, 3], [2025.66, 18], [2026.01, 27], [2026.33, 51], [2026.35, 58], [2026.45, 60], [2026.54, 69], [2026.66, 58]]
};

// Step function over dated values: [[year, value], ...] → value in force at `year`.
const stepAt = (series, year) => series.reduce((v, [y, val]) => (year >= y ? val : v), 0);

// =====================================================================================
export const LAYERS = {
  // TVA service area: a rigid hairline boundary.
  tvaZone(ctx) {
    let layer;
    return {
      async enter() {
        const data = await ctx.data("tva-service-area.geojson");
        layer = L.geoJSON(data, { style: { className: "ink ink--boundary", weight: 1, fill: false }, interactive: false }).addTo(ctx.map);
      },
      update() {},
      exit() { layer?.remove(); }
    };
  },

  // The two protagonists as pins with glows.
  sitePins(ctx) {
    const SITES = {
      oakRidge: { ll: PLACES.x10, label: "Oak Ridge", sub: "1942", rgb: BLUE },
      colossus: { ll: PLACES.colossus1, label: "Colossus", sub: "2024", rgb: ORANGE, kind: "accent" }
    };
    let group, show;
    return {
      enter(opts) {
        show = opts.show || Object.keys(SITES);
        group = L.layerGroup(show.map(k => pin(SITES[k].ll, SITES[k].label, { sub: SITES[k].sub, kind: SITES[k].kind }))).addTo(ctx.map);
        ctx.zones.set("sitePins", (g, P) => show.forEach(k => glow(g, P(SITES[k].ll), 60, SITES[k].rgb, 0.9)));
      },
      update() {},
      exit() { group?.remove(); ctx.zones.delete("sitePins"); }
    };
  },

  // Clinton Engineer Works: approximate extent (17 mi × 7 mi), ellipse along the valley.
  reservation(ctx) {
    const shape = ellipse([35.99, -84.30], 13.7, 5.4, 58);
    const RAGGED = raggedRings([35.99, -84.30], 13.7, 5.4, 58, 7);
    let outline, label, faint;
    return {
      enter(opts) {
        faint = !!opts.faint;
        outline = ink(shape.concat([shape[0]]), { className: "ink ink--dashed" }).addTo(ctx.map);
        label = faint ? null : pin([36.07, -84.43], "Clinton Engineer Works", { sub: "≈59,000 acres · outline approximate", kind: "note" }).addTo(ctx.map);
        // Inside the outline, the land shows as it is today (satellite); outside stays paper.
        // Inside, the land shows as it is today (satellite), with a ragged edge that weaves in and
        // out past the rigid dashed outline; a few islands of imagery drift beyond it.
        ctx.satClip.set("reservation", {
          alpha: faint ? 0.55 : 0.92,
          path: (g, P) => RAGGED.forEach(ring => {
            ring.forEach((ll, i) => { const p = P(ll); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
            g.closePath();
          })
        });
        ctx.zones.set("reservation", (g, P, state) => {
          const a = faint ? 0.25 : ramp(state.year, 1942.7, 1942.8) * 0.6;
          const c = P([35.99, -84.30]);
          g.save(); g.translate(c.x, c.y); g.rotate(58 * Math.PI / 180 - Math.PI / 2); g.scale(1, 5.4 / 13.7);
          glow(g, { x: 0, y: 0 }, kmToPx(ctx.map, 36, 15), BLUE, a);
          g.restore();
        });
      },
      update() {},
      exit() { outline?.remove(); label?.remove(); ctx.zones.delete("reservation"); ctx.satClip.delete("reservation"); }
    };
  },

  // Communities removed in winter 1942–43: each glow goes out as its notice runs down.
  displacement(ctx) {
    const TOWNS = [
      ["wheat", "Wheat", 1942.93], ["robertsville", "Robertsville", 1942.97],
      ["scarboro", "Scarboro", 1943.0], ["elza", "Elza", 1943.03]
    ];
    let group, markers;
    return {
      enter() {
        markers = TOWNS.map(([k, name]) => pin(PLACES[k], name, { kind: "town" }));
        group = L.layerGroup(markers).addTo(ctx.map);
        ctx.zones.set("displacement", (g, P, state) => TOWNS.forEach(([k, , gone]) =>
          glow(g, P(PLACES[k]), 46, ORANGE, 1 - ramp(state.year, gone - 0.05, gone))));
      },
      update(state) {
        TOWNS.forEach(([, , gone], i) => markers[i].getElement()?.classList.toggle("is-gone", state.year >= gone));
      },
      exit() { group?.remove(); ctx.zones.delete("displacement"); }
    };
  },

  // Y-12, X-10, K-25, S-50 appear at their start dates; glows swell with operation.
  oakRidgePlants(ctx) {
    const PLANTS = [
      ["y12", "Y-12", "calutrons · Feb 1943", 1943.08],
      ["x10", "X-10", "graphite reactor · Nov 1943", 1943.84],
      ["k25", "K-25", "gaseous diffusion · 1943–45", 1943.5],
      ["s50", "S-50", "thermal diffusion · 69 days", 1944.52]
    ];
    let group, list, markers;
    return {
      enter(opts) {
        list = PLANTS.filter(p => !opts.only || opts.only.includes(p[0]));
        markers = list.map(([k, name, sub]) => pin(PLACES[k], name, { sub, kind: "plant" }));
        group = L.layerGroup().addTo(ctx.map);
        ctx.zones.set("plants", (g, P, state) => list.forEach(([k, , , y0]) =>
          glow(g, P(PLACES[k]), 70, BLUE, ramp(state.year, y0, y0 + 0.6))));
      },
      update(state) {
        list.forEach(([, , , y0], i) => {
          const want = state.year >= y0 - 0.02;
          want ? group.addLayer(markers[i]) : group.removeLayer(markers[i]);
        });
      },
      exit() { group?.remove(); ctx.zones.delete("plants"); }
    };
  },

  // TVA hydro feeding the plants: rigid feed lines from Norris and Watts Bar dams.
  tvaPower(ctx) {
    let group;
    return {
      enter() {
        group = L.layerGroup([
          pin(PLACES.norris, "Norris Dam", { sub: "TVA hydro, 1936", kind: "note" }),
          pin(PLACES.wattsBar, "Watts Bar Dam", { sub: "TVA hydro, 1942", kind: "note", side: "left" }),
          ink([PLACES.norris, PLACES.y12], { className: "ink ink--feed" }),
          ink([PLACES.wattsBar, PLACES.k25], { className: "ink ink--feed" })
        ]).addTo(ctx.map);
      },
      update() {},
      exit() { group?.remove(); }
    };
  },

  // Manhattan Project network; routes draw themselves through 1944–45.
  manhattanNetwork(ctx) {
    const SITES = [
      ["x10", "Oak Ridge", "uranium", 1942.7],
      ["chicago", "Chicago", "Pile-1 · Dec 1942", 1942.92],
      ["losAlamos", "Los Alamos", "design · 1943", 1943.0],
      ["hanford", "Hanford", "plutonium · Sep 1944", 1944.73],
      ["trinity", "Trinity", "Jul 16, 1945", 1945.54]
    ];
    const ROUTES = [
      { path: [PLACES.x10, PLACES.chicago, PLACES.lamy, PLACES.losAlamos], from: 1944.2, to: 1945.25, cls: "ink ink--route" },
      { path: [PLACES.hanford, PLACES.losAlamos], from: 1945.1, to: 1945.4, cls: "ink ink--route ink--faint" },
      { path: [PLACES.losAlamos, PLACES.trinity], from: 1945.45, to: 1945.54, cls: "ink ink--route" }
    ];
    let group, markers, lines;
    return {
      enter() {
        group = L.layerGroup().addTo(ctx.map);
        markers = SITES.map(([k, name, sub]) => pin(PLACES[k], name, { sub, kind: k === "x10" ? "accent" : "plant", side: k === "trinity" ? "left" : "right" }));
        lines = ROUTES.map(r => ink([r.path[0]], { className: r.cls }).addTo(group));
        ctx.zones.set("network", (g, P, state) => {
          SITES.forEach(([k, , , y0]) => glow(g, P(PLACES[k]), 40, BLUE, ramp(state.year, y0, y0 + 0.3) * 0.8));
          // Trinity: a brief bloom, then an afterglow.
          const t = state.year - 1945.54;
          if (t >= 0) glow(g, P(PLACES.trinity), 140 - 60 * clamp01(t / 0.06), ORANGE, 1 - 0.5 * clamp01(t / 0.06));
        });
      },
      update(state) {
        SITES.forEach(([, , , y0], i) => (state.year >= y0 ? group.addLayer(markers[i]) : group.removeLayer(markers[i])));
        ROUTES.forEach((r, i) => lines[i].setLatLngs(partial(r.path, ramp(state.year, r.from, r.to))));
      },
      exit() { group?.remove(); ctx.zones.delete("network"); }
    };
  },

  // Mercury in East Fork Poplar Creek: releases 1950–63, a glow that never fully fades.
  mercury(ctx) {
    let line, coords, label;
    const level = y => (y < 1963 ? ramp(y, 1950, 1963) : 1 - 0.45 * ramp(y, 1963, 1995));
    return {
      async enter() {
        const data = await ctx.data("story/data/efpc.geojson");
        const g = data.features[0].geometry;
        coords = (g.type === "LineString" ? [g.coordinates] : g.coordinates).map(part => part.map(([x, y]) => [y, x]));
        line = ink(coords, { className: "ink ink--water" }).addTo(ctx.map);
        label = pin([36.012, -84.235], "East Fork Poplar Creek", { kind: "note", sub: "do not eat the fish" }).addTo(ctx.map);
        ctx.zones.set("mercury", (gx, P, state) => coords.forEach(part =>
          glowPath(gx, part.map(P), 26, BLUE, level(state.year))));
      },
      update() {},
      exit() { line?.remove(); label?.remove(); ctx.zones.delete("mercury"); }
    };
  },

  // TVA transmission network appearing by in-service year (recorded or estimated).
  gridGrowth(ctx) {
    const renderer = L.canvas({ padding: 0.3 });
    let layer, items = [];
    return {
      async enter() {
        const data = await ctx.data("tva-lines-timeline.geojson");
        const W = { 500: 1.4, 230: 1.1, 161: 0.7, lt100: 0.5, na: 0.4 };
        layer = L.geoJSON(data, {
          renderer, interactive: false,
          style: f => ({ color: ctx.css("--ink"), weight: W[f.properties.c], opacity: f.properties.m ? 0.35 : 0.75 })
        }).addTo(ctx.map);
        items = []; layer.eachLayer(l => items.push({ l, y: l.feature.properties.y, on: true }));
      },
      update(state) {
        items.forEach(it => {
          const want = it.y <= state.year;
          if (want !== it.on) { want ? layer.addLayer(it.l) : layer.removeLayer(it.l); it.on = want; }
        });
      },
      exit() { layer?.remove(); }
    };
  },

  // Soft heat of generating capacity in service (NOT per-capita use).
  capacityHeat(ctx) {
    let plants = [];
    return {
      async enter() {
        plants = (await ctx.data("tva-plants-timeline.geojson")).features;
        ctx.zones.set("heat", (g, P, state) => {
          const z = ctx.map.getZoom();
          plants.forEach(f => {
            let mw = 0;
            for (const [y0, y1, m] of f.properties.g) if (y0 <= state.year && (!y1 || state.year < y1)) mw += m;
            if (mw) glow(g, P([f.geometry.coordinates[1], f.geometry.coordinates[0]]), Math.sqrt(mw) * 1.3 * 2 ** (z - 7), BLUE, 0.55);
          });
        });
      },
      update() {},
      exit() { ctx.zones.delete("heat"); }
    };
  },

  // Colossus 1, Colossus 2 and the Southaven turbine yard, by month.
  colossus(ctx) {
    const { LOWRY, SOUTHAVEN } = TURBINES;
    let group, c2, yard, monitor, counter, quiet;
    return {
      enter(opts = {}) {
        quiet = !!opts.quiet;
        group = L.layerGroup([
          pin(PLACES.colossus1, "Colossus 1", { sub: "Paul R. Lowry Rd · 2024", kind: "accent" }),
          ink([PLACES.colossus2, PLACES.southaven], { className: "ink ink--dashed" })
        ]).addTo(ctx.map);
        c2 = pin(PLACES.colossus2, "Colossus 2", { sub: "Tulane Rd · 2025", kind: "accent" });
        yard = pin(PLACES.southaven, "Southaven turbines", { sub: "", kind: "plant", side: "left" });
        monitor = pin(PLACES.memphisNcore, "O₃ 74 ppb", { sub: "2025 · above the 70 ppb standard", kind: "note" });
        counter = { lowry: 0, south: 0 };
        ctx.zones.set("colossus", (g, P, state) => {
          const z = ctx.map.getZoom();
          // Air: soft orange, grows with turbines running. Noise: rigid rings (illustrative radii).
          [[PLACES.colossus1, counter.lowry], [PLACES.southaven, counter.south]].forEach(([ll, n]) => {
            if (!n) return;
            const c = P(ll);
            if (!quiet) {
              glow(g, c, kmToPx(ctx.map, ll[0], 1.2 + Math.sqrt(n) * 0.6), ORANGE, 0.85);
              g.save(); g.strokeStyle = "rgba(20, 20, 20,0.35)"; g.lineWidth = 0.8; g.setLineDash([2, 4]);
              [0.5, 1, 2].forEach(km => { g.beginPath(); g.arc(c.x, c.y, kmToPx(ctx.map, ll[0], km), 0, Math.PI * 2); g.stroke(); });
              g.restore();
            }
            // Turbines as a rigid grid of squares beside the site.
            const s = Math.max(2, Math.min(6, 2 ** (z - 11) * 3)), cols = 10;
            g.fillStyle = "rgba(20, 20, 20,0.85)";
            for (let i = 0; i < n; i++) g.fillRect(c.x + 14 + (i % cols) * (s + 2), c.y + 10 + Math.floor(i / cols) * (s + 2), s, s);
          });
        });
      },
      update(state) {
        counter.lowry = stepAt(LOWRY, state.year);
        counter.south = stepAt(SOUTHAVEN, state.year);
        state.year >= 2025.5 ? group.addLayer(c2) : group.removeLayer(c2);
        if (counter.south) {
          group.addLayer(yard);
          yard.getElement()?.querySelector("em")?.replaceChildren(`${counter.south} turbines · ≈${Math.round(counter.south * 25.7)} MW est.`);
        } else group.removeLayer(yard);
        state.year >= 2025 && !quiet ? group.addLayer(monitor) : group.removeLayer(monitor);
      },
      exit() { group?.remove(); ctx.zones.delete("colossus"); }
    };
  },

  // Census tracts shaded by share of Black residents, with rigid 3-mile rings and their figures.
  raceTracts(ctx) {
    const renderer = L.canvas({ padding: 0.3 });
    let layer, group;
    return {
      async enter() {
        const data = await ctx.data("story/data/tracts-memphis.geojson");
        const ring = data.properties.ring3mi;
        layer = L.geoJSON(data, {
          renderer, interactive: false,
          // Single warm hue, light → dark with the share; hairline tract edges keep it "technical".
          style: f => ({ color: "#141414", weight: 0.4, opacity: 0.35, fillColor: "#c4532b", fillOpacity: 0.06 + 0.55 * (f.properties.black / 100) })
        }).addTo(ctx.map);
        const mi3 = 4828;
        group = L.layerGroup([
          L.circle(PLACES.colossus1, { radius: mi3, className: "ink ink--dashed", fill: false, interactive: false }),
          L.circle(PLACES.southaven, { radius: mi3, className: "ink ink--dashed", fill: false, interactive: false }),
          pin([PLACES.colossus1[0] + 0.05, PLACES.colossus1[1] - 0.02], `${ring.colossus1}% Black`, { sub: "within 3 mi of Colossus 1", kind: "note" }),
          pin([PLACES.southaven[0] - 0.05, PLACES.southaven[1] + 0.03], `${ring.southaven}% Black`, { sub: "within 3 mi of the turbines", kind: "note" }),
          pin([34.93, -90.2], "Tennessee | Mississippi", { sub: "state line", kind: "note" })
        ]).addTo(ctx.map);
      },
      update() {},
      exit() { layer?.remove(); group?.remove(); }
    };
  },

  // Heat map of estimated NOx: each source's tons/yr spread with a Gaussian falloff, colored on a warm ramp.
  // Illustrative only: emissions, not modeled or measured concentrations.
  airHeat(ctx) {
    const TONS_PER_TURBINE = 1600 / 35;   // SELC estimate (1,200–2,000 t for 35 turbines), midpoint per unit
    const SIGMA_KM = 3.2, SCALE = 1000, RES = 4;
    const RAMP = [[0, [255, 240, 200, 0]], [0.12, [255, 226, 160, 70]], [0.35, [244, 160, 80, 130]], [0.65, [214, 84, 48, 175]], [1, [130, 26, 40, 205]]];
    const color = t => {
      for (let k = 1; k < RAMP.length; k++) if (t <= RAMP[k][0]) {
        const [t0, c0] = RAMP[k - 1], [t1, c1] = RAMP[k], f = (t - t0) / (t1 - t0);
        return c0.map((v, i) => v + (c1[i] - v) * f);
      }
      return RAMP[RAMP.length - 1][1];
    };
    const off = document.createElement("canvas");
    let fixed = [], legend;
    return {
      async enter() {
        const plants = (await ctx.data("tva-plants-timeline.geojson")).features;
        // Measured 2025 NOx (EPA CAMPD) for nearby gas plants, plus the airport for scale.
        fixed = plants.filter(f => f.properties.em && ["Allen", "TVA Southaven Combined Cycle"].includes(f.properties.n))
          .map(f => ({ ll: [f.geometry.coordinates[1], f.geometry.coordinates[0]], tons: f.properties.em[1] }));
        fixed.push({ ll: PLACES.memphisAirport, tons: 1077 });
        legend = L.DomUtil.create("div", "heat-legend", ctx.map.getContainer());
        legend.innerHTML = `<b>Estimated NOx</b><i></i><span>lower</span><span>higher</span><em>Spread of estimated emissions, not measured air quality</em>`;
        ctx.zones.set("airHeat", (g, P, state) => {
          const size = ctx.map.getSize(), w = Math.ceil(size.x / RES), h = Math.ceil(size.y / RES);
          const sources = [
            ...fixed,
            { ll: PLACES.colossus1, tons: stepAt(TURBINES.LOWRY, state.year) * TONS_PER_TURBINE },
            { ll: PLACES.southaven, tons: stepAt(TURBINES.SOUTHAVEN, state.year) * TONS_PER_TURBINE }
          ].filter(src => src.tons > 0).map(src => { const p = P(src.ll); return { x: p.x / RES, y: p.y / RES, tons: src.tons }; });
          const sig = kmToPx(ctx.map, 35, SIGMA_KM) / RES, inv = 1 / (2 * sig * sig);
          off.width = w; off.height = h;
          const og = off.getContext("2d"), img = og.createImageData(w, h);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            let v = 0;
            for (const src of sources) { const dx = x - src.x, dy = y - src.y; v += src.tons * Math.exp(-(dx * dx + dy * dy) * inv); }
            if (v < 15) continue;
            const c = color(Math.min(1, v / SCALE)), i = (y * w + x) * 4;
            img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = c[3];
          }
          og.putImageData(img, 0, 0);
          g.save(); g.imageSmoothingEnabled = true; g.drawImage(off, 0, 0, size.x, size.y); g.restore();
        });
      },
      update() {},
      exit() { ctx.zones.delete("airHeat"); legend?.remove(); }
    };
  },

  // Reference emitter for scale: Memphis International Airport's NOx.
  airCompare(ctx) {
    let group;
    return {
      enter() {
        group = L.layerGroup([
          pin(PLACES.memphisAirport, "Memphis airport", { sub: "1,077 t NOx / yr", kind: "note" })
        ]).addTo(ctx.map);
      },
      update() {},
      exit() { group?.remove(); }
    };
  },

  // Rigid distance rings around the Southaven yard, labeled with the reported readings.
  noiseRings(ctx) {
    let group;
    return {
      enter() {
        group = L.layerGroup([
          ...[500, 1000, 2000].map(r => L.circle(PLACES.southaven, { radius: r, className: "ink ink--dashed", fill: false, interactive: false })),
          pin([34.9795, -90.0335], "60–65 dB", { sub: "Stanton Rd, Jan 2026 (TV crew)", kind: "note" }),
          pin([34.9905, -90.0505], "40s–70s dB", { sub: "residents' meters, in & outdoors", kind: "note", side: "left" })
        ]).addTo(ctx.map);
        // Soft sound: pale concentric pulses.
        ctx.zones.set("noise", (g, P) => {
          const c = P(PLACES.southaven);
          [0.5, 1, 1.5, 2].forEach((km, i) => glow(g, c, kmToPx(ctx.map, 35, km), BLUE, 0.35 - i * 0.07));
        });
      },
      update() {},
      exit() { group?.remove(); ctx.zones.delete("noise"); }
    };
  },

  // Context: U.S. DOT BTS National Transportation Noise Map 2022 (road + rail + aviation).
  noiseTiles(ctx) {
    let layer;
    return {
      enter() {
        // Own pane: the basemap's tile pane is filtered to grayscale, which would kill the noise colors.
        if (!ctx.map.getPane("noise")) {
          ctx.map.createPane("noise").style.zIndex = 330;
          ctx.map.getPane("noise").style.pointerEvents = "none";
        }
        layer = L.tileLayer("https://tiles.arcgis.com/tiles/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Noise_2022_CONUS_aviation_rail_road/MapServer/tile/{z}/{y}/{x}", {
          pane: "noise", maxNativeZoom: 12, maxZoom: 17, opacity: 0.4, className: "noise-tiles",
          attribution: "Transportation noise only (road, rail, air; no turbines): U.S. DOT BTS National Transportation Noise Map 2022"
        }).addTo(ctx.map);
      },
      update() {},
      exit() { layer?.remove(); }
    };
  },

  // A single rigid line across the valley: Oak Ridge ↔ Colossus.
  parallelLink(ctx) {
    let group;
    return {
      enter() {
        group = L.layerGroup([
          ink([PLACES.x10, PLACES.colossus1], { className: "ink ink--dashed" }),
          pin([35.55, -87.2], "334 mi · 82 years", { kind: "note" })
        ]).addTo(ctx.map);
      },
      update() {},
      exit() { group?.remove(); }
    };
  }
};
