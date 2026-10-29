// breakdown.js — everything measured from one recording, shown under the portrait on the Portrait page
// (it used to be its own Breakdown page). portrait-3d.js loads the recording and calls renderBreakdown(take).
// Downloads are off for now.
import { forgetLocalAudio, archiveIsShared } from "./store.js?v=2";
import { drawVowelChart, pickReference, countVowelFrames } from "./vowel-chart.js?v=2";
import { traits, timbreWords } from "./voice-orb.js?v=56";
import { drawPitchTrace, pct, ACCENT_SECONDS, deviceText } from "./shared.js?v=3";

const SHOW_TOP = 6;
const $ = (id) => document.getElementById(id);
let take = null, showAll = false;

/** Fill in the data sections for this recording. */
export function renderBreakdown(t) {
  take = t;
  if (!take.frames) take.frames = [];
  const dev = deviceText(take);
  $("deviceNote").hidden = !dev;
  if (dev) $("deviceNote").textContent = `Recorded on: ${dev}`;

  showSaveNotice();
  setUpAudio();

  const s = take.summary;
  $("rPitch").textContent = s.pitchHz ?? "–";
  $("rNote").textContent = s.note ?? "–";
  $("rDb").textContent = s.loudnessDb != null ? Math.round(s.loudnessDb) : "–";
  $("rCentroid").textContent = s.brightnessHz ?? "–";
  $("rClarity").textContent = s.clarity != null ? s.clarity.toFixed(2) : "–";
  $("rFrames").textContent = s.frames.toLocaleString();
  $("rDuration").textContent = `${take.seconds.toFixed(1)} s`;

  renderTimbre(); // first, so a problem elsewhere can't hide it
  renderAccent();
  renderRhythm();
  draw();
  const sample = take.frames.find((f) => f.pitch) ?? take.frames[take.frames.length - 1];
  $("lastFrame").textContent = sample ? JSON.stringify(sample, null, 2) : "No frames.";
}

function showSaveNotice() {
  let msg = "";
  try { msg = sessionStorage.getItem("saveNotice") || ""; sessionStorage.removeItem("saveNotice"); } catch {}
  $("saveNotice").hidden = !msg;
  $("saveNotice").textContent = msg;
}

// The recording itself is never saved. Right after recording, this device still holds it,
// so it plays here once and is then forgotten.
let wavBlob = null;
function setUpAudio() {
  const player = $("player"), note = $("audioNote");
  if (take.wav) {
    wavBlob = take.wav;
    player.src = URL.createObjectURL(take.wav);
    forgetLocalAudio(take.id).catch(() => {});
    note.textContent = "Your recording isn't saved: it plays here until you leave this page. The data from it is kept" +
      (archiveIsShared && take.sharedToArchive ? " in the archive." : ".");
  } else {
    player.hidden = true;
    note.textContent = ""; // (no note: the page already says recordings aren't kept)
  }
}

function draw() {
  drawPitchTrace($("trace"), take.frames, { pauses: take.rhythm?.pauses ?? [] });
  drawVowelChart($("vowelChart"), { cloud: take.frames, ref: pickReference(take.frames, $("refSelect").value) });
  $("vowelCount").textContent = countVowelFrames(take.frames).toLocaleString();
}
$("refSelect").addEventListener("change", () => take && draw());
window.addEventListener("resize", () => take && draw());

function renderAccent() {
  const r = take.accent;
  $("accentEmpty").hidden = !!r;
  $("accentResult").hidden = !r;
  if (!r) { $("accentEmpty").textContent = take.accentNote || "No accent result for this recording."; return; }
  $("topLine").textContent = `Closest match: ${r.top.name} (${pct(r.top.score)})`;
  const second = r.results[1];
  $("resultMeta").textContent = `Next: ${second.name} (${pct(second.score)}). Based on ${r.seconds} s of audio` +
    (r.trimmed ? ` (the first ${ACCENT_SECONDS} s)` : "") + ".";
  const bars = $("bars");
  bars.innerHTML = "";
  (showAll ? r.results : r.results.slice(0, SHOW_TOP)).forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "bar-row" + (i === 0 ? " top" : "");
    row.innerHTML = `<span class="name"></span><div class="bar-track"><div class="bar-fill"></div></div><span class="pct"></span>`;
    row.querySelector(".name").textContent = item.name;
    row.querySelector(".name").title = item.name;
    row.querySelector(".bar-fill").style.width = `${Math.max(item.score * 100, 0.5)}%`;
    row.querySelector(".pct").textContent = pct(item.score);
    bars.appendChild(row);
  });
  $("moreBtn").textContent = showAll ? `Show top ${SHOW_TOP}` : `Show all ${r.results.length}`;
}
$("moreBtn").addEventListener("click", () => { showAll = !showAll; renderAccent(); });

// Timbre: the same three dials (−1 … 1) the portrait uses, each shown as a scale with a typical voice in the middle
function renderTimbre() {
  let tb = null;
  try { tb = traits(take).timbre; } catch (e) { tb = null; }
  const ok = !!tb?.enough;
  $("timbreEmpty").hidden = ok;
  $("timbreResult").hidden = !ok;
  if (!ok) return;
  $("timbreLine").textContent = timbreWords(tb);
  const m = tb.measures || {};
  const rows = [
    { v: tb.bright, lo: "Dark", hi: "Bright", detail: m.centroid ? `${Math.round(m.centroid).toLocaleString()} Hz brightness` : "",
      tip: "Where the energy of the voice sits. Brighter voices carry more high frequencies. In the portrait: bright voices get sun rays, dark voices a swirl." },
    { v: tb.breathy, lo: "Clean", hi: "Breathy", detail: m.flatness != null ? `${(m.flatness * 100).toFixed(1)}% air and noise in the tone` : "",
      tip: "How much air and noise is mixed into the tone. In the portrait: breathy voices get a cloudy, misty edge, clean voices a crisp one." },
    { v: tb.raspy, lo: "Smooth", hi: "Raspy", detail: m.jitter != null ? `${m.jitter.toFixed(1)}% pitch wobble` : "",
      tip: "How much the pitch wobbles from moment to moment. In the portrait: raspy voices grow small spikes, smooth voices turn glossy." },
  ];
  const word = (v, lo, hi) => { const a = Math.abs(v); if (a < 0.2) return "Typical"; return (a >= 0.75 ? "Very " : a >= 0.4 ? "" : "Slightly ") + (v > 0 ? hi.toLowerCase() : lo.toLowerCase()); };
  const box = $("scales");
  box.innerHTML = "";
  for (const r of rows) {
    const el = document.createElement("div");
    el.className = "scale card"; el.tabIndex = 0; el.dataset.tip = r.tip;
    const pos = 50 + 50 * Math.max(-1, Math.min(1, r.v));
    el.innerHTML = `<div class="scale-head"><span class="scale-word"></span><span class="scale-detail"></span></div>
      <div class="scale-track"><span class="scale-mid"></span><span class="scale-fill"></span><span class="scale-dot"></span></div>
      <div class="scale-ends"><span></span><span></span></div>`;
    const w = word(r.v, r.lo, r.hi); el.querySelector(".scale-word").textContent = w[0].toUpperCase() + w.slice(1);
    el.querySelector(".scale-detail").textContent = r.detail;
    el.querySelector(".scale-dot").style.left = `${pos}%`;
    const f = el.querySelector(".scale-fill"); f.style.left = `${Math.min(pos, 50)}%`; f.style.width = `${Math.abs(pos - 50)}%`;
    const ends = el.querySelectorAll(".scale-ends span"); ends[0].textContent = r.lo; ends[1].textContent = r.hi;
    el.setAttribute("aria-label", `${r.lo} to ${r.hi}: ${w}`);
    box.appendChild(el);
    hookTip(el);
  }
}

function renderRhythm() {
  const r = take.rhythm;
  $("rhythmEmpty").hidden = !!r;
  $("rhythmResult").hidden = !r;
  if (!r) return;
  $("rRate").textContent = r.speechRate != null ? r.speechRate.toFixed(1) : "–";
  $("rRateUnit").textContent = r.speechRate != null ? "syllables / s" : "needs the passage read aloud";
  $("rPauses").textContent = r.pauseCount;
  $("rPauseTime").textContent = r.pauseSeconds.toFixed(1);
  $("rPauseShare").textContent = `s (${Math.round(r.pauseShare * 100)}% of the reading)`;
  $("rLongest").textContent = r.pauseCount ? r.longestPause.toFixed(1) : "–";
  $("rTotal").textContent = `${r.totalSeconds.toFixed(1)} s`;
  $("rArtic").textContent = r.articulationRate != null
    ? `The passage has ${r.syllables} syllables. Counting only the time you were talking, it's ${r.articulationRate.toFixed(1)} per second.`
    : "";
  const bar = $("rhythmBar");
  bar.innerHTML = "";
  for (const s of r.segments) {
    if (!s.talking) continue;
    const seg = document.createElement("div");
    seg.className = "seg";
    seg.style.left = `${((s.start - r.start) / r.totalSeconds) * 100}%`;
    seg.style.width = `${((s.end - s.start) / r.totalSeconds) * 100}%`;
    bar.appendChild(seg);
  }
}


// ---------- hover explanations for each measurement ----------
// Every stat card has a data-tip. Hover, tab to it, or tap it on a phone (tap elsewhere to close) to show a small popup.
const tip = $("tip");
let tipFor = null;
function showTip(card) {
  tipFor = card;
  tip.textContent = card.dataset.tip;
  tip.hidden = false;
  const r = card.getBoundingClientRect(), t = tip.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left), window.innerWidth - t.width - 8);
  const below = r.bottom + 8, above = r.top - t.height - 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${below + t.height < window.innerHeight - 8 || above < 8 ? below : above}px`;
}
function hideTip(card) { if (!card || card === tipFor) { tip.hidden = true; tipFor = null; } }
function hookTip(card) {
  if (card._tip) return; card._tip = true;
  card.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") showTip(card); });
  card.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hideTip(card); });
  card.addEventListener("focus", () => showTip(card));
  card.addEventListener("blur", () => hideTip(card));
}
document.querySelectorAll(".card[data-tip]").forEach(hookTip);
window.addEventListener("scroll", () => hideTip(), { passive: true });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(); });
