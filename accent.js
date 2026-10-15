// accent.js — record a passage, find the closest accent groups, show the results.
// Runs the model in the browser (accent-model.js) or on a server, depending on config.js.
import { VoiceAnalyzer } from "./voice-analyzer.js";
import { startRecording, resampleTo, decodeFile, encodeWav } from "./recorder.js";
import { ACCENT_SERVER, ACCENT_MODE } from "./config.js";
import { loadAccentModel } from "./accent-model.js";

const MIN_SECONDS = 5;
const MAX_SECONDS = 30;
const RATE = 16000;
const SHOW_TOP = 6;

const $ = (id) => document.getElementById(id);
const ui = {
  url: $("serverUrl"), check: $("checkBtn"), serverStatus: $("serverStatus"),
  rec: $("recBtn"), timer: $("timer"), file: $("fileInput"), meter: $("meterFill"), status: $("status"),
  results: $("resultsSection"), top: $("topLine"), meta: $("resultMeta"), bars: $("bars"),
  more: $("moreBtn"), json: $("jsonBtn"), wav: $("wavBtn"),
};

let va = null, rec = null, tick = null;
let lastWav = null, lastResult = null, showAll = false;
const inBrowser = ACCENT_MODE !== "server";
$("serverBox").hidden = inBrowser;
$("modelNote").hidden = !inBrowser;

// Start downloading the model (in browser mode) without waiting for it.
function warmUp() {
  if (!inBrowser) return;
  loadAccentModel(progress).catch(() => {}); // errors are reported when analyzing
}
let recordingNow = false;
function progress(fraction, message) {
  if (!recordingNow) setStatus(message);
}

// ---- server address (remembered in this browser) ----
ui.url.value = load("accentServer") || ACCENT_SERVER;
ui.url.addEventListener("change", () => save("accentServer", ui.url.value.trim()));
const server = () => ui.url.value.trim().replace(/\/+$/, "");

function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
function save(k, v) { try { localStorage.setItem(k, v); } catch {} }

function setStatus(msg, isError = false) {
  ui.status.textContent = msg;
  ui.status.classList.toggle("error", isError);
}

ui.check.addEventListener("click", checkServer);
async function checkServer() {
  ui.serverStatus.textContent = "Checking… (a sleeping free server can take up to a minute to wake)";
  try {
    const r = await fetchWithTimeout(`${server()}/health`, {}, 90000);
    const h = await r.json();
    if (h.ok) ui.serverStatus.textContent = `Connected. Model: ${h.model}, ${h.labels.length} accent groups.`;
    else ui.serverStatus.textContent = h.error ? `Server is up but the model failed to load: ${h.error}` : "Server is up, model still loading. Try again shortly.";
    return h.ok;
  } catch (e) {
    ui.serverStatus.textContent = unreachableMessage(e);
    return false;
  }
}

// Plain-language explanation for the usual reasons the server can't be reached.
function unreachableMessage(e) {
  if (e.name === "AbortError") return `The server at ${server()} didn't answer in time. If it's a free Hugging Face Space, it may still be waking up. Try again in a minute.`;
  const local = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(server());
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  if (local && location.protocol === "https:" && isSafari)
    return "Safari won't let an https:// website talk to a server on your own computer. Open this page in Chrome, or open the site from your computer (http://localhost) instead.";
  if (local)
    return `Couldn't reach the accent server on this computer (${server()}). Make sure the terminal running "uvicorn app:app --port 7860" is still open, and that you're using the same computer. Accent server not set up yet? See accent-server/README.md.`;
  return `Couldn't reach ${server()}. Check the address, and that the server is running.`;
}

// ---- recording ----
ui.rec.addEventListener("click", async () => {
  if (rec) return finishRecording();
  try {
    va = new VoiceAnalyzer({ useFilters: false });
    va.recording = false;
    va.onFrame = (f) => (ui.meter.style.width = `${Math.max(0, Math.min(100, ((f.db + 70) / 70) * 100))}%`);
    await va.start();
    rec = await startRecording(va.ctx, va.source);
    recordingNow = true;
    warmUp();
    ui.rec.textContent = "Stop and analyze";
    ui.file.disabled = true;
    setStatus("Recording… read the passage.");
    tick = setInterval(() => {
      const s = rec.seconds();
      ui.timer.textContent = `0:${String(Math.floor(s)).padStart(2, "0")}`;
      if (s >= MAX_SECONDS) finishRecording();
    }, 200);
  } catch (err) {
    cleanup();
    setStatus(err.name === "NotAllowedError" ? "Microphone permission was denied." : `Couldn't start: ${err.message}`, true);
  }
});

async function finishRecording() {
  const r = rec;
  const sr = r.sampleRate;
  const samples = r.stop();
  cleanup();
  if (samples.length / sr < MIN_SECONDS) {
    setStatus(`That was only ${(samples.length / sr).toFixed(1)} seconds. Read a bit more of the passage (at least ${MIN_SECONDS} s).`, true);
    return;
  }
  await analyze(samples, sr, "microphone");
}

function cleanup() {
  recordingNow = false;
  clearInterval(tick);
  rec = null;
  va?.stop();
  ui.rec.textContent = "Start recording";
  ui.file.disabled = false;
  ui.meter.style.width = "0%";
}

ui.file.addEventListener("change", async () => {
  const f = ui.file.files[0];
  if (!f) return;
  try {
    setStatus(`Reading ${f.name}…`);
    const { samples, sampleRate } = await decodeFile(f);
    await analyze(samples.subarray(0, Math.round(MAX_SECONDS * sampleRate)), sampleRate, f.name);
  } catch (e) {
    setStatus(`Couldn't read that file: ${e.message}`, true);
  } finally {
    ui.file.value = "";
  }
});

// ---- analyze ----
async function analyze(samples, sampleRate, sourceName) {
  setStatus("Preparing audio…");
  const pcm = await resampleTo(samples, sampleRate, RATE);
  lastWav = encodeWav(pcm, RATE);
  ui.rec.disabled = true;
  ui.file.disabled = true;
  try {
    const result = inBrowser ? await analyzeHere(pcm) : await analyzeOnServer(lastWav, pcm.length);
    lastResult = {
      ...result,
      seconds: result.seconds ?? Math.round((Math.min(pcm.length, MAX_SECONDS * RATE) / RATE) * 100) / 100,
      trimmed: result.trimmed ?? pcm.length > MAX_SECONDS * RATE,
      source: sourceName,
      createdAt: new Date().toISOString(),
    };
    showAll = false;
    renderResult();
    setStatus("Done. Read it again to see how consistent the result is.");
  } catch (e) {
    const network = !inBrowser && (e.name === "AbortError" || e instanceof TypeError); // fetch failures are TypeErrors
    setStatus(network ? unreachableMessage(e) : e.message, true);
  } finally {
    ui.rec.disabled = false;
    ui.file.disabled = false;
  }
}

async function analyzeHere(pcm) {
  const model = await loadAccentModel(progress);
  setStatus(`Analyzing ${(pcm.length / RATE).toFixed(1)} seconds of speech on this device…`);
  await new Promise((r) => setTimeout(r, 30)); // let the status message paint
  return model.classify(pcm.subarray(0, MAX_SECONDS * RATE));
}

async function analyzeOnServer(wav, length) {
  setStatus(`Analyzing ${(length / RATE).toFixed(1)} seconds of speech… (the first request to a sleeping server can take a minute)`);
  const form = new FormData();
  form.append("audio", wav, "clip.wav");
  const r = await fetchWithTimeout(`${server()}/classify`, { method: "POST", body: form }, 180000);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail || `Server error ${r.status}`);
  return body;
}

function renderResult() {
  const r = lastResult;
  ui.results.hidden = false;
  ui.top.textContent = `Closest match: ${r.top.name} (${pct(r.top.score)})`;
  const second = r.results[1];
  ui.meta.textContent =
    `Next: ${second.name} (${pct(second.score)}). Based on ${r.seconds} s of audio` +
    (r.trimmed ? " (trimmed to 30 s)" : "") + `, model “${r.model}”.`;
  ui.bars.innerHTML = "";
  const list = showAll ? r.results : r.results.slice(0, SHOW_TOP);
  list.forEach((item, i) => {
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

const pct = (x) => (x >= 0.995 ? "99%+" : x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`);

ui.more.addEventListener("click", () => { showAll = !showAll; renderResult(); });
ui.json.addEventListener("click", () => download(new Blob([JSON.stringify(lastResult, null, 2)], { type: "application/json" }), "json"));
ui.wav.addEventListener("click", () => download(lastWav, "wav"));

function download(blob, ext) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `accent-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}
