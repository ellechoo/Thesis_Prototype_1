// store.js — where recordings ("takes") are kept.
//
// Shared archive (when SUPABASE_URL and SUPABASE_ANON_KEY are set in config.js):
//   every take's name and measurements go to the shared database. Audio is never uploaded.
// This device: a copy of each take made here is also kept in this browser (IndexedDB).
//   Its audio is held just long enough to play it on the person's results page, then
//   forgotten (see forgetLocalAudio), so the next person on a shared computer can't replay it.
//   Without Supabase set up, this is the only storage and the archive shows this device only.
//
// A take: { id, name, createdAt, source, seconds, sampleRate, noiseFloor, gate, settings,
//           passage, summary, rhythm, accent, accentNote, frames, preview, wav (Blob, this device only) }
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const archiveIsShared = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const LIST_COLUMNS = "id,name,created_at,seconds,source,summary,accent,rhythm,preview";
const LIST_LIMIT = 500;

// ---------- ids ----------
export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- public API ----------
/**
 * Save a take. Always keeps a copy on this device; adds its data (never its audio) to the
 * shared archive when set up. Returns { shared, error } — error is a message if the shared archive failed.
 */
export async function saveTake(take) {
  take.preview = take.preview ?? makePreview(take.frames);
  const result = { shared: false, error: null };
  if (archiveIsShared) {
    try {
      const sb = await client();
      const ins = await sb.from("takes").insert(toRow(take));
      if (ins.error) throw new Error(ins.error.message);
      result.shared = true;
    } catch (e) {
      result.error = e.message || String(e);
    }
  }
  take.sharedToArchive = result.shared;
  await local("readwrite", (s) => s.put(take)); // this device's own copy
  return result;
}

/**
 * One take. The shared archive's copy wins when there is one, so edits made to the archive (e.g. hand-set
 * measures) show up everywhere, including on the computer the recording was made on. This device's copy is
 * used only for its audio (never uploaded), or when the take isn't in the shared archive or it can't be reached.
 */
export async function getTake(id) {
  let mine = null;
  try { mine = await local("readonly", (s) => s.get(id)); } catch {}
  if (archiveIsShared) {
    try {
      const sb = await client();
      const { data, error } = await sb.from("takes").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      if (data) { const take = fromRow(data); if (mine?.wav) take.wav = mine.wav; return take; }
    } catch (e) { if (!mine) throw e; }
  }
  return mine || null;
}

/** The archive, newest first (without the full frames, to keep it quick). */
export async function listTakes() {
  if (archiveIsShared) {
    const sb = await client();
    const { data, error } = await sb.from("takes").select(LIST_COLUMNS).order("created_at", { ascending: false }).limit(LIST_LIMIT);
    if (error) throw new Error(error.message);
    return data.map(fromRow);
  }
  const all = (await local("readonly", (s) => s.getAll())) || [];
  all.forEach((t) => (t.preview = t.preview ?? makePreview(t.frames)));
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** The newest take made on this device. */
export async function latestLocalTake() {
  const all = (await local("readonly", (s) => s.getAll())) || [];
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] || null;
}

/** Drop the audio from this device's copy once it has been played back on the results page. */
export async function forgetLocalAudio(id) {
  const t = await local("readonly", (s) => s.get(id));
  if (t?.wav) { t.wav = null; await local("readwrite", (s) => s.put(t)); }
}

/** Delete this device's copy (the shared archive can only be changed from the Supabase dashboard). */
export const deleteLocalTake = (id) => local("readwrite", (s) => s.delete(id));

/** A short pitch line ([[t, pitchHz|null], …]) for archive cards. */
export function makePreview(frames, points = 160) {
  if (!frames?.length) return [];
  const step = Math.max(1, Math.ceil(frames.length / points));
  const out = [];
  for (let i = 0; i < frames.length; i += step) {
    const chunk = frames.slice(i, i + step).map((f) => f.pitch).filter(Boolean).sort((a, b) => a - b);
    out.push([frames[i].t, chunk.length ? Math.round(chunk[chunk.length >> 1]) : null]);
  }
  return out;
}

// ---------- shared archive (Supabase) ----------
let sbPromise = null;
function client() {
  if (!sbPromise) {
    sbPromise = import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm")
      .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } }))
      .catch((e) => { sbPromise = null; throw new Error(`Couldn't reach the archive: ${e.message}`); });
  }
  return sbPromise;
}

function toRow(t) {
  return {
    id: t.id, created_at: t.createdAt, name: t.name, source: t.source, seconds: t.seconds,
    sample_rate: t.sampleRate, noise_floor: t.noiseFloor, gate: t.gate, settings: t.settings,
    passage: t.passage, summary: t.summary, rhythm: t.rhythm, accent: t.accent, accent_note: t.accentNote,
    frames: t.frames, preview: t.preview,
  };
}
function fromRow(r) {
  return {
    id: r.id, createdAt: r.created_at, name: r.name, source: r.source, seconds: r.seconds,
    sampleRate: r.sample_rate, noiseFloor: r.noise_floor, gate: r.gate, settings: r.settings,
    passage: r.passage, summary: r.summary, rhythm: r.rhythm, accent: r.accent, accentNote: r.accent_note,
    frames: r.frames ?? null, preview: r.preview ?? [], wav: null, sharedToArchive: true,
  };
}

// ---------- this device (IndexedDB) ----------
const DB = "voice-to-data";
const STORE = "takes";

function openLocal() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" }).createIndex("createdAt", "createdAt");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function local(mode, fn) {
  const db = await openLocal();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(out && "readyState" in out ? out.result : out); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("Couldn't save. The browser may be out of storage space.")); };
  });
}
