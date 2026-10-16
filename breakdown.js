// breakdown.js — shows everything measured from one saved recording.
// Opens the recording named by ?id=…, or the most recent one.
import { getTake, latestLocalTake, forgetLocalAudio, archiveIsShared } from "./store.js";
import { framesToCSV } from "./voice-analyzer.js";
import { drawVowelChart, pickReference, countVowelFrames } from "./vowel-chart.js";
import { drawPitchTrace, pct, download, slug, formatDate, ACCENT_SECONDS } from "./shared.js";

const SHOW_TOP = 6;
const $ = (id) => document.getElementById(id);
let take = null, showAll = false;

async function load() {
  const id = new URLSearchParams(location.search).get("id");
  try {
    take = id ? await getTake(id) : await latestLocalTake();
  } catch (e) {
    return showEmpty(`Couldn't open saved recordings in this browser: ${e.message}`);
  }
  if (!take) return showEmpty(id
    ? (archiveIsShared ? "That recording isn't in the archive." : "That recording isn't saved in this browser. Recordings are kept on the device they were made on.")
    : null);
  if (!take.frames) take.frames = [];
  render();
}

function showEmpty(msg) {
  $("empty").hidden = false;
  if (msg) $("emptyText").textContent = msg;
}

function render() {
  $("content").hidden = false;
  document.title = `${take.name}'s voice`;
  $("title").textContent = `${take.name}'s voice`;
  $("subtitle").textContent = `${formatDate(take.createdAt)} · ${take.seconds.toFixed(1)} s` +
    (take.source === "microphone" ? "" : ` · from ${take.source}`);

  $("portraitLink").href = `portrait.html?id=${encodeURIComponent(take.id)}`;
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
    $("wavBtn").hidden = true;
    note.textContent = "The recording itself isn't kept, only the data from it.";
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

// ---------- downloads ----------
const fileBase = () => `${slug(take.name)}-${take.createdAt.slice(0, 19).replace(/[:T]/g, "-")}`;
$("jsonBtn").addEventListener("click", () => {
  const { frames, wav, summary, rhythm, accent, preview, sharedToArchive, ...meta } = take;
  const ref = pickReference(frames, $("refSelect").value);
  const data = {
    meta,
    summary: {
      ...summary,
      vowelFrames: countVowelFrames(frames),
      vowelReference: ref ? { source: "Peterson & Barney (1952)", voice: ref === "m" ? "lower" : "higher" } : null,
    },
    rhythm, accent, frames,
  };
  download(new Blob([JSON.stringify(data)], { type: "application/json" }), `${fileBase()}.json`);
});
$("csvBtn").addEventListener("click", () => download(new Blob([framesToCSV(take.frames)], { type: "text/csv" }), `${fileBase()}.csv`));
$("wavBtn").addEventListener("click", () => {
  try {
    if (wavBlob) download(wavBlob, `${fileBase()}.wav`);
  } catch (e) { alert(`Couldn't download the recording: ${e.message}`); }
});

load();
