// archive.js — every saved recording, newest first, as a field of live, turning voice portraits.
// No cards or labels: hovering (or tabbing to) a portrait shows the person's name and spins it faster;
// clicking opens that person's voice ID card (archive.html?id=…), still on the Archive page. The card's
// X, Esc, or the Archive tab go back to the gallery, at the same spot.
//
// A browser can only run a handful of live 3D views per page, so (like the landing page) ONE shared
// renderer draws every portrait that's on screen into its own cell of an offscreen "sheet", up to 30 times
// a second, and each tile copies its cell onto its own small canvas. Portraits off screen aren't drawn.
// The list arrives without the detailed frames (to stay quick), so each voice's full data is loaded when
// its tile first scrolls near the screen, then its portrait fades in.
import * as THREE from "three";
import { listTakes, getTake } from "./store.js";
import { buildOrb } from "./voice-orb.js?v=32";
import { renderIdCard } from "./id-card.js?v=35";

const $ = (id) => document.getElementById(id);
const still = matchMedia("(prefers-reduced-motion: reduce)").matches; // then the portraits don't turn
const SPIN = 0.00025, SPIN_HOVER = 0.00075; // radians per millisecond
let takes = [];

// Coming back from an ID card (X, Esc, the Archive tab or the browser's back button) returns to the
// same spot in the gallery: the scroll position is remembered when a portrait is clicked.
const SPOT = "archiveSpot";
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
const remember = (id) => { try { sessionStorage.setItem(SPOT, JSON.stringify({ y: window.scrollY, id })); } catch {} };
function restoreSpot() {
  let spot = null;
  try { spot = JSON.parse(sessionStorage.getItem(SPOT) || "null"); sessionStorage.removeItem(SPOT); } catch {}
  if (!spot) return;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    if (spot.y <= max + 1) window.scrollTo(0, spot.y);
    else document.querySelector(`.orb-tile[data-id="${CSS.escape(spot.id || "")}"]`)?.scrollIntoView({ block: "center" });
  });
}

async function load() {
  const id = new URLSearchParams(location.search).get("id");
  if (id) return showCard(id);
  try { takes = await listTakes(); }
  catch (e) { $("status").textContent = `Couldn't open the archive: ${e.message}`; $("status").classList.add("error"); return; }
  render();
  restoreSpot();
}

// ---------- the gallery ----------
const tiles = []; // { el, canvas, ctx, take, scene, angle, born, loading, near, hover }

function render() {
  const grid = $("grid");
  grid.innerHTML = "";
  grid.classList.add("orb-grid");
  $("empty").hidden = takes.length > 0;
  for (const t of takes) {
    const a = document.createElement("a");
    a.className = "orb-tile";
    a.href = `archive.html?id=${encodeURIComponent(t.id)}`;
    a.dataset.id = t.id;
    a.setAttribute("aria-label", `${t.name}: open their voice ID card`);
    a.innerHTML = `<canvas aria-hidden="true"></canvas><span class="orb-name" aria-hidden="true"></span>`;
    a.querySelector(".orb-name").textContent = t.name;
    const tile = { el: a, canvas: a.querySelector("canvas"), take: t, scene: null, angle: Math.random() * Math.PI * 2, born: 0, loading: false, near: false, hover: false };
    tile.ctx = tile.canvas.getContext("2d");
    a.addEventListener("click", () => remember(t.id));
    a.addEventListener("pointerenter", () => (tile.hover = true));
    a.addEventListener("pointerleave", () => (tile.hover = false));
    a.addEventListener("focus", () => (tile.hover = true));
    a.addEventListener("blur", () => (tile.hover = false));
    tiles.push(tile);
    grid.appendChild(a);
    watcher.observe(a);
  }
  sizeCanvases();
  if (renderer) requestAnimationFrame(frame);
}

// which tiles are on (or near) the screen; load their data the first time they come close
const watcher = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const tile = tiles.find((t) => t.el === e.target);
    if (!tile) continue;
    tile.near = e.isIntersecting;
    if (tile.near && !tile.scene && !tile.loading) build(tile);
  }
}, { rootMargin: "200px" });

let building = 0; const queue = [];
function build(tile) { tile.loading = true; queue.push(tile); pump(); }
function pump() {
  while (building < 4 && queue.length) {
    const tile = queue.shift(); building++;
    (async () => {
      try {
        let t = tile.take;
        if (!t.frames) t = tile.take = { ...t, ...(await getTake(t.id)) };
        if (renderer) { const s = new THREE.Scene(); s.add(buildOrb({ ...t, frames: t.frames || [] }).group); tile.scene = s; tile.born = performance.now(); }
      } catch (err) { console.warn(`Couldn't draw ${tile.take.name}:`, err); tile.el.classList.add("failed"); }
      building--; pump();
    })();
  }
}

// ---------- one shared 3D renderer ----------
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas: document.createElement("canvas"), antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.setPixelRatio(1); renderer.autoClear = false; renderer.setClearColor(0x000000, 1);
} catch (e) { console.warn("No WebGL, so no portraits:", e); }
const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 60), dd = 1.4 / Math.sin(THREE.MathUtils.degToRad(15)); // same framing as the Portrait page
cam.position.set(0, dd * 0.22, dd).setLength(dd); cam.lookAt(0, 0, 0);

let CELL = 256, dpr = 1;
function sizeCanvases() {
  dpr = Math.min(2, devicePixelRatio || 1);
  const size = tiles[0]?.el.clientWidth || 200;
  CELL = Math.min(320, Math.round(size * dpr));
  for (const t of tiles) { t.canvas.width = CELL; t.canvas.height = CELL; }
}
addEventListener("resize", sizeCanvases);

let last = -1e9, lastT = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(100, t - lastT); lastT = t;
  if (!still) for (const tile of tiles) tile.angle += dt * (tile.hover ? SPIN_HOVER : SPIN);
  if (document.hidden || document.body.classList.contains("showing-id") || t - last < 33) return;
  last = t;
  const live = tiles.filter((x) => x.near && x.scene);
  if (!live.length) return;
  const perRow = Math.ceil(Math.sqrt(live.length)), rows = Math.ceil(live.length / perRow);
  const w = perRow * CELL, h = rows * CELL;
  const gl = renderer.domElement;
  if (gl.width !== w || gl.height !== h) renderer.setSize(w, h, false);
  renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
  live.forEach((tile, k) => {
    const x = (k % perRow) * CELL, y = (rows - 1 - Math.floor(k / perRow)) * CELL;
    renderer.setViewport(x, y, CELL, CELL); renderer.setScissor(x, y, CELL, CELL); renderer.clearDepth();
    tile.scene.children[0].rotation.y = tile.angle;
    renderer.render(tile.scene, cam);
  });
  live.forEach((tile, k) => {
    tile.ctx.globalAlpha = 1; tile.ctx.fillStyle = "#000"; tile.ctx.fillRect(0, 0, CELL, CELL);
    tile.ctx.globalAlpha = Math.min(1, (t - tile.born) / 600); // new arrivals fade in
    tile.ctx.drawImage(gl, (k % perRow) * CELL, Math.floor(k / perRow) * CELL, CELL, CELL, 0, 0, CELL, CELL);
  });
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
