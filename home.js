// home.js — the landing page: an endless honeycomb of the archive's voice portraits, all turning,
// drifting slowly on a diagonal so every voice comes past in time. It's a backdrop only: nothing here
// is clickable or draggable (the Archive page is where people browse voices), so the focus stays on
// the intro and the "Get Started" button.
//
// A browser can only run a handful of live 3D views per page, so this uses ONE shared renderer:
// every voice is drawn once per frame (up to 30 a second) into its own cell of an offscreen "sheet",
// and the honeycomb copies those cells onto a flat canvas, as many times as it needs.
// The list arrives without the detailed frames (store.js keeps it quick), so each voice's full data
// is fetched a few at a time and its portrait fades into the field when it arrives.
import * as THREE from "three";
import { listTakes, getTake } from "./store.js?v=2";
import { buildOrb } from "./voice-orb.js?v=34";

const MAX_VOICES = 48;       // the newest ones; plenty to fill the field without a long download
const DRIFT = [0.016, 0.01]; // pixels per millisecond: right-to-left and bottom-to-top, a slow diagonal
const field = document.getElementById("field"), view = document.getElementById("view"), ctx = view.getContext("2d");
const still = matchMedia("(prefers-reduced-motion: reduce)").matches; // then the portraits neither turn nor drift

// ---- desktop: the text sits in a speech bubble. Its outline (body + tail) is one SVG path drawn to the
// block's exact size, so the rounded corners never stretch. Until this runs, the block is a plain off-white box.
{
  const block = document.querySelector(".home-block"), svg = block?.querySelector(".bub-shape"), path = svg?.querySelector("path");
  if (path) {
    const draw = () => {
      const w = block.offsetWidth, h = block.offsetHeight, r = 34, x = Math.round(Math.min(w * 0.12, 90));
      if (!w || !h) return;
      svg.setAttribute("width", w); svg.setAttribute("height", h);
      path.setAttribute("d", `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}` +
        `H${x + 70}C${x + 52} ${h + 14} ${x + 34} ${h + 30} ${x + 6} ${h + 48}C${x + 16} ${h + 28} ${x + 18} ${h + 12} ${x} ${h}` + // the tail
        `H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`);
      block.classList.add("bubbled");
    };
    new ResizeObserver(draw).observe(block); draw();
  }
}

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

if (renderer) {
  const gl = renderer.domElement;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 60), dd = 1.4 / Math.sin(THREE.MathUtils.degToRad(15)); // same framing as the Portrait page
  cam.position.set(0, dd * 0.22, dd).setLength(dd); cam.lookAt(0, 0, 0);
  const scenes = new Array(N).fill(null), born = new Array(N).fill(0), phase = people.map((_, i) => (i * 2.399) % (Math.PI * 2));

  // fetch each voice's full data, a few at a time, and build its portrait
  let next = 0;
  const worker = async () => {
    while (next < N) {
      const i = next++;
      try {
        let t = people[i];
        if (!t.frames) t = people[i] = { ...t, ...(await getTake(t.id)) };
        const s = new THREE.Scene(); s.add(buildOrb({ ...t, frames: t.frames || [] }).group); scenes[i] = s; born[i] = performance.now();
      } catch (e) { console.warn(`Couldn't draw ${people[i]?.name}:`, e); }
    }
  };
  for (let k = 0; k < 4; k++) worker();

  // ---- sizes
  let S, DY, SIZE, CELL, PER_ROW, dpr;
  const layout = () => {
    dpr = Math.min(2, devicePixelRatio || 1);
    const W = field.clientWidth, H = field.clientHeight;
    view.width = Math.round(W * dpr); view.height = Math.round(H * dpr);
    S = W < 640 ? 150 : 182; DY = S * 0.87; SIZE = S * (W < 640 ? 0.84 : 0.8);
    CELL = Math.min(256, Math.round(SIZE * dpr)); PER_ROW = Math.ceil(Math.sqrt(N));
    renderer.setSize(PER_ROW * CELL, Math.ceil(N / PER_ROW) * CELL, false);
  };
  layout(); addEventListener("resize", layout); new ResizeObserver(layout).observe(field);

  // ---- the sheet: every voice, turning
  const renderSheet = (t) => {
    renderer.setScissorTest(false); renderer.clear();
    renderer.setScissorTest(true);
    const rows = Math.ceil(N / PER_ROW);
    for (let k = 0; k < N; k++) {
      if (!scenes[k]) continue;
      const x = (k % PER_ROW) * CELL, y = (rows - 1 - Math.floor(k / PER_ROW)) * CELL;
      renderer.setViewport(x, y, CELL, CELL); renderer.setScissor(x, y, CELL, CELL); renderer.clearDepth();
      scenes[k].children[0].rotation.y = still ? phase[k] : phase[k] + t * 0.00025;
      renderer.render(scenes[k], cam);
    }
  };

  // ---- the endless honeycomb, drifting: tile (i, j) shows voice (5i + 3j) mod N, so neighbours differ
  const mod = (a, n) => ((a % n) + n) % n;
  const draw = (t) => {
    const W = field.clientWidth, H = field.clientHeight;
    const offX = still ? 0 : -t * DRIFT[0], offY = still ? 0 : -t * DRIFT[1];
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, view.width, view.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalCompositeOperation = "screen";
    const j0 = Math.floor((-offY - SIZE) / DY), j1 = Math.ceil((H - offY + SIZE) / DY);
    for (let j = j0; j <= j1; j++) {
      const shift = mod(j, 2) ? S / 2 : 0;
      const i0 = Math.floor((-offX - shift - SIZE) / S), i1 = Math.ceil((W - offX - shift + SIZE) / S);
      for (let i = i0; i <= i1; i++) {
        const p = mod(5 * i + 3 * j, N);
        if (!scenes[p]) continue;
        ctx.globalAlpha = Math.min(1, (t - born[p]) / 600); // new arrivals fade in
        ctx.drawImage(gl, (p % PER_ROW) * CELL, Math.floor(p / PER_ROW) * CELL, CELL, CELL, i * S + shift + offX - SIZE / 2, j * DY + DY / 2 + offY - SIZE / 2, SIZE, SIZE);
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  };

  // ---- animation: the sheet at up to 30 frames a second, the drift every frame; paused while hidden
  let visible = true, last = -1e9;
  new IntersectionObserver(([en]) => (visible = en.isIntersecting)).observe(field);
  const frame = (t) => {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    if (t - last > 33) { renderSheet(t); last = t; }
    draw(t);
  };
  requestAnimationFrame(frame);
}
