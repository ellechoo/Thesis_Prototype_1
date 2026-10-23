// voice-orb.js — the 3D voice portrait: a glowing core wrapped in a crisp white structure.
//
// HIERARCHY (most distinguishing traits first):
//   SEEN FIRST   Accent → the white STRUCTURE around the core. Each accent family has its own kind
//                         (prisms, donut rings, petal cloud, wings, spiral coil) and each accent inside a
//                         family its own variation. Every accent is its own layer, as strong as its share.
//                Note + pitch → the COLOR of the glowing core (note = hue, average pitch = deep ↔ pale).
//   LOOK CLOSER  Pitch range → the core's top takes the shade of the highest pitch, its bottom the lowest.
//                Timbre → not used for now (coreAmount / structureAmount are 0), so every core is a plain sphere.
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
  // timbre: 12 numbers compared with a typical voice (measured from the archive's first recordings).
  // Where this voice is above typical, the form swells there; below, it dips.
  timbre: {
    coreAmount: 0, structureAmount: 0, // timbre off for now (was 0.3 / 0.22)
    softness: 1.3, minSpread: 4,
    typical: [55.1, 19.3, 13.8, 2.4, -4.4, -5.9, -8.4, -7.5, -5.6, -2.8, -0.1, 0.6],
    spread: [11.8, 17.3, 10.3, 8.9, 7.0, 3.6, 3.0, 2.1, 2.2, 3.9, 4.7, 4.4],
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
  const active = frames.filter((f) => f.active && f.mfcc);
  const TM = MAP.timbre;
  const mfcc = Array.from({ length: 12 }, (_, i) => (active.length ? active.reduce((a, f) => a + (f.mfcc[i + 1] ?? 0), 0) / active.length : TM.typical[i]));
  const z = mfcc.map((m, k) => Math.tanh((m - TM.typical[k]) / Math.max(TM.spread[k], TM.minSpread) / TM.softness));
  return { pitch, note: s.note || noteOf(pitch), lo: q(0.08), hi: q(0.92), rangeSt: 12 * Math.log2(q(0.92) / q(0.08)), accents, z,
    accentTop: take.accent?.top || null, hasAccent: !!take.accent, rand: rng(take.id || take.name || "voice") };
}
function timbreShape(T, amount) { const lobes = dirs(12, T.rand); return (v) => { let r = 1; for (let k = 0; k < 12; k++) r += amount * T.z[k] * Math.exp(-(1 - v.dot(lobes[k])) * 3); return Math.max(0.45, r); }; }

// ---------------------------------------------------------------- the glowing core (pitch, melody, timbre)
// A softly glowing body drawn by a small shader: one color (note + pitch), lit a little more where it
// faces you, fading out toward its edges.
const CORE_VERT = `varying vec3 vP; varying vec3 vN; varying vec3 vV;
void main(){ vP = normalize(position); vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const CORE_FRAG = `uniform vec3 cMain; uniform vec3 cTop; uniform vec3 cBot; uniform vec2 band; varying vec3 vP; varying vec3 vN; varying vec3 vV;
void main(){
  float face = clamp(dot(vN, vV), 0., 1.);
  vec3 c = mix(cMain, cTop, smoothstep(band.x, band.y, vP.y));
  c = mix(c, cBot, smoothstep(band.x, band.y, -vP.y));
  gl_FragColor = vec4(c * (0.78 + 0.32 * face), smoothstep(0.0, ${MAP.core.solid.toFixed(3)}, face));
}`;
function core(T) {
  const C = MAP.core, shape = timbreShape(T, MAP.timbre.coreAmount);
  const geo = new THREE.SphereGeometry(1, 128, 96), pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).normalize(); v.multiplyScalar(C.radius * shape(v)); pos.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals();
  const cMain = voiceColor(T.pitch, T.note), R = MAP.range;
  // the top/bottom: same hue, lighter or darker by how many semitones the highest/lowest pitch sits from the average
  const shift = (hz) => { const h = {}; cMain.getHSL(h); const st = 12 * Math.log2(hz / T.pitch); return new THREE.Color().setHSL(h.h, h.s, Math.max(R.minLight, Math.min(R.maxLight, h.l + R.perSemitone * st))); };
  const cTop = shift(T.hi), cBot = shift(T.lo);
  const mat = new THREE.ShaderMaterial({
    vertexShader: CORE_VERT, fragmentShader: CORE_FRAG, transparent: true, depthWrite: false,
    uniforms: { cMain: { value: cMain }, cTop: { value: cTop }, cBot: { value: cBot }, band: { value: new THREE.Vector2(...R.band) } },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.part = "core";
  // The glow is drawn first; the structures are drawn over it and fade out behind it (see fadeBehindCore).
  mesh.renderOrder = -1;
  return { pts: mesh, color: cMain };
}

// ---------------------------------------------------------------- the white structures (accent)
// Every structure is an outer layer around the core. The family sets the kind of structure; the
// voice's top accent inside that family picks one of the family's variations.
// Parts of a structure that sit behind the core fade out exactly as much as the core's glow covers them
// there: fully hidden behind its solid middle, gently showing through its soft rim. Each pixel checks
// whether the line of sight to it passes through the core (a sphere at the centre) before reaching it.
function fadeBehindCore(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.coreR = { value: MAP.core.radius };
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
export function buildOrb(take) {
  const T = traits(take), group = new THREE.Group();
  const { pts, color } = core(T);
  group.add(pts);
  for (const a of T.accents) group.add(STRUCT[a.family](T, a.w, a.label));
  return { group, traits: T, legend: legendFor(T), coreColor: color };
}

export function legendFor(T) {
  const mix = T.accents.map((a) => `${MAP.accent.families[a.family].structure}, ${MAP.accent.variants[a.label] || ""} (${a.name}, ${Math.round(a.w * 100)}%)`).join("; layered with ");
  return [
    { key: "accent", tier: 1, data: "Accent", value: T.accentTop ? T.accentTop.name : "Not measured",
      visual: T.hasAccent ? `The white structure: ${mix}. Each accent family has its own kind of structure, and each of the 16 accents its own variation; mixed accents layer theirs, smaller shares fainter.` : "No accent result, so the structure defaults to the prism shell." },
    { key: "core", tier: 1, data: "Note & pitch", value: `${T.note} · ${Math.round(T.pitch)} Hz`, visual: `The color of the glowing core. The note picks the hue (the 12 notes go round the color wheel, C = red); the pitch picks how deep or pale it is — lower voices richer, higher voices lighter (scale stretched to this archive, ${MAP.color.lowHz}–${MAP.color.highHz} Hz).` },
    { key: "range", tier: 2, data: "Pitch range", value: `${Math.round(T.lo)}–${Math.round(T.hi)} Hz`, visual: "The top and bottom of the core. The top is lighter the higher this voice climbs above its average; the bottom is darker the lower it drops. (The very highest and lowest moments are ignored, so one squeak or croak doesn't count.)" },
  ];
}
