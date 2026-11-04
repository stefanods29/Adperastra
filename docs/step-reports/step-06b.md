# Step 06b report - Version history

Dates: 2026-10-30 to 2026-10-31. Status: all 11 implementation tasks saved on `step-06b-version-history`, combined with 06c and reviewed locally on `step-06c-templates`; merged into local `testing` at `4bacad9`. No tag or publication. Owner checks and the open shared safety/runtime issues below remain pending.

## How to try it

Use disposable files only while KI-068/KI-069 remain open. The reviewed release executable is `%TEMP%\adperastra-target\release\Adperastra.exe`, with `help` and `templates` next to it. To open a fresh hand-check profile in PowerShell:

```powershell
$env:ADPERASTRA_DATA_DIR = Join-Path $env:TEMP ('adperastra-hand-check-06bc-' + [guid]::NewGuid().ToString('N'))
& "$env:TEMP\adperastra-target\release\Adperastra.exe"
```

The release was built with `npx -y @tauri-apps/cli@2 build --no-bundle`. The setup/signing package was not run. The automated review's generated data and fixtures are retained, with their paths in the JSON records.

## Owner checklist

Use `%TEMP%\adp-06a` from Step 06a (create it again as described there if it is gone).

1. Open `notes.txt`, add a line, save; add another line, save. Right-click `notes.txt` > **Version history…**: the current file and two versions ("Saved in Adperastra"); Changes shows the added line in green.
2. **This version** shows the old text. **Open** on a version of `readme.md` opens a read-only tab.
3. **Restore this version** (confirm): the file goes back; a toast offers Undo; Ctrl+Z brings the newer content back. The history now also lists "Before restoring a version".
4. From the editor's ribbon with unsaved changes: Restore warns about them; after restoring, the tab shows the restored text with no dot.
5. **Save a copy…** to a new Desktop filename; choose an existing disposable file and confirm the translated refusal and unchanged bytes (replacement remains unavailable under KI-030).
6. Save the same content twice: only one new version appears.
7. Settings > **Version history**: the used space shows; set 7 days; turn versions off, save a file: no new version, and the window says versions are off; turn them on again. **Delete all versions…**: asks first, then the list is empty.
8. End the app with Task Manager right after saving; start it again: the version is in the list (stored at start).
9. **Previous versions from Windows…** opens the Properties window.
10. Repeat checks 1 and 3 in Spanish and in the dark theme.

## What works

- Version snapshots before app changes, BLAKE3 deduplication, zstd storage, retention, settings migration through schema 10 (combined settings schema 11), and background import/recovery.
- Explorer/Details/editor history entry points, bounded text changes and previews, paged older histories, read-only opening, safe new-name copies, restore and exact Undo recovery.
- Pending copies are complete before import and have a 1 GiB cap. The open cache has a separate 1 GiB cap; Settings includes index/pending/open usage while compressed-blob limits retain their original meaning.

## Not in this step (on purpose)

- Versions for changes by other applications, shadow-copy reading, binary visual comparisons and App storage are later work. Existing-destination Save a copy is unavailable under the owner's approved Replace deferral.

## Decisions and plan changes made during the step

- The owner's local-only batch rules override older per-task gate/push/package instructions. Workers wrote the prescribed tests and ran quick checks; the combined review ran the full gate, repeating it only after a failure or a subsequent correction.
- Every introduced defect is in `KNOWN_ISSUES.md`; recipe corrections, contracts, modules and traps are in a separate `docs(plan)` commit. Existing errors remain documented under the owner's policy.
- The scoped review mode is additive: fresh isolated folders, preserved data, explicit failed results and no legacy cleanup. It verifies 06b/06c only, not all earlier steps. No test app process is left running.
- Required-size completion records replace the unsafe sidecar-first recipe. Cross-process per-operation locks and explicit borrowed sessions serialize import/retention/deletion/restore; separate pending publication avoids waiting for compression.
- Durable monotonic IDs and same-file validation prevent stale Undo IDs selecting another file. Restore always keeps and returns its exact current-content ID, including when ordinary history is off or the copy deduplicates. Missing/unreadable/oversized current files fail untouched.
- Owned staging and atomic no-replace publication protect new copy targets. Existing targets are refused instead of path-based recycling. Restore retains the explicit content-save ReplaceFileW contract; its final path race is documented as KI-069, not claimed solved.
- `readVersionText` caps Range/stream reads at 1 MiB and revokes/aborts grants; `useVersionRestore` serializes restore/Undo, awaits refresh, and keeps recovery available when a later callback fails. The list uses 2,000-row pages and a same-file date/ID cursor.
- The dark screenshot exposed unreadable green diff rows. The corrected background mixes existing accent/surface tokens with primary text; release checks enforce actual 4.5:1 text contrast. Store helpers and tests were split into focused files below 400 lines; a small fs-service Windows attribute helper removes the need for lint suppressions.

## Speed (development PC, packaged release build)

Final scoped records are `docs/benchmarks/step-06bc-ui-review-en-light.json`, `step-06bc-ui-review-es-dark.json` and `step-06bc-ui-review-pseudo-light.json`. They record seven runs per interaction, actual conditions, screenshots, file-byte checks, contrast/bounds checks and runtime console failures. Exact final medians:

- en/light: save a small text file with version history (Ctrl+S) **30.1 ms**, open the version history (right-click menu) **29.4 ms**, command bar New menu (with templates) **29.5 ms**.
- es/dark: save a small text file with version history (Ctrl+S) **29.5 ms**, open the version history (right-click menu) **32 ms**, command bar New menu (with templates) **29.4 ms**.
- pseudo/light: save a small text file with version history (Ctrl+S) **29.7 ms**, open the version history (right-click menu) **30.3 ms**, command bar New menu (with templates) **31 ms**.

Every measured action meets its tier (save/history: 1 s; New menu: 0.1 s). `functional_passed` and `console_clean` are separate; an overall false result is not described as a completely passed runtime check.

The earlier `-initial` record documents a verification-runner Escape target error after successful restore/Undo byte checks. It is not a completed speed/regression run. No same-build 06a/06b baseline exists for a valid 20% comparison; all earlier-step performance regression comparisons remain pending.

## Checks by hand

The owner fills this table (or tells the results in chat and the agent copies them). Until then, every Result is "waiting for the owner".

| Check | English light | Spanish dark | Result |
|---|---|---|---|
| 1. Two saves, then the history and Changes | waiting | waiting | pending |
| 2. This version; Open a read-only copy | waiting | waiting | pending |
| 3. Restore, Undo toast, Ctrl+Z, "Before restoring a version" | waiting | waiting | pending |
| 4. Restore from the editor with unsaved changes | waiting | waiting | pending |
| 5. Save a copy to a new name; existing file refused | waiting | waiting | pending |
| 6. The same content twice makes one version | waiting | waiting | pending |
| 7. Settings: used space, 7 days, off/on, Delete all versions | waiting | waiting | pending |
| 8. A crash after saving still stores the version at start | waiting | waiting | pending |
| 9. Previous versions from Windows… opens Properties | waiting | waiting | pending |

Automated release checks cover a subset and do not fill in the owner's results.

## Verification

- Full `scripts/gate.ps1` passed: **349 Rust tests, 462 UI tests in 87 files**, 855 translation keys, 38 help pages, 84 registered commands / 82 checked invoke calls. Rust formatting and Clippy with warnings as errors, translations, IPC, TypeScript and Vite all passed. No tests are skipped or weakened.
- The combined release app was built with `npx -y @tauri-apps/cli@2 build --no-bundle`; no installer/signing build, remote operation, release or main change occurred.
- Failures were investigated and corrected before saving: the retention size test used out-of-retention dates (only dates corrected, assertions unchanged); CodeMirror normalizes CRLF to LF internally (the test now also asserts the CRLF save choice); a guarded oversized source now returns the required TooLarge result. A targeted test reproduced a colliding pending record overwrite before the no-replace correction.
- Review regressions cover incomplete snapshots, concurrent stores and cleanup, stable IDs/path ownership, exact deduplicated Undo snapshots, history-off restore, pending deletion and quota, bounded verified decompression/open-cache eviction, paged lists, growing preview streams, and Undo retained after a failed editor refresh.
- Template regressions cover exclusive partial ownership, no-replace publication/name exhaustion, junction/source swaps, cancellation/progress, read-only copies, listing failures/skips, keyboard focus, async folder save/create errors and deferred job cancellation. Filesystem tests run against real temporary Windows files.
- `check-06bc-ui.mjs` and the PowerShell wrapper parse successfully. The scoped release check creates fresh retained fixtures and never invokes the legacy permanent-cleanup path.
- Vite still prints the existing main-chunk warning (KI-048); the warning was not suppressed. The release runtime also reports blocked inline-style CSP violations (KI-075), so runtime verification is **not entirely clean** despite completed functional flows.
- Not verified here: real power-loss recovery, multi-GB or external-drive behavior, Windows native save/folder/Properties dialogs, Office applications, Narrator, every owner checklist item, and the full earlier-step speed regression suite.

## Screenshots

`docs/screenshots/step-06b/`: `42-version-history` and `43-version-text` in English light, Spanish dark and pseudo-locale. They show real saved revisions, not an empty mocked history. All six final images were visually inspected; controls and loaded content remain visible in these layouts. Actual text-contrast checks:

- en/light: added text contrast 13.22:1 (minimum 4.5:1), removed text contrast 11.48:1 (minimum 4.5:1).
- es/dark: added text contrast 12.89:1 (minimum 4.5:1), removed text contrast 8.78:1 (minimum 4.5:1).
- pseudo/light: added text contrast 13.22:1 (minimum 4.5:1), removed text contrast 11.48:1 (minimum 4.5:1). The pre-fix Spanish screenshot is retained in `docs/screenshots/review-06bc-before/`.

## Known issues

- Fixed in this review: KI-056–KI-064, KI-065–KI-067, KI-071–KI-074; dark contrast is KI-076 (fixed and checked in all three languages).
- Still open: KI-048 build warning, KI-068 existing Save/Save as staging/recycle safety, KI-069 shared final content-replacement race, KI-075 CSP style violations. Existing KI-033/KI-037 remain unchanged by owner decision. This is local development integration, not release clearance.

## Design deviations, dependencies, licenses

- New dependencies: rusqlite 0.41.1 (MIT, bundled SQLite public domain), blake3 1.8.7 (allowed CC0-1.0/Apache-2.0 alternatives), zstd 0.14.3 (BSD-3-Clause). The existing fs-service is an internal path dependency; no additional external library was added by review.
- Installed transitive manifests were checked. arrayvec, constant_time_eq, fallible iterator crates, hashlink, libsqlite3-sys and build-only vcpkg are now recorded in both license notices (KI-073). Non-Windows SQLite WASM/VFS dependencies are not included in this Windows build.
- `DESIGN_DEVIATIONS.md` already records the new dialog. Contrast correction follows the existing tokens and is reflected in the guide.

## Commits

```
b7b13a6 fix(versions): the editor restore test waits for the reloaded file [step-06b/F1]
2c988fa test(speed): version history measurements and screenshots [step-06b/T11]
7477d42 feat(settings): Version history section [step-06b/T10]
0177312 feat(editor): Version history from the text and Markdown editors [step-06b/T9]
146c9c6 feat(versions): Version history from the Explorer, with undoable restore [step-06b/T8]
44ec16d feat(versions): Version history window with changes, open, copy and restore [step-06b/T7]
843fe55 feat(versions): line diff with context [step-06b/T6]
ccf79ff feat(versions): keep a version before every change, background storing, commands [step-06b/T5]
14aace9 feat(settings): version history settings (schema 10) [step-06b/T4]
529b752 feat(versions): keep the store within its time and size limits [step-06b/T3]
70d7de3 feat(versions): version store with snapshots, deduplication and extract [step-06b/T2]
414b07b deps: add rusqlite 0.41 (MIT), blake3 1.8 (CC0-1.0 OR Apache-2.0), zstd 0.14 (BSD-3-Clause) [step-06b/T1]
```

Combined safety correction: `6e3522f` (`[step-06b/F2]`, `[step-06c/F1]`); plan corrections: `26af829`; local testing merge: `4bacad9`. The merged app tree matches the tested branch exactly; no redundant post-merge suite was run.

## Next step

06c is built in the same batch. 06d was already integrated. Next new implementation: 06e, after its outline is expanded into a guide.
