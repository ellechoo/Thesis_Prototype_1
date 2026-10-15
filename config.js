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
