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
 * ref: "m" | "w" | null.
 */
export function drawVowelChart(canvas, { cloud = [], trail = [], ref = null } = {}) {
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
  const muted = col("--muted"), line = col("--line"), accent = col("--accent"), refc = col("--ref"), live = col("--live");

  const pad = { l: 58, r: 14, t: 14, b: 50 };
  const lg = Math.log;
  const x = (f2) => pad.l + ((lg(F2_RANGE[0]) - lg(f2)) / (lg(F2_RANGE[0]) - lg(F2_RANGE[1]))) * (W - pad.l - pad.r);
  const y = (f1) => pad.t + ((lg(f1) - lg(F1_RANGE[0])) / (lg(F1_RANGE[1]) - lg(F1_RANGE[0]))) * (H - pad.t - pad.b);

  // grid + axis labels
  g.font = "11px system-ui, sans-serif";
  g.strokeStyle = line;
  g.fillStyle = muted;
  g.lineWidth = 1;
  g.textAlign = "center";
  g.textBaseline = "top";
  const narrow = W < 500;
  for (const f2 of narrow ? [3000, 2000, 1500, 1000, 700] : [3000, 2500, 2000, 1500, 1000, 700]) {
    g.beginPath(); g.moveTo(x(f2), pad.t); g.lineTo(x(f2), H - pad.b); g.stroke();
    g.fillText(f2, x(f2), H - pad.b + 6);
  }
  g.textAlign = "right";
  g.textBaseline = "middle";
  for (const f1 of [300, 400, 500, 700, 900]) {
    g.beginPath(); g.moveTo(pad.l, y(f1)); g.lineTo(W - pad.r, y(f1)); g.stroke();
    g.fillText(f1, pad.l - 6, y(f1));
  }
  // plain-language axis titles
  g.font = "12px system-ui, sans-serif";
  g.fillStyle = muted;
  g.textAlign = "center";
  g.textBaseline = "bottom";
  g.fillText(narrow ? "← tongue forward · tongue back →" : "← tongue forward        F2 (Hz)        tongue back →", pad.l + (W - pad.l - pad.r) / 2, H - 4);
  g.save();
  g.translate(14, pad.t + (H - pad.t - pad.b) / 2);
  g.rotate(-Math.PI / 2);
  g.textBaseline = "middle";
  g.fillText(narrow ? "open ← mouth → closed" : "mouth open ←    F1 (Hz)    → mouth closed", 0, 0);
  g.restore();

  // corner hints: where the three extreme vowels live
  g.font = "600 13px system-ui, sans-serif";
  g.fillStyle = muted;
  g.globalAlpha = 0.8;
  g.textBaseline = "top";
  g.textAlign = "left";
  g.fillText("“ee” as in she", pad.l + 8, pad.t + 6);
  g.textAlign = "right";
  g.fillText("“oo” as in poodle", W - pad.r - 8, pad.t + 6);
  g.textAlign = "center";
  g.textBaseline = "bottom";
  g.fillText("“ah” as in chocolate", x(1300), H - pad.b - 8);
  g.globalAlpha = 1;

  // your cloud
  const pts = cloud.filter(inRange);
  const alpha = pts.length > 600 ? 0.14 : pts.length > 200 ? 0.22 : 0.35;
  g.fillStyle = accent;
  g.globalAlpha = alpha;
  for (const f of pts) {
    g.beginPath(); g.arc(x(f.f2), y(f.f1), 2.5, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;

  // reference vowel shape
  if (ref) {
    const at = (w) => [x(w[ref][1]), y(w[ref][0])];
    g.save();
    g.strokeStyle = refc;
    g.lineWidth = 1.5;
    g.setLineDash([5, 4]);
    g.beginPath();
    OUTLINE.map((ipa) => at(REFERENCE.find((w) => w.ipa === ipa))).forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.closePath();
    g.stroke();
    g.restore();
    g.font = "12px system-ui, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.strokeStyle = refc;
    g.fillStyle = refc;
    g.lineWidth = 1.5;
    for (const w of REFERENCE) {
      const [px, py] = at(w);
      g.beginPath(); g.arc(px, py, 3.5, 0, Math.PI * 2); g.stroke();
      g.fillText(narrow ? w.ipa : w.word, px + 6, py + 2);
    }
  }

  // live highlight
  const t = trail.filter(inRange);
  t.forEach((f, i) => {
    g.globalAlpha = (i + 1) / t.length;
    g.fillStyle = live;
    g.beginPath(); g.arc(x(f.f2), y(f.f1), i === t.length - 1 ? 7 : 3, 0, Math.PI * 2); g.fill();
  });
  g.globalAlpha = 1;
}
