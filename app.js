// app.js — the Record page: name → countdown → read the passage → analyze → save → portrait page.
import { VoiceAnalyzer } from "./voice-analyzer.js";
import { startRecording, resampleTo, encodeWav } from "./recorder.js";
import { computeRhythm } from "./rhythm.js";
import { checkTake, roomIsNoisy } from "./quality.js?v=1";
import { nameIsBlocked } from "./name-check.js?v=1";
import { makePassageTracker, canFollowWords } from "./progress.js?v=8";
import { saveTake, newId, archiveIsShared } from "./store.js?v=2";
import {
  RATE, MIN_ACCENT_SECONDS, summarize, drawPitchTrace, warmUpAccentModel, classifyAccent,
  noteName, clock, toDb, dbToPct, round2, describeDevice } from "./shared.js?v=2";

const COUNTDOWN = 3;             // seconds; the room-noise check runs during it
const CALIBRATE_MS = 1500;
const MAX_TAKE_SECONDS = 120;    // recording stops by itself here
const MIN_TAKE_SECONDS = 1;
const MAX_NAME = 24;             // longest name or nickname (characters); the name box has the same limit (record.html)

const $ = (id) => document.getElementById(id);
const ui = {
  startCard: $("startCard"), name: $("nameInput"), start: $("startBtn"), nameHint: $("nameHint"),
  countdown: $("countdown"), countNum: $("countNum"), followNote: $("followNote"), status: $("status"),
  session: $("session"), recDot: $("recDot"), timer: $("timer"), done: $("doneBtn"), cancel: $("cancelBtn"),
  meterFill: $("meterFill"), gateMark: $("gateMark"), active: $("activeDot"),
  processing: $("processing"), step: $("processingStep"),
  review: $("review"), reviewAudio: $("reviewAudio"), reviewNote: $("reviewNote"), use: $("useBtn"), retry: $("retryBtn"), reviewWarn: $("reviewWarn"),
  optFilters: $("optFilters"), optBrowserNS: $("optBrowserNS"), archiveNotice: $("archiveNotice"),
};

ui.archiveNotice.textContent = (archiveIsShared
  ? "Your name and the measurements from your recording (pitch, loudness, rhythm, vowels, accent) go into the public archive."
  : "Your name and the measurements from your recording are saved in this browser's archive.") +
  " The recording itself is never saved.";

let phase = "idle";   // idle | countdown | recording | processing
let va = null, rec = null, tick = null, stopFollowing = null, cancelled = false;
let session = 0; // bumps on every Start, so a cancelled countdown can never carry on behind a new one

const passage = makePassageTracker($("passage"));
const PASSAGE_SYLLABLES = Number($("passage").dataset.syllables) || passage.syllables;
if (!canFollowWords) showFollowNote("Word highlighting isn't available in this browser (try Chrome or Safari). Everything else works.");

// The name field starts empty for each visitor (shared computers). Clear any name an older version remembered.
ui.name.value = "";
try { localStorage.removeItem("voiceName"); } catch {}

function setStatus(msg, isError = false) {
  ui.status.textContent = msg;
  ui.status.classList.toggle("error", isError);
}
function showFollowNote(msg) { ui.followNote.hidden = false; ui.followNote.textContent = msg; }

function setPhase(p) {
  phase = p;
  document.body.dataset.phase = p; // the page's layout follows the phase (see the Record page section in style.css)
  const busy = p !== "idle";
  ui.name.disabled = ui.start.disabled = busy;
  ui.optFilters.disabled = ui.optBrowserNS.disabled = busy;
  ui.startCard.classList.toggle("dimmed", busy);
  // while counting down or recording, Start turns into Cancel (same spot, so an accidental tap is easy to undo)
  const live = p === "countdown" || p === "recording";
  ui.start.hidden = live;
  ui.cancel.hidden = !live;
  ui.done.hidden = !live; // Done sits right under Cancel (enabled once recording starts)
  ui.session.hidden = !(p === "countdown" || p === "recording");
  ui.processing.hidden = p !== "processing";
  ui.review.hidden = p !== "review";
  ui.done.disabled = p !== "recording";
  ui.recDot.classList.toggle("on", p === "recording");
}

function getName() {
  const name = [...ui.name.value.trim().replace(/\s+/g, " ")].slice(0, MAX_NAME).join("").trim(); // (also cut to the limit here, whatever got into the box)
  if (!name) {
    setStatus("Enter a name or nickname first.", true);
    ui.name.focus();
    return null;
  }
  if (nameIsBlocked(name)) { // a slur or swear word as a word of its own (see name-check.js)
    setStatus("Please choose a different name. Names can't include swear words or slurs.", true);
    ui.name.focus();
    return null;
  }
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
  const my = ++session;
  const gone = () => cancelled || my !== session;
  passage.reset();
  ui.timer.textContent = "0:00";
  setPhase("countdown");
  va = new VoiceAnalyzer({ useFilters: ui.optFilters.checked, browserNoiseSuppression: ui.optBrowserNS.checked });
  va.onFrame = onLiveFrame;
  try {
    setStatus("");
    await va.start();
    if (gone()) { if (my === session) stopMic(); return; } // cancelled while the mic was being opened
    warmUpAccentModel(); // start downloading the accent model while they read
    const quiet = va.calibrate(CALIBRATE_MS); // measure the room during the countdown
    await countdown(gone);
    await quiet;
    if (gone()) return;
    // a very loud room: say so (gently) before they read, so they can move somewhere quieter if they like
    if (roomIsNoisy(va.noiseFloor)) setStatus("It's quite noisy where you are. That's okay, but a quieter spot gives a more accurate portrait.");
    rec = await startRecording(va.ctx, va.source);
    va.clear();
    va.resetClock();
    passage.start();
    stopFollowing = passage.follow(showFollowNote);
    if (!stopFollowing) passage.reset();
    setPhase("recording");
    tick = setInterval(() => {
      const s = rec.seconds();
      ui.timer.textContent = clock(s);
      if (s >= MAX_TAKE_SECONDS) finishRecording();
    }, 200);
  } catch (err) {
    if (gone()) return;
    stopMic();
    setPhase("idle");
    setStatus(friendlyError(err), true);
  }
}

// COUNTDOWN SOUND: a soft short beep on 3, 2, 1 and a higher one on Go. The beeps are brief and quiet
// so the room-noise check running at the same time ignores them (it uses the 75th percentile), and
// recording only starts once the Go beep has finished.
function beep(freq, seconds = 0.08, volume = 0.12) {
  const ctx = va?.ctx;
  if (!ctx) return;
  const t = ctx.currentTime, osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(volume, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + seconds + 0.02);
}

async function countdown(gone) {
  ui.countdown.hidden = false;
  for (let n = COUNTDOWN; n > 0; n--) {
    if (gone()) return;
    showCount(String(n));
    beep(660);
    await sleep(1000);
  }
  if (!gone()) {
    showCount("Go!");
    beep(990, 0.16);
    setTimeout(() => { if (!gone()) ui.countdown.hidden = true; }, 600);
    await sleep(200); // let the Go beep finish before recording starts
  }
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
  const info = { frames: va.frames, sampleRate: va.sampleRate, noiseFloor: va.noiseFloor, gate: va.gate, settings: { ...va.opts, device: describeDevice(va.stream) } };
  stopMic();
  if (samples.length / sampleRate < MIN_TAKE_SECONDS) {
    setPhase("idle");
    setStatus("That was too short. Tap Start and read the passage.", true);
    return;
  }
  // a quick check for recordings that clearly won't work (see quality.js): only one with no voice at all is stopped here
  const check = checkTake({ frames: info.frames, seconds: samples.length / sampleRate, noiseFloor: info.noiseFloor });
  if (check.block) {
    setPhase("idle");
    setStatus(`${check.issues[0].title}. ${check.issues[0].text}`, true);
    return;
  }
  review({ ...info, samples, samplesRate: sampleRate, source: "microphone", name: getName() || "Anonymous" }, check.issues);
}

// ---------- review: use this recording, or try again ----------
// The analysis starts in the background while the person listens back, so "Use" is quick.
// Nothing is saved (and nothing reaches the archive) unless they choose "Use this recording".
let pending = null;

// If the check found something, it's listed above the player (what we noticed, and what usually helps); the person can
// still use the recording ("Use it anyway"), but trying again becomes the main button.
function review(info, issues = []) {
  const prepared = prepareTake(info);
  prepared.catch(() => {});
  const url = URL.createObjectURL(encodeWav(info.samples, info.samplesRate));
  ui.reviewAudio.src = url;
  pending = { prepared, url };
  const warn = issues.length > 0;
  ui.reviewWarn.hidden = !warn;
  ui.reviewWarn.innerHTML = warn ? `<p class="warn-title">This recording might not work well</p><ul>${issues.map((i) => `<li><b>${i.title}.</b> ${i.text}</li>`).join("")}</ul>` : "";
  ui.use.textContent = warn ? "Use it anyway" : "Use this recording";
  ui.use.classList.toggle("primary", !warn);
  ui.retry.classList.toggle("primary", warn);
  ui.retry.textContent = warn ? "Record again" : "Try again";
  ui.reviewNote.textContent = `Listen back if you like. Choosing “${ui.use.textContent}” adds your name and voice data to the archive. The recording itself is never kept.`;
  setPhase("review");
  setStatus("");
  (warn ? ui.retry : ui.use).focus();
}

ui.use.addEventListener("click", async () => {
  if (!pending) return;
  const { prepared, url } = pending;
  pending = null;
  ui.reviewAudio.pause();
  setPhase("processing");
  step("Finishing the analysis…");
  let take;
  try { take = await prepared; }
  catch (e) { setPhase("idle"); setStatus(`Couldn't analyze the recording: ${e.message}`, true); return; }
  finally { URL.revokeObjectURL(url); ui.reviewAudio.removeAttribute("src"); }
  await saveAndOpen(take);
});

ui.retry.addEventListener("click", () => {
  if (!pending) return;
  ui.reviewAudio.pause();
  URL.revokeObjectURL(pending.url);
  ui.reviewAudio.removeAttribute("src");
  pending = null; // the recording and its analysis are simply dropped
  setPhase("idle");
  setStatus("");
  startSession();
});

function stopMic() {
  clearInterval(tick);
  stopFollowing?.(); stopFollowing = null;
  try { rec?.stop(); } catch {}
  rec = null;
  va?.stop();
  ui.meterFill.style.width = "0%";
  ui.active.textContent = "";
  ui.active.classList.remove("on");
}

// ---------- live display ----------
function onLiveFrame(f) {
  // only the volume is shown while recording: enough to tell the person they're being heard
  ui.active.textContent = f.calibrating ? "Measuring the room…" : f.active ? "Hearing you" : "Listening…";
  ui.active.classList.toggle("on", f.active && !f.calibrating);
  ui.meterFill.style.width = `${dbToPct(f.db)}%`;
  ui.meterFill.classList.toggle("on", f.active && !f.calibrating);
  ui.gateMark.style.left = `${dbToPct(20 * Math.log10(va.gate))}%`;
}

// SPACE BAR: starts when idle, finishes (same as Done) while recording, cancels during the countdown.
// Ignored while typing in a field (names can have spaces) or when a button has keyboard focus
// (space already presses that button).
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" && e.key !== " ") return;
  const t = e.target;
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (t.closest?.("input, textarea, select, button, audio, summary, a, [contenteditable]")) return;
  try { if (document.querySelector(":popover-open")) return; } catch {} // the "Why this passage?" popup is open
  if (phase === "idle") { e.preventDefault(); startSession(); }
  else if (phase === "recording") { e.preventDefault(); finishRecording(); }
  else if (phase === "countdown") { e.preventDefault(); cancelSession(); }
});

// ---------- analyze, save, go to the portrait ----------
function step(msg) { ui.step.textContent = msg; }

// Measures everything (rhythm, accent, …) without saving. Returns the finished take.
async function prepareTake({ frames, samples, samplesRate, sampleRate, noiseFloor, gate, settings, source, name }) {
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
  return take;
}

// Saves the take (to the archive when it's set up) and opens its portrait.
async function saveAndOpen(take) {
  try {
    step(archiveIsShared ? "Adding to the archive…" : "Saving…");
    const saved = await saveTake(take);
    try {
      sessionStorage.setItem("saveNotice", saved.error
        ? `Couldn't add this to the shared archive (${saved.error}). It's saved on this device only.`
        : "");
    } catch {}
    location.href = `portrait.html?id=${encodeURIComponent(take.id)}`;
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
