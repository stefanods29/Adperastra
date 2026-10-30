# Step 03b report - File operations, jobs, undo, drag and drop, paste as file

Dates: 2026-10-28 to 2026-10-30. Status: **finished locally, not on `main`** (owner asked on 2026-10-30 not to push). Planned tag `v0.0.6-step03b`. Under the continuous-work decision (plan/STATUS.md, 2026-10-29) the owner checks it afterwards; problems found become `F` tasks.

## Decisions and plan changes

Owner decisions (2026-10-28, before building; recorded in `docs/step-plans/step-03b.md` and `DESIGN_DEVIATIONS.md`): the design preview for the jobs panel, conflict dialog, permanent-delete warning, Recent actions and paste-as-file was approved; the `trash` crate (MIT) is used for the Recycle Bin; conflicts offer Replace / Skip / Keep both with "Do this for all"; pasted images default to PNG; undoing a copy sends the copies to the Recycle Bin. On 2026-10-29 the owner made work continuous (no approval needed per step) and merged the plan folders into `plan/`.

Decisions made during the step (all written in the repository):

- **Replace never deletes** (ADR 0007): the item being replaced goes to the Recycle Bin first, so Undo brings it back.
- **Exact Undo for moves:** a move keeps a plan of exactly what changed on disk, so a cancelled or partly finished move undoes only what happened (KI-019).
- **System items ask first** for move, recycle, permanent delete and Replace (KI-020).
- **Setup window licenses:** the license audit found two bundled pieces outside the allowed list (R-LIC-1): egui's built-in Ubuntu font and `webpki-roots` (CDLA-Permissive-2.0). Both are gone: the setup window uses Inter, or the Windows UI font installed on the PC when Inter is missing (read at run time, never bundled), and downloads trust the Windows certificate store (`rustls-native-certs`, `schannel`).
- **License check scope:** the npm check covers what ships. Development-only packages never reach the app; `argparse` is a runtime dependency of markdown-it but only its command-line program uses it, so it is listed with that reason in `scripts/license-policy.json`.
- **WebView2 profile in the data folder** (R-BG-2): the window is now created in code with its profile under `<data>\webview`. Before, every instance shared one profile in `%LOCALAPPDATA%`, and a leftover instance made the next one fail to start; that was the CI runtime failure. The old folder is left behind once (KI-023, Minor).
- **CSP:** `connect-src` now also allows `ipc: http://ipc.localhost`, Tauri's local IPC endpoint (nothing on the network). Without it every command fell back to a slower path and logged a warning. Plan change: `plan/steps/step-04a.md` CSP recipe updated to match (commit `133fc2a`).
- **Event listeners:** the capability list was missing `core:event:allow-unlisten`, so listeners were never removed (a leak plus console errors). Added.
- **Speed gate:** a slower result is now judged by measuring this build and the previous step's tagged build alternately on the same PC (`scripts/measure-ab.ps1`). Comparing with numbers from another day was not a fair test: on this PC, with other desktop apps running, the same build varied by up to 2x between runs.

## How to build and run

```powershell
$env:CARGO_TARGET_DIR="$env:TEMP\adperastra-target"
.\scripts\package-app.ps1
.\build\Adperastra\Adperastra.exe
.\scripts\test-all.ps1 -Mode quick        # everything except speed, a few minutes
.\scripts\test-all.ps1 -Mode full         # adds all runtime variants and the speed gate
.\scripts\generate-corpus.ps1             # 100k-item test folder in %TEMP%
```

## Test checklist for the owner

Use a test folder with a few files and folders, in English and Spanish, light and dark.

1. **New** > Folder and **New** > Text document: the item appears with its name ready to edit. Ctrl+Z removes it (to the Recycle Bin).
2. Select two files, Ctrl+C, open another folder, Ctrl+V: copies appear; the toast's **Undo** removes them.
3. Ctrl+X a file and Ctrl+V it in another folder: it moves; Ctrl+Z moves it back; Ctrl+Y moves it again.
4. Paste the same files again into that folder: the conflict dialog asks. Clear **Do this for all**, choose **Replace** for the first and **Keep both** for the second: each choice is applied (KI-018). Ctrl+Z brings the replaced file back from the Recycle Bin.
5. Copy a large folder (several GB) to another drive: the jobs panel shows progress; press **Cancel**: no half-copied file is left. Then Ctrl+Z: only what was copied is removed.
6. **Delete** a file: it goes to the Recycle Bin (check in Windows); Ctrl+Z restores it. Shift+Delete warns that it cannot be undone; **Cancel** keeps the file.
7. With **View** > **Hidden items** on, try to move or delete a system file (for example `desktop.ini` in a folder): a warning asks first, with Cancel selected.
8. **See more** > **Recent actions**: the list shows what you did; Undo and Redo work from there.
9. Drag a file onto a folder in the list, the navigation pane and the address bar: Move on the same drive, Copy to another drive; hold Ctrl (copy), Shift (move), Alt (shortcut); the badge says which.
10. Drag files from Windows Explorer or the desktop into the app, and from the app to the desktop.
11. Take a screenshot (Win+Shift+S), then right-click empty space > **Paste as file**: a `.png` appears with its name selected. Copy some text and paste: a `.txt` (or `.md`/`.csv`) appears.
12. Open Help, press Tab until the current tab has focus, and use the arrow keys, Home and End to switch tabs; Ctrl+W closes the tab. The **x** still closes it with the mouse. With a screen reader (Narrator), move through the tabs, the column headers and the address bar: names and sort order are read out.
13. Rename a downloaded `AdperastraSetup` payload font (`payload\fonts\Inter.ttf`) and start the setup: the repair window still shows readable text.

## What works

- File operations through the command bar, menus and keyboard: New folder / text document, Cut, Copy, Paste, Rename, Delete (Recycle Bin), Shift+Delete (warning first), Paste as file.
- Jobs: copy, move, recycle, restore and delete run in the background with progress, Cancel and a list of skipped items; priorities foreground / normal / background are ready for later background work.
- Never losing data: no overwrite without a choice made first; Replace recycles the old item first; a cancelled copy removes only its partial file; a move between drives removes a source only after a complete copy; drive roots, Windows and Program Files are refused; links and loops are not followed.
- Undo and Redo for create, rename, copy, move, delete and Replace, from the toast, Ctrl+Z / Ctrl+Y, and Recent actions; exact for cancelled and partly finished moves.
- Drag and drop inside the app and with other apps, with Windows' modifier rules and a badge.
- Clipboard with Windows Explorer both ways (cut and copy), and paste as file for text and images.

## What deliberately does not work yet

- The full conflict window with previews and the copy window with pause and queue: Step 09f.
- "What's using this file?" for files in use: Step 09g (now a translated "in use" message).
- List and icon views: Step 05a (KI-015).

## Speed

Release build on the development PC with other desktop apps running, one run (`docs/benchmarks/2026-10-30-ui-step03b.json`; startup `2026-10-30-startup-step03b-final.json`). Measured before the last tab-strip change; that change only affects the tab strip.

| Interaction | Tier | Measured | Result |
|---|---|---|---|
| Select, Ctrl+click, type-ahead | Instant 0.1 s | 8.7, 7.5, 9.9 ms | Pass |
| Right-click menus, View and New menus | Instant 0.1 s | 4.7-9.9 ms | Pass |
| Rename box (F2) | Instant 0.1 s | 8.6 ms | Pass (over the 20% rule, KI-024) |
| Details pane filled, hide/show | Instant 0.1 s | 8.1, 6.7 ms | Pass |
| 100k folder: select, arrow, select all, right-click | Instant 0.1 s | 7.1, 10.2, 27.5, 8.2 ms | Pass |
| 100k folder: Shift+click range | Instant 0.1 s | 30.6 ms | Pass (over the 20% rule, KI-024) |
| 100k folder: scrolling, 95th percentile frame | Smooth | 16.4 ms | Pass (limit in docs/test-and-speed-plan.md) |
| Copy job; recycle + restore; Replace + Undo | Fast 1 s | 76, 439, 436 ms | Pass; one earlier run of recycle + restore took 2.2 s (owner: later) |
| Show more options | Fast 1 s | 741 ms | Pass |
| App start, runs 2-5 (first paint / ready) | Fast 1 s | 81-89 ms / 850-943 ms | Pass |
| First start of a fresh build | one-time | 983 ms / 1504 ms | Known one-time cost (KI-002) |

The side-by-side run against `v0.0.5-step03a` did not complete: `measure-ui` timed out on some attempts and the cause is not known. Under the owner's decision of 2026-10-30 this does not block the step, but a real hang is not ruled out. The 20% comparisons above are against one earlier run, on a PC where the same build varied up to 2x.

## Verification

`scripts/gate.ps1` arrives with P2, so these commands stood in for it. `scripts/test-all.ps1 -Mode full` was never run as one command, because the audit tools are not installed on this PC.

- Local, final code: `npm test` 82 passed; `npm run lint:i18n` passed (357 keys); help check passed (38 pages); verification helper tests 7 passed.
- Local, last Rust change included: `cargo fmt --check` and `cargo clippy -D warnings` clean; `cargo test --workspace` 124 passed. These were not rerun after the later UI and script changes.
- Local, final code: packaged runtime check passed in all six variants (English light, Spanish dark, pseudo; 100% and 150%), 17 checks each, no console errors, no WCAG A/AA violations, including the tab strip with a closable tab and keyboard tab switching.
- GitHub: 14/14 at `904cdd5` (run 41087578938). `f650cfe` failed 13/14 on a startup race in the runtime check, fixed afterwards. **The final code has not run on GitHub**, because it is not pushed. `main` requires that check.
- Not run: GitHub's full mode (speed check on port 9444 is untested there); the by-hand runtime workflow (usable only once on `main`); the owner's hand checks; Narrator.
- Plan review ran twice. All Blockers and Should-fix items are addressed; the tab keyboard gap it found is fixed. Nice-to-have items not done: a check that the packaged exe has no debugging port, a wider staleness check in `verify-runtime.ps1`.

## Screenshots vs. Figma

`docs/screenshots/step-03b/`: Home (`00`), folder with Details (`01`), item menu (`02`), View menu (`03`), multi-select (`04`), refused rename (`05`), Sort menu (`06`), undo toast (`07`), permanent-delete warning (`08`), conflict dialog (`09`), Recent actions (`10`), jobs panel during a copy (`11`), each in English light, Spanish dark and the pseudo-locale. Compared with `plan/design/screens/01-explorer-home.png`: the command bar, list and Details pane match the approved 03a layout; the new dialogs and the jobs panel have no Figma frame and follow the approved preview (DESIGN_DEVIATIONS.md, 2026-10-28). The runtime check also captures the folder and undo screens in all six variants (English light, Spanish dark, pseudo; 100% and 150%) under `build/verification/`. The breadcrumb arrows are now 24 px targets (DESIGN_DEVIATIONS.md, 2026-10-30); a fresh screenshot set showing them is not yet committed.

## Help pages

New in English and Spanish: Copying and moving files, Deleting and the Recycle Bin, Undo, Drag and drop, Paste as file (with the system-item warning and the exact Undo after a cancel). The help check confirms both languages have the same 19 pages and all links work.

## Known issues

- Fixed in this step: KI-014 (rename Undo), KI-018 (individual conflict choices), KI-019 (Undo for partial moves), KI-020 (system-item warnings), KI-021 (restore tests on CI: the runner's short 8.3 temp path).
- Fixed: KI-022 (verification gaps): the missing checks now exist; what has not run is listed under Verification.
- New: KI-024 (Minor, two rows over the 20% rule in one run).
- New: KI-023 (Minor, the unused WebView2 folder from earlier builds; removal through App storage in Step 12a).
- Still open: KI-001, KI-002, KI-004, KI-005, KI-009, KI-015, KI-016 (Minor); KI-003 (Major, cold start right after a reboot is not measured yet; it needs the owner to run `scripts\measure-startup.ps1` after a reboot, due before v0.1; nothing in this step affects it).

## Design deviations and licenses

- DESIGN_DEVIATIONS.md: the 2026-10-28 file-operation screens (approved), and the 2026-10-30 accessibility and setup-font entry (for owner review).
- Dependencies: `trash` 5.2.9 (MIT); more `windows` crate features (MIT/Apache-2.0); `axe-core` 4.14.0 (MPL-2.0, development only, runs inside the runtime check). Removed from the build: `webpki-roots` and egui's default fonts; added `rustls-native-certs` and `schannel` (MIT/Apache-2.0/ISC) through reqwest's `rustls-tls-native-roots`. Commit `e6b8089` is a `deps:` commit that also holds the setup-window font code that made the change work; it should have been two commits (already pushed, so not rewritten).

## Commits (branch step-03b-file-operations, from testing 30b4c6e)

See `git log --oneline testing..step-03b-file-operations`. Tag not created yet.

## Open before reaching `main`

1. Push the branch and get `build-windows` green on the final code (the owner asked not to push on 2026-10-30).
2. Merge into `testing`, pull request to `main`, tag `v0.0.6-step03b`, update `plan/STATUS.md`.
3. Owner decisions 2026-10-30 (plan/STATUS.md): unreliable speed checks do not block; the address bar's 0 px click space with long paths is accepted; the slow recycle + restore is left for later.
4. For P2: its recipe stages `CLAUDE.md`, which is never committed: copy it locally only. Its CI change (T3) must be adapted to `scripts/test-all.ps1`.

## Proposal for the next step

P2: adopt plan v2's tools (`scripts/gate.ps1`, the IPC check, the pseudo-locale generator, the base check) without app changes, then 04a (file tabs, the open pipeline and the image viewer).
