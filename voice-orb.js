// voice-orb.js — the 3D voice portrait: a glowing core wrapped in a crisp structure, a very light tint of the core's color.
//
// HIERARCHY (most distinguishing traits first):
//   SEEN FIRST   Accent → the STRUCTURE around the core (a very light tint of the core's color). Each accent family has its own kind
//                         (prisms, donut rings, petal cloud, wings, spiral coil) and each accent inside a
//                         family its own variation. Every accent is its own layer, as strong as its share.
//                Note + pitch → the COLOR of the glowing core (note = hue, average pitch = deep ↔ pale).
//   LOOK CLOSER  Pitch range → the core's top takes the shade of the highest pitch, its bottom the lowest.
//   LOOK CLOSER  Timbre → the core's surroundings, edge and shape (bright = a sun, dark = a swirl drawn inwards;
//                         breathy = a cloudy edge, clean = a crisp one; raspy = spiky, smooth = glossy).
// MOTION: the core always turns the opposite way to the structure (see counterSpin).
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
    // raspy ↔ smooth: any lean away from the exact middle shows (only a voice within `from` of the middle stays plain).
    //   raspy → small pyramids rise from every face, the tips reaching the normal outline; height for the raspiest voice,
    //   and even a slight lean gets `min` of it. smooth → polished glass, its strength likewise starting at `min`.
    // height: for the raspiest voice, as a share of the base sphere (0.75: the dips between spikes sink to about 57% of the
    //   outline); curve > 1 keeps slight leans subtle and saves the drama for the raspiest voices.
    spikes: { height: 0.75, curve: 1.8, from: 0.02, min: 0.18 },
    glass: { from: 0.02, min: 0.3 },
  },
  // VOWELS → soft glowing spots in the core's own surface (painted into it, so on a spiky core they ride up
  //   and down the spikes with it). Two colors, the core's neighbours on the color wheel (`hue` of a turn either
  //   side): front vowels (“ee”, high F2) in one, back vowels (“oo”, low F2) in the other. Every vowel moment (F1/F2, the same points
  //   as the vowel chart) is one spot. The chart is wrapped all the way round the sphere: F2 (front ↔ back of
  //   the mouth) goes round it, F1 (closed ↔ open) runs top to bottom. Each voice is stretched to its own
  //   range (its 2nd–98th percentile, log scale) so its vowels use every side of the core; front and back
  //   vowels meet at the back. The spots lie flat on the surface and overlap, so places where vowels crowd
  //   together are solidly colored. At most `max` spots (evenly sampled); spot: each spot's size (radians).
//   tilt: the whole map is tipped toward the viewer by this many degrees (the same for everyone), so the open
//   vowels near the bottom face the camera at the start instead of hiding underneath.
  vowels: { max: 260, spot: 0.26, opacity: 0.42, lat: 80, tilt: 40, hue: 30 / 360, f1: [200, 1100], f2: [600, 3200] },
  // accent families → kinds of structure. Each of the 16 accents is drawn as its own layer (its family's
  // structure, in its own variation), as strong as its share; accents under minShare are left out.
  accent: {
    minShare: 0.06,
    // mixed accents: every layer is drawn more solidly than its share alone would give. The strongest accent is fully
    //   solid and the others keep their order, but none is fainter than `mixLift` (0–1) of the way up.
    mixLift: 0.25,
    families: {
      americas: { labels: ["us", "canada"], name: "Americas", structure: "a prism shell" },
      british: { labels: ["england", "scotland", "ireland", "wales"], name: "British Isles", structure: "a ring round the middle, drawn in fine lines" },
      asia: { labels: ["indian", "malaysia", "philippines", "hongkong", "singapore"], name: "Asia", structure: "a soft petal cloud" },
      oceania: { labels: ["australia", "newzealand"], name: "Oceania", structure: "two wings" },
      atlantic: { labels: ["african", "southatlandtic", "bermuda"], name: "Africa & South Atlantic", structure: "a spiral coil" },
    },
    // each accent's own variation of its family's structure
    variants: {
      us: "a geodesic shell", canada: "a spiky star with 20 points",
      england: "a double helix of two twisting strands", scotland: "a bold scribbled coil", ireland: "a Celtic braid of three strands", wales: "a flat band twisting over itself",
      indian: "lens-shaped petals", malaysia: "big round puffs", philippines: "many small puffs", hongkong: "double-bumped petals", singapore: "swirling petals",
      australia: "teardrop wings wrapping the sides", newzealand: "fern-frond wings with curled tips",
      african: "thin and tight", southatlandtic: "thick and loose", bermuda: "two spirals winding together",
    },
  },
  lineColor: 0xf4f1ea,
  // the structure's color: a very light tint of the core's own hue (its note), at this saturation and lightness for
  // every voice, so it reads as nearly white with a hint of the core's color, whatever the core's depth
  shell: { sat: 0.85, light: 0.84 },
  // TALKING & PAUSES → beads on the strongest accent's structure. The reading's timeline (first word to last) wraps once
  // around the vertical axis; at every pause longer than minSeconds, one flat, soft-edged bead in the voice's colour sits on
  // a line of that structure at that angle (like a bead threaded on string). Where several lines pass that angle (a coil
  // wraps round more than once), the bead goes on the one nearest a height that moves from the top of the structure at the
  // first word to the bottom at the last, so the beads also read in order. Longer pauses give bigger beads.
  // Each bead is a small, plump four-pointed spark. The fewer pauses a reading has, the more its sparks glow (a soft halo
  // round each): at fewFor pauses or fewer, the full glow; at manyFor or more, plain sparks. The raspier the voice, the
  // longer and skinnier the spark's limbs; only the smoothest voices get rounded tips and corners (the same raspy ↔ smooth
  // dial as the core).
  // An exact tie for the strongest accent puts beads on every tied structure.
  pauses: { minSeconds: 0.2, size: 0.017, perSecond: 0.04, maxSize: 0.042, spark: 2.1, fewFor: 2, manyFor: 10, tie: 0.005 },
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
  const vowels = vowelsOf(frames);
  return { vowels, pitch, note: s.note || noteOf(pitch), lo: q(0.08), hi: q(0.92), rangeSt: 12 * Math.log2(q(0.92) / q(0.08)), accents, timbre,
    accentTop: take.accent?.top || null, hasAccent: !!take.accent, rand: rng(take.id || take.name || "voice"), trand: rng((take.id || take.name || "voice") + "/timbre"), grand: rng((take.id || take.name || "voice") + "/glass") };
}
// vowel space: the frames that land on the vowel chart, evenly sampled, with this voice's own range (log Hz)
function vowelsOf(frames) {
  const V = MAP.vowels, all = frames.filter((f) => f.f1 && f.f2 && f.f1 >= V.f1[0] && f.f1 <= V.f1[1] && f.f2 >= V.f2[0] && f.f2 <= V.f2[1]);
  if (all.length < 8) return { n: all.length, pts: [] };
  const step = Math.max(1, all.length / V.max), pts = [];
  for (let i = 0; i < all.length && pts.length < V.max; i += step) { const f = all[Math.floor(i)]; pts.push([Math.log(f.f1), Math.log(f.f2)]); }
  const span = (k) => { const xs = pts.map((p) => p[k]).sort((a, b) => a - b), lo = xs[Math.floor(0.02 * xs.length)], hi = xs[Math.min(xs.length - 1, Math.floor(0.98 * xs.length))]; return [lo, Math.max(hi, lo + 1e-3)]; };
  return { n: all.length, pts, f1: span(0), f2: span(1) };
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
function spikyCore(R, amt, h) {
  const base = new THREE.IcosahedronGeometry(1, 2).toNonIndexed(), p = base.attributes.position, out = [];
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
uniform float edgeW; uniform float cloud; uniform vec3 seed; uniform float gloss; uniform vec4 gw1; uniform vec4 gw2; uniform vec3 gShape;
uniform sampler2D vMap; uniform float vOn; uniform vec3 vFront; uniform vec3 vBack; uniform mat3 vTilt;
varying vec3 vP; varying vec3 vS; varying vec3 vN; varying vec3 vV; varying float vR;
float glassSpot(vec2 p, vec4 w, float rot){ vec2 d = p - w.xy; float cs = cos(rot), sn = sin(rot); d = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
  return 1.0 - smoothstep(-0.014, 0.014, (length(d / w.zw) - 1.0) * min(w.z, w.w)); } // a tilted oval with a crisp, slightly soft edge
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main(){
  float face = clamp(dot(vN, vV), 0., 1.);
  vec3 c = mix(cMain, cTop, smoothstep(band.x, band.y, vS.y));
  c = mix(c, cBot, smoothstep(band.x, band.y, -vS.y));
  c *= 0.78 + 0.32 * face;
  // vowel space: glowing spots in the surface, looked up by this point's direction from the centre
  if (vOn > 0.0) { vec3 d = normalize(vTilt * vP);
    vec2 uv = vec2(fract(atan(d.z, d.x) / 6.2831853 + 1.0), 0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.1415927); // (the map is stored flipped: north at the top)
    vec4 tx = texture2D(vMap, uv); float wt = tx.r + tx.g;
    if (wt > 0.0) c = mix(c, (vFront * tx.r + vBack * tx.g) / wt * (0.8 + 0.35 * face), 1.0 - exp(-wt * 1.6)); } // blended in (not added), so the spots keep their own color
  // breathy ↔ clean: a soft, cloudy edge or a crisp one
  float n = vnoise(vP * 3.2 + seed) * 0.6 + vnoise(vP * 7.0 + seed.yzx) * 0.4;
  // the edge: measured as distance from the outline on screen (so it works the same for round and spiky cores)
  float rr = vR + cloud * (n - 0.5) * ${MAP.timbre.noise.toFixed(3)};
  // smooth → polished glass: a glossy surface reflecting a soft light above-left (a sheen strongest towards the rim,
  // as real reflections are), a crisp oval highlight upper-left, a small round glint lower-right, and a bright rim.
  // The highlights are placed on screen (vS), so they stay put like real reflections while the core turns. Each
  // voice's differ a little (place, size, shape, tilt; see glassLook), always lit from the upper left.
  if (gloss > 0.0) {
    vec3 Rf = reflect(-vV, vN);
    float fres = pow(1.0 - face, 2.2);
    float sky = smoothstep(0.25, 0.85, dot(Rf, normalize(vec3(-0.55, 0.8, 0.15))));
    vec3 Ls = normalize(vec3(-0.5, 0.62, 0.6)); float nh = max(dot(vN, normalize(Ls + vV)), 0.0);
    c += vec3(1.0) * (sky * (0.06 + 0.75 * fres) + pow(nh, 60.0) * 0.45) * gloss;
    float w1 = glassSpot(vS.xy, gw1, gShape.x), w2 = glassSpot(vS.xy, gw2, gShape.y);
    c = mix(c, vec3(1.0), clamp((w1 * 0.92 + w2 * 0.45) * step(0.0, vS.z), 0.0, 1.0) * gloss);
    c += vec3(1.0) * pow(1.0 - face, 3.0) * 0.9 * gloss;
  }
  float a = 1.0 - smoothstep(1.0 - edgeW, 1.0, rr);
  gl_FragColor = vec4(c, a);
}`;
// smooth voices' glass highlights, a little different for every voice: where each sits (a larger oval upper left,
// a small, rounder glint lower right), how big and how stretched it is, and its tilt. Returns gw1, gw2 and gShape.
function glassLook(rnd) {
  const u = (a, b) => a + (b - a) * rnd();
  const s1 = u(0.8, 1.25), a1 = u(1.3, 2.4), s2 = u(0.7, 1.35), a2 = u(1.0, 1.6);
  const w1 = new THREE.Vector4(u(-0.44, -0.27), u(0.33, 0.5), 0.12 * s1 * Math.sqrt(a1), 0.12 * s1 / Math.sqrt(a1));
  const w2 = new THREE.Vector4(u(0.28, 0.44), u(-0.48, -0.32), 0.04 * s2 * Math.sqrt(a2), 0.04 * s2 / Math.sqrt(a2));
  return { w1, w2, shape: new THREE.Vector3(u(-0.75, 0.15), u(-0.5, 0.5), 0) }; // the main oval leans along the sphere's curve
}
function core(T) {
  const C = MAP.core, TM = MAP.timbre, tb = T.timbre;
  const SP = TM.spikes, GL = TM.glass;
  const spiky = tb.raspy >= SP.from ? SP.min + (1 - SP.min) * Math.min(1, tb.raspy) : 0, spikeH = spiky ? SP.height * Math.pow(spiky, SP.curve) : 0; // (a slight lean: small spikes; the raspiest: long, deep ones)
  // every core has the same outline: spiky cores sit a little smaller so their tips reach it
  const geo = spikeH ? spikyCore(C.radius / (1 + spikeH), spiky, spikeH) : new THREE.SphereGeometry(C.radius, 160, 120);
  const cMain = voiceColor(T.pitch, T.note), R = MAP.range;
  // the top/bottom: same hue, lighter or darker by how many semitones the highest/lowest pitch sits from the average
  const shift = (hz) => { const h = {}; cMain.getHSL(h); const st = 12 * Math.log2(hz / T.pitch); return new THREE.Color().setHSL(h.h, h.s, Math.max(R.minLight, Math.min(R.maxLight, h.l + R.perSemitone * st))); };
  const cTop = shift(T.hi), cBot = shift(T.lo);
  const vMap = vowelMap(T), hsl = {}; cMain.getHSL(hsl);
  const nb = (dh) => new THREE.Color().setHSL((hsl.h + dh + 1) % 1, Math.max(0.8, hsl.s), 0.5); // the core's neighbours on the color wheel
  const vFront = nb(MAP.vowels.hue), vBack = nb(-MAP.vowels.hue);
  const tilt = MAP.vowels.tilt * D, vTilt = new THREE.Matrix3().set(1, 0, 0, 0, Math.cos(tilt), -Math.sin(tilt), 0, Math.sin(tilt), Math.cos(tilt)); // undoes the map's tilt toward the viewer
  const G = glassLook(T.grand);
  const mat = new THREE.ShaderMaterial({
    vertexShader: CORE_VERT, fragmentShader: CORE_FRAG, transparent: true, depthWrite: false,
    uniforms: { cMain: { value: cMain }, cTop: { value: cTop }, cBot: { value: cBot }, band: { value: new THREE.Vector2(...R.band) },

      gloss: { value: tb.raspy <= -GL.from ? GL.min + (1 - GL.min) * Math.min(1, -tb.raspy * 1.1) : 0 }, gw1: { value: G.w1 }, gw2: { value: G.w2 }, gShape: { value: G.shape },
      edgeW: { value: tb.breathy < 0 ? TM.edge[1] + (TM.edge[1] - TM.edge[0]) * tb.breathy : TM.edge[1] + (TM.edge[2] - TM.edge[1]) * tb.breathy }, coreRad: { value: C.radius },
      cloud: { value: Math.max(0, tb.breathy) },
      vMap: { value: vMap }, vOn: { value: vMap ? 1 : 0 }, vFront: { value: vFront }, vBack: { value: vBack }, vTilt: { value: vTilt },
      seed: { value: new THREE.Vector3(T.trand() * 50, T.trand() * 50, T.trand() * 50) } },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.part = "core";
  counterSpin(mesh);
  // The glow is drawn first; the structures are drawn over it and fade out behind it (see fadeBehindCore).
  mesh.renderOrder = -1;
  return { pts: mesh, color: cMain, size: C.radius, reach: C.radius };
}

// The core turns the opposite way to the structure, at the same speed. However the portrait is being turned (the page
// spinning it, the viewer dragging it, the camera orbiting), the structure appears turned by the camera's angle round
// the portrait's upright axis; the core is turned by twice that angle the other way, so it appears to turn by the same
// amount in reverse. (Seen from almost straight above or below, that angle is unreliable, so the core holds still there.)
// Its glass highlights and top/bottom shading are placed on screen, so they stay put either way.
function counterSpin(mesh) {
  const cam = new THREE.Vector3(), inv = new THREE.Matrix4();
  let last = 0;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    if (!mesh.parent) return;
    cam.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inv.copy(mesh.parent.matrixWorld).invert()); // the camera, in the portrait's own frame
    if (Math.hypot(cam.x, cam.z) > 0.15 * cam.length()) last = 2 * Math.atan2(cam.x, cam.z);
    mesh.rotation.y = last;
    mesh.updateMatrixWorld();
  };
}

// ---------------------------------------------------------------- vowel space (spots in the core's surface)
// The spots are drawn into a small world map (longitude across, latitude down) that the core's shader reads
// by direction, so every point of the surface — smooth or spiky — shows whatever spot lies in its direction.
// Spots are widened toward the poles to stay round on the sphere, and wrap round the back seam. Each spot is
// feathered: a long, gentle fade at its edge, and the color builds up gradually where spots overlap.
// Front vowels go in the map's red channel and back vowels in its green one, so the shader can color them apart.
function vowelMap(T) {
  const V = MAP.vowels, vw = T.vowels;
  if (!vw.pts.length) return null;
  const W = 1024, H = 512, c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"); x.fillStyle = "#000"; x.fillRect(0, 0, W, H); x.globalCompositeOperation = "lighter";
  const at = (v, [lo, hi]) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const ry = (V.spot / Math.PI) * H;
  for (const [l1, l2] of vw.pts) {
    const lat = (0.5 - at(l1, vw.f1)) * 2 * V.lat * D, lon = (90 + (at(l2, vw.f2) - 0.5) * 360) * D; // 90° = facing the viewer at the start
    const front = at(l2, vw.f2) > 0.5; // front vowel (“ee” side of this voice's range) or back vowel (“oo” side)
    const u = (((lon / (2 * Math.PI)) % 1) + 1) % 1, cy = (0.5 - lat / Math.PI) * H, rx = (V.spot / (2 * Math.PI)) * W / Math.max(0.15, Math.cos(lat));
    for (const off of [-W, 0, W]) {
      const cx = u * W + off; if (cx + rx < 0 || cx - rx > W) continue;
      x.save(); x.translate(cx, cy); x.scale(rx / ry, 1);
      const g = x.createRadialGradient(0, 0, 0, 0, 0, ry);
      for (let i = 0; i <= 24; i++) { const t = i / 24; g.addColorStop(t, `rgba(${front ? 255 : 0},${front ? 0 : 255},0,${V.opacity * Math.exp(-2.6 * t * t) * Math.pow(1 - t * t, 1.5)})`); }
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, ry, 0, Math.PI * 2); x.fill(); x.restore();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  return tex;
}

// ---------------------------------------------------------------- the structures (accent), drawn white here and tinted in buildOrb
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

// ---- drawn tubes: a tube drawn as white lines running along its length (like an engraving), with small
// cross-section rings every `rings` steps, like a wireframe sketch. Each line is lighter on the side facing the
// light (upper left) and only slightly dimmer on the shadow side (so it stays white), so the form still reads as round and 3D while looking drawn,
// like the other line structures. `taper`: the share of the length over which each end narrows to a point.
const LIGHT = new THREE.Vector3(-0.5, 0.75, 0.45).normalize();
function lineTube(curve, radius, w, { closed = false, seg = 700, n = 7, taper = 0, rings = 6, op = 0.95 } = {}) {
  const fr = curve.computeFrenetFrames(seg, closed), pos = [], col = [], P = [], R = [];
  for (let i = 0; i <= seg; i++) { const u = i / seg, e = taper ? Math.min(1, Math.min(u, 1 - u) / taper) : 1; P.push(curve.getPointAt(u)); R.push(radius * (taper ? 1 - (1 - e) * (1 - e) : 1)); }
  const at = (i, th) => { const N = fr.normals[i % (seg + (closed ? 0 : 1))] || fr.normals[0], B = fr.binormals[i % (seg + (closed ? 0 : 1))] || fr.binormals[0];
    const d = N.clone().multiplyScalar(Math.cos(th)).add(B.clone().multiplyScalar(Math.sin(th))); return [P[i].clone().add(d.clone().multiplyScalar(R[i])), 0.72 + 0.28 * Math.max(0, d.dot(LIGHT))]; };
  const seg2 = (a, b) => { pos.push(a[0].x, a[0].y, a[0].z, b[0].x, b[0].y, b[0].z); col.push(a[1], a[1], a[1], b[1], b[1], b[1]); };
  const lines = radius < 0.012 ? 1 : n; // very thin tubes (England's coil) are drawn as a single line
  for (let k = 0; k < lines; k++) { const th = (k / lines) * Math.PI * 2; for (let i = 0; i < seg; i++) seg2(at(i, th), at(i + 1, th)); }
  if (rings && lines > 1) for (let i = 0; i <= seg; i += rings) for (let k = 0; k < 14; k++) seg2(at(i, (k / 14) * Math.PI * 2), at(i, ((k + 1) / 14) * Math.PI * 2));
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const m = fadeBehindCore(new THREE.LineBasicMaterial({ color: MAP.lineColor, vertexColors: true, transparent: true, opacity: opa(1, w), depthWrite: false }));
  const l = new THREE.LineSegments(g, m); l.userData.part = "accent"; return l;
}
// ---- rings (British Isles): one ring round the middle, drawn in engraved lines, each accent built differently.
// Every ring lies near the horizontal, with its own slight tilt and size so mixed accents layer cleanly.
// Finish: core-lit chrome. The shading is baked into a small "matcap" picture of a polished chrome ball
// (bright sky, a dark horizon band, a pale floor, one sharp highlight), so the rings look like metal whether
// or not the scene has lights (the Archive and ID-card pictures are drawn without any). On top of that, the
// side of each ring that faces the core reflects the core's color, so the ring looks lit by the voice itself.
// Wales is the exception: a soft, matte white (no reflections, no core color), like porcelain.
let RING_SHADE = null, RING_MATTE = null, CORE_COL = null; // CORE_COL: the core's color for the orb being built (set in buildOrb)
function ringMatte() {
  if (RING_MATTE) return RING_MATTE;
  const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d");
  const g = x.createRadialGradient(110, 100, 20, 128, 128, 128);
  [[0, "#f7f4ee"], [0.6, "#ece8e0"], [0.9, "#d6d1c7"], [1, "#c6c0b5"]].forEach(([o, col]) => g.addColorStop(o, col));
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  RING_MATTE = new THREE.CanvasTexture(c); RING_MATTE.colorSpace = THREE.SRGBColorSpace;
  return RING_MATTE;
}
function ringShade() {
  if (RING_SHADE) return RING_SHADE;
  const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d");
  const band = x.createLinearGradient(0, 0, 0, 256);
  [[0, "#ffffff"], [0.3, "#dfe3e8"], [0.47, "#a9b0b8"], [0.5, "#2f3338"], [0.56, "#5b6168"], [0.75, "#b7bcc2"], [1, "#f2f3f4"]].forEach(([o, col]) => band.addColorStop(o, col));
  x.fillStyle = band; x.fillRect(0, 0, 256, 256);
  const hi = x.createRadialGradient(84, 70, 0, 128, 128, 128);
  hi.addColorStop(0, "rgba(255,255,255,0.95)"); hi.addColorStop(0.18, "rgba(255,255,255,0)"); hi.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = hi; x.fillRect(0, 0, 256, 256);
  RING_SHADE = new THREE.CanvasTexture(c); RING_SHADE.colorSpace = THREE.SRGBColorSpace;
  return RING_SHADE;
}
function ringMat(w, matte = false) {
  const m = fadeBehindCore(new THREE.MeshMatcapMaterial({ matcap: matte ? ringMatte() : ringShade(), transparent: true, opacity: opa(0.95, w), side: THREE.DoubleSide }));
  if (matte || !CORE_COL) return m;
  const fade = m.onBeforeCompile, col = CORE_COL.clone();
  m.onBeforeCompile = (sh, r) => {
    fade(sh, r);
    sh.uniforms.coreCol = { value: col };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWN;")
      .replace("#include <defaultnormal_vertex>", "#include <defaultnormal_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);");
    // inward: how squarely this bit of ring faces the core; near: stronger close to it
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWN; uniform vec3 coreCol;")
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>
{ vec3 n = normalize(vWN); if (!gl_FrontFacing) n = -n;
  float inward = clamp(dot(n, -normalize(vWorldP)), 0.0, 1.0), near = 1.0 - smoothstep(0.75, 1.15, length(vWorldP));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * coreCol * 1.5 + coreCol * 0.25, pow(inward, 1.3) * (0.55 + 0.35 * near)); }`);
  };
  m.customProgramCacheKey = () => "ringCoreLitChrome";
  return m;
}
const ringMesh = (geo, w, matte = false) => { const m = new THREE.Mesh(geo, ringMat(w, matte)); m.userData.part = "accent"; return m; };
const ringTube = (pts, radius, w, seg) => lineTube(new THREE.CatmullRomCurve3(pts, true), radius, w, { closed: true, seg: Math.min(seg, 1400) });
// a point on the ring (radius R) at angle t, pushed out by `rad` (away from the centre) and `up`
const ringAt = (t, R, rad = 0, up = 0) => V3((R + rad) * Math.cos(t), up, (R + rad) * Math.sin(t));
function ringGroup(q) { const g = new THREE.Group(); g.quaternion.copy(q); return g; }
const RINGS = {
  // Scotland: the scribbled donut, as one bold coil looping round the ring (two passes); the same for every voice
  scotland(w) {
    // (England and Scotland swapped designs; each kept its own tilt and size)
    const g = ringGroup(quat(0.22, 0, 0.12)), R = 0.86, rand = rng("scotland ring");
    for (let pass = 0; pass < 2; pass++) {
      const turns = 58, N = turns * 24, ph = [rand() * 6.28, rand() * 6.28, rand() * 6.28], pts = [];
      for (let i = 0; i < N; i++) {
        const t = (i / N) * Math.PI * 2, a = turns * t + 1.2 * Math.sin(5 * t + ph[0]) + pass * 1.7;
        const r = 0.1 * (1 + 0.16 * Math.sin(9 * t + ph[1]) + 0.08 * Math.sin(23 * t + ph[2]));
        pts.push(ringAt(t, R, r * Math.cos(a), r * Math.sin(a)));
      }
      g.add(ringTube(pts, 0.0055, w, N * 2, 6));
    }
    return g;
  },
  // England: a double helix, two strands twisting round each other, joined by thin rungs
  england(w) {
    const g = ringGroup(quat(0.3, 0, -0.16)), R = 0.9, A = [], B = [], N = 600;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2, a = 14 * t, c = 0.08 * Math.cos(a), s = 0.08 * Math.sin(a);
      A.push(ringAt(t, R, c, s)); B.push(ringAt(t, R, -c, -s));
    }
    g.add(ringTube(A, 0.016, w, 1200)); g.add(ringTube(B, 0.016, w, 1200));
    const rungs = [];
    for (let i = 0; i < N; i += 15) {
      rungs.push(A[i].x, A[i].y, A[i].z, B[i].x, B[i].y, B[i].z); // each rung: one straight line between the strands
    }
    { const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.Float32BufferAttribute(rungs, 3)); const rl = new THREE.LineSegments(rg, lineMat(opa(0.95, w))); rl.userData.part = "accent"; g.add(rl); }
    return g;
  },
  // Ireland: a Celtic braid, three strands plaited round the ring
  ireland(w) {
    const g = ringGroup(quat(0.16, 0, 0.26)), R = 0.83;
    for (let k = 0; k < 3; k++) {
      const pts = [];
      for (let i = 0; i < 600; i++) { const t = (i / 600) * Math.PI * 2, a = 9 * t + (k * 2 * Math.PI) / 3; pts.push(ringAt(t, R, 0.065 * Math.cos(a), 0.039 * Math.sin(2 * a))); }
      g.add(ringTube(pts, 0.022, w, 1200));
    }
    return g;
  },
  // Wales: a slim band, drawn as its edges and rulings, that twists over itself five half-turns on its way round, tipped more steeply than the
  // other rings (the opposite way) so it crosses them instead of lying on top of them
  wales(w) {
    const g = ringGroup(quat(0.5, 0, -0.42)), R = 0.88, N = 480, half = 0.085, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2, a = 2.5 * t;
      for (const s of [-1, 1]) { const p = ringAt(t, R, s * half * Math.cos(a), s * half * Math.sin(a)); pos.push(p.x, p.y, p.z); }
    }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    // drawn as its two edges plus rulings across the band, each ruling lighter where the band faces the light
    { const lp = [], lc = [], P2 = (i, sd) => { const t = (i / N) * Math.PI * 2, a = 2.5 * t; return ringAt(t, R, sd * half * Math.cos(a), sd * half * Math.sin(a)); };
      const shade = (i) => { const t = (i / N) * Math.PI * 2, a = 2.5 * t, tan = V3(-Math.sin(t), 0, Math.cos(t)), across = V3(Math.cos(a) * Math.cos(t), Math.sin(a), Math.cos(a) * Math.sin(t)), nrm = new THREE.Vector3().crossVectors(tan, across).normalize().applyQuaternion(g.quaternion); return 0.75 + 0.25 * Math.abs(nrm.dot(LIGHT)); };
      const add = (a, b, ca, cb) => { lp.push(a.x, a.y, a.z, b.x, b.y, b.z); lc.push(ca, ca, ca, cb, cb, cb); };
      for (let i = 0; i < N; i++) for (const sd of [-1, 1]) add(P2(i, sd), P2(i + 1, sd), 1, 1);
      for (let i = 0; i < N; i += 4) add(P2(i, -1), P2(i, 1), shade(i), shade(i));
      const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3)); lg.setAttribute("color", new THREE.Float32BufferAttribute(lc, 3));
      const ll = new THREE.LineSegments(lg, fadeBehindCore(new THREE.LineBasicMaterial({ color: MAP.lineColor, vertexColors: true, transparent: true, opacity: opa(0.95, w), depthWrite: false }))); ll.userData.part = "accent"; g.add(ll); }
    return g;
  },
};
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
// that curve round the shell. The teardrops are drawn in engraved lines: outline, lines along, rulings across.
function teardrop(group, out, { lat0, lon0, len, th, dir, r, curve, q, op }) {
  const nu = 48, nv = 6, pos = [], idx = [];
  const P = (u, v) => { // u: head → tail, v: −1 … 1 across
    const h = th * Math.sqrt(Math.min(1, u / 0.16)) * Math.pow(1 - u, 1.1) * 1.25;
    const lat = lat0 - curve * u * u + v * h, lon = lon0 + dir * len * u;
    const p = sph(lat, lon, r + 0.03 * Math.sin(Math.PI * u) * (1 - v * v)); return q ? p.applyQuaternion(q) : p;
  };
  // drawn in engraved lines, like the rings and coils: lines running along the teardrop, and rulings across it
  for (const v of [-0.5, 0, 0.5]) { const along = []; for (let i = 0; i <= nu; i++) along.push(P(i / nu, v)); line(along, out); }
  for (let i = 2; i < nu; i += 2) { const across = []; for (let j = 0; j <= nv; j++) across.push(P(i / nu, -1 + (2 * j) / nv)); line(across, out); }
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

// ---- fern wings (New Zealand): each wing is a fern frond — a slim curved stem lined with paired leaflets
// that shrink toward the tip, where the stem curls into a koru. Drawn in engraved lines like the teardrop wings.
// ribbon: a filled strip on the shell along path ([[lat, lon], …], radians), hw = its half-width at each point
function ribbon(group, out, path, hw, { r, q, op }) {
  const n = path.length, pos = [], idx = [], left = [], right = [];
  const P = (lat, lon, lift) => { const p = sph(lat, lon, r + lift); return q ? p.applyQuaternion(q) : p; };
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    let dl = b[0] - a[0], dn = b[1] - a[1]; const L = Math.hypot(dl, dn) || 1; dl /= L; dn /= L;
    const [lat, lon] = path[i], h = hw[i];
    for (const v of [-1, 0, 1]) {
      const p = P(lat + v * h * dn, lon - v * h * dl, v === 0 ? 0.012 * Math.min(1, h / (3 * D)) : 0);
      pos.push(p.x, p.y, p.z); if (v === -1) right.push(p); if (v === 1) left.push(p);
    }
  }
  // drawn in engraved lines: the outline, a centre vein, and rulings across every other step
  const mid = []; for (let i = 0; i < n; i++) mid.push(new THREE.Vector3(pos[i * 9 + 3], pos[i * 9 + 4], pos[i * 9 + 5]));
  line(mid, out);
  for (let i = 1; i < n - 1; i += 2) line([right[i], mid[i], left[i]], out);
  line(left.concat(right.slice().reverse()), out);
}
function fernWing(group, { q, w, flip = false }) {
  const out = [], op = 0.25 + 0.75 * w, r = 0.9;
  const o = { r, op, q: flip ? (q ? q.clone().multiply(quat(0, Math.PI, 0)) : quat(0, Math.PI, 0)) : q };
  const rib = (u) => [14 * D * Math.sin(Math.PI * u * 0.85) - 4 * D, -72 * D + 132 * D * u];
  const dir = (u) => { const a = rib(Math.max(0, u - 0.01)), b = rib(Math.min(1, u + 0.01)), L = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
  // the stem, then the koru: a spiral that keeps going forward and curls in on itself
  const path = [], hw = [];
  for (let i = 0; i <= 60; i++) { const u = i / 60; path.push(rib(u)); hw.push((1.9 - 0.8 * u) * D); }
  const tip = rib(1), [tl, tn] = dir(1), nl = tn, nn = -tl, R0 = 8 * D, C = [tip[0] + nl * R0, tip[1] + nn * R0];
  for (let i = 1; i <= 50; i++) {
    const f = (i / 50) * 2.3 * Math.PI, R = R0 * (1 - (0.3 * f) / Math.PI);
    path.push([C[0] + R * (-nl * Math.cos(f) + tl * Math.sin(f)), C[1] + R * (-nn * Math.cos(f) + tn * Math.sin(f))]);
    hw.push((1.1 - 0.75 * (i / 50)) * D);
  }
  ribbon(group, out, path, hw, o);
  // paired leaflets angled toward the tip, longest at the base
  for (let k = 0; k < 9; k++) {
    const u = 0.07 + k * 0.098, base = rib(u), [dl, dn] = dir(u), len = (27 - 19 * (u / 0.85)) * D;
    for (const s of [-1, 1]) {
      const th = s * 52 * D, al = dl * Math.cos(th) - dn * Math.sin(th), an = dl * Math.sin(th) + dn * Math.cos(th);
      const lp = [], lh = [];
      for (let j = 0; j <= 16; j++) {
        const t = 0.04 + 0.96 * (j / 16);
        lp.push([base[0] + len * (al * t + 0.15 * dl * t * t), base[1] + len * (an * t + 0.15 * dn * t * t)]);
        lh.push(len * 0.23 * Math.pow(Math.sin(Math.PI * t), 0.8));
      }
      ribbon(group, out, lp, lh, { ...o, r: r + 0.004 });
    }
  }
  group.add(segs(out, opa(0.95, w)));
}

// ---- coil: one solid, weighted line wound round the sphere from pole to pole
class SphereSpiral extends THREE.Curve {
  constructor(turns, r, off = 0, span = 78) { super(); this.turns = turns; this.r = r; this.off = off; this.span = span; }
  getPoint(t, target = new THREE.Vector3()) { const lat = (-this.span + 2 * this.span * t) * D, lon = this.off + t * this.turns * Math.PI * 2; return target.copy(sph(lat, lon, this.r)); }
}
// The line tapers to a sharp point at both ends: over the last `taper` of its length it gets steadily
// skinnier (fast at first, then slower) until it narrows to nothing, instead of stopping with a blunt cut.
function tube(curve, radius, w, taper = 0.14) {
  return lineTube(curve, radius, w, { taper, seg: 900 }); // drawn in engraved lines (the solid version below is no longer used)
  const segs = 900, radial = 10, geo = new THREE.TubeGeometry(curve, segs, radius, radial, false), pos = geo.attributes.position, c = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs, e = Math.min(1, Math.min(u, 1 - u) / taper), f = 1 - (1 - e) * (1 - e); // 1 along the middle → 0 at the tips
    if (f >= 1) continue;
    curve.getPointAt(u, c);
    for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; p.fromBufferAttribute(pos, k).sub(c).multiplyScalar(f).add(c); pos.setXYZ(k, p.x, p.y, p.z); }
  }
  pos.needsUpdate = true;
  const m = new THREE.Mesh(geo, fadeBehindCore(new THREE.MeshBasicMaterial({ color: MAP.lineColor, transparent: true, opacity: opa(0.95, w) })));
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
  british(T, w, v) { // one solid ring round the middle; the accent picks how it is built
    return (RINGS[v] || RINGS.scotland)(w);
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
  oceania(T, w, v) { // wings: two wings wrapping the core
    const g = new THREE.Group();
    if (v === "newzealand") { const q = quat(0, -1.6, 0).multiply(quat(-0.25, 0, 0.95)); fernWing(g, { q, w }); fernWing(g, { q, w, flip: true }); } // fern fronds, tilted on the opposite diagonal to Australia
    else { const q = quat(0.25, 0, -0.55); wingCap(g, { q, w }); wingCap(g, { q, w, flip: true }); } // Australia: teardrops, tilted about 30° on the diagonal
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
  CORE_R = size; CORE_COL = color;
  const top = T.accents[0]?.w || 1, lift = (w) => (T.accents.length > 1 ? Math.min(1, MAP.accent.mixLift + (1 - MAP.accent.mixLift) * (w / top)) : w);
  const structs = T.accents.map((a) => { const st = STRUCT[a.family](T, lift(a.w), a.label); group.add(st); return st; }); // (the share only sets how solid each layer is)
  CORE_R = null; CORE_COL = null;
  // the structure takes a very light tint of the core's color (the shading of the metal rings and the line weights stay as they are)
  const hsl = {}; color.getHSL(hsl);
  const shell = new THREE.Color().setHSL(hsl.h, MAP.shell.sat, MAP.shell.light);
  group.children.forEach((o) => { if (o.userData.part === "core" || o.userData.screenOnly) return;
    o.traverse((m) => { for (const mt of m.material ? [].concat(m.material) : []) if (mt.color) mt.color.copy(shell); }); });
  pauseBeads(take.rhythm, T, structs, group, color, size);
  return { group, traits: T, legend: legendFor(T), coreColor: color, shellColor: shell };
}

// ---- talking & pauses: beads threaded on the strongest accent's lines (see MAP.pauses)
const SPARKS = {};
// a plump four-pointed spark in the middle. glow (0 … 1): a soft halo round it. edge (−1 … 1, the raspy ↔ smooth dial):
// raspy voices get sharp, needle-like points; smooth voices get rounded tips and softly curved sides.
function sparkPicture(glow, edge) {
  const k = Math.round(glow * 4) / 4, e = Math.round(Math.max(-1, Math.min(1, edge)) * 4) / 4, key = k + "/" + e;
  if (SPARKS[key]) return SPARKS[key];
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d"), m = 128;
  if (k > 0) { const gr = g.createRadialGradient(m, m, 0, m, m, m); gr.addColorStop(0, `rgba(255,255,255,${0.75 * k})`); gr.addColorStop(0.3, `rgba(255,255,255,${0.32 * k})`); gr.addColorStop(0.6, `rgba(255,255,255,${0.1 * k})`); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
  // the raspier the voice, the longer and skinnier the spark's four limbs; only the smoothest voices (the last fifth of the
  // dial) get rounded tips and inner corners, everyone else a sharp spark
  const sharp = (e + 1) / 2, round = Math.max(0, Math.min(1, (-0.6 - e) / 0.4));
  const outer = 56 + 18 * sharp, inner = 24 - 13 * sharp + 2 * round, rTip = 9 * round, rIn = 16 * round;
  const pts = []; for (let i = 0; i < 8; i++) { const r = i % 2 ? inner : outer, a = (i / 8) * Math.PI * 2 - Math.PI / 2; pts.push([m + Math.cos(a) * r, m + Math.sin(a) * r]); }
  g.fillStyle = "#fff"; g.beginPath();
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], start = mid(pts[7], pts[0]); g.moveTo(start[0], start[1]);
  for (let i = 0; i < 8; i++) { const p = pts[i], n = mid(p, pts[(i + 1) % 8]); g.arcTo(p[0], p[1], n[0], n[1], i % 2 ? rIn : rTip); }
  g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (SPARKS[key] = t);
}
function pauseBeads(rhythm, T, structs, group, color, coreR) {
  const P = MAP.pauses, t0 = rhythm?.start, t1 = rhythm?.end ?? (t0 != null && rhythm?.totalSeconds ? t0 + rhythm.totalSeconds : null);
  const pauses = (rhythm?.pauses || []).filter((p) => p.seconds >= P.minSeconds);
  if (!pauses.length || t0 == null || !(t1 > t0) || !structs.length) return;
  const top = T.accents[0]?.w || 1, keep = structs.filter((_, i) => T.accents[i] && Math.abs(T.accents[i].w - top) < P.tie);
  // every bit of line in those structures, as segments in the portrait's own frame
  group.updateMatrixWorld(true);
  const segsW = [], a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const st of keep) st.traverse((o) => {
    if (o.userData.part !== "accent" || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count, get = (k) => (idx ? idx.getX(k) : k);
    const push = (i, j) => { a.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, j).applyMatrix4(o.matrixWorld); segsW.push(a.x, a.y, a.z, b.x, b.y, b.z); };
    if (o.isLineSegments) for (let k = 0; k + 1 < n; k += 2) push(get(k), get(k + 1));
    else if (o.isLine) for (let k = 0; k + 1 < n; k++) push(get(k), get(k + 1));
    else if (o.isMesh) for (let k = 0; k + 2 < n; k += 3) { push(get(k), get(k + 1)); push(get(k + 1), get(k + 2)); }
  });
  const glow = Math.max(0, Math.min(1, (P.manyFor - pauses.length) / (P.manyFor - P.fewFor)));
  const mat = new THREE.SpriteMaterial({ map: sparkPicture(glow, T.timbre?.enough ? T.timbre.raspy : 0), color: color.clone(), transparent: true, depthWrite: false, toneMapped: false });
  // hidden behind the core, exactly as the structure's own lines are (fadeBehindCore): checked at each bead's centre
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.coreR = { value: coreR || MAP.core.radius };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWorldP;")
      .replace("void main() {", "void main() {\n  vWorldP = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;");
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
  mat.customProgramCacheKey = () => "beadBehindCore";
  const beads = new THREE.Group(); beads.userData.screenOnly = true; beads.userData.pauses = true; // (the Voiceprint page finds the sparks by this)
  let yLo = Infinity, yHi = -Infinity; for (let k = 1; k < segsW.length; k += 3) { yLo = Math.min(yLo, segsW[k]); yHi = Math.max(yHi, segsW[k]); }
  for (const p of pauses) {
    const u = ((p.start + p.end) / 2 - t0) / (t1 - t0), th = (u - 0.5) * 2 * Math.PI; // (0 … 1 around, from the first word to the last)
    const nx = -Math.sin(th), nz = Math.cos(th), dx = Math.cos(th), dz = Math.sin(th), hits = [];
    for (let k = 0; k < segsW.length; k += 6) { // where each line crosses the half-plane at this angle
      const s0 = segsW[k] * nx + segsW[k + 2] * nz, s1 = segsW[k + 3] * nx + segsW[k + 5] * nz;
      if ((s0 > 0) === (s1 > 0) || s0 === s1) continue;
      const f = s0 / (s0 - s1), x = segsW[k] + (segsW[k + 3] - segsW[k]) * f, y = segsW[k + 1] + (segsW[k + 4] - segsW[k + 1]) * f, z = segsW[k + 2] + (segsW[k + 5] - segsW[k + 2]) * f;
      if (x * dx + z * dz > 0.05) hits.push([x, y, z]);
    }
    if (!hits.length) continue;
    const want = yHi - u * (yHi - yLo), q = hits.reduce((best, h) => (Math.abs(h[1] - want) < Math.abs(best[1] - want) ? h : best)); // one bead per pause
    const r = Math.min(P.maxSize, P.size + p.seconds * P.perSecond), m = new THREE.Sprite(mat);
    m.position.set(q[0], q[1], q[2]); m.scale.setScalar(r * 2 * P.spark * 2); m.userData.part = "pauses"; beads.add(m); // (the picture is twice the spark's size, leaving room for the glow)
  }
  group.add(beads);
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
      visual: T.hasAccent ? `The structure around the core, in a very light tint of the core's color: ${mix}. Each accent family has its own kind of structure, and each of the 16 accents its own variation; mixed accents layer theirs, smaller shares fainter.` : "No accent result, so the structure defaults to the prism shell." },
    { key: "core", tier: 1, data: "Note & pitch", value: `${T.note} · ${Math.round(T.pitch)} Hz`, visual: `The color of the glowing core. The note picks the hue (the 12 notes go round the color wheel, C = red); the pitch picks how deep or pale it is — lower voices richer, higher voices lighter (scale stretched to this archive, ${MAP.color.lowHz}–${MAP.color.highHz} Hz).` },
    { key: "timbre", tier: 1, data: "Timbre", value: timbreWords(T.timbre), visual: T.timbre.enough
        ? "The core's surroundings, edge and shape. Bright voices shine like a sun (rays in the core's colour); dark voices pull in a swirl of their own colour, like water down a drain. Breathy voices have a cloudy edge, clean ones a crisp edge. Raspy voices grow small spikes; smooth ones turn glossy, like polished glass, with crisp highlights and a bright rim. Each is as strong as it is in the voice, compared with the rest of the archive."
        : "There was too little clear voice in this recording to read its timbre, so the core is left plain." },
    { key: "vowels", tier: 1, data: "Vowel space", value: T.vowels.pts.length ? `${T.vowels.n} vowel moments` : "Not enough to map",
      visual: T.vowels.pts.length ? "The soft glowing spots in the core's surface. Every vowel this voice made is one spot, placed where it sits on the vowel chart and wrapped all the way round the core: front vowels like “ee” one way, back vowels like “oo” the other (they meet at the back), closed vowels toward the top and open ones like “ah” toward the bottom. Each voice is stretched to fill the whole core, so the pattern shows the shape of its own vowel space. The spots come in the core's two neighbouring colors on the color wheel: front vowels like “ee” in one and back vowels like “oo” in the other. Where vowels crowd together they overlap into solid patches."
        : "Too few vowel moments were measured in this recording to map them." },
    { key: "range", tier: 2, data: "Pitch range", value: `${Math.round(T.lo)}–${Math.round(T.hi)} Hz`, visual: "The top and bottom of the core. The top is lighter the higher this voice climbs above its average; the bottom is darker the lower it drops. (The very highest and lowest moments are ignored, so one squeak or croak doesn't count.)" },
  ];
}
