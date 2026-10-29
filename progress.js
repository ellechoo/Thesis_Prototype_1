// progress.js — lights up the passage word by word as it's read aloud.
// Uses the browser's built-in speech recognition (Web Speech API) to hear the words.
// Only the highlighting uses it; every measurement still runs on this device.
// In Chrome, the recognizer sends audio to Google; Safari can run it on the device.
// When recognition isn't available or hears nothing (common on phones, where it can't share the microphone with the
// recording), the highlight follows the voice itself instead: each syllable-like beat in the loudness moves it on by
// one syllable of the passage (see hear()). Rougher than recognition, but it keeps up with the reader.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canFollowWords = !!Recognition;

const LOOKAHEAD = 4; // how many passage words a heard word may skip ahead to find its match
const FALLBACK_AFTER = 2.5; // seconds of voice with no words from recognition before following the beats instead
const BEATS_TO_SYLLABLES = 1.25; // the beat count runs about 20% under the true syllables (checked on archive readings), so it's scaled up

/** Rough English syllable count for one word (used for speaking rate). */
export function syllablesIn(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  let n = (w.match(/[aeiouy]+/g) || []).length;
  if (n > 1 && w.endsWith("e") && !/[^aeiouy]le$/.test(w) && !w.endsWith("ee")) n -= 1; // silent e
  return Math.max(1, n);
}

const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Wraps each word of `el` in a span. Returns { syllables, start(), reset(), finish(), follow() }. */
export function makePassageTracker(el) {
  const text = el.textContent.trim().replace(/\s+/g, " ");
  el.textContent = "";
  const words = text.split(" ").map((token, i) => {
    if (i) el.appendChild(document.createTextNode(" "));
    const span = document.createElement("span");
    span.className = "w";
    span.textContent = token;
    el.appendChild(span);
    return { span, key: norm(token) };
  });
  const syllables = words.reduce((a, w) => a + syllablesIn(w.span.textContent), 0);

  // syllables up to the end of each word, for following the beats
  const ends = []; words.reduce((a, w) => (ends.push(a + syllablesIn(w.span.textContent)), ends[ends.length - 1]), 0);

  let reached = 0, active = false;
  // the beat follower's state
  let beats = 0, last = [], dip = Infinity, lastBeat = -1, voiceFrom = null, gotWords = false, byBeats = false;
  const resetBeats = () => { beats = 0; last = []; dip = Infinity; lastBeat = -1; voiceFrom = null; gotWords = false; byBeats = false; };
  function show() {
    words.forEach((w, i) => {
      w.span.classList.toggle("done", active && i < reached);
      w.span.classList.toggle("current", active && i === reached);
    });
  }

  // Line up what was heard with the passage, in order, forgiving misheard or skipped words.
  function progressFor(heard) {
    let p = 0;
    for (let i = 0; i < heard.length && p < words.length; i++) {
      const h = heard[i], h2 = h + (heard[i + 1] ?? ""); // "mo mo" → "momo"
      for (let j = p; j < Math.min(words.length, p + LOOKAHEAD); j++) {
        const k = words[j].key;
        if (similar(h, k)) { p = j + 1; break; }
        if (h2 === k || similar(h2, k)) { p = j + 1; i++; break; }
      }
    }
    return p;
  }

  return {
    syllables,
    /** Clear all highlighting. */
    reset() { reached = 0; active = false; resetBeats(); show(); },
    /** Recording has begun: point at the first word. */
    start() { reached = 0; active = true; resetBeats(); show(); },
    /**
     * A live voice frame ({ t, db, active }) while recording. If recognition hasn't produced any words after
     * FALLBACK_AFTER seconds of voice (or isn't available), the highlight follows syllable-like beats instead:
     * peaks in the smoothed loudness, at least 90 ms apart and 3 dB above the dip before them (as in quality.js).
     */
    hear(f) {
      if (!active || f.calibrating) return;
      last.push(f.active ? f.db : -120); if (last.length > 5) last.shift();
      if (last.length === 5) {
        // smoothed loudness around the three middle frames; a beat is a peak in the middle one
        const S1 = (last[0] + last[1] + last[2]) / 3, S2 = (last[1] + last[2] + last[3]) / 3, S3 = (last[2] + last[3] + last[4]) / 3;
        dip = Math.min(dip, S2);
        if (last[2] > -120 && S2 >= S1 && S2 > S3 && S2 - dip >= 3 && f.t - lastBeat >= 0.09) { beats++; lastBeat = f.t; dip = S2; }
      }
      if (f.active && voiceFrom === null) voiceFrom = f.t;
      if (!gotWords && voiceFrom !== null && f.t - voiceFrom >= FALLBACK_AFTER) byBeats = true;
      if (byBeats) {
        const syl = beats * BEATS_TO_SYLLABLES;
        let i = ends.findIndex((e) => e > syl); if (i < 0) i = words.length - 1;
        if (i > reached) { reached = i; show(); }
      }
    },
    /** Recording stopped: words reached stay highlighted. */
    finish() { if (active) { words.forEach((w, i) => w.span.classList.remove("current")); } },
    /**
     * Start listening for words. Returns a stop() function, or null if this browser can't.
     * onProblem(message) is called if recognition stops working.
     */
    follow(onProblem = () => {}) {
      if (!Recognition) { byBeats = true; return () => {}; } // no recognition at all: follow the beats from the start
      let stopped = false, earlier = "", rec = null, fails = 0;
      const begin = () => {
        rec = new Recognition();
        rec.lang = "en-US";
        rec.continuous = true;
        rec.interimResults = true;
        let session = "";
        rec.onresult = (e) => {
          session = "";
          for (let i = 0; i < e.results.length; i++) session += " " + e.results[i][0].transcript;
          const heard = (earlier + " " + session).split(/\s+/).map(norm).filter(Boolean);
          const p = progressFor(heard);
          if (p > 0) gotWords = true;
          if (p > reached) { reached = p; show(); }
        };
        rec.onerror = (e) => {
          // can't use recognition here: quietly follow the beats instead
          if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "network" || e.error === "audio-capture") { stopped = true; byBeats = true; }
        };
        let began = performance.now();
        rec.onend = () => { // recognizers stop after a while; keep going until recording ends
          earlier += " " + session;
          // ...but not in a tight loop: a recognizer that keeps ending at once (it can't get the microphone) is given up on,
          // and the beats take over
          fails = performance.now() - began < 1500 ? fails + 1 : 0;
          if (fails >= 3) { stopped = true; byBeats = true; return; }
          if (!stopped) { try { begin(); } catch { byBeats = true; } }
        };
        rec.start();
      };
      try { begin(); } catch { byBeats = true; }
      return () => { stopped = true; try { rec?.stop(); } catch {} };
    },
  };
}

// Same word, allowing one wrong letter in longer words ("poodle" / "poodles").
function similar(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
