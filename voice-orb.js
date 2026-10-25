// voice-orb.js — the 3D voice portrait: a glowing core wrapped in a crisp white structure.
//
// HIERARCHY (most distinguishing traits first):
//   SEEN FIRST   Accent → the white STRUCTURE around the core. Each accent family has its own kind
//                         (prisms, donut rings, petal cloud, wings, spiral coil) and each accent inside a
//                         family its own variation. Every accent is its own layer, as strong as its share.
//                Note + pitch → the COLOR of the glowing core (note = hue, average pitch = deep ↔ pale).
//   LOOK CLOSER  Pitch range → the core's top takes the shade of the highest pitch, its bottom the lowest.
//   LOOK CLOSER  Timbre → the core's surroundings, edge and shape (bright = a sun, dark = a swirl drawn inwards;
//                         breathy = a cloudy edge, clean = a crisp one; raspy = spiky, smooth = glossy).
// Everything is rebuilt from the stored measurements, so every archived voice follows these rules.
// All the dials are in MAP.
import * as THREE from "three";

export const MAP = {
  // NOTE + PITCH → the core's single COLOR.
  //   The NOTE (the musical note nearest the voice's typical pitch) picks the HUE: the 12 notes go
  //   round the color wheel, C = red, C♯ orange, D yellow … A violet, A♯ magenta, B pink — any octave.
  //   The PITCH itself (typical pitch, Hz) picks how DEEP or PALE that hue is: lower voices are richer
  //   and darker, higher voices lighter and softer. That depth scale is stretched to this archive:
  //   lowHz..highHz (140–260 Hz covers nearly everyone so far); below/above it stays at the ends.
  color: { lowHz: 140, highHz: 260, deep: { light: 0.3, sat: 1 }, pale: { light: 0.62, sat: 0.88 } },
  // PITCH RANGE → the core's top and bottom. The top is lighter by how far the voice climbs above its
  //   average (its highest pitch), the bottom darker by how far it drops (its lowest): perSemitone of
  //   lightness for every semitone, kept between minLight and maxLight. The average fills the middle;
  //   the top/bottom blend in from band[0] to band[1] of the way up/down the sphere.
  range: { perSemitone: 0.1, minLight: 0.12, maxLight: 0.74, band: [0.1, 0.65] },
  // the core: one smooth, softly glowing body that fades out toward its edges.
  // solid: how far in from the edge the glow becomes fully opaque (0 = hard edge, 1 = see-through all over).
  //   The structure behind the core fades out as much as the core is opaque there.
  core: { radius: 0.58, solid: 0.5 },
  // TIMBRE → the core's surroundings, edge and shape. Three measures, each compared with the archive (median and
  //   typical spread of the recordings with enough voice, Oct 2026), give three dials from −1 to 1:
  //   bright ↔ dark   (where the sound's energy sits: spectral centroid)   → sun rays round the core / a swirl curling into it
  //   breathy ↔ clean (how much air/noise is in the tone: spectral flatness, less steady tone) → a cloudy / crisp edge
  //   raspy ↔ smooth  (how much the pitch wobbles moment to moment: jitter, less steady tone)  → a spiky / glossy surface
  //   Recordings with fewer than minFrames voiced moments are left neutral (too little voice to read).
  timbre: {
    minFrames: 40,
    ref: { centroid: [7.0938, 0.1177], flatness: [-4.5469, 0.2427], clarity: [0.957, 0.0133], jitter: [0.3954, 0.2265] }, // [median, spread] (logs for centroid/flatness/jitter)
    span: 2,           // how many "spreads" from the median count as fully bright / breathy / raspy
    from: 0.15,        // a voice this close to the middle (on the −1…1 dials) gets no sun or swirl
    // sun: flat, straight-sided triangles in the core's colour, a gap away from the core (core units); spin: radians per second,
    //   clockwise on screen (never stops; off for reduced motion)
    sun: { rays: 12, gap: 0.07, len: [0.05, 0.15], width: [0.022, 0.04], spin: 0.1 },
    // swirl: arms of the core's colour curling in towards it, like water down a drain; they reach further out and thicken the darker
    //   the voice. spin: radians per second, anticlockwise on screen (the sun's opposite; never stops; off for reduced motion)
    swirl: { arms: 5, twist: 2.6, reach: [0.55, 0.9], spin: 0.15 },
    // edge: how far in from the outline the core fades (share of its radius) — cleanest, middle, breathiest.
    //   Breathy edges are also broken up by cloudy noise, and a soft mist drifts just outside them.
    edge: [0.03, 0.14, 0.42], noise: 0.35, mist: { reach: 1.32, strength: 0.75 },
    spikes: { height: 0.22, from: 0.15 }, // raspy → small pyramids rise from every face, the tips reaching the normal outline: height for the raspiest voice; smoother than `from` stays a plain sphere
  },
  // accent families → kinds of structure. Each of the 16 accents is drawn as its own layer (its family's
  // structure, in its own variation), as strong as its share; accents under minShare are left out.
  accent: {
    minShare: 0.06,
    families: {
      americas: { labels: ["us", "canada"], name: "Americas", structure: "a prism shell" },
      british: { labels: ["england", "scotland", "ireland", "wales"], name: "British Isles", structure: "scribbled donut rings" },
      asia: { labels: ["indian", "malaysia", "philippines", "hongkong", "singapore"], name: "Asia", structure: "a soft petal cloud" },
      oceania: { labels: ["australia", "newzealand"], name: "Oceania", structure: "two wings" },
      atlantic: { labels: ["african", "southatlandtic", "bermuda"], name: "Africa & South Atlantic", structure: "a spiral coil" },
    },
    // each accent's own variation of its family's structure
    variants: {
      us: "a geodesic shell", canada: "a spiky star with 20 points",
      england: "one ring", scotland: "two crossed rings", ireland: "one loose, tilted ring", wales: "three stacked rings",
      indian: "lens-shaped petals", malaysia: "big round puffs", philippines: "many small puffs", hongkong: "double-bumped petals", singapore: "swirling petals",
      australia: "wrapping the sides", newzealand: "wrapping the top and bottom",
      african: "thin and tight", southatlandtic: "thick and loose", bermuda: "two spirals winding together",
    },
  },
  lineColor: 0xf4f1ea,
};

// ---------------------------------------------------------------- helpers
const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const midiOf = (hz) => 69 + 12 * Math.log2(hz / 440);
export const noteOf = (hz) => { const m = Math.round(midiOf(hz)); return NOTES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); };
const median = (xs) => { const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
const pitchT = (hz) => Math.log2(hz / MAP.color.lowHz) / Math.log2(MAP.color.highHz / MAP.color.lowHz);
/** The voice's color: hue from its note, depth (dark ↔ pale) from its pitch. */
export function voiceColor(hz, note) {
  const C = MAP.color, t = Math.max(0, Math.min(1, pitchT(hz)));
  // use the stored note (the one the visitor sees) when there is one; else work it out from the pitch
  const named = NOTES.indexOf(String(note || "").replace("#", "♯").replace(/-?\d+$/, ""));
  const noteIndex = named >= 0 ? named : ((Math.round(midiOf(hz)) % 12) + 12) % 12;
  return new THREE.Color().setHSL(noteIndex / 12, C.deep.sat + (C.pale.sat - C.deep.sat) * t, C.deep.light + (C.pale.light - C.deep.light) * t);
}
function rng(seed) { let h = 2166136261; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
function dirs(n, rand) { const out = [], off = rand() * 6.28; for (let i = 0; i < n; i++) { const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), th = i * 2.39996 + off; out.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r)); } return out; }
let SOFT = null;
function softDot() {
  if (SOFT) return SOFT;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.45)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (SOFT = new THREE.CanvasTexture(c));
}

// ---------------------------------------------------------------- measurements → traits
export function traits(take) {
  const frames = take.frames || [], s = take.summary || {};
  const allVoiced = frames.filter((f) => f.pitch).map((f) => f.pitch);
  const pitch = s.pitchHz || median(allVoiced) || 160;
  const voiced = allVoiced.filter((p) => p > pitch * 0.62 && p < pitch * 1.7).sort((a, b) => a - b); // drop octave slips
  const q = (p) => (voiced.length ? voiced[Math.min(voiced.length - 1, Math.floor(voiced.length * p))] : pitch);
  // every one of the 16 accents is its own layer: its share of the voice's accent scores (accents under
  // minShare are left out, the rest add up to 1). The family picks the kind of structure, the accent its variation.
  const famOf = (label) => Object.keys(MAP.accent.families).find((k) => MAP.accent.families[k].labels.includes(label));
  let accents = (take.accent?.results || []).filter((r) => famOf(r.label) && r.score > 0).map((r) => ({ label: r.label, name: r.name || r.label, family: famOf(r.label), w: r.score }));
  let tot = accents.reduce((a, x) => a + x.w, 0);
  if (!tot) { accents = [{ label: "us", name: "United States", family: "americas", w: 1 }]; tot = 1; }
  accents = accents.map((x) => ({ ...x, w: x.w / tot })).filter((x) => x.w >= MAP.accent.minShare);
  tot = accents.reduce((a, x) => a + x.w, 0);
  accents = accents.map((x) => ({ ...x, w: x.w / tot })).sort((a, b) => b.w - a.w);
  const timbre = timbreOf(take, frames);
  return { pitch, note: s.note || noteOf(pitch), lo: q(0.08), hi: q(0.92), rangeSt: 12 * Math.log2(q(0.92) / q(0.08)), accents, timbre,
    accentTop: take.accent?.top || null, hasAccent: !!take.accent, rand: rng(take.id || take.name || "voice"), trand: rng((take.id || take.name || "voice") + "/timbre") };
}
// timbre: the three measures from the voiced moments, then the three dials (−1 … 1)
function timbreOf(take, frames) {
  const v = frames.filter((f) => f.active && f.pitch && f.centroidHz);
  // measures stored with the take (summary.timbre: e.g. set by hand for recordings with too little clear voice)
  // win over measuring the frames; a test page can also pass them in directly
  let m = take.timbreMeasures || take.summary?.timbre || null;
  if (!m && v.length) {
    const med = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
    const jit = []; for (let i = 1; i < v.length; i++) jit.push(Math.abs(v[i].pitch - v[i - 1].pitch) / v[i].pitch);
    m = { n: v.length, centroid: med(v.map((f) => f.centroidHz)), flatness: v.reduce((a, f) => a + (f.flatness || 0), 0) / v.length,
          clarity: v.reduce((a, f) => a + (f.clarity || 0), 0) / v.length, jitter: jit.length ? med(jit) * 100 : null };
  }
  const TM = MAP.timbre, out = { measures: m, enough: !!m && m.n >= TM.minFrames, bright: 0, breathy: 0, raspy: 0 };
  if (!out.enough) return out;
  const z = (x, [mid, sp]) => Math.max(-3, Math.min(3, (x - mid) / sp)), c = (x) => Math.max(-1, Math.min(1, x / TM.span));
  const zc = z(Math.log(m.centroid), TM.ref.centroid), zf = z(Math.log(Math.max(1e-4, m.flatness)), TM.ref.flatness), zq = z(m.clarity, TM.ref.clarity);
  const zj = m.jitter ? z(Math.log(m.jitter), TM.ref.jitter) : 0;
  return { ...out, bright: c(zc), breathy: c(zf - 0.3 * zq), raspy: c(zj - 0.4 * zq) };
}
// raspy → spiky: a sphere of 320 small faces with a short pyramid rising from each (like a sea urchin).
// Normals blend from round to flat as the spikes grow, so they catch the light like hard little points.
function spikyCore(R, amt) {
  const base = new THREE.IcosahedronGeometry(1, 2).toNonIndexed(), p = base.attributes.position, out = [], h = MAP.timbre.spikes.height * amt;
  for (let i = 0; i < p.count; i += 3) {
    const t = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, i + k).normalize().multiplyScalar(R));
    const apex = t[0].clone().add(t[1]).add(t[2]).normalize().multiplyScalar(R * (1 + h));
    for (let k = 0; k < 3; k++) { const A = t[k], B = t[(k + 1) % 3]; out.push(A.x, A.y, A.z, B.x, B.y, B.z, apex.x, apex.y, apex.z); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  const q = g.attributes.position, nrm = new Float32Array(q.count * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3(), flat = Math.min(1, amt * 2);
  for (let i = 0; i < q.count; i += 3) {
    a.fromBufferAttribute(q, i); b.fromBufferAttribute(q, i + 1); c.fromBufferAttribute(q, i + 2);
    f.subVectors(b, a).cross(c.clone().sub(a)).normalize(); if (f.dot(a) < 0) f.negate();
    for (const [k, v] of [[0, a], [1, b], [2, c]]) { const n = v.clone().normalize().lerp(f, flat).normalize(); nrm.set([n.x, n.y, n.z], (i + k) * 3); }
  }
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  return g;
}

// ---------------------------------------------------------------- the glowing core (pitch, melody, timbre)
// A softly glowing body drawn by a small shader: one color (note + pitch), lit a little more where it
// faces you, fading out toward its edges.
// vS: the direction from the core's centre as seen on screen, so the top/bottom shading stays put on screen
// however the core is turned (the shape itself turns with everything else).
const CORE_VERT = `uniform float coreRad; varying vec3 vP; varying vec3 vS; varying vec3 vN; varying vec3 vV; varying float vR;
void main(){ vP = normalize(position); vS = normalize(mat3(modelViewMatrix) * position); vR = length((mat3(modelViewMatrix) * position).xy) / coreRad; vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const CORE_FRAG = `uniform vec3 cMain; uniform vec3 cTop; uniform vec3 cBot; uniform vec2 band;
uniform float edgeW; uniform float cloud; uniform vec3 seed; uniform float gloss;
varying vec3 vP; varying vec3 vS; varying vec3 vN; varying vec3 vV; varying float vR;
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main(){
  float face = clamp(dot(vN, vV), 0., 1.);
  vec3 c = mix(cMain, cTop, smoothstep(band.x, band.y, vS.y));
  c = mix(c, cBot, smoothstep(band.x, band.y, -vS.y));
  c *= 0.78 + 0.32 * face;
  // breathy ↔ clean: a soft, cloudy edge or a crisp one
  float n = vnoise(vP * 3.2 + seed) * 0.6 + vnoise(vP * 7.0 + seed.yzx) * 0.4;
  // the edge: measured as distance from the outline on screen (so it works the same for round and spiky cores)
  float rr = vR + cloud * (n - 0.5) * ${MAP.timbre.noise.toFixed(3)};
  // smooth → a glossy surface reflecting a soft light above-left: a sheen strongest towards the rim (as real
  // reflections are), plus a small, gentle highlight where the light hits head-on
  if (gloss > 0.0) {
    vec3 Rf = reflect(-vV, vN);
    float fres = pow(1.0 - face, 2.2);
    float sky = smoothstep(0.25, 0.85, dot(Rf, normalize(vec3(-0.55, 0.8, 0.15))));
    vec3 Ls = normalize(vec3(-0.5, 0.62, 0.6)); float nh = max(dot(vN, normalize(Ls + vV)), 0.0);
    c += vec3(1.0) * (sky * (0.06 + 0.75 * fres) + pow(nh, 60.0) * 0.45) * gloss;
  }
  float a = 1.0 - smoothstep(1.0 - edgeW, 1.0, rr);
  gl_FragColor = vec4(c, a);
}`;
function core(T) {
  const C = MAP.core, TM = MAP.timbre, tb = T.timbre;
  const spiky = Math.max(0, tb.raspy), spikeH = spiky >= TM.spikes.from ? TM.spikes.height * spiky : 0;
  // every core has the same outline: spiky cores sit a little smaller so their tips reach it
  const geo = spikeH ? spikyCore(C.radius / (1 + spikeH), spiky) : new THREE.SphereGeometry(C.radius, 160, 120);
  const cMain = voiceColor(T.pitch, T.note), R = MAP.range;
  // the top/bottom: same hue, lighter or darker by how many semitones the highest/lowest pitch sits from the average
  const shift = (hz) => { const h = {}; cMain.getHSL(h); const st = 12 * Math.log2(hz / T.pitch); return new THREE.Color().setHSL(h.h, h.s, Math.max(R.minLight, Math.min(R.maxLight, h.l + R.perSemitone * st))); };
  const cTop = shift(T.hi), cBot = shift(T.lo);
  const mat = new THREE.ShaderMaterial({
    vertexShader: CORE_VERT, fragmentShader: CORE_FRAG, transparent: true, depthWrite: false,
    uniforms: { cMain: { value: cMain }, cTop: { value: cTop }, cBot: { value: cBot }, band: { value: new THREE.Vector2(...R.band) },

      gloss: { value: tb.raspy <= -TM.from ? Math.min(1, -tb.raspy * 1.1) : 0 },
      edgeW: { value: tb.breathy < 0 ? TM.edge[1] + (TM.edge[1] - TM.edge[0]) * tb.breathy : TM.edge[1] + (TM.edge[2] - TM.edge[1]) * tb.breathy }, coreRad: { value: C.radius },
      cloud: { value: Math.max(0, tb.breathy) },
      seed: { value: new THREE.Vector3(T.trand() * 50, T.trand() * 50, T.trand() * 50) } },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.part = "core";
  // The glow is drawn first; the structures are drawn over it and fade out behind it (see fadeBehindCore).
  mesh.renderOrder = -1;
  return { pts: mesh, color: cMain, size: C.radius, reach: C.radius };
}

// ---------------------------------------------------------------- the white structures (accent)
// Every structure is an outer layer around the core. The family sets the kind of structure; the
// voice's top accent inside that family picks one of the family's variations.
// Parts of a structure that sit behind the core fade out exactly as much as the core's glow covers them
// there: fully hidden behind its solid middle, gently showing through its soft rim. Each pixel checks
// whether the line of sight to it passes through the core (a sphere at the centre) before reaching it.
let CORE_R = null; // the core's size for the orb being built (breathy cores reach further out)
function fadeBehindCore(mat) {
  mat.userData.coreR = CORE_R;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.coreR = { value: mat.userData.coreR || MAP.core.radius };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWorldP;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
varying vec3 vWorldP; uniform float coreR;
float behindCore() {
  vec3 rd = vWorldP - cameraPosition; float dist = length(rd); rd /= dist;
  float b = dot(cameraPosition, rd), c = dot(cameraPosition, cameraPosition) - coreR * coreR, h = b * b - c;
  if (h <= 0.0) return 1.0;
  float t = -b - sqrt(h);
  if (t <= 0.0 || t >= dist) return 1.0;
  float face = clamp(dot(normalize(cameraPosition + rd * t), -rd), 0.0, 1.0);
  return 1.0 - smoothstep(0.0, ${MAP.core.solid.toFixed(3)}, face);
}`).replace("#include <opaque_fragment>", "#include <opaque_fragment>\ngl_FragColor.a *= behindCore();");
  };
  mat.customProgramCacheKey = () => "fadeBehindCore";
  return mat;
}
const lineMat = (o) => fadeBehindCore(new THREE.LineBasicMaterial({ color: MAP.lineColor, transparent: true, opacity: o, depthWrite: false }));
function segs(arr, o) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3)); const l = new THREE.LineSegments(g, lineMat(o)); l.userData.part = "accent"; return l; }
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const sph = (lat, lon, r) => V3(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon));
const D = Math.PI / 180;
function line(pts, out, q) { for (let i = 0; i < pts.length - 1; i++) { const a = q ? pts[i].clone().applyQuaternion(q) : pts[i], b = q ? pts[i + 1].clone().applyQuaternion(q) : pts[i + 1]; out.push(a.x, a.y, a.z, b.x, b.y, b.z); } }
const quat = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
const opa = (base, w) => base * (0.12 + 0.88 * w);

// prisms: a faceted, geometric shell
function prism(geo, r, q, out) {
  const e = new THREE.EdgesGeometry(geo, 1).attributes.position;
  for (let i = 0; i < e.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(e, i).multiplyScalar(r); if (q) v.applyQuaternion(q); out.push(v.x, v.y, v.z); }
}
// a donut: a ring of small scribbled loops (a coil wound tightly round a ring)
function donut(T, out, { R = 0.86, r = 0.1, turns = 70, q = null, y = 0, loose = 0.3 }) {
  for (let pass = 0; pass < 2; pass++) {
  const N = turns * 22, ph = [T.rand() * 6.28, T.rand() * 6.28, T.rand() * 6.28], pts = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2, a = turns * t + 1.4 * Math.sin(5 * t + ph[0]);
    const rr = r * (1 + loose * Math.sin(9 * t + ph[1]) + 0.5 * loose * Math.sin(23 * t + ph[2]));
    pts.push(V3((R + rr * Math.cos(a)) * Math.cos(t), y + rr * Math.sin(a), (R + rr * Math.cos(a)) * Math.sin(t)));
  }
  line(pts, out, q);
  }
}
// ---- petal cloud: the prism shell made soft. Every straight edge of a polyhedron becomes a puffed,
// petal-like curve that swells outward between the corners, so the outline turns into a lumpy cloud.
// The variation changes the shape of those petal edges.
function puffEdges(out, geo, { R0, puff, mode, q }) {
  const e = new THREE.EdgesGeometry(geo, 1).attributes.position;
  for (let i = 0; i < e.count; i += 2) {
    const a = new THREE.Vector3().fromBufferAttribute(e, i).normalize(), b = new THREE.Vector3().fromBufferAttribute(e, i + 1).normalize();
    if (q) { a.applyQuaternion(q); b.applyQuaternion(q); }
    const mid = a.clone().add(b).normalize(), side = new THREE.Vector3().crossVectors(b.clone().sub(a), mid).normalize(), len = a.distanceTo(b);
    const bows = mode === "lens" ? [0.22, -0.22] : mode === "twist" ? [null] : [0];
    for (const bow of bows) {
      const pts = [];
      for (let k = 0; k <= 40; k++) {
        const t = k / 40, s = Math.sin(Math.PI * t);
        let h = puff * s;                                                        // swell outward
        if (mode === "notch") h = puff * (s - 0.75 * Math.pow(Math.sin(Math.PI * t), 8) * 0.9) * 1.25; // dip in the middle: two bumps
        let sw = bow === null ? 0.18 * len * Math.sin(2 * Math.PI * t) : bow * len * s; // sideways bow (lens / S-twist)
        const p = a.clone().lerp(b, t).add(side.clone().multiplyScalar(sw)).normalize().multiplyScalar(R0 + h);
        pts.push(p);
      }
      line(pts, out);
    }
  }
}

// ---- wings: two wings wrapping the core, each made of three stacked teardrops (round head, tapering tail)
// that curve round the shell. The teardrops are filled, mostly opaque, with a crisp outline.
function teardrop(group, out, { lat0, lon0, len, th, dir, r, curve, q, op }) {
  const nu = 48, nv = 6, pos = [], idx = [];
  const P = (u, v) => { // u: head → tail, v: −1 … 1 across
    const h = th * Math.sqrt(Math.min(1, u / 0.16)) * Math.pow(1 - u, 1.1) * 1.25;
    const lat = lat0 - curve * u * u + v * h, lon = lon0 + dir * len * u;
    const p = sph(lat, lon, r + 0.03 * Math.sin(Math.PI * u) * (1 - v * v)); return q ? p.applyQuaternion(q) : p;
  };
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const p = P(i / nu, -1 + (2 * j) / nv); pos.push(p.x, p.y, p.z); }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, fadeBehindCore(new THREE.MeshBasicMaterial({ color: MAP.lineColor, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false })));
  m.renderOrder = 2; m.userData.part = "accent"; group.add(m);
  const top = [], bot = []; for (let i = 0; i <= nu; i++) { top.push(P(i / nu, 1)); bot.push(P(i / nu, -1)); }
  line(top.concat(bot.reverse()), out);
}
function wingCap(group, { q, w, flip = false }) {
  const out = [], op = 0.25 + 0.75 * w; // fill follows the accent's share: 100% → solid, 30% → about half
  // the second wing is the first turned half way round, so the two sweep in opposite directions
  const qq = flip ? (q ? q.clone().multiply(quat(0, Math.PI, 0)) : quat(0, Math.PI, 0)) : q;
  // three teardrops, stacked top to bottom, each a little longer than the one above
  [[38, 84], [14, 108], [-10, 128]].forEach(([lat, len], k) =>
    teardrop(group, out, { lat0: lat * D, lon0: 298 * D, len: len * D, th: 6.5 * D, dir: 1, r: 0.88 + 0.025 * k, curve: 20 * D, q: qq, op }));
  group.add(segs(out, opa(0.95, w)));
}

// ---- coil: one solid, weighted line wound round the sphere from pole to pole
class SphereSpiral extends THREE.Curve {
  constructor(turns, r, off = 0, span = 78) { super(); this.turns = turns; this.r = r; this.off = off; this.span = span; }
  getPoint(t, target = new THREE.Vector3()) { const lat = (-this.span + 2 * this.span * t) * D, lon = this.off + t * this.turns * Math.PI * 2; return target.copy(sph(lat, lon, this.r)); }
}
function tube(curve, radius, w) {
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 900, radius, 10, false), fadeBehindCore(new THREE.MeshBasicMaterial({ color: MAP.lineColor, transparent: true, opacity: opa(0.95, w) })));
  m.userData.part = "accent"; return m;
}

// a spiky star: a 20-sided shell with a sharp three-sided spike rising from every face
function spikyStar(out, q, rb = 0.72, ra = 1.2) {
  const p = new THREE.IcosahedronGeometry(1, 0).attributes.position;
  const seg = (a, b) => out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  for (let i = 0; i < p.count; i += 3) {
    const t = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, i + k).normalize().applyQuaternion(q));
    const apex = t[0].clone().add(t[1]).add(t[2]).normalize().multiplyScalar(ra);
    t.forEach((a, k) => { const A = a.clone().multiplyScalar(rb), B = t[(k + 1) % 3].clone().multiplyScalar(rb); seg(A, B); seg(A, apex); });
  }
}

// One builder per family; v = which accent inside the family (its variation).
const STRUCT = {
  americas(T, w, v) { // prisms
    const out = [];
    if (v === "canada") spikyStar(out, quat(0.4, 0.3, 0));
    else prism(new THREE.IcosahedronGeometry(1, 1), 0.95, quat(0.3, 0.2, 0.1), out);
    return segs(out, opa(0.85, w));
  },
  british(T, w, v) { // donut rings
    const out = [];
    if (v === "scotland") { donut(T, out, { q: quat(0.5, 0, 0.35), r: 0.08, turns: 60 }); donut(T, out, { q: quat(-0.5, 0, -0.35), r: 0.08, turns: 60 }); }
    else if (v === "ireland") donut(T, out, { q: quat(0.55, 0, 0.3), r: 0.15, turns: 45, loose: 0.45 });
    else if (v === "wales") { for (const y of [-0.42, 0, 0.42]) donut(T, out, { y, R: Math.sqrt(0.86 * 0.86 - y * y) + 0.02, r: 0.07, turns: 50 }); }
    else donut(T, out, { q: quat(0.22, 0, 0.12), r: 0.11, turns: 70 }); // england
    return segs(out, opa(0.65, w));
  },
  asia(T, w, v) { // a petal cloud; the petal edges change shape
    const out = [], q = quat(0.35, 0.5, 0.15);
    const P = {
      indian: [new THREE.IcosahedronGeometry(1, 0), { R0: 0.8, puff: 0.2, mode: "lens" }],         // every edge a petal
      malaysia: [new THREE.DodecahedronGeometry(1, 0), { R0: 0.82, puff: 0.22, mode: "puff" }],    // round pentagon puffs
      philippines: [new THREE.IcosahedronGeometry(1, 1), { R0: 0.84, puff: 0.12, mode: "puff" }],  // many small puffs
      hongkong: [new THREE.DodecahedronGeometry(1, 0), { R0: 0.82, puff: 0.24, mode: "notch" }],   // notched, double-bumped edges
      singapore: [new THREE.IcosahedronGeometry(1, 0), { R0: 0.8, puff: 0.2, mode: "twist" }],     // S-curved, swirling edges
    }[v] || [new THREE.DodecahedronGeometry(1, 0), { R0: 0.82, puff: 0.22, mode: "puff" }];
    puffEdges(out, P[0], { ...P[1], q });
    return segs(out, opa(0.85, w));
  },
  oceania(T, w, v) { // wings: two caps wrapping the core
    const g = new THREE.Group(), q = v === "newzealand" ? quat(0, 0, Math.PI / 2) : quat(0.25, 0, -0.55); // Australia: tilted about 30° on the diagonal
    wingCap(g, { q, w }); wingCap(g, { q, w, flip: true });
    return g;
  },
  atlantic(T, w, v) { // coils: one solid line spiralling round the sphere
    const g = new THREE.Group();
    if (v === "southatlandtic") g.add(tube(new SphereSpiral(3.2, 0.9), 0.03, w));
    else if (v === "bermuda") { g.add(tube(new SphereSpiral(2.5, 0.9, 0), 0.02, w)); g.add(tube(new SphereSpiral(2.5, 0.9, Math.PI), 0.02, w)); }
    else g.add(tube(new SphereSpiral(5.5, 0.88), 0.016, w)); // africa: a tight spiral
    return g;
  },
};

// ---------------------------------------------------------------- build
// bright → a sun: small, flat, straight-sided triangles in the core's own colour, set a little apart from the core
// and always facing the viewer. Long and short rays take turns; brighter voices get longer, wider rays.
// breathy → a soft, uneven mist in the core's colour just outside its outline (stronger the breathier the voice)
function breathMist(T, group, cMain) {
  const br = T.timbre.breathy, M = MAP.timbre.mist;
  if (!(br > 0.15)) return;
  const R = MAP.core.radius, ext = R * M.reach;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { col: { value: cMain.clone() }, amt: { value: M.strength * br }, R: { value: R }, ext: { value: ext }, seed: { value: new THREE.Vector2(T.trand() * 40, T.trand() * 40) } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 col; uniform float amt; uniform float R; uniform float ext; uniform vec2 seed; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        vec2 p = (vUv - 0.5) * 2.0 * ext; float r = length(p) / R;
        float n = vn(p * 4.0 + seed) * 0.55 + vn(p * 9.0 + seed.yx) * 0.3 + vn(p * 19.0 - seed) * 0.15;
        float wisp = smoothstep(${MAP.timbre.mist.reach.toFixed(3)}, 0.92, r + (n - 0.5) * 0.35);  // fades out unevenly past the outline
        float A = amt * wisp * (0.45 + 0.8 * n) * smoothstep(0.4, 0.85, r);   // also fills in behind the core's fading rim
        if (A <= 0.003) discard;
        gl_FragColor = vec4(col, min(A, 0.85));
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(ext * 2, ext * 2), mat), q = new THREE.Quaternion();
  m.onBeforeRender = (renderer, scene, camera) => { m.parent.getWorldQuaternion(q); m.quaternion.copy(q.invert().multiply(camera.quaternion)); m.updateMatrixWorld(); };
  m.renderOrder = -3; m.raycast = () => {}; m.userData.part = "core"; m.userData.screenOnly = true;
  group.add(m);
}
// dark → a swirl: five arms of the core's own colour curling in towards it, like water down a drain. The darker the
// voice, the further out and thicker they reach. Always faces the viewer and slowly turns anticlockwise (the sun's opposite).
function darkSwirl(T, group, cMain) {
  const d = -T.timbre.bright, W = MAP.timbre.swirl;
  if (!(d >= MAP.timbre.from)) return; // close to the middle: nothing
  const R = MAP.core.radius, ext = R * (1.05 + W.reach[1]);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { col: { value: cMain.clone() }, R: { value: R }, ext: { value: ext }, amt: { value: d }, turn: { value: T.trand() * 6.28 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 col; uniform float R; uniform float ext; uniform float amt; uniform float turn; varying vec2 vUv;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0 * ext; float r = length(p) / R; if (r < 1.0) discard;
        float a = atan(p.y, p.x) - turn;
        float s = sin(${W.arms.toFixed(1)} * (a + ${W.twist.toFixed(2)} * log(r)));          // logarithmic spiral arms
        float w = 0.55 - 0.25 * amt, band = smoothstep(w, w + 0.12, s);
        float fade = smoothstep(1.0 + ${W.reach[0].toFixed(2)} + ${(W.reach[1] - W.reach[0]).toFixed(2)} * amt, 1.02, r);
        float A = band * fade * (0.55 + 0.4 * amt); if (A < 0.004) discard;
        gl_FragColor = vec4(col, A);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(ext * 2, ext * 2), mat), q = new THREE.Quaternion(), t0 = mat.uniforms.turn.value;
  const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  m.onBeforeRender = (renderer, scene, camera) => {
    m.parent.getWorldQuaternion(q); m.quaternion.copy(q.invert().multiply(camera.quaternion)); m.updateMatrixWorld();
    if (!still) mat.uniforms.turn.value = t0 + W.spin * performance.now() / 1000;
  };
  m.renderOrder = -2; m.raycast = () => {}; m.userData.part = "core"; m.userData.screenOnly = true;
  group.add(m);
}
function sunRays(T, group, cMain, coreSize) {
  const b = T.timbre.bright, S = MAP.timbre.sun;
  if (!(b >= MAP.timbre.from)) return; // close to the middle: nothing
  const r0 = coreSize + S.gap, len = S.len[0] + (S.len[1] - S.len[0]) * b, half = r0 + len + 0.02;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { col: { value: cMain.clone() }, r0: { value: r0 }, len: { value: len }, wid: { value: S.width[0] + (S.width[1] - S.width[0]) * b },
      n: { value: S.rays }, off: { value: T.trand() }, ext: { value: half }, turn: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 col; uniform float r0; uniform float len; uniform float wid; uniform float n; uniform float off; uniform float ext; uniform float turn; varying vec2 vUv;
      void main(){
        vec2 q0 = (vUv - 0.5) * 2.0 * ext;                                 // in the same units as the core
        float cs = cos(turn), sn = sin(turn);
        vec2 p = vec2(cs * q0.x + sn * q0.y, -sn * q0.x + cs * q0.y);   // the whole sun turned by turn
        float a = atan(p.y, p.x) / 6.2831853;
        float k = floor(a * n + off + 0.5);                                 // the nearest ray
        float th = (k - off) / n * 6.2831853;
        vec2 d = vec2(cos(th), sin(th));
        float L = mod(k, 2.0) < 0.5 ? len : len * 0.6;                      // long and short rays take turns
        float along = dot(p, d) - r0, across = abs(p.x * d.y - p.y * d.x);
        float sd = min(min(along, L - along), wid * (1.0 - along / L) - across); // inside a straight-sided triangle when > 0
        float aa = fwidth(sd) + 1e-5;
        float A = smoothstep(-aa, aa, sd);
        if (A <= 0.001) discard;
        gl_FragColor = vec4(col, A * 0.95);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), mat), q = new THREE.Quaternion();
  const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  m.onBeforeRender = (renderer, scene, camera) => {
    m.parent.getWorldQuaternion(q); m.quaternion.copy(q.invert().multiply(camera.quaternion)); m.updateMatrixWorld();
    if (!still) mat.uniforms.turn.value = -S.spin * performance.now() / 1000; // slowly clockwise, whatever the viewer is doing
  };
  m.renderOrder = -2; m.raycast = () => {}; m.userData.part = "core"; m.userData.screenOnly = true; // (left out of the 3D model download)
  group.add(m);
}
export function buildOrb(take) {
  const T = traits(take), group = new THREE.Group();
  const { pts, color, size, reach } = core(T);
  group.add(pts);
  breathMist(T, group, color);
  sunRays(T, group, color, reach);
  darkSwirl(T, group, color);
  CORE_R = size;
  for (const a of T.accents) group.add(STRUCT[a.family](T, a.w, a.label));
  CORE_R = null;
  return { group, traits: T, legend: legendFor(T), coreColor: color };
}

// e.g. "Bright, slightly breathy" — the words for the three timbre dials (only the ones that stand out)
export function timbreWords(tb) {
  if (!tb?.enough) return "Not enough voice to read";
  const w = (v, pos, neg) => { const a = Math.abs(v); if (a < 0.2) return null; return (a >= 0.75 ? "very " : a >= 0.4 ? "" : "slightly ") + (v > 0 ? pos : neg); };
  const words = [[tb.bright, "bright", "dark"], [tb.breathy, "breathy", "clean"], [tb.raspy, "raspy", "smooth"]].sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).map(([v, p, n]) => w(v, p, n)).filter(Boolean);
  const t = words.length ? words.join(", ") : "balanced";
  return t[0].toUpperCase() + t.slice(1);
}
export function legendFor(T) {
  const mix = T.accents.map((a) => `${MAP.accent.families[a.family].structure}, ${MAP.accent.variants[a.label] || ""} (${a.name}, ${Math.round(a.w * 100)}%)`).join("; layered with ");
  return [
    { key: "accent", tier: 1, data: "Accent", value: T.accentTop ? T.accentTop.name : "Not measured",
      visual: T.hasAccent ? `The white structure: ${mix}. Each accent family has its own kind of structure, and each of the 16 accents its own variation; mixed accents layer theirs, smaller shares fainter.` : "No accent result, so the structure defaults to the prism shell." },
    { key: "core", tier: 1, data: "Note & pitch", value: `${T.note} · ${Math.round(T.pitch)} Hz`, visual: `The color of the glowing core. The note picks the hue (the 12 notes go round the color wheel, C = red); the pitch picks how deep or pale it is — lower voices richer, higher voices lighter (scale stretched to this archive, ${MAP.color.lowHz}–${MAP.color.highHz} Hz).` },
    { key: "timbre", tier: 1, data: "Timbre", value: timbreWords(T.timbre), visual: T.timbre.enough
        ? "The core's surroundings, edge and shape. Bright voices shine like a sun (rays in the core's colour); dark voices pull in a swirl of their own colour, like water down a drain. Breathy voices have a cloudy edge, clean ones a crisp edge. Raspy voices grow small spikes; smooth ones turn glossy, like polished glass. Each is as strong as it is in the voice, compared with the rest of the archive."
        : "There was too little clear voice in this recording to read its timbre, so the core is left plain." },
    { key: "range", tier: 2, data: "Pitch range", value: `${Math.round(T.lo)}–${Math.round(T.hi)} Hz`, visual: "The top and bottom of the core. The top is lighter the higher this voice climbs above its average; the bottom is darker the lower it drops. (The very highest and lowest moments are ignored, so one squeak or croak doesn't count.)" },
  ];
}
