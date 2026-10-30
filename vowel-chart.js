// vowel-chart.js — draws a vowel chart (F2 across, F1 down) from voice frames.
// Every voiced moment of a recording becomes one faint dot, so a read passage
// builds up a "cloud" that shows the speaker's vowel space. A dashed outline
// shows a classic reference for comparison.

// Reference vowels: Peterson & Barney (1952) American English averages.
// "m" = adult men (lower voices), "w" = adult women (higher voices).
export const REFERENCE = [
  { word: "heed",  ipa: "i", m: [270, 2290], w: [310, 2790] },
  { word: "hid",   ipa: "ɪ", m: [390, 1990], w: [430, 2480] },
  { word: "head",  ipa: "ɛ", m: [530, 1840], w: [610, 2330] },
  { word: "had",   ipa: "æ", m: [660, 1720], w: [860, 2050] },
  { word: "hod",   ipa: "ɑ", m: [730, 1090], w: [850, 1220] },
  { word: "hawed", ipa: "ɔ", m: [570, 840],  w: [590, 920] },
  { word: "hood",  ipa: "ʊ", m: [440, 1020], w: [470, 1160] },
  { word: "who'd", ipa: "u", m: [300, 870],  w: [370, 950] },
  { word: "hud",   ipa: "ʌ", m: [640, 1190], w: [760, 1400] },
  { word: "heard", ipa: "ɝ", m: [490, 1350], w: [500, 1640] },
];
const OUTLINE = ["i", "ɪ", "ɛ", "æ", "ɑ", "ɔ", "ʊ", "u"]; // the edge of the vowel space

// Log scales. F2 runs high→low left to right, F1 low→high top to bottom,
// so the chart looks like a mouth seen from the side (front of the mouth on the left).
const F2_RANGE = [3200, 600];
const F1_RANGE = [200, 1100];

const inRange = (f) => f.f1 && f.f2 && f.f1 >= F1_RANGE[0] && f.f1 <= F1_RANGE[1] && f.f2 >= F2_RANGE[1] && f.f2 <= F2_RANGE[0];

/** Which reference to show: "m", "w" or null. choice is "auto" | "m" | "w" | "off". */
export function pickReference(frames, choice = "auto") {
  if (choice === "off") return null;
  if (choice !== "auto") return choice;
  const pitches = frames.map((f) => f.pitch).filter(Boolean).sort((a, b) => a - b);
  if (!pitches.length) return "m";
  return pitches[pitches.length >> 1] < 165 ? "m" : "w";
}

/** Count of frames that land on the chart. */
export const countVowelFrames = (frames) => frames.filter(inRange).length;

/**
 * cloud: frames to plot as dots; trail: the last few frames, drawn as a moving highlight;
 * ref: "m" | "w" | null; front / back: the two vowel colours (as on the 3D core: front vowels, the "ee" side, in one
 * neighbour of the note colour, back vowels, the "oo" side, in the other). The dots blend from one to the other.
 * Drawn on the vowel trapezoid (the shape linguists use, roughly the mouth) instead of a grid, with big EE / OO / AH corners.
 */
export function drawVowelChart(canvas, { cloud = [], trail = [], ref = null, front = null, back = null } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);

  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim();
  const muted = col("--muted"), accent = col("--accent"), live = col("--live") || accent;
  const narrow = W < 500;
  const pad = narrow ? { l: 16, r: 16, t: 50, b: 50 } : { l: 40, r: 40, t: 60, b: 58 };
  const lg = Math.log;
  let off = 0; // (shifts everything sideways so the trapezoid sits in the middle)
  const x = (f2) => off + pad.l + ((lg(F2_RANGE[0]) - lg(f2)) / (lg(F2_RANGE[0]) - lg(F2_RANGE[1]))) * (W - pad.l - pad.r);
  const y = (f1) => pad.t + ((lg(f1) - lg(F1_RANGE[0])) / (lg(F1_RANGE[1]) - lg(F1_RANGE[0]))) * (H - pad.t - pad.b);
  const refSet = ref || "w", at = (ipa) => { const w = REFERENCE.find((v) => v.ipa === ipa)[refSet]; return [x(w[1]), y(w[0])]; };

  // the frame: the vowel trapezoid through the corner vowels (ee, oo, ah-back, ah-front), a little larger than the average
  // speaker's, with faint guides at a third and two thirds of the way down and one down the middle
  const corners = () => { const c = ["i", "u", "ɑ", "æ"].map(at), cx = c.reduce((a, p) => a + p[0], 0) / 4, cy = c.reduce((a, p) => a + p[1], 0) / 4; return c.map((p) => [cx + (p[0] - cx) * 1.14, cy + (p[1] - cy) * 1.2]); };
  { const o = corners(), xs = o.map((p) => p[0]); off = (W - Math.min(...xs) - Math.max(...xs)) / 2; }
  const out = corners();
  g.save();
  g.beginPath(); out.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath();
  g.fillStyle = "rgba(255,255,255,0.02)"; g.fill(); g.strokeStyle = muted; g.globalAlpha = 0.7; g.lineWidth = 1.2; g.stroke(); // (the chart's lines: the voice's quieter third colour)
  g.globalAlpha = 0.35; g.lineWidth = 1; g.setLineDash([2, 5]);
  const along = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  for (const t of [1 / 3, 2 / 3]) { const L = along(out[0], out[3], t), R = along(out[1], out[2], t); g.beginPath(); g.moveTo(L[0], L[1]); g.lineTo(R[0], R[1]); g.stroke(); }
  { const T = along(out[0], out[1], 0.5), B = along(out[3], out[2], 0.5); g.beginPath(); g.moveTo(T[0], T[1]); g.lineTo(B[0], B[1]); g.stroke(); }
  g.restore();

  // the average speaker: a soft dashed outline
  if (ref) {
    g.save(); g.strokeStyle = muted; g.lineWidth = 1.2; g.lineJoin = "round"; g.setLineDash([3, 5]); g.beginPath();
    OUTLINE.map(at).forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.stroke(); g.restore();
  }

  // your vowels: small dots with a faint halo, blending from the front colour to the back colour across the chart
  const pts = cloud.filter(inRange), fc = front || accent, bc = back || accent;
  const mix = (() => { // two colours → a blend at t (0 … 1), via a 1×2 canvas so any CSS colour works
    const cv = document.createElement("canvas"); cv.width = 2; cv.height = 1; const cg = cv.getContext("2d"); cg.fillStyle = fc; cg.fillRect(0, 0, 1, 1); cg.fillStyle = bc; cg.fillRect(1, 0, 1, 1);
    const d = cg.getImageData(0, 0, 2, 1).data; return (t) => `${Math.round(d[0] + (d[4] - d[0]) * t)},${Math.round(d[1] + (d[5] - d[1]) * t)},${Math.round(d[2] + (d[6] - d[2]) * t)}`;
  })();
  const halo = (pts.length > 600 ? 0.1 : pts.length > 200 ? 0.16 : 0.24) * (narrow ? 1 : 1.5), dotA = pts.length > 600 ? 0.6 : 0.85, x0 = x(2200), x1 = x(1000);
  const dotR = narrow ? 1.7 : 2.3, haloR = narrow ? 6 : 8; // (computers: a little bigger and brighter)
  for (const f of pts) {
    const px = x(f.f2), py = y(f.f1), rgb = mix(Math.max(0, Math.min(1, (px - x0) / (x1 - x0))));
    const gr = g.createRadialGradient(px, py, 0, px, py, haloR); gr.addColorStop(0, `rgba(${rgb},${halo})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(px - haloR, py - haloR, haloR * 2, haloR * 2);
    g.fillStyle = `rgba(${rgb},${dotA})`; g.beginPath(); g.arc(px, py, dotR, 0, Math.PI * 2); g.fill();
  }

  // EE / OO / AH, big in the body font, with the example words small underneath
  const label = (t, sub, p, align, dy) => {
    g.textAlign = align; g.textBaseline = "alphabetic";
    g.fillStyle = "#ecebe7"; g.font = `500 ${narrow ? 20 : 28}px Geist, system-ui, sans-serif`; g.fillText(t, p[0], p[1] + dy);
    g.fillStyle = "#ecebe7"; g.font = `500 ${narrow ? 10.5 : 12}px Geist, system-ui, sans-serif`; g.fillText(sub, p[0], p[1] + dy + (narrow ? 18 : 21)); // (a little room under the big letters)
  };
  label("EE", "as in she", out[0], "left", narrow ? -25 : -28);
  label("OO", "as in poodle", out[1], "right", narrow ? -25 : -28);
  label("AH", "as in chocolate", [(out[2][0] + out[3][0]) / 2, Math.max(out[2][1], out[3][1])], "center", narrow ? 26 : 32);

  // live highlight
  const t = trail.filter(inRange);
  t.forEach((f, i) => {
    g.globalAlpha = (i + 1) / t.length;
    g.fillStyle = live;
    g.beginPath(); g.arc(x(f.f2), y(f.f1), i === t.length - 1 ? 7 : 3, 0, Math.PI * 2); g.fill();
  });
  g.globalAlpha = 1;
}
