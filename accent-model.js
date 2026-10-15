// accent-model.js — runs the CommonAccent model inside the browser (no server).
// Needs two files in the website folder, made by accent-server/export_model.py:
//   accent-model.onnx    (about 21 MB, downloaded once, then cached)
//   accent-labels.json
import * as ort from "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/ort.wasm.min.mjs";

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/";
// Multi-threading needs special server headers; one thread works everywhere.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const MODEL_URL = "accent-model.onnx";
const LABELS_URL = "accent-labels.json";
const CACHE_NAME = "accent-model-v1";
const SCORE_SCALE = 30; // turns similarity scores into percentages (same as the server)

export const NAMES = {
  us: "United States",
  england: "England",
  australia: "Australia",
  indian: "India / South Asia",
  canada: "Canada",
  bermuda: "Bermuda",
  scotland: "Scotland",
  african: "Africa (various)",
  ireland: "Ireland",
  newzealand: "New Zealand",
  wales: "Wales",
  malaysia: "Malaysia",
  philippines: "Philippines",
  singapore: "Singapore",
  hongkong: "Hong Kong",
  southatlandtic: "South Atlantic (St Helena, Falklands)",
};

let loading = null;

/**
 * Load the model once. onProgress(fraction 0..1 or null, message) is called while downloading.
 * Resolves to { classify(samples16k) -> result }.
 */
export function loadAccentModel(onProgress = () => {}) {
  if (!loading) loading = doLoad(onProgress).catch((e) => { loading = null; throw e; });
  return loading;
}

async function doLoad(onProgress) {
  const labelsRes = await fetch(LABELS_URL, { cache: "no-cache" });
  if (!labelsRes.ok) throw new MissingModelError();
  const meta = await labelsRes.json();

  const bytes = await fetchModel(`${MODEL_URL}?v=${meta.version ?? "1"}`, onProgress);
  onProgress(1, "Starting the model…");
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });

  return {
    labels: meta.labels,
    async classify(samples) {
      const t0 = performance.now();
      const input = new ort.Tensor("float32", samples, [1, samples.length]);
      const out = await session.run({ [session.inputNames[0]]: input });
      const raw = Array.from(out[session.outputNames[0]].data);
      const probs = softmax(raw.map((v) => v * SCORE_SCALE));
      const results = meta.labels
        .map((label, i) => ({ label, name: NAMES[label] ?? label, score: round4(probs[i]) }))
        .sort((a, b) => b.score - a.score);
      return { model: "ecapa (in browser)", top: results[0], results, processingMs: Math.round(performance.now() - t0) };
    },
  };
}

export class MissingModelError extends Error {
  constructor() {
    super("The accent model files (accent-model.onnx and accent-labels.json) aren't in the website folder yet. Run accent-server/export_model.py once to create them. See the README.");
    this.name = "MissingModelError";
  }
}

// Download with progress, keeping a copy in the browser's cache for next time.
async function fetchModel(url, onProgress) {
  let cache = null;
  try {
    cache = await caches.open(CACHE_NAME);
    // drop copies of older model versions
    for (const req of await cache.keys()) if (!req.url.endsWith(url)) await cache.delete(req);
    const hit = await cache.match(url);
    if (hit) {
      onProgress(1, "Loading the model from this device…");
      return new Uint8Array(await hit.arrayBuffer());
    }
  } catch { cache = null; } // Cache Storage is unavailable in some private modes

  const res = await fetch(url);
  if (!res.ok) throw new MissingModelError();
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    const mb = (got / 1e6).toFixed(1);
    onProgress(total ? got / total : null, total ? `Downloading the accent model… ${mb} of ${(total / 1e6).toFixed(0)} MB (first time only)` : `Downloading the accent model… ${mb} MB (first time only)`);
  }
  const bytes = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.length; }

  try { await cache?.put(url, new Response(bytes, { headers: { "content-type": "application/octet-stream" } })); } catch {}
  return bytes;
}

function softmax(xs) {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}
const round4 = (x) => Math.round(x * 1e4) / 1e4;
