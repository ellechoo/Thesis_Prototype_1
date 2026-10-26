// id-card.js — a voice ID card for one archived voice (archive.html?id=…).
// The voice portrait is the ID photo; the fields summarize the voice in words and numbers;
// the "signature" is the voice's own pitch line; the bottom has a passport-style code line.
// Every value comes from the stored measurements, so cards always match the data.
import { snapshot } from "./orb-snapshot.js?v=30";
import { formatDate, pct, deviceText } from "./shared.js?v=2";
import { makePreview } from "./store.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- words for the numbers (tweak the thresholds here) ----------
const WORDS = {
  pitch: (hz) => (hz < 140 ? "Low" : hz < 210 ? "Middle" : "High"),
  range: (st) => (st < 3 ? "Even" : st < 6 ? "Lilting" : "Expressive"),          // semitones between the 10th and 90th percentile
  tone: (hz) => (hz < 1500 ? "Mellow" : hz < 2500 ? "Balanced" : "Bright"),       // spectral centroid
  steadiness: (c) => (c >= 0.97 ? "Steady" : c >= 0.93 ? "Mostly steady" : "Breathy"),
  volume: (db) => (db > -20 ? "Strong" : db > -30 ? "Moderate" : "Soft"),
  pace: (r) => (r < 3.8 ? "Unhurried" : r <= 5 ? "Even" : "Quick"),             // syllables per second
};

/** All the card's values, worked out from one take. */
export function cardFields(take) {
  const s = take.summary || {}, r = take.rhythm || {};
  const voiced = (take.frames || []).map((f) => f.pitch).filter(Boolean).sort((a, b) => a - b);
  const q = (p) => voiced[Math.min(voiced.length - 1, Math.floor(voiced.length * p))];
  const rangeSt = voiced.length > 10 ? 12 * Math.log2(q(0.9) / q(0.1)) : null;
  const f = [];
  if (s.pitchHz) f.push(["Pitch", WORDS.pitch(s.pitchHz), `${s.pitchHz} Hz · ${s.note}`]);
  if (rangeSt != null) f.push(["Melody", WORDS.range(rangeSt), `${rangeSt.toFixed(1)} semitone range`]);
  if (s.brightnessHz) f.push(["Tone", WORDS.tone(s.brightnessHz), `${s.brightnessHz} Hz brightness`]);
  if (s.clarity != null) f.push(["Steadiness", WORDS.steadiness(s.clarity), `${s.clarity.toFixed(2)} pitch confidence`]);
  if (s.loudnessDb != null) f.push(["Volume", WORDS.volume(s.loudnessDb), `${Math.round(s.loudnessDb)} dBFS`]);
  if (r.speechRate != null) f.push(["Pace", WORDS.pace(r.speechRate), `${r.speechRate.toFixed(1)} syllables / s`]);
  if (r.pauseCount != null) f.push(["Pauses", String(r.pauseCount), r.pauseCount ? `longest ${r.longestPause.toFixed(1)} s` : "none longer than 0.2 s"]);
  f.push(["Accent", take.accent ? take.accent.top.name : "Not measured", take.accent ? `${pct(take.accent.top.score)} closest match` : ""]);
  return f;
}

/** "VP-3F9A-21C4" from the take's id */
export function cardNumber(id) {
  const h = String(id).replace(/[^0-9a-f]/gi, "").toUpperCase().padEnd(8, "0");
  return `VP-${h.slice(0, 4)}-${h.slice(4, 8)}`;
}

// the voice's pitch over time, as a smooth hand-drawn-looking line
function signaturePath(take, w = 600, h = 70) {
  const pts = (take.preview?.length ? take.preview : makePreview(take.frames || [])).filter((p) => p[1]);
  if (pts.length < 3) return "";
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || 1;
  const lo = Math.log(Math.min(...pts.map((p) => p[1])) * 0.92), hi = Math.log(Math.max(...pts.map((p) => p[1])) * 1.08);
  const xy = pts.map(([t, hz]) => [((t - t0) / (t1 - t0 || 1)) * w, h - ((Math.log(hz) - lo) / (hi - lo || 1)) * h]);
  let d = `M${xy[0][0].toFixed(1)} ${xy[0][1].toFixed(1)}`;
  for (let i = 1; i < xy.length; i++) { // Catmull-Rom → cubic Bézier, for a flowing line
    const p0 = xy[i - 2] || xy[i - 1], p1 = xy[i - 1], p2 = xy[i], p3 = xy[i + 1] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

// passport-style code lines (44 characters each)
function codeLines(take) {
  const clean = (s) => String(s).toUpperCase().normalize("NFD").replace(/[^A-Z0-9]+/g, "<").replace(/^<+|<+$/g, "");
  const pad = (s) => (s + "<".repeat(44)).slice(0, 44);
  const s = take.summary || {}, r = take.rhythm || {};
  const l1 = pad(`VP<VOICEPRINT<<${clean(take.name || "ANONYMOUS")}`);
  const l2 = pad([cardNumber(take.id).replace(/-/g, ""), s.pitchHz ? `${s.pitchHz}HZ` : "", s.note ? clean(s.note.replace("♯", "S")) : "",
    r.speechRate != null ? `${String(r.speechRate.toFixed(1)).replace(".", "")}SPS` : "", take.accent ? clean(take.accent.top.label || take.accent.top.name).slice(0, 10) : ""]
    .filter(Boolean).join("<"));
  return [l1, l2];
}

/** Fill the #idView section with this take's card. */
export function renderIdCard(root, take) {
  const { url, color } = snapshot(take, 640);
  const fields = cardFields(take);
  const [l1, l2] = codeLines(take);
  const q = `?id=${encodeURIComponent(take.id)}`;
  root.style.setProperty("--id-hue", color);
  root.innerHTML = `
    <article class="id-card" aria-label="${esc(take.name)}'s voice ID card">
      <header class="id-top">
        <p class="id-brand">Voiceprint</p>
        <p class="id-kind">Voice Identity Card</p>
        <a class="id-close" href="archive.html" aria-label="Close and go back to the archive">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </a>
      </header>
      <div class="id-body">
        <a class="id-photo" href="portrait.html${q}" aria-label="Open ${esc(take.name)}'s full portrait"><img src="${url}" alt="" draggable="false" /></a>
        <div class="id-info">
          <h1 class="id-name">${esc(take.name)}</h1>
          <p class="id-meta"><span>No. ${cardNumber(take.id)}</span><span>Issued ${esc(formatDate(take.createdAt))}</span>${deviceText(take) ? `<span>Recorded on: ${esc(deviceText(take))}</span>` : ""}</p>
          <dl class="id-fields">
            ${fields.map(([k, v, d]) => `<div class="id-field"><dt>${esc(k)}</dt><dd><span class="id-value">${esc(v)}</span><span class="id-detail">${esc(d)}</span></dd></div>`).join("")}
          </dl>
          <div class="id-sign">
            <svg viewBox="0 0 600 70" preserveAspectRatio="none" aria-hidden="true"><path d="${signaturePath(take)}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>
            <p>Voice signature: this voice's pitch, start to finish</p>
          </div>
        </div>
      </div>
      <p class="id-code" aria-hidden="true"><span>${esc(l1)}</span><span>${esc(l2)}</span></p>
    </article>`;
}
