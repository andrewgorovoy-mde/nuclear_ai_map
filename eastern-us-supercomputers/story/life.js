// =====================================================================================
//  COVER — a controlled lattice, and the spark that undoes it.
//  The field starts as a perfect grid of stable cells (order, control: racks, rods, plans).
//  A single R-pentomino, five cells, is dropped in; under Conway's rules it erupts into
//  long-lived chaos that eats through the lattice like a chain reaction. Order is re-imposed
//  on quiet patches, and fails again. Monochrome on purpose: ash, not confetti.
//  It accelerates: each run starts slow and doubles its pace until it is out of hand.
//  Tune below.
// =====================================================================================
const CELL = 4;              // px per cell: fine grain, a texture rather than a game board
const SPEED = 4;             // generations per second at the start…
const SPEED_MAX = 90;        // …and the ceiling it runs away to
const DOUBLE_EVERY = 8;      // seconds for the speed to double: slow, then out of hand
const LATTICE = 4;           // block spacing: at 4 the grid is perfectly stable, yet one spark consumes all of it
const SPARK_EVERY = 260;     // generations between new sparks
const CALM = 0.004;          // if fewer than this share of cells are in flux, strike again
const REORDER_EVERY = 520;   // generations between attempts to re-impose order
const TRAIL = 0.94;          // how slowly ash fades

const canvas = document.getElementById("life");
const cover = document.getElementById("cover");
if (canvas && cover) {
  const g = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let cols, rows, alive, next, age, ash, running = true, gen = 0, last = 0;

  const idx = (x, y) => ((y + rows) % rows) * cols + ((x + cols) % cols);
  function stampLattice(x0, y0, w, h) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const i = idx(x, y);
      alive[i] = (x % LATTICE < 2 && y % LATTICE < 2) ? 1 : 0;
      age[i] = 200;            // stable cells read as old, settled
    }
  }
  // R-pentomino: .XX / XX. / .X.  (tiny seed, enormous consequence)
  function spark(cx, cy) {
    [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]].forEach(([dx, dy]) => { const i = idx(cx + dx, cy + dy); alive[i] = 1; age[i] = 0; });
  }
  function randomSpark() {
    // Prefer a spot that is still ordered, so the cascade has something to consume.
    for (let tries = 0; tries < 40; tries++) {
      const x = Math.floor(Math.random() * cols), y = Math.floor(Math.random() * rows * 0.7);
      let lattice = 0;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) lattice += alive[idx(x + dx, y + dy)];
      if (lattice > 30 && lattice < 60) { spark(x, y); return; }
    }
    spark(Math.floor(cols * 0.5), Math.floor(rows * 0.35));
  }
  function reorder() {
    // Find the emptiest band and lay a fresh grid there: the attempt to regain control.
    const w = Math.floor(cols * (0.25 + Math.random() * 0.25)), h = Math.floor(rows * (0.25 + Math.random() * 0.25));
    let best = null, bestPop = Infinity;
    for (let t = 0; t < 12; t++) {
      const x0 = Math.floor(Math.random() * (cols - w)), y0 = Math.floor(Math.random() * (rows - h));
      let pop = 0;
      for (let y = y0; y < y0 + h; y += 2) for (let x = x0; x < x0 + w; x += 2) pop += alive[idx(x, y)];
      if (pop < bestPop) { bestPop = pop; best = [x0, y0]; }
    }
    stampLattice(best[0] - (best[0] % LATTICE), best[1] - (best[1] % LATTICE), w, h);
  }
  function resize() {
    const r = cover.getBoundingClientRect();
    cols = Math.ceil(r.width / CELL); rows = Math.ceil(r.height / CELL);
    canvas.width = cols; canvas.height = rows;
    const n = cols * rows;
    alive = new Uint8Array(n); next = new Uint8Array(n); age = new Uint16Array(n); ash = new Float32Array(n);
    stampLattice(0, 0, cols, rows);
    gen = 0;
    draw();
  }
  function step() {
    for (let y = 0; y < rows; y++) {
      const ym = ((y - 1 + rows) % rows) * cols, y0 = y * cols, yp = ((y + 1) % rows) * cols;
      for (let x = 0; x < cols; x++) {
        const xm = (x - 1 + cols) % cols, xp = (x + 1) % cols;
        const nb = alive[ym + xm] + alive[ym + x] + alive[ym + xp] + alive[y0 + xm] + alive[y0 + xp] + alive[yp + xm] + alive[yp + x] + alive[yp + xp];
        const i = y0 + x, was = alive[i];
        const now = was ? (nb === 2 || nb === 3 ? 1 : 0) : (nb === 3 ? 1 : 0);
        next[i] = now;
        if (now && !was) age[i] = 0;
        else if (now) age[i] = Math.min(age[i] + 1, 200);
        else if (was) ash[i] = 1;
        else ash[i] *= TRAIL;
      }
    }
    [alive, next] = [next, alive];
    gen++;
    let flux = 0; for (let i = 0; i < cols * rows; i++) if (alive[i] && age[i] < 200) flux++;
    if (gen === 12 || gen % SPARK_EVERY === 0 || (gen > 40 && gen % 30 === 0 && flux < cols * rows * CALM)) { randomSpark(); randomSpark(); }
    if (gen % REORDER_EVERY === 0) reorder();
  }
  function draw() {
    const img = g.createImageData(cols, rows), d = img.data;
    for (let i = 0; i < cols * rows; i++) {
      // Live cells: newborn cells burn white-hot, settled ones cool to gray. Dead cells leave ash.
      const a = alive[i] ? (age[i] < 6 ? 0.92 : age[i] >= 200 ? 0.16 : 0.55) : ash[i] * 0.16;
      const v = alive[i] && age[i] < 6 ? 0 : 20;
      const k = i * 4; d[k] = v; d[k + 1] = v; d[k + 2] = v; d[k + 3] = Math.round(a * 255);
    }
    g.putImageData(img, 0, 0);
  }
  let clock = 0, owed = 0;     // seconds of on-screen run time; generations due
  function loop(t) {
    const dt = Math.min(t - (last || t), 100) / 1000; last = t;
    if (running && !reduce) {
      clock += dt;
      owed += dt * Math.min(SPEED * 2 ** (clock / DOUBLE_EVERY), SPEED_MAX);
      let n = 0; while (owed >= 1 && n < 6) { step(); owed -= 1; n++; }
      if (n) draw();
      owed = Math.min(owed, 1);
    }
    requestAnimationFrame(loop);
  }
  new IntersectionObserver(([e]) => { running = e.isIntersecting; }).observe(cover);
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(resize, 200); });
  resize();
  if (reduce) { for (let k = 0; k < 160; k++) { if (k === 12) { randomSpark(); randomSpark(); } step(); } draw(); }  // a still frame, mid-collapse
  requestAnimationFrame(loop);
}
