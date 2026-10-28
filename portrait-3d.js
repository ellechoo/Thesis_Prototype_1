// portrait-3d.js — the Portrait page: one voice as a 3D portrait (built in voice-orb.js), and under it everything
// measured from the recording (breakdown.js; this used to be the separate Breakdown page).
// The portrait turns slowly on its own; drag (or swipe with two fingers on a trackpad) to turn it yourself; pinch or the
// mouse wheel zoom. Wide screens: the box's left third lists everything that shapes the portrait; opening one (or hovering
// that part of the portrait) shows its explanation, with lines across to where it shows. Phones: tap a part for its popups.
// The ID card button (top right) opens this voice's ID card, which can be downloaded as a picture.
// (People who ask their device for reduced motion get no automatic turning.)
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { getTake, archiveIsShared } from "./store.js?v=2";
import { currentTakeId } from "./nav.js?v=8";
import { formatDate, slug, download } from "./shared.js?v=2";
import { buildOrb, MAP } from "./voice-orb.js?v=35";
import { renderIdCard } from "./id-card.js?v=39";
import { renderBreakdown } from "./breakdown.js?v=28";
const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const $ = (id) => document.getElementById(id);
const VIEW_RADIUS = 1.4;     // how much of the scene fits on screen (the structures reach about 1.3 from the center)
const VIEW_RADIUS_WIDE = 1.2; // wide screens: the portrait has the right two-thirds of the box, drawn a little bigger
const WIDE = 900;            // from this width (px) the box splits: popups and button on the left third, portrait on the right
const SPIN_SPEED = 0.6;      // slow turn (OrbitControls units; 2 = one turn every 30 s)
const SPIN_RESUME_MS = 700;  // after someone turns it by hand (or the popups close), wait this long before turning again
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
  const pauseSpin = () => { controls.autoRotate = false; clearTimeout(resume); if (!still) resume = setTimeout(() => { if (!callout && !hovered) controls.autoRotate = true; }, SPIN_RESUME_MS); };
  controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(resume); });
  controls.addEventListener("end", () => { pauseSpin(); if (shownKey && !hovered) pickFor(shownKey, null); }); // re-aim the lines at what's now in view

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

  let wasWide = null;
  new ResizeObserver(() => {
    resize(); const w = isWide();
    if (wasWide !== null && w !== wasWide) { fit(); hideCallouts(true); hovered = null; setShown(); } // switching layouts: start clean
    wasWide = w;
  }).observe(stage);
  resize();
  fit();
  resumeSpin = pauseSpin;
  setUpFeatures();
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
const wrapEl = () => document.querySelector(".stage-wrap");
const isWide = () => wrapEl().clientWidth >= WIDE;
function fit() {
  const vFov = THREE.MathUtils.degToRad(camera.fov) / 2, hFov = Math.atan(Math.tan(vFov) * camera.aspect);
  const d = (isWide() ? VIEW_RADIUS_WIDE : VIEW_RADIUS) / Math.sin(Math.min(vFov, hFov));
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
function toScreen(v) { // in the box's coordinates (the portrait's canvas may be only part of the box)
  const w = wrapEl().getBoundingClientRect(), c = renderer.domElement.getBoundingClientRect(), p = v.clone().project(camera);
  return [c.left - w.left + (p.x + 1) / 2 * c.width, c.top - w.top + (1 - p.y) / 2 * c.height];
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

// place the boxes (narrower screens only; wide ones use the list): from 760px a column either side of the portrait,
// below that short labels above / below it
function layoutCallouts() {
  if (!callout) return;
  const r = wrapEl().getBoundingClientRect(), W = r.width, H = r.height, M = 16, GAP = 10;
  const items = callout.boxes.map((b) => ({ b, a: toScreen(anchors(b.key, callout.hit)[0]) }));
  const cx = W / 2, cy = H / 2;
  if (W >= 760) {
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
  if (W >= 760) callout.boxes.forEach((b) => b.el.classList.remove("compact", "open"));
  for (const b of callout.boxes) { b.el.style.left = b.x + "px"; b.el.style.top = b.y + "px"; }
  drawLines();
}
// the lines from each box to the spot(s) it describes, redrawn every frame so they follow the turning portrait
function drawLines() {
  const svg = $("calloutLines");
  if (shownKey) return drawFeatureLines(svg);
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
      if (isWide()) { const f = whatsAt(x, y, pick(x, y)); hoverFeature(f); canvas.style.cursor = f ? "help" : ""; return; }
      const h = pick(x, y);
      if (h) { clearTimeout(hideTimer); showCallouts(h.part, h.point); canvas.style.cursor = "help"; }
      else if (callout) { hideCallouts(); resumeLater(); canvas.style.cursor = ""; }
    });
  });
  canvas.addEventListener("pointerleave", (e) => { // (moving onto one of the boxes keeps them up)
    queued = null; if (hovered) { hovered = null; setShown(); }
    if (callout && !e.relatedTarget?.closest?.(".callout")) { hideCallouts(); resumeLater(); }
  });
  $("callouts").addEventListener("pointerleave", (e) => { if (callout && e.relatedTarget !== canvas) { hideCallouts(); resumeLater(); } });
  canvas.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; if (e.pointerType !== "mouse" && callout) { hideCallouts(); } });
  canvas.addEventListener("pointerup", (e) => { // a tap (not a drag) on touch screens
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > (e.pointerType === "mouse" ? 4 : 8)) return;
    if (isWide()) { const f = whatsAt(e.clientX, e.clientY, pick(e.clientX, e.clientY)); if (f) { hovered = e.pointerType === "mouse" ? hovered : null; pinned = f.key; setShown(); } return; } // a click keeps it open
    if (e.pointerType === "mouse") return;
    const h = pick(e.clientX, e.clientY);
    if (h) showCallouts(h.part, h.point); else { hideCallouts(); resumeLater(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (callout) { hideCallouts(); resumeLater(); }
    if (shownKey) { pinned = hovered = null; setShown(); }
  });
}

// ---------------------------------------------------------------- wide screens: the list of everything that shapes the portrait
// The box's left third lists each thing that shapes the portrait (accent; note, pitch & range; vowel space; and the three
// timbre scales). Each opens to its explanation, with a line (or lines) across to where it shows on the portrait. It works
// the other way round too: hovering a part of the portrait opens its item. A click (in the list or on the portrait) keeps
// an item open; hovering something else shows that one until the pointer moves away. The portrait keeps turning while
// an item is open (its lines follow, moving to another spot when theirs turns away); it only stops while the pointer
// is on it, and starts again shortly after.
const LEFTWARD = Math.PI * 0.86; // where the lines aim when there's a choice: the upper left, toward the list
let feats = [], pinned = null, hovered = null, hoverHit = null, hoverAng = null, shownKey = null, picks = {}, resumeSpin = () => {};
let sunMesh = null, swirlMesh = null, accentPts = [], vowelSpots = [], vImg = null, vTilt = null, vTiltT = null;

const cap = (t) => t[0].toUpperCase() + t.slice(1);
// a timbre dial in words, using the same cut-off as the portrait (anything this close to the middle draws nothing)
function dial(v, pos, neg) { const a = Math.abs(v); if (a < MAP.timbre.from) return "In the middle"; return cap((a >= 0.75 ? "very " : a >= 0.4 ? "" : "slightly ") + (v > 0 ? pos : neg)); }

function buildFeatures() {
  const T = orbInfo.traits, tb = T.timbre, ok = tb.enough, F = MAP.timbre.from, none = "There was too little clear voice in this recording to read this, so the core is left plain.";
  const has = { sun: ok && tb.bright >= F, swirl: ok && -tb.bright >= F, spikes: ok && tb.raspy >= MAP.timbre.spikes.from, gloss: ok && tb.raspy <= -F, vowels: T.vowels.pts.length > 0 };
  feats = [
    { key: "accent", name: "Accent", value: byKey.accent?.value || "",
      measure: "Which of 16 broad accent groups this voice sounds closest to, according to an accent-recognition model. Mixed accents get a share of several.",
      look: byKey.accent?.visual || "" },
    { key: "color", name: "Note, pitch & range", value: `${T.note} · ${Math.round(T.pitch)} Hz`,
      measure: `How high or low this voice sits (its typical pitch, ${Math.round(T.pitch)} Hz), the musical note closest to it (${T.note}), and its range: how far it climbs above that and drops below it (${Math.round(T.lo)}–${Math.round(T.hi)} Hz).`,
      look: `Together they make the color of the glowing core. The note picks the hue: the 12 notes go round the color wheel (C red, D yellow, A violet, B pink, in any octave). The pitch picks how deep or pale it is: lower voices are richer, higher voices lighter. The range shades the top and bottom: the top is lighter the higher this voice climbs, the bottom darker the lower it drops (the very highest and lowest moments are ignored, so one squeak or croak doesn't count).` },
    { key: "vowels", name: "Vowel space", value: has.vowels ? `${T.vowels.n} vowel moments` : "Not enough to map", lines: has.vowels,
      measure: "How this voice shapes its vowels: how open the mouth is and where the tongue sits, measured from the sound alone (the same points as the vowel chart in the breakdown).",
      look: byKey.vowels?.visual || "" },
    { group: "Timbre" },
    { key: "bright", name: "Bright ↔ dark", value: ok ? dial(tb.bright, "bright", "dark") : "Not measured", lines: has.sun || has.swirl,
      measure: "Where the sound's energy sits, in the low or the high frequencies, compared with everyone in the archive. More energy up high sounds brighter.",
      look: !ok ? none : has.sun ? "Bright voices shine like a sun: small rays in the core's own color, set a little apart from it and slowly turning clockwise. The brighter the voice, the longer and wider the rays."
        : has.swirl ? "Dark voices pull in a swirl of their own color, like water down a drain: arms curling in towards the core, slowly turning anticlockwise. The darker the voice, the further out and thicker they reach."
        : "This voice sits near the middle, so it has neither: bright voices get sun rays round the core, dark ones a swirl curling into it." },
    { key: "breathy", name: "Breathy ↔ clean", value: ok ? dial(tb.breathy, "breathy", "clean") : "Not measured", lines: ok,
      measure: "How much air and noise is mixed into the tone, compared with everyone in the archive.",
      look: !ok ? none : Math.abs(tb.breathy) < F ? "The edge of the core. This voice is in the middle, so its edge fades softly: neither crisp (clean voices) nor cloudy (breathy ones)."
        : tb.breathy > 0 ? "The edge of the core. Breathy voices fade out into a soft, cloudy edge, with a mist of the core's color drifting just outside it. The breathier the voice, the wider and cloudier the edge. (Clean voices have a crisp one.)"
        : "The edge of the core. Clean voices have a crisp, sharp edge; the cleaner the voice, the crisper. (Breathy voices fade out into a soft, cloudy edge with a mist just outside it.)" },
    { key: "raspy", name: "Raspy ↔ smooth", value: ok ? dial(tb.raspy, "raspy", "smooth") : "Not measured", lines: ok,
      measure: "How much the pitch wobbles from one moment to the next (jitter), compared with everyone in the archive.",
      look: !ok ? none : has.spikes ? "Raspy voices grow small spikes all over the core, like a sea urchin. The raspier the voice, the taller the spikes."
        : has.gloss ? "Smooth voices turn glossy, like polished glass: a crisp oval highlight, a small glint and a bright rim. The smoother the voice, the glossier. The highlights sit a little differently for every voice."
        : "This voice is in the middle, so the surface is plain: raspy voices grow small spikes, smooth ones turn glossy like polished glass." },
  ];
}

function setUpFeatures() {
  const list = $("featureList"); if (!list) return;
  buildFeatures();
  const g = orbInfo.group.children;
  sunMesh = g.find((o) => o.userData.screenOnly && o.material?.uniforms?.n) || null;
  swirlMesh = g.find((o) => o.userData.screenOnly && o.material?.uniforms?.turn && !o.material.uniforms.n) || null;
  // the structures (one layer per accent): a sample of their points, to aim the accent's lines at
  orbInfo.group.updateMatrixWorld(true);
  accentPts = g.filter((o) => o !== coreMesh && !o.userData.screenOnly).map((layer) => {
    const out = [];
    layer.traverse((o) => { const pos = o.geometry?.attributes?.position; if (!pos) return; const step = Math.max(1, Math.floor(pos.count / 400));
      for (let i = 0; i < pos.count; i += step) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)); });
    return out;
  }).filter((a) => a.length);
  // the vowel spots: where each sits on the core (the same placement as voice-orb.js), and how crowded its neighbourhood is
  const u = coreMesh?.material?.uniforms;
  if (u?.vMap?.value) {
    const cv = u.vMap.value.image; vImg = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
    vTilt = u.vTilt.value; vTiltT = vTilt.clone().transpose();
    const V = MAP.vowels, vw = orbInfo.traits.vowels, D = Math.PI / 180, at = (v, [lo, hi]) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    vowelSpots = vw.pts.map(([l1, l2]) => {
      const lat = (0.5 - at(l1, vw.f1)) * 2 * V.lat * D, lon = (90 + (at(l2, vw.f2) - 0.5) * 360) * D;
      const dir = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).applyMatrix3(vTiltT).normalize();
      return { dir, front: at(l2, vw.f2) > 0.5, crowd: 0 };
    });
    for (const a of vowelSpots) for (const b of vowelSpots) if (a.front === b.front && a.dir.dot(b.dir) > 0.94) a.crowd++;
  }
  // the list
  list.innerHTML = '<div class="feat-inner">' + feats.map((f) => f.group ? `<p class="feat-group">${esc(f.group)}</p>` : `
    <div class="feat" data-key="${f.key}">
      <button type="button" class="feat-head" aria-expanded="false" aria-controls="feat-${f.key}">
        <span class="feat-name">${esc(f.name)}</span><span class="feat-val">${esc(f.value)}</span><span class="feat-chev" aria-hidden="true"></span>
      </button>
      <div class="feat-body" id="feat-${f.key}" role="region"><div><p>${esc(f.measure)}</p><p>${esc(f.look)}</p></div></div>
    </div>`).join("") + "</div>";
  list.querySelectorAll(".feat-head").forEach((b) => b.addEventListener("click", () => {
    const k = b.parentElement.dataset.key;
    pinned = shownKey === k ? null : k; hovered = null; setShown();
  }));
  list.addEventListener("scroll", drawLines, { passive: true });
  new ResizeObserver(placeList).observe(list);
  placeList();
}
// The list sits midway between the title and the button (as much room above it as below, with everything closed).
// An item opens downward; only if it would run out of room does the list move up (and then scroll, if it still doesn't fit).
function placeList() {
  const list = $("featureList"), inner = list?.firstElementChild; if (!inner || !list.clientHeight) return;
  const H = list.clientHeight, closed = [...inner.children].reduce((s, el) => s + (el.classList.contains("feat") ? el.querySelector(".feat-head").offsetHeight + 1 : el.offsetHeight + parseFloat(getComputedStyle(el).marginTop) + parseFloat(getComputedStyle(el).marginBottom)), 0);
  const open = inner.querySelector(".feat.open .feat-body > div")?.scrollHeight || 0;
  inner.style.marginTop = Math.max(0, Math.min((H - closed) / 2, H - closed - open)) + "px";
}

function hoverFeature(f) {
  if (!f) { if (hovered) { hovered = null; setShown(); } return; }
  hoverHit = f.hit; hoverAng = f.ang;
  if (hovered !== f.key) { hovered = f.key; setShown(); }
}
function setShown() {
  const k = hovered ?? pinned;
  if (k !== shownKey) {
    shownKey = k;
    if (k) pickFor(k, hovered ? hoverAng : null);
    document.querySelectorAll("#featureList .feat").forEach((el) => {
      const on = el.dataset.key === k; el.classList.toggle("open", on); el.querySelector(".feat-head").setAttribute("aria-expanded", on);
    });
    if (k) { const el = document.querySelector(`#featureList .feat[data-key="${k}"]`); setTimeout(() => { if (shownKey === k) el?.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" }); }, 300); }
  }
  if (hovered) controls.autoRotate = false; else if (!controls.autoRotate) resumeSpin();
  placeList();
  drawLines();
}

// the camera's own directions (right, up, toward the viewer) and the core's place and size on screen
function basis() {
  const q = camera.quaternion;
  return { right: new THREE.Vector3(1, 0, 0).applyQuaternion(q), up: new THREE.Vector3(0, 1, 0).applyQuaternion(q), toCam: camera.position.clone().sub(controls.target).normalize() };
}
function coreOnScreen() {
  const [x, y] = toScreen(new THREE.Vector3()), [x2, y2] = toScreen(basis().right.multiplyScalar(MAP.core.radius));
  return { x, y, r: Math.hypot(x2 - x, y2 - y) };
}
const around = (ang, rad, B = basis()) => B.right.clone().multiplyScalar(Math.cos(ang) * rad).add(B.up.clone().multiplyScalar(Math.sin(ang) * rad)); // a point in the screen's plane, round the centre
const onSurface = (x, y, B = basis()) => B.right.clone().multiplyScalar(x).add(B.up.clone().multiplyScalar(y)).add(B.toCam.clone().multiplyScalar(Math.sqrt(Math.max(0, 1 - x * x - y * y)))).multiplyScalar(coreR);
const nearestTurn = (want, have) => want + Math.round((have - want) / (2 * Math.PI)) * 2 * Math.PI; // `have`, shifted by whole turns to sit nearest `want`

// choose what each item's lines aim at, from what's in view now (pref: the screen angle to aim near, when hovering)
function pickFor(key, pref) {
  const ang = pref ?? LEFTWARD, B = basis(), c = coreOnScreen();
  if (key === "bright" && sunMesh) { // the long ray nearest that angle
    const u = sunMesh.material.uniforms, n = u.n.value;
    picks.ray = 2 * Math.round(((ang - u.turn.value) / (2 * Math.PI) * n + u.off.value) / 2);
  }
  if (key === "bright" && swirlMesh) { // the swirl arm nearest that angle
    const u = swirlMesh.material.uniforms, W = MAP.timbre.swirl, rr = 1 + (W.reach[0] + (W.reach[1] - W.reach[0]) * u.amt.value) * 0.35;
    picks.arm = Math.round(((ang + W.twist * Math.log(rr) - u.turn.value) * W.arms - Math.PI / 2) / (2 * Math.PI)); picks.armR = rr;
  }
  if (key === "accent") { // on each layer of the structure: a point facing the viewer, clear of the core, as near the list as possible
    picks.accent = accentPts.map((pts) => {
      let best = null, bx = Infinity;
      for (const p of pts) {
        if (p.dot(B.toCam) < 0.05) continue;
        const [x, y] = toScreen(p); if (Math.hypot(x - c.x, y - c.y) < c.r * 1.05) continue;
        if (x < bx) { bx = x; best = p; }
      }
      return best;
    }).filter(Boolean);
  }
  if (key === "vowels" && vowelSpots.length) { // the most crowded front ("ee") and back ("oo") spots facing the viewer
    const toCamLocal = coreMesh.worldToLocal(camera.position.clone()).normalize();
    picks.vowels = [true, false].map((front) => {
      let best = null, bs = 0;
      for (const s of vowelSpots) { if (s.front !== front) continue; const f = s.dir.dot(toCamLocal); if (f < 0.45) continue; const sc = s.crowd * f * f; if (sc > bs) { bs = sc; best = s; } }
      return best && best.dir; // (kept in the core's own frame: the core turns on its own, the other way to the structure)
    }).filter(Boolean);
  }
}

// where each item's lines point, this frame
function anchorsFor(key) {
  const B = basis(), R = MAP.core.radius, u = coreMesh?.material?.uniforms, f = feats.find((x) => x.key === key);
  if (f && f.lines === false) return [];
  const hit = hovered === key ? hoverHit : null, hang = hovered === key ? hoverAng : null;
  switch (key) {
    case "color": return [new THREE.Vector3(), B.up.clone().multiplyScalar(coreR * 0.8), B.up.clone().multiplyScalar(-coreR * 0.8)]; // its middle, top and bottom
    case "accent": // (as the portrait turns, a point that goes round the back is swapped for one in view)
      if (hit) return [hit];
      if (!picks.accent || picks.accent.some((p) => p.dot(B.toCam) < 0)) pickFor("accent", null);
      return picks.accent;
    case "vowels":
      if (hit) return [hit];
      { const spot = (d) => coreMesh.localToWorld(d.clone().multiplyScalar(coreR * 0.98));
        if (!picks.vowels || picks.vowels.length < 2 || picks.vowels.some((d) => spot(d).normalize().dot(B.toCam) < 0.3)) pickFor("vowels", null);
        return (picks.vowels || []).map(spot); }
    case "breathy": return [around(hang ?? LEFTWARD + 0.25, R * 0.97, B)];                                     // the edge
    case "raspy":
      if (u?.gloss.value > 0) return [onSurface(u.gw1.value.x, u.gw1.value.y, B), onSurface(u.gw2.value.x, u.gw2.value.y, B)]; // the highlight and the glint
      return [hit || onSurface(-0.5, -0.35, B)];                                                                  // the spikes (or the plain surface)
    case "bright":
      if (sunMesh) { const s = sunMesh.material.uniforms, th = (picks.ray - s.off.value.valueOf()) / s.n.value * 2 * Math.PI + s.turn.value; return [around(th, s.r0.value + s.len.value * 0.5, B)]; }
      if (swirlMesh) { const s = swirlMesh.material.uniforms, W = MAP.timbre.swirl, rr = picks.armR; return [around((Math.PI / 2 + 2 * Math.PI * picks.arm) / W.arms - W.twist * Math.log(rr) + s.turn.value, rr * R, B)]; }
      return [];
  }
  return [];
}

// what's under the pointer (client coordinates; first: what the ray hit)
function whatsAt(clientX, clientY, h) {
  if (h?.part === "accent") return { key: "accent", hit: h.point };
  const w = wrapEl().getBoundingClientRect(), c = coreOnScreen(), px = clientX - w.left, py = clientY - w.top;
  const x = (px - c.x) / c.r, y = -(py - c.y) / c.r, r = Math.hypot(x, y), ang = Math.atan2(y, x), u = coreMesh.material.uniforms;
  const tb = orbInfo.traits.timbre, ok = tb.enough;
  if (r < 1) {
    if (!h) return null;
    if (ok && r > Math.max(0.84, 1 - u.edgeW.value)) return { key: "breathy", ang };
    if (u.gloss.value > 0 && onGlass(x, y, u)) return { key: "raspy" };
    if (vowelWeight(h.point) > 0.25) return { key: "vowels", hit: h.point };
    if (ok && tb.raspy >= MAP.timbre.spikes.from && r > 0.3 && Math.abs(y) < 0.55) return { key: "raspy", hit: h.point };
    return { key: "color" };
  }
  if (!ok) return null;
  if (r < 1.1) return { key: "breathy", ang };
  if (sunMesh && r < (sunMesh.material.uniforms.r0.value + sunMesh.material.uniforms.len.value) / MAP.core.radius + 0.06) return { key: "bright", ang };
  if (swirlMesh && r < 1 + MAP.timbre.swirl.reach[0] + (MAP.timbre.swirl.reach[1] - MAP.timbre.swirl.reach[0]) * swirlMesh.material.uniforms.amt.value * 0.8) return { key: "bright", ang };
  if (tb.breathy > 0.15 && r < MAP.timbre.mist.reach) return { key: "breathy", ang };
  return null;
}
function onGlass(x, y, u) { // over one of the smooth highlights (with a little room around it)?
  for (const [w, rot] of [[u.gw1.value, u.gShape.value.x], [u.gw2.value, u.gShape.value.y]]) {
    const dx = x - w.x, dy = y - w.y, cs = Math.cos(rot), sn = Math.sin(rot);
    if (Math.hypot((cs * dx + sn * dy) / w.z, (-sn * dx + cs * dy) / w.w) < 1.4) return true;
  }
  return false;
}
function vowelWeight(p) { // how strongly the vowel spots cover this point of the core (as the core's own shader reads it)
  if (!vImg) return 0;
  const d = coreMesh.worldToLocal(p.clone()).normalize().applyMatrix3(vTilt);
  const uu = ((Math.atan2(d.z, d.x) / (2 * Math.PI)) % 1 + 1) % 1, vv = 0.5 + Math.asin(Math.max(-1, Math.min(1, d.y))) / Math.PI;
  const X = Math.min(vImg.width - 1, Math.floor(uu * vImg.width)), Y = Math.min(vImg.height - 1, Math.floor((1 - vv) * vImg.height)), i = (Y * vImg.width + X) * 4;
  return (vImg.data[i] + vImg.data[i + 1]) / 255;
}

// lines from the open item's heading, across the dividing line, to each spot it describes
function drawFeatureLines(svg) {
  const el = document.querySelector(`#featureList .feat[data-key="${shownKey}"] .feat-head`), list = $("featureList");
  const pts = anchorsFor(shownKey);
  if (!el || !pts.length || !el.offsetParent) { svg.innerHTML = ""; return; }
  const w = wrapEl().getBoundingClientRect(), r = el.getBoundingClientRect(), lr = list.getBoundingClientRect();
  const sx = r.right - w.left + 10, sy = Math.max(lr.top + 8, Math.min(lr.bottom - 8, r.top + r.height / 2)) - w.top;
  let out = `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2.5"/>`;
  for (const v of pts) { const [ax, ay] = toScreen(v); out += `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}"/><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="3.5"/>`; }
  svg.innerHTML = out;
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
document.querySelectorAll(".to-breakdown").forEach((b) => b.addEventListener("click", () => $("breakdown").scrollIntoView({ behavior: smooth, block: "start" })));
document.querySelectorAll(".to-portrait").forEach((b) => b.addEventListener("click", () => window.scrollTo({ top: 0, behavior: smooth })));

load();
