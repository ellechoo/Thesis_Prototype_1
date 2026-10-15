// app.js — one recording drives everything: live readouts while you speak,
// then an accent check and a vowel chart for the whole take.
import { VoiceAnalyzer, analyzeSamples, framesToCSV } from "./voice-analyzer.js";
import { startRecording, resampleTo, decodeFile, encodeWav } from "./recorder.js";
import { ACCENT_MODE, ACCENT_SERVER } from "./config.js";
import { loadAccentModel } from "./accent-model.js";
import { drawVowelChart, pickReference, countVowelFrames } from "./vowel-chart.js";

const MIN_ACCENT_SECONDS = 5;    // the accent model needs at least this much
const ACCENT_SECONDS = 30;       // and uses at most this much
const MAX_TAKE_SECONDS = 120;    // recording stops by itself here
const CALIBRATE_MS = 1000;       // room-noise measurement before each take
const TRACE_SECONDS = 8;
const RATE = 16000;
const SHOW_TOP = 6;

const $ = (id) => document.getElementById(id);
const ui = {
  rec: $("recBtn"), timer: $("timer"), file: $("fileInput"), status: $("status"), modelStatus: $("modelStatus"),
  optFilters: $("optFilters"), optBrowserNS: $("optBrowserNS"),
  mode: $("readoutMode"), active: $("activeDot"),
  pitch: $("rPitch"), note: $("rNote"), db: $("rDb"), centroid: $("rCentroid"), clarity: $("rClarity"),
  frames: $("rFrames"), duration: $("rDuration"),
  meterFill: $("meterFill"), gateMark: $("gateMark"), gateLabel: $("gateLabel"),
  trace: $("trace"), traceLabel: $("traceLabel"),
  accentEmpty: $("accentEmpty"), accentResult: $("accentResult"), top: $("topLine"), meta: $("resultMeta"),
  bars: $("bars"), more: $("moreBtn"),
  vowel: $("vowelChart"), ref: $("refSelect"), vowelCount: $("vowelCount"),
  json: $("jsonBtn"), csv: $("csvBtn"), wav: $("wavBtn"), lastFrame: $("lastFrame"),
};

let phase = "idle";   // idle | starting | recording | analyzing
let va = null, rec = null, tick = null;
let take = null;      // the finished take: { frames, wav, accent, ... }
let recent = [];      // last few seconds of live frames, for the pitch trace
let trail = [];       // last fraction of a second of voiced frames, for the vowel chart
let showAll = false;
let drawQueued = false;

function setStatus(msg, isError = false) {
  ui.status.textContent = msg;
  ui.status.classList.toggle("error", isError);
}

function setPhase(p) {
  phase = p;
  ui.rec.textContent = p === "recording" ? "Stop and analyze" : "Start recording";
  ui.rec.disabled = p === "starting" || p === "analyzing";
  ui.file.disabled = p !== "idle";
  ui.optFilters.disabled = ui.optBrowserNS.disabled = p !== "idle";
  const done = p === "idle" && take;
  ui.json.disabled = ui.csv.disabled = !(done && take.frames.length);
  ui.wav.disabled = !(done && take.wav);
}

// ---------- recording from the mic ----------
ui.rec.addEventListener("click", () => (phase === "recording" ? finishRecording() : startRecordingTake()));

async function startRecordingTake() {
  if (phase !== "idle") return;
  resetTake();
  setPhase("starting");
  va = new VoiceAnalyzer({ useFilters: ui.optFilters.checked, browserNoiseSuppression: ui.optBrowserNS.checked });
  va.onFrame = onLiveFrame;
  try {
    setStatus("Asking for microphone…");
    await va.start();
    warmUpModel();
    setStatus("Measuring room noise. Stay quiet for a second…");
    await va.calibrate(CALIBRATE_MS);
    rec = await startRecording(va.ctx, va.source);
    va.clear();
    va.resetClock();
    recent = [];
    setPhase("recording");
    setStatus("Go! Read the passage aloud. Tap “Stop and analyze” when you're done.");
    tick = setInterval(() => {
      const s = rec.seconds();
      ui.timer.textContent = clock(s);
      if (s >= MAX_TAKE_SECONDS) finishRecording();
    }, 200);
  } catch (err) {
    stopMic();
    setPhase("idle");
    setStatus(friendlyError(err), true);
  }
}

async function finishRecording() {
  if (phase !== "recording") return;
  clearInterval(tick);
  const sampleRate = rec.sampleRate;
  const samples = rec.stop();
  rec = null;
  const info = { frames: va.frames, sampleRate: va.sampleRate, noiseFloor: va.noiseFloor, gate: va.gate, settings: va.opts };
  stopMic();
  await finishTake({ ...info, samples, samplesRate: sampleRate, source: "microphone" });
}

function stopMic() {
  clearInterval(tick);
  try { rec?.stop(); } catch {}
  rec = null;
  va?.stop();
  ui.meterFill.style.width = "0%";
  ui.active.textContent = "idle";
  ui.active.classList.remove("on");
}

// ---------- analyzing a file ----------
ui.file.addEventListener("change", async () => {
  const file = ui.file.files[0];
  ui.file.value = "";
  if (!file || phase !== "idle") return;
  resetTake();
  setPhase("analyzing");
  warmUpModel();
  try {
    setStatus(`Reading ${file.name}…`);
    const decoded = await decodeFile(file);
    const samples = decoded.samples.subarray(0, Math.round(MAX_TAKE_SECONDS * decoded.sampleRate));
    const settings = { useFilters: ui.optFilters.checked };
    const forAnalysis = settings.useFilters ? await filterClip(samples, decoded.sampleRate) : samples;
    const { frames, noiseFloor, gate } = await analyzeSamples(forAnalysis, decoded.sampleRate, settings,
      (p) => setStatus(`Measuring ${file.name}… ${Math.round(p * 100)}%`));
    ui.timer.textContent = clock(samples.length / decoded.sampleRate);
    await finishTake({ frames, samples, samplesRate: decoded.sampleRate, sampleRate: decoded.sampleRate, noiseFloor, gate,
      settings: { ...settings, file: file.name }, source: file.name });
  } catch (e) {
    setPhase("idle");
    setStatus(`Couldn't read that file: ${e.message}`, true);
  }
});

// Same 80 Hz – 8 kHz band as the live filters, applied to a recorded clip.
async function filterClip(samples, rate) {
  const off = new OfflineAudioContext(1, samples.length, rate);
  const buf = off.createBuffer(1, samples.length, rate);
  buf.copyToChannel(samples, 0);
  const src = off.createBufferSource();
  src.buffer = buf;
  const hp = off.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 80;
  const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = Math.min(8000, rate / 2 - 100);
  src.connect(hp); hp.connect(lp); lp.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0).slice();
}

// ---------- the finished take ----------
function resetTake() {
  take = null;
  recent = [];
  trail = [];
  showAll = false;
  ui.accentResult.hidden = true;
  ui.accentEmpty.hidden = false;
  ui.timer.textContent = "0:00";
  ui.lastFrame.textContent = "Start recording to see a live frame.";
  ui.mode.textContent = "Live";
  showReadouts(null);
  ui.frames.textContent = "0";
  ui.duration.textContent = "0.0 s";
  queueDraw();
}

async function finishTake({ frames, samples, samplesRate, sampleRate, noiseFloor, gate, settings, source }) {
  setPhase("analyzing");
  const seconds = samples.length / samplesRate;
  take = {
    createdAt: new Date().toISOString(), source, seconds: round2(seconds),
    sampleRate, noiseFloor, gate, settings, frames, wav: null, accent: null,
  };
  trail = [];
  showTakeSummary();
  queueDraw();

  try {
    setStatus("Preparing audio…");
    const pcm = await resampleTo(samples, samplesRate, RATE);
    take.wav = encodeWav(pcm, RATE);
    if (seconds < MIN_ACCENT_SECONDS) {
      setStatus(`Voice data is ready. The recording was ${seconds.toFixed(1)} s, so there's no accent check: it needs at least ${MIN_ACCENT_SECONDS} s.`, true);
    } else {
      take.accent = await classifyAccent(pcm);
      showAll = false;
      renderAccent();
      setStatus("Done. Record again to compare, or download your data below.");
    }
  } catch (e) {
    setStatus(`Voice data is ready, but the accent check failed: ${e.message}`, true);
  } finally {
    setPhase("idle");
  }
}

function showTakeSummary() {
  const f = take.frames;
  const voiced = f.filter((x) => x.pitch);
  const active = f.filter((x) => x.active);
  const pitch = median(voiced.map((x) => x.pitch));
  ui.mode.textContent = "This recording (typical values)";
  showReadouts({
    pitch: pitch && Math.round(pitch),
    note: pitch && noteName(pitch),
    db: median(active.map((x) => x.db)),
    centroid: median(active.map((x) => x.centroidHz).filter(Boolean)),
    clarity: median(voiced.map((x) => x.clarity)),
  });
  ui.frames.textContent = f.length.toLocaleString();
  ui.duration.textContent = `${take.seconds.toFixed(1)} s`;
  if (f.length) ui.lastFrame.textContent = JSON.stringify(f.find((x) => x.pitch) ?? f[f.length - 1], null, 2);
}

function showReadouts(r) {
  ui.pitch.textContent = r?.pitch ?? "–";
  ui.note.textContent = r?.note ?? "–";
  ui.db.textContent = r?.db != null && r.db > -120 ? Math.round(r.db) : "–";
  ui.centroid.textContent = r?.centroid ? Math.round(r.centroid) : "–";
  ui.clarity.textContent = r?.clarity != null ? r.clarity.toFixed(2) : "–";
}

// ---------- live frames ----------
function onLiveFrame(f) {
  showReadouts({ pitch: f.pitch, note: f.pitch ? noteName(f.pitch) : null, db: f.db, centroid: f.centroidHz, clarity: f.clarity });
  ui.active.textContent = f.calibrating ? "measuring room" : f.active ? "sound detected" : "silent";
  ui.active.classList.toggle("on", f.active && !f.calibrating);

  ui.meterFill.style.width = `${dbToPct(f.db)}%`;
  ui.gateMark.style.left = `${dbToPct(20 * Math.log10(va.gate))}%`;
  ui.gateLabel.textContent = `gate: ${toDb(va.gate)} dBFS${va.noiseFloor == null ? " (default)" : ""}`;

  if (phase !== "recording") return; // calibrating: readouts only
  recent.push(f);
  while (recent.length && recent[0].t < f.t - TRACE_SECONDS) recent.shift();
  if (f.f1 && f.f2) trail.push(f);
  while (trail.length && trail[0].t < f.t - 0.4) trail.shift();

  ui.frames.textContent = va.frames.length.toLocaleString();
  ui.duration.textContent = `${f.t.toFixed(1)} s`;
  if (va.frames.length % 10 === 0) ui.lastFrame.textContent = JSON.stringify(f, null, 2);
  queueDraw();
}

// ---------- drawing ----------
function queueDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    drawTrace();
    drawVowels();
  });
}
ui.ref.addEventListener("change", queueDraw);
window.addEventListener("resize", queueDraw);

function currentFrames() {
  if (phase === "recording") return va?.frames ?? [];
  return take?.frames ?? [];
}

function drawVowels() {
  const frames = currentFrames();
  drawVowelChart(ui.vowel, { cloud: frames, trail, ref: pickReference(frames, ui.ref.value) });
  ui.vowelCount.textContent = countVowelFrames(frames).toLocaleString();
}

// Pitch on a log scale (60–800 Hz), so equal musical intervals look equal.
// While recording: the last 8 seconds. Afterwards: the whole recording.
function drawTrace() {
  const live = phase === "recording";
  const frames = live ? recent : take?.frames ?? [];
  ui.traceLabel.textContent = live || !take ? `Pitch trace (last ${TRACE_SECONDS} s)` : "Pitch over the whole recording";

  const c = ui.trace;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue("--muted").trim();
  const line = css.getPropertyValue("--line").trim();
  const accent = css.getPropertyValue("--accent").trim();

  const lo = Math.log(60), hi = Math.log(800);
  const y = (hz) => h - ((Math.log(hz) - lo) / (hi - lo)) * (h - 16) - 8;

  g.font = "11px system-ui, sans-serif";
  g.textBaseline = "middle";
  g.lineWidth = 1;
  for (const hz of [100, 200, 400]) {
    g.strokeStyle = line; g.beginPath(); g.moveTo(0, y(hz)); g.lineTo(w, y(hz)); g.stroke();
    g.fillStyle = muted; g.fillText(`${hz} Hz`, 6, y(hz) - 8);
  }
  if (!frames.length) return;

  const tEnd = frames[frames.length - 1].t;
  const tStart = live ? tEnd - TRACE_SECONDS : frames[0].t;
  const span = Math.max(tEnd - tStart, 0.001);
  const x = (t) => ((t - tStart) / span) * w;

  g.strokeStyle = accent;
  g.lineWidth = live ? 2.5 : 2;
  g.lineJoin = g.lineCap = "round";
  g.beginPath();
  let pen = false;
  for (const f of frames) {
    if (f.pitch && f.pitch >= 60 && f.pitch <= 800) {
      pen ? g.lineTo(x(f.t), y(f.pitch)) : g.moveTo(x(f.t), y(f.pitch));
      pen = true;
    } else pen = false; // gaps where pitch is unreliable or silent
  }
  g.stroke();
}

// ---------- accent ----------
const inBrowser = ACCENT_MODE !== "server";

function warmUpModel() {
  if (inBrowser) loadAccentModel(modelProgress).catch(() => {}); // errors are reported when analyzing
}
function modelProgress(fraction, message) {
  ui.modelStatus.hidden = false;
  ui.modelStatus.textContent = message;
  if (fraction === 1) setTimeout(() => (ui.modelStatus.hidden = true), 1500);
}

async function classifyAccent(pcm) {
  const clip = pcm.subarray(0, ACCENT_SECONDS * RATE);
  const seconds = clip.length / RATE;
  let result;
  if (inBrowser) {
    const model = await loadAccentModel(modelProgress);
    setStatus(`Checking accent on ${seconds.toFixed(1)} seconds of speech…`);
    await new Promise((r) => setTimeout(r, 30)); // let the status message paint
    result = await model.classify(clip);
  } else {
    setStatus(`Sending ${seconds.toFixed(1)} seconds of speech to the accent server…`);
    const form = new FormData();
    form.append("audio", encodeWav(clip, RATE), "clip.wav");
    const r = await fetch(`${ACCENT_SERVER.replace(/\/+$/, "")}/classify`, { method: "POST", body: form });
    result = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(result.detail || `Server error ${r.status}`);
  }
  return { ...result, seconds: round2(seconds), trimmed: pcm.length > clip.length };
}

function renderAccent() {
  const r = take?.accent;
  if (!r) return;
  ui.accentEmpty.hidden = true;
  ui.accentResult.hidden = false;
  ui.top.textContent = `Closest match: ${r.top.name} (${pct(r.top.score)})`;
  const second = r.results[1];
  ui.meta.textContent = `Next: ${second.name} (${pct(second.score)}). Based on ${r.seconds} s of audio` +
    (r.trimmed ? ` (the first ${ACCENT_SECONDS} s)` : "") + ".";
  ui.bars.innerHTML = "";
  (showAll ? r.results : r.results.slice(0, SHOW_TOP)).forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "bar-row" + (i === 0 ? " top" : "");
    row.innerHTML = `<span class="name"></span><div class="bar-track"><div class="bar-fill"></div></div><span class="pct"></span>`;
    row.querySelector(".name").textContent = item.name;
    row.querySelector(".name").title = item.name;
    row.querySelector(".bar-fill").style.width = `${Math.max(item.score * 100, 0.5)}%`;
    row.querySelector(".pct").textContent = pct(item.score);
    ui.bars.appendChild(row);
  });
  ui.more.textContent = showAll ? `Show top ${SHOW_TOP}` : `Show all ${r.results.length}`;
}
ui.more.addEventListener("click", () => { showAll = !showAll; renderAccent(); });

// ---------- downloads ----------
ui.json.addEventListener("click", () => {
  const { frames, wav, accent, ...meta } = take;
  const ref = pickReference(frames, ui.ref.value);
  const data = {
    meta: { ...meta, hopMs: meta.settings?.hopMs ?? 25 },
    summary: {
      pitchHz: median(frames.map((f) => f.pitch).filter(Boolean)),
      loudnessDb: median(frames.filter((f) => f.active).map((f) => f.db)),
      brightnessHz: median(frames.map((f) => f.centroidHz).filter(Boolean)),
      voicedFrames: frames.filter((f) => f.pitch).length,
      vowelFrames: countVowelFrames(frames),
      vowelReference: ref ? { source: "Peterson & Barney (1952)", voice: ref === "m" ? "lower" : "higher" } : null,
    },
    accent,
    frames,
  };
  download(new Blob([JSON.stringify(data)], { type: "application/json" }), "json");
});
ui.csv.addEventListener("click", () => download(new Blob([framesToCSV(take.frames)], { type: "text/csv" }), "csv"));
ui.wav.addEventListener("click", () => download(take.wav, "wav"));

function download(blob, ext) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `voice-data-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- helpers ----------
const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
function noteName(hz) {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return NOTES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const round2 = (x) => Math.round(x * 100) / 100;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const pct = (x) => (x >= 0.995 ? "99%+" : x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`);
const toDb = (rms) => (rms > 0 ? (20 * Math.log10(rms)).toFixed(0) : "-∞");
const dbToPct = (db) => Math.max(0, Math.min(100, ((db + 80) / 80) * 100));

function friendlyError(err) {
  if (err.name === "NotAllowedError") return "Microphone permission was denied. Allow it in your browser's site settings and try again.";
  if (err.name === "NotFoundError") return "No microphone found.";
  if (!window.isSecureContext) return "The microphone needs HTTPS (or localhost).";
  return `Couldn't start: ${err.message}`;
}

setPhase("idle");
queueDraw();
