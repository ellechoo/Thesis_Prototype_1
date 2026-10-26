// archive.js — every saved recording as a live, turning voice portrait, in one of two views (a switch at the top):
//   Flat:  an endless honeycomb that runs past the edges of the screen in every direction; drag (or swipe with two
//          fingers on a trackpad) to explore. With only so many voices, the field repeats them as it goes.
//   Globe: every voice once, spread over a slowly turning sphere; drag to spin it. Back portraits are smaller and fainter.
// Hovering a portrait shows the person's name and spins it faster; clicking opens their voice ID card
// (archive.html?id=…), still on the Archive page. The card's X, Esc, the Archive tab or the browser's back button
// return to the same view and spot. A hidden list of links lets keyboard and screen-reader users open any card.
//
// A browser can only run a handful of live 3D views per page, so ONE shared renderer draws each portrait that's
// needed this frame into its own cell of an offscreen "sheet" (on a transparent background, so front portraits cover
// back ones only where they actually draw), up to 30 times a second; the view then copies cells onto one canvas.
// The list arrives without the detailed frames (to stay quick), so each voice's data loads a few at a time and its
// portrait fades in when ready.
import * as THREE from "three";
import { listTakes, getTake } from "./store.js?v=2";
import { buildOrb } from "./voice-orb.js?v=34";
import { renderIdCard } from "./id-card.js?v=38";

const $ = (id) => document.getElementById(id);
const still = matchMedia("(prefers-reduced-motion: reduce)").matches; // then nothing turns or glides on its own
const SPIN = 0.00025, SPIN_HOVER = 0.00075; // radians per millisecond
const VIEW_KEY = "archiveView", SPOT = "archiveSpot";
const store = { get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } }, set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch {} } };

async function load() {
  const id = new URLSearchParams(location.search).get("id");
  if (id) return showCard(id);
  let takes = [];
  try { takes = await listTakes(); }
  catch (e) { $("status").textContent = `Couldn't open the archive: ${e.message}`; $("status").classList.add("error"); return; }
  $("empty").hidden = takes.length > 0;
  if (takes.length) gallery(takes);
}

// ---------- the gallery ----------
function gallery(people) {
  const N = people.length;
  const grid = $("grid");
  grid.classList.add("archive-stage");
  grid.innerHTML = `
    <canvas class="stage-canvas" aria-hidden="true"></canvas>
    <div class="view-switch" role="group" aria-label="View">
      <button type="button" data-view="flat">Flat</button><button type="button" data-view="globe">Globe</button>
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
    hover = null; tip.hidden = true; vx = vy = 0; layout();
  }
  buttons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.view)));
  const coarse = matchMedia("(pointer: coarse)").matches;

  // ---- one shared 3D renderer, transparent cells
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: document.createElement("canvas"), antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    renderer.toneMapping = THREE.NeutralToneMapping; renderer.setPixelRatio(1); renderer.autoClear = false; renderer.setClearColor(0x000000, 0);
  } catch (e) { hint.textContent = "This browser can't draw the 3D portraits. Use the list of voices instead."; grid.querySelector("ul").classList.remove("visually-hidden"); return; }
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
  function items() {
    if (mode === "flat") { // the endless honeycomb: tile (i, j) shows voice (5i + 3j) mod N, so neighbours differ
      const out = [], j0 = Math.floor((-offY - SIZE) / DY), j1 = Math.ceil((H - offY + SIZE) / DY);
      for (let j = j0; j <= j1; j++) {
        const shift = mod(j, 2) ? S / 2 : 0, i0 = Math.floor((-offX - shift - SIZE) / S), i1 = Math.ceil((W - offX - shift + SIZE) / S);
        for (let i = i0; i <= i1; i++) out.push({ key: `${i},${j}`, p: mod(5 * i + 3 * j, N), x: i * S + shift + offX, y: j * DY + DY / 2 + offY, size: SIZE, dim: 1, z: 1 });
      }
      return out;
    }
    return pts.map((pt, p) => { // the globe, back to front
      const q = pt.clone().applyQuaternion(rot), s = FOCAL / (FOCAL - q.z), front = (q.z + 1) / 2;
      return { key: `g${p}`, p, x: W / 2 + q.x * R * s, y: H / 2 - q.y * R * s, z: q.z, size: GSIZE * s * (0.55 + 0.45 * front), dim: 0.25 + 0.75 * front ** 1.5 };
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
      scenes[p].children[0].rotation.y = spin[p]; renderer.render(scenes[p], cam);
      slots.set(p, k);
    });
  }
  function draw(list, t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, view.width, view.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gl = renderer.domElement;
    for (const it of list) {
      const k = slots.get(it.p); if (k === undefined) continue;
      ctx.globalAlpha = Math.min(1, (t - born[it.p]) / 600) * it.dim;
      ctx.drawImage(gl, (k % perRow) * CELL, Math.floor(k / perRow) * CELL, CELL, CELL, it.x - it.size / 2, it.y - it.size / 2, it.size, it.size);
    }
    ctx.globalAlpha = 1;
  }

  // ---- drag to explore / spin, hover for a name, click to open
  let down = null, moved = 0, vx = 0, vy = 0, hover = null, placed = [];
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), tq = new THREE.Quaternion();
  const turn = (ax, ay) => { tq.setFromAxisAngle(Y, ax); rot.premultiply(tq); tq.setFromAxisAngle(X, ay); rot.premultiply(tq); };
  const move = (dx, dy) => { if (mode === "flat") { offX += dx; offY += dy; } else turn(dx / R, dy / R); };
  const onStage = (e) => !e.target.closest(".view-switch, .tabs");
  view.addEventListener("pointerdown", (e) => {
    if (!onStage(e)) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now() }; moved = 0; vx = vy = 0;
    view.setPointerCapture(e.pointerId); grid.classList.add("dragging"); tip.hidden = true; hint.classList.add("gone");
  });
  view.addEventListener("pointermove", (e) => {
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y, now = performance.now(), dt = Math.max(1, now - down.t);
      move(dx, dy); moved += Math.abs(dx) + Math.abs(dy); vx = dx / dt * 16; vy = dy / dt * 16; down = { x: e.clientX, y: e.clientY, t: now };
      return;
    }
    if (e.pointerType === "mouse") pick(e.clientX, e.clientY);
  });
  view.addEventListener("pointerup", (e) => {
    grid.classList.remove("dragging");
    if (down && moved < 6) { const h = pick(e.clientX, e.clientY); if (h) { remember(); location.href = `archive.html?id=${encodeURIComponent(people[h.p].id)}`; } }
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
    tip.style.left = it.x + "px"; tip.style.top = (it.y + it.size * (mode === "flat" ? 0.4 : 0.36)) + "px";
  }

  // ---- animation; paused while the tab is hidden
  setMode(mode);
  let last = -1e9, lastT = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(100, t - lastT); lastT = t;
    if (document.hidden) return;
    if (!down && Math.abs(vx) + Math.abs(vy) > 0.05) { move(vx, vy); vx *= 0.93; vy *= 0.93; if (hover) { hover = null; tip.hidden = true; } }
    else if (!down && !still && mode === "globe") turn(dt * 0.00006, 0);
    if (!still) for (let p = 0; p < N; p++) spin[p] += dt * (hover && hover.p === p ? SPIN_HOVER : SPIN);
    placed = items();
    placeTip();
    if (t - last > 33) { renderSheet(placed); last = t; }
    draw(placed, t);
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
