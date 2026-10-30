# Step 03b report - File operations, jobs, undo, drag and drop, paste as file

Dates: 2026-10-28 to 2026-10-30. Status: **finished and merged into local `testing`; not pushed and not on `main`** by the owner's local-only decision on 2026-10-30. The safety review (KI-025 through KI-029) is fixed and verified. Planned local tag `v0.0.6-step03b`; the owner decides when it moves to `main`.

## Latest verification, 2026-10-30

Final local code, after the safety fixes:

- `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace`: 146 tests pass, 0 warnings.
- `npm test` 84 pass; `npx tsc --noEmit` clean; `npm run lint:i18n` passes (359 keys, 39 tsx files); `npm run build` passes; `npm audit --omit=dev` reports 0 vulnerabilities.
- Packaged runtime check, all six variants (English light, Spanish dark, pseudo; 100% and 150%): 17 checks each, no WCAG A/AA violations, no console errors. Reports in `build/verification/step03b-final-3/` (generated locally).
- UI speed: the second full run (`docs/benchmarks/2026-10-30-ui-step03b-final-2.json`) passes every tier and every 20% comparison; the first run (`-final.json`) measured select 10.7 ms vs 8 ms and 100k Select All 31.1 ms vs 25.9 ms, both over the 20% rule but inside the 100 ms tier (KI-024, owner decision 2026-10-30). Startup runs 2-6: 898-969 ms ready (median 929 ms), 19% over the Step 03a median 779 ms and inside the 20% rule; first paint 74-129 ms.
- The runtime check hit one benign Tauri "Couldn't find callback id" warning in the first two attempts (a folder-watch listener removed during navigation). The final six-variant run had none. `scripts/verify-runtime.mjs` ignores only that exact framework message and records it separately; every other console warning or error still fails.

Earlier GitHub runs: 14/14 at `904cdd5`; `b5ffbd4` also passed. The local-only commits after that have not run on GitHub by the owner's decision.

## Decisions and plan changes

Owner decisions (2026-10-28, before building; recorded in `docs/step-plans/step-03b.md` and `DESIGN_DEVIATIONS.md`): the design preview for the jobs panel, conflict dialog, permanent-delete warning, Recent actions and paste-as-file was approved; the `trash` crate (MIT) is used for the Recycle Bin; conflicts offer Replace / Skip / Keep both with "Do this for all"; pasted images default to PNG; undoing a copy sends the copies to the Recycle Bin. On 2026-10-29 the owner made work continuous (no approval needed per step) and merged the plan folders into `plan/`.

Decisions made during the step (all written in the repository):

- **Replace never deletes** (ADR 0007): the item being replaced goes to the Recycle Bin first, so Undo brings it back.
- **Exact Undo for moves:** a move keeps a plan of exactly what changed on disk, so a cancelled or partly finished move undoes only what happened (KI-019).
- **System items ask first** for move, recycle and permanent delete (KI-020); the old Replace-target check remains for the future conflict window.
- **Setup window licenses:** the license audit found two bundled pieces outside the allowed list (R-LIC-1): egui's built-in Ubuntu font and `webpki-roots` (CDLA-Permissive-2.0). Both are gone: the setup window uses Inter, or the Windows UI font installed on the PC when Inter is missing (read at run time, never bundled), and downloads trust the Windows certificate store (`rustls-native-certs`, `schannel`).
- **License check scope:** the npm check covers what ships. Development-only packages never reach the app; `argparse` is a runtime dependency of markdown-it but only its command-line program uses it, so it is listed with that reason in `scripts/license-policy.json`.
- **WebView2 profile in the data folder** (R-BG-2): the window is now created in code with its profile under `<data>\webview`. Before, every instance shared one profile in `%LOCALAPPDATA%`, and a leftover instance made the next one fail to start; that was the CI runtime failure. The old folder is left behind once (KI-023, Minor).
- **CSP:** `connect-src` now also allows `ipc: http://ipc.localhost`, Tauri's local IPC endpoint (nothing on the network). Without it every command fell back to a slower path and logged a warning. Plan change: `plan/steps/step-04a.md` CSP recipe updated to match (commit `133fc2a`).
- **Event listeners:** the capability list was missing `core:event:allow-unlisten`, so listeners were never removed (a leak plus console errors). Added.
- **Speed gate:** a slower result is now judged by measuring this build and the previous step's tagged build alternately on the same PC (`scripts/measure-ab.ps1`). Comparing numbers from another day was not a fair test: on this PC, with other desktop apps running, the same build varied by up to 2x between runs.
- **Replace removed (2026-10-30 owner decision):** a path-based Recycle Bin call cannot prove it removes the exact file the user approved. The command boundary returns `ops.replace_unavailable`; the approved revised dialog offers Merge for two folders, Skip, and Keep both. Merge never touches a file. Replace returns with the full conflict window (KI-030, Minor deferral approved by the owner).
- **Duplicate names:** New items, downloads and pasted files count from one ("report (1)"); a copied item that keeps both uses Explorer's "report - Copy", then "report - Copy (2)"; a moved item uses "report (1)". Approved by the owner on 2026-10-30.
- **Clipboard image helper:** Windows image decoding and encoding run in `Adperastra.exe --clipboard-image-helper`, a separate process with a 1.5 GiB job limit and a 15 s timeout. It receives only `png` or `jpg`, never a path. The parent writes through an exclusive staging handle and publishes without replacing; failure deletes only that handle's file. The 512 MiB input, 64-million-pixel/32,768-axis image and 321 MiB output limits remain.
- **Move source verification:** a move keeps a volume/file-ID/attributes/times/size snapshot, reopens the source with writes, renames and deletes denied, compares its identity and bytes with the finished copy, and deletes it through that handle only when unchanged. Merged moves refuse directory links.
- **Test process isolation:** the speed and runtime scripts used to stop every `Adperastra.exe` and WebView2 process on the PC. Each run now starts suspended in its own Windows job; cleanup stops only that job's processes. The startup measurement also uses its own WebView2 profile.

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
4. Copy a folder over a folder with the same name, and a file over a file with the same name: the conflict dialog asks. Clear **Do this for all**, choose **Merge** for the folder and **Keep both** for the file: the folder keeps its old files and gains the new ones, and the file becomes "name - Copy". Nothing is replaced.
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

- File operations through the command bar, menus and keyboard: New folder / text document, Cut, Copy, Paste, Rename, Delete (Recycle Bin), Shift+Delete (warning first), Paste as file. Name conflicts offer Merge (folders), Skip and Keep both; Replace is not offered (KI-030).
- Jobs: copy, move, recycle, restore and delete run in the background with progress, Cancel and a list of skipped items; priorities foreground / normal / background are ready for later background work.
- Never losing data: nothing is overwritten; Merge keeps every existing file; a cancelled copy removes only its partial file; a move removes a source only after the copy is complete and the source still matches its snapshot; drive roots, Windows and Program Files are refused; links and loops are not followed.
- Undo and Redo for create, rename, copy, move and delete, from the toast, Ctrl+Z / Ctrl+Y, and Recent actions; exact for cancelled and partly finished moves. A stored replacement history fails safely rather than overwriting a restored item.
- Drag and drop inside the app and with other apps, with Windows' modifier rules and a badge.
- Clipboard with Windows Explorer both ways (cut and copy), and paste as file for text and images.

## What deliberately does not work yet

- Replacing existing files: unavailable until the full conflict window can bind recycling to the exact approved item (KI-030, owner-approved Minor deferral; Step 09f).
- The full conflict window with previews and the copy window with pause and queue: Step 09f.
- "What's using this file?" for files in use: Step 09g (now a translated "in use" message).
- List and icon views: Step 05a (KI-015).

## Speed

Release build on the development PC with other desktop apps running. UI: second full run, `docs/benchmarks/2026-10-30-ui-step03b-final-2.json` (the first run is `-final.json`). Startup: `docs/benchmarks/2026-10-30-startup-step03b.json`, runs 2-6.

| Interaction | Tier | Measured | Result |
|---|---|---|---|
| Select, Ctrl+click, type-ahead | Instant 0.1 s | 9.5, 8.1, 9.0 ms | Pass |
| Right-click menus, View and New menus | Instant 0.1 s | 5.6-7.0 ms | Pass |
| Rename box (F2) | Instant 0.1 s | 5.8 ms | Pass |
| Details pane filled, hide/show | Instant 0.1 s | 8.3, 6.6 ms | Pass |
| 100k folder: select, arrow, select all, right-click | Instant 0.1 s | 5.7, 11.0, 30.5, 6.6 ms | Pass |
| 100k folder: Shift+click range | Instant 0.1 s | 12.5 ms | Pass |
| 100k folder: scrolling, 95th percentile frame | Smooth | 8.3 ms | Pass (limit in docs/test-and-speed-plan.md) |
| Copy job; recycle + restore; Keep both + Undo | Fast 1 s | 69.9, 326.9, 132.8 ms | Pass |
| Show more options | Fast 1 s | 538 ms | Pass |
| App start, runs 2-6 (first paint / ready) | Fast 1 s | 74-129 ms / 898-969 ms (median 929 ms) | Pass; 19% over the Step 03a median 779 ms, inside the 20% rule |
| First start of a fresh build | one-time | 158 ms / 1329 ms | Known one-time cost (KI-002) |

The first full UI run measured select 10.7 ms versus 8 ms and 100k Select All 31.1 ms versus 25.9 ms, both over the 20% rule; the second run measured 9.5 ms and 30.5 ms and passed all rows. Both runs are well inside the 100 ms Instant tier. This is the run-to-run noise recorded in KI-024 and accepted by the owner on 2026-10-30. The side-by-side `measure-ab.ps1` run against `v0.0.5-step03a` was not repeated; the 20% comparison is against the Step 03a JSON on the same PC, not alternating builds.

## Earlier verification

`scripts/gate.ps1` arrives with P2, so these commands stood in for it. `scripts/test-all.ps1 -Mode full` was never run as one command, because the audit tools are not installed on this PC.

- Local, final code: `npm test` 84 passed; `npm run lint:i18n` passed (359 keys); help check passed (38 pages); verification helper tests 7 passed.
- Local, final code: `cargo fmt --check` and `cargo clippy -D warnings` clean; `cargo test --workspace` 146 passed.
- Local, final code: packaged runtime check passed in all six variants (English light, Spanish dark, pseudo; 100% and 150%), 17 checks each, no console errors, no WCAG A/AA violations, including the tab strip with a closable tab and keyboard tab switching.
- GitHub: 14/14 at `904cdd5` (run 41087578938). `f650cfe` failed 13/14 on a startup race in the runtime check, fixed afterwards. The later run for `b5ffbd4` passed, but does not cover subsequent local changes. `main` requires that check.
- Not run: GitHub's full mode (speed check on port 9444 is untested there); the by-hand runtime workflow (usable only once on `main`); the owner's hand checks; Narrator.
- Plan review ran twice. All Blockers and Should-fix items are addressed; the tab keyboard gap it found is fixed. Nice-to-have items not done: a check that the packaged exe has no debugging port, a wider staleness check in `verify-runtime.ps1`.

## Screenshots vs. Figma

`docs/screenshots/step-03b/`: Home (`00`), folder with Details (`01`), item menu (`02`), View menu (`03`), multi-select (`04`), refused rename (`05`), Sort menu (`06`), undo toast (`07`), permanent-delete warning (`08`), file conflict with Keep both (`09`), Recent actions (`10`), jobs panel during a copy (`11`), and folder conflict with Merge (`12`), each in English light, Spanish dark and the pseudo-locale. Compared with `plan/design/screens/01-explorer-home.png`: the command bar, list and Details pane match the approved 03a layout; the new dialogs and the jobs panel have no Figma frame and follow the approved previews (DESIGN_DEVIATIONS.md, 2026-10-28 and 2026-10-30). The runtime check also captures the folder and undo screens in all six variants (English light, Spanish dark, pseudo; 100% and 150%) under `build/verification/`. The refreshed set includes the 24 px breadcrumb targets.

## Help pages

New in English and Spanish: Copying and moving files, Deleting and the Recycle Bin, Undo, Drag and drop, Paste as file (with the system-item warning and the exact Undo after a cancel). The help check confirms both languages have the same 19 pages and all links work.

## Known issues

- Fixed in this step: KI-014 (rename Undo), KI-018 (individual conflict choices), KI-019 (Undo for partial moves), KI-020 (system-item warnings), KI-021 (restore tests on CI: the runner's short 8.3 temp path).
- Fixed by the safety review: KI-025 (image paste overwrite and buffer lifetime), KI-026 (unapproved Replace), KI-027 (source changed during a move), KI-028 (Redo after a replacement), KI-029 (image decoding outside a helper). KI-026 and KI-028 close by refusing Replace until exact approved targets exist.
- Fixed: KI-022 (verification gaps): the missing checks now exist; what has not run is listed under Verification.
- New: KI-030 (Minor, owner-approved deferral: Replace is unavailable until the full conflict window; Merge / Skip / Keep both remain).
- New: KI-024 (Minor, two rows over the 20% rule in one run).
- New: KI-023 (Minor, the unused WebView2 folder from earlier builds; removal through App storage in Step 12a).
- Still open: KI-001, KI-002, KI-004, KI-005, KI-009, KI-015, KI-016, KI-030 (Minor); KI-003 (Major, cold start right after a reboot is not measured yet; it needs the owner to run `scripts\measure-startup.ps1` after a reboot, due before v0.1; nothing in this step affects it).

## Design deviations and licenses

- DESIGN_DEVIATIONS.md: the 2026-10-28 file-operation screens (approved), the 2026-10-30 revised conflict dialog and duplicate names (approved by the owner), and the 2026-10-30 accessibility and setup-font entry (for owner review).
- Dependencies: `trash` 5.2.9 (MIT); more `windows` crate features (MIT/Apache-2.0), including `Win32_System_JobObjects`; `windows-core` 0.61.2 (MIT/Apache-2.0) for the bounded clipboard-image stream; `axe-core` 4.14.0 (MPL-2.0, development only, runs inside the runtime check). Removed from the build: `webpki-roots` and egui's default fonts; added `rustls-native-certs` and `schannel` (MIT/Apache-2.0/ISC) through reqwest's `rustls-tls-native-roots`. Commit `e6b8089` is a `deps:` commit that also holds the setup-window font code that made the change work; it should have been two commits (already pushed, so not rewritten).

## Commits (branch step-03b-file-operations, from testing 30b4c6e)

The safety review adds these commits on top of the step's earlier history:

- `0bf027b` deps: add windows-core 0.61.2 and JobObjects for clipboard image isolation
- `96dedb4` fix(ops): make moves and clipboard image saves safe; merge folders without replace
- `2a89c01` fix(test): stop only the isolated test app and its children
- `83ee390` fix(ops): never write through a destination junction
- `fe49ee3` fix(app): send conflict paths as strings
- `2e57d3d` fix(bench): measure Keep both and Undo instead of the removed Replace
- `ac1f549` docs: record the step-03b safety review and Merge decision
- `898bf30` test(bench): refresh step-03b screenshots and final measurements
- `f7d9fb2` fix(test): ignore the benign Tauri watch callback warning
- `0046607` docs(reports): final step-03b verification, screenshots and speed numbers

The complete list is `git log --oneline testing..step-03b-file-operations`. Tag not created yet (owner chose local-only on 2026-10-30).

## Open before reaching `main`

1. The owner chose local-only work on 2026-10-30: the branch, local `testing` and local tags only; no push, pull request, or `main` change. Push and CI (`build-windows`) must run before a release if the owner changes that decision.
2. The owner checks the packaged app and decides when the step moves to `main` and gets `v0.0.6-step03b`.
3. Owner decisions 2026-10-30 (plan/STATUS.md): Replace is removed until the full conflict window (KI-030); duplicate names follow the owner's copy/number rules; unreliable speed checks do not block; the address bar's 0 px click space with long paths is accepted; the slow recycle + restore is left for later.
4. For P2: its recipe stages `CLAUDE.md`, which is never committed: copy it locally only. Its CI change (T3) must be adapted to `scripts/test-all.ps1`.

## Proposal for the next step

P2: adopt plan v2's tools (`scripts/gate.ps1`, the IPC check, the pseudo-locale generator, the base check) without app changes, then 04a (file tabs, the open pipeline and the image viewer).
