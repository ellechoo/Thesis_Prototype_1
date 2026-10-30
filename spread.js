// spread.js — orders the archive's voices so that voiceprints that look alike don't sit next to each other.
// The galleries (the Archive's honeycomb and globe, the Join page's honeycomb) place voice number p by a fixed rule, so
// which voices end up as neighbours depends only on the order. This finds an order where neighbours look different:
// it scores each neighbouring pair by how alike their voiceprints are (same accent structure, close colours, similar
// timbre) and keeps swapping voices round while that makes the total smaller. The result is the same every time for the
// same voices (no randomness between visits).
import { traits } from "./voice-orb.js?v=69";

const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const noteIndex = (n) => NOTES.indexOf(String(n || "").replace("#", "♯").replace(/-?\d+$/, ""));

// how alike two voiceprints look, 0 (nothing in common) … 1 (practically the same)
function looks(t) {
  const T = traits({ ...t, frames: t.frames || [] }), a = T.accents[0];
  return { label: a?.label || null, family: a?.family || null, note: noteIndex(T.note), pitch: T.pitch, tb: T.timbre };
}
function alike(A, B) {
  const accent = A.label === B.label ? 1 : A.family && A.family === B.family ? 0.6 : 0; // (two voices with no accent: same as each other)
  let colour = 0;
  if (A.note >= 0 && B.note >= 0) {
    const d = Math.min(Math.abs(A.note - B.note), 12 - Math.abs(A.note - B.note)); // semitones round the colour wheel
    colour = Math.max(0, 1 - d / 2) * Math.max(0, 1 - Math.abs(Math.log2(A.pitch / B.pitch)));
  }
  const tb = A.tb.enough && B.tb.enough ? Math.max(0, 1 - Math.hypot(A.tb.bright - B.tb.bright, A.tb.breathy - B.tb.breathy, A.tb.raspy - B.tb.raspy) / 1.2) : 0.5;
  return 0.45 * accent + 0.4 * colour + 0.15 * tb;
}

// which places count as neighbours: the honeycomb's six (tile (i, j) shows voice (5i + 3j) mod N, so a neighbour is
// 2, 3, 5 or 8 places away), and on the globe (a spiral of N points) each point's nearest few
function neighbourPairs(N) {
  const pairs = new Set(), add = (a, b) => { a = ((a % N) + N) % N; b = ((b % N) + N) % N; if (a !== b) pairs.add(a < b ? a * N + b : b * N + a); };
  for (let p = 0; p < N; p++) for (const d of [2, 3, 5, 8]) add(p, p + d);
  const pts = Array.from({ length: N }, (_, i) => { const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), th = i * 2.399963; return [Math.cos(th) * r, y, Math.sin(th) * r]; });
  for (let i = 0; i < N; i++) {
    const near = pts.map((q, j) => [j, (q[0] - pts[i][0]) ** 2 + (q[1] - pts[i][1]) ** 2 + (q[2] - pts[i][2]) ** 2]).sort((a, b) => a[1] - b[1]).slice(1, 6);
    for (const [j] of near) add(i, j);
  }
  return [...pairs].map((k) => [Math.floor(k / N), k % N]);
}

/** The voices in a new order where neighbours in the galleries look as different as possible. */
export function spreadOut(people) {
  const N = people.length; if (N < 4) return people;
  let L; try { L = people.map(looks); } catch (e) { console.warn("Couldn't compare the voiceprints:", e); return people; }
  const sim = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === j ? 0 : alike(L[i], L[j]))));
  const pairs = neighbourPairs(N), at = Array.from({ length: N }, () => []); // at[place]: the places next to it
  for (const [a, b] of pairs) { at[a].push(b); at[b].push(a); }
  const order = people.map((_, i) => i); // order[place] = which voice sits there
  const costAt = (place, voice) => at[place].reduce((s, q) => s + sim[voice][order[q]], 0);
  // a fixed seed from the voices themselves, so the same archive always comes out the same way
  let h = 2166136261; for (const t of people) for (const c of String(t.id ?? t.name)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  for (let it = 0, tries = Math.min(60000, N * N * 6); it < tries; it++) {
    const x = Math.floor(rnd() * N), y = Math.floor(rnd() * N); if (x === y) continue;
    const vx = order[x], vy = order[y];
    const before = costAt(x, vx) + costAt(y, vy);
    order[x] = vy; order[y] = vx;
    const after = costAt(x, vy) + costAt(y, vx);
    if (after > before - 1e-9) { order[x] = vx; order[y] = vy; } // (no better: put them back)
  }
  return order.map((v) => people[v]);
}
