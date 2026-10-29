// =====================================================================================
//  STORY ENGINE — scroll → chapter/step/progress → year → layers + camera + HUD.
//  You shouldn't need to edit this to change content (see chapters.js / layers.js).
// =====================================================================================
import { CHAPTERS, TAGS, META, EXPLAINER, TESTIMONIES, PLACES } from "./chapters.js?v=2026-10-28l";
import { LAYERS } from "./layers.js?v=2026-10-28l";

const L = window.L;
const DATA_VERSION = "2026-10-28l";
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");
const HOLD = 0.14;  // first/last 14% of each chapter holds at its start/end year
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- map ----------
const map = L.map("map", { zoomControl: false, attributionControl: true, zoomSnap: 0, minZoom: 3, maxZoom: 17 })
  .setView(CHAPTERS[0].camera.center, CHAPTERS[0].camera.zoom);
L.control.zoom({ position: "bottomright" }).addTo(map);
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
L.tileLayer(`${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
  maxZoom: 16, maxNativeZoom: 16, attribution: "Tiles © Esri"
}).addTo(map);
map.createPane("labels").style.zIndex = 450;
map.getPane("labels").style.pointerEvents = "none";
L.tileLayer(`${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { pane: "labels", maxZoom: 16, maxNativeZoom: 16 }).addTo(map);

// Satellite imagery is loaded invisibly; the lens paints it into revealed cells only.
map.createPane("detail").style.zIndex = 210;
const satellite = L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
  pane: "detail", opacity: 0, maxZoom: 17, maxNativeZoom: 17, attribution: "Imagery © Esri, Vantor, Earthstar Geographics"
});

// A canvas pinned to the viewport inside a map pane (map panes are transformed, so overlays must live inside).
const ViewCanvas = L.Layer.extend({
  initialize(pane, draw) { this._paneName = pane; this._draw = draw; },
  onAdd(m) {
    this._c = L.DomUtil.create("canvas", "view-canvas", m.getPane(this._paneName));
    m.on("move zoom viewreset resize", this._reset, this);
    this._reset();
  },
  onRemove(m) { m.off("move zoom viewreset resize", this._reset, this); this._c.remove(); },
  _reset() {
    L.DomUtil.setPosition(this._c, map.containerPointToLayerPoint([0, 0]));
    this.redraw();
  },
  redraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const size = map.getSize(), dpr = window.devicePixelRatio || 1;
      // Re-check the pixel size every frame: window resizes and screen changes both alter it.
      if (this._c.width !== size.x * dpr || this._c.height !== size.y * dpr) {
        this._c.width = size.x * dpr; this._c.height = size.y * dpr;
        this._c.style.width = `${size.x}px`; this._c.style.height = `${size.y}px`;
      }
      const g = this._c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, this._c.width, this._c.height);
      this._draw(g, map.getSize());
    });
  }
});

// ---------- soft zones: layers register draw functions here ----------
map.createPane("zones").style.zIndex = 360;
map.getPane("zones").style.pointerEvents = "none";
const zoneFns = new Map();
const project = ll => map.latLngToContainerPoint(ll);
const zones = new ViewCanvas("zones", g => zoneFns.forEach(fn => fn(g, project, state)));
zones.addTo(map);
const zonesApi = {
  set: (id, fn) => { zoneFns.set(id, fn); zones.redraw(); },
  delete: id => { zoneFns.delete(id); zones.redraw(); }
};

// ---------- cursor lens: a cell grid; near the cursor, cells open onto finer detail ----------
map.createPane("lens").style.zIndex = 340;
map.getPane("lens").style.pointerEvents = "none";
const CELL = 7, LENS_R = 120, GRID = CELL * 4, touch = matchMedia("(hover: none)").matches;
let cursor = null, lensMode = "none";
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
// Satellite fills: layers register shapes that should show imagery inside them (e.g. the reservation).
const satClips = new Map();
function paintSatellite(g) {
  const mapBox = map.getContainer().getBoundingClientRect();
  Object.values(satellite._tiles || {}).forEach(t => {
    if (!t.el.complete || !t.el.naturalWidth) return;
    const r = t.el.getBoundingClientRect();
    g.drawImage(t.el, r.left - mapBox.left, r.top - mapBox.top, r.width, r.height);
  });
}
const lens = new ViewCanvas("lens", (g, size) => {
  const ox = 0, oy = 0;  // grid anchored to the viewport: technical, not geographic
  // Faint full-map grid at 4× the cell size; every 4th line slightly stronger.
  g.lineWidth = 1;
  for (let x = ox, i = 0; x < size.x; x += GRID, i++) {
    g.strokeStyle = i % 4 ? "rgba(20, 20, 20,0.035)" : "rgba(20, 20, 20,0.07)";
    g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, size.y); g.stroke();
  }
  for (let y = oy, j = 0; y < size.y; y += GRID, j++) {
    g.strokeStyle = j % 4 ? "rgba(20, 20, 20,0.035)" : "rgba(20, 20, 20,0.07)";
    g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(size.x, y + 0.5); g.stroke();
  }
  satClips.forEach(({ path, alpha = 1 }) => {
    g.save(); g.globalAlpha = alpha;
    g.beginPath(); path(g, project); g.clip();
    paintSatellite(g);
    g.restore();
  });
  const c = cursor || (touch ? { x: size.x / 2, y: size.y / 2 } : null);
  if (!c) return;
  // Pick cells: solid core, dithered edge (like a halftone falling apart).
  const cells = [];
  const i0 = Math.floor((c.x - LENS_R) / CELL), i1 = Math.ceil((c.x + LENS_R) / CELL);
  const j0 = Math.floor((c.y - LENS_R) / CELL), j1 = Math.ceil((c.y + LENS_R) / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const d = Math.hypot(i * CELL + CELL / 2 - c.x, j * CELL + CELL / 2 - c.y);
    const t = (d - LENS_R * 0.45) / (LENS_R * 0.55);
    if (t < 0 || (t < 1 && hash(i, j) > t)) cells.push([i * CELL, j * CELL]);
  }
  if (lensMode === "satellite") {
    g.save();
    g.beginPath(); cells.forEach(([x, y]) => g.rect(x, y, CELL, CELL)); g.clip();
    paintSatellite(g);
    g.restore();
  }
  g.strokeStyle = "rgba(20, 20, 20,0.22)"; g.lineWidth = 0.5;
  cells.forEach(([x, y]) => g.strokeRect(x + 0.25, y + 0.25, CELL - 0.5, CELL - 0.5));
  // Crosshair readout.
  const ll = map.containerPointToLatLng([c.x, c.y]);
  g.fillStyle = "rgba(20, 20, 20,0.75)"; g.font = "10px 'IBM Plex Mono', monospace";
  g.fillText(`${ll.lat.toFixed(4)}° N  ${Math.abs(ll.lng).toFixed(4)}° W`, c.x + 10, c.y - 10);
});
lens.addTo(map);
map.getContainer().addEventListener("mousemove", e => {
  const r = map.getContainer().getBoundingClientRect();
  cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
  lens.redraw();
});
map.getContainer().addEventListener("mouseleave", () => { cursor = null; lens.redraw(); });
satellite.on("tileload", () => lens.redraw());
function syncSatellite() {
  const need = lensMode === "satellite" || satClips.size > 0;
  if (need && !map.hasLayer(satellite)) satellite.addTo(map);
  if (!need && map.hasLayer(satellite)) map.removeLayer(satellite);
  lens.redraw();
}
function setLens(mode) { lensMode = mode; syncSatellite(); }
const satClipApi = {
  set: (id, clip) => { satClips.set(id, clip); syncSatellite(); },
  delete: id => { satClips.delete(id); syncSatellite(); }
};

// ---------- data (cached, version-tagged) ----------
const cache = new Map();
const data = name => {
  if (!cache.has(name)) cache.set(name, fetch(`${name}?v=${DATA_VERSION}`).then(r => r.json()));
  return cache.get(name);
};
const ctx = { map, zones: zonesApi, satClip: satClipApi, data, css };

// ---------- text column ----------
const textEl = document.getElementById("chapters");
document.getElementById("story-title").textContent = META.title;
document.getElementById("story-subtitle").textContent = META.subtitle;
const pad = n => String(n).padStart(2, "0");
// Explainer slide between the cover and chapter 1.
if (EXPLAINER) {
  const ex = document.createElement("section");
  ex.className = "explainer";
  ex.innerHTML = `<p class="ex-kicker">Before you begin</p><h2 class="ex-title">${EXPLAINER.title}</h2>` +
    EXPLAINER.items.map((it, k) => `
      <div class="ex-item">
        <div class="ex-head"><h3>${it.title}</h3><span>${k + 1}</span></div>
        <p class="ex-sub">${it.sub}</p>
        <ul class="ex-chips">${it.chips.map(c => `<li>${c}</li>`).join("")}</ul>
      </div>`).join("");
  textEl.before(ex);
}
CHAPTERS.forEach((ch, ci) => {
  const sec = document.createElement("section");
  sec.className = "chapter";
  sec.dataset.i = ci;
  sec.innerHTML = `
    <header class="ch-head">
      <p class="ch-kicker"><span>${pad(ci + 1)} / ${pad(CHAPTERS.length)}</span> ${ch.tags.map(t => `<i class="tag tag--${TAGS[t].style}" title="${TAGS[t].label}"></i>`).join("")}</p>
      <h2>${ch.title}</h2>
      <p class="ch-span">${fmtYear(ch.timeline.from, ch.timeline)} — ${fmtYear(ch.timeline.to, ch.timeline)}</p>
    </header>
    ${ch.steps.map((s, si) => `<div class="step" data-step="${si}">${figure(s.image)}${s.html}</div>`).join("")}`;
  textEl.appendChild(sec);
});

// Layer stack legend (physical → intangible).
document.getElementById("stack").innerHTML = Object.entries(TAGS)
  .map(([k, t]) => `<li data-tag="${k}"><i class="tag tag--${t.style}"></i>${t.label}</li>`).join("");

function figure(img) {
  if (!img) return "";
  return `<figure class="photo"><img src="${img.src}" alt="${img.caption}" loading="lazy"><figcaption>${img.caption}<span>${img.credit}</span></figcaption></figure>`;
}

function fmtYear(y, span) {
  if (span.to - span.from > 6) return String(Math.floor(y + 1e-6));
  const yr = Math.floor(y + 1e-6), m = Math.min(11, Math.floor((y - yr) * 12 + 1e-6));
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]} ${yr}`;
}


// ---------- interlude: a time-lapse that takes over the stage ----------
const il = {
  root: document.getElementById("interlude"), year: document.getElementById("il-year"),
  list: document.getElementById("il-list"), chip: document.getElementById("il-chip-n"),
  stage: document.querySelector(".stage"), map: document.getElementById("map")
};
function setupInterlude(ch) {
  const on = !!ch.interlude;
  il.root.hidden = !on;
  il.stage.classList.toggle("is-interlude", on);
  if (!on) { il.map.style.opacity = ""; il.root.style.opacity = ""; return; }
  il.list.innerHTML = ch.interlude.milestones
    .map(([y, title, sub]) => `<li data-y="${y}"><span>${y}</span><b>${title}</b><em>${sub}</em></li>`).join("");
}
function fmtCount(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} billion`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million`;
  return Math.round(n).toLocaleString("en-US");
}
function updateInterlude(ch, year, p) {
  const { milestones, transistors } = ch.interlude;
  il.year.textContent = Math.floor(year);
  let latest = -1;
  [...il.list.children].forEach((li, k) => {
    const on = year >= +li.dataset.y;
    li.classList.toggle("on", on);
    if (on) latest = k;
  });
  [...il.list.children].forEach((li, k) => li.classList.toggle("now", k === latest));
  // Transistors per chip, log-interpolated between the known points.
  const T = transistors;
  let n = T[0][1];
  for (let k = 0; k < T.length - 1; k++) {
    if (year >= T[k][0]) {
      const t = Math.min(1, (year - T[k][0]) / (T[k + 1][0] - T[k][0]));
      n = Math.exp(Math.log(T[k][1]) + (Math.log(T[k + 1][1]) - Math.log(T[k][1])) * t);
    }
  }
  il.chip.textContent = fmtCount(n);
  // The grid races with time; at the very end the overlay lifts and the map returns over Memphis.
  il.stage.style.setProperty("--il-p", p.toFixed(3));
  const lift = Math.max(0, Math.min(1, (p - 0.8) / 0.16));
  il.root.style.opacity = String(1 - lift);
  il.map.style.opacity = String(0.16 + 0.84 * lift);
}

// ---------- testimonies: quote markers by the sites; hover (or tap) to read ----------
const tGroup = L.layerGroup().addTo(map);
const tCard = document.getElementById("testimony");
function showTestimonies(list, e) {
  clearTimeout(tHide);
  // Quote first, then a quiet attribution line; sources are links (the card stays open while hovered).
  tCard.innerHTML = list.map(t => `
    <article>
      <blockquote>“${t.text}”</blockquote>
      <p class="t-who">${t.speaker}${t.year ? `, ${t.year}` : ""}</p>
      ${t.source ? `<a class="t-src" href="${t.url}" target="_blank" rel="noopener">${t.source} ↗</a>` : ""}
    </article>`).join("");
  tCard.hidden = false;
  const stage = document.querySelector(".stage").getBoundingClientRect();
  const x = e.originalEvent.clientX - stage.left, y = e.originalEvent.clientY - stage.top;
  tCard.style.left = `${Math.min(stage.width - tCard.offsetWidth - 16, x + 18)}px`;
  tCard.style.top = `${Math.max(16, Math.min(stage.height - tCard.offsetHeight - 16, y - tCard.offsetHeight / 2))}px`;
}
let tHide = 0;
const hideSoon = () => { clearTimeout(tHide); tHide = setTimeout(() => { tCard.hidden = true; }, 250); };
tCard.addEventListener("mouseenter", () => clearTimeout(tHide));
tCard.addEventListener("mouseleave", hideSoon);
function syncTestimonies(ch) {
  tGroup.clearLayers();
  tCard.hidden = true;
  const byPlace = {};
  TESTIMONIES.filter(t => t.chapters.includes(ch.id) && PLACES[t.place]).forEach(t => (byPlace[t.place] ||= []).push(t));
  Object.entries(byPlace).forEach(([place, list]) => {
    const m = L.marker(PLACES[place], {
      icon: L.divIcon({ className: "t-mark", html: `<span>❝</span>${list.length > 1 ? `<em>${list.length}</em>` : ""}`, iconSize: [22, 22], iconAnchor: [-6, 28] }),
      keyboard: true, title: "Testimony", zIndexOffset: 900
    });
    m.on("mouseover click", e => showTestimonies(list, e));
    m.on("mouseout", hideSoon);
    tGroup.addLayer(m);
  });
}
// ---------- state machine ----------
const state = { chapter: -1, step: -1, progress: 0, year: CHAPTERS[0].timeline.from };
let active = {};          // layerId → instance
let activeOpts = {};      // layerId → JSON of opts (to detect changes)
const hud = {
  num: document.getElementById("hud-num"), title: document.getElementById("hud-title"),
  from: document.getElementById("hud-from"), to: document.getElementById("hud-to"),
  now: document.getElementById("hud-now"), fill: document.getElementById("hud-fill"), knob: document.getElementById("hud-knob")
};
const dbg = document.getElementById("debug");
if (DEBUG) dbg.hidden = false;

async function enterChapter(ci) {
  const ch = CHAPTERS[ci];
  const next = ch.layers || {};
  for (const id of Object.keys(active)) {
    if (!(id in next) || JSON.stringify(next[id]) !== activeOpts[id]) { active[id].exit(); delete active[id]; delete activeOpts[id]; }
  }
  for (const [id, opts] of Object.entries(next)) {
    if (active[id]) continue;
    if (!LAYERS[id]) { console.warn(`Unknown layer "${id}" in chapter "${ch.id}"`); continue; }
    const inst = LAYERS[id](ctx);
    active[id] = inst; activeOpts[id] = JSON.stringify(opts);
    await inst.enter(opts);
    if (active[id] === inst) inst.update(state);
  }
  setLens(ch.lens || "none");
  syncTestimonies(ch);
  setupInterlude(ch);
  hud.num.textContent = `${pad(ci + 1)} / ${pad(CHAPTERS.length)}`;
  hud.title.textContent = ch.title;
  hud.from.textContent = fmtYear(ch.timeline.from, ch.timeline);
  hud.to.textContent = fmtYear(ch.timeline.to, ch.timeline);
  document.querySelectorAll("#stack li").forEach(li => li.classList.toggle("on", ch.tags.includes(li.dataset.tag)));
  document.querySelectorAll(".chapter").forEach(s => s.classList.toggle("is-active", +s.dataset.i === ci));
  zones.redraw();
}

function flyFor(ci, si) {
  const ch = CHAPTERS[ci], cam = ch.steps[si]?.camera || ch.camera;
  if (cam) map.flyTo(cam.center, cam.zoom, { duration: 1.6, easeLinearity: 0.2 });
}

function tick() {
  const mid = innerHeight * 0.5;
  const secs = [...textEl.children];
  let ci = secs.findIndex(s => { const r = s.getBoundingClientRect(); return r.top <= mid && r.bottom > mid; });
  if (ci < 0) ci = secs[0].getBoundingClientRect().top > mid ? 0 : secs.length - 1;
  const rect = secs[ci].getBoundingClientRect();
  const p = Math.max(0, Math.min(1, (mid - rect.top) / rect.height));
  const ch = CHAPTERS[ci];
  const q = Math.max(0, Math.min(1, (p - HOLD) / (1 - 2 * HOLD)));
  const qe = ch.ease === "accelerate" ? Math.pow(q, 1.7) : q;   // time speeds up as you scroll
  const year = ch.timeline.from + (ch.timeline.to - ch.timeline.from) * qe;
  const steps = [...secs[ci].querySelectorAll(".step")];
  let si = 0;
  steps.forEach((s, k) => { if (s.getBoundingClientRect().top < mid) si = k; });

  if (ci !== state.chapter) { state.chapter = ci; state.step = -1; enterChapter(ci); }
  if (si !== state.step) {
    state.step = si; flyFor(ci, si);
    steps.forEach((s, k) => s.classList.toggle("is-active", k === si));
  }
  state.progress = p; state.year = year;
  Object.values(active).forEach(l => l.update(state));
  zones.redraw();
  if (ch.interlude) updateInterlude(ch, year, p);
  hud.now.textContent = fmtYear(year, ch.timeline);
  hud.fill.style.width = `${q * 100}%`;
  hud.knob.style.left = `${q * 100}%`;
  if (DEBUG) dbg.textContent = `chapter ${ci} (${ch.id}) · step ${si} · progress ${p.toFixed(2)} · year ${year.toFixed(2)} · zoom ${map.getZoom().toFixed(2)}`;
}
let ticking = false;
const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; tick(); }); } };
addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", () => { map.invalidateSize(); onScroll(); });
map.on("moveend zoomend", () => zones.redraw());

// ?chapter=N jumps straight to a chapter (1-based).
const jump = +params.get("chapter");
if (jump >= 1 && jump <= CHAPTERS.length) {
  requestAnimationFrame(() => {
    const sec = textEl.children[jump - 1];
    scrollTo(0, sec.getBoundingClientRect().top + scrollY - innerHeight * 0.5 + 2);
    const ch = CHAPTERS[jump - 1];
    map.setView(ch.camera.center, ch.camera.zoom, { animate: false });
    tick();
  });
} else tick();
