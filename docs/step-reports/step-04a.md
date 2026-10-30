# Step 04a report - File tabs, file access, file-type handlers, image viewer

Dates: 2026-10-30. Status: **done on local `testing` (automated checks); the owner's hand checks and the final screenshots/speed run are at the end of the batch**. Nothing was pushed and `main` was not touched.

## How to try it

```powershell
$env:CARGO_TARGET_DIR="$env:TEMP\adperastra-target"
npx -y @tauri-apps/cli@2 build --no-bundle
& "$env:TEMP\adperastra-target\release\Adperastra.exe"
```

Do not run `scripts\package-app.ps1` or `scripts\package-setup.ps1`; they use the owner's signing key.

## Owner checklist

Use a folder with a few pictures (PNG, JPG, an animated GIF, an SVG) and a ZIP file.

1. Double-click a PNG: a tab opens next to the Explorer tab with the picture fitted to the window; the Explorer tab shrinks to its house icon; the status bar shows the image size, the file size, Fit and the zoom slider.
2. Ctrl+mouse wheel zooms toward the pointer; Ctrl+= and Ctrl+- zoom; Ctrl+0 fits again; when zoomed in, dragging moves the picture.
3. An animated GIF animates; an SVG shows; a transparent PNG shows the checkerboard.
4. Double-click the same PNG again in the Explorer: no second tab, its tab is selected.
5. Middle-click another picture in the list: a new tab appears but the Explorer stays visible.
6. Close the picture tab (x, middle-click on the tab, or Ctrl+W): the Explorer comes back in the same folder, with the same selection and scroll position.
7. In a picture tab press Delete and Ctrl+A: nothing happens to the files in the Explorer. Drag a file from Windows Explorer onto the picture tab: nothing is copied anywhere.
8. In a picture tab, click "Show in folder" (up arrow): the Explorer opens the folder with the picture selected. Click a folder in the path: the Explorer opens that folder.
9. Double-click a ZIP (or any type without a viewer): it opens in its Windows app, as before. Right-click a PNG > Open in Windows app: it opens in the Windows photo app.
10. Rename a picture that has an open tab (from the Explorer), then press Reload in the tab: the tab shows "This file was moved or deleted." with Open folder and Close tab.
11. Open two pictures, close the app, start it again: both tabs come back, the active one selected.
12. Spanish and dark theme: repeat 1, 8 and 10.

## What works

- File tabs from the Explorer: double-click, middle-click in the background, one tab per file, close with x / middle-click / Ctrl+W, and the Explorer keeps its folder, selection and scroll while hidden.
- Open pipeline and handler registry (contract 13): content detection from the first 8 KB (`infer`) plus the extension; a handler's view is lazy-loaded; a type with no handler opens in the Windows app; "Open in Windows app" is in the item menu.
- `adpfile` protocol: one random token per open file (`file_grant`), served only to the main window, byte ranges for later media, token removed on close (`file_revoke`).
- Image viewer: fit, 5-1600 % zoom, Ctrl+wheel toward the pointer, drag to pan, rotate left/right, actual size, checkerboard behind transparency, animated GIF and SVG through the browser decoder, 256 MB limit.
- Session: open file tabs are stored with their path and handler and restored after a restart.
- Help pages "Opening files in tabs" and "Viewing images" in English and Spanish.
- The Explorer ignores keyboard shortcuts and drops while a file tab is visible, so Delete or a drop cannot act on a hidden selection.

## Not in this step (on purpose)

- Text, code and Markdown viewers, search on file tabs, Back/Forward, and the ribbon: Step 04b.
- Audio and video, protected view, "Open as text/hex", and Settings > Default apps: Step 04c.
- Editing, rotating and saving images: later image-editor steps.
- Scroll position and zoom in the saved tab state: Step 09a.

## Decisions and plan changes made during the step

- A file's bytes reach the UI only through `adpfile` with a per-file token; no path is put in a URL (R-SEC-5).
- Content wins over the extension: an image named `.dat` opens as an image.
- The Explorer stays mounted while hidden; at most 8 file tabs keep their views mounted (the active one and the 7 most recently used).
- The image viewer uses the browser's `<img>` decoder, fit-to-window and a 5-1600 % zoom range; no image library was added.
- The session stores `path` and `handler` only; zoom and scroll arrive with tabs in Step 09a.
- Recipe adaptations: `App.tsx` kept the Step 03a/03b keyboard and accessibility changes; `ExplorerHome.openOne` kept the `.lnk`/fallback outcome; the key handler kept the dialog guard; the measure script's literal step anchor was already replaced by the dynamic `-Step`; the isolation allowlist is one line; `ImageView` uses an imported React mouse-event type; pseudo was generated with the P2 generator.

## Speed (development PC, packaged release build)

| Interaction | Tier | Measured (median) | Result |
|---|---|---|---|
| Open a 1920x1080 PNG in a tab (first view) | Fast 1 s | <pending> | <pending> |
| Switch from a file tab to the Explorer | Instant 0.1 s | <pending> | <pending> |
| App start with one restored image tab | Fast 1 s | <pending> | <pending> |
| Earlier rows | as before | <pending> | not more than 20 % slower than Step 03b |

Raw numbers: `docs/benchmarks/2026-10-30-ui-step04a.json` (pending).

## Checks by hand

| Check | English light | Spanish dark | Result |
|---|---|---|---|
| All 12 owner steps | waiting | waiting | waiting for the owner |

## Verification

- `.\scripts\gate.ps1` (without `-Package`, which uses the signing key): **GATE PASSED** — Rust formatting, clippy with warnings as errors, 156 Rust tests, 380 translation keys, the Tauri IPC check (51 commands, 50 invoke calls), 108 UI tests, and the UI build.
- New tests include `tabs.test.ts` (open/close/activate/restore, one tab per file), `handlers.test.ts` (detection and registry order), `imageZoom.test.ts` (zoom steps and clamping), `explorerActive.test.tsx` (the hidden Explorer ignores keys), and `errors.test.ts` (translated `files.*` codes).
- The base check lists eight files changed by Step 03b; the 04a recipe was applied to the current code where its "find exactly" text moved, with the Step 03a/03b behavior preserved.

## Screenshots

`docs/screenshots/step-04a/`: all earlier screens plus `12-image-tab`, in English light, Spanish dark and the pseudo-locale (pending at the end of the batch).

## Known issues

- New: none found by the automated checks.
- Fixed: none.
- Still open: KI-001, KI-002, KI-004, KI-005, KI-009, KI-015, KI-016, KI-024, KI-030 (Minor); KI-003 (Major, after-reboot startup measurement, not touched by this step).
- The owner's 12 hand checks are still waiting; problems found become `F` tasks.

## Design deviations, dependencies, licenses

- `DESIGN_DEVIATIONS.md`: "2026-10-30 - File tabs and the image viewer (Step 04a)" (agent decision, for owner review).
- New dependencies: `infer` 0.22 (MIT) and `uuid` 1 (Apache-2.0 OR MIT), recorded in `THIRD_PARTY_LICENSES.md` and `docs/dependency-and-license-table.md`.

## Commits

- `18d26ee` deps: add infer 0.22 (MIT) and uuid 1 (Apache-2.0 OR MIT) [step-04a/T1]
- `6968674` feat(files): file detection, access tokens and the adpfile protocol [step-04a/T2]
- `32f7756` feat(files): typed wrappers for file access and error codes [step-04a/T3]
- `cd74682` feat(viewer): handler registry, open pipeline and the image viewer [step-04a/T4]
- `0b47ca4` feat(tabs): pure tab model with file tabs and session restore [step-04a/T5]
- `76780ca` docs(help): opening files in tabs and viewing images [step-04a/T6]
- `dfc69be` feat(tabs): the file tab view with its navigation row and status bar [step-04a/T7]
- `ad8549f` feat(explorer): open files in tabs, Open in Windows app, and no shortcuts or drops while hidden [step-04a/T8]
- `be93630` feat(tabs): open files in tabs from the Explorer and restore them after a restart [step-04a/T9]
- `9c60fab` test(bench): measure opening an image in a tab and switching tabs [step-04a/T10]

## Next step

Step 04b: Ribbon framework, text and code viewer, Markdown viewer (in progress in a parallel worktree), then 04c.
