# macOS widget spike

The sandboxed extension reads `widget-data.json` from its own container home (`~/Library/Containers/com.madebywelch.recap.widget/Data/widget-data.json`). The host is expected to write an atomic UTF-8 JSON snapshot with this shape:

```json
{"concepts": ["A concept to revisit"], "date": "2026-01-01", "dueCount": 3}
```

`concepts` contains up to three titles from today's brief; `dueCount` is an integer. A missing or malformed file shows the empty state. WidgetKit requests a refresh after 15 minutes, but controls the actual schedule. There is no app group. After writing a snapshot the host launches `Contents/MacOS/recap-widget-reload`, which requests a reload for the `RecapWidget` kind; WidgetKit controls when it runs. Direct cross-container writes are experimental: macOS 15 and later may prompt for access, and the host cannot write until macOS has created the extension container. Reopen Recap after adding the widget to retry. Cross-container access, helper-triggered reloads and widget discovery must be tested on a real Mac, including with the intended signing identity and sandbox configuration.

The release workflow uses the pinned XcodeGen 2.42.0 archive, builds the extension unsigned, signs it with the release identity (or ad hoc), and supplies `tauri.widget.conf.json` to Tauri so the signed extension is copied into the app before the app is signed and the DMG is created. For local packaging, reproduce those steps before passing `--config macos-widget/tauri.widget.conf.json` to `pnpm tauri build`; ordinary local Tauri builds do not include the widget. XcodeGen generates the project and Info.plist from `project.yml`; generated files and build products are ignored.
