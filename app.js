// app.js — UI wiring for the demo page. The real work is in voice-analyzer.js.
import { VoiceAnalyzer } from "./voice-analyzer.js";

const $ = (id) => document.getElementById(id);
const ui = {
  start: $("startBtn"), calibrate: $("calibrateBtn"), record: $("recordBtn"), clear: $("clearBtn"),
  json: $("jsonBtn"), csv: $("csvBtn"), status: $("status"),
  optFilters: $("optFilters"), optBrowserNS: $("optBrowserNS"),
  pitch: $("rPitch"), note: $("rNote"), db: $("rDb"), centroid: $("rCentroid"), clarity: $("rClarity"),
  frames: $("rFrames"), duration: $("rDuration"),
  meterFill: $("meterFill"), gateMark: $("gateMark"), gateLabel: $("gateLabel"),
  active: $("activeDot"), canvas: $("trace"), lastFrame: $("lastFrame"),
};

let va = null;
let history = [];              // recent frames for the pitch trace
const TRACE_SECONDS = 8;
let drawQueued = false;

function setStatus(msg, isError = false) {
  ui.status.textContent = msg;
  ui.status.classList.toggle("error", isError);
}

function setRunningUI(running) {
  ui.start.textContent = running ? "Stop mic" : "Start mic";
  ui.calibrate.disabled = !running;
  ui.record.disabled = !running;
  ui.optFilters.disabled = running;
  ui.optBrowserNS.disabled = running;
}

function refreshDataButtons() {
  const has = va && va.frames.length > 0;
  ui.json.disabled = ui.csv.disabled = ui.clear.disabled = !has;
}

ui.start.addEventListener("click", async () => {
  if (va?.running) {
    va.stop();
    setRunningUI(false);
    setStatus(`Stopped. ${va.frames.length} frames ready to download.`);
    return;
  }
  const keep = va?.frames ?? [];
  va = new VoiceAnalyzer({
    useFilters: ui.optFilters.checked,
    browserNoiseSuppression: ui.optBrowserNS.checked,
  });
  va.frames = keep; // keep earlier recordings across stop/start
  va.onFrame = handleFrame;
  try {
    setStatus("Asking for microphone…");
    await va.start();
    setRunningUI(true);
    ui.record.textContent = "Pause recording";
    setStatus(`Listening at ${va.sampleRate} Hz. Tip: tap “Calibrate noise” and stay quiet for a moment.`);
  } catch (err) {
    setRunningUI(false);
    setStatus(friendlyError(err), true);
  }
});

ui.calibrate.addEventListener("click", async () => {
  ui.calibrate.disabled = true;
  setStatus("Calibrating… stay quiet for 1.5 seconds.");
  try {
    const { noiseFloor, gate } = await va.calibrate(1500);
    setStatus(`Calibrated. Room noise ${toDb(noiseFloor)} dBFS, gate set at ${toDb(gate)} dBFS.`);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    ui.calibrate.disabled = !va?.running;
  }
});

ui.record.addEventListener("click", () => {
  va.recording = !va.recording;
  ui.record.textContent = va.recording ? "Pause recording" : "Resume recording";
  setStatus(va.recording ? "Recording frames." : "Paused: live readouts continue, nothing is saved.");
});

ui.clear.addEventListener("click", () => {
  va.clear();
  history = [];
  updateCounts();
  refreshDataButtons();
  setStatus("Cleared recorded frames.");
});

ui.json.addEventListener("click", () => download(va.toJSON(), "application/json", "json"));
ui.csv.addEventListener("click", () => download(va.toCSV(), "text/csv", "csv"));

function handleFrame(f) {
  // Readouts
  ui.pitch.textContent = f.pitch ?? "–";
  ui.note.textContent = f.pitch ? noteName(f.pitch) : "–";
  ui.db.textContent = f.db <= -120 ? "–" : f.db.toFixed(0);
  ui.centroid.textContent = f.centroidHz ? Math.round(f.centroidHz) : "–";
  ui.clarity.textContent = f.clarity.toFixed(2);
  ui.active.textContent = f.calibrating ? "calibrating" : f.active ? "sound detected" : "silent";
  ui.active.classList.toggle("on", f.active && !f.calibrating);

  // Level meter: -80 dBFS .. 0 dBFS
  ui.meterFill.style.width = `${dbToPct(f.db)}%`;
  ui.gateMark.style.left = `${dbToPct(20 * Math.log10(va.gate))}%`;
  ui.gateLabel.textContent = `gate: ${toDb(va.gate)} dBFS${va.noiseFloor == null ? " (default)" : ""}`;

  // Trace history
  history.push(f);
  const cutoff = f.t - TRACE_SECONDS;
  while (history.length && history[0].t < cutoff) history.shift();

  updateCounts();
  if (va.frames.length === 1) refreshDataButtons();

  // Show a full frame occasionally (cheap enough every ~10 frames)
  if (history.length % 10 === 0) ui.lastFrame.textContent = JSON.stringify(f, null, 2);

  if (!drawQueued) {
    drawQueued = true;
    requestAnimationFrame(drawTrace);
  }
}

function updateCounts() {
  const n = va?.frames.length ?? 0;
  ui.frames.textContent = n.toLocaleString();
  const last = va?.frames[n - 1];
  ui.duration.textContent = `${(last ? last.t - va.frames[0].t : 0).toFixed(1)} s`;
}

// Pitch trace on a log scale (60–800 Hz), so equal musical intervals look equal.
function drawTrace() {
  drawQueued = false;
  const c = ui.canvas;
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
  for (const hz of [100, 200, 400]) {
    g.strokeStyle = line; g.beginPath(); g.moveTo(0, y(hz)); g.lineTo(w, y(hz)); g.stroke();
    g.fillStyle = muted; g.fillText(`${hz} Hz`, 6, y(hz) - 8);
  }
  if (!history.length) return;

  const tEnd = history[history.length - 1].t;
  const x = (t) => w - ((tEnd - t) / TRACE_SECONDS) * w;

  g.strokeStyle = accent;
  g.lineWidth = 2.5;
  g.lineJoin = g.lineCap = "round";
  g.beginPath();
  let pen = false;
  for (const f of history) {
    if (f.pitch) {
      pen ? g.lineTo(x(f.t), y(f.pitch)) : g.moveTo(x(f.t), y(f.pitch));
      pen = true;
    } else pen = false; // gaps where pitch is unreliable or silent
  }
  g.stroke();
}

function download(text, mime, ext) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `voice-data-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
function noteName(hz) {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return NOTES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}
const toDb = (rms) => (rms > 0 ? (20 * Math.log10(rms)).toFixed(0) : "-∞");
const dbToPct = (db) => Math.max(0, Math.min(100, ((db + 80) / 80) * 100));

function friendlyError(err) {
  if (err.name === "NotAllowedError") return "Microphone permission was denied. Allow it in your browser's site settings and try again.";
  if (err.name === "NotFoundError") return "No microphone found.";
  if (!window.isSecureContext) return "Microphone needs HTTPS (or localhost). See the README.";
  return `Couldn't start: ${err.message}`;
}
