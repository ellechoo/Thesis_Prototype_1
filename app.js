// app.js — the Record page: name → countdown → read the passage → analyze → save → breakdown page.
import { VoiceAnalyzer } from "./voice-analyzer.js";
import { startRecording, resampleTo, encodeWav } from "./recorder.js";
import { computeRhythm } from "./rhythm.js";
import { makePassageTracker, canFollowWords } from "./progress.js?v=8";
import { saveTake, newId, archiveIsShared } from "./store.js";
import {
  RATE, MIN_ACCENT_SECONDS, summarize, drawPitchTrace, warmUpAccentModel, classifyAccent,
  noteName, clock, toDb, dbToPct, round2,
} from "./shared.js";

const COUNTDOWN = 3;             // seconds; the room-noise check runs during it
const CALIBRATE_MS = 1500;
const MAX_TAKE_SECONDS = 120;    // recording stops by itself here
const MIN_TAKE_SECONDS = 1;
const TRACE_SECONDS = 8;

const $ = (id) => document.getElementById(id);
const ui = {
  startCard: $("startCard"), name: $("nameInput"), start: $("startBtn"), nameHint: $("nameHint"),
  countdown: $("countdown"), countNum: $("countNum"), followNote: $("followNote"), status: $("status"),
  session: $("session"), recDot: $("recDot"), timer: $("timer"), done: $("doneBtn"), cancel: $("cancelBtn"),
  pitch: $("rPitch"), note: $("rNote"), db: $("rDb"),
  meterFill: $("meterFill"), gateMark: $("gateMark"), gateLabel: $("gateLabel"), active: $("activeDot"), trace: $("trace"),
  processing: $("processing"), step: $("processingStep"),
  optFilters: $("optFilters"), optBrowserNS: $("optBrowserNS"), archiveNotice: $("archiveNotice"),
};

ui.archiveNotice.textContent = (archiveIsShared
  ? "Your name and the measurements from your recording (pitch, loudness, rhythm, vowels, accent) go into the public archive."
  : "Your name and the measurements from your recording are saved in this browser's archive.") +
  " The recording itself is never saved: you can play it back on your results page, then it's gone.";

let phase = "idle";   // idle | countdown | recording | processing
let va = null, rec = null, tick = null, stopFollowing = null, cancelled = false;
let recent = [];
let drawQueued = false;

const passage = makePassageTracker($("passage"));
const PASSAGE_SYLLABLES = Number($("passage").dataset.syllables) || passage.syllables;
if (!canFollowWords) showFollowNote("Word highlighting isn't available in this browser (try Chrome or Safari). Everything else works.");

try { ui.name.value = localStorage.getItem("voiceName") || ""; } catch {}

function setStatus(msg, isError = false) {
  ui.status.textContent = msg;
  ui.status.classList.toggle("error", isError);
}
function showFollowNote(msg) { ui.followNote.hidden = false; ui.followNote.textContent = msg; }

function setPhase(p) {
  phase = p;
  const busy = p !== "idle";
  ui.name.disabled = ui.start.disabled = busy;
  ui.optFilters.disabled = ui.optBrowserNS.disabled = busy;
  ui.startCard.classList.toggle("dimmed", busy);
  ui.session.hidden = !(p === "countdown" || p === "recording");
  ui.processing.hidden = p !== "processing";
  ui.done.disabled = p !== "recording";
  ui.recDot.classList.toggle("on", p === "recording");
}

function getName() {
  const name = ui.name.value.trim().replace(/\s+/g, " ");
  if (!name) {
    setStatus("Enter a name or nickname first.", true);
    ui.name.focus();
    return null;
  }
  try { localStorage.setItem("voiceName", name); } catch {}
  return name;
}

// ---------- recording ----------
ui.start.addEventListener("click", startSession);
ui.name.addEventListener("keydown", (e) => { if (e.key === "Enter") startSession(); });
ui.done.addEventListener("click", finishRecording);
ui.cancel.addEventListener("click", cancelSession);

async function startSession() {
  if (phase !== "idle") return;
  const name = getName();
  if (!name) return;
  cancelled = false;
  recent = [];
  passage.reset();
  ui.timer.textContent = "0:00";
  setPhase("countdown");
  va = new VoiceAnalyzer({ useFilters: ui.optFilters.checked, browserNoiseSuppression: ui.optBrowserNS.checked });
  va.onFrame = onLiveFrame;
  try {
    setStatus("Asking for the microphone…");
    await va.start();
    warmUpAccentModel(); // start downloading the accent model while they read
    setStatus("Get ready. Stay quiet until it says Go.");
    const quiet = va.calibrate(CALIBRATE_MS); // measure the room during the countdown
    await countdown();
    await quiet;
    if (cancelled) return;
    rec = await startRecording(va.ctx, va.source);
    va.clear();
    va.resetClock();
    passage.start();
    stopFollowing = passage.follow(showFollowNote);
    if (!stopFollowing) passage.reset();
    setPhase("recording");
    setStatus("Read the passage aloud. Tap Done when you finish.");
    tick = setInterval(() => {
      const s = rec.seconds();
      ui.timer.textContent = clock(s);
      if (s >= MAX_TAKE_SECONDS) finishRecording();
    }, 200);
  } catch (err) {
    if (cancelled) return;
    stopMic();
    setPhase("idle");
    setStatus(friendlyError(err), true);
  }
}

async function countdown() {
  ui.countdown.hidden = false;
  for (let n = COUNTDOWN; n > 0; n--) {
    if (cancelled) break;
    showCount(String(n));
    await sleep(1000);
  }
  if (!cancelled) { showCount("Go!"); setTimeout(() => (ui.countdown.hidden = true), 600); }
  else ui.countdown.hidden = true;
}
function showCount(text) {
  ui.countNum.textContent = text;
  ui.countNum.classList.remove("pop");
  void ui.countNum.offsetWidth; // restart the animation
  ui.countNum.classList.add("pop");
}

function cancelSession() {
  cancelled = true;
  stopMic();
  passage.reset();
  ui.countdown.hidden = true;
  setPhase("idle");
  setStatus("Cancelled. Tap Start when you're ready.");
}

async function finishRecording() {
  if (phase !== "recording") return;
  clearInterval(tick);
  const sampleRate = rec.sampleRate;
  const samples = rec.stop();
  rec = null;
  stopFollowing?.(); stopFollowing = null;
  passage.finish();
  const info = { frames: va.frames, sampleRate: va.sampleRate, noiseFloor: va.noiseFloor, gate: va.gate, settings: va.opts };
  stopMic();
  if (samples.length / sampleRate < MIN_TAKE_SECONDS) {
    setPhase("idle");
    setStatus("That was too short. Tap Start and read the passage.", true);
    return;
  }
  await finalize({ ...info, samples, samplesRate: sampleRate, source: "microphone", name: getName() || "Anonymous" });
}

function stopMic() {
  clearInterval(tick);
  stopFollowing?.(); stopFollowing = null;
  try { rec?.stop(); } catch {}
  rec = null;
  va?.stop();
  ui.meterFill.style.width = "0%";
  ui.active.textContent = "idle";
  ui.active.classList.remove("on");
}

// ---------- live display ----------
function onLiveFrame(f) {
  ui.pitch.textContent = f.pitch ? Math.round(f.pitch) : "–";
  ui.note.textContent = f.pitch ? noteName(f.pitch) : "–";
  ui.db.textContent = f.db > -120 ? Math.round(f.db) : "–";
  ui.active.textContent = f.calibrating ? "measuring room" : f.active ? "sound detected" : "silent";
  ui.active.classList.toggle("on", f.active && !f.calibrating);
  ui.meterFill.style.width = `${dbToPct(f.db)}%`;
  ui.gateMark.style.left = `${dbToPct(20 * Math.log10(va.gate))}%`;
  ui.gateLabel.textContent = `gate: ${toDb(va.gate)} dBFS${va.noiseFloor == null ? " (default)" : ""}`;
  if (phase !== "recording") return;
  recent.push(f);
  while (recent.length && recent[0].t < f.t - TRACE_SECONDS) recent.shift();
  if (!drawQueued) {
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; drawPitchTrace(ui.trace, recent, { windowSeconds: TRACE_SECONDS, lineWidth: 2.5 }); });
  }
}

// ---------- analyze, save, go to the breakdown ----------
function step(msg) { ui.step.textContent = msg; }

async function finalize({ frames, samples, samplesRate, sampleRate, noiseFloor, gate, settings, source, name }) {
  setPhase("processing");
  setStatus("");
  const seconds = samples.length / samplesRate;
  const take = {
    id: newId(), name, createdAt: new Date().toISOString(), source, seconds: round2(seconds),
    sampleRate, noiseFloor, gate, settings, passage: source === "microphone" ? $("passage").textContent.trim() : null,
    summary: summarize(frames),
    // the passage's syllable count only applies when someone read it into the mic
    rhythm: computeRhythm(frames, { syllables: source === "microphone" ? PASSAGE_SYLLABLES : null }),
    accent: null, accentNote: null, frames, wav: null,
  };
  try {
    step("Preparing audio…");
    const pcm = await resampleTo(samples, samplesRate, RATE);
    take.wav = encodeWav(pcm, RATE);
    if (seconds < MIN_ACCENT_SECONDS) {
      take.accentNote = `The recording was ${seconds.toFixed(1)} s; the accent check needs at least ${MIN_ACCENT_SECONDS} s.`;
    } else {
      step("Loading the accent model…");
      take.accent = await classifyAccent(pcm, { onProgress: (_, msg) => step(msg), onStatus: step });
    }
  } catch (e) {
    take.accentNote = `The accent check failed: ${e.message}`;
  }
  try {
    step(archiveIsShared ? "Adding to the archive…" : "Saving…");
    const saved = await saveTake(take);
    try {
      sessionStorage.setItem("saveNotice", saved.error
        ? `Couldn't add this to the shared archive (${saved.error}). It's saved on this device only.`
        : "");
    } catch {}
    location.href = `breakdown.html?id=${encodeURIComponent(take.id)}`;
  } catch (e) {
    setPhase("idle");
    setStatus(`Couldn't save the recording: ${e.message}`, true);
  }
}

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function friendlyError(err) {
  if (err.name === "NotAllowedError") return "Microphone permission was denied. Allow it in your browser's site settings and try again.";
  if (err.name === "NotFoundError") return "No microphone found.";
  if (!window.isSecureContext) return "The microphone needs HTTPS (or localhost).";
  return `Couldn't start: ${err.message}`;
}

setPhase("idle");
