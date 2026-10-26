# Voiceprint

A small website that listens to a microphone (computer or phone) and turns a voice into numbers you can save and visualize. It has five pages:

| Page | What it does |
|---|---|
| **Voiceprint** (`index.html`) | The landing page: an endless honeycomb of the archive's newest voice portraits, all turning and drifting slowly on a diagonal (one shared 3D renderer draws them all). It's a backdrop only, with nothing to click or drag (browsing voices is the Archive's job), so the focus stays on the intro and the **Add your voice** button, which leads to Record. The nav here leaves out the Record tab, since the button does that job. |
| **Record** (`record.html`) | Enter a name or nickname, tap Start, wait for the 3-2-1 countdown (it measures room noise meanwhile), then read the passage. Words light up as you read; pitch and loudness show live. Tap Done to listen back, then choose **Use this recording** (it's saved and the breakdown opens) or **Try again** (it's thrown away and the countdown restarts). |
| **Your data** (`breakdown.html`) | Everything measured from one recording: typical pitch, note, loudness, brightness, pitch confidence, frames; pitch over time with pauses shaded; the 16-group accent result; rhythm; the vowel chart; playback and downloads (JSON, CSV, WAV). Opens `?id=…`, or the latest recording. |
| **Portrait** (`portrait.html`) | A living, explorable portrait (animated SVG) made from one recording: a glowing bloom whose body is shaped by the voice's timbre, with one strand per moment. Each strand's color, reach, sharpness, glow and flicker come from that moment's data; the bloom breathes at the speaking tempo. Every voice grows a different creature, all at the same size. Hover or tap any part, or a measurement in the side list, to see what it shows. Adapts to light and dark mode; respects reduced-motion settings. Download as SVG (animated) or PNG. |
| **Archive** (`archive.html`) | Every voice recorded on the site, newest first, as cards with a mini pitch line, pitch, pace and closest accent. Each links to its breakdown. |

**Recordings are never kept.** Only the name and the measurements are saved. The person can play their recording back on their results page; then it's deleted, including from that browser, so the next person on a shared computer can't replay it. (The word highlighting uses the browser's speech recognition, which in Chrome sends audio to Google; see *Recording*.)

**Where things are stored.** With the shared archive set up (see *Set up the shared archive*), names and measurements go to a Supabase database, so the archive is the same on every device. Until then, everything is saved only in each visitor's browser (IndexedDB) and the archive shows that device only.

Everything is free: no accounts, no API keys.

## Files

| File | What it does |
|---|---|
| `voice-analyzer.js` | The engine. Mic → filters → analysis → data frames. Reuse this in your real site. |
| `formants.js` | Measures vowel formants (F1, F2, F3) with LPC, the same basic method as Praat. No dependencies. |
| `recorder.js` | Records a clip from the mic and converts it to a 16 kHz WAV file. |
| `accent-model.js` | Runs the accent model in the browser (onnxruntime-web). |
| `accent-model.onnx`, `accent-labels.json` | The accent model itself. **Not included**: you create them once with `accent-server/export_model.py` (see below). |
| `config.js` | Settings: where the accent check runs, and the shared archive's Supabase address and key. |
| `index.html`, `home.js` | Landing page: the portrait honeycomb and the way in to recording. |
| `record.html`, `app.js` | Record page: name, countdown, recording, analysis, saving. |
| `breakdown.html`, `breakdown.js` | Breakdown page for one saved recording. |
| `archive.html`, `archive.js` | Archive page. |
| `portrait.html`, `portrait-page.js` | Portrait page. |
| `portrait.js` | Builds the portrait SVG. **All the data → visual rules are in its `MAP` section at the top**, with comments; change them there. Each element is tagged with `data-key` so the page can explain it; the plain-language explanations are in `features()` (the `legend` list). |
| `store.js` | Saves and loads recordings' data: the shared archive (Supabase) when set up, plus a copy in the browser (IndexedDB). |
| `supabase-setup.sql` | Run once in Supabase to create the archive's table and permissions. |
| `shared.js` | Helpers the pages share: summary values, pitch trace drawing, the accent check, downloads. |
| `progress.js` | Lights up the passage word by word while it's read, using the browser's speech recognition. |
| `rhythm.js` | Finds pauses and works out speaking rate from the frames. |
| `vowel-chart.js` | Draws the vowel chart and holds the Peterson & Barney reference values. |
| `style.css` | Styling (light and dark mode). |
| `accent.html`, `vowels.html` | Redirects to `record.html` for old links. `accent.js` and `vowels.js` are the old separate pages' scripts and are no longer used. |
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

Visitors download the model the first time they record (about 21 MB); after that it loads from their browser's cache.

## Set up the shared archive (once)

1. Create a free account and project at [supabase.com](https://supabase.com). Any name and region; note the database password somewhere safe.
2. In the project, open **SQL Editor → New query**, paste the whole of `supabase-setup.sql`, and click **Run**. This creates a `takes` table. Visitors can add entries and read the archive, but can't change or delete anything.
3. Open **Project Settings → API** (or **Data API**) and copy the **Project URL** and the **anon / publishable** key into `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `config.js`. This key is designed to be public. Never put the `service_role` / secret key in the website.
4. Publish the site. New recordings now go to the shared archive.

**Removing an entry** (for example if someone asks): in Supabase, tick its row in **Table Editor → takes** and click **Delete**.

**Limits to know.** The free tier has had about 500 MB of database and 1 GB of file storage (check supabase.com/pricing for current limits). Each recording is roughly 100–150 KB of data, so that's a few thousand voices. Free projects pause after a week with no activity; open the dashboard to wake one. Anyone can add entries, so expect to clean up the odd junk name.

## Put the website online (needed for phones)

Phones require **HTTPS** for microphone access. The easiest free options:

- **Netlify Drop**: go to app.netlify.com/drop and drag the website folder onto the page. You get an HTTPS link right away.
- **GitHub Pages**: push the website files to a GitHub repo, then turn on Pages in the repo settings.
- **Cloudflare Pages**: also free, and works the same way.

**Leave out the `accent-server` folder** when you upload. It holds your Python environment and a copy of the model, hundreds of MB the website doesn't need. The easiest way is to move `accent-server` somewhere else before dragging the folder, or to make a separate folder with only the website files: the `.html`, `.js`, `.css`, `.onnx` and `.json` files.

On iPhone, audio only starts after a tap, which the Start button handles.

---

## Recording

1. Enter a name or nickname and tap **Start**, then allow the microphone.
2. Stay quiet during the 3-2-1 countdown. It measures the room in the first 1.5 seconds and sets the noise gate, so background hum isn't counted as voice.
3. At **Go!**, read the passage. Pitch, note, loudness, the level meter and a pitch trace update live.
4. Tap **Done**. You can play the recording back and choose:
   - **Use this recording**: the page finishes measuring rhythm and the accent (this starts in the background while you listen), adds the take to the archive and opens its breakdown.
   - **Try again**: the recording and its measurements are discarded and the countdown starts over with the same name. Nothing is saved.

While you read, the passage lights up word by word. `progress.js` does this with the browser's built-in speech recognition (Web Speech API), matching the words it hears to the passage in order and forgiving misheard or skipped words. **Privacy:** only the highlighting uses it, and every measurement still runs on the device, but in Chrome the recognizer sends that audio to Google (Safari can run it on the device). The page no longer mentions this on screen. Browsers without it (such as Firefox) show the passage without highlighting. Recording stops by itself after 2 minutes. The accent check needs at least 5 seconds and uses the first 30. Filters and browser noise suppression are under **Settings**; the accent check always gets the unfiltered audio.

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

The breakdown page's JSON download has five parts: `meta` (name, time, source, length, sample rate, noise gate, settings, passage), `summary` (typical pitch, note, loudness, brightness, pitch confidence, counts, which vowel reference was shown), `rhythm`, `accent` (all 16 scores, or `null` if the recording was too short) and `frames`.

## Rhythm

After you stop, the page finds the pauses using the same sound/silence decision as the noise gate:
- Silence before the first sound and after the last is ignored.
- Silences shorter than 0.2 s count as speech (consonants like “t” and “k” make tiny gaps), and sounds shorter than 0.06 s inside a pause (clicks) are ignored.

The breakdown shows the number of pauses, total and longest pause, a talking/pausing timeline, and shades the pauses on the pitch trace. **Speaking rate** is the passage's syllable count (42, set with `data-syllables` on the passage in `record.html`; update it if you change the text) divided by the reading time. The JSON also has **articulation rate**, which counts only the time spent talking.

Pause detection depends on the noise gate, so a noisy room can hide short pauses.

## Vowel chart

Each voiced frame becomes a faint dot placed by F1 (up/down: mouth openness) and F2 (left/right: tongue position, front vowels on the left). A read passage mixes all the vowels and the glides between them, so the cloud is blurry by nature; its shape and edges are what matter: how far it reaches toward “ee” (top left), “ah” (bottom) and “oo” (right).

The dashed outline is a reference: the classic American English averages for ten vowels (heed, hid, head, had, hod, hawed, hood, who'd, hud, heard) from Peterson & Barney (1952). The page picks the lower- or higher-voice set from your pitch, or you can choose one.

**Accuracy:** I tested the formant tracker on synthetic vowels with known formants. Typical error was about 3%, and it held up with moderate background noise (20 dB signal-to-noise). It gets worse with very high-pitched voices (children, sopranos), a lot of background noise, or a far-away mic. LPC formant tracking always has these limits, and Praat has them too.

## Accent check

When you tap Done, the page converts the clip to 16 kHz, runs the model on the device, and shows the closest matches as percentages. It takes a few seconds; phones are slower than computers.

The model is **CommonAccent** (ECAPA version, MIT license), trained on Mozilla Common Voice. Its groups are: United States, England, Australia, India / South Asia, Canada, Bermuda, Scotland, Africa (various), Ireland, New Zealand, Wales, Malaysia, Philippines, Singapore, Hong Kong and South Atlantic. Limits worth telling your users:
- It can't tell regions within a country apart.
- Mixed and regional accents get matched to the nearest group.
- Results are less reliable with noise or short clips.
- The percentages show how much the model leans toward each group, not how “strong” an accent is.

The passage is short (about 8 seconds): “Momo is a small poodle and she is the color of milk chocolate. She has fluffy fur, a good nose for snacks, and she barks at every red truck that passes our house.” Any text works, because the accent model ignores the words and listens only to how they sound; edit it in `record.html` (the `passage` block), and update its `data-syllables` count. Longer readings give steadier accent results, and words with many different vowels fill out the vowel chart. The vowel chart's corner labels (in `vowel-chart.js`) and the “things to look for” notes on `breakdown.html` use words from the passage, so update them too. You could swap in the Speech Accent Archive's “Please call Stella” paragraph if you want to compare against that archive's recordings.

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
