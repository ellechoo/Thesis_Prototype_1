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
// One portrait at a time wears a small speech-bubble name tag, so it's clear each one belongs to someone: as one tag
// fades out the next fades in on another portrait that's fully on screen and well clear of the text.
import * as THREE from "three";
import { listTakes, getTake } from "./store.js?v=2";
import { buildOrb, turnBelt } from "./voice-orb.js?v=66";
import { spreadOut } from "./spread.js?v=12"; // (voiceprints that look alike aren't placed next to each other)

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
try { people = spreadOut((await listTakes()).slice(0, MAX_VOICES)); } catch (e) { console.warn("Couldn't load the archive:", e); }
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
    S = W < 640 ? 140 : 190; DY = S * 0.87; SIZE = S * (W < 640 ? 0.86 : 0.84); // same spacing and size as the Archive's Flat view
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
      scenes[k].children[0].rotation.y = still ? phase[k] : phase[k] - t * 0.00025; // turning to the left (the core turns the other way)
      turnBelt(scenes[k].children[0], still ? 0 : t / 1000); // (the speaking-rate band turns too)
      renderer.render(scenes[k], cam);
    }
  };

  // ---- the endless honeycomb, drifting: tile (i, j) shows voice (5i + 3j) mod N, so neighbours differ
  const mod = (a, n) => ((a % n) + n) % n;
  let tiles = []; // where each tile is this frame (for the name tags)
  const draw = (t) => {
    const W = field.clientWidth, H = field.clientHeight;
    const offX = still ? 0 : -t * DRIFT[0], offY = still ? 0 : -t * DRIFT[1];
    tiles = [];
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, view.width, view.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalCompositeOperation = "screen";
    const j0 = Math.floor((-offY - SIZE) / DY), j1 = Math.ceil((H - offY + SIZE) / DY);
    for (let j = j0; j <= j1; j++) {
      const shift = mod(j, 2) ? S / 2 : 0;
      const i0 = Math.floor((-offX - shift - SIZE) / S), i1 = Math.ceil((W - offX - shift + SIZE) / S);
      for (let i = i0; i <= i1; i++) {
        const p = mod(5 * i + 3 * j, N);
        tiles.push({ i, j, p, x: i * S + shift + offX, y: j * DY + DY / 2 + offY });
        if (!scenes[p]) continue;
        ctx.globalAlpha = Math.min(1, (t - born[p]) / 600); // new arrivals fade in
        ctx.drawImage(gl, (p % PER_ROW) * CELL, Math.floor(p / PER_ROW) * CELL, CELL, CELL, i * S + shift + offX - SIZE / 2, j * DY + DY / 2 + offY - SIZE / 2, SIZE, SIZE);
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  };

  // ---- name tags: one portrait at a time, back to back. Two tags take turns, so one can fade out while the next fades in.
  // A tag goes only on a portrait fully on screen and well clear of the text block (and its tail) and the nav tabs,
  // with margin for the drift while it shows; the tags also sit beneath the text block, so they can never cover it.
  const tags = [0, 1].map(() => { const el = document.createElement("div"); el.className = "home-name"; el.setAttribute("aria-hidden", "true"); field.appendChild(el); return { el, on: null }; });
  const SHOW = 3000;   // how long each name is up (ms); the next one starts as it fades
  const OFF = 0.2;     // the tag's height on its portrait: over its lower part (share of the portrait's size below its centre)
  let turn = 0, lastP = -1, nextAt = 2000;
  const keepClear = (bpad) => { // the text block (desktop) and the nav tabs, in the field's coordinates, padded
    const f = field.getBoundingClientRect(), out = [];
    for (const [sel, pad, tail] of [[".home-block", bpad, 60], [".tabs", 20, 0]]) {
      for (const el of document.querySelectorAll(sel)) {
        const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
        out.push([b.left - f.left - pad, b.top - f.top - pad, b.right - f.left + pad, b.bottom - f.top + pad + tail]);
      }
    }
    return out;
  };
  function nextTag(t) {
    const W = field.clientWidth, H = field.clientHeight, m = 10, half = SIZE / 2;
    const busy = new Set(tags.filter((g) => g.on).map((g) => `${g.on.i},${g.on.j}`));
    const fits = (clear) => tiles.filter(({ i, j, p, x, y }) => {
      if (!scenes[p] || t - born[p] < 800 || p === lastP || busy.has(`${i},${j}`)) return false;
      const box = [x - half, y - half, x + half, y + half];
      if (box[0] < m || box[1] < m || box[2] > W - m || box[3] > H - m) return false; // fully on screen
      return !clear.some((c) => box[0] < c[2] && box[2] > c[0] && box[1] < c[3] && box[3] > c[1]);
    });
    // well clear of the text block if possible; on smaller screens, where the block fills most of the view, a closer (but
    // still clear) margin. If nothing fits even then, no tag shows until a portrait drifts into a clear spot.
    let ok = [];
    for (const pad of [70, 36]) { ok = fits(keepClear(pad)); if (ok.length) break; }
    if (!ok.length) { nextAt = t + 400; return; }
    const pick = ok[Math.floor(Math.random() * ok.length)], g = tags[turn]; turn = 1 - turn;
    g.on = { i: pick.i, j: pick.j, t0: t }; lastP = pick.p;
    g.el.textContent = people[pick.p].name; g.el.classList.add("on");
    nextAt = t + SHOW; // the next tag fades in just as this one starts to fade out
  }
  function placeTags(t) {
    if (t >= nextAt) nextTag(t);
    for (const g of tags) {
      if (!g.on) continue;
      const it = tiles.find((q) => q.i === g.on.i && q.j === g.on.j);
      if (it) g.el.style.transform = `translate(${it.x}px, ${it.y + SIZE * OFF}px) translate(-50%, 0)`;
      if (t - g.on.t0 > SHOW && g.el.classList.contains("on")) g.el.classList.remove("on");
      if (t - g.on.t0 > SHOW + 600) g.on = null;
    }
  }

  // ---- animation: the sheet at up to 30 frames a second, the drift every frame; paused while hidden
  let visible = true, last = -1e9;
  new IntersectionObserver(([en]) => (visible = en.isIntersecting)).observe(field);
  const frame = (t) => {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    if (t - last > 33) { renderSheet(t); last = t; }
    draw(t);
    placeTags(t);
  };
  requestAnimationFrame(frame);
}
