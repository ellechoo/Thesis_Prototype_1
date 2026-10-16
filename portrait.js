// portrait.js — turns one recording into a living, explorable voice portrait (animated SVG).
//
// The portrait is a BLOOM: a glowing core with one strand growing out of it for every moment
// of the recording, filling out a body whose silhouette is the voice's own timbre. Strands wrap
// around the body in reading order, starting at the top and going clockwise. How each strand
// grows, shines and breaks up comes from that moment's measurements, so every voice grows
// a different creature. All blooms are scaled to the same overall size so they can be compared.
//
// Everything that decides how data becomes visuals (and motion) is in MAP, right below.
// Every drawn element carries data-key="…" (one or more keys, space-separated) so the page
// can explain what you're looking at. The portrait has no animation: everything is still,
// so it stays sharp at any zoom.

// ============================================================================
// MAP — data → visual. Change these to change the portraits.
// ============================================================================
export const MAP = {
  // TIMBRE (average MFCCs, the voice's tone-color fingerprint) → the SHAPE. The 12 numbers become
  // 6 wobbles (each with a size and a turn) that shape the core's membrane and the outline the
  // strand tips trace (no outline is drawn; the strands themselves show it).
  // The core is drawn as a hollow, thick outline (ringWidth) in the pitch color.
  timbre: { scale: 18, wobble: 0.17, coreSize: 0.22, ringWidth: 10 },

  // PITCH (typical pitch, Hz) → the base COLOR of the bloom and its core (low voices at hueLow,
  // high voices at hueHigh, on a musical scale).
  pitch: { lowHz: 85, highHz: 280, hueLow: 15, hueHigh: 290 },

  // NOTE → TILT. Where the typical note sits on a piano (lowKey…highKey, MIDI: 36 = C2, 72 = C5)
  // tilts the whole bloom, from maxTiltDeg to the left (low) to maxTiltDeg to the right (high).
  note: { lowKey: 36, highKey: 72, maxTiltDeg: 24 },

  // PITCH OVER TIME → each strand's COLOR is the pitch of that moment, on the same scale as the
  // core (low → hueLow, high → hueHigh). Speech moves within a narrow band, so the distance from
  // your typical pitch is multiplied by `exaggerate` (1 = true scale) to make small shifts visible.
  // Strands also REACH further when the pitch was above typical (reachPerOctave of the body's
  // radius per octave). Pauses and consonants (no pitch) use the base color.
  melody: { exaggerate: 2.5, reachPerOctave: 0.6 },

  // FRAMES RECORDED → the number of STRANDS: one per framesPerStrand frames (4 frames = 10 strands
  // per second of speech), up to maxStrands. Fewer strands = more space between petals.
  frames: { framesPerStrand: 4, maxStrands: 160 },

  // Strands start this far out from the core's outline (drawing units), so they float free of it
  // and have room to spread apart. Pause buds and consonant stubs sit closer, in that gap.
  strands: { gap: 64 },

  // LOUDNESS (each moment's dBFS) → the KIND of strand. Loud moments grow as sharp crystalline
  // shards; quiet moments as soft, gently bending threads ending in a glowing bulb.
  // sharpAbove: where shards begin; curl: how much quiet threads bend.
  loudness: { quietDb: -45, loudDb: -12, sharpAbove: 0.55, curl: 0.22 },

  // BRIGHTNESS (each moment's spectral centroid, Hz) → LIGHTNESS. Brighter moments are drawn
  // lighter; mellow moments deeper. (glowMin/glowMax are no longer used: the portrait has no glow.)
  brightness: { darkHz: 900, brightHz: 3200, glowMin: 1.2, glowMax: 6 },

  // PITCH CONFIDENCE (each moment's clarity, 0–1) → DITHERING. Steady moments are solid strands;
  // the less steady, the more a strand breaks into a row of round dots (dotSize wide), spaced
  // further apart at each lower level (dotGaps: light, medium, heavy).
  confidence: { solidAbove: 0.975, lightAbove: 0.955, mediumAbove: 0.93, dotSize: 5, dotGaps: [8, 10.5, 14] },

  // SPEAKING RATE (syllables/s) → NOT SHOWN right now (it used to set the tempo of animations, and the
  // portrait is now completely still). These numbers are kept for when it gets a new visual job.
  rate: { slow: 3, fast: 6, slowSeconds: 4, fastSeconds: 1.2 },

  // TALKING & PAUSES → BUDS. Moments in a pause don't grow strands; they become small closed buds
  // on the core. Talking moments with no clear pitch (consonants) grow short stubs.
  // budGap / stubGap: how far from the core's outline the buds and stubs start.
  rhythm: { budRadius: 2.6, stubLength: 0.12, budGap: 20, stubGap: 7 },

  // LONGEST PAUSE → a solid SHAPE tucked behind the core's outline, at the point in the reading
  // where the pause happened (clockwise from the top), in the color opposite the pitch color.
  // Longer pauses make it bigger: its radius grows from minSize to maxSize (× the core's size)
  // as the pause goes from 0 to fullAtSeconds long.
  longestPause: { minSize: 0.22, maxSize: 0.75, fullAtSeconds: 1.5 },

  // NOISINESS (spectral flatness: breath, hiss, s/sh) → spiky POLLEN around the body. Breathier voices
  // shed more. Each grain has `spikes` sharp points, between minSize and maxSize across.
  noisiness: { cleanFlatness: 0.01, noisyFlatness: 0.25, minPollen: 6, maxPollen: 150, minSize: 16, maxSize: 28, spikes: 7 },

  // VOWEL SPACE (each moment's F1/F2) → a CONSTELLATION of stars across the whole portrait,
  // centered on the voice's own average vowel (so its shape is what matters, not where it sits).
  // Each vowel moment is one star, placed by mouth shape: front vowels ("ee") to the right, back
  // vowels ("oo") to the left, open vowels ("ah") lower. It doesn't tilt with the bloom, so
  // constellations compare across portraits. spreadX/spreadY: how far it reaches (× the bloom's radius).
  vowels: { maxStars: 140, spreadX: 0.95, spreadY: 0.85, size: 5 },

  // ACCENT (group scores) → the SHAPE of the stars. Each accent group has a glyph; related places
  // share a family (Americas = solid polygons, British Isles = pointed stars, Oceania = crosses,
  // Asia = little flowers, Africa & South Atlantic = thin bursts). Each star takes the shape of one
  // of the voice's `top` closest groups, in proportion to its %. kind: polygon | star | cross | flower | burst; n: points.
  accent: { top: 4 },
  glyphs: {
    us: { kind: "polygon", n: 4 }, canada: { kind: "polygon", n: 6 }, bermuda: { kind: "polygon", n: 3 },
    england: { kind: "star", n: 5 }, scotland: { kind: "star", n: 6 }, wales: { kind: "star", n: 4 }, ireland: { kind: "star", n: 7 },
    australia: { kind: "cross", n: 4 }, newzealand: { kind: "cross", n: 6 },
    indian: { kind: "flower", n: 5 }, malaysia: { kind: "flower", n: 4 }, philippines: { kind: "flower", n: 6 },
    singapore: { kind: "flower", n: 3 }, hongkong: { kind: "flower", n: 8 },
    african: { kind: "burst", n: 8 }, southatlandtic: { kind: "burst", n: 3 },
  },
};
// ============================================================================

const R = 360;            // the bloom's outer radius (same for everyone)
const VIEW = 430;         // half-size of the viewBox (centered on 0,0)

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r1 = (x) => Math.round(x * 10) / 10;
const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const midiOf = (hz) => 69 + 12 * Math.log2(hz / 440);
const noteOf = (hz) => { const m = Math.round(midiOf(hz)); return NOTES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); };
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Works out everything the portrait uses, plus the explanations. */
export function features(take) {
  const all = take.frames || [];
  const s = take.summary || {};
  const voicedAll = all.filter((f) => f.pitch);
  const pitch = s.pitchHz || median(voicedAll.map((f) => f.pitch)) || 160;
  const pitchT = clamp01(Math.log(pitch / MAP.pitch.lowHz) / Math.log(MAP.pitch.highHz / MAP.pitch.lowHz));
  const hue = lerp(MAP.pitch.hueLow, MAP.pitch.hueHigh, pitchT);
  const noteName = s.note || noteOf(pitch);
  const keyT = clamp01((midiOf(pitch) - MAP.note.lowKey) / (MAP.note.highKey - MAP.note.lowKey));
  const tilt = lerp(-MAP.note.maxTiltDeg, MAP.note.maxTiltDeg, keyT);

  const rate = take.rhythm?.speechRate ?? null;
  const rateT = rate == null ? 0.5 : clamp01((rate - MAP.rate.slow) / (MAP.rate.fast - MAP.rate.slow));
  const tempo = lerp(MAP.rate.slowSeconds, MAP.rate.fastSeconds, rateT);

  const brightT = clamp01(((s.brightnessHz ?? 1500) - MAP.brightness.darkHz) / (MAP.brightness.brightHz - MAP.brightness.darkHz));

  // timbre → body silhouette
  const active = all.filter((f) => f.active && f.mfcc);
  const mfcc = Array.from({ length: 12 }, (_, i) => active.length ? active.reduce((a, f) => a + (f.mfcc[i + 1] ?? 0), 0) / active.length : 0);
  const harmonics = Array.from({ length: 6 }, (_, k) => ({
    k: k + 2, amp: MAP.timbre.wobble * Math.tanh(mfcc[2 * k] / MAP.timbre.scale), phase: Math.tanh(mfcc[2 * k + 1] / MAP.timbre.scale) * Math.PI,
  }));
  const timbreForm = (th) => 1 + harmonics.reduce((a, h) => a + h.amp * Math.cos(h.k * th + h.phase), 0);

  // body = timbre, normalized so the widest point is always R (same size for all)
  const results = take.accent?.results || [];
  const rawBody = (th) => Math.max(0.35, timbreForm(th));
  let maxB = 0;
  for (let i = 0; i < 180; i++) maxB = Math.max(maxB, rawBody((i / 180) * Math.PI * 2));
  const body = (th) => rawBody(th) / maxB;

  const step = Math.max(MAP.frames.framesPerStrand, Math.ceil(all.length / MAP.frames.maxStrands));
  const frames = all.filter((_, i) => i % step === 0);
  const t0 = all.length ? all[0].t : 0, t1 = all.length ? all[all.length - 1].t : 1;

  const rh = take.rhythm;
  const pauses = rh?.pauses || [];
  const longest = [...pauses].sort((a, b) => b.seconds - a.seconds)[0] || null;
  const flat = median(all.filter((f) => f.active).map((f) => f.flatness).filter((x) => x != null)) ?? 0.05;
  const flatT = clamp01((flat - MAP.noisiness.cleanFlatness) / (MAP.noisiness.noisyFlatness - MAP.noisiness.cleanFlatness));
  const vowelPts = all.filter((f) => f.f1 && f.f2);

  const fmt = (x, d = 0) => (x == null ? "–" : Number(x).toFixed(d));
  const legend = [
    { key: "frame", data: "One moment", value: `${frames.length} strands`,
      meaning: "Each strand is one split second of the recording.",
      visual: "Hover a strand to see that moment's own pitch, note, loudness and confidence." },
    { key: "timbre", data: "Timbre", value: "12 numbers",
      meaning: "The voice's tone color, the quality that makes two people saying the same word sound different (MFCCs).",
      visual: "The shape. Your 12 timbre numbers shape the membrane of the glowing core and the outline the strand tips trace, so every voice grows a different form." },
    { key: "pitch", data: "Pitch", value: `${fmt(pitch)} Hz`,
      meaning: "How high or low the voice sits, typically. Most adult speaking voices fall between about 85 and 255 Hz.",
      visual: "The base color of the bloom and its glowing core, from red-orange for low voices, through yellow, green and blue, to purple-magenta for high ones." },
    { key: "note", data: "Note", value: noteName,
      meaning: "The musical note closest to the typical pitch.",
      visual: `The tilt. Where this note sits on a piano tilts the whole bloom: low notes lean left, high notes lean right (here ${tilt >= 0 ? "right" : "left"} by ${Math.abs(Math.round(tilt))}°).` },
    { key: "melody", data: "Pitch over time", value: `${fmt(t1 - t0, 1)} s`,
      meaning: "The voice's melody: how pitch rose and fell while reading.",
      visual: "Each strand is colored by its own pitch: warmer red-orange where you went lower, toward purple-magenta where you went higher. The reading wraps clockwise from the top, and strands also reach further where your pitch rose." },
    { key: "loudness", data: "Loudness", value: `${fmt(s.loudnessDb)} dBFS`,
      meaning: "How strong the voice was at the microphone. 0 is the maximum; −60 is very quiet.",
      visual: "The kind of strand. Loud moments grow as sharp crystal shards; quiet moments as soft, bending threads that end in a glowing bulb." },
    { key: "brightness", data: "Brightness", value: `${fmt(s.brightnessHz)} Hz`,
      meaning: "Where the voice's energy sits: low for warm, mellow voices, high for bright, sharp ones.",
      visual: "Lightness. Brighter moments are drawn in lighter, brighter colors; mellow moments in deeper ones." },
    { key: "confidence", data: "Pitch confidence", value: fmt(s.clarity, 2),
      meaning: "How clear and steady the pitch was. Breathy or wavering voices score lower.",
      visual: "Dithering. Steady moments are solid strands; the less steady a moment, the more its strand breaks into a row of round dots, spaced further apart the shakier it was." },
    { key: "rate", data: "Speaking rate", value: rate == null ? "–" : `${fmt(rate, 1)} syllables/s`,
      meaning: "How fast the passage was read, pauses included.",
      visual: "Not shown in the portrait yet." },
    { key: "rhythm", data: "Talking & pauses", value: rh ? `${rh.pauseCount} pause${rh.pauseCount === 1 ? "" : "s"}` : "–",
      meaning: "When the voice was talking and when it paused (silences over 0.2 s).",
      visual: "Buds. Paused moments don't grow strands; they stay as small closed buds on the core. Consonants grow short stubs." },
    { key: "longestPause", data: "Longest pause", value: longest ? `${fmt(longest.seconds, 1)} s` : "–",
      meaning: "The single longest silence in the reading.",
      visual: "The solid shape tucked behind the core's outline, at the point in the reading where the pause happened. Longer pauses make it bigger." },
    { key: "noisiness", data: "Noisiness", value: fmt(flat, 3),
      meaning: "How much breath and hiss is mixed into the voice (spectral flatness).",
      visual: "Spiky pollen around the body. Breathier, hissier voices shed more." },
    { key: "vowels", data: "Vowel space", value: `${vowelPts.length} moments`,
      meaning: "Where the tongue and jaw were for every vowel, from the first two formants (F1, F2).",
      visual: "The constellation of stars across the portrait, one per vowel moment. It's centered on your own average vowel: vowels further front than your average (like “ee”) sit right, further back (like “oo”) left, more open (like “ah”) lower. Its shape shows how widely you move between vowels. It doesn't tilt with the bloom, so shapes compare across people." },
    { key: "frames", data: "Frames recorded", value: `${all.length}`,
      meaning: "How many measurements were taken, about 40 per second.",
      visual: `The number of strands: one per ${step} frames (about ${Math.round(40 / step)} per second of speech).` },
    { key: "accent", data: "Accent", value: results.length ? results.slice(0, 3).map((a) => `${a.name} ${Math.round(a.score * 100)}%`).join(", ") : "–",
      meaning: "Which of 16 English accent groups the voice sounds closest to, according to the accent model.",
      visual: "The shapes of the stars. Each accent group has its own glyph, in families by region: Americas are solid polygons, the British Isles pointed stars, Oceania crosses, Asia little flowers, Africa and the South Atlantic thin bursts. Stars take the shapes of your closest groups, in proportion to their %." },
  ];

  return { all, frames, step, t0, t1, pitch, hue, noteName, tilt, tempo, brightT, flatT, timbreForm, body, results, pauses, longest, vowelPts, legend,
    seed: take.id || take.name || "voice" };
}

/** Builds the portrait as an SVG string. theme: "dark" (default) or "light". */
export function portraitSVG(take, { theme = "dark", idPrefix = "p" } = {}) {
  const F = features(take);
  const dark = theme !== "light";
  const rand = seeded(F.seed);
  const p = idPrefix;
  const id = (n) => `${p}-${n}`;
  // every color is fully opaque (the alpha argument is ignored on purpose)
  const col = (h, s, l) => `hsl(${Math.round(((h % 360) + 360) % 360)},${Math.round(s)}%,${Math.round(l)}%)`;
  const blend = dark ? "screen" : "multiply";
  const H = F.hue, HC = (F.hue + 175) % 360;
  const span = Math.max(F.t1 - F.t0, 0.001);
  const octRange = Math.log2(MAP.pitch.highHz / MAP.pitch.lowHz);
  const baseT = clamp01(Math.log2(F.pitch / MAP.pitch.lowHz) / octRange);
  const hueOfPitch = (hz) => lerp(MAP.pitch.hueLow, MAP.pitch.hueHigh,
    clamp01(baseT + (Math.log2(hz / F.pitch) / octRange) * MAP.melody.exaggerate));
  const top = -Math.PI / 2;
  const angleAt = (t) => top + ((t - F.t0) / span) * Math.PI * 2;
  const P = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
  const pt = ([x, y]) => `${r1(x)},${r1(y)}`;
  const coreR = R * MAP.timbre.coreSize;
  const inPause = (t) => F.pauses.some((q) => t >= q.start && t < q.end);
  const inLongest = (t) => !!F.longest && t >= F.longest.start && t < F.longest.end;
  const out = [];

  // ---- defs ----
  const glow = lerp(MAP.brightness.glowMin, MAP.brightness.glowMax, F.brightT);
  out.push(`<defs>
    <filter id="${id("soft")}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
    <radialGradient id="${id("aura")}"><stop offset="0" stop-color="${col(H, 85, dark ? 55 : 70, dark ? 0.35 : 0.3)}"/><stop offset="0.6" stop-color="${col(H + 30, 85, dark ? 45 : 75, dark ? 0.12 : 0.12)}"/><stop offset="1" stop-color="${col(H + 60, 85, dark ? 40 : 80, 0)}"/></radialGradient>
  </defs>`);

  const bodyPath = (scale) => { let d = ""; for (let i = 0; i <= 180; i++) { const th = (i / 180) * Math.PI * 2; d += `${i ? "L" : "M"}${pt(P(th, R * F.body(th) * scale))}`; } return d + "Z"; };
  const corePath = () => { let d = ""; for (let i = 0; i <= 120; i++) { const th = (i / 120) * Math.PI * 2; d += `${i ? "L" : "M"}${pt(P(th, coreR * Math.max(0.55, F.timbreForm(th)) / 1.25))}`; } return d + "Z"; };

  // ---- the bloom (tilted by NOTE; breathes at the TEMPO) ----
  const bloom = [];
  // aura + body outline (TIMBRE, ACCENT)

  // strands
  const strands = [], buds = [], tips = [];
  F.frames.forEach((f, i) => {
    const th = angleAt(f.t) + (rand() - 0.5) * 0.012;
    const hueT = f.pitch ? hueOfPitch(f.pitch) : H;
    const rEdge = coreR * Math.max(0.55, F.timbreForm(th)) / 1.25;
    const rIn = rEdge + MAP.timbre.ringWidth / 2 + MAP.strands.gap;
    const rBody = R * F.body(th);

    if (inPause(f.t) || !f.active) {
      if (inLongest(f.t)) {
        // no bud here: the longest pause is carved out of the core instead (below)
      } else {
        const [x, y] = P(th, rEdge + MAP.timbre.ringWidth / 2 + MAP.rhythm.budGap);
        buds.push(`<circle data-key="rhythm frame frames" data-detail="${esc(`${f.t.toFixed(2)} s · pause`)}" cx="${r1(x)}" cy="${r1(y)}" r="${MAP.rhythm.budRadius}" fill="${col(hueT, 45, dark ? 70 : 40, 0.55)}"/>`);
      }
      return;
    }
    if (!f.pitch) {
      const s0 = rEdge + MAP.timbre.ringWidth / 2 + MAP.rhythm.stubGap;
      const a = P(th, s0), b = P(th, s0 + (rBody - s0) * MAP.rhythm.stubLength);
      strands.push(`<path data-key="rhythm frame frames" data-detail="${esc(`${f.t.toFixed(2)} s · talking, no clear pitch (consonant)`)}" d="M${pt(a)}L${pt(b)}" stroke="${col(hueT, 60, dark ? 70 : 40, 0.6)}" stroke-width="1.4" stroke-linecap="round"/>`);
      return;
    }

    const oct = Math.log2(f.pitch / F.pitch);
    const reach = clamp01(0.86 + oct * MAP.melody.reachPerOctave) * 0.9 + 0.1 * rand();
    const rOut = Math.max(rIn + 28, rIn + (rBody - rIn) * reach); // never shorter than a short stub, even in narrow lobes
    const loudT = clamp01((f.db - MAP.loudness.quietDb) / (MAP.loudness.loudDb - MAP.loudness.quietDb));
    const brightT = f.centroidHz ? clamp01((f.centroidHz - MAP.brightness.darkHz) / (MAP.brightness.brightHz - MAP.brightness.darkHz)) : 0.5;
    const light = dark ? lerp(48, 80, brightT) : lerp(52, 30, brightT);
    const c = MAP.confidence;
    const level = f.clarity >= c.solidAbove ? 0 : f.clarity >= c.lightAbove ? 1 : f.clarity >= c.mediumAbove ? 2 : 3;
    const dash = level ? `0 ${c.dotGaps[level - 1]}` : ""; // zero-length dashes + round caps = circles
    const flick = "";
    const keys = "frame frames melody loudness brightness confidence pitch rate";
    const detail = `${f.t.toFixed(2)} s · ${Math.round(f.pitch)} Hz (${noteOf(f.pitch)}) · ${Math.round(f.db)} dBFS · clarity ${f.clarity.toFixed(2)}`;
    const color = col(hueT, 90, light, dark ? 0.85 : 0.8);
    const nx = -Math.sin(th), ny = Math.cos(th); // sideways direction
    const a = P(th, rIn);

    if (loudT >= MAP.loudness.sharpAbove) {
      // crystalline shard: a thin, kinked, pointed blade
      const w = 1.2 + 3.2 * loudT;
      const kinkR = lerp(rIn, rOut, 0.55 + rand() * 0.2), kinkOff = (rand() - 0.5) * 16 * loudT;
      const k = P(th, kinkR); k[0] += nx * kinkOff; k[1] += ny * kinkOff;
      const tip = P(th + (rand() - 0.5) * 0.04, rOut);
      tips.push(tip);
      // a slim spindle: pointed at the inner end too (curving out from a point), sharp at the tip
      const m = [(a[0] + k[0]) / 2, (a[1] + k[1]) / 2];
      const d = `M${pt(a)}Q${pt([m[0] + nx * w * 0.9, m[1] + ny * w * 0.9])} ${pt([k[0] + nx * w, k[1] + ny * w])}L${pt(tip)}L${pt([k[0] - nx * w, k[1] - ny * w])}Q${pt([m[0] - nx * w * 0.9, m[1] - ny * w * 0.9])} ${pt(a)}Z`;
      strands.push(`<path${flick} data-key="${keys}" data-detail="${esc(detail)}" d="${d}" fill="${level ? "none" : color}" stroke="${color}" stroke-width="${level ? c.dotSize * 0.75 : 0.6}"${dash ? ` stroke-dasharray="${dash}" stroke-linecap="round"` : ""} stroke-linejoin="miter"/>`);
    } else {
      // soft thread: bends gently sideways and ends in a glowing bulb
      const curl = MAP.loudness.curl * (1 - loudT) * (rand() < 0.5 ? -1 : 1);
      const len = rOut - rIn;
      const c1 = P(th, rIn + len * 0.35); c1[0] += nx * curl * len; c1[1] += ny * curl * len;
      const c2 = P(th, rIn + len * 0.75); c2[0] -= nx * curl * len * 0.5; c2[1] -= ny * curl * len * 0.5;
      const e = P(th, rOut);
      tips.push(e);
      const d = `M${pt(a)}C${pt(c1)} ${pt(c2)} ${pt(e)}`;
      strands.push(`<g${flick} data-key="${keys}" data-detail="${esc(detail)}"><path d="${d}" fill="none" stroke="${color}" stroke-width="${level ? c.dotSize : r1(1 + 0.8 * (1 - loudT))}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/>${level ? "" : `<circle cx="${r1(e[0])}" cy="${r1(e[1])}" r="${r1(1.8 + 2.2 * (1 - loudT))}" fill="${color}"/>`}</g>`); // dotted strands have no end bulb
    }
  });
  bloom.push(`<g>${strands.join("")}</g>`);

  // NOISINESS → pollen
  const nPollen = Math.round(lerp(MAP.noisiness.minPollen, MAP.noisiness.maxPollen, F.flatT));
  const pollen = [];
  for (let i = 0; i < nPollen; i++) {
    const th = rand() * Math.PI * 2, rr = R * F.body(th) * (0.55 + rand() * 0.6);
    const [x, y] = P(th, rr);
    const nz = MAP.noisiness, size = lerp(nz.minSize, nz.maxSize, rand()) / 2, rot = rand() * Math.PI * 2;
    let d = "";
    for (let k = 0; k < nz.spikes * 2; k++) {
      const a = rot + (k / (nz.spikes * 2)) * Math.PI * 2, rr = k % 2 ? size * 0.28 : size * (0.85 + rand() * 0.4);
      d += `${k ? "L" : "M"}${r1(x + Math.cos(a) * rr)},${r1(y + Math.sin(a) * rr)}`;
    }
    pollen.push(`<path data-key="noisiness" data-detail="Pollen: breath and hiss" d="${d}Z" fill="${col(H + 60, 60, dark ? 85 : 30)}"/>`);
  }
  bloom.push(`<g>${pollen.join("")}</g>`);

  // LONGEST PAUSE: a solid shape tucked behind the core's outline
  if (F.longest) {
    const thB = angleAt((F.longest.start + F.longest.end) / 2);
    const edge = coreR * Math.max(0.55, F.timbreForm(thB)) / 1.25;
    const lp = MAP.longestPause;
    const br = coreR * lerp(lp.minSize, lp.maxSize, clamp01(F.longest.seconds / lp.fullAtSeconds));
    const [bx, by] = P(thB, edge);
    bloom.push(`<circle data-key="longestPause" data-detail="${esc(`${F.longest.seconds.toFixed(2)} s, at ${F.longest.start.toFixed(1)} s into the reading`)}" cx="${r1(bx)}" cy="${r1(by)}" r="${r1(br)}" fill="${col(HC, 80, dark ? 62 : 50)}"/>`);
  }
  // core (TIMBRE shape, PITCH color): a hollow, thick outline
  bloom.push(`<path data-key="pitch timbre note" data-detail="${esc(`The core: ${Math.round(F.pitch)} Hz, shaped by your timbre, tilted ${Math.abs(Math.round(F.tilt))}° ${F.tilt >= 0 ? "right" : "left"} for ${F.noteName}`)}" d="${corePath()}" fill="none" stroke="${col(H, 85, dark ? 62 : 48)}" stroke-width="${MAP.timbre.ringWidth}" stroke-linejoin="round"/>`);
  bloom.push(`<g>${buds.join("")}</g>`);



  // Center what you see: shift the (tilted) bloom so the average of its strand tips sits in the
  // middle of the frame. The vowel constellation below is centered on the same point.
  let shiftX = 0, shiftY = 0;
  if (tips.length) {
    const mx = tips.reduce((a, t) => a + t[0], 0) / tips.length, my = tips.reduce((a, t) => a + t[1], 0) / tips.length;
    const tr = (F.tilt * Math.PI) / 180;
    shiftX = -(mx * Math.cos(tr) - my * Math.sin(tr));
    shiftY = -(mx * Math.sin(tr) + my * Math.cos(tr));
  }
  out.push(`<g transform="translate(${r1(shiftX)},${r1(shiftY)}) rotate(${r1(F.tilt)})"><g>${bloom.join("")}</g></g>`);

  // VOWEL SPACE → constellation across the portrait; ACCENT → the shape of each star
  const pool = F.results.slice(0, MAP.accent.top).filter((r) => MAP.glyphs[r.label] && r.score > 0);
  const poolTotal = pool.reduce((a, r) => a + r.score, 0);
  const pick = () => {
    if (!pool.length) return null;
    let x = rand() * poolTotal;
    for (const r of pool) { x -= r.score; if (x <= 0) return r; }
    return pool[pool.length - 1];
  };
  const starInk = dark ? col(HC, 40, 92, 0.92) : col(HC, 60, 22, 0.85);
  const glyph = (g, x, y, size, rot) => {
    const n = g.n, pts = [];
    if (g.kind === "polygon") {
      for (let k = 0; k < n; k++) { const a = rot + (k / n) * Math.PI * 2; pts.push(`${k ? "L" : "M"}${r1(x + Math.cos(a) * size)},${r1(y + Math.sin(a) * size)}`); }
      return `<path d="${pts.join("")}Z" fill="${starInk}"/>`;
    }
    if (g.kind === "star") {
      for (let k = 0; k < n * 2; k++) { const a = rot + (k / (n * 2)) * Math.PI * 2, rr = k % 2 ? size * 0.42 : size * 1.25; pts.push(`${k ? "L" : "M"}${r1(x + Math.cos(a) * rr)},${r1(y + Math.sin(a) * rr)}`); }
      return `<path d="${pts.join("")}Z" fill="${starInk}"/>`;
    }
    if (g.kind === "cross") {
      for (let k = 0; k < n; k++) { const a = rot + (k / n) * Math.PI * 2; pts.push(`M${r1(x)},${r1(y)}L${r1(x + Math.cos(a) * size * 1.2)},${r1(y + Math.sin(a) * size * 1.2)}`); }
      return `<path d="${pts.join("")}" stroke="${starInk}" stroke-width="${r1(size * 0.5)}" stroke-linecap="butt"/>`;
    }
    if (g.kind === "flower") {
      let out = `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(size * 0.3)}" fill="${starInk}"/>`;
      for (let k = 0; k < n; k++) { const a = rot + (k / n) * Math.PI * 2; out += `<circle cx="${r1(x + Math.cos(a) * size * 0.72)}" cy="${r1(y + Math.sin(a) * size * 0.72)}" r="${r1(size * 0.4)}" fill="${starInk}"/>`; }
      return out;
    }
    // burst: thin, uneven rays
    // burst: solid, uneven rays (thin triangles) around a small center
    for (let k = 0; k < n; k++) {
      const a = rot + (k / n) * Math.PI * 2, rr = size * (1.2 + (k % 2) * 0.7), w = 0.32;
      pts.push(`M${r1(x + Math.cos(a - w) * size * 0.35)},${r1(y + Math.sin(a - w) * size * 0.35)}L${r1(x + Math.cos(a) * rr)},${r1(y + Math.sin(a) * rr)}L${r1(x + Math.cos(a + w) * size * 0.35)},${r1(y + Math.sin(a + w) * size * 0.35)}Z`);
    }
    return `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(size * 0.38)}" fill="${starInk}"/><path d="${pts.join("")}" fill="${starInk}"/>`;
  };
  const vstep = Math.max(1, Math.ceil(F.vowelPts.length / MAP.vowels.maxStars));
  const stars = [];
  // place every star on the shared vowel map, then shift the whole group so its average sits at
  // the bloom's center (keeps the constellation's shape, drops where it sat on the map)
  const placed = F.vowelPts.filter((_, i) => i % vstep === 0).map((f) => {
    const frontT = clamp01(Math.log(f.f2 / 800) / Math.log(2600 / 800));
    const openT = clamp01(Math.log(f.f1 / 250) / Math.log(900 / 250));
    return { f, x: (frontT - 0.5) * 2 * R * MAP.vowels.spreadX, y: (openT - 0.5) * 2 * R * MAP.vowels.spreadY };
  });
  const cx0 = placed.length ? placed.reduce((a, q) => a + q.x, 0) / placed.length : 0;
  const cy0 = placed.length ? placed.reduce((a, q) => a + q.y, 0) / placed.length : 0;
  placed.forEach(({ f, x: px0, y: py0 }) => {
    const x = px0 - cx0 + (rand() - 0.5) * 8;
    const y = py0 - cy0 + (rand() - 0.5) * 8;
    const r = pick();
    const g = r ? MAP.glyphs[r.label] : { kind: "polygon", n: 4 };
    const size = MAP.vowels.size * (0.8 + rand() * 0.5);
    const detail = `F1 ${f.f1} / F2 ${f.f2}` + (r ? ` · shaped by ${r.name} (${Math.round(r.score * 100)}%)` : "");
    stars.push(`<g data-key="vowels accent" data-detail="${esc(detail)}">${glyph(g, x, y, size, rand() * Math.PI * 2)}<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(size * 1.4)}" fill="transparent"/></g>`);
  });
  out.push(`<g>${stars.join("")}</g>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}" class="portrait-svg" role="img" aria-label="Voice portrait">${out.join("\n")}</svg>`;
  return { svg, features: F };
}
