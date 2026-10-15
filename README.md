# Voice to Data

A small website that listens to a microphone (computer or phone) and turns a voice into numbers you can save and visualize. It's one page (`index.html`): you read a short passage aloud, and it shows

- **live readouts** while you speak: pitch, musical note, loudness, brightness, pitch confidence and frames recorded, plus a level meter and pitch trace;
- **an accent check** when you stop: a free open-source model scores the recording against 16 groups of English accents;
- **a vowel chart**: every voiced moment of the recording plotted by its formants, next to a reference vowel shape.

You can also analyze an existing audio file instead of recording. Downloads: all data (JSON), frames (CSV) and the recording (WAV). All audio stays on the device.

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
| `index.html`, `app.js` | The page and its wiring: recording, live readouts, accent check, vowel chart, downloads. |
| `vowel-chart.js` | Draws the vowel chart and holds the Peterson & Barney reference values. |
| `style.css` | Styling (light and dark mode). |
| `accent.html`, `vowels.html` | Redirects to `index.html` for old links. `accent.js` and `vowels.js` are the old separate pages' scripts and are no longer used. |
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

This downloads the CommonAccent model (if it isn't already cached), converts it, checks that the converted version gives the same answers, and writes two files into the website folder: `accent-model.onnx` (about 21 MB) and `accent-labels.json`. Then the accent check works anywhere you publish the site.

Visitors download the model the first time they record or analyze a file (about 21 MB); after that it loads from their browser's cache.

## Put the website online (needed for phones)

Phones require **HTTPS** for microphone access. The easiest free options:

- **Netlify Drop**: go to app.netlify.com/drop and drag the website folder onto the page. You get an HTTPS link right away.
- **GitHub Pages**: push the website files to a GitHub repo, then turn on Pages in the repo settings.
- **Cloudflare Pages**: also free, and works the same way.

**Leave out the `accent-server` folder** when you upload. It holds your Python environment and a copy of the model, hundreds of MB the website doesn't need. The easiest way is to move `accent-server` somewhere else before dragging the folder, or to make a separate folder with only the website files: the `.html`, `.js`, `.css`, `.onnx` and `.json` files.

On iPhone, audio only starts after a tap, which the Start recording button handles.

---

## Using the page

1. Tap **Start recording** and allow the microphone.
2. Stay quiet for a second while it measures the room. This sets the noise gate, so background hum isn't counted as voice.
3. When it says go, read the passage. The readouts, level meter and pitch trace update live, and the vowel chart fills in.
4. Tap **Stop and analyze**. The readouts switch to typical values (medians) for the whole recording, the pitch trace shows the whole recording, and the accent result appears.
5. Download what you need.

Recording stops by itself after 2 minutes. The accent check needs at least 5 seconds and uses the first 30. Filters and browser noise suppression are under **Settings**; the accent check always gets the unfiltered audio.

**Analyze a file** runs the same measurements on an audio file (mp3, m4a, wav…), up to its first 2 minutes. For files, the noise gate is estimated from the quietest 10% of the clip.

### What each frame contains

```json
{
  "t": 3.475,          // seconds since the recording started
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

The JSON download has four parts: `meta` (time, source, length, sample rate, noise gate, settings), `summary` (typical pitch, loudness and brightness, counts, which vowel reference was shown), `accent` (all 16 scores, or `null` if the recording was too short) and `frames`.

## Vowel chart

Each voiced frame becomes a faint dot placed by F1 (up/down: mouth openness) and F2 (left/right: tongue position, front vowels on the left). A read passage mixes all the vowels and the glides between them, so the cloud is blurry by nature; its shape and edges are what matter: how far it reaches toward “ee” (top left), “ah” (bottom) and “oo” (right).

The dashed outline is a reference: the classic American English averages for ten vowels (heed, hid, head, had, hod, hawed, hood, who'd, hud, heard) from Peterson & Barney (1952). The page picks the lower- or higher-voice set from your pitch, or you can choose one.

**Accuracy:** I tested the formant tracker on synthetic vowels with known formants. Typical error was about 3%, and it held up with moderate background noise (20 dB signal-to-noise). It gets worse with very high-pitched voices (children, sopranos), a lot of background noise, or a far-away mic. LPC formant tracking always has these limits, and Praat has them too.

## Accent check

When you stop, the page converts the clip to 16 kHz, runs the model on the device, and shows the closest matches as percentages. It takes a few seconds; phones are slower than computers.

The model is **CommonAccent** (ECAPA version, MIT license), trained on Mozilla Common Voice. Its groups are: United States, England, Australia, India / South Asia, Canada, Bermuda, Scotland, Africa (various), Ireland, New Zealand, Wales, Malaysia, Philippines, Singapore, Hong Kong and South Atlantic. Limits worth telling your users:
- It can't tell regions within a country apart.
- Mixed and regional accents get matched to the nearest group.
- Results are less reliable with noise or short clips.
- The percentages show how much the model leans toward each group, not how “strong” an accent is.

The passage is original and short (about 10 seconds). Any text works, because the accent model ignores the words and listens only to how they sound; edit it in `index.html` (the `passage` block). Longer readings give steadier accent results, and words with many different vowels fill out the vowel chart. This one covers most English vowels, including “hot” and “coffee”, which show the cot–caught merger. You could swap in the Speech Accent Archive's “Please call Stella” paragraph if you want to compare against that archive's recordings.

**Server mode (optional).** `accent-server/app.py` runs the same model as a web service. To use it instead, set `ACCENT_MODE = "server"` in `config.js` and put the server's address in `ACCENT_SERVER`. The in-browser mode is simpler and free, so you normally won't need this.

## How background noise is handled

- **Filters** cut everything below 80 Hz (rumble, AC hum) and above 8 kHz (hiss). You can turn this off under Settings.
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
