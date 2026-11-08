# Desktop screenshot capture

The capture-only Vite config replaces data hooks and shell calls with synthetic data; production modules and styles are unchanged. It renders the real app and screens, using the committed synthetic scan and brief augmented with a long title, extended explanation and unbroken diagnostic paths, plus synthetic Library, Review and Settings state. Screenshots do not contain local transcripts. The fixed clock, timezone, locale, viewport, color scheme and device scale factor make runs comparable. Chromium is used rather than Tauri's native WebKit, so confirm platform-specific behavior in the app separately.

From `desktop/`:

```sh
pnpm install --frozen-lockfile
pnpm exec vite --config capture/vite.config.js --host 127.0.0.1
# In a second terminal:
CHROMIUM_PATH=/path/to/chromium node capture/capture.mjs
```

The default executable is `/usr/local/bin/chromium`; set `CHROMIUM_PATH` for another installation. Output defaults to `capture-output/<size>/<theme>/<state>.png`. Set `CAPTURE_DIR` to an output directory and `CAPTURE_SIZES=1200x800` to limit sizes. The default captures all three requested sizes in both themes. Each capture waits for a state-specific visible label and fonts and fails on page errors. Loading states are deliberately held by the fixtures.

The `*-lower` captures scroll overflowing panels to their ends. The brief, reader and revealed review variants also expand the source exchange first, so long content below the initial viewport is included.

For a contact sheet per size, install Pillow for Python and run `python3 capture/contact-sheet.py capture-output/1200x800 capture-output/1200x800.png` (repeat for the other size directories).
