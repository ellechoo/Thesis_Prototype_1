// quality.js — a gentle check of a recording before it's added to the archive.
// It only looks for recordings that very clearly won't work: (almost) no voice, a voice too quiet to measure, so much
// background noise that the voice is buried, or something that obviously isn't the passage being read (far too short,
// mostly silence, or one steady hum or tone). It never judges how someone speaks: fast or slow, sung, shouted,
// whispered (if it can still be heard) or any accent all pass. Everything it finds is a warning the person can ignore,
// except a recording with no voice in it at all, which can't make a portrait.
// All the limits are in LIMITS, deliberately loose; loosen them further rather than tighten them.

export const LIMITS = {
  noVoiceSeconds: 0.25,   // less voice than this (seconds where a pitch could be heard): nothing to make a portrait from (blocks)
  noVoiceSyllables: 2,    // ...and fewer syllable-like beats than this
  quietDb: -50,           // the voice's loud moments (90th percentile) quieter than this (dBFS): too quiet to measure well
  noisyRoomDb: -36,       // the room, measured during the countdown, louder than this (dBFS): warn before recording
  minVoiceAboveNoiseDb: 8,// the voice less than this far above the background: buried in noise
  fewSyllables: 10,       // the passage has 42 syllables; fewer than this many beats is far too little of it
  mostlySilentShare: 0.12,// less than this share of the recording with any sound in it (when it's longer than 8 s)
  longSeconds: 90,        // the passage takes about 10 s; far longer than this is probably something else
  humSeconds: 3,          // a steady hum or tone: at least this long, ...
  humVoicedShare: 0.93,   // ...almost unbroken (speech and song have unvoiced consonants and breaths), ...
  humSpreadSemitones: 1.2,// ...almost on one pitch, ...
  humMaxBeats: 15,        // ...and without the beat of syllables
};

const pct = (xs, p) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const toDb = (rms) => (rms > 0 ? 20 * Math.log10(rms) : -120);

// Syllable-like beats: peaks in the loudness while there's sound, at least 90 ms apart and standing a few dB above the
// dip before them. A rough count, but even sung or very fast reading of the passage gives far more than LIMITS.fewSyllables.
export function countBeats(frames) {
  if (frames.length < 3) return 0;
  const dt = Math.max(0.005, (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1));
  const db = frames.map((f) => (f.active ? f.db : -120)), sm = db.map((_, i) => (db[Math.max(0, i - 1)] + db[i] + db[Math.min(db.length - 1, i + 1)]) / 3);
  let beats = 0, lastBeat = -1e9, dip = sm[0];
  for (let i = 1; i < sm.length - 1; i++) {
    dip = Math.min(dip, sm[i]);
    if (frames[i].active && sm[i] >= sm[i - 1] && sm[i] > sm[i + 1] && sm[i] - dip >= 3 && (i - lastBeat) * dt >= 0.09) { beats++; lastBeat = i; dip = sm[i]; }
  }
  return beats;
}

/** Before recording: is the room itself very loud? (noiseFloor: the room's level from the countdown, as RMS) */
export function roomIsNoisy(noiseFloor) { return noiseFloor != null && toDb(noiseFloor) > LIMITS.noisyRoomDb; }

/**
 * After recording. frames: the voice frames ({ t, rms, db, active, pitch }); seconds: the recording's length;
 * noiseFloor: the room's level from the countdown (RMS).
 * Returns { block, issues: [{ key, title, text }] } — block only when there's no voice at all.
 */
export function checkTake({ frames, seconds, noiseFloor }) {
  const L = LIMITS, n = frames.length || 1, dt = seconds / n;
  const voiced = frames.filter((f) => f.pitch), active = frames.filter((f) => f.active);
  const voicedSeconds = voiced.length * dt, beats = countBeats(frames);
  const issues = [];
  const add = (key, title, text) => issues.push({ key, title, text });

  // (almost) no voice at all
  // (almost) no voice could be measured: nothing to make a portrait from. Say why, as best we can tell.
  if (voicedSeconds < L.noVoiceSeconds && beats < L.noVoiceSyllables) {
    const peak = Math.max(-120, ...frames.map((f) => f.db));
    const why = roomIsNoisy(noiseFloor)
      ? { key: "none-noisy", title: "There's too much background noise", text: "We couldn't pick out your voice from the sounds around you, so there's nothing to measure. Try somewhere quieter, or hold the microphone closer, then try again." }
      : peak > toDb(noiseFloor || 1e-4) + 6
        ? { key: "none-quiet", title: "Your voice came through too quietly", text: "We could hardly hear you, so there's nothing to measure. Move closer to the microphone or speak up a little, then try again." }
        : { key: "none", title: "We couldn't hear a voice", text: "This recording doesn't seem to have anyone speaking in it, so there's nothing to make a portrait from. Check that the right microphone is on, then try again." };
    return { block: true, issues: [why] };
  }

  // the voice's level (its loud moments) against the room's (measured during the countdown; the recording itself can't
  // tell background from a voice that never pauses, like singing)
  const loud = pct((voiced.length ? voiced : active.length ? active : frames).map((f) => f.rms), 0.9) || 0;
  const background = noiseFloor || 0;
  if (toDb(loud) < L.quietDb) add("quiet", "Your voice came through very quietly", "Try moving closer to the microphone or speaking a little louder.");
  else if (background > 0 && toDb(loud) - toDb(background) < L.minVoiceAboveNoiseDb)
    add("noisy", "There's a lot of background noise", "Your voice is hard to pick out from the sounds around you, so the measurements may be off. A quieter spot helps.");

  // clearly not the passage
  if (beats < L.fewSyllables) add("short", "That seems too short to be the whole passage", "We only caught a few words. Read the whole passage (any way you like), then tap Done.");
  else if (seconds > 8 && active.length / n < L.mostlySilentShare) add("silent", "Most of the recording was silent", "Try again, starting to read soon after Go.");
  else if (seconds > L.longSeconds) add("long", "That was much longer than the passage", "The passage takes about ten seconds. Try reading just the passage, then tap Done.");
  if (voicedSeconds >= L.humSeconds && beats < L.humMaxBeats && voiced.length / Math.max(1, active.length) >= L.humVoicedShare) {
    const p = voiced.map((f) => f.pitch), spread = 12 * Math.log2(pct(p, 0.9) / pct(p, 0.1));
    if (spread < L.humSpreadSemitones) {
      add("hum", "That sounds like one steady hum or tone", "Read the passage out loud (speaking or singing it is fine).");
      issues.splice(issues.findIndex((i) => i.key === "short"), issues.some((i) => i.key === "short") ? 1 : 0); // (the hum says it better)
    }
  }
  return { block: false, issues };
}
