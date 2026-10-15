// recorder.js — capture raw mic audio as a clip, and turn it into a 16 kHz WAV.
// No dependencies.

const WORKLET = `
class ClipRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("clip-recorder", ClipRecorder);
`;

const loaded = new WeakSet();

/**
 * Start recording from an audio node (e.g. VoiceAnalyzer's `source`).
 * Returns { stop(): Float32Array, seconds(): number, sampleRate }.
 */
export async function startRecording(ctx, node) {
  if (!loaded.has(ctx)) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    loaded.add(ctx);
  }
  const worklet = new AudioWorkletNode(ctx, "clip-recorder");
  const mute = ctx.createGain();
  mute.gain.value = 0; // keep the node running without playing the mic out loud
  const chunks = [];
  let length = 0;
  worklet.port.onmessage = (e) => { chunks.push(e.data); length += e.data.length; };
  node.connect(worklet);
  worklet.connect(mute);
  mute.connect(ctx.destination);

  return {
    sampleRate: ctx.sampleRate,
    seconds: () => length / ctx.sampleRate,
    stop() {
      try { node.disconnect(worklet); } catch {}
      worklet.disconnect();
      mute.disconnect();
      worklet.port.onmessage = null;
      const out = new Float32Array(length);
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      return out;
    },
  };
}

/** Resample mono samples to `rate` using the browser's high-quality resampler. */
export async function resampleTo(samples, fromRate, rate = 16000) {
  if (fromRate === rate) return samples;
  const len = Math.max(1, Math.ceil((samples.length * rate) / fromRate));
  const off = new OfflineAudioContext(1, len, rate);
  const buf = off.createBuffer(1, samples.length, fromRate);
  buf.copyToChannel(samples, 0);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0).slice();
}

/** Decode any audio file the browser understands (mp3, m4a, wav, ...) to mono samples. */
export async function decodeFile(file) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < d.length; i++) mono[i] += d[i] / audio.numberOfChannels;
    }
    return { samples: mono, sampleRate: audio.sampleRate };
  } finally {
    ctx.close();
  }
}

/** 16-bit PCM WAV blob. */
export function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}
