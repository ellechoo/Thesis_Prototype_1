// progress.js — lights up the passage word by word as it's read aloud.
// Uses the browser's built-in speech recognition (Web Speech API) to hear the words.
// Only the highlighting uses it; every measurement still runs on this device.
// In Chrome, the recognizer sends audio to Google; Safari can run it on the device.
// Browsers without it (e.g. Firefox) just show the passage without highlighting.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canFollowWords = !!Recognition;

const LOOKAHEAD = 4; // how many passage words a heard word may skip ahead to find its match

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

  let reached = 0, active = false;
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
    reset() { reached = 0; active = false; show(); },
    /** Recording has begun: point at the first word. */
    start() { reached = 0; active = true; show(); },
    /** Recording stopped: words reached stay highlighted. */
    finish() { if (active) { words.forEach((w, i) => w.span.classList.remove("current")); } },
    /**
     * Start listening for words. Returns a stop() function, or null if this browser can't.
     * onProblem(message) is called if recognition stops working.
     */
    follow(onProblem = () => {}) {
      if (!Recognition) return null;
      let stopped = false, earlier = "", rec = null;
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
          if (p > reached) { reached = p; show(); }
        };
        rec.onerror = (e) => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed") { stopped = true; onProblem("Word highlighting isn't allowed in this browser, but recording still works."); }
          else if (e.error === "network") { stopped = true; onProblem("Word highlighting needs an internet connection in this browser, but recording still works."); }
        };
        rec.onend = () => { // recognizers stop after a while; keep going until recording ends
          earlier += " " + session;
          if (!stopped) { try { begin(); } catch {} }
        };
        rec.start();
      };
      try { begin(); } catch { return null; }
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
