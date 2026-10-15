// config.js — settings you'll want to change after deploying.

// Where the accent check runs:
//   "browser" (default): inside the visitor's browser. No server needed. Requires
//                        accent-model.onnx + accent-labels.json in this folder
//                        (make them once with accent-server/export_model.py).
//   "server":            sends the recording to the accent server below.
export const ACCENT_MODE = "browser";

// Address of your accent server (the accent-server folder).
// Running it on your computer:  "http://127.0.0.1:7860"  (same as localhost, but avoids a Mac quirk)
// Deployed to Hugging Face:     "https://YOUR-NAME-accent-server.hf.space"
// Visitors can also type a different address on the Accent check page.
export const ACCENT_SERVER = "http://127.0.0.1:7860";

// ---- Shared archive (Supabase) ----
// Leave these empty and recordings are saved only in each visitor's own browser.
// Fill them in to share one archive across everyone's devices:
//   1. Create a free project at supabase.com.
//   2. Run supabase-setup.sql in its SQL Editor.
//   3. Copy the Project URL and the anon / publishable key (Project Settings → API) here.
// The anon key is meant to be public; the setup script only lets visitors add and read, not change or delete.
export const SUPABASE_URL = "https://asbiisktzttekcnvdfnh.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_SBeR_ptv-tUVldPgho-5ow_Fxh_yZgu";
