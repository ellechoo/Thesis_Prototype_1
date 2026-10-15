// rhythm.js — pauses and speaking rate from voice frames.
// Uses each frame's `active` flag (above the noise gate). Leading and trailing
// silence is ignored. Gaps shorter than MIN_PAUSE are treated as part of speech,
// because consonants like "t" and "k" make tiny silences that aren't real pauses.

const MIN_PAUSE = 0.2;  // seconds of silence that count as a pause
const MIN_BLIP = 0.06;  // a sound shorter than this inside a pause (a click) is ignored

/**
 * frames: voice frames ({ t, active }) in time order.
 * syllables: syllables in the text that was read (null if unknown, e.g. an uploaded file).
 */
export function computeRhythm(frames, { syllables = null } = {}) {
  if (frames.length < 2) return null;
  const dt = medianStep(frames);

  // runs of sound / silence: [{ on, start, end }]
  let runs = [];
  for (const f of frames) {
    const last = runs[runs.length - 1];
    if (last && last.on === f.active) last.end = f.t;
    else runs.push({ on: f.active, start: f.t, end: f.t });
  }
  const len = (r) => r.end - r.start + dt;
  runs = merge(runs.map((r) => (r.on && len(r) < MIN_BLIP ? { ...r, on: false } : r)));
  runs = merge(runs.map((r, i) => (!r.on && len(r) < MIN_PAUSE && i > 0 && i < runs.length - 1 ? { ...r, on: true } : r)));

  // keep from the first sound to the last
  while (runs.length && !runs[0].on) runs.shift();
  while (runs.length && !runs[runs.length - 1].on) runs.pop();
  if (!runs.length) return null;

  const start = runs[0].start;
  const end = runs[runs.length - 1].end + dt;
  const totalSeconds = end - start;
  const pauses = runs.filter((r) => !r.on).map((r) => ({ start: r1(r.start), end: r1(r.end + dt), seconds: r2(len(r)) }));
  const pauseSeconds = pauses.reduce((a, p) => a + p.seconds, 0);
  const speakingSeconds = totalSeconds - pauseSeconds;

  return {
    start: r1(start),
    end: r1(end),
    totalSeconds: r2(totalSeconds),
    speakingSeconds: r2(speakingSeconds),
    pauseSeconds: r2(pauseSeconds),
    pauseShare: r2(pauseSeconds / totalSeconds),
    pauseCount: pauses.length,
    longestPause: pauses.length ? Math.max(...pauses.map((p) => p.seconds)) : 0,
    syllables,
    // syllables per second, counting pauses (overall pace)
    speechRate: syllables ? r2(syllables / totalSeconds) : null,
    // syllables per second, counting only time spent talking (how fast the words themselves are said)
    articulationRate: syllables ? r2(syllables / speakingSeconds) : null,
    minPauseSeconds: MIN_PAUSE,
    segments: runs.map((r) => ({ talking: r.on, start: r1(r.start), end: r1(r.end + dt) })),
    pauses,
  };
}

function merge(runs) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.on === r.on) last.end = r.end;
    else out.push({ ...r });
  }
  return out;
}

function medianStep(frames) {
  const d = [];
  for (let i = 1; i < Math.min(frames.length, 200); i++) d.push(frames[i].t - frames[i - 1].t);
  d.sort((a, b) => a - b);
  return d[d.length >> 1] || 0.025;
}

const r1 = (x) => Math.round(x * 1000) / 1000;
const r2 = (x) => Math.round(x * 100) / 100;
