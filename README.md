# Voice to Data

A small website that listens to a microphone (computer or phone) and turns a voice into numbers you can save and visualize. It has three pages:

| Page | What it does | Where the audio goes |
|---|---|---|
| **Live data** (`index.html`) | Pitch, loudness, brightness, vowel formants and a timbre fingerprint, about 40 times a second. Export as JSON or CSV. | Stays on the device |
| **Vowel chart** (`vowels.html`) | You read 10 short words; it measures each vowel and plots your vowel space next to a reference. | Stays on the device |
| **Accent check** (`accent.html`) | You read a short passage; a free open-source model scores it against 16 groups of English accents. | Stays on the device (the model runs in the browser) |

Everything is free: no accounts, no API keys.

## Files

| File | What it does |
|---|---|
| `voice-analyzer.js` | The engine. Mic → filters → analysis → data frames. Reuse this in your real site. |
| `formants.js` | Measures vowel formants (F1, F2, F3) with LPC, the same basic method as Praat. No dependencies. |
| `recorder.js` | Records a clip from the mic and converts it to a 16 kHz WAV file. |
| `accent-model.js` | Runs the accent model in the browser (onnxruntime-web). |
| `accent-model.onnx`, `accent-labels.json` | The accent model itself. **Not included**: you create them once with `accent-server/export_model.py` (see below). |
| `config.js` | Chooses whether the accent check runs in the browser (default) or on a server. |
| `index.html`, `app.js` | Live data page. |
| `vowels.html`, `vowels.js` | Vowel chart page. |
| `accent.html`, `accent.js` | Accent check page. |
| `style.css` | Styling for all pages (light and dark mode). |
| `accent-server/` | Python tools: `export_model.py` makes the browser model; `app.py` is an optional server version. **Don't upload this folder to your website.** |

Libraries load free from the jsDelivr CDN: **Meyda** (timbre features), **Pitchy** (pitch detection) and **onnxruntime-web** (runs the accent model).

## Run the website on your computer

Browsers block these module files when you double-click `index.html`, so serve the folder locally. In a terminal inside this folder, run one of these:

```bash
npx serve .              # needs Node.js
python3 -m http.server   # needs Python
```

Open the address it prints (for example `http://localhost:3000` or `http://localhost:8000`). `localhost` counts as secure, so the mic works.

## Set up the accent check (once)

The accent model runs inside the visitor's browser, so there's no server to host. You just need to create the model file once, on your computer:

```bash
cd accent-server
source .venv/bin/activate      # the environment you made for the server; see accent-server/README.md if you don't have one
pip install onnx onnxruntime
python export_model.py
```

This downloads the CommonAccent model (if it isn't already cached), converts it, checks that the converted version gives the same answers, and writes two files into the website folder: `accent-model.onnx` (about 21 MB) and `accent-labels.json`. Then the Accent check page works anywhere you publish the site.

Visitors download the model the first time they use the page (about 21 MB); after that it loads from their browser's cache.

## Put the website online (needed for phones)

Phones require **HTTPS** for microphone access. The easiest free options:

- **Netlify Drop**: go to app.netlify.com/drop and drag the website folder onto the page. You get an HTTPS link right away.
- **GitHub Pages**: push the website files to a GitHub repo, then turn on Pages in the repo settings.
- **Cloudflare Pages**: also free, and works the same way.

**Leave out the `accent-server` folder** when you upload. It holds your Python environment and a copy of the model, hundreds of MB the website doesn't need. The easiest way is to move `accent-server` somewhere else before dragging the folder, or to make a separate folder with only the website files: the `.html`, `.js`, `.css`, `.onnx` and `.json` files.

On iPhone, audio only starts after a tap, which the Start buttons handle.

---

## Live data page

1. **Start mic** and allow access.
2. **Calibrate noise**: stay quiet for 1.5 seconds. This measures your room and sets the noise gate, so background hum isn't counted as voice.
3. Talk, sing, read aloud. Frames record automatically.
4. **Download JSON** or **Download CSV**.

### What each frame contains

```json
{
  "t": 3.475,          // seconds since start
  "rms": 0.0821,       // loudness, 0–1 (raw amplitude)
  "db": -21.7,         // loudness in dBFS (0 is max, -60 is very quiet)
  "active": true,      // above the noise gate (probably voice, not room noise)
  "pitch": 182.4,      // fundamental frequency in Hz, or null if silent/unreliable
  "clarity": 0.96,     // pitch confidence 0–1 (readings under 0.9 are dropped)
  "f1": 640,           // first formant (Hz): how open the mouth is
  "f2": 1190,          // second formant (Hz): tongue front/back
  "f3": 2390,          // third formant (Hz): lip rounding, "r" sounds
  "centroidHz": 1840,  // spectral centroid: higher = brighter/sharper voice
  "flatness": 0.012,   // 0 = tonal (vowels), toward 1 = noisy (s, sh, breath)
  "zcr": 210,          // zero-crossing count: high for hissy consonants
  "mfcc": [ ... 13 numbers ... ]  // timbre fingerprint, used in voice recognition
}
```

Formants are only measured on voiced frames (where there's a pitch); otherwise they're `null`. Timbre fields are `null` below the noise gate.

## Vowel chart page

Tap **Start**, stay quiet for a moment while it measures the room, then say each word as it appears: *heed, hid, head, had, hod, hawed, hood, who'd, hud, heard*. It detects when you finish a word and moves on by itself. Use **Redo** or **Skip** if one goes wrong.

For each word it finds the steady middle of the vowel and takes the median F1 and F2. On the chart:
- **Up/down** is F1 (mouth openness): “heed” at the top, “had” at the bottom.
- **Left/right** is F2 (tongue position): front vowels like “heed” on the left, back vowels like “who'd” on the right.
- The dashed outline is a reference: the classic American English averages from Peterson & Barney (1952). The page picks the lower- or higher-voice set from your pitch, or you can choose one.

Things that show up clearly: the cot–caught merger (“hod” and “hawed” landing in the same place), “who'd” being said further forward, and the British versus American “had”.

**Accuracy:** I tested the formant tracker on synthetic vowels with known formants. Typical error was about 3%, and it held up with moderate background noise (20 dB signal-to-noise). It gets worse with very high-pitched voices (children, sopranos), a lot of background noise, or a far-away mic. LPC formant tracking always has these limits, and Praat has them too.

## Accent check page

Read the passage aloud (about 20 seconds; at least 5). Tap **Stop and analyze**. The page converts the clip to 16 kHz, runs the model on the device, and shows the closest matches as percentages. It takes a few seconds; phones are slower than computers. You can also analyze an existing audio file, and download the result or the recording.

The model is **CommonAccent** (ECAPA version, MIT license), trained on Mozilla Common Voice. Its groups are: United States, England, Australia, India / South Asia, Canada, Bermuda, Scotland, Africa (various), Ireland, New Zealand, Wales, Malaysia, Philippines, Singapore, Hong Kong and South Atlantic. Limits worth telling your users:
- It can't tell regions within a country apart.
- Mixed and regional accents get matched to the nearest group.
- Results are less reliable with noise or short clips.
- The percentages show how much the model leans toward each group, not how “strong” an accent is.

The passage is original. You could swap in the Speech Accent Archive's “Please call Stella” paragraph if you want to compare against that archive's recordings.

**Server mode (optional).** `accent-server/app.py` runs the same model as a web service. To use it instead, set `ACCENT_MODE = "server"` in `config.js` and put the server's address in `ACCENT_SERVER`. The in-browser mode is simpler and free, so you normally won't need this.

## How background noise is handled

- **Filters** cut everything below 80 Hz (rumble, AC hum) and above 8 kHz (hiss). You can toggle this off on the Live data page.
- **Noise gate**: frames quieter than about 3× the calibrated room noise are marked `active: false`.
- **Pitch confidence**: pitch readings with clarity below 0.9 become `null`, and formants are skipped too.
- **Browser noise suppression** is off by default because it reshapes the voice.

It cannot separate two people talking at once.

## Using the engine in your own site

```js
import { VoiceAnalyzer } from "./voice-analyzer.js";

const va = new VoiceAnalyzer({ hopMs: 25 });   // see DEFAULTS in the file for all options
va.onFrame = (frame) => {
  // feed your visualization here: frame.pitch, frame.f1, frame.f2, ...
};

button.onclick = async () => {
  await va.start();        // must run from a click or tap
  await va.calibrate();    // optional but recommended
};

// later
va.stop();
const json = va.toJSON();
const csv = va.toCSV();
```

`analyzeBuffer()` and `estimateFormants()` are plain functions, so you can also run them on recorded audio files.

## Good next steps

- **Speaker normalization** (e.g. Lobanov) so vowel charts from different people can be overlaid fairly.
- **Speech-to-text** with Whisper in the browser (transformers.js) to line up words with the data and measure speaking rate.
- **Jitter/shimmer** (voice stability) via Parselmouth, added to the accent server.
