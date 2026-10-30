# Step 01a: Setup window and first-run pack checklist (★)

**Needs:** 00. **Builds:** setup window, dependency manifest. **Design:** not in Figma; design it in the same style and show me first.

## Tasks
- **Setup window (runs before the Explorer):** a tiny native launcher written in Rust with a native UI, so it works even before the webview runtime exists. It reads a signed `dependencies.json` manifest listing each required component with its exact version range, source, checksum, and size (for example the WebView2 Runtime, the Visual C++ runtime if any part needs it, and bundled fonts).
  - **Normal start:** verify the manifest without opening any window, then start the main app, within the "Instant" tier (`speed.md`), so it never slows down startup.
  - **Missing or broken component:** show a small window (app logo, "Preparing Adperastra", one progress bar per component with size, Cancel and Retry), install exactly the pinned version to the app's own folder when possible (system-wide only when unavoidable, explaining why), verify checksums, then open the Explorer. Offline: say what is missing and how to get it.
  - **Repair:** a "Repair" option (in Settings later, and as a command-line flag now) re-runs the check.
  - Never install anything without showing it in this window; log everything locally.
- **First run only (one-time checklist):**
  1. Choose the app language and theme.
  2. **Optional packs checklist:** a list of optional packs with a short description of what each enables, its download size, and the free disk space; required components are shown as included and can't be unchecked. Examples: Office engine (viewing/converting/editing Office files), media tools (audio/video conversion and editing), extra OCR languages, AI image tools, AI upscaler, AI assistant (with the RAM it needs and a note that it runs offline), photo search. Nothing optional is selected by default.
  3. Say clearly that packs can be added or removed later only in Settings > App storage.
  - Until the pack manager exists (Step 12a), save the user's choices and show the packs as "available in a later version"; Step 12a installs them from these saved choices.
- The setup window follows the app language and theme tokens (a native look matching the Figma style), and has help pages.

## Parts to consider
A small native Rust UI: egui (MIT/Apache-2.0) or plain Win32 via the `windows` crate (MIT/Apache-2.0). Not Slint (its royalty-free license has conditions; see `rules.md`). `reqwest` and `sha2` for downloads and checksums; `minisign` (MIT) or similar for manifest signatures.

## Help pages
Setup and first run; repairing the app.

## Done when
With all components present, the app starts with no setup window and no noticeable delay; deleting a required component makes the setup window repair it; on a fresh profile, the first-run language, theme, and pack choices are shown once and saved.
