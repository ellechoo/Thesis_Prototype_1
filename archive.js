// archive.js — every saved recording as a live, turning voice portrait, in one of two views (a switch at the top):
//   Flat:  an endless honeycomb that runs past the edges of the screen in every direction; drag (or swipe with two
//          fingers on a trackpad) to explore. With only so many voices, the field repeats them as it goes.
//   Globe: every voice once, spread over a slowly turning sphere; drag to spin it. Back portraits are smaller and fainter.
// A search box finds a voice by name or nickname (ignoring capitals and accents): choosing one glides to it and zooms in
// (on the globe, turns it to face you); dragging, Esc or clearing the search zooms back out.
// Hovering a portrait shows the person's name and spins it faster; clicking zooms into it, then opens that voice's
// Portrait page (portrait.html?id=…), which has their ID card too. archive.html?id=… still shows an ID card on its own. The card's X, Esc, the Archive tab or the browser's back button
// return to the same view and spot. A hidden list of links lets keyboard and screen-reader users open any card.
//
// A browser can only run a handful of live 3D views per page, so ONE shared renderer draws each portrait that's
// needed this frame into its own cell of an offscreen "sheet" (on a transparent background, so front portraits cover
// back ones only where they actually draw), up to 30 times a second; the view then copies cells onto one canvas.
// The list arrives without the detailed frames (to stay quick), so each voice's data loads a few at a time and its
// portrait fades in when ready.
import * as THREE from "three";
import { listTakes, getTake } from "./store.js?v=2";
import { buildOrb, turnBelt } from "./voice-orb.js?v=60";
import { spreadOut } from "./spread.js?v=6"; // (voiceprints that look alike aren't placed next to each other)
import { renderIdCard } from "./id-card.js?v=65";

const $ = (id) => document.getElementById(id);
const still = matchMedia("(prefers-reduced-motion: reduce)").matches; // then nothing turns or glides on its own
const SPIN = -0.00025, SPIN_HOVER = -0.00075; // radians per millisecond; negative: the structure turns to the left (the core, the other way)
const VIEW_KEY = "archiveView", SPOT = "archiveSpot";
const store = { get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } }, set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch {} } };

async function load() {
  const id = new URLSearchParams(location.search).get("id");
  if (id) return showCard(id);
  let takes = [];
  try { takes = await listTakes(); }
  catch (e) { $("status").textContent = `Couldn't open the archive: ${e.message}`; $("status").classList.add("error"); return; }
  $("empty").hidden = takes.length > 0;
  if (takes.length) gallery(spreadOut(takes));
}

// ---------- the gallery ----------
function gallery(people) {
  const N = people.length;
  const grid = $("grid");
  grid.classList.add("archive-stage");
  grid.innerHTML = `
    <canvas class="stage-canvas" aria-hidden="true"></canvas>
    <div class="view-switch" role="group" aria-label="View">
      <button type="button" data-view="flat" aria-label="Flat view" title="Flat view"><svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="5" cy="6" r="2.4"/><circle cx="12" cy="6" r="2.4"/><circle cx="19" cy="6" r="2.4"/><circle cx="8.5" cy="12" r="2.4"/><circle cx="15.5" cy="12" r="2.4"/><circle cx="5" cy="18" r="2.4"/><circle cx="12" cy="18" r="2.4"/><circle cx="19" cy="18" r="2.4"/></g></svg></button><button type="button" data-view="globe" aria-label="Globe view" title="Globe view"><svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3.6 8.5h16.8M3.6 15.5h16.8"/></g></svg></button>
    </div>
    <div class="stage-search" role="search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></g></svg>
      <input type="search" placeholder="Find a voice" aria-label="Find a voice by name" autocomplete="off" spellcheck="false" enterkeyhint="search"
        role="combobox" aria-autocomplete="list" aria-controls="searchResults" aria-expanded="false" />
      <ul class="search-results" id="searchResults" role="listbox" aria-label="Matching voices" hidden></ul>
    </div>
    <p class="stage-hint" aria-hidden="true"></p>
    <span class="stage-tip" aria-hidden="true" hidden></span>
    <ul class="visually-hidden" aria-label="Voices in the archive"></ul>`;
  const view = grid.querySelector(".stage-canvas"), ctx = view.getContext("2d");
  const tip = grid.querySelector(".stage-tip"), hint = grid.querySelector(".stage-hint");
  const list = grid.querySelector("ul");
  for (const t of people) {
    const li = document.createElement("li"), a = document.createElement("a");
    a.href = `archive.html?id=${encodeURIComponent(t.id)}`; a.textContent = `${t.name}: voice ID card`;
    a.addEventListener("click", () => remember());
    li.appendChild(a); list.appendChild(li);
  }

  // which view, and where we were (coming back from an ID card)
  let mode = store.get(VIEW_KEY) === "globe" ? "globe" : "flat";
  let offX = 0, offY = 0; // flat: how far the field has been dragged
  const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.35); // globe: its turn
  try {
    const spot = JSON.parse(store.get(SPOT, sessionStorage) || "null"); sessionStorage.removeItem(SPOT);
    if (spot) { mode = spot.mode === "globe" ? "globe" : "flat"; offX = spot.offX || 0; offY = spot.offY || 0; if (spot.q) rot.fromArray(spot.q); }
  } catch {}
  function remember() { store.set(SPOT, JSON.stringify({ mode, offX, offY, q: rot.toArray() }), sessionStorage); }

  const buttons = grid.querySelectorAll(".view-switch button");
  function setMode(m) {
    mode = m; store.set(VIEW_KEY, m);
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === m)));
    hint.textContent = coarse ? (m === "globe" ? "Drag to spin the globe · tap a voice to open it" : "Drag to explore · tap a voice to open it")
                              : (m === "globe" ? "Drag to spin the globe · click a voice to open it" : "Drag or swipe to explore · click a voice to open it");
    hover = null; tip.hidden = true; vx = vy = 0; focus = null; fading = null; tween = null; zoom = 1; layout();
  }
  buttons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.view)));
  const coarse = matchMedia("(pointer: coarse)").matches;

  // ---- one shared 3D renderer, transparent cells
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: document.createElement("canvas"), antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    renderer.toneMapping = THREE.NeutralToneMapping; renderer.setPixelRatio(1); renderer.autoClear = false; renderer.setClearColor(0x000000, 0);
  } catch (e) { hint.textContent = "This browser can't draw the 3D portraits. Use the list of voices instead."; grid.querySelector("ul").classList.remove("visually-hidden"); return; }
  let sharp = null, sharpSize = 0; // a second renderer just for a found voice, drawn at its zoomed-in size so it stays crisp
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 60), dd = 1.4 / Math.sin(THREE.MathUtils.degToRad(15)); // same framing as the Portrait page
  cam.position.set(0, dd * 0.22, dd).setLength(dd); cam.lookAt(0, 0, 0);
  const scenes = new Array(N).fill(null), born = new Array(N).fill(0), spin = people.map((_, i) => (i * 2.399) % 6.283);

  // each voice's full data, a few at a time; its portrait fades in when built
  let next = 0;
  const worker = async () => {
    while (next < N) {
      const i = next++;
      try {
        let t = people[i];
        if (!t.frames) t = people[i] = { ...t, ...(await getTake(t.id)) };
        const s = new THREE.Scene(); s.add(buildOrb({ ...t, frames: t.frames || [] }).group); scenes[i] = s; born[i] = performance.now();
      } catch (err) { console.warn(`Couldn't draw ${people[i]?.name}:`, err); }
    }
  };
  for (let k = 0; k < 4; k++) worker();

  // ---- sizes
  let W, H, dpr, S, DY, SIZE, R, GSIZE, CELL;
  function layout() {
    dpr = Math.min(2, devicePixelRatio || 1); W = grid.clientWidth; H = grid.clientHeight;
    view.width = Math.round(W * dpr); view.height = Math.round(H * dpr);
    S = W < 640 ? 140 : 190; DY = S * 0.87; SIZE = S * (W < 640 ? 0.86 : 0.84);       // flat: spacing and portrait size
    R = W < 640 ? W * 0.36 : Math.min(W, H) * 0.36;                                    // globe: radius on screen
    GSIZE = Math.min(W < 640 ? 150 : 230, R * 3.9 / Math.sqrt(N));                      // globe: a front portrait's size
    CELL = Math.min(256, Math.round((mode === "globe" ? GSIZE * 1.2 : SIZE) * dpr));
  }
  layout(); addEventListener("resize", layout);

  // ---- where everything is this frame
  const mod = (a, n) => ((a % n) + n) % n;
  const pts = people.map((_, i) => { const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), th = i * 2.399963; return new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r); });
  const FOCAL = 3.2;
  let zoom = 1, zoomTo = 1; // 1 normally; more while a found voice is zoomed in on (scaled about the screen's centre)
  const tileXY = (i, j) => [i * S + (mod(j, 2) ? S / 2 : 0), j * DY + DY / 2]; // a flat tile's place before dragging and zoom
  function items() {
    const cx = W / 2, cy = H / 2;
    if (mode === "flat") { // the endless honeycomb: tile (i, j) shows voice (5i + 3j) mod N, so neighbours differ
      const out = [], m = SIZE, y0 = cy - cy / zoom - m, y1 = cy + cy / zoom + m, x0 = cx - cx / zoom - m, x1 = cx + cx / zoom + m;
      const j0 = Math.floor((y0 - offY - DY / 2) / DY), j1 = Math.ceil((y1 - offY - DY / 2) / DY);
      for (let j = j0; j <= j1; j++) {
        const shift = mod(j, 2) ? S / 2 : 0, i0 = Math.floor((x0 - offX - shift) / S), i1 = Math.ceil((x1 - offX - shift) / S);
        for (let i = i0; i <= i1; i++) {
          const [tx, ty] = tileXY(i, j);
          out.push({ key: `${i},${j}`, p: mod(5 * i + 3 * j, N), x: cx + (tx + offX - cx) * zoom, y: cy + (ty + offY - cy) * zoom, size: SIZE * zoom, dim: 1, z: 1 });
        }
      }
      return out;
    }
    const Rz = R * zoom;
    return pts.map((pt, p) => { // the globe, back to front
      const q = pt.clone().applyQuaternion(rot), s = FOCAL / (FOCAL - q.z), front = (q.z + 1) / 2;
      return { key: `g${p}`, p, x: cx + q.x * Rz * s, y: cy - q.y * Rz * s, z: q.z, size: GSIZE * zoom * s * (0.55 + 0.45 * front), dim: 0.25 + 0.75 * front ** 1.5 };
    }).sort((a, b) => a.z - b.z);
  }

  // ---- draw: render the needed voices into the sheet (≤30 a second), then copy them into place (every frame)
  let slots = new Map(), perRow = 1;
  function renderSheet(list) {
    const need = [...new Set(list.map((it) => it.p))].filter((p) => scenes[p]);
    perRow = Math.max(1, Math.ceil(Math.sqrt(need.length))); const rows = Math.max(1, Math.ceil(need.length / perRow));
    const gl = renderer.domElement;
    if (gl.width !== perRow * CELL || gl.height !== rows * CELL) renderer.setSize(perRow * CELL, rows * CELL, false);
    renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
    slots = new Map();
    need.forEach((p, k) => {
      const x = (k % perRow) * CELL, y = (rows - 1 - Math.floor(k / perRow)) * CELL;
      renderer.setViewport(x, y, CELL, CELL); renderer.setScissor(x, y, CELL, CELL); renderer.clearDepth();
      scenes[p].children[0].rotation.y = spin[p]; turnBelt(scenes[p].children[0], still ? 0 : performance.now() / 1000); renderer.render(scenes[p], cam); // (the speaking-rate band turns too)
      slots.set(p, k);
    });
  }
  // while a found voice is zoomed in on, everything else fades back (by how far the zoom has gone)
  const dimOthers = () => { const span = zoomTo - 1; return span > 0 ? 1 - 0.8 * Math.max(0, Math.min(1, (zoom - 1) / span)) : 1; };
  function renderSharp(it) {
    if (!it || !scenes[it.p]) return false;
    if (!sharp) {
      try { sharp = new THREE.WebGLRenderer({ canvas: document.createElement("canvas"), antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
        sharp.toneMapping = THREE.NeutralToneMapping; sharp.setPixelRatio(1); sharp.setClearColor(0x000000, 0); } catch { sharp = false; }
    }
    if (!sharp) return false;
    const want = Math.min(900, Math.round(it.size * dpr / 8) * 8);
    if (want !== sharpSize) { sharpSize = want; sharp.setSize(want, want, false); }
    sharp.clear(); scenes[it.p].children[0].rotation.y = spin[it.p]; sharp.render(scenes[it.p], cam);
    return true;
  }
  function draw(list, t, star) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, view.width, view.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gl = renderer.domElement, fade = dimOthers(), crisp = star && renderSharp(star);
    for (const it of list) {
      if (crisp && it.key === star.key) continue; // drawn last, sharp and full strength
      const k = slots.get(it.p); if (k === undefined) continue;
      ctx.globalAlpha = Math.min(1, (t - born[it.p]) / 600) * it.dim * (star ? fade : 1);
      ctx.drawImage(gl, (k % perRow) * CELL, Math.floor(k / perRow) * CELL, CELL, CELL, it.x - it.size / 2, it.y - it.size / 2, it.size, it.size);
    }
    if (crisp) { ctx.globalAlpha = 1; ctx.drawImage(sharp.domElement, 0, 0, sharpSize, sharpSize, star.x - star.size / 2, star.y - star.size / 2, star.size, star.size); }
    ctx.globalAlpha = 1;
  }

  // ---- drag to explore / spin, hover for a name, click to open
  let down = null, moved = 0, vx = 0, vy = 0, hover = null, placed = [];
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), tq = new THREE.Quaternion();
  const turn = (ax, ay) => { tq.setFromAxisAngle(Y, ax); rot.premultiply(tq); tq.setFromAxisAngle(X, ay); rot.premultiply(tq); };
  const move = (dx, dy) => { if (mode === "flat") { offX += dx / zoom; offY += dy / zoom; } else turn(dx / (R * zoom), dy / (R * zoom)); };
  const onStage = (e) => !e.target.closest(".view-switch, .tabs");
  view.addEventListener("pointerdown", (e) => {
    if (!onStage(e)) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now() }; moved = 0; vx = vy = 0; closeResults();
    view.setPointerCapture(e.pointerId); grid.classList.add("dragging"); tip.hidden = true; hint.classList.add("gone");
  });
  view.addEventListener("pointermove", (e) => {
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y, now = performance.now(), dt = Math.max(1, now - down.t);
      move(dx, dy); moved += Math.abs(dx) + Math.abs(dy); vx = dx / dt * 16; vy = dy / dt * 16; down = { x: e.clientX, y: e.clientY, t: now };
      if (moved > 6 && (focus !== null || tween)) letGo();
      return;
    }
    if (e.pointerType === "mouse") pick(e.clientX, e.clientY);
  });
  view.addEventListener("pointerup", (e) => {
    grid.classList.remove("dragging");
    if (down && moved < 6 && !opening) { const h = pick(e.clientX, e.clientY); if (h) open(h); }
    if (still) vx = vy = 0;
    down = null;
  });
  view.addEventListener("pointercancel", () => { grid.classList.remove("dragging"); down = null; });
  view.addEventListener("pointerleave", () => { if (!down) { hover = null; tip.hidden = true; grid.classList.remove("pointing"); } });
  // trackpads send small, often fractional, two-axis wheel steps; a mouse wheel sends big whole vertical clicks
  const looksLikeTrackpad = (e) => e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40);
  view.addEventListener("wheel", (e) => {
    if (e.ctrlKey) return; // pinch-zoom keeps its usual behaviour
    e.preventDefault();
    const k = looksLikeTrackpad(e) ? 1 : 0.6;
    if (focus !== null || tween) letGo();
    move(-e.deltaX * k, -e.deltaY * k); vx = vy = 0; hint.classList.add("gone");
    if (hover) { hover = null; tip.hidden = true; }
  }, { passive: false });

  function pick(cx, cy) {
    const r = grid.getBoundingClientRect(), x = cx - r.left, y = cy - r.top;
    let best = null, bd = Infinity;
    for (const it of placed) {
      if (!scenes[it.p] || it.z < -0.15) continue;
      const d = Math.hypot(it.x - x, it.y - y), reach = it.size * (mode === "flat" ? 0.45 : 0.32);
      if (d < reach && (mode === "flat" ? d < bd : it.z > (best?.z ?? -9))) { bd = d; best = it; }
    }
    hover = best; grid.classList.toggle("pointing", !!best);
    if (best) { tip.textContent = people[best.p].name; tip.hidden = false; placeTip(); } else tip.hidden = true;
    return best;
  }
  function placeTip() {
    if (!hover) return;
    const it = placed.find((q) => q.key === hover.key); if (!it) return;
    tip.style.left = it.x + "px"; tip.style.top = (it.y + it.size * 0.2) + "px"; // over the portrait's lower part, like the landing page
  }

  // ---- search: find a voice by name, glide to it and zoom in
  const box = grid.querySelector(".stage-search input"), results = grid.querySelector(".search-results");
  const norm = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const names = people.map((t) => norm(t.name));
  const when = (t) => { try { return t.createdAt ? new Date(t.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""; } catch { return ""; } };
  let matches = [], active = -1, focus = null, tween = null;
  function closeResults() { results.hidden = true; box.setAttribute("aria-expanded", "false"); box.removeAttribute("aria-activedescendant"); active = -1; }
  function showResults() {
    const q = norm(box.value);
    if (!q) { matches = []; closeResults(); return; }
    matches = names.map((n, p) => ({ p, at: n.indexOf(q), n })).filter((m) => m.at >= 0)
      .sort((a, b) => (a.at === 0) - (b.at === 0) ? (b.at === 0) - (a.at === 0) : a.n.localeCompare(b.n)).slice(0, 8);
    active = matches.length ? 0 : -1;
    results.innerHTML = "";
    if (!matches.length) { const li = document.createElement("li"); li.className = "search-none"; li.textContent = `No voice called “${box.value.trim()}”`; results.appendChild(li); }
    const twins = new Set(matches.map((m) => m.n).filter((n, k, a) => a.indexOf(n) !== k)); // same name twice: show dates to tell them apart
    matches.forEach((m, k) => {
      const li = document.createElement("li");
      li.id = `voiceMatch${k}`; li.setAttribute("role", "option"); li.setAttribute("aria-selected", String(k === active));
      li.innerHTML = `<span class="m-name"></span><span class="m-when"></span>`;
      li.querySelector(".m-name").textContent = people[m.p].name;
      li.querySelector(".m-when").textContent = twins.has(m.n) ? when(people[m.p]) : "";
      li.addEventListener("pointerdown", (e) => { e.preventDefault(); choose(k); });
      results.appendChild(li);
    });
    results.hidden = false; box.setAttribute("aria-expanded", "true");
    if (active >= 0) box.setAttribute("aria-activedescendant", `voiceMatch${active}`);
  }
  function highlight(k) {
    active = k; [...results.querySelectorAll('[role="option"]')].forEach((li, n) => li.setAttribute("aria-selected", String(n === k)));
    if (k >= 0) box.setAttribute("aria-activedescendant", `voiceMatch${k}`);
  }
  function choose(k) {
    const m = matches[k]; if (!m) return;
    box.value = people[m.p].name; closeResults(); hint.classList.add("gone");
    if (coarse) box.blur(); // let the phone keyboard go so the voice can be seen
    focusOn(m.p);
  }
  box.addEventListener("input", showResults);
  box.addEventListener("focus", () => { if (box.value.trim()) showResults(); });
  box.addEventListener("blur", () => setTimeout(closeResults, 120));
  box.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && matches.length) { e.preventDefault(); if (results.hidden) showResults(); highlight((active + 1) % matches.length); }
    else if (e.key === "ArrowUp" && matches.length) { e.preventDefault(); highlight((active - 1 + matches.length) % matches.length); }
    else if (e.key === "Enter") { e.preventDefault(); if (matches.length) choose(Math.max(0, active)); }
    else if (e.key === "Escape") { e.preventDefault(); if (!results.hidden) closeResults(); else { box.value = ""; letGo(); } }
  });
  box.addEventListener("search", () => { if (!box.value) letGo(); }); // the box's own clear (×) button
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && e.target !== box && (focus !== null || tween)) letGo(); });

  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
  function animate(to, dur = 1000) {
    const from = { offX, offY, zoom, q: rot.clone() };
    if (still) { dur = 1; }
    tween = { from, to: { offX: to.offX ?? offX, offY: to.offY ?? offY, zoom: to.zoom ?? zoom, q: to.q || rot.clone() }, t0: performance.now(), dur };
  }
  function stepTween(t) {
    if (!tween) return;
    const k = Math.min(1, (t - tween.t0) / tween.dur), e = ease(k), { from, to } = tween;
    offX = from.offX + (to.offX - from.offX) * e; offY = from.offY + (to.offY - from.offY) * e; zoom = from.zoom + (to.zoom - from.zoom) * e;
    rot.copy(from.q).slerp(to.q, e);
    if (k >= 1) { tween = null; if (afterTween) { const f = afterTween; afterTween = null; f(); } }
  }
  function focusOn(p, tile = null) {
    vx = vy = 0; focus = p;
    // the globe zooms 1.5×; the flat view zooms by whatever makes the found voice the same size on screen as on the globe
    const GZOOM = 1.5, globeSize = GSIZE * GZOOM * FOCAL / (FOCAL - 1); // a front-facing globe portrait, zoomed
    const ZOOM = mode === "flat" ? Math.max(1.5, globeSize / SIZE) : GZOOM; zoomTo = ZOOM;
    if (mode === "flat") { // the tile given, or else the copy of that voice nearest the middle of the screen
      const ux = W / 2 - offX, uy = H / 2 - offY, jc = Math.round((uy - DY / 2) / DY), ic = Math.round(ux / S);
      let best = tile ? tileXY(tile[0], tile[1]) : null, bd = tile ? -1 : Infinity;
      for (let j = jc - N; j <= jc + N; j++) for (let i = ic - N; i <= ic + N; i++) {
        if (mod(5 * i + 3 * j, N) !== p) continue;
        const [tx, ty] = tileXY(i, j), d = (tx - ux) ** 2 + (ty - uy) ** 2;
        if (d < bd) { bd = d; best = [tx, ty]; }
      }
      if (best) animate({ offX: W / 2 - best[0], offY: H / 2 - best[1], zoom: ZOOM });
    } else { // turn the globe so that voice faces the viewer
      const q = new THREE.Quaternion().setFromUnitVectors(pts[p].clone().normalize(), new THREE.Vector3(0, 0, 1));
      animate({ q, zoom: ZOOM });
    }
  }
  let fading = null; // the voice that was in focus, kept sharp and bright while the view zooms back out
  // clicking a portrait zooms into that exact one (like a search does), then opens its ID card
  let opening = false;
  function open(it) {
    opening = true; closeResults(); hint.classList.add("gone");
    const go = () => { remember(); location.href = `portrait.html?id=${encodeURIComponent(people[it.p].id)}`; };
    if (still) return go();
    focusOn(it.p, mode === "flat" ? it.key.split(",").map(Number) : null);
    // a moment on the zoomed-in voice, then the stage fades to black (still zooming in a little) and its Portrait page
    // fades in from black, carrying on the zoom (see "arriving" in portrait-3d.js)
    afterTween = () => setTimeout(() => { try { sessionStorage.setItem("arriveFrom", "archive"); } catch {} document.body.classList.add("leaving"); setTimeout(go, 280); }, 120);
  }
  let afterTween = null;

  // back from an ID card with the browser's back button, the page can come back exactly as it was left (zoomed in): reset
  addEventListener("pageshow", (e) => { if (e.persisted) { document.body.classList.remove("leaving"); opening = false; afterTween = null; tween = null; focus = null; fading = null; zoom = 1; hover = null; tip.hidden = true; } });
  function letGo() { if (opening) return; if (focus === null && !tween && zoom === 1) return; fading = focus; focus = null; hover = null; tip.hidden = true; animate({ zoom: 1 }, 600); }

  // ---- animation; paused while the tab is hidden
  setMode(mode);
  let last = -1e9, lastT = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(100, t - lastT); lastT = t;
    if (document.hidden) return;
    stepTween(t);
    if (!down && !tween && Math.abs(vx) + Math.abs(vy) > 0.05) { move(vx, vy); vx *= 0.93; vy *= 0.93; if (hover) { hover = null; tip.hidden = true; } }
    else if (!down && !tween && focus === null && !still && mode === "globe") turn(dt * 0.00006, 0);
    if (!still) for (let p = 0; p < N; p++) spin[p] += dt * (hover && hover.p === p ? SPIN_HOVER : SPIN);
    placed = items();
    if (focus !== null && !down) { // the found voice keeps its name showing (the copy nearest the middle)
      let best = null, bd = Infinity;
      for (const it of placed) if (it.p === focus && it.z > -0.15) { const d = (it.x - W / 2) ** 2 + (it.y - H / 2) ** 2; if (d < bd) { bd = d; best = it; } }
      if (best) { hover = best; tip.textContent = people[focus].name; tip.hidden = false; }
    }
    placeTip();
    let star = null; const who = focus !== null ? focus : (zoom > 1.001 ? fading : null);
    if (who !== null) { let bd = Infinity; for (const it of placed) if (it.p === who && it.z > -0.15) { const d = (it.x - W / 2) ** 2 + (it.y - H / 2) ** 2; if (d < bd) { bd = d; star = it; } } }
    if (zoom <= 1.001 && focus === null) fading = null;
    if (t - last > 33) { renderSheet(placed); last = t; }
    draw(placed, t, star);
  }
  requestAnimationFrame(frame);
}

// ---------- one person's ID card (unchanged) ----------
async function showCard(id) {
  document.body.classList.add("showing-id");
  $("grid").hidden = true;
  const view = $("idView");
  view.hidden = false;
  view.innerHTML = `<p class="note id-loading">Opening the ID card…</p>`;
  let take = null;
  try { take = await getTake(id); } catch (e) { view.innerHTML = `<p class="status error">Couldn't open this voice: ${e.message}</p>`; return; }
  if (!take) { view.innerHTML = `<p class="status">That voice isn't in the archive any more. <a href="archive.html">Back to the archive</a></p>`; return; }
  document.title = `${take.name} · Voice ID · Voiceprint`;
  renderIdCard(view, take);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") location.href = "archive.html"; });
}

load();
