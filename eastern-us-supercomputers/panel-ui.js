// =====================================================================================
//  PANEL UI — tabs, the phone bottom sheet, the first-visit card and "n on" badges.
//  Loaded last; shares the inline script's globals (map). Only moves the interface:
//  every layer still listens on its own input, so nothing here changes what is drawn.
// =====================================================================================
(() => {
  const $ = id => document.getElementById(id);
  // the inline script declares `const map` at top level: a global binding, not a window property
  const M = typeof map !== "undefined" ? map : null;
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode: not remembered */ } }
  };
  const body = document.body;
  const phone = window.matchMedia("(max-width: 640px)");
  const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
  const panelBody = $("panel-body");
  const handle = $("sheet-handle"), handleText = $("sheet-handle-text");
  const label = tab => tab.querySelector("span").textContent;
  const current = () => tabs.find(t => t.getAttribute("aria-selected") === "true") || tabs[0];

  // ---------- phone sheet: peek (a strip), half, full ----------
  const SHEETS = ["peek", "half", "full"];
  function setSheet(s) {
    if (!phone.matches) s = "half";             // desktop: the sidebar is always open
    body.dataset.sheet = s;
    const open = s !== "peek";
    handle.setAttribute("aria-expanded", String(open));
    handleText.textContent = open ? `${label(current())} · tap to show the map` : `${label(current())} · tap to open`;
    // the map's container changes size with the sheet on phones
    setTimeout(() => M?.invalidateSize({ pan: false }), 240);
  }
  handle.addEventListener("click", () => setSheet(SHEETS[(SHEETS.indexOf(body.dataset.sheet) + 1) % SHEETS.length]));

  // ---------- tabs ----------
  function select(tab, { focus = false } = {}) {
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")).hidden = !on;
    });
    store.set("map-tool-tab", tab.id);
    panelBody.scrollTop = 0;
    if (focus) tab.focus();
    if (phone.matches) handleText.textContent = `${label(tab)} · ${body.dataset.sheet === "peek" ? "tap to open" : "tap to show the map"}`;
  }
  tabs.forEach(tab => tab.addEventListener("click", () => {
    if (!phone.matches) return select(tab);
    // phone: a tab opens the sheet; tapping the open tab again puts it away
    if (body.dataset.sheet !== "peek" && tab === current()) return setSheet("peek");
    select(tab);
    if (body.dataset.sheet === "peek") setSheet("half");
  }));
  document.querySelector(".tabs").addEventListener("keydown", e => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(tabs[(next + tabs.length) % tabs.length], { focus: true });
  });
  const saved = $(store.get("map-tool-tab") || "");
  if (saved && tabs.includes(saved)) select(saved);

  // On phones, get the sheet out of the way whenever the map itself should be seen.
  const peekOnPhone = () => { if (phone.matches && body.dataset.sheet !== "peek") setSheet("peek"); };
  ["zoom-xai", "reset", "tl-play", "rec-add"].forEach(id => $(id)?.addEventListener("click", peekOnPhone));
  document.querySelector(".xr-list")?.addEventListener("click", peekOnPhone);
  if (M) M.on("popupopen", peekOnPhone);
  phone.addEventListener("change", () => setSheet(phone.matches ? "peek" : "half"));
  setSheet(phone.matches ? "peek" : "half");

  // Skip link: land in the tabs, and open the sheet on phones.
  document.querySelector(".skip-link")?.addEventListener("click", e => {
    e.preventDefault();
    if (phone.matches && body.dataset.sheet === "peek") setSheet("half");
    current().focus();
  });

  // ---------- first visit: how to use the map ----------
  const howto = $("howto");
  if (store.get("map-tool-howto") !== "done") howto.hidden = false;
  $("howto-close").addEventListener("click", () => {
    howto.hidden = true;
    store.set("map-tool-howto", "done");
    current().focus();
  });

  // ---------- "n on" badge on each card, so a closed card still says what it shows ----------
  function countOn() {
    document.querySelectorAll(".panel details.more").forEach(card => {
      const n = [...card.querySelectorAll(".layer-toggle > input:checked")].length +
        [...card.querySelectorAll("select")].filter(s => s.id !== "air-var" && s.value && s.value !== "off").length +
        [...card.querySelectorAll('.vbtn[aria-pressed="true"]')].length;
      const badge = card.querySelector(".on-count");
      if (!badge) return;
      badge.hidden = n === 0;
      badge.textContent = `${n} on`;
    });
  }
  const panel = $("panel");
  panel.addEventListener("change", countOn);
  panel.addEventListener("click", e => { if (e.target.closest(".vbtn")) setTimeout(countOn, 0); });
  countOn();
  setTimeout(countOn, 1500);                      // after the URL state and score.js have filled in
  setTimeout(countOn, 5000);
})();
