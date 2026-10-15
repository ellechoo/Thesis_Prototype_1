// voice-analyzer.js
// Turns live microphone audio into a stream of data "frames".
// Runs entirely in the browser. Free, no servers, no API keys.
//
// Usage:
//   const va = new VoiceAnalyzer();
//   va.onFrame = (frame) => console.log(frame);
//   await va.start();          // must be called from a click/tap
//   await va.calibrate();      // stay quiet ~1.5s to measure room noise
//   ...
//   va.stop();
//   va.frames                  // everything recorded so far

import Meyda from "https://cdn.jsdelivr.net/npm/meyda@5.6.3/+esm";
import { PitchDetector } from "https://cdn.jsdelivr.net/npm/pitchy@4.1.0/+esm";
import { estimateFormants } from "./formants.js";

const DEFAULTS = {
  bufferSize: 2048,              // samples per analysis window (~43 ms at 48 kHz). Must be a power of 2.
  hopMs: 25,                     // how often to take a reading (ms)
  useFilters: true,              // cut rumble (<80 Hz) and hiss (>8 kHz)
  highpassHz: 80,
  lowpassHz: 8000,
  browserNoiseSuppression: false,// browser's built-in cleanup; alters the voice, so off by default
  minClarity: 0.9,               // pitch readings below this confidence are discarded
  minPitchHz: 60,                // lowest plausible speaking/singing pitch
  maxPitchHz: 1100,              // highest plausible pitch
  gateMultiplier: 3,             // gate = measured room noise × this
  defaultGate: 0.01,             // gate used before calibration (RMS units)
  mfccCount: 13,
  formants: true,                // measure vowel formants F1-F3 on voiced frames
  maxFormantHz: 5500,            // formant ceiling: ~5000 for lower voices, ~5500 for higher voices
};

export class VoiceAnalyzer {
  constructor(options = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.onFrame = null;         // callback(frame) on every reading
    this.frames = [];            // recorded frames
    this.recording = true;       // set false to watch live without saving
    this.noiseFloor = null;      // measured room noise (RMS)
    this.gate = this.opts.defaultGate;
    this.running = false;
    this._calib = null;
  }

  get sampleRate() {
    return this.ctx ? this.ctx.sampleRate : null;
  }

  async start() {
    if (this.running) return;
    const o = this.opts;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access isn't available. Use HTTPS (or localhost) in a modern browser.");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: o.browserNoiseSuppression,
        noiseSuppression: o.browserNoiseSuppression,
        autoGainControl: false,
      },
    });

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume(); // iOS needs this inside a user gesture

    // Audio graph: mic -> [highpass -> lowpass] -> analyser
    let node = this.ctx.createMediaStreamSource(this.stream);
    this.source = node; // raw, unfiltered mic (e.g. for recording a clip with recorder.js)
    this._nodes = [node];
    if (o.useFilters) {
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = o.highpassHz;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = Math.min(o.lowpassHz, this.ctx.sampleRate / 2 - 100);
      node.connect(hp);
      hp.connect(lp);
      node = lp;
      this._nodes.push(hp, lp);
    }
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = o.bufferSize;
    this.analyser.smoothingTimeConstant = 0;
    node.connect(this.analyser);

    this._buf = new Float32Array(o.bufferSize);
    this._pitch = PitchDetector.forFloat32Array(o.bufferSize);
    Meyda.bufferSize = o.bufferSize;
    Meyda.sampleRate = this.ctx.sampleRate;
    Meyda.numberOfMFCCCoefficients = o.mfccCount;

    this._t0 = this.ctx.currentTime;
    this.running = true;
    this._timer = setInterval(() => this._tick(), o.hopMs);
  }

  stop() {
    if (!this.running) return;
    clearInterval(this._timer);
    this._nodes?.forEach((n) => n.disconnect());
    this.analyser?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.running = false;
    if (this._calib) {
      this._calib.reject(new Error("Stopped during calibration"));
      this._calib = null;
    }
  }

  clear() {
    this.frames = [];
  }

  // Stay quiet while this runs. Measures room noise and sets the noise gate.
  calibrate(ms = 1500) {
    if (!this.running) return Promise.reject(new Error("Start the mic first"));
    return new Promise((resolve, reject) => {
      this._calib = { samples: [], until: performance.now() + ms, resolve, reject };
    });
  }

  _tick() {
    this.analyser.getFloatTimeDomainData(this._buf);
    const frame = analyzeBuffer(this._buf, this.ctx.sampleRate, this._pitch, this.opts, this.gate);
    frame.t = round(this.ctx.currentTime - this._t0, 3);

    if (this._calib) {
      this._calib.samples.push(frame.rms);
      if (performance.now() >= this._calib.until) {
        const s = this._calib.samples.sort((a, b) => a - b);
        // 75th percentile: robust to a brief click or breath during calibration
        this.noiseFloor = s[Math.floor(s.length * 0.75)] || 0;
        this.gate = Math.max(this.noiseFloor * this.opts.gateMultiplier, 0.002);
        const done = this._calib;
        this._calib = null;
        done.resolve({ noiseFloor: this.noiseFloor, gate: this.gate });
      }
      frame.calibrating = true;
    } else if (this.recording) {
      this.frames.push(frame);
    }

    this.onFrame?.(frame);
  }

  toJSON() {
    return JSON.stringify(
      {
        meta: {
          createdAt: new Date().toISOString(),
          sampleRate: this.sampleRate,
          bufferSize: this.opts.bufferSize,
          hopMs: this.opts.hopMs,
          noiseFloor: this.noiseFloor,
          gate: this.gate,
          settings: this.opts,
        },
        frames: this.frames,
      },
      null,
      0
    );
  }

  toCSV() {
    const n = this.opts.mfccCount;
    const cols = ["t", "rms", "db", "active", "pitch", "clarity", "f1", "f2", "f3", "centroidHz", "flatness", "zcr",
      ...Array.from({ length: n }, (_, i) => `mfcc_${i}`)];
    const rows = this.frames.map((f) =>
      [f.t, f.rms, f.db, f.active ? 1 : 0, f.pitch ?? "", f.clarity, f.f1 ?? "", f.f2 ?? "", f.f3 ?? "", f.centroidHz ?? "", f.flatness ?? "", f.zcr,
        ...(f.mfcc ?? Array(n).fill(""))].join(",")
    );
    return [cols.join(","), ...rows].join("\n");
  }
}

// Pure function: one buffer of samples in, one data frame out.
// Exported so you can also run it over recorded audio files later.
export function analyzeBuffer(buffer, sampleRate, pitchDetector, opts, gate) {
  // Loudness
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  const rms = Math.sqrt(sum / buffer.length);
  const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  const active = rms >= gate; // noise gate: is someone (probably) making sound?

  // Pitch (on the raw buffer, before Meyda windows a copy)
  const [rawPitch, clarity] = pitchDetector.findPitch(buffer, sampleRate);
  const pitchOk = active && clarity >= opts.minClarity && rawPitch >= opts.minPitchHz && rawPitch <= opts.maxPitchHz;

  const frame = {
    t: 0,
    rms: round(rms, 5),
    db: Number.isFinite(db) ? round(db, 1) : -120,
    active,
    pitch: pitchOk ? round(rawPitch, 1) : null,
    clarity: round(clarity, 3),
    f1: null,
    f2: null,
    f3: null,
    centroidHz: null,
    flatness: null,
    zcr: 0,
    mfcc: null,
  };

  // Vowel formants: only meaningful while the voice is actually vibrating (voiced)
  if (opts.formants && pitchOk) {
    const fm = estimateFormants(buffer, sampleRate, { maxFormantHz: opts.maxFormantHz });
    frame.f1 = fm.f1 ? Math.round(fm.f1) : null;
    frame.f2 = fm.f2 ? Math.round(fm.f2) : null;
    frame.f3 = fm.f3 ? Math.round(fm.f3) : null;
  }

  // Timbre features (Meyda may modify its input, so give it a copy)
  const f = Meyda.extract(["spectralCentroid", "spectralFlatness", "zcr", "mfcc"], Float32Array.from(buffer));
  frame.zcr = f.zcr;
  if (active) {
    // Meyda reports centroid as a spectrum bin index; convert to Hz
    frame.centroidHz = Number.isFinite(f.spectralCentroid) ? round((f.spectralCentroid * sampleRate) / buffer.length, 1) : null;
    frame.flatness = Number.isFinite(f.spectralFlatness) ? round(f.spectralFlatness, 4) : null;
    frame.mfcc = f.mfcc ? Array.from(f.mfcc, (v) => round(v, 3)) : null;
  }
  return frame;
}

function round(v, d) {
  const p = 10 ** d;
  return Math.round(v * p) / p;
}
