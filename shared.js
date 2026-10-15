// shared.js — helpers used by the record, breakdown and archive pages.
import { ACCENT_MODE, ACCENT_SERVER } from "./config.js";
import { loadAccentModel } from "./accent-model.js";
import { encodeWav } from "./recorder.js";

export const RATE = 16000;            // sample rate the accent model expects
export const MIN_ACCENT_SECONDS = 5;  // the accent model needs at least this much
export const ACCENT_SECONDS = 30;     // and uses at most this much

// ---------- numbers ----------
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export function noteName(hz) {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return NOTES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}
export const round2 = (x) => Math.round(x * 100) / 100;
export const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const pct = (x) => (x >= 0.995 ? "99%+" : x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`);
export const toDb = (rms) => (rms > 0 ? (20 * Math.log10(rms)).toFixed(0) : "-∞");
export const dbToPct = (db) => Math.max(0, Math.min(100, ((db + 80) / 80) * 100));

/** Typical values for a whole recording. */
export function summarize(frames) {
  const voiced = frames.filter((f) => f.pitch);
  const active = frames.filter((f) => f.active);
  const pitch = median(voiced.map((f) => f.pitch));
  return {
    pitchHz: pitch && Math.round(pitch),
    note: pitch ? noteName(pitch) : null,
    loudnessDb: median(active.map((f) => f.db)),
    brightnessHz: (() => { const c = median(active.map((f) => f.centroidHz).filter(Boolean)); return c && Math.round(c); })(),
    clarity: median(voiced.map((f) => f.clarity)),
    frames: frames.length,
    voicedFrames: voiced.length,
  };
}

// ---------- pitch trace ----------
/**
 * Pitch on a log scale (60–800 Hz), so equal musical intervals look equal.
 * windowSeconds: show only the last N seconds (live); otherwise the whole recording.
 * pauses: [{start, end}] to shade.
 */
export function drawPitchTrace(canvas, frames, { windowSeconds = null, pauses = [], grid = true, lineWidth = 2 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue("--muted").trim();
  const line = css.getPropertyValue("--line").trim();
  const accent = css.getPropertyValue("--accent").trim();

  const lo = Math.log(60), hi = Math.log(800);
  const pad = grid ? 8 : 4;
  const y = (hz) => h - ((Math.log(hz) - lo) / (hi - lo)) * (h - pad * 2) - pad;

  if (grid) {
    g.font = "11px system-ui, sans-serif";
    g.textBaseline = "middle";
    g.lineWidth = 1;
    for (const hz of [100, 200, 400]) {
      g.strokeStyle = line; g.beginPath(); g.moveTo(0, y(hz)); g.lineTo(w, y(hz)); g.stroke();
      g.fillStyle = muted; g.fillText(`${hz} Hz`, 6, y(hz) - 8);
    }
  }
  if (!frames.length) return;

  const tEnd = frames[frames.length - 1].t;
  const tStart = windowSeconds ? tEnd - windowSeconds : frames[0].t;
  const span = Math.max(tEnd - tStart, 0.001);
  const x = (t) => ((t - tStart) / span) * w;

  if (pauses.length) {
    g.fillStyle = line;
    g.globalAlpha = 0.6;
    for (const p of pauses) g.fillRect(x(p.start), 0, x(p.end) - x(p.start), h);
    g.globalAlpha = 1;
  }

  g.strokeStyle = accent;
  g.lineWidth = lineWidth;
  g.lineJoin = g.lineCap = "round";
  g.beginPath();
  let pen = false;
  for (const f of frames) {
    if (f.t < tStart) continue;
    if (f.pitch && f.pitch >= 60 && f.pitch <= 800) {
      pen ? g.lineTo(x(f.t), y(f.pitch)) : g.moveTo(x(f.t), y(f.pitch));
      pen = true;
    } else pen = false; // gaps where pitch is unreliable or silent
  }
  g.stroke();
}

// ---------- accent ----------
const inBrowser = ACCENT_MODE !== "server";

/** Start downloading the accent model early (browser mode). */
export function warmUpAccentModel(onProgress) {
  if (inBrowser) loadAccentModel(onProgress).catch(() => {}); // errors are reported when analyzing
}

/** pcm: mono 16 kHz samples. Returns the accent result. */
export async function classifyAccent(pcm, { onProgress = () => {}, onStatus = () => {} } = {}) {
  const clip = pcm.subarray(0, ACCENT_SECONDS * RATE);
  const seconds = clip.length / RATE;
  let result;
  if (inBrowser) {
    const model = await loadAccentModel(onProgress);
    onStatus(`Listening for accent in ${seconds.toFixed(1)} seconds of speech…`);
    await new Promise((r) => setTimeout(r, 30)); // let the status message paint
    result = await model.classify(clip);
  } else {
    onStatus(`Sending ${seconds.toFixed(1)} seconds of speech to the accent server…`);
    const form = new FormData();
    form.append("audio", encodeWav(clip, RATE), "clip.wav");
    const r = await fetch(`${ACCENT_SERVER.replace(/\/+$/, "")}/classify`, { method: "POST", body: form });
    result = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(result.detail || `Server error ${r.status}`);
  }
  return { ...result, seconds: round2(seconds), trimmed: pcm.length > clip.length };
}

// ---------- files ----------
export function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const slug = (s) => (s || "voice").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "voice";

export function formatDate(iso) {
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
}
