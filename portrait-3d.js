// portrait-3d.js — the Portrait page: one voice as a 3D portrait (built in voice-orb.js).
// It turns slowly on its own; drag (or swipe with two fingers on a trackpad) to turn it yourself,
// pinch / mouse wheel / + − to zoom, Fit to reset.
// Hover (or tap) a part to see what it shows. (People who ask their device for reduced motion
// get no automatic turning.)
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { getTake, archiveIsShared } from "./store.js";
import { currentTakeId } from "./nav.js?v=6";
import { download, slug, formatDate } from "./shared.js?v=2";
import { buildOrb } from "./voice-orb.js?v=31";
const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const $ = (id) => document.getElementById(id);
const VIEW_RADIUS = 1.4;   // how much of the scene "Fit" shows (the structures reach about 1.3 from the center)
const SPIN_SPEED = 0.6;    // slow turn (OrbitControls units; 2 = one turn every 30 s)
const CORE_STILL = false;   // true: the core keeps facing you while you turn the portrait (its top/bottom shading stays on screen either way)
const SPIN_RESUME_MS = 4000; // after someone turns it by hand, wait this long before turning again
const TIER_NAMES = { 1: "Seen first", 2: "Look closer", 3: "Details" };
let take, orbInfo, renderer, scene, camera, controls, byKey = {};

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
  $("dataLink").href = `breakdown.html?id=${encodeURIComponent(take.id)}`;
  setUpScene();
  buildList();
}
function empty(msg) { $("empty").hidden = false; if (msg) $("emptyText").textContent = msg; }

// ---------------------------------------------------------------- scene
function setUpScene() {
  const stage = $("stage");
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  stage.appendChild(renderer.domElement);
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

  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = 1.8;
  controls.maxDistance = 14;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  controls.autoRotate = !still;
  controls.autoRotateSpeed = SPIN_SPEED;
  let resume = null;
  controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(resume); });
  controls.addEventListener("end", () => { clearTimeout(resume); if (!still) resume = setTimeout(() => (controls.autoRotate = true), SPIN_RESUME_MS); });

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
  renderer.domElement.parentElement.addEventListener("wheel", (e) => {
    if (e.target !== renderer.domElement || !looksLikeTrackpad(e)) return;
    e.preventDefault(); e.stopPropagation();
    controls.autoRotate = false; clearTimeout(resume);
    if (!still) resume = setTimeout(() => (controls.autoRotate = true), SPIN_RESUME_MS);
    const k = (2 * Math.PI) / Math.max(300, renderer.domElement.clientHeight);
    const off = camera.position.clone().sub(controls.target);
    sph.setFromVector3(off);
    sph.theta += e.deltaX * k;
    sph.phi = Math.min(Math.PI - 0.05, Math.max(0.05, sph.phi + e.deltaY * k));
    camera.position.copy(controls.target).add(off.setFromSpherical(sph));
    controls.update();
  }, { capture: true, passive: false });
  const coreMesh = orbInfo.group.children.find((o) => o.isMesh && o.userData.part === "core");
  renderer.setAnimationLoop(() => {
    controls.update();
    if (CORE_STILL && coreMesh) coreMesh.quaternion.copy(camera.quaternion); // turn the core with the camera, so it looks still
    render();
  });

  new ResizeObserver(() => { resize(); }).observe(stage);
  resize();
  fit();
  wireZoomButtons();
  wireHover();
}

function resize() {
  const r = $("stage").getBoundingClientRect();
  if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  render();
}
function fitDistance() {
  const vFov = THREE.MathUtils.degToRad(camera.fov) / 2;
  const hFov = Math.atan(Math.tan(vFov) * camera.aspect);
  return VIEW_RADIUS / Math.sin(Math.min(vFov, hFov));
}
function fit() {
  const d = fitDistance();
  camera.position.set(0, d * 0.22, d).setLength(d);
  controls.target.set(0, 0, 0);
  controls.update();
  render();
}
function render() { renderer.render(scene, camera); }

function wireZoomButtons() {
  const dolly = (f) => {
    const off = camera.position.clone().sub(controls.target);
    off.setLength(Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length() * f)));
    camera.position.copy(controls.target).add(off);
    controls.update();
  };
  $("zoomIn").onclick = () => dolly(1 / 1.35);
  $("zoomOut").onclick = () => dolly(1.35);
  $("zoomFit").onclick = fit;
}

// ---------------------------------------------------------------- hover / tap
function wireHover() {
  const canvas = renderer.domElement, ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  ray.params.Points.threshold = 0.05;
  ray.params.Line.threshold = 0.025;
  const tip = $("tip");
  let hideTimer = null, queued = null;

  const pick = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    ptr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(orbInfo.group.children, true).find((h) => h.object.userData.part);
    if (!hit) return null;
    const part = hit.object.userData.part;
    return { keys: { core: ["core", "timbre", "vowels", "range"], accent: ["accent"] }[part] || [part] }; // the vowel spots live in the core's surface
  };
  const show = (p, x, y) => {
    if (!p) { tip.hidden = true; canvas.style.cursor = ""; return; }
    tip.innerHTML = p.keys.map((k) => byKey[k]).filter(Boolean)
      .map((item) => `<span class="tip-name">${esc(item.data)}: ${esc(item.value)}</span><span class="tip-visual">${esc(item.visual)}</span>`).join("");
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x + 14))}px`;
    tip.style.top = `${Math.max(8, y + 16 + h > window.innerHeight ? y - h - 12 : y + 16)}px`;
    canvas.style.cursor = "help";
  };
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || e.buttons) { tip.hidden = true; return; }
    queued = [e.clientX, e.clientY];
    requestAnimationFrame(() => { if (!queued) return; const [x, y] = queued; queued = null; show(pick(x, y), x, y); });
  });
  canvas.addEventListener("pointerleave", () => { tip.hidden = true; });
  let down = null;
  canvas.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; tip.hidden = true; });
  canvas.addEventListener("pointerup", (e) => { // a tap (not a drag) on touch screens
    if (e.pointerType === "mouse" || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return;
    show(pick(e.clientX, e.clientY), e.clientX, e.clientY);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (tip.hidden = true), 4000);
  });
}

// ---------------------------------------------------------------- side list (by importance)
function buildList() {
  const list = $("list");
  list.innerHTML = "";
  let tier = 0;
  for (const item of orbInfo.legend) {
    if (item.tier !== tier) {
      tier = item.tier;
      const h = document.createElement("li");
      h.className = "measure-tier";
      h.textContent = TIER_NAMES[tier];
      list.appendChild(h);
    }
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "measure";
    b.innerHTML = `<span class="m-name"></span><span class="m-value"></span>`;
    b.querySelector(".m-name").textContent = item.data;
    b.querySelector(".m-value").textContent = item.value;
    const sel = () => {
      document.querySelectorAll(".measure").forEach((x) => x.classList.toggle("active", x === b));
      $("rName").textContent = item.data;
      $("rValue").textContent = item.value;
      $("rDetail").textContent = TIER_NAMES[item.tier];
      $("rVisual").textContent = item.visual;
      $("rMeaning").textContent = "";
    };
    b.addEventListener("mouseenter", sel);
    b.addEventListener("focus", sel);
    b.addEventListener("click", sel);
    li.appendChild(b);
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------- downloads
$("pngBtn").addEventListener("click", () => {
  const size = 2400, prev = new THREE.Vector2();
  renderer.getSize(prev);
  const ratio = renderer.getPixelRatio(), aspect = camera.aspect;
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  camera.aspect = 1; camera.updateProjectionMatrix();
  render();
  renderer.domElement.toBlob((blob) => {
    download(blob, `${slug(take.name)}-voiceprint.png`);
    renderer.setPixelRatio(ratio);
    renderer.setSize(prev.x, prev.y, false);
    camera.aspect = aspect; camera.updateProjectionMatrix();
    render();
  }, "image/png");
});
$("glbBtn").addEventListener("click", async () => {
  const hidden = []; orbInfo.group.traverse((o) => { if (o.userData.screenOnly && o.visible) { o.visible = false; hidden.push(o); } }); // flat, screen-facing parts aren't part of the model
  const data = await new GLTFExporter().parseAsync(orbInfo.group, { binary: true });
  hidden.forEach((o) => (o.visible = true));
  download(new Blob([data], { type: "model/gltf-binary" }), `${slug(take.name)}-voiceprint.glb`);
});

load();
