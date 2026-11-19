# Lizard Lips Hot Suite

Browser-based post-production tools. Everything runs on the user's machine; no
files are uploaded anywhere.

`index.html` is the built suite — the file that gets deployed. Don't edit it.
It's generated from the files below.

The kit: Cut Logger, Loudness Analyser, Delivery QC (formerly Spec Checker),
Sub Sync and Preset Builder. Shot Logger is out of the kit until it reports
frame timecode; `tool_shotlogger.html` still works on its own, and adding its
row back to `TOOLS` in `build_hub.py` returns it to the suite.

## Layout

| | |
|---|---|
| `tool_*.html` | One file per tool. Each also works on its own in a browser. |
| `engine_spec.js` | The spec engine: spec parsing, media analysis, rule checks, frame scanning, audio comparison. |
| `audio_core.js` | Loudness measurement, and reading audio straight out of files. |
| `lib_loader.js` | Fetches outside libraries the first time a tool needs one, plus the shared PDF setup. |
| `build_hub.py` | Builds `index.html` from the tools. Also holds the shell and the shared theme. |
| `sync_engine.py` | Copies the three shared files into every tool that uses them. Run by the build. |
| `toolify.py` | Turns a standalone tool into a panel for the suite. |
| `detoolify.py` | The reverse. Only needed to recover a tool from a built `index.html`. |
| `monday-app/` | The spec checks as a monday.com item view. Kept out of this repo; the build skips it when it isn't there. |
| `tests/` | The test suite. |

## Building

```
python3 build_hub.py
```

Then deploy `index.html`.

## Delivery QC

Read a spec once, save it by name, and pick it from the list after that. A
saved spec carries its checklist, filename convention and content checks.
Specs live in the browser; **export** writes them all to one file and
**import** reads a colleague's, so London and Amsterdam check against the same
thing.

Drop the delivery and every file is checked in one pass. Loudness and true
peak run whenever the checklist asks for them. Each file's detail has a button
that opens it in the Loudness Analyser for the full audio picture.
**QC report (PDF)** writes one document for the delivery: what was checked,
every file's verdict and loudness, and the detail on anything that failed.

## Loudness

`audio_core.js` measures to ITU-R BS.1770-4 and EBU R128: gated integrated
loudness, loudness range per EBU Tech 3342, and 4x oversampled true peak. It
is checked against ffmpeg's `ebur128` on every run of the tests: integrated
within 0.1 LU, range within 0.2 LU, true peak within 0.2 dB, and within 0.1 dB
of the exact answer on a signal built to have peaks between samples.

Uncompressed audio is read straight out of the file, never decoded: QuickTime
(ProRes masters), WAV, BWF, RF64 and AIFF, in 8, 16, 24 and 32-bit integer
and 32 and 64-bit float, either byte order. Only the audio bytes are read, so
a master's picture is never loaded, and long masters stream through the meter
rather than sitting in memory. Delivery QC measures any length; the Loudness
Analyser, which holds the whole mix for its other checks, takes up to 20
minutes.

Which channels count: stereo as stereo, 5.1 as 5.1 with the LFE left out, two
mono tracks as left and right, and any other layout (an 8-channel master with
stems after the mix, say) as its first two channels. The result says which.

Compressed audio (AAC, MP3) is decoded by the browser, which resamples to its
own rate; readings on those can differ from a meter by a tenth or two.

## The spec engine

Delivery QC, Preset Builder and both monday app pages all share one engine.
**Edit it in `engine_spec.js` and nowhere else.** Each tool carries a copy
between `@@ENGINE:spec` markers, and the build overwrites those copies from
`engine_spec.js` every time.

This exists because the copies used to be maintained by hand and drifted: a fix
landed in one and not the others, and the monday app went on failing valid
files for a parsing bug long since fixed in the main tool. The audio core and
the library loader are shared the same way, between `@@ENGINE:audio` and
`@@ENGINE:libs` markers.

`python3 sync_engine.py --check` reports any copy that's out of step.

## Look and behaviour

One typeface, one set of controls, one layout for every tool. That all lives in
the theme block of `build_hub.py`, which loads after each tool's own styles.
Change a button or a panel there and all six tools change together.

The start screen takes a dropped file and opens it in the right tool; what each
tool accepts is the `TAKES` list in the same file. Number keys open tools, Esc
goes back.

## Speed

Nothing but the page and its font loads up front. A tool asks for a library
with `await needLib("pdfjs")` at the point it needs one. The build refuses a
tool that loads a library with a `<script src>` tag, so this can't slip back.

## Adding a tool

Put `tool_name.html` beside the others and add one row to `TOOLS` in
`build_hub.py`. If it needs the spec engine, add an empty marker pair where the
engine should go:

```
// @@ENGINE:spec BEGIN — generated from engine_spec.js by sync_engine.py. Do not edit here.
// @@ENGINE:spec END
```

then list the file in `CONSUMERS` in `sync_engine.py`.

## Tests

```
bash tests/run_all.sh
```

Needs Node with Playwright (`npm i playwright && npx playwright install chromium`)
and ffmpeg plus ImageMagick, which generate the test media on first run. The
exit code is non-zero if anything fails.

Run it before deploying. Every test traces back to a bug that actually shipped:
timecode that was hours or minutes out, subtitles silently dropped, corrupt
files reported as passing QC, errors that flashed and vanished.

The tests run in headless Chromium, which can't decode H.264, ProRes or AAC,
so the decoding fixtures are WebM. Real Chrome handles H.264 and AAC, but
anything that decodes audio or video is only verified here with open codecs.
Loudness on ProRes masters doesn't decode anything, so it is tested on real
ProRes files.
