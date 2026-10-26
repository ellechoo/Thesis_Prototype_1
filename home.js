// home.js — the landing page: an endless honeycomb of the archive's voice portraits, all turning.
// Drag (or swipe with two fingers on a trackpad) to explore; hover for a name; click to open that portrait.
//
// A browser can only run a handful of live 3D views per page, so this uses ONE shared renderer:
// every voice is drawn once per frame (up to 30 a second) into its own cell of an offscreen "sheet",
// and the honeycomb copies those cells onto a flat canvas, as many times as it needs.
// The list arrives without the detailed frames (store.js keeps it quick), so each voice's full data
// is fetched a few at a time and its portrait pops into the field when it arrives.
import * as THREE from "three";
import { listTakes, getTake } from "./store.js";
import { buildOrb } from "./voice-orb.js?v=31";

const MAX_VOICES = 48; // the newest ones; plenty to fill the field without a long download
const field = document.getElementById("field"), view = document.getElementById("view"), ctx = view.getContext("2d");
const tip = document.getElementById("tip"), hint = document.getElementById("hint");
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const short = (s = "") => s.replace(" (various)", "").replace("India / South Asia", "South Asia");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let people = [];
try { people = (await listTakes()).slice(0, MAX_VOICES); } catch (e) { console.warn("Couldn't load the archive:", e); }
const N = people.length;
document.querySelectorAll(".home-count").forEach((el) => {
  el.textContent = N ? `${N === MAX_VOICES ? `${N}+` : N} voice${N === 1 ? "" : "s"} so far` : "Be the first voice";
});

// ---- one shared 3D renderer
let renderer = null;
if (N) {
  try {
    renderer = new THREE.WebGLRenderer({ canvas: document.createElement("canvas"), antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.toneMapping = THREE.NeutralToneMapping; renderer.setPixelRatio(1); renderer.autoClear = false; renderer.setClearColor(0x000000, 1);
  } catch (e) { console.warn("No WebGL, so no portraits:", e); renderer = null; }
}
if (!renderer) hint.hidden = true;
const gl = renderer?.domElement;
const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 60), dd = 1.4 / Math.sin(THREE.MathUtils.degToRad(15)); // same framing as the Portrait page
cam.position.set(0, dd * 0.22, dd).setLength(dd); cam.lookAt(0, 0, 0);
const scenes = new Array(N).fill(null), phase = people.map((_, i) => (i * 2.399) % (Math.PI * 2));

// fetch each voice's full data, a few at a time, and build its portrait
if (renderer) {
  let next = 0;
  const worker = async () => {
    while (next < N) {
      const i = next++;
      try {
        let t = people[i];
        if (!t.frames) t = people[i] = { ...t, ...(await getTake(t.id)) };
        const s = new THREE.Scene(); s.add(buildOrb({ ...t, frames: t.frames || [] }).group); scenes[i] = s;
      } catch (e) { console.warn(`Couldn't draw ${people[i]?.name}:`, e); }
    }
  };
  for (let k = 0; k < 4; k++) worker();
}

// ---- sizes
let S, DY, SIZE, CELL, PER_ROW, dpr;
function layout() {
  dpr = Math.min(2, devicePixelRatio || 1);
  const W = field.clientWidth, H = field.clientHeight;
  view.width = Math.round(W * dpr); view.height = Math.round(H * dpr);
  S = W < 640 ? 150 : 182; DY = S * 0.87; SIZE = S * (W < 640 ? 0.84 : 0.8);
  CELL = Math.min(256, Math.round(SIZE * dpr)); PER_ROW = Math.ceil(Math.sqrt(N + 1));
  renderer?.setSize(PER_ROW * CELL, Math.ceil((N + 1) / PER_ROW) * CELL, false); // one extra cell for the hovered tile
}
layout(); addEventListener("resize", layout); new ResizeObserver(() => layout()).observe(field);

// ---- the sheet: every voice turning; the hovered tile gets the extra cell (index N) and turns three times as fast
let hoverAngle = 0, hoverKey = "", lastT = 0, hover = null;
const angle = (i, t) => (still ? phase[i] : phase[i] + t * 0.00025);
function renderSheet(t) {
  renderer.setScissorTest(false); renderer.clear();
  renderer.setScissorTest(true);
  const rows = Math.ceil((N + 1) / PER_ROW);
  const cell = (k, s, a) => {
    const x = (k % PER_ROW) * CELL, y = (rows - 1 - Math.floor(k / PER_ROW)) * CELL;
    renderer.setViewport(x, y, CELL, CELL); renderer.setScissor(x, y, CELL, CELL); renderer.clearDepth();
    s.children[0].rotation.y = a; renderer.render(s, cam);
  };
  for (let i = 0; i < N; i++) if (scenes[i]) cell(i, scenes[i], angle(i, t));
  const key = hover ? `${hover.i},${hover.j}` : "";
  if (key !== hoverKey) { hoverKey = key; if (hover) hoverAngle = angle(hover.p, t); }
  if (hover && scenes[hover.p]) { if (!still) hoverAngle += (t - lastT) * 0.00075; cell(N, scenes[hover.p], hoverAngle); }
  lastT = t;
}

// ---- the endless honeycomb: tile (i, j) shows voice (5i + 3j) mod N, so neighbours differ
let offX = 0, offY = 0, vx = 0, vy = 0;
const mod = (a, n) => ((a % n) + n) % n;
function tiles() {
  const W = field.clientWidth, H = field.clientHeight, out = [];
  const j0 = Math.floor((-offY - SIZE) / DY), j1 = Math.ceil((H - offY + SIZE) / DY);
  for (let j = j0; j <= j1; j++) {
    const shift = mod(j, 2) ? S / 2 : 0;
    const i0 = Math.floor((-offX - shift - SIZE) / S), i1 = Math.ceil((W - offX - shift + SIZE) / S);
    for (let i = i0; i <= i1; i++) out.push({ i, j, x: i * S + shift + offX, y: j * DY + DY / 2 + offY, p: mod(5 * i + 3 * j, N) });
  }
  return out;
}
function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, view.width, view.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalCompositeOperation = "screen";
  for (const t of tiles()) {
    if (!scenes[t.p]) continue;
    const k = hover && t.i === hover.i && t.j === hover.j ? N : t.p; // the hovered tile reads its own, faster-turning cell
    ctx.drawImage(gl, (k % PER_ROW) * CELL, Math.floor(k / PER_ROW) * CELL, CELL, CELL, t.x - SIZE / 2, t.y - SIZE / 2, SIZE, SIZE);
  }
  ctx.globalCompositeOperation = "source-over";
}

if (renderer) {
  // ---- drag to explore (with a little glide after letting go), hover for names, click to open
  let down = null, moved = 0;
  field.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".home-block")) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now() }; moved = 0; vx = vy = 0;
    field.setPointerCapture(e.pointerId); field.classList.add("dragging"); tip.hidden = true; hint.style.opacity = 0;
  });
  field.addEventListener("pointermove", (e) => {
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y, now = performance.now(), dt = Math.max(1, now - down.t);
      offX += dx; offY += dy; moved += Math.abs(dx) + Math.abs(dy);
      vx = dx / dt * 16; vy = dy / dt * 16; down = { x: e.clientX, y: e.clientY, t: now };
      return;
    }
    if (e.pointerType !== "mouse") return;
    pick(e.clientX, e.clientY);
  });
  field.addEventListener("pointerup", (e) => {
    field.classList.remove("dragging");
    if (down && moved < 6) {
      const h = pick(e.clientX, e.clientY);
      if (h && scenes[h.p]) location.href = `portrait.html?id=${encodeURIComponent(people[h.p].id)}`;
    }
    if (still) vx = vy = 0;
    down = null;
  });
  field.addEventListener("pointercancel", () => { field.classList.remove("dragging"); down = null; });
  field.addEventListener("pointerleave", () => { if (!down) { hover = null; tip.hidden = true; field.classList.remove("pointing"); } });

  // trackpads send small, often fractional, two-axis wheel steps; a mouse wheel sends big whole vertical clicks
  const looksLikeTrackpad = (e) => e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40);
  field.addEventListener("wheel", (e) => {
    if (e.ctrlKey || !looksLikeTrackpad(e)) return; // pinch-zoom and mouse wheels keep their usual behaviour
    e.preventDefault();
    offX -= e.deltaX; offY -= e.deltaY; vx = vy = 0; hint.style.opacity = 0;
    if (hover) { hover = null; tip.hidden = true; }
  }, { passive: false });
  if (matchMedia("(pointer: coarse)").matches) hint.textContent = "Drag to explore, tap to open";

  // ---- animation: the sheet at up to 30 frames a second, the field every frame; paused while hidden
  let visible = true, last = -1e9;
  new IntersectionObserver(([en]) => (visible = en.isIntersecting)).observe(field);
  const frame = (t) => {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    if (!down && (Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05)) { offX += vx; offY += vy; vx *= 0.93; vy *= 0.93; if (hover) tip.hidden = true; }
    if (t - last > 33) { renderSheet(t); last = t; }
    draw();
  };
  requestAnimationFrame(frame);
}

function pick(cx, cy) {
  if (document.elementFromPoint(cx, cy)?.closest(".home-block")) { hover = null; tip.hidden = true; field.classList.remove("pointing"); return null; }
  const r = field.getBoundingClientRect(), x = cx - r.left, y = cy - r.top;
  let best = null, bd = (S * 0.45) ** 2;
  for (const t of tiles()) { if (!scenes[t.p]) continue; const d = (t.x - x) ** 2 + (t.y - y) ** 2; if (d < bd) { bd = d; best = t; } }
  hover = best;
  field.classList.toggle("pointing", !!best);
  if (best) {
    const d = people[best.p];
    const where = d.accent?.top?.name ? short(d.accent.top.name) : "";
    const note = d.summary?.note || "";
    tip.innerHTML = `<b>${esc(d.name)}</b><span>${esc([where, note].filter(Boolean).join(" · "))}</span>`;
    tip.style.left = best.x + "px"; tip.style.top = (best.y - SIZE * 0.5) + "px"; tip.hidden = false;
  } else tip.hidden = true;
  return best;
}
