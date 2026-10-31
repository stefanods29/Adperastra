# Step 06d report - Archives: open, browse, extract

Dates: 2026-10-30. Status: built on the local branch `step-06d-archives` (local only, as the owner asked for this batch). Speed runs, screenshots and the owner's checks are still to do.

This step was built from Step 05d, not from its guide's `Depends on` line (06c): the branch has no work from 06a, 06b or 06c. Where the guide referred to code from those steps, a small local version was written instead; every such place is listed under "Decisions and plan changes".

## How to try it

```powershell
.\scripts\gate.ps1 -Package
.\build\Adperastra\Adperastra.exe
```

## Owner checklist

The files are made by `scripts\measure-ui.ps1` (the archives folder) and by the "Check by hand" list of `plan/steps/step-06d.md` (the `%TEMP%\adperastra-check-06d` folder with `src`, `sample.zip`, `sample.7z`, `sample.tar`, `sample.tar.gz`, `sample.tar.xz`, `notes.txt.gz`, `downloaded.zip`, `bomb.zip`, `fake.zip`, `big.zip`). These checks are still to come:

1. Double-click `sample.zip`: a tab opens with `docs`, `images` and `README.txt` (no `.` entry, no "hidden" note). Open `docs`, then `old`; the path bar shows `sample.zip › docs › old`; Backspace goes up.
2. Double-click `README.txt` inside: it opens in a new tab, read-only. Close it.
3. Type `notes` in the search box: `notes.txt` is listed with "Matches in the whole archive"; **Open item location** shows `docs\old` with it selected.
4. Repeat 1 and 2 with `sample.7z`, `sample.tar`, `sample.tar.gz`, `sample.tar.xz` and `notes.txt.gz`. The status bar names the format.
5. **Extract all** in the `sample.zip` tab: the Explorer shows the folder with the new `sample` selected; its contents match `src`. Click **Extract all** again: `sample (2)` appears; nothing in `sample` changed.
6. Ctrl+Z: `sample (2)` goes to the Recycle Bin; Ctrl+Y brings it back.
7. Right-click `sample.tar.gz` > **Extract** > **Extract here**; right-click `sample.7z` > **Extract** > **Extract to…** > choose a folder.
8. Select `sample.zip` and `sample.7z` together > **Extract all** (command bar): two folders; one Ctrl+Z removes both.
9. Open `big.zip`: rows appear in about a second. **Extract all**, then **Cancel** in the File operations panel: "Cancelled"; no file whose name starts with `~`; Ctrl+Z removes the folder.
10. Open `bomb.zip`: it lists one file of about 1.4 GB. **Extract all**: the message about expanding to far more data appears; nothing was written.
11. Open `fake.zip`: the "can't be opened here" message with **Open in Windows app**.
12. Open `downloaded.zip`, open `README.txt` inside: protected view. Extract it: the extracted file also opens in protected view.
13. Task Manager while opening `big.zip`: a second `Adperastra.exe` appears briefly.
14. Repeat 1, 5 and 7 in Spanish and in the dark theme; check the ribbon key tips (Alt) and that every control works with the keyboard alone.
15. Settings > Opening files: the "Archive" group lists `7z, gz, tar, tgz, txz, xz, zip`; choosing the Windows app for it opens `.zip` files in Windows again.

## What works

- A new pure-Rust crate `crates/archive` reads zip (stored, Deflate, Deflate64, PPMd, Zstandard), 7z (LZMA, LZMA2, PPMd), tar, tar.gz, tar.xz, and single gz and xz files. The format comes from the bytes, never from the name.
- One listing per archive: 200,000-entry limit, cancel checks, per-format readers, progress.
- The browsing tree: folders the archive does not store are made from the paths; the Explorer's own sort order, search, and statistics.
- The extraction plan and the safe writer: `~<name>.partial` then a rename that never replaces, size checks, dates, the internet mark, bomb and free-space limits, and the skip reasons for unsafe names, links, protected items and damaged entries.
- The archive helper process: a second `Adperastra.exe --archive-helper` inside a Windows job object (1 GiB, kill on job close, die on unhandled exception), JSON lines over stdin/stdout, a `cancel` line, a 30 s silence timeout, a 5 s cancel grace and an 8 MiB line cap.
- The shared job table (`src-tauri/src/jobs.rs`, `job_poll` / `job_cancel`, `src/services/jobs.ts` with 100 ms polling and `newRequestId`), used by every new archive job.
- The seven archive commands: open, folder, search, close, open one file, extract, pick a folder; eight sessions with least-recent-used eviction; the 24-hour cleanup of `archive-open`.
- The archive tab: `FileList` in Details layout, `Breadcrumb` path bar, the file tab's search box over the whole archive, a ribbon with Extract and Navigate groups, item and background menus, the notes, the opening strip with progress and Cancel, and a keyboard-first flow.
- Extraction from the Explorer: **Extract all / here / to…** commands (visible only for archives), the right-click **Extract** submenu, the command bar entry, jobs with progress and Cancel, grouped Undo for several archives, and extraction requests from an archive tab.
- Help pages `archives` in English and Spanish; every new text translated (72 new keys, 582 to 654).

## Not in this step (on purpose)

- Creating archives, passwords and RAR (Step 06e), and bzip2 (Steps 06e; KI-040 to KI-042).
- Dragging, copying and pasting out of an archive, and editing inside one (Step 09c and the backlog).
- View modes other than Details inside an archive, thumbnails and previews of archive contents.
- Replace or Merge choices when extracting: extraction always keeps both.
- The general helper framework and the Background work settings (Step 07a); this step adds only `helper.rs`, which 07a reuses.

## Decisions and plan changes made during the step

The guide was followed as written except where it named code that this branch does not have (06a to 06c are not merged here). All of these are small and are listed so the branches can be joined:

1. **`fs_service::partial_path` (guide: `crates/fs-service/src/save.rs`).** That file arrives with Step 06a, so this step added `crates/fs-service/src/save.rs` with exactly the `partial_path` function 06a's guide specifies (same name, same doc line), plus its `pub mod save;` and re-export. When 06a lands, its `save.rs` only needs to add the rest.
2. **Folder picker (guide: `file_dialogs::pick_folder_path` and `templates_pick_folder`).** Neither exists here (06a and 06c), so `src-tauri/src/archive.rs` has a private `pick_folder` using the same `IFileOpenDialog` pattern as `settings_file.rs` (with `FOS_PICKFOLDERS`). When 06a and 06c land, this can move to `file_dialogs::pick_folder_path`.
3. **`HandlerViewProps.onOpenFile`.** The guide lists only `onExtractArchive` in the data shapes, but the archive tab opens the file it copies out through `onOpenFile`. So `src/handlers/types.ts` gained both optional props, `FileTabView` passes them to the view, and `App.tsx` passes `onOpenFile`. `onExtractArchive` is wired in T10 as the guide says.
4. **`styles/archive.css` import.** The guide says "right after `./styles/templates.css`", which is 06c's file; the import goes after `./styles/layout.css`, the last one here.
5. **`TrackJobOptions` / `TrackJob` live in `src/views/explorer/jobsTypes.ts`.** `scripts/check-i18n.mjs` reads `>…<` in `.tsx` files as hardcoded text and flags a generic function type written in a `.tsx` file; `JobsPanel.tsx` re-exports both types, so callers still import them from the panel as the guide says.
6. **7z dates.** The guide converts `NtTime` through `SystemTime`, which panics for a file time of 2^63 or more (`SystemTime::from` unwraps). The lister uses `u64::from(NtTime)` with `fs_service::filetime_to_unix`, the same seconds and 0 for unset dates, without a panic path in the helper.
7. **`showResult` in the Explorer (T10).** `navigate` always means "go to the destination and select what was made"; without it the items are selected and the folder refreshed only when the current folder is the destination. The guide's "when the location has not changed since the job started" needs a snapshot the deps do not carry.
8. **System-item confirmation in `runTracked`.** The `ops.system_confirmation_required` retry stays in `runTracked`, around `trackJob` (the guide moves only the panel logic into `trackJob`). A declined confirmation now leaves the first attempt in the panel as a failed row; the files are untouched and the behavior of the operation itself is unchanged.
9. **T11 details.** The guide's "step value `06c` becomes `06d`" has no counterpart in this branch (the step id comes from the branch name, `step-06d-archives`). "After Step 06c's measurements/screenshots" became "after Step 05d's", the last ones here. The archive screenshots find the "Extract" submenu as the second submenu of the item menu (`Open as` is the first), because the script has no translations and the pseudo-locale text cannot be matched.
10. **`helpers` for the corpus.** `System.IO.Compression.ZipArchiveMode` needs `Add-Type -AssemblyName System.IO.Compression` as well as `...FileSystem` in Windows PowerShell 5.1; both are loaded and the full type names are used. The corpus was built once by hand to check the script: `Big archive.zip` has exactly 10,000 entries and `Project files.zip` 6.
11. **`lzma-rust2` exists twice in the lock file** (0.22 for this crate, 0.23 as sevenz-rust2's own dependency). The zip-internal copy the guide warned about was avoided; the second version is sevenz-rust2's own and comes with the pinned version. `cargo tree -p archive -i bzip2` finds nothing.

## Speed (development PC, packaged release build)

Not measured yet: the owner's rules for this batch forbid running the measurements. The script changes are in place (T11), and the runs are still to come:

| Interaction | Tier | Measured (median) | Result |
|---|---|---|---|
| Open a 10,000-entry zip (first rows) | Fast (1 s) | not run yet | waiting |
| Open a folder inside an archive | Instant (0.1 s) | not run yet | waiting |
| Search 10,000 entries | Instant (0.1 s) | not run yet | waiting |
| Opening a file inside (small file) | Fast (1 s) | checked by hand (step 2) | waiting |
| Extracting | Background job | checked by hand (steps 5 and 9) | waiting |

Raw numbers: none yet (`docs/benchmarks/` gets them after the runs). The guide's note about tar.gz / tar.xz reading the archive twice needs the tar.gz run of the 10,000-entry corpus; log it as Minor if that takes more than twice as long as the zip.

## Checks by hand

Not done yet: the owner's rules for this batch put every check by hand after the build. Every row is waiting for the owner (the 15 steps under "Owner checklist").

| Check | English light | Spanish dark | Result |
|---|---|---|---|
| Archive tab, folders, search, opening a file inside (steps 1 to 4) | waiting | waiting | waiting |
| Extract all / here / to / selected, Undo and Redo (steps 5 to 8) | waiting | waiting | waiting |
| Cancel, bomb, damaged and protected view (steps 9 to 12) | waiting | waiting | waiting |
| Helper process, languages, keyboard, Default apps (steps 13 to 15) | waiting | waiting | waiting |

## Verification

- Per the owner's rules for this batch, `scripts/gate.ps1` (and `npm test`) were not run. After every task: `cargo fmt --all`, `cargo check --workspace --all-targets` (no warnings), `npm run lint:i18n`, `npm run lint:ipc` and `npm run build` (which includes `tsc --noEmit`) all pass.
- Final state: 69 Tauri commands in the IPC check, 654 translation keys, 34 help pages.
- New Rust tests: `normalizes_good_paths`, `refuses_paths_that_leave_the_folder`, `refuses_names_windows_does_not_allow`, `recognizes_root_entries`, `splits_inner_paths`, `bomb_rule`, `space_rule`, `dos_time_uses_the_local_zone`, `dos_time_refuses_impossible_dates`, `detects_formats_by_content`, `error_codes`, `lists_a_zip`, `lists_a_7z`, `lists_tar_tar_gz_and_tar_xz_alike`, `lists_single_gz_and_xz_files`, `bsdtar_root_entries_are_left_out`, `a_damaged_tar_is_partial`, `a_truncated_zip_is_corrupt`, `too_many_entries_is_refused`, `cancel_stops_listing`, `builds_folders_from_paths`, `counts_files_and_hidden_items`, `sorts_like_the_explorer`, `searches_names_in_the_whole_archive`, `extract_all_skips_what_is_unsafe`, `a_selection_is_relative_to_the_base`, `a_folder_selection_takes_everything_below`, `paths_outside_the_base_are_refused`, `single_file_rules`, `a_changed_archive_is_refused`, `bombs_are_refused`, `top_level_names_keep_both`, `extracts_a_zip_into_a_new_folder`, `extracting_twice_keeps_both`, `extracts_every_format`, `keeps_modified_times`, `copies_the_internet_mark`, `opens_one_file`, `cancel_leaves_no_partial_file`, `bombs_are_refused_before_writing`, `a_changed_archive_is_refused` (extraction), `write_entry_counts_bytes`, `begin_poll_finish`, `duplicate_ids_are_refused`, `cancel_sets_the_token`, `too_many_unfinished_jobs`, `errors_are_returned`, `capped_lines`, `drives_a_helper_until_its_last_line`, `a_helper_that_closes_is_a_failure`, `a_silent_helper_times_out_and_is_killed`, `a_cancel_is_sent_once_and_then_the_helper_is_killed`, `a_too_long_line_is_a_failure`, `a_helper_line_round_trip`, `the_memory_limit_applies`, `requests_round_trip`, `messages_round_trip`, `batches`, `sessions_drop_the_oldest`, `extract_args_are_checked`, `cleanup_removes_only_old_folders`, `temporary_archives_are_recognized`.
- New UI tests: `archiveFiles.test.ts` (4), `archiveItems.test.ts` (4), `archiveView.test.tsx` (10), `jobs.test.ts` (5), `jobsPanel.test.tsx` (2), `archiveExtract.test.tsx` (5), plus the extract-commands case in `commands.test.ts` and the Backspace case in `shortcuts.test.ts`.

## Screenshots

Not taken yet (the batch rules forbid starting the app). `docs/screenshots/step-06d/` will hold `46-archive-tab`, `47-archive-search` and `48-extract-menu`, in English light, Spanish dark and the pseudo-locale. The design comparison is still to come.

## Known issues

- New: KI-040 (Minor) protected archives can't be opened yet; KI-041 (Minor) RAR; KI-042 (Minor) bzip2 - all deliberate placeholders for Step 06e.
- Fixed: none.
- Still open (not touched by this step): KI-033, KI-032, KI-030, KI-035, KI-034, KI-023, KI-024, KI-001. Nothing new blocks this step, and no Blocker or Major was found in what the step touches.

## Design deviations, dependencies, licenses

- `DESIGN_DEVIATIONS.md`: none. The archive tab uses `plan/design-spec.md` values through tokens only.
- New dependencies (crate `archive`, default features off): zip 9.1 (MIT), sevenz-rust2 0.24 (Apache-2.0), tar 0.4 (MIT OR Apache-2.0), flate2 1.1 (MIT OR Apache-2.0), lzma-rust2 0.22 (Apache-2.0), plus the code they pull in: deflate64 (MIT), ppmd-rust (CC0-1.0 OR MIT-0), zopfli (Apache-2.0), zlib-rs (Zlib). Recorded in `THIRD_PARTY_LICENSES.md` and `docs/dependency-and-license-table.md`. No bzip2 library.

## Commits

```
2e31981 test(speed): archive open, folder change and search; archive screenshots [step-06d/T11]
d39250f feat(explorer): Extract all, Extract here, Extract to and extraction from archive tabs [step-06d/T10]
ad89014 feat(archive): archive file tab with folders, search and opening files inside [step-06d/T9]
564a8e1 feat(archive): browsing sessions, open a file inside, extraction jobs [step-06d/T8]
4cb803a feat(archive): archive helper process with a job-object memory limit [step-06d/T7]
1abcea3 feat(jobs): shared job table with job_poll and job_cancel [step-06d/T6]
e0a8342 feat(archive): extract safely with partial files, no overwrite and the internet mark [step-06d/T5]
a26ee2c feat(archive): browsing tree and extraction plan [step-06d/T4]
ab862b6 feat(archive): list zip, 7z, tar, tar.gz, tar.xz, gz and xz archives [step-06d/T3]
bd94000 feat(archive): safe inner paths, limits, zip dates and format detection [step-06d/T2]
c5ca935 deps: add zip 9.1, sevenz-rust2 0.24, tar 0.4, flate2 1.1, lzma-rust2 0.22 for the archive crate (MIT/Apache-2.0) [step-06d/T1]
```

## Next step

Step 06e: archives: create, passwords, RAR (from `plan/STATUS.md`; its state is `outline`).
