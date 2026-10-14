# Voice to Data

A browser page that listens to a microphone (computer or phone) and turns the voice into a stream of numbers you can save and visualize. Free, no accounts, no API keys, and the audio never leaves the device.

## Files

| File | What it does |
|---|---|
| `voice-analyzer.js` | The engine. Mic → filters → analysis → data frames. Reuse this in your real site. |
| `app.js` | The demo page's buttons, readouts, level meter and pitch trace. |
| `index.html` | The demo page. |
| `style.css` | Styling (light and dark mode). |

Libraries load free from the jsDelivr CDN: **Meyda** (timbre features) and **Pitchy** (pitch detection).

## Run it on your computer

Browsers block these module files when you double-click `index.html`, so serve the folder locally. In a terminal inside this folder, run one of these:

```bash
npx serve .              # needs Node.js
python3 -m http.server   # needs Python
```

Open the address it prints (for example `http://localhost:3000` or `http://localhost:8000`). `localhost` counts as secure, so the mic works.

## Run it on your phone

Phones require **HTTPS** for microphone access. The easiest free options:

- **Netlify Drop**: go to app.netlify.com/drop and drag this folder onto the page. You get an HTTPS link right away.
- **GitHub Pages**: push the folder to a GitHub repo, then turn on Pages in the repo settings.
- **Cloudflare Pages**: also free, and works the same way.

On iPhone, audio only starts after a tap, which the Start button handles.

## Using it

1. **Start mic** and allow access.
2. **Calibrate noise**: stay quiet for 1.5 seconds. This measures your room and sets the noise gate, so background hum isn't counted as voice.
3. Talk, sing, read aloud. Frames record automatically (about 40 per second).
4. **Download JSON** or **Download CSV**.

## What each frame contains

```json
{
  "t": 3.475,          // seconds since start
  "rms": 0.0821,       // loudness, 0–1 (raw amplitude)
  "db": -21.7,         // loudness in dBFS (0 is max, -60 is very quiet)
  "active": true,      // above the noise gate (probably voice, not room noise)
  "pitch": 182.4,      // fundamental frequency in Hz, or null if silent/unreliable
  "clarity": 0.96,     // pitch confidence 0–1 (readings under 0.9 are dropped)
  "centroidHz": 1840,  // spectral centroid: higher = brighter/sharper voice
  "flatness": 0.012,   // 0 = tonal (vowels), toward 1 = noisy (s, sh, breath)
  "zcr": 210,          // zero-crossing count: high for hissy consonants
  "mfcc": [ ... 13 numbers ... ]  // timbre fingerprint, used in voice recognition
}
```

Timbre fields (`centroidHz`, `flatness`, `mfcc`) are `null` when the frame is below the noise gate.

## How background noise is handled

- **Filters** cut everything below 80 Hz (rumble, AC hum) and above 8 kHz (hiss). You can toggle this off.
- **Noise gate**: frames quieter than about 3× the calibrated room noise are marked `active: false`.
- **Pitch confidence**: pitch readings with clarity below 0.9 become `null`.
- **Browser noise suppression** is off by default because it reshapes the voice. Turn it on for very noisy places if you accept less accurate data.

It cannot separate two people talking at once. Another voice nearby looks just like the user's.

## Using the engine in your own site

```js
import { VoiceAnalyzer } from "./voice-analyzer.js";

const va = new VoiceAnalyzer({ hopMs: 25 });   // see DEFAULTS in the file for all options
va.onFrame = (frame) => {
  // feed your visualization here
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

`analyzeBuffer()` is also exported, so you can run the same analysis on recorded audio files later.

## Good next steps

- **Formants** (vowel shape) and **jitter/shimmer** (voice stability), via Praat/Parselmouth on a small Python backend.
- **Speech-to-text** with Whisper running in the browser (transformers.js) to line up words with the data.
- **Voice activity detection** (`@ricky0123/vad-web`) for a smarter gate than loudness alone.
