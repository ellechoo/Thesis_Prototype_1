// formants.js
// Estimates vowel formants (F1, F2, F3) from a buffer of audio using
// Linear Predictive Coding (LPC), the same basic method Praat uses.
// No dependencies. Pure functions, so you can also run it in Node.
//
// Formants are resonances of the throat and mouth. F1 tracks how open the
// mouth is (low F1 = "ee"/"oo", high F1 = "ah"); F2 tracks tongue position
// (high F2 = front vowels like "ee", low F2 = back vowels like "oo").
// Plotting F2 against F1 gives a vowel chart, the classic way to see an accent.

/**
 * @param {Float32Array} input  mono samples
 * @param {number} sampleRate   input sample rate (e.g. 48000)
 * @param {object} [o]
 * @param {number} [o.maxFormantHz=5500]  ceiling; ~5000 suits lower voices, ~5500 higher voices
 * @param {number} [o.windowMs=30]        analysis length taken from the END of the buffer
 * @param {number} [o.order=12]           LPC order (number of poles)
 * @returns {{f1:number|null,f2:number|null,f3:number|null,bandwidths:number[]}}
 */
export function estimateFormants(input, sampleRate, o = {}) {
  const maxF = o.maxFormantHz ?? 5500;
  const windowMs = o.windowMs ?? 30;
  const fs = 2 * maxF; // analysis sample rate: formants up to maxF are representable

  // 1. Take the most recent `windowMs` (plus filter margin), low-pass, resample to fs.
  const need = Math.min(input.length, Math.round((windowMs / 1000 + 0.004) * sampleRate));
  const seg = input.subarray(input.length - need);
  const x = resample(lowpass(seg, sampleRate, maxF * 0.95), sampleRate, fs);

  // Trim the filter margin at the start
  const n = Math.min(x.length, Math.round((windowMs / 1000) * fs));
  const frame = x.subarray(x.length - n);
  if (n < 64) return empty();

  // 2. Pre-emphasis (boost highs so higher formants aren't drowned out) + Gaussian-ish window
  const pre = Math.exp((-2 * Math.PI * 50) / fs);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = frame[i] - (i > 0 ? pre * frame[i - 1] : 0);
    const k = (i - (n - 1) / 2) / ((n - 1) / 2);
    w[i] = s * Math.exp(-0.5 * (2.5 * k) ** 2); // gaussian window, alpha 2.5
  }

  // 3. LPC coefficients by autocorrelation + Levinson-Durbin
  const order = o.order ?? 12;
  const a = lpc(w, order);
  if (!a) return empty();

  // 4. Roots of the LPC polynomial are the resonances
  const roots = polyRoots(a);
  const cands = [];
  for (const [re, im] of roots) {
    if (im <= 0) continue; // one of each conjugate pair
    const mag = Math.hypot(re, im);
    const freq = (Math.atan2(im, re) * fs) / (2 * Math.PI);
    const bw = (-Math.log(mag) * fs) / Math.PI;
    if (freq > 90 && freq < maxF - 50 && bw > 0 && bw < 600) cands.push({ freq, bw });
  }
  cands.sort((p, q) => p.freq - q.freq);
  return {
    f1: cands[0] ? cands[0].freq : null,
    f2: cands[1] ? cands[1].freq : null,
    f3: cands[2] ? cands[2].freq : null,
    bandwidths: cands.slice(0, 3).map((c) => c.bw),
  };
}

function empty() {
  return { f1: null, f2: null, f3: null, bandwidths: [] };
}

// Windowed-sinc FIR low-pass (Blackman), linear phase.
function lowpass(x, fsIn, cutoff) {
  const taps = 63;
  const fc = cutoff / fsIn;
  if (fc >= 0.5) return Float64Array.from(x);
  const h = new Float64Array(taps);
  const m = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const t = i - m;
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    const win = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    h[i] = sinc * win;
    sum += h[i];
  }
  const y = new Float64Array(x.length);
  for (let n = 0; n < x.length; n++) {
    let acc = 0;
    for (let k = 0; k < taps; k++) {
      const j = n - k + m;
      if (j >= 0 && j < x.length) acc += h[k] * x[j];
    }
    y[n] = acc / sum;
  }
  return y;
}

// Linear-interpolation resampler (input already band-limited by lowpass()).
function resample(x, fsIn, fsOut) {
  const ratio = fsIn / fsOut;
  const len = Math.floor((x.length - 1) / ratio) + 1;
  const y = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const p = i * ratio;
    const j = Math.floor(p);
    const f = p - j;
    y[i] = j + 1 < x.length ? x[j] * (1 - f) + x[j + 1] * f : x[j];
  }
  return y;
}

// Returns polynomial [1, a1, ..., ap] for A(z) = 1 + a1 z^-1 + ... + ap z^-p, or null.
function lpc(x, p) {
  const r = new Float64Array(p + 1);
  for (let k = 0; k <= p; k++) {
    let s = 0;
    for (let i = k; i < x.length; i++) s += x[i] * x[i - k];
    r[k] = s;
  }
  if (r[0] <= 1e-12) return null;
  r[0] *= 1 + 1e-9; // tiny regularisation
  let a = new Float64Array(p + 1);
  a[0] = 1;
  let err = r[0];
  for (let i = 1; i <= p; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    const next = Float64Array.from(a);
    for (let j = 1; j < i; j++) next[j] = a[j] + k * a[i - j];
    next[i] = k;
    a = next;
    err *= 1 - k * k;
    if (err <= 0) return null;
  }
  return a;
}

// Roots of z^p + a1 z^(p-1) + ... + ap via Durand-Kerner. Returns [[re, im], ...].
function polyRoots(a) {
  const p = a.length - 1;
  let zr = new Float64Array(p), zi = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    const ang = (2 * Math.PI * i) / p + 0.4;
    zr[i] = 0.9 * Math.cos(ang);
    zi[i] = 0.9 * Math.sin(ang);
  }
  for (let iter = 0; iter < 500; iter++) {
    let maxDelta = 0;
    for (let i = 0; i < p; i++) {
      // evaluate polynomial at z_i (Horner)
      let pr = 1, pi = 0;
      for (let k = 1; k <= p; k++) {
        const nr = pr * zr[i] - pi * zi[i] + a[k];
        const ni = pr * zi[i] + pi * zr[i];
        pr = nr; pi = ni;
      }
      // denominator: product of (z_i - z_j)
      let dr = 1, di = 0;
      for (let j = 0; j < p; j++) {
        if (j === i) continue;
        const er = zr[i] - zr[j], ei = zi[i] - zi[j];
        const nr = dr * er - di * ei;
        const ni = dr * ei + di * er;
        dr = nr; di = ni;
      }
      const den = dr * dr + di * di || 1e-30;
      const qr = (pr * dr + pi * di) / den;
      const qi = (pi * dr - pr * di) / den;
      zr[i] -= qr;
      zi[i] -= qi;
      maxDelta = Math.max(maxDelta, Math.abs(qr) + Math.abs(qi));
    }
    if (maxDelta < 1e-10) break;
  }
  const out = [];
  for (let i = 0; i < p; i++) out.push([zr[i], zi[i]]);
  return out;
}
