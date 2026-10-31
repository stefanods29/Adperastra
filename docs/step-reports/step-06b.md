# Step 06b report - Version history

Dates: 2026-10-30. Status: built on the local branch `step-06b-version-history` (owner's batch rules: local only, nothing pushed, no pull request, no tag). Speed runs, screenshots and the owner's checks are still to do; the full test run and `.\scripts\gate.ps1 -Package` were not run by the agent for this batch.

## How to try it

```powershell
.\scripts\gate.ps1 -Package
.\build\Adperastra\Adperastra.exe
```

## Owner checklist

Use `%TEMP%\adp-06a` from Step 06a (create it again as described there if it is gone).

1. Open `notes.txt`, add a line, save; add another line, save. Right-click `notes.txt` > **Version history…**: the current file and two versions ("Saved in Adperastra"); Changes shows the added line in green.
2. **This version** shows the old text. **Open** on a version of `readme.md` opens a read-only tab.
3. **Restore this version** (confirm): the file goes back; a toast offers Undo; Ctrl+Z brings the newer content back. The history now also lists "Before restoring a version".
4. From the editor's ribbon with unsaved changes: Restore warns about them; after restoring, the tab shows the restored text with no dot.
5. **Save a copy…** to the Desktop; onto an existing file: Windows asks, the old file is in the Recycle Bin.
6. Save the same content twice: only one new version appears.
7. Settings > **Version history**: the used space shows; set 7 days; turn versions off, save a file: no new version, and the window says versions are off; turn them on again. **Delete all versions…**: asks first, then the list is empty.
8. End the app with Task Manager right after saving; start it again: the version is in the list (stored at start).
9. **Previous versions from Windows…** opens the Properties window.
10. Repeat checks 1 and 3 in Spanish and in the dark theme.

## What works

- A new `version-store` crate: an SQLite index, compressed BLAKE3-addressed blobs (zstd level 3), pending copies, deduplication (identical content once, an unchanged snapshot adds no version) and the time/size limits.
- The version hook: a save (or Save as) copies the current content to `pending/` first, without hashing or compressing, wakes one below-normal-priority worker and continues. A file over 256 MB is skipped; a copy that fails stops the save with `errors.textSave.version_failed`. The worker stores pending copies and trims the store at start (leftovers from a crash) and after every change.
- Settings schema 10 with the `versions` section (`enabled`, `keep_days`, `max_mb`), its migration from schema 9 and validation on both sides, and the settings block of `scripts/measure-ui.ps1` updated.
- The six commands `versions_list`, `versions_extract`, `versions_restore`, `versions_save_copy`, `versions_delete_all`, `versions_store_size`, registered in `generate_handler!` and in the isolation allowlist, plus `src/services/versions.ts` (with its outside-the-app behavior).
- The Version history window: the current file and every version (date, size, reason), arrow-key selection, Changes (our own capped Myers line diff with 3 lines of context), This version, Open a read-only copy, Save a copy…, Restore (with a confirmation that mentions unsaved changes), Previous versions from Windows…, and the notes for no versions, files over 256 MB and versions turned off.
- Version history from the Explorer: the **Version history…** command (one file selected), right after Properties in the item menu, and a button in the Details pane; a restore pushes an undo entry (`restoreVersion`) and shows an undo toast.
- Version history in the text and Markdown ribbons (File group, after Save as, key tip H); a restore in an editor drops the unsaved changes, reloads the file from disk and clears the dirty dot.
- Settings > Version history: the switch, Keep versions for, Space for versions, the space in use, and Delete all versions… with its confirmation.
- Help pages for version history in English and Spanish.

## Not in this step (on purpose)

- No versions of changes made by other programs, and no versions of folders.
- No side-by-side comparison for images, PDFs or documents (Open and Save a copy only); their viewers add it in Steps 07d, 13 and 14.
- No App storage page (Step 12a reads `versions_store_size`), no cloud copies, and no reading of Windows' shadow copies (the button opens Windows Properties).
- The converter, the privacy cleaner and AI features call the same hook when they are built (Steps 08a, 08c, 17b).

## Decisions and plan changes made during the step

- `Dialog` gained an optional `className` prop (applied to `.adp-dialog`), so `.adp-versions-dialog` can be 880 px wide; it is not in the step's file list but the window width needs it. Existing dialogs are unchanged.
- `useTextDocument` now exposes `expected` as state (the hook already tracked the same values in a ref) so the window's "Current file" row follows saves and reloads. `reloadFromDisk` now also deletes the recovery copy, as the guide says.
- T9 names `HandlerViewProps.onOpenFile` and `FileTabView`'s `onOpenFile` as new; Step 06d already added both (for the archive tab), and `App.tsx` already passed `(path) => openFile(path, false)`, so no change was needed there. `types.ts` is therefore unchanged.
- T11 item 1 ("the step value `06a` becomes `06b`"): nothing to change in `scripts/measure-ui.mjs`, which has no hardcoded step value; the recorded step comes from `-Step` or the branch name. This is KI-039, found in Step 06a for the same instruction.
- The speed script finds the "Version history…" menu item by the label it reads from the Details pane button, so it works in English, Spanish and the pseudo-locale instead of hard-coding a translation.
- `versions_delete_all` returns `Result<(), StoreError>` internally (the UI maps any failure to `versions.other`), although the Data shapes table does not list a return.
- `before_modify` uses `app.try_state::<VersionWorker>()`, so it cannot panic if a save ever runs before the worker is registered.
- The store's `list`/`extract`/`read_bytes` errors map through one helper (`NotFound` → `versions.not_found`, everything else → `versions.other`).
- Extra CSS classes (`adp-versions-side`, `adp-versions-spacer`, `adp-versions-diff`, `adp-diff-row--same`) support the guide's layout; all colors come from tokens.
- `F1`: the editor restore test now waits for one timer tick after confirming, so the reload that runs after `onRestored` has finished before its assertions. Only the test changed.

## Speed (development PC, packaged release build)

Not run yet: the owner's batch rules say not to run measurements for this step. The new measurements in `scripts/measure-ui.mjs` are:

| Interaction | Tier | Measured (median) | Result |
|---|---|---|---|
| `save a small text file with version history (Ctrl+S)` | Fast (1 s) | not run | pending |
| `open the version history (right-click menu)` | Fast (1 s) | not run | pending |
| Showing the changes of a 1 MB text file | Fast (1 s) | not run (by hand, check 1) | pending |
| Every existing measurement | as before | not run | pending |

Raw numbers: `docs/benchmarks/` (the JSON for this step is still to be written).

## Checks by hand

The owner fills this table (or tells the results in chat and the agent copies them). Until then, every Result is "waiting for the owner".

| Check | English light | Spanish dark | Result |
|---|---|---|---|
| 1. Two saves, then the history and Changes | waiting | waiting | pending |
| 2. This version; Open a read-only copy | waiting | waiting | pending |
| 3. Restore, Undo toast, Ctrl+Z, "Before restoring a version" | waiting | waiting | pending |
| 4. Restore from the editor with unsaved changes | waiting | waiting | pending |
| 5. Save a copy over an existing file (Recycle Bin) | waiting | waiting | pending |
| 6. The same content twice makes one version | waiting | waiting | pending |
| 7. Settings: used space, 7 days, off/on, Delete all versions | waiting | waiting | pending |
| 8. A crash after saving still stores the version at start | waiting | waiting | pending |
| 9. Previous versions from Windows… opens Properties | waiting | waiting | pending |

## Verification

- The owner's batch rules: no `npm test`, `vitest`, `cargo test` or `scripts/gate.ps1` run; after each task only `cargo fmt --all` and `cargo clippy --workspace --all-targets -- -D warnings` when Rust changed, then `npm run lint:i18n`, `npm run lint:ipc` and `npm run build`. All of them passed after every task (the UI build prints the existing chunk-size warning, KI-043).
- Rust tests written: `snapshot_then_import_lists_one_version`, `extract_gives_back_the_same_bytes`, `identical_content_is_stored_once`, `an_unchanged_snapshot_adds_no_version`, `missing_files_and_folders_are_skipped`, `too_large_files_are_refused`, `path_key_ignores_case_and_prefix`, `a_lonely_sidecar_is_cleaned_after_a_minute`, `versions_are_listed_newest_first`, `trim_removes_versions_older_than_the_limit`, `trim_keeps_the_size_within_the_limit`, `shared_content_stays_until_its_last_version_goes`, `delete_all_empties_the_store`, `settings_v9_migrates_to_v10_keeping_language_and_theme`, `settings_validate_rejects_bad_versions`, `check_id_refuses_zero_and_negative`, `reasons_have_stable_names`.
- UI tests written: `normalizes the version settings (schema 10)`, `outside the app the history is empty`, `splitLines handles every line break`, `equal texts have no changes`, `one changed line`, `added and removed lines at the ends`, `context collapses long unchanged runs`, `too many changes`, `empty texts`, `lists the current file and the versions`, `shows the changes of a text file`, `other files offer Open`, `restore asks first and reports`, `says when there are no versions`, `unsaved changes are mentioned before restoring`, `version history needs one file`, `restoreVersion entries undo and redo`, `the ribbon opens the version history`, `a restore reloads the text`, `resetSection resets the version settings`, `changes the limits`, `delete all asks first`; `lists the seven sections in order` was updated for the new section.
- Not run by the agent: the Rust and UI tests above (the owner runs them), `.\scripts\gate.ps1`, `.\scripts\gate.ps1 -Package`, the speed runs and the screenshots.

## Screenshots

`docs/screenshots/step-06b/`: `42-version-history`, `43-version-text` (in English light, Spanish dark and the pseudo-locale) are still to be taken; `scripts/measure-ui.mjs` now asks for them after Step 06a's screenshots.

## Known issues

- New: KI-043 (Minor) The UI build prints a chunk-size warning (found in this step; it does not stop the build).
- Fixed: none.
- Still open (unchanged): KI-042, KI-041, KI-040, KI-039, KI-037, KI-034, KI-033, KI-032 and the older entries.

## Design deviations, dependencies, licenses

- `DESIGN_DEVIATIONS.md`: none.
- New dependencies: rusqlite 0.41 with bundled SQLite (MIT; SQLite public domain), blake3 1.8 (CC0-1.0 OR Apache-2.0), zstd 0.14 (BSD-3-Clause). All three are in `plan/libraries.md`, `THIRD_PARTY_LICENSES.md` and `docs/dependency-and-license-table.md` from T1.

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

## Next step

Step 06c: Templates in the New menu (guide), from `plan/STATUS.md`.
