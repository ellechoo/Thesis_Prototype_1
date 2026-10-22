// voice-orb.js — the 3D voice portrait: a glowing core wrapped in a crisp white structure.
//
// HIERARCHY (most distinguishing traits first):
//   SEEN FIRST   Accent → the white STRUCTURE around the core (each accent family has its own:
//                         rings, net, fan, fur, ribbons). Mixed accents weave their structures together.
//                Pitch  → the COLOR of the glowing core.
//                Timbre → the FORM: the lumpy outline of the core, and how the structure is warped.
//   LOOK CLOSER  Melody → the other colors blended into the core (top = the voice's high notes,
//                         bottom = its low notes). A flat voice is nearly one color.
//                Note   → a small white bead on the equator; its position is the note letter, like a clock.
// Everything is rebuilt from the stored measurements, so every archived voice follows these rules.
// All the dials are in MAP.
import * as THREE from "three";

export const MAP = {
  // pitch → color, low voices to high voices along this palette (on a musical scale, lowHz..highHz)
  color: { lowHz: 85, highHz: 280, palette: ["#ff5a36", "#ffae2b", "#c9e85a", "#2fd3b0", "#3a8dff", "#8a5cff", "#ff4fb3"], melodyShift: 0.12 },
  // the core: a soft cloud of light
  core: { radius: 0.55, points: 9000, dotSize: 0.34, opacity: 0.045 },
  // timbre: 12 numbers compared with a typical voice (measured from the archive's first recordings).
  // Where this voice is above typical, the form swells there; below, it dips.
  timbre: {
    coreAmount: 0.3, structureAmount: 0.22, softness: 1.3, minSpread: 4,
    typical: [55.1, 19.3, 13.8, 2.4, -4.4, -5.9, -8.4, -7.5, -5.6, -2.8, -0.1, 0.6],
    spread: [11.8, 17.3, 10.3, 8.9, 7.0, 3.6, 3.0, 2.1, 2.2, 3.9, 4.7, 4.4],
  },
  // accent families → structures. Families under minShare of the voice's accent scores are left out.
  accent: {
    minShare: 0.06,
    families: {
      americas: { labels: ["us", "canada"], name: "Americas", structure: "nested rings" },
      british: { labels: ["england", "scotland", "ireland", "wales"], name: "British Isles", structure: "a geodesic net" },
      asia: { labels: ["indian", "malaysia", "philippines", "hongkong", "singapore"], name: "Asia", structure: "a fan of fibres" },
      oceania: { labels: ["australia", "newzealand"], name: "Oceania", structure: "fur" },
      atlantic: { labels: ["african", "southatlandtic", "bermuda"], name: "Africa & South Atlantic", structure: "looping ribbons" },
    },
  },
  note: { radius: 1.18, bead: 0.035 },
  lineColor: 0xf4f1ea,
};

// ---------------------------------------------------------------- helpers
const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const midiOf = (hz) => 69 + 12 * Math.log2(hz / 440);
export const noteOf = (hz) => { const m = Math.round(midiOf(hz)); return NOTES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); };
const median = (xs) => { const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
const PAL = () => MAP.color.palette.map((h) => new THREE.Color(h));
function paletteAt(t) { const P = PAL(), x = Math.max(0, Math.min(1, t)) * (P.length - 1), i = Math.min(P.length - 2, Math.floor(x)); return P[i].clone().lerp(P[i + 1], x - i); }
const pitchT = (hz) => Math.log2(hz / MAP.color.lowHz) / Math.log2(MAP.color.highHz / MAP.color.lowHz);
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
  const fam = Object.fromEntries(Object.keys(MAP.accent.families).map((k) => [k, 0]));
  for (const r of take.accent?.results || []) for (const [k, f] of Object.entries(MAP.accent.families)) if (f.labels.includes(r.label)) fam[k] += r.score;
  let tot = Object.values(fam).reduce((a, b) => a + b, 0);
  if (!tot) { fam.americas = 1; tot = 1; }
  for (const k in fam) { fam[k] /= tot; if (fam[k] < MAP.accent.minShare) fam[k] = 0; }
  tot = Object.values(fam).reduce((a, b) => a + b, 0);
  for (const k in fam) fam[k] /= tot;
  const active = frames.filter((f) => f.active && f.mfcc);
  const TM = MAP.timbre;
  const mfcc = Array.from({ length: 12 }, (_, i) => (active.length ? active.reduce((a, f) => a + (f.mfcc[i + 1] ?? 0), 0) / active.length : TM.typical[i]));
  const z = mfcc.map((m, k) => Math.tanh((m - TM.typical[k]) / Math.max(TM.spread[k], TM.minSpread) / TM.softness));
  return { pitch, note: s.note || noteOf(pitch), lo: q(0.08), hi: q(0.92), rangeSt: 12 * Math.log2(q(0.92) / q(0.08)), fam, z,
    accentTop: take.accent?.top || null, hasAccent: !!take.accent, rand: rng(take.id || take.name || "voice") };
}
function timbreShape(T, amount) { const lobes = dirs(12, T.rand); return (v) => { let r = 1; for (let k = 0; k < 12; k++) r += amount * T.z[k] * Math.exp(-(1 - v.dot(lobes[k])) * 3); return Math.max(0.45, r); }; }

// ---------------------------------------------------------------- the glowing core (pitch, melody, timbre)
function core(T) {
  const C = MAP.core, shape = timbreShape(T, MAP.timbre.coreAmount), pos = [], col = [];
  const cIn = paletteAt(pitchT(T.pitch)), cHi = paletteAt(pitchT(T.hi) + MAP.color.melodyShift), cLo = paletteAt(pitchT(T.lo) - MAP.color.melodyShift);
  for (let i = 0; i < C.points; i++) {
    const v = new THREE.Vector3(T.rand() * 2 - 1, T.rand() * 2 - 1, T.rand() * 2 - 1);
    const u = v.length(); if (u > 1 || u < 1e-3) { i--; continue; }
    const d = v.normalize(), r = C.radius * shape(d) * Math.pow(u, 0.8);
    pos.push(d.x * r, d.y * r, d.z * r);
    const c = cIn.clone().lerp(d.y > 0 ? cHi : cLo, Math.pow(u, 1.4));
    col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: C.dotSize, map: softDot(), vertexColors: true, transparent: true, opacity: C.opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.userData.part = "core";
  return { pts, color: cIn };
}

// ---------------------------------------------------------------- the white structures (accent)
const lineMat = (o) => new THREE.LineBasicMaterial({ color: MAP.lineColor, transparent: true, opacity: o });
function segs(arr, o) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3)); const l = new THREE.LineSegments(g, lineMat(o)); l.userData.part = "accent"; return l; }
const STRUCT = {
  americas(T, w, shape) { // nested, tilted rings
    const out = [], n = Math.round(4 + 10 * w);
    for (let k = 0; k < n; k++) {
      const R = 0.8 + 0.25 * (k / n), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3 + T.z[k % 12] * 0.8 + k * 0.08, k * 0.35, 0.2 * T.z[(k + 3) % 12]));
      for (let i = 0; i < 160; i++) for (const j of [i, i + 1]) { const a = (j / 160) * Math.PI * 2, p = new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R).applyQuaternion(q); p.multiplyScalar(shape(p.clone().normalize()) * 0.95); out.push(p.x, p.y, p.z); }
    }
    return segs(out, 0.7);
  },
  british(T, w, shape) { // a geodesic net with nodes
    const wire = new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1, 2)), p = wire.attributes.position, out = [], nodes = [];
    for (let i = 0; i < p.count; i += 2) {
      if (T.rand() > 0.35 + 0.65 * w) continue;
      for (const j of [i, i + 1]) { const v = new THREE.Vector3().fromBufferAttribute(p, j).normalize(); v.multiplyScalar(shape(v)); out.push(v.x, v.y, v.z); nodes.push(v.x, v.y, v.z); }
    }
    const g = new THREE.Group(); g.add(segs(out, 0.75));
    const ng = new THREE.BufferGeometry(); ng.setAttribute("position", new THREE.Float32BufferAttribute(nodes, 3));
    const dots = new THREE.Points(ng, new THREE.PointsMaterial({ color: 0xffffff, size: 0.045, map: softDot(), transparent: true, depthWrite: false }));
    dots.userData.part = "accent"; g.add(dots);
    return g;
  },
  asia(T, w, shape) { // a fan of fibres sweeping out from one side
    const out = [], n = Math.round(60 + 160 * w), hub = new THREE.Vector3(-0.75, -0.55, 0.2);
    for (let i = 0; i < n; i++) {
      const a = -0.2 + (i / n) * 2.3, b = (T.rand() - 0.5) * 1.2;
      const end = new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(a) * Math.cos(b), Math.sin(b)).multiplyScalar(1.05);
      end.multiplyScalar(shape(end.clone().normalize()));
      const mid = hub.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0, 0.35 * T.z[i % 12]));
      const c = new THREE.QuadraticBezierCurve3(hub, mid, end).getPoints(18);
      for (let k = 0; k < c.length - 1; k++) out.push(c[k].x, c[k].y, c[k].z, c[k + 1].x, c[k + 1].y, c[k + 1].z);
    }
    return segs(out, 0.55);
  },
  oceania(T, w, shape) { // fur: short hairs standing out from the core
    const out = [], n = Math.round(700 + 2400 * w);
    for (const d of dirs(n, T.rand)) {
      const r0 = 0.62 * shape(d), len = 0.25 + 0.4 * T.rand() * shape(d);
      const t = d.clone().add(new THREE.Vector3(T.rand() - 0.5, T.rand() - 0.5, T.rand() - 0.5).multiplyScalar(0.25)).normalize();
      out.push(d.x * r0, d.y * r0, d.z * r0, d.x * r0 + t.x * len, d.y * r0 + t.y * len, d.z * r0 + t.z * len);
    }
    return segs(out, 0.5);
  },
  atlantic(T, w, shape) { // swirling, looping ribbons
    const out = [], n = Math.round(3 + 7 * w);
    for (let k = 0; k < n; k++) {
      const ph = [T.rand() * 6.28, T.rand() * 6.28, T.rand() * 6.28], f = [1 + (k % 3), 2 + ((k + 1) % 2), 1 + ((k + 2) % 3)];
      let prev = null;
      for (let i = 0; i <= 400; i++) {
        const t = (i / 400) * Math.PI * 2;
        const p = new THREE.Vector3(Math.sin(f[0] * t + ph[0]), Math.sin(f[1] * t + ph[1]), Math.cos(f[2] * t + ph[2])).normalize().multiplyScalar(0.8 + 0.25 * Math.sin(t * 3 + k));
        p.multiplyScalar(shape(p.clone().normalize()));
        if (prev) out.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
    }
    return segs(out, 0.6);
  },
};

// ---------------------------------------------------------------- build
export function buildOrb(take) {
  const T = traits(take), group = new THREE.Group(), shape = timbreShape(T, MAP.timbre.structureAmount);
  const { pts, color } = core(T);
  group.add(pts);
  for (const [f, w] of Object.entries(T.fam)) if (w > 0) group.add(STRUCT[f](T, w, shape));
  const pc = ((Math.round(midiOf(T.pitch)) % 12) + 12) % 12, a = Math.PI / 2 - (pc / 12) * Math.PI * 2;
  const bead = new THREE.Mesh(new THREE.SphereGeometry(MAP.note.bead, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  bead.position.set(Math.cos(a) * MAP.note.radius, 0, Math.sin(a) * MAP.note.radius);
  bead.userData.part = "note";
  group.add(bead);
  return { group, traits: T, legend: legendFor(T), coreColor: color };
}

export function legendFor(T) {
  const fams = Object.entries(T.fam).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
  const mix = fams.map(([k, w]) => `${MAP.accent.families[k].structure} (${MAP.accent.families[k].name}, ${Math.round(w * 100)}%)`).join(" woven with ");
  return [
    { key: "accent", tier: 1, data: "Accent", value: T.accentTop ? T.accentTop.name : "Not measured",
      visual: T.hasAccent ? `The white structure: ${mix}. Each accent family has its own structure; mixed accents weave theirs together.` : "No accent result, so the structure defaults to rings." },
    { key: "core", tier: 1, data: "Pitch", value: `${Math.round(T.pitch)} Hz`, visual: "The color of the glowing core. Low voices are red-orange, middle voices green to blue, high voices violet to pink." },
    { key: "timbre", tier: 1, data: "Timbre", value: "12 tone-color numbers", visual: "The form: the lumpy outline of the core and the way the structure is warped. Voices that sound different grow different forms." },
    { key: "melody", tier: 2, data: "Melody", value: `${T.rangeSt.toFixed(1)} semitones`, visual: "The other colors blended into the core: the top shows the voice's higher notes, the bottom its lower ones. A flat voice is nearly one color." },
    { key: "note", tier: 2, data: "Note", value: T.note, visual: "The small white bead on the equator. Its position is the note's letter, going round like a clock with C at the top." },
  ];
}
