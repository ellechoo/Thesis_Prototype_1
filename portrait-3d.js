// portrait-3d.js — the Portrait page: one voice as a 3D portrait (built in voice-orb.js), and under it everything
// measured from the recording (breakdown.js; this used to be the separate Breakdown page).
// The portrait turns slowly on its own; drag (or swipe with two fingers on a trackpad) to turn it yourself; pinch or the
// mouse wheel zoom. Wide screens: the box's left third lists everything that shapes the portrait; opening one (or hovering
// that part of the portrait) shows its explanation, with lines across to where it shows. Narrower screens: tap (or hover)
// a part and the same kind of box shows at the bottom of the portrait, with its lines.
// The download button (top right) shows what can be downloaded (this voice's ID card), with a button to save it as a picture.
// (People who ask their device for reduced motion get no automatic turning.)
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { getTake, archiveIsShared } from "./store.js?v=2";
import { currentTakeId } from "./nav.js?v=8";
import { formatDate, slug, download } from "./shared.js?v=3";
import { buildOrb, MAP, traits, voiceColor } from "./voice-orb.js?v=46";
import { renderIdCard } from "./id-card.js?v=51";
import { renderBreakdown } from "./breakdown.js?v=41";
const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const $ = (id) => document.getElementById(id);
const VIEW_RADIUS = 1.27;    // how much of the scene fits on screen (the structures reach about 1.3 from the center; on phones the portrait starts about 10% bigger than a full fit)
const VIEW_RADIUS_WIDE = 1.2; // wide screens: the portrait has the right two-thirds of the box, drawn a little bigger
const WIDE = 900;            // from this width (px) the box splits: popups and button on the left third, portrait on the right
const SPIN_SPEED = -0.6;     // slow turn (OrbitControls units; 2 = one turn every 30 s). Negative: the structure turns to the left (the core, the other way)
const SPIN_RESUME_MS = 700;  // after someone turns it by hand, wait this long before turning again
const SPIN_SLOW = 0.25;      // while the pointer is on the portrait (or its popups are up) it slows to this share of its speed, without stopping
let spinTarget = SPIN_SPEED; // the speed it's easing towards
const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let take, orbInfo, renderer, scene, camera, controls, byKey = {}, coreMesh, coreR = 0.58;

async function load() {
  const id = currentTakeId();
  if (!id) return empty(null);
  try { take = await getTake(id); } catch (e) { return empty(`Couldn't load the recording: ${e.message}`); }
  if (!take) return empty(archiveIsShared ? "That recording isn't in the archive." : "That recording isn't saved in this browser.");
  take.frames ||= [];
  // fade in (from black) once the portrait has drawn; coming from the Archive it also settles from a little closer,
  // carrying on the Archive's zoom into this voice
  let fromArchive = false;
  try { fromArchive = sessionStorage.getItem("arriveFrom") === "archive"; sessionStorage.removeItem("arriveFrom"); } catch {}
  document.body.classList.add("arriving"); document.body.classList.toggle("from-archive", fromArchive);
  $("content").hidden = false;
  document.title = `${take.name}'s Voiceprint`;
  // the heading: "Name's Voiceprint" and "Recorded <date>" on computers; on phones just the name and the date, to save room
  const showTitle = () => {
    $("title").textContent = wideQuery.matches ? `${take.name}'s Voiceprint` : take.name;
    $("subtitle").textContent = wideQuery.matches ? `Recorded ${formatDate(take.createdAt)}` : formatDate(take.createdAt);
  };
  showTitle(); wideQuery.addEventListener("change", showTitle);
  try { useVoiceAccent(take); } catch (e) { console.warn("Couldn't use the voice's colour:", e); }
  setUpScene();
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove("arriving"))); // (after its first frames)
  try { renderBreakdown(take); } catch (e) { console.warn("Couldn't show the measurements:", e); }
  wireIdCard();
}
// Each Voiceprint page uses the voice's own colour (the colour of its typical note, as on the portrait's core) in place of
// the site's red: buttons and highlights, the charts, the breakdown's headings, the "See full breakdown" strip. Very dark
// colours are lightened just enough to read on black.
function useVoiceAccent(take) {
  const T = traits(take), col = voiceColor(T.pitch, T.note), hsl = {}; col.getHSL(hsl);
  const lum = (c) => { const h = c.getHexString(), ch = (i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4); };
  while (lum(col) < 0.18 && hsl.l < 0.92) { hsl.l += 0.02; col.setHSL(hsl.h, hsl.s, hsl.l); } // (contrast with black of at least 4.6 : 1)
  const hex = "#" + col.getHexString(), onIt = lum(col) > 0.3 ? "#111111" : "#ffffff";
  document.documentElement.style.setProperty("--accent", hex);
  document.documentElement.style.setProperty("--accent-text", onIt);
  // a few things draw the red directly (the nav tabs' hover fill is an SVG picture): copy those rules with this colour
  const reds = [/%23e5352d/gi, /#e5352d/gi, /rgb\(229, 53, 45\)/g], to = [`%23${hex.slice(1)}`, hex, hex];
  const swap = (t) => reds.reduce((s, re, i) => s.replace(re, to[i]), t), has = (t) => reds.some((re) => (re.lastIndex = 0, re.test(t)));
  const copy = (rules) => [...rules].map((r) => r.cssRules && r.conditionText ? (() => { const inner = copy(r.cssRules); return inner ? `@media ${r.conditionText} { ${inner} }` : ""; })() : has(r.cssText) ? swap(r.cssText) : "").filter(Boolean).join("\n");
  let css = "";
  for (const sh of document.styleSheets) { try { css += copy(sh.cssRules); } catch {} } // (other sites' stylesheets can't be read; they have no red)
  const st = document.createElement("style"); st.id = "voiceAccent"; st.textContent = css; document.head.append(st);
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
  const pauseSpin = () => { controls.autoRotate = false; clearTimeout(resume); if (!still) resume = setTimeout(() => { controls.autoRotate = true; }, SPIN_RESUME_MS); };
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
  renderer.setAnimationLoop(() => {
    controls.autoRotateSpeed += (spinTarget - controls.autoRotateSpeed) * 0.06; // eases into the slower (or normal) speed
    controls.update(); render(); drawLines(); placeHotspots(); listFades();
  });

  let wasWide = null;
  new ResizeObserver(() => {
    resize(); const w = isWide();
    if (wasWide !== null && w !== wasWide) { fit(); hovered = null; shownKey = undefined; setShown(); } // switching layouts: start clean
    wasWide = w;
    if (!w) requestAnimationFrame(layoutSheet);
  }).observe(stage);
  resize();
  fit();
  setUpFeatures();
  wireCallouts();
}

function resize() {
  const r = $("stage").getBoundingClientRect();
  if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  // narrower screens: the portrait sits a little below the middle of its box (the name and date take up the top)
  const shift = isWide() ? 0 : 12;
  if (shift) camera.setViewOffset(r.width, r.height, 0, -shift, r.width, r.height); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  render();
}
const wrapEl = () => document.querySelector(".stage-wrap");
const wideQuery = matchMedia(`(min-width: ${WIDE}px)`);
const isWide = () => wideQuery.matches; // (the same test as the page's layout, which goes by the window's width, not the box's)
function fit() {
  const vFov = THREE.MathUtils.degToRad(camera.fov) / 2, hFov = Math.atan(Math.tan(vFov) * camera.aspect);
  const d = (isWide() ? VIEW_RADIUS_WIDE : VIEW_RADIUS) / Math.sin(Math.min(vFov, hFov));
  camera.position.set(0, d * 0.22, d).setLength(d);
  controls.target.set(0, 0, 0);
  controls.update();
  render();
}
function render() { renderer.render(scene, camera); }

function toScreen(v) { // in the box's coordinates (the portrait's canvas may be only part of the box)
  const w = wrapEl().getBoundingClientRect(), c = renderer.domElement.getBoundingClientRect(), p = v.clone().project(camera);
  return [c.left - w.left + (p.x + 1) / 2 * c.width, c.top - w.top + (1 - p.y) / 2 * c.height];
}
// the lines from the open item to the spot(s) it describes, redrawn every frame so they follow the turning portrait
function drawLines() {
  const svg = $("calloutLines");
  if (shownKey) return drawFeatureLines(svg);
  if (svg.firstChild) svg.innerHTML = "";
}

// hover (mouse) or tap: open the item for whatever part of the portrait is there
function wireCallouts() {
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
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    queued = [e.clientX, e.clientY];
    requestAnimationFrame(() => {
      if (!queued) return; const [x, y] = queued; queued = null;
      const f = isWide() ? whatsAt(x, y, pick(x, y)) : null; hoverFeature(f); canvas.style.cursor = f ? "help" : ""; // (narrower screens: clicks only, no hover)
    });
  });
  canvas.addEventListener("pointerleave", () => { queued = null; if (hovered) { hovered = null; setShown(); } });
  canvas.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener("pointerup", (e) => { // a click or tap (not a drag) keeps that part's item open; a tap on nothing closes it
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > (e.pointerType === "mouse" ? 4 : 8) || !tapsOn()) return;
    const f = whatsAt(e.clientX, e.clientY, pick(e.clientX, e.clientY));
    if (e.pointerType !== "mouse") { hovered = null; if (f) { hoverHit = keepHit(f); hoverAng = f.ang; } pinned = f ? f.key : null; pinnedHit = f ? { hit: hoverHit, ang: f.ang } : null; setShown(); }
    else if (f) { pinned = f.key; pinnedHit = { hit: hoverHit, ang: hoverAng }; setShown(); }
    else if (pinned) { pinned = pinnedHit = null; setShown(); } // a click on an empty part of the portrait closes the open box
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && shownKey) { pinned = hovered = null; setShown(); } });
  // a tap or click anywhere outside the open box closes it (the portrait itself is handled above: a click on another part
  // opens that one instead, and dragging to turn it leaves the box open; another item in the list opens that one)
  document.addEventListener("click", (e) => {
    if (!pinned || e.target.closest?.("#featureSheet, .hotspot, .orb-canvas, #featureList .feat")) return;
    pinned = hovered = pinnedHit = null; setShown();
  });
}

// ---------------------------------------------------------------- everything that shapes the portrait: the list (wide screens), the box (narrower)
// The box's left third lists each thing that shapes the portrait (accent; note, pitch & range; vowel space; and the three
// timbre scales). Each opens to its explanation, with a line (or lines) across to where it shows on the portrait. It works
// the other way round too: hovering a part of the portrait opens its item. A click (in the list or on the portrait) keeps
// an item open; hovering something else shows that one until the pointer moves away. The portrait keeps turning while
// an item is open (its lines follow, moving to another spot when theirs turns away), slowing down (never stopping)
// while the pointer is on it.
// where the lines aim when there's a choice: wide screens, the upper left (toward the list); narrower ones, down (toward the box)
const aim = () => (isWide() ? Math.PI * 0.86 : -Math.PI / 2);
let feats = [], pinned = null, pinnedHit = null, hovered = null, hoverHit = null, hoverAng = null, shownKey = null, picks = {};
let sunMesh = null, swirlMesh = null, accentPts = [], vowelSpots = [], vImg = null, vTilt = null, vTiltT = null;

const cap = (t) => t[0].toUpperCase() + t.slice(1);
// a timbre dial in words, using the same cut-off as the portrait (anything this close to the middle draws nothing)
function dial(v, pos, neg, from = MAP.timbre.from) { const a = Math.abs(v); if (a < from) return "In the middle"; return cap((a >= 0.75 ? "very " : a >= 0.4 ? "" : "slightly ") + (v > 0 ? pos : neg)); }

// each item: a short line on what it shows, plus a small picture (color swatches with their hex codes, a scale with this
// voice's place on it, or the accent shares). The full detail is in the breakdown below the portrait.
const hex = (c) => "#" + c.getHexString().toUpperCase();
const swatch = (c, label) => `<span class="fv-sw"><i style="background:${hex(c)}"></i><span><b>${esc(label)}</b><code>${hex(c)}</code></span></span>`;
// (the scale reads in the same order as the item's name: "Bright ↔ dark" has bright on the left)
const scale = (v, pos, neg) => `<div class="fv-scale" role="img" aria-label="${esc(dial(v, pos.toLowerCase(), neg.toLowerCase()))}, on a scale from ${esc(pos)} to ${esc(neg)}">
    <span>${esc(pos)}</span><span class="fv-track" style="--v:${((1 - Math.max(-1, Math.min(1, v))) / 2).toFixed(3)}"><i></i></span><span>${esc(neg)}</span></div>`;
function buildFeatures() {
  const T = orbInfo.traits, tb = T.timbre, ok = tb.enough, F = MAP.timbre.from, u = coreMesh?.material?.uniforms || {};
  const none = "Too little clear voice to read this, so the core is left plain.";
  const has = { sun: ok && tb.bright >= F, swirl: ok && -tb.bright >= F, spikes: ok && tb.raspy >= MAP.timbre.spikes.from, gloss: ok && tb.raspy <= -MAP.timbre.glass.from, vowels: T.vowels.pts.length > 0 };
  const shares = T.hasAccent ? `<div class="fv-bars">${T.accents.slice(0, 3).map((a) => `<div class="fv-bar"><span>${esc(a.name)}</span><span class="fv-bar-track"><i style="width:${Math.round(a.w * 100)}%"></i></span><span class="fv-num">${Math.round(a.w * 100)}%</span></div>`).join("")}</div>` : "";
  feats = [
    { key: "accent", name: "Accent", value: byKey.accent?.value || "", spot: true,
      text: T.hasAccent ? "The accent group the voice sounds closest to. Each group has its own structure; a mix of accents layers them." : "No accent result, so the structure is the default prism shell.",
      visual: shares },
    { key: "color", name: "Note, pitch & range", value: `${T.note} · ${Math.round(T.pitch)} Hz`, spot: true,
      text: "The note picks the color and the pitch how deep it is. The top and bottom shade to the highest and lowest notes.",
      visual: u.cMain ? `<div class="fv-sws">${swatch(u.cBot.value, `Low · ${Math.round(T.lo)} Hz`)}${swatch(u.cMain.value, `${T.note} · ${Math.round(T.pitch)} Hz`)}${swatch(u.cTop.value, `High · ${Math.round(T.hi)} Hz`)}</div>` : "" },
    { key: "vowels", name: "Vowel space", value: has.vowels ? `${T.vowels.n} vowel moments` : "Not enough to map", lines: has.vowels, spot: has.vowels,
      text: has.vowels ? "Each glowing spot is a vowel sound. Vowels like “ee” glow in one color, vowels like “oo” in the other." : "Too few vowels were measured to map them.",
      visual: has.vowels && u.vFront ? `<div class="fv-sws">${swatch(u.vFront.value, "“ee” vowels")}${swatch(u.vBack.value, "“oo” vowels")}</div>` : "" },
    { key: "bright", name: "Bright ↔ dark", value: ok ? dial(tb.bright, "bright", "dark") : "Not measured", lines: has.sun || has.swirl, spot: has.sun || has.swirl,
      text: !ok ? none : has.sun ? "Bright voices shine with sun rays around the core." : has.swirl ? "Dark voices pull in a swirl of color, like water down a drain." : "Near the middle, so neither sun rays nor a swirl.",
      visual: ok ? scale(tb.bright, "Bright", "Dark") : "" },
    { key: "breathy", name: "Breathy ↔ clean", value: ok ? dial(tb.breathy, "breathy", "clean") : "Not measured", lines: ok, spot: ok,
      text: !ok ? none : Math.abs(tb.breathy) < F ? "Near the middle, so the core's edge fades softly." : tb.breathy > 0 ? "Breathy voices get a soft, cloudy edge." : "Clean voices get a crisp, sharp edge.",
      visual: ok ? scale(tb.breathy, "Breathy", "Clean") : "" },
    { key: "raspy", name: "Raspy ↔ smooth", value: ok ? dial(tb.raspy, "raspy", "smooth", MAP.timbre.spikes.from) : "Not measured", lines: ok, spot: has.spikes || has.gloss,
      text: !ok ? none : has.spikes ? "Raspy voices grow small spikes all over the core." : has.gloss ? "Smooth voices look like polished glass." : "Near the middle, so the surface is plain.",
      visual: ok ? scale(tb.raspy, "Raspy", "Smooth") : "" },
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
  list.innerHTML = '<div class="feat-inner">' + feats.map((f) => f.group ? `<p class="feat-group">${esc(f.group)}</p>` : featBox(f, "list")).join("") + "</div>";
  // a click on a closed item's heading opens it; a click anywhere on an open box closes it
  list.querySelectorAll(".feat").forEach((box) => box.addEventListener("click", (e) => {
    const k = box.dataset.key, isOpen = box.classList.contains("open");
    if (!isOpen && !e.target.closest(".feat-head")) return;
    if (isOpen && getSelection()?.toString()) return; // (selecting text in it doesn't close it)
    pinned = isOpen ? null : k; pinnedHit = null; hovered = null; setShown();
  }));
  list.addEventListener("scroll", drawLines, { passive: true });
  new ResizeObserver(placeList).observe(list);
  placeList();
  renderSheet();
  // narrower screens: a pulsing point on each part of the portrait that has a box (people can't hover on phones); once its
  // box has been opened the point stays, quieter and still, so the ones still pulsing are the ones not seen yet
  const spots = $("hotspots");
  if (spots) {
    spots.innerHTML = feats.filter((f) => f.spot).map((f) => `<button type="button" class="hotspot" data-key="${f.key}" aria-label="${esc(f.name)}: ${esc(f.value)}"><span></span></button>`).join("");
    spots.querySelectorAll(".hotspot").forEach((b, i) => {
      b.style.setProperty("--delay", `${(i * 0.37) % 1.6}s`); // not all pulsing in step
      b.addEventListener("click", () => { pinned = b.dataset.key; pinnedHit = null; hovered = null; setShown(); });
    });
  }
  for (const k of ["accent", "vowels", "bright"]) pickFor(k, null);
  // the eye button (narrower screens): hides the points, and with them tapping the portrait for its boxes, so it can be
  // looked at on its own; any open box closes. Pressing it again brings them back.
  $("spotsBtn")?.addEventListener("click", (e) => {
    spotsOn = !spotsOn;
    const b = e.currentTarget; b.setAttribute("aria-pressed", spotsOn); b.title = spotsOn ? "Hide the points" : "Show the points";
    b.classList.toggle("off", !spotsOn); $("hotspots").hidden = !spotsOn;
    pinned = hovered = pinnedHit = null; setShown();
  });
}
let spotsOn = true;
const tapsOn = () => isWide() || spotsOn; // (narrower screens with the points hidden: the portrait is only for looking at)
// wide screens: the list fades at its top or bottom edge only when there's more to scroll to that way
function listFades() {
  const l = $("featureList"); if (!l || !isWide()) return;
  let above = l.scrollTop > 1, below = l.scrollTop + l.clientHeight < l.scrollHeight - 1;
  const open = l.querySelector(".feat.open"); // never fade an open box's own top or bottom edge
  if (open && (above || below)) {
    const lr = l.getBoundingClientRect(), r = open.getBoundingClientRect();
    if (r.top >= lr.top - 2 && r.top <= lr.top + 18) above = false;
    if (r.bottom <= lr.bottom + 2 && r.bottom >= lr.bottom - 22) below = false;
  }
  if (l.classList.contains("more-above") !== above) l.classList.toggle("more-above", above);
  if (l.classList.contains("more-below") !== below) l.classList.toggle("more-below", below);
}
// each point sits on its part, following it as the portrait turns (the open one's point gives way to its lines)
function placeHotspots() {
  const spots = $("hotspots"); if (!spots || isWide() || !spotsOn) return;
  const w = wrapEl().getBoundingClientRect(), c = renderer.domElement.getBoundingClientRect(), top = c.top - w.top, box = $("featureSheet")?.firstElementChild;
  const bottom = box ? box.getBoundingClientRect().top - w.top - 10 : top + c.height; // (none behind the open box)
  for (const b of spots.children) {
    const k = b.dataset.key, pts = k === shownKey ? [] : anchorsFor(k, true);
    const v = k === "color" ? pts[1] : pts[0]; // note, pitch & range: the top of the core
    if (!v) { b.hidden = true; continue; }
    const [x, y] = toScreen(v); b.hidden = y < top + 4 || y > bottom - 4;
    b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
}
// The list sits midway between the title and the button (as much room above it as below, with everything closed).
// An item opens downward; only if it would run out of room does the list move up (and then scroll, if it still doesn't fit).
function placeList() {
  const list = $("featureList"), inner = list?.firstElementChild; if (!inner || !list.clientHeight) return;
  const lcs = getComputedStyle(list), H = list.clientHeight - parseFloat(lcs.paddingTop) - parseFloat(lcs.paddingBottom), closed = [...inner.children].reduce((s, el) => {
    const cs = getComputedStyle(el), m = parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
    return s + m + (el.classList.contains("feat") ? el.querySelector(".feat-head").offsetHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) : el.offsetHeight);
  }, 0);
  const open = inner.querySelector(".feat.open .feat-body > div")?.scrollHeight || 0;
  inner.style.marginTop = Math.max(0, Math.min((H - closed) / 2, H - closed - open)) + "px";
}

// one item's box: its name and value (a button that opens and closes it) over its explanation. The list holds one per
// item; on narrower screens the box at the bottom of the portrait holds the open one, with a × to put it away.
function featBox(f, where, open = false) {
  const id = `feat-${where}-${f.key}`, head = `<button type="button" class="feat-head" aria-expanded="${open}" aria-controls="${id}">
        <span class="feat-name">${esc(f.name)}</span><span class="feat-val">${esc(f.value)}</span><span class="feat-chev" aria-hidden="true"></span>
      </button>`;
  const plain = `<div class="feat-head"><span class="feat-name">${esc(f.name)}</span><span class="feat-val">${esc(f.value)}</span></div>`; // (the box at the bottom doesn't fold)
  return `<div class="feat${open ? " open" : ""}" data-key="${f.key}">
      ${where === "sheet" ? `<div class="sheet-row">${plain}<button type="button" class="sheet-close" aria-label="Close">×</button></div>` : head}
      <div class="feat-body" id="${id}" role="region"><div><p>${esc(f.text)}</p>${f.visual || ""}</div></div>
    </div>`;
}
function renderSheet() { // narrower screens: the open item's box at the bottom of the portrait
  const sheet = $("featureSheet"); if (!sheet) return;
  const f = !isWide() && feats.find((x) => x.key === shownKey);
  sheet.innerHTML = f ? featBox(f, "sheet", true) : "";
  sheet.querySelector(".sheet-close")?.addEventListener("click", () => { pinned = hovered = null; setShown(); });
  layoutSheet();
}
// The box may cover up to the lower part of the portrait; a longer explanation makes the portrait's frame taller to fit
// it (the portrait itself stays where it is), and closing it brings the frame back to its usual height.
const SHEET_COVER = 0.3; // how much of the frame's height the box may cover (about the empty space below the portrait) before the frame grows
function layoutSheet() {
  const wrap = wrapEl(), stage = $("stage"), box = $("featureSheet")?.firstElementChild;
  if (isWide()) { wrap.style.height = stage.style.height = ""; if ($("featureSheet")) $("featureSheet").style.top = ""; return; }
  const was = wrap.style.height; wrap.style.transition = "none"; wrap.style.height = "";
  const base = wrap.getBoundingClientRect().height; wrap.style.height = was; void wrap.offsetHeight; wrap.style.transition = "";
  // the "See full breakdown" strip runs along the bottom of the frame: the portrait and the box stay above it
  const strip = document.querySelector(".explore .jump-btn.in-box")?.offsetHeight || 0, area = base - strip;
  stage.style.height = area + "px";
  const need = box ? area * (1 - SHEET_COVER) + box.offsetHeight + 12 + strip : base;
  wrap.style.height = Math.max(base, need) + "px";
  // the box goes straight to its place (measured from the top, so it doesn't ride down as the frame grows below it)
  const sheet = $("featureSheet");
  if (sheet) sheet.style.top = box ? Math.max(area * (1 - SHEET_COVER), area - 12 - box.offsetHeight) + "px" : "";
}
const keepHit = (f) => f.hit && (f.core ? { local: coreMesh.worldToLocal(f.hit.clone()) } : f.hit); // (a spot on the core is kept in the core's own frame: it keeps turning)

function hoverFeature(f) {
  if (!f) { if (hovered) { hovered = null; setShown(); } return; }
  hoverHit = keepHit(f); hoverAng = f.ang;
  if (hovered !== f.key) { hovered = f.key; setShown(); }
}
function setShown() {
  const k = hovered ?? pinned;
  if (!hovered && pinnedHit && k === pinned) { hoverHit = pinnedHit.hit; hoverAng = pinnedHit.ang; } // a clicked spot stays pointed at
  if (k !== shownKey) {
    shownKey = k;
    if (k && !isWide()) $("hotspots")?.querySelector(`[data-key="${k}"]`)?.classList.add("seen"); // its point stops pulsing: opened already
    if (k) pickFor(k, hovered || pinnedHit ? hoverAng : null);
    renderSheet();
    document.querySelectorAll("#featureList .feat").forEach((el) => {
      const on = el.dataset.key === k; el.classList.toggle("open", on); el.querySelector(".feat-head").setAttribute("aria-expanded", on);
    });
    if (k) { const el = document.querySelector(`#featureList .feat[data-key="${k}"]`); setTimeout(() => { if (shownKey === k) el?.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" }); }, 300); }
  }
  spinTarget = hovered || (shownKey && !isWide()) ? SPIN_SPEED * SPIN_SLOW : SPIN_SPEED; // slower while the pointer is on it (or its box covers it), never stopped
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
  const wide = isWide(), ang = pref ?? (wide ? aim() : key === "bright" ? 0.35 : aim()), B = basis(), c = coreOnScreen();
  if (key === "bright" && sunMesh) { // the long ray nearest that angle
    const u = sunMesh.material.uniforms, n = u.n.value;
    picks.ray = 2 * Math.round(((ang - u.turn.value) / (2 * Math.PI) * n + u.off.value) / 2);
  }
  if (key === "bright" && swirlMesh) { // the swirl arm nearest that angle
    const u = swirlMesh.material.uniforms, W = MAP.timbre.swirl, rr = 1 + (W.reach[0] + (W.reach[1] - W.reach[0]) * u.amt.value) * 0.35;
    picks.arm = Math.round(((ang + W.twist * Math.log(rr) - u.turn.value) * W.arms - Math.PI / 2) / (2 * Math.PI)); picks.armR = rr;
  }
  if (key === "accent") { // on each layer of the structure: a point facing the viewer, clear of the core, as near the list (or box) as possible
    picks.accent = accentPts.map((pts) => {
      let best = null, bx = Infinity;
      for (const p of pts) {
        if (p.dot(B.toCam) < 0.05) continue;
        const [x, y] = toScreen(p); if (Math.hypot(x - c.x, y - c.y) < c.r * 1.05) continue;
        const score = wide ? x : -x; // toward the list (wide screens); else the right-hand side, clear of the other points
        if (score < bx) { bx = score; best = p; }
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
function anchorsFor(key, spot = false) {
  const B = basis(), R = MAP.core.radius, u = coreMesh?.material?.uniforms, f = feats.find((x) => x.key === key);
  if (f && f.lines === false) return [];
  const mine = !spot && (hovered === key || (!hovered && pinnedHit && pinned === key));
  const hit0 = mine ? hoverHit : null, hit = hit0?.local ? coreMesh.localToWorld(hit0.local.clone()) : hit0, hang = mine ? hoverAng : null;
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
    case "breathy": return [around(hang ?? (isWide() ? aim() + 0.25 : Math.PI * 1.12), R * 0.97, B)]; // (narrower screens: the left edge, clear of the other points)                                     // the edge
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
    if (vowelWeight(h.point) > 0.25) return { key: "vowels", hit: h.point, core: true };
    if (ok && tb.raspy >= MAP.timbre.spikes.from && r > 0.3 && Math.abs(y) < 0.55) return { key: "raspy", hit: h.point, core: true };
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
  // each line starts at the middle of the open box's edge (computers: its right side; phones: its top) and ends in a dot
  // on the portrait
  const wide = isWide(), pts = anchorsFor(shownKey);
  const el = wide ? document.querySelector(`#featureList .feat[data-key="${shownKey}"]`) : $("featureSheet")?.querySelector(".feat");
  if (!el || !pts.length || !el.offsetParent) { svg.innerHTML = ""; return; }
  const w = wrapEl().getBoundingClientRect(), r = el.getBoundingClientRect();
  let sx, sy;
  if (wide) { const lr = $("featureList").getBoundingClientRect(); sx = r.right - w.left; sy = Math.max(lr.top + 8, Math.min(lr.bottom - 8, r.top + r.height / 2)) - w.top; }
  else { sx = r.left + r.width / 2 - w.left; sy = r.top - w.top; }
  let out = "";
  for (const v of pts) { const [ax, ay] = toScreen(v); out += `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}"/><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="3.5"/>`; }
  svg.innerHTML = out;
}

// ---------------------------------------------------------------- download (top right): first a preview of what will be saved
// (for now, this voice's ID card), with the button that saves it as a picture
function wireIdCard() {
  const dlg = $("idDialog"), view = $("idView"), btn = $("idDownload");
  let made = false;
  $("downloadBtn").addEventListener("click", () => {
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
    // wait for the card's headings to finish settling (headings.js), so the picture has their final letters
    for (let i = 0; i < 60 && card.querySelector("[data-settling]"); i++) await new Promise((r) => setTimeout(r, 50));
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
