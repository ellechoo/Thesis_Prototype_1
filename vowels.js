// vowels.js — prompted word list -> vowel formants -> vowel chart.
import { VoiceAnalyzer } from "./voice-analyzer.js";

// The classic "hVd" word list: h + vowel + d, so only the vowel changes.
// Reference F1/F2: Peterson & Barney (1952) American English averages.
// "m" = adult men (lower voices), "w" = adult women (higher voices).
export const WORDS = [
  { word: "heed",  ipa: "i", hint: "rhymes with “need”",          m: [270, 2290], w: [310, 2790] },
  { word: "hid",   ipa: "ɪ", hint: "rhymes with “kid”",           m: [390, 1990], w: [430, 2480] },
  { word: "head",  ipa: "ɛ", hint: "rhymes with “bed”",           m: [530, 1840], w: [610, 2330] },
  { word: "had",   ipa: "æ", hint: "rhymes with “dad”",           m: [660, 1720], w: [860, 2050] },
  { word: "hod",   ipa: "ɑ", hint: "rhymes with “pod”",           m: [730, 1090], w: [850, 1220] },
  { word: "hawed", ipa: "ɔ", hint: "as in “hemmed and hawed”",    m: [570, 840],  w: [590, 920] },
  { word: "hood",  ipa: "ʊ", hint: "rhymes with “good”",          m: [440, 1020], w: [470, 1160] },
  { word: "who'd", ipa: "u", hint: "rhymes with “food”",          m: [300, 870],  w: [370, 950] },
  { word: "hud",   ipa: "ʌ", hint: "rhymes with “mud”",           m: [640, 1190], w: [760, 1400] },
  { word: "heard", ipa: "ɝ", hint: "rhymes with “bird”",          m: [490, 1350], w: [500, 1640] },
];
// Outline of the vowel space (central vowels ʌ and ɝ left out)
const OUTLINE = ["i", "ɪ", "ɛ", "æ", "ɑ", "ɔ", "ʊ", "u"];

// Word detection tuning
const SILENCE_TO_END = 0.35; // seconds of quiet that end a word
const MIN_WORD = 0.12;       // ignore clicks shorter than this
const MAX_WORD = 2.5;        // cut off anything longer

const $ = (id) => document.getElementById(id);
const ui = {
  start: $("startBtn"), redo: $("redoBtn"), skip: $("skipBtn"), restart: $("restartBtn"),
  status: $("status"), prompt: $("prompt"), progress: $("promptProgress"), word: $("promptWord"),
  hint: $("promptHint"), listen: $("listenDot"), ref: $("refSelect"), canvas: $("chart"),
  tbody: document.querySelector("#results tbody"), json: $("jsonBtn"), csv: $("csvBtn"),
};

let va = null;
let index = 0;               // current word
let results = {};            // ipa -> { word, ipa, f1, f2, f3, pitch, frames }
let utter = null;            // frames of the word being spoken
let lastActiveT = 0;
let trail = [];              // recent voiced frames for the live dot
let ready = false;           // calibrated and listening

function setStatus(msg, isError = false) {
  ui.status.textContent = msg;
  ui.status.classList.toggle("error", isError);
}

ui.start.addEventListener("click", async () => {
  if (va?.running) { stop(); return; }
  va = new VoiceAnalyzer({ hopMs: 20 });
  va.recording = false; // this page keeps its own results, not every frame
  va.onFrame = onFrame;
  try {
    setStatus("Asking for microphone…");
    await va.start();
    ui.start.textContent = "Stop";
    [ui.redo, ui.skip, ui.restart].forEach((b) => (b.disabled = false));
    setStatus("Measuring room noise. Stay quiet for a moment…");
    ready = false;
    await va.calibrate(1200);
    ready = true;
    showPrompt();
    setStatus("Say the word shown, at a normal pace. It moves on by itself.");
  } catch (err) {
    stop();
    setStatus(err.name === "NotAllowedError" ? "Microphone permission was denied." : `Couldn't start: ${err.message}`, true);
  }
});

function stop() {
  va?.stop();
  ready = false;
  ui.start.textContent = "Start";
  [ui.redo, ui.skip].forEach((b) => (b.disabled = true));
  ui.listen.textContent = "stopped";
  ui.listen.classList.remove("on");
}

ui.skip.addEventListener("click", () => { utter = null; advance(); });
ui.redo.addEventListener("click", () => {
  index = Math.max(0, index - 1);
  delete results[WORDS[index].ipa];
  utter = null;
  showPrompt();
  render();
});
ui.restart.addEventListener("click", () => {
  results = {};
  index = 0;
  utter = null;
  showPrompt();
  render();
  setStatus(va?.running ? "Starting over. Say the first word." : "Cleared. Tap Start to begin.");
});
ui.ref.addEventListener("change", () => draw());
window.addEventListener("resize", () => draw());

function showPrompt() {
  ui.prompt.hidden = false;
  if (index >= WORDS.length) {
    ui.progress.textContent = "All done";
    ui.word.textContent = "✓";
    ui.hint.textContent = "Use Redo or Skip to change a word, or download your results below.";
    return;
  }
  const w = WORDS[index];
  ui.progress.textContent = `Word ${index + 1} of ${WORDS.length}`;
  ui.word.textContent = w.word;
  ui.hint.textContent = w.hint;
}

function advance() {
  // move to the next word that hasn't been recorded yet
  do { index++; } while (index < WORDS.length && results[WORDS[index].ipa]);
  showPrompt();
  if (index >= WORDS.length) setStatus("Done! Your vowel chart is below.");
}

function onFrame(f) {
  if (f.calibrating) return;

  // live trail
  if (f.f1 && f.f2) trail.push(f);
  while (trail.length && trail[0].t < f.t - 0.4) trail.shift();
  queueDraw();

  if (!ready || index >= WORDS.length) return;

  ui.listen.textContent = f.active ? "hearing you" : "waiting for you";
  ui.listen.classList.toggle("on", f.active);

  if (f.active) {
    if (!utter) utter = [];
    utter.push(f);
    lastActiveT = f.t;
  } else if (utter) {
    utter.push(f);
  }

  if (!utter) return;
  const dur = lastActiveT - utter[0].t;
  if (f.t - lastActiveT >= SILENCE_TO_END || dur >= MAX_WORD) {
    const frames = utter;
    utter = null;
    if (dur < MIN_WORD) return; // a click or bump
    finishWord(frames);
  }
}

// Find the steady middle of the vowel and take medians.
function finishWord(frames) {
  const w = WORDS[index];
  // longest run of voiced frames (allowing one-frame dropouts)
  let best = [], cur = [], gap = 0;
  for (const f of frames) {
    if (f.f1 && f.f2) { cur.push(f); gap = 0; }
    else if (cur.length && ++gap > 1) { if (cur.length > best.length) best = cur; cur = []; gap = 0; }
  }
  if (cur.length > best.length) best = cur;

  if (best.length < 4) {
    setStatus(`Didn't catch a clear vowel in “${w.word}”. Try again, a little louder or closer.`, true);
    return;
  }
  // middle 50% avoids the h- onset and -d offset
  const a = Math.floor(best.length * 0.25), b = Math.ceil(best.length * 0.75);
  const core = best.slice(a, Math.max(b, a + 2));
  results[w.ipa] = {
    word: w.word,
    ipa: w.ipa,
    f1: median(core.map((f) => f.f1)),
    f2: median(core.map((f) => f.f2)),
    f3: median(core.map((f) => f.f3).filter(Boolean)) || null,
    pitch: Math.round(median(core.map((f) => f.pitch))),
    voicedMs: Math.round((best[best.length - 1].t - best[0].t) * 1000),
  };
  setStatus(`Got “${w.word}”.`);
  render();
  advance();
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((p, q) => p - q);
  const m = s.length >> 1;
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

function refSet() {
  const v = ui.ref.value;
  if (v !== "auto") return v === "off" ? null : v;
  const pitches = Object.values(results).map((r) => r.pitch).filter(Boolean);
  if (!pitches.length) return "m";
  return median(pitches) < 165 ? "m" : "w";
}

// ---- table + downloads ----
function render() {
  ui.tbody.innerHTML = "";
  for (const w of WORDS) {
    const r = results[w.ipa];
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${w.word}</td><td>/${w.ipa}/</td><td>${r?.f1 ?? "–"}</td><td>${r?.f2 ?? "–"}</td><td>${r?.pitch ?? "–"}</td>`;
    ui.tbody.appendChild(tr);
  }
  const has = Object.keys(results).length > 0;
  ui.json.disabled = ui.csv.disabled = !has;
  draw();
}

ui.json.addEventListener("click", () => {
  const set = refSet();
  const data = {
    createdAt: new Date().toISOString(),
    reference: set ? { source: "Peterson & Barney (1952)", voice: set === "m" ? "lower" : "higher" } : null,
    vowels: WORDS.map((w) => ({ ...(results[w.ipa] ?? { word: w.word, ipa: w.ipa }), ref: set ? { f1: w[set][0], f2: w[set][1] } : null })),
  };
  download(JSON.stringify(data, null, 2), "application/json", "json");
});
ui.csv.addEventListener("click", () => {
  const set = refSet();
  const rows = [["word", "ipa", "f1", "f2", "f3", "pitch", "ref_f1", "ref_f2"].join(",")];
  for (const w of WORDS) {
    const r = results[w.ipa] ?? {};
    rows.push([w.word, w.ipa, r.f1 ?? "", r.f2 ?? "", r.f3 ?? "", r.pitch ?? "", set ? w[set][0] : "", set ? w[set][1] : ""].join(","));
  }
  download(rows.join("\n"), "text/csv", "csv");
});

function download(text, mime, ext) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = `vowels-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- chart ----
let drawQueued = false;
function queueDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

// Log scales. F2 runs high→low left to right, F1 runs low→high top to bottom,
// so the chart looks like a mouth seen from the side (front of mouth on the left).
const F2_RANGE = [3200, 600];
const F1_RANGE = [200, 1100];

function draw() {
  const c = ui.canvas;
  const dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth, H = c.clientHeight;
  if (!W || !H) return;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
  }
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);

  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim();
  const muted = col("--muted"), line = col("--line"), accent = col("--accent"), refc = col("--ref"), live = col("--live"), text = col("--text");

  const pad = { l: 44, r: 14, t: 26, b: 34 };
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
  g.textAlign = "left";
  g.textBaseline = "top";
  g.fillText("front ← F2 (Hz) → back", pad.l, 6);
  g.textAlign = "right";
  g.fillText("F1 ↓ more open", W - pad.r, 6);

  const set = refSet();
  const clampPt = (f1, f2) => [x(Math.min(Math.max(f2, F2_RANGE[1]), F2_RANGE[0])), y(Math.min(Math.max(f1, F1_RANGE[0]), F1_RANGE[1]))];

  // reference vowels
  if (set) {
    outline(g, OUTLINE.map((ipa) => WORDS.find((w) => w.ipa === ipa)[set]).map(([f1, f2]) => clampPt(f1, f2)), refc, [5, 4], 1.5);
    g.font = "14px system-ui, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillStyle = refc;
    g.strokeStyle = refc;
    g.lineWidth = 1.5;
    for (const w of WORDS) {
      const [px, py] = clampPt(w[set][0], w[set][1]);
      g.beginPath(); g.arc(px, py, 4, 0, Math.PI * 2); g.stroke();
      g.fillText(w.ipa, px + 6, py + 3);
    }
  }

  // user's vowels
  const pts = OUTLINE.map((ipa) => results[ipa]).filter(Boolean);
  if (pts.length >= 3) outline(g, pts.map((r) => clampPt(r.f1, r.f2)), accent, [], 2);
  for (const w of WORDS) {
    const r = results[w.ipa];
    if (!r) continue;
    const [px, py] = clampPt(r.f1, r.f2);
    g.fillStyle = accent;
    g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = text;
    g.font = "600 13px system-ui, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "bottom";
    g.fillText(narrow ? w.ipa : `${w.ipa} ${w.word}`, px + 7, py - 3);
  }

  // live trail
  trail.forEach((f, i) => {
    const [px, py] = clampPt(f.f1, f.f2);
    g.globalAlpha = (i + 1) / trail.length;
    g.fillStyle = live;
    g.beginPath(); g.arc(px, py, i === trail.length - 1 ? 7 : 3, 0, Math.PI * 2); g.fill();
  });
  g.globalAlpha = 1;
}

function outline(g, pts, color, dash, width) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.setLineDash(dash);
  g.beginPath();
  pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
  g.closePath();
  g.stroke();
  g.restore();
}

render();
