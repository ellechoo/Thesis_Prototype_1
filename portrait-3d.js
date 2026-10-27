// portrait-3d.js — the Portrait page: one voice as a 3D portrait (built in voice-orb.js), and under it everything
// measured from the recording (breakdown.js; this used to be the separate Breakdown page).
// The portrait turns slowly on its own; drag (or swipe with two fingers on a trackpad) to turn it yourself; pinch or the
// mouse wheel zoom. Hover (or tap) a part to see what it shows: one box per feature, each with a line pointing to it.
// The ID card button (top right) opens this voice's ID card, which can be downloaded as a picture.
// (People who ask their device for reduced motion get no automatic turning.)
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { getTake, archiveIsShared } from "./store.js?v=2";
import { currentTakeId } from "./nav.js?v=8";
import { formatDate, slug, download } from "./shared.js?v=2";
import { buildOrb } from "./voice-orb.js?v=34";
import { renderIdCard } from "./id-card.js?v=38";
import { renderBreakdown } from "./breakdown.js?v=27";
const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const $ = (id) => document.getElementById(id);
const VIEW_RADIUS = 1.4;     // how much of the scene fits on screen (the structures reach about 1.3 from the center)
const SPIN_SPEED = 0.6;      // slow turn (OrbitControls units; 2 = one turn every 30 s)
const SPIN_RESUME_MS = 4000; // after someone turns it by hand, wait this long before turning again
const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let take, orbInfo, renderer, scene, camera, controls, byKey = {}, coreMesh, coreR = 0.58;

async function load() {
  const id = currentTakeId();
  if (!id) return empty(null);
  try { take = await getTake(id); } catch (e) { return empty(`Couldn't load the recording: ${e.message}`); }
  if (!take) return empty(archiveIsShared ? "That recording isn't in the archive." : "That recording isn't saved in this browser.");
  take.frames ||= [];
  $("content").hidden = false;
  document.title = `${take.name}'s Voiceprint`;
  $("title").textContent = `${take.name}'s Voiceprint`;
  $("subtitle").textContent = `Recorded ${formatDate(take.createdAt)}`;
  setUpScene();
  try { renderBreakdown(take); } catch (e) { console.warn("Couldn't show the measurements:", e); }
  wireIdCard();
}
function empty(msg) { $("empty").hidden = false; if (msg) $("emptyText").textContent = msg; }

// ---------------------------------------------------------------- scene
function setUpScene() {
  const stage = $("stage");
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  stage.prepend(renderer.domElement);
  renderer.domElement.className = "orb-canvas";

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const key = new THREE.DirectionalLight(0xffffff, 2.2);  // main light, upper left
  key.position.set(-3, 4, 5);
  const rim = new THREE.DirectionalLight(0xffffff, 1.2);  // edge light from behind, to show the silhouette
  rim.position.set(4, 1, -5);
  scene.add(key, rim);

  orbInfo = buildOrb(take);
  scene.add(orbInfo.group);
  byKey = Object.fromEntries(orbInfo.legend.map((l) => [l.key, l]));
  coreMesh = orbInfo.group.children.find((o) => o.isMesh && o.userData.part === "core");
  if (coreMesh) { coreMesh.geometry.computeBoundingSphere(); coreR = coreMesh.geometry.boundingSphere.radius; }

  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = 1.8;
  controls.maxDistance = 14;
  controls.autoRotate = !still;
  controls.autoRotateSpeed = SPIN_SPEED;
  let resume = null;
  const pauseSpin = () => { controls.autoRotate = false; clearTimeout(resume); if (!still) resume = setTimeout(() => { if (!callout) controls.autoRotate = true; }, SPIN_RESUME_MS); };
  controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(resume); });
  controls.addEventListener("end", pauseSpin);

  // Two-finger swipe on a trackpad turns it (instead of zooming). A pinch (sent as a wheel event with
  // ctrlKey) and a real mouse wheel still zoom, handled by OrbitControls as before.
  const looksLikeTrackpad = (e) => {
    if (e.ctrlKey || e.deltaMode !== 0) return false;
    if (e.deltaX !== 0) return true;
    const legacy = e.wheelDeltaY;
    if (typeof legacy === "number" && legacy !== 0) return Math.abs(legacy) === Math.abs(e.deltaY) * 3 || Math.abs(legacy) % 120 !== 0;
    return Math.abs(e.deltaY) < 50;
  };
  const sph = new THREE.Spherical();
  stage.addEventListener("wheel", (e) => {
    if (e.target !== renderer.domElement || !looksLikeTrackpad(e)) return;
    e.preventDefault(); e.stopPropagation();
    pauseSpin();
    const k = (2 * Math.PI) / Math.max(300, renderer.domElement.clientHeight);
    const off = camera.position.clone().sub(controls.target);
    sph.setFromVector3(off);
    sph.theta += e.deltaX * k;
    sph.phi = Math.min(Math.PI - 0.05, Math.max(0.05, sph.phi + e.deltaY * k));
    camera.position.copy(controls.target).add(off.setFromSpherical(sph));
    controls.update();
  }, { capture: true, passive: false });
  renderer.setAnimationLoop(() => { controls.update(); render(); drawLines(); });

  new ResizeObserver(() => { resize(); }).observe(stage);
  resize();
  fit();
  wireCallouts(pauseSpin);
}

function resize() {
  const r = $("stage").getBoundingClientRect();
  if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  if (callout) layoutCallouts();
  render();
}
function fit() {
  const vFov = THREE.MathUtils.degToRad(camera.fov) / 2, hFov = Math.atan(Math.tan(vFov) * camera.aspect);
  const d = VIEW_RADIUS / Math.sin(Math.min(vFov, hFov));
  camera.position.set(0, d * 0.22, d).setLength(d);
  controls.target.set(0, 0, 0);
  controls.update();
  render();
}
function render() { renderer.render(scene, camera); }

// ---------------------------------------------------------------- hover / tap: one box per feature, pointing at it
// Hovering the core shows four boxes (its note & pitch colour, timbre, vowel spots and pitch range), hovering the white
// structure shows the accent's box. Each box sits to one side of the portrait with a line to the spot it describes; the
// lines follow the portrait as it turns, and the portrait stops turning while they're up. On narrow screens the boxes are
// short labels (feature and value) above and below the portrait; tapping one opens its explanation.
const FEATURES = { core: ["core", "timbre", "vowels", "range"], accent: ["accent"] };
let callout = null; // { part, hit (world point or null), boxes: [{ key, el, side }] }

function anchors(key, hit) {
  const c = new THREE.Vector3(0, 0, 0), q = camera.quaternion;
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const toCam = camera.position.clone().sub(controls.target).normalize();
  const onCore = (x, y) => right.clone().multiplyScalar(x).add(up.clone().multiplyScalar(y)).add(toCam.clone().multiplyScalar(Math.sqrt(Math.max(0, 1 - x * x - y * y)))).multiplyScalar(coreR);
  switch (key) {
    case "core": return [c];                                                       // the glowing colour: its middle
    case "range": return [up.clone().multiplyScalar(coreR * 0.82), up.clone().multiplyScalar(-coreR * 0.82)]; // its top and bottom
    case "timbre": return [right.clone().multiplyScalar(coreR * 1.02).add(up.clone().multiplyScalar(coreR * 0.2))]; // its edge
    case "vowels": return [callout?.part === "core" && hit ? hit.clone() : onCore(-0.42, 0.3)];      // a spot on its surface
    case "accent": return [hit ? hit.clone() : right.clone().multiplyScalar(1.05)];                  // the structure
    default: return [c];
  }
}
function toScreen(v) {
  const r = $("stage").getBoundingClientRect(), p = v.clone().project(camera);
  return [(p.x + 1) / 2 * r.width, (1 - p.y) / 2 * r.height];
}

function showCallouts(part, hit) {
  if (callout && callout.part === part) { callout.hit = hit; return; } // same boxes; only the pointed-at spot moves
  hideCallouts(true);
  const box = $("callouts");
  callout = { part, hit, boxes: [] };
  for (const key of FEATURES[part] || []) {
    const item = byKey[key]; if (!item) continue;
    const el = document.createElement("div");
    el.className = "callout";
    el.innerHTML = `<p class="co-title"><span>${esc(item.data)}</span> <b>${esc(item.value)}</b></p><p class="co-text">${esc(item.visual)}</p>`;
    el.addEventListener("click", () => { if (!el.classList.contains("compact")) return; el.classList.toggle("open"); layoutCallouts(); });
    box.appendChild(el);
    callout.boxes.push({ key, el });
  }
  layoutCallouts();
  requestAnimationFrame(() => callout?.boxes.forEach((b) => b.el.classList.add("on")));
  controls.autoRotate = false;
}
let hideTimer = null;
function hideCallouts(now = false) {
  clearTimeout(hideTimer);
  const go = () => { $("callouts").innerHTML = ""; $("calloutLines").innerHTML = ""; callout = null; };
  if (now || !callout) return go();
  callout.boxes.forEach((b) => b.el.classList.remove("on"));
  const gone = callout; hideTimer = setTimeout(() => { if (callout === gone) go(); }, 180);
}

// place the boxes: in a column either side of the portrait (wide screens) or in a stack above / below it (narrow ones)
function layoutCallouts() {
  if (!callout) return;
  const r = $("stage").getBoundingClientRect(), W = r.width, H = r.height, wide = W >= 760, M = 16, GAP = 10;
  const items = callout.boxes.map((b) => ({ b, a: toScreen(anchors(b.key, callout.hit)[0]) }));
  const cx = W / 2, cy = H / 2;
  if (wide) {
    const BW = Math.min(300, (W - 2 * M) * 0.26);
    items.forEach((it) => (it.side = it.a[0] < cx ? "left" : "right"));
    const left = items.filter((i) => i.side === "left"), right = items.filter((i) => i.side === "right");
    while (Math.abs(left.length - right.length) > 1) { // balance the two columns
      const [from, to] = left.length > right.length ? [left, right] : [right, left];
      from.sort((p, q) => Math.abs(p.a[0] - cx) - Math.abs(q.a[0] - cx)); const moved = from.shift(); moved.side = to === left ? "left" : "right"; to.push(moved);
    }
    for (const [col, side] of [[left, "left"], [right, "right"]]) {
      col.sort((p, q) => p.a[1] - q.a[1]);
      col.forEach((it) => { it.b.el.style.width = BW + "px"; });
      const hs = col.map((it) => it.b.el.offsetHeight), total = hs.reduce((s, h) => s + h, 0) + GAP * Math.max(0, col.length - 1);
      const mid = col.length ? col.reduce((s, it) => s + it.a[1], 0) / col.length : cy;
      let y = Math.max(110, Math.min(H - M - total, mid - total / 2));
      col.forEach((it, k) => { it.b.side = side; it.b.x = side === "left" ? M : W - M - BW; it.b.y = y; it.b.w = BW; it.b.h = hs[k]; y += hs[k] + GAP; });
    }
  } else {
    const BW = W - 2 * M;
    const top = items.filter((i) => i.a[1] < cy).sort((p, q) => p.a[1] - q.a[1]), bottom = items.filter((i) => i.a[1] >= cy).sort((p, q) => p.a[1] - q.a[1]);
    items.forEach((it) => { it.b.el.style.width = BW + "px"; it.b.el.classList.add("compact"); });
    let y = 96;
    top.forEach((it) => { const h = it.b.el.offsetHeight; Object.assign(it.b, { side: "top", x: M, y, w: BW, h }); y += h + GAP; });
    let yb = H - M;
    [...bottom].reverse().forEach((it) => { const h = it.b.el.offsetHeight; yb -= h; Object.assign(it.b, { side: "bottom", x: M, y: yb, w: BW, h }); yb -= GAP; });
  }
  if (wide) callout.boxes.forEach((b) => b.el.classList.remove("compact", "open"));
  for (const b of callout.boxes) { b.el.style.left = b.x + "px"; b.el.style.top = b.y + "px"; }
  drawLines();
}
// the lines from each box to the spot(s) it describes, redrawn every frame so they follow the turning portrait
function drawLines() {
  const svg = $("calloutLines");
  if (!callout) { if (svg.firstChild) svg.innerHTML = ""; return; }
  let out = "";
  for (const b of callout.boxes) {
    if (b.x == null) continue;
    for (const v of anchors(b.key, callout.hit)) {
      const [ax, ay] = toScreen(v);
      let sx, sy;
      if (b.side === "left") { sx = b.x + b.w; sy = Math.max(b.y + 14, Math.min(b.y + b.h - 14, ay)); }
      else if (b.side === "right") { sx = b.x; sy = Math.max(b.y + 14, Math.min(b.y + b.h - 14, ay)); }
      else if (b.side === "top") { sy = b.y + b.h; sx = Math.max(b.x + 20, Math.min(b.x + b.w - 20, ax)); }
      else { sy = b.y; sx = Math.max(b.x + 20, Math.min(b.x + b.w - 20, ax)); }
      out += `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}"/><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="3.5"/>`;
    }
  }
  svg.innerHTML = out;
}

function wireCallouts(pauseSpin) {
  const canvas = renderer.domElement, ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  ray.params.Points.threshold = 0.05;
  ray.params.Line.threshold = 0.025;
  const pick = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    ptr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(orbInfo.group.children, true).find((h) => h.object.userData.part);
    return hit ? { part: hit.object.userData.part, point: hit.point.clone() } : null;
  };
  let queued = null, down = null;
  const resumeLater = () => { if (!still) pauseSpin(); };
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    queued = [e.clientX, e.clientY];
    requestAnimationFrame(() => {
      if (!queued) return; const [x, y] = queued; queued = null;
      const h = pick(x, y);
      if (h) { clearTimeout(hideTimer); showCallouts(h.part, h.point); canvas.style.cursor = "help"; }
      else if (callout) { hideCallouts(); resumeLater(); canvas.style.cursor = ""; }
    });
  });
  canvas.addEventListener("pointerleave", (e) => { // (moving onto one of the boxes keeps them up)
    if (callout && !e.relatedTarget?.closest?.(".callout")) { hideCallouts(); resumeLater(); }
  });
  $("callouts").addEventListener("pointerleave", (e) => { if (callout && e.relatedTarget !== canvas) { hideCallouts(); resumeLater(); } });
  canvas.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; if (e.pointerType !== "mouse" && callout) { hideCallouts(); } });
  canvas.addEventListener("pointerup", (e) => { // a tap (not a drag) on touch screens
    if (e.pointerType === "mouse" || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return;
    const h = pick(e.clientX, e.clientY);
    if (h) showCallouts(h.part, h.point); else { hideCallouts(); resumeLater(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && callout) { hideCallouts(); resumeLater(); } });
}

// ---------------------------------------------------------------- the ID card (top right), with a picture download
function wireIdCard() {
  const dlg = $("idDialog"), view = $("idView"), btn = $("idDownload");
  let made = false;
  $("idCardBtn").addEventListener("click", () => {
    if (!made) {
      renderIdCard(view, take); made = true;
      // the card's own × closes the dialog here (on the Archive it goes back to the gallery)
      view.querySelector(".id-close")?.addEventListener("click", (e) => { e.preventDefault(); dlg.close(); });
    }
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  });
  $("idClose").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // a click on the dimmed backdrop
  btn.addEventListener("click", async () => {
    const card = view.querySelector(".id-card"); if (!card) return;
    const label = btn.textContent; btn.disabled = true; btn.textContent = "Preparing…";
    try {
      const { toPng } = await import("https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/+esm");
      const url = await toPng(card, { pixelRatio: 2, backgroundColor: "#000000", filter: (n) => !n.classList?.contains("id-close") });
      download(await (await fetch(url)).blob(), `${slug(take.name)}-voice-id.png`);
      btn.textContent = label;
    } catch (e) {
      console.warn("Couldn't make the picture:", e);
      btn.textContent = "Couldn't make the picture, try again";
    }
    btn.disabled = false;
  });
}

// ---------------------------------------------------------------- jump down to the breakdown, and back up
const smooth = still ? "auto" : "smooth";
$("toBreakdown").addEventListener("click", () => $("breakdown").scrollIntoView({ behavior: smooth, block: "start" }));
$("toPortrait").addEventListener("click", () => window.scrollTo({ top: 0, behavior: smooth }));

load();
