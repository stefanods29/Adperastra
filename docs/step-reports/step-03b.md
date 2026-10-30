# Step 03b report - File operations, jobs, undo, drag and drop, paste as file

Dates: 2026-10-28 to 2026-10-30. Status: **in progress** (stopped for the night on 2026-10-30; see "Open before merging"). Planned tag `v0.0.6-step03b`. Under the continuous-work decision (plan/STATUS.md, 2026-10-29) the owner checks it afterwards; problems found become `F` tasks.

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
12. With a screen reader (Narrator), move through the tabs, the column headers and the address bar: names and sort order are read out.
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

Not final yet. All earlier 03b measurements are inside their tiers (`docs/benchmarks/2026-10-28-ui-step03b.json`, startup `2026-10-28-startup-step03b.json`). On 2026-10-30, three alternating runs of the 03b build and the mid-step build `11aced2` on the same PC showed no slowdown (every row equal or faster; raw files were in `%TEMP%`, not kept). The final A/B against `v0.0.5-step03a` with `scripts/measure-ab.ps1` has not completed yet (see below).

## Verification

Run in this session on 2026-10-30:

- `cargo fmt --check` and `cargo clippy -D warnings` clean; `cargo test --workspace`: 124 passed, 0 failed.
- `npm test`: 80 passed; `npm run lint:i18n` passed (357 keys); `npm run build` passed; verification helper tests: 7 passed.
- Packaged runtime check (`scripts/verify-runtime.ps1 -Mode full`): passed in all six variants (English light, Spanish dark, pseudo; 100% and 150%), 14 checks each: folder opens, filtering, Ctrl+A, rename rejection, no WCAG A/AA violations (axe-core), copy, recycle, restore, Ctrl+Z / Ctrl+Y through the UI, no console errors.
- Rust and npm license checks and vulnerability audits: clean on GitHub run 41004908481 (the run before today's app fixes); the only failure there was the runtime check, fixed since.
- GitHub run 41009305267 (all fixes up to `0d235b4`) was still running when work stopped.
- Plan review (read-only reviewer) on 2026-10-30: its Blockers were the open KI-022 and uncommitted work; its should-fix items (corpus path, hard-coded step id, tier mapping, setup font fallback) are fixed in `0d235b4` and `51a9c64`.
- Not run: the owner's hand checks above; Narrator.

## Screenshots vs. Figma

`docs/screenshots/step-03b/`: Home (`00`), folder with Details (`01`), item menu (`02`), View menu (`03`), multi-select (`04`), refused rename (`05`), Sort menu (`06`), undo toast (`07`), permanent-delete warning (`08`), conflict dialog (`09`), Recent actions (`10`), jobs panel during a copy (`11`), each in English light, Spanish dark and the pseudo-locale. Compared with `plan/design/screens/01-explorer-home.png`: the command bar, list and Details pane match the approved 03a layout; the new dialogs and the jobs panel have no Figma frame and follow the approved preview (DESIGN_DEVIATIONS.md, 2026-10-28). The runtime check also captures the folder and undo screens in all six variants (English light, Spanish dark, pseudo; 100% and 150%) under `build/verification/`. The breadcrumb arrows are now 24 px targets (DESIGN_DEVIATIONS.md, 2026-10-30); a fresh screenshot set showing them is not yet committed.

## Help pages

New in English and Spanish: Copying and moving files, Deleting and the Recycle Bin, Undo, Drag and drop, Paste as file (with the system-item warning and the exact Undo after a cancel). The help check confirms both languages have the same 19 pages and all links work.

## Known issues

- Fixed in this step: KI-014 (rename Undo), KI-018 (individual conflict choices), KI-019 (Undo for partial moves), KI-020 (system-item warnings), KI-021 (restore tests on CI: the runner's short 8.3 temp path).
- Still open, blocks merging: KI-022 (verification gaps). The missing checks now exist (runtime variants, accessibility, licenses, speed gate); it closes when the full run with the speed gate passes.
- New: KI-023 (Minor, the unused WebView2 folder from earlier builds; removal through App storage in Step 12a).
- Still open: KI-001, KI-002, KI-004, KI-005, KI-009, KI-015, KI-016 (Minor); KI-003 (Major, cold start right after a reboot is not measured yet; it needs the owner to run `scripts\measure-startup.ps1` after a reboot, due before v0.1; nothing in this step affects it).

## Design deviations and licenses

- DESIGN_DEVIATIONS.md: the 2026-10-28 file-operation screens (approved), and the 2026-10-30 accessibility and setup-font entry (for owner review).
- Dependencies: `trash` 5.2.9 (MIT); more `windows` crate features (MIT/Apache-2.0); `axe-core` 4.14.0 (MPL-2.0, development only, runs inside the runtime check). Removed from the build: `webpki-roots` and egui's default fonts; added `rustls-native-certs` and `schannel` (MIT/Apache-2.0/ISC) through reqwest's `rustls-tls-native-roots`. Commit `e6b8089` is a `deps:` commit that also holds the setup-window font code that made the change work; it should have been two commits (already pushed, so not rewritten).

## Commits (branch step-03b-file-operations, from testing 30b4c6e)

See `git log --oneline testing..step-03b-file-operations` (52 commits on 2026-10-30, newest `0d235b4` plus the records commit). Tag not created yet.

## Open before merging (state on 2026-10-30)

1. **Speed gate run:** `.\scripts\measure-ab.ps1 -Step 03b -Baseline v0.0.5-step03a -Out docsenchmarks6-10-30-ui-step03b.json`, then `node scripts/compare-benchmarks.mjs` on that file. The first attempt failed: the new build's measurement timed out three times while opening a folder, right after the old version had finished building (the PC was busy). Run by hand afterwards, the same measurement passed once and timed out once at a later point. Not explained yet. `measure-ui.mjs` now reports what the page showed when opening a folder times out, so the next run says where it is stuck. A real hang in the app has not been ruled out.
2. **Possible address-bar regression to check:** with a long path, the empty space you click to type a path in the address bar is 0 px wide. The wider 24 px arrows may have used up that space. Check it against the previous build, and keep a way to click into the address bar.
3. **Slow recycle + restore:** one measurement took 2.2 s (others 0.3-0.4 s). Check it with the speed gate.
4. GitHub CI green on the latest push, then close KI-022, finish this report (speed table, commit list), merge into `testing`, pull request to `main`, tag `v0.0.6-step03b`, update `plan/STATUS.md`.
5. For P2: its recipe stages `CLAUDE.md`, which is never committed (owner decision, git-excluded): copy it locally only. Its CI change (T3) was written before `scripts/test-all.ps1` took over CI and must be adapted.

## Proposal for the next step

P2: adopt plan v2's tools (`scripts/gate.ps1`, the IPC check, the pseudo-locale generator, the base check) without app changes, then 04a (file tabs, the open pipeline and the image viewer).
