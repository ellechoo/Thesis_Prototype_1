// portrait-page.js — shows the explorable portrait for ?id=…, or this device's latest recording.
// Hovering (or tapping) any element, or a measurement in the list, highlights everything that
// shows that measurement, dims the rest and explains it. Hovering a single shape describes that
// moment. Tapping pins the selection; tapping empty space clears it.
// Elements carry data-key="a b c": the first key is what hovering it explains; all keys decide
// which list items light it up.
import { getTake, archiveIsShared } from "./store.js?v=3";
import { currentTakeId } from "./nav.js?v=8";
import { portraitSVG } from "./portrait.js?v=27";
import { download, slug, formatDate } from "./shared.js?v=3";

const $ = (id) => document.getElementById(id);
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
let take = null, legend = [], byKey = {}, svg = null, pinned = null;

async function load() {
  const id = currentTakeId(); // from the link, or the recording made / opened earlier in this tab
  if (!id) return empty(null);
  try { take = await getTake(id); }
  catch (e) { return empty(`Couldn't load the recording: ${e.message}`); }
  if (!take) return empty(id ? (archiveIsShared ? "That recording isn't in the archive." : "That recording isn't saved in this browser.") : null);
  if (!take.frames) take.frames = [];

  $("content").hidden = false;
  document.title = `${take.name}'s Voiceprint`;
  $("title").textContent = `${take.name}'s Voiceprint`;
  $("subtitle").textContent = `Recorded ${formatDate(take.createdAt)}`;
  const q = `?id=${encodeURIComponent(take.id)}`;
  $("dataLink").href = `breakdown.html${q}`;

  render();
  darkQuery.addEventListener?.("change", render);
}

function theme() { return "dark"; } // the site is always dark

function render() {
  const { svg: markup, features } = portraitSVG(take, { theme: theme(), idPrefix: "pt" });
  $("stage").innerHTML = markup;
  svg = $("stage").querySelector("svg");
  legend = features.legend;
  byKey = Object.fromEntries(legend.map((l) => [l.key, l]));
  buildList();
  wireSvg();
  wireZoom();
  if (pinned) select(pinned);
}

// ---------- the measurement list ----------
function buildList() {
  const list = $("list");
  list.innerHTML = "";
  for (const item of legend) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "measure";
    b.dataset.key = item.key;
    b.innerHTML = `<span class="m-name"></span><span class="m-value"></span>`;
    b.querySelector(".m-name").textContent = item.data;
    b.querySelector(".m-value").textContent = item.value;
    b.addEventListener("mouseenter", () => !pinned && select(item.key));
    b.addEventListener("focus", () => !pinned && select(item.key));
    b.addEventListener("mouseleave", () => !pinned && clear());
    b.addEventListener("blur", () => !pinned && clear());
    b.addEventListener("click", () => togglePin(item.key));
    li.appendChild(b);
    list.appendChild(li);
  }
}

// ---------- hovering and tapping the portrait ----------
function wireSvg() {
  // Hovering (or tapping) shows a small popup saying what that part is. Nothing else changes.
  const tip = $("tip");
  let hideTimer = null;
  const showTip = (e, el) => {
    const key = el.dataset.key.split(" ")[0];
    const item = byKey[key];
    if (!item) return;
    const detail = el.dataset.detail || el.closest("[data-detail]")?.dataset.detail || item.value;
    tip.innerHTML = `<span class="tip-name"></span><span class="tip-detail"></span><span class="tip-visual"></span>`;
    tip.querySelector(".tip-name").textContent = item.data;
    tip.querySelector(".tip-detail").textContent = detail;
    tip.querySelector(".tip-visual").textContent = item.visual;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.min(e.clientX + 14, window.innerWidth - w - 8);
    const y = e.clientY + 14 + h > window.innerHeight ? e.clientY - h - 12 : e.clientY + 14;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  };
  svg.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const el = e.target.closest?.("[data-key]");
    if (!el) { tip.hidden = true; return; }
    showTip(e, el);
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; });
  svg.addEventListener("click", (e) => {
    if (e.pointerType === "mouse") return;
    const el = e.target.closest?.("[data-key]");
    clearTimeout(hideTimer);
    if (!el) { tip.hidden = true; return; }
    showTip(e, el);
    hideTimer = setTimeout(() => (tip.hidden = true), 4000);
  });
}

function togglePin(key, detail = "") {
  pinned = pinned === key ? null : key;
  if (pinned) select(key, detail); else clear();
}

function select(key, detail = "") {
  const item = byKey[key];
  if (!item || !svg) return;
  svg.classList.add("focusing");
  svg.querySelectorAll("[data-key]").forEach((el) => el.classList.toggle("on", el.dataset.key.split(" ").includes(key)));
  document.querySelectorAll(".measure").forEach((b) => {
    b.classList.toggle("active", b.dataset.key === key);
    b.setAttribute("aria-pressed", String(pinned === key));
  });
  $("rName").textContent = item.data;
  $("rValue").textContent = item.value;
  $("rDetail").textContent = detail && detail !== item.value ? detail : "";
  $("rVisual").textContent = item.visual;
  $("rMeaning").textContent = item.meaning;
}

function clear() {
  if (!svg) return;
  svg.classList.remove("focusing");
  svg.querySelectorAll(".on").forEach((el) => el.classList.remove("on"));
  document.querySelectorAll(".measure").forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); });
  $("rName").textContent = "Explore the portrait";
  $("rValue").textContent = "";
  $("rDetail").textContent = "";
  $("rVisual").textContent = "Every strand, shape and color comes from this voice. Hover or tap any part of the portrait to see what it shows, or pick a measurement below.";
  $("rMeaning").textContent = "";
}

// ---------- zoom & pan (only the portrait; the page itself never zooms) ----------
// Zooming changes the SVG's viewBox, so the vector drawing stays sharp at any zoom.
const MAX_ZOOM = 10;
let baseVB = [0, 0, 1, 1], vb = [0, 0, 1, 1], squareVB = [0, 0, 1, 1], dragged = false;

// The portrait is drawn in a square; the full view widens (or heightens) that square to the
// window's shape, so the portrait sits centered with room around it instead of empty bars.
function fitBaseToWindow() {
  const r = $("stage").getBoundingClientRect();
  const a = r.width && r.height ? r.width / r.height : 1;
  const [x, y, w, h] = squareVB, cx = x + w / 2, cy = y + h / 2;
  baseVB = a >= 1 ? [cx - (h * a) / 2, y, h * a, h] : [x, cy - w / a / 2, w, w / a];
}

// The portrait opens zoomed in by START_ZOOM (1 = the whole canvas, including the outermost
// vowel stars). "Fit" still zooms out to show everything.
const START_ZOOM = 1.4;
function startView() {
  const w = baseVB[2] / START_ZOOM, h = baseVB[3] / START_ZOOM;
  return [baseVB[0] + (baseVB[2] - w) / 2, baseVB[1] + (baseVB[3] - h) / 2, w, h];
}

function wireZoom() {
  squareVB = svg.getAttribute("viewBox").split(/[\s,]+/).map(Number);
  fitBaseToWindow();
  vb = startView();
  applyVB();
  window.addEventListener("resize", () => {
    const zoom = baseVB[3] / vb[3];
    fitBaseToWindow();
    const cx = vb[0] + vb[2] / 2, cy = vb[1] + vb[3] / 2;
    const w = baseVB[2] / zoom, h = baseVB[3] / zoom;
    vb = [cx - w / 2, cy - h / 2, w, h];
    applyVB();
  });
  const toSvg = (cx, cy) => {
    const r = svg.getBoundingClientRect();
    return [vb[0] + ((cx - r.left) / r.width) * vb[2], vb[1] + ((cy - r.top) / r.height) * vb[3]];
  };
  const zoomAt = (factor, cx, cy) => {
    const r = svg.getBoundingClientRect();
    if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    const [px, py] = toSvg(cx, cy);
    const w = Math.max(baseVB[2] / MAX_ZOOM, Math.min(baseVB[2], vb[2] / factor)); // keeps the window's shape
    const k = w / vb[2];
    vb = [px - (px - vb[0]) * k, py - (py - vb[1]) * k, w, vb[3] * k];
    applyVB();
  };

  // trackpad pinch arrives as a wheel event with ctrlKey; Ctrl/⌘ + mouse wheel too.
  // Two-finger scrolling (or a plain wheel) moves around the portrait while it's zoomed in;
  // when it isn't zoomed, it scrolls the page as usual.
  svg.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      return;
    }
    if (!isZoomed()) return;
    // already at the top/bottom edge of the portrait: let the page scroll (to the notes below)
    const vertical = Math.abs(e.deltaY) > Math.abs(e.deltaX);
    const atBottom = vb[1] >= baseVB[1] + baseVB[3] - vb[3] - 0.5 && e.deltaY > 0;
    const atTop = vb[1] <= baseVB[1] + 0.5 && e.deltaY < 0;
    if (vertical && (atBottom || atTop)) return;
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1; // lines / pages → pixels
    vb[0] += ((e.deltaX * unit) / r.width) * vb[2];
    vb[1] += ((e.deltaY * unit) / r.height) * vb[3];
    applyVB();
  }, { passive: false });
  svg.addEventListener("dblclick", (e) => { e.preventDefault(); zoomAt(2, e.clientX, e.clientY); });

  // drag to pan, two fingers to pinch
  const pointers = new Map();
  let last = null, pinchDist = null, pinchMid = null;
  svg.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    dragged = false;
    if (pointers.size === 1) last = [e.clientX, e.clientY];
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]); pinchMid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
  });
  svg.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (pinchDist) zoomAt(d / pinchDist, mid[0], mid[1]);
      if (pinchMid && isZoomed()) { // two fingers sliding together move the view
        const r = svg.getBoundingClientRect();
        vb[0] -= ((mid[0] - pinchMid[0]) / r.width) * vb[2];
        vb[1] -= ((mid[1] - pinchMid[1]) / r.height) * vb[3];
        applyVB();
      }
      pinchDist = d;
      pinchMid = mid;
      dragged = true;
      return;
    }
    if (pointers.size === 1 && last && isZoomed()) {
      const r = svg.getBoundingClientRect();
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
      vb[0] -= (dx / r.width) * vb[2];
      vb[1] -= (dy / r.height) * vb[3];
      last = [e.clientX, e.clientY];
      applyVB();
    }
  });
  const end = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) { pinchDist = null; pinchMid = null; } if (!pointers.size) last = null; };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  // a drag shouldn't also count as a tap on whatever is underneath
  svg.addEventListener("click", (e) => { if (dragged) { e.stopImmediatePropagation(); dragged = false; } }, true);

  $("zoomIn").onclick = () => zoomAt(1.6);
  $("zoomOut").onclick = () => zoomAt(1 / 1.6);
  $("zoomFit").onclick = () => { vb = [...baseVB]; applyVB(); };
}

const isZoomed = () => vb[2] < baseVB[2] - 0.01;

function applyVB() {
  // keep the view inside the portrait
  vb[0] = Math.max(baseVB[0], Math.min(baseVB[0] + baseVB[2] - vb[2], vb[0]));
  vb[1] = Math.max(baseVB[1], Math.min(baseVB[1] + baseVB[3] - vb[3], vb[1]));
  svg.setAttribute("viewBox", vb.map((n) => Math.round(n * 100) / 100).join(" "));
  // when zoomed, one finger moves the portrait; otherwise it scrolls the page as usual
  svg.style.touchAction = isZoomed() ? "none" : "pan-y";
  svg.classList.toggle("zoomed", isZoomed());
  $("zoomOut").disabled = $("zoomFit").disabled = !isZoomed();
}

// ---------- downloads ----------
function exportSVG() {
  const copy = svg.cloneNode(true);
  copy.setAttribute("viewBox", squareVB.join(" ")); // export the whole portrait, not the zoomed view
  copy.classList.remove("focusing");
  copy.querySelectorAll(".on").forEach((el) => el.classList.remove("on"));
  const vb = copy.viewBox.baseVal;
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", vb.x); bg.setAttribute("y", vb.y); bg.setAttribute("width", vb.width); bg.setAttribute("height", vb.height);
  bg.setAttribute("fill", getComputedStyle(document.body).backgroundColor);
  copy.insertBefore(bg, copy.firstChild);
  copy.setAttribute("width", "2000"); copy.setAttribute("height", "2000");
  return new XMLSerializer().serializeToString(copy);
}
$("svgBtn").addEventListener("click", () =>
  download(new Blob([exportSVG()], { type: "image/svg+xml" }), `${slug(take.name)}-voice-portrait.svg`));
$("pngBtn").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([exportSVG()], { type: "image/svg+xml" }));
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 2000;
    c.getContext("2d").drawImage(img, 0, 0, 2000, 2000);
    URL.revokeObjectURL(url);
    c.toBlob((blob) => blob && download(blob, `${slug(take.name)}-voice-portrait.png`), "image/png");
  };
  img.src = url;
});

function empty(msg) {
  $("empty").hidden = false;
  if (msg) $("emptyText").textContent = msg;
}

load();
