# Known issues

Every defect, deferral, and speed miss is recorded here instead of being
silently forgotten or quietly relaxed. Severity rules are in
`plan/rules.md` section 11 and in `AGENTS.md` section 4.

Each entry: ID, severity, the step where it was found, a plain-language
description, any workaround, and the target step or milestone for the fix.
When an issue is fixed, move it to the **Fixed** section with the commit
that fixed it.

## Open

### KI-032 - The hex viewer has no search or Go to offset yet (Minor, deferral)
- **Found in:** Step 04c, 2026-10-30. **Severity:** Minor (deliberate deferral named in the step file; the viewer scrolls the whole 1 MB part, and larger files use the part buttons).
- **What:** The hex viewer shows offsets, hex and text, with zoom and 1 MB parts, but a byte sequence cannot be searched and there is no Go to offset box. Both are scheduled with the other hex tools.
- **Workaround:** use the part buttons to move through a large file, and Ctrl+F is not offered in this viewer.
- **Target:** Step 06f (tables, JSON, fonts, hex search).

### KI-030 - Replacing existing files is not available yet (Minor, owner-approved deferral)
- **Found in:** Step 03b, 2026-10-30. **Severity:** Minor (a deliberate deferral approved by the owner; the step does not require it, and Merge / Skip / Keep both cover safe daily use).
- **What:** A path-based Recycle Bin call cannot prove that it removes the exact file the user approved; another file can appear at the same path after the prompt. The command boundary therefore returns `ops.replace_unavailable` and the dialog offers Merge (folders), Skip and Keep both. Replace returns with the full conflict window and the approved-target mechanism in `plan/contracts.md`.
- **Workaround:** choose Keep both to keep both files, or delete the old item first with Delete (it goes to the Recycle Bin). Merge adds new files to an existing folder without touching files already there.
- **Target:** the full conflict window (Step 09f); reviewed at the v0.1 milestone.

### KI-023 - Builds before this fix left a WebView2 folder outside the data folder (Minor)
- **Found in:** Step 03b, 2026-10-30. **Severity:** Minor (disk space only, a one-time leftover).
- **What:** Until commit `4725674` the window's WebView2 profile (cache and browser storage, no user files or settings) was kept in `%LOCALAPPDATA%\<app identifier>\EBWebView` instead of the app's data folder. It now lives in `<data>\webview`, so the old folder is no longer used; the first start after updating creates the new profile once (about the cost in KI-001).
- **Workaround:** the old folder can be deleted by hand; nothing in it is needed.
- **Target:** the App storage page (Step 12a) lists and removes leftover app folders.

### KI-024 - Interactions measured over the 20% rule in speed comparisons (Minor)
- **Found in:** Step 03b, 2026-10-30. **Severity:** Minor (well inside the 100 ms tier; owner decision 2026-10-30 that unreliable speed results do not block).
- **What:** One release run measured rename box (F2) 8.6 ms vs 5.9 ms in Step 03a, and 100k folder Shift+click range 30.6 ms vs 12.9 ms. On this PC, with other apps running, the same build varied up to 2x between runs: Shift+click measured 12.6, 16.1 and 34.8 ms in alternating runs against a mid-step build's 21.1, 27.5 and 52.4 ms. A subsequent three-round alternating comparison against Step 03a measured selection at 10.1 ms vs 7.9 ms and 100k-folder Select All at 36.3 ms vs 28 ms. Both exceed the 20% regression check but remain within the 100 ms Instant tier. The final step build measured, in two consecutive full runs, select 10.7 then 9.5 ms (Step 03a 8 ms) and Select All 31.1 then 30.5 ms (Step 03a 25.9 ms): the first run failed the 20% rule on both rows, the second passed all rows. Startup runs 2-6 were ready in 898-969 ms (median 929 ms) versus the Step 03a median 779 ms, 19% slower and inside the 20% rule. The full speed check therefore depends on run-to-run noise; the owner decided on 2026-10-30 that unreliable speed results do not block. Results: `docs/benchmarks/2026-10-30-ui-step03b-final.json`, `-final-2.json`, and `2026-10-30-startup-step03b.json`.
- **Workaround:** none needed.
- **Target:** check again at the next step's speed run.

### KI-001 - First-ever run takes about 2.2 seconds (Minor)
- **Found in:** Step 01b. **Severity:** Minor (one-time cost).
- **What:** The very first launch creates the WebView2 profile and takes
  about 2.2 s to show the window on the development PC. The startup
  skeleton (built into the first page) is shown as soon as the window
  paints. Every later start is fast (see KI-002/KI-003).
- **Workaround:** none needed; it happens once.
- **Target:** reviewed at every milestone; no fix planned unless the
  after-reboot measurement (KI-003) shows a wider problem.

### KI-002 - First start after installing or rebuilding takes about 1.6 s to first paint (Minor)
- **Found in:** Step 01b. **Severity:** Minor (one-time cost per install).
- **What:** The first execution of a freshly installed or rebuilt
  executable pays Windows Defender scanning and cold file caches: about
  1.6 s to first paint and 2.4 s until fully ready in the worst measured
  run. Normal cold starts (WebView2 stopped, caches warm) measure 87 ms
  first paint / 699 ms ready, inside the Fast tier.
- **Workaround:** none; start the app once after installing.
- **Target:** reviewed at every milestone.

### KI-003 - Cold start right after a reboot is not yet measured (Major)
- **Found in:** Step 01b. **Severity:** Major until measured (a daily-use
  speed miss cannot be ruled out yet).
- **What:** All cold numbers so far were measured without rebooting the
  PC, so cold operating-system caches after a real reboot are unproven.
- **Workaround / next action:** the owner runs
  `scripts\measure-startup.ps1` right after a reboot; then this entry is
  closed (if inside the Fast tier of 1 s) or kept open with a fix plan.
- **Target:** measurement at the next reboot; any fix before v0.1.

### KI-004 - The app icon is a placeholder (Minor)
- **Found in:** Step 01b. **Severity:** Minor (cosmetic).
- **What:** The window/taskbar icon is a generated solid-blue square
  (`src-tauri/icons/icon.ico`), not a designed Adperastra icon.
- **Workaround:** none.
- **Target:** a designed icon before v0.1 (Step 08c release polish at the
  latest).

### KI-005 - Snap-layout flyout not yet confirmed visually by the owner (Minor)
- **Found in:** Step 01b. **Severity:** Minor (until confirmed).
- **What:** The custom maximize button now reports `HTMAXBUTTON` to
  Windows (verified by message test), so the Windows 11 snap-layouts
  flyout should appear on hover - but the owner has not yet seen it with
  their own eyes.
- **Workaround:** window snapping still works with Win+arrow keys and by
  dragging the title bar to a screen edge.
- **Target:** owner confirmation in normal use; if the flyout does not
  appear, this becomes a Step 02 fix.

### KI-009 - A pinned folder renamed or deleted outside the app stays stale in the nav pane (Minor)
- **Found in:** Step 02. **Severity:** Minor (rare edge case).
- **What:** The open folder and This PC update live (watch + drive polling), but a pinned folder itself being renamed or deleted in another app is not noticed; the nav pane keeps the old entry until you unpin it or restart. Clicking it shows "This folder could not be opened."
- **Workaround:** unpin the stale entry (open it fails, so use the unpin button next to it) and pin the renamed folder; or restart the app.
- **Target:** Step 07a background refresh (the metadata service can verify pinned paths then).

### KI-015 - Some command bar and menu entries are placeholders (Minor)
- **Found in:** Step 03a. **Severity:** Minor (placeholders, by owner decision on 2026-10-28).
- **What:** The List and icon views under View are disabled until the view modes (Step 05); their tooltips say they arrive in a later update. (New, Cut, Copy, Paste and Delete were placeholders too until Step 03b turned them on.)
- **Workaround:** Windows' own commands are available through Show more options.
- **Target:** Step 05.

### KI-016 - Some classic-menu commands may do nothing (Minor)
- **Found in:** Step 03a. **Severity:** Minor (rare, Windows design).
- **What:** "Show more options" hosts the classic Windows menu outside Windows Explorer. Commands that expect Explorer's own file list around them (for example Rename in the classic menu) may do nothing. Everything Adperastra's own menu offers works.
- **Workaround:** use Adperastra's own Rename (F2) and menu commands.
- **Target:** review with Windows integration (Step 16).

## Fixed

### KI-031 - Markdown page search could fail on engines without the CSS Custom Highlight API (fixed in Step 04b)
- **Found in:** Step 04b, 2026-10-30. **Severity:** Minor (only web engines without the CSS Custom Highlight API; the text viewer and the Markdown source view are not affected).
- **What:** The search box of the Markdown reading view read `CSS.highlights` without first checking that the engine has a `CSS` object. On an older engine without it, typing in the search box threw an error instead of showing results.
- **Workaround:** use View > Source, whose search uses CodeMirror.
- **Fix:** `findInPage` checks for `win.CSS` first and reports no matches when the API is missing, so the page keeps working; the source view remains the place to search on such engines. Fixed in commit `f421c67`; test "finds nothing when the engine has no Custom Highlight API" (`src/__tests__/markdownRender.test.ts`).

### KI-025, KI-026, KI-028, KI-029 - Unsafe image paste, an unapproved Replace, a broken Redo, and in-process image decoding (fixed in Step 03b)
Replace is refused at the command boundary (`ops.replace_unavailable`), so a file that appears after the conflict prompt can never be recycled without a new decision; the dialog offers Merge / Skip / Keep both. A stored replacement history now fails safely with `ops.exists` and leaves the restored item in place. Clipboard images are encoded in a separate `--clipboard-image-helper` process with a 1.5 GiB job limit and a 15 s timeout; the parent owns an exclusive staging handle, publishes without replacing, and deletes only its own file on failure. The PNG input buffer lives through decoding. Fixed in commit `96dedb4`; tests `image_output_never_overwrites_a_destination_created_during_encoding`, `partial_creation_never_replaces_an_existing_file`, `staging_handle_denies_replacement_and_publishes_without_overwriting`, the helper frame/timeout/crash tests, `redo never recycles or overwrites a destination restored by undo`, and "does not offer Replace or Merge for a file conflict".

### KI-027 - A move could remove a source changed during copying (fixed in Step 03b)
The copy keeps the source's volume, file ID, attributes, times and size. Before deleting, the source is reopened with writes, renames and deletes denied, its identity and bytes are compared with the finished copy, and it is deleted through that handle only when unchanged. A source that changed or was replaced stays; directory links in a moved tree skip the whole top-level item, and a merge never writes through a junction in the destination. Fixed in commits `96dedb4` and `83ee390`; tests `merged_move_does_not_delete_a_file_recreated_after_it_was_copied`, `merged_move_preserves_an_identical_replacement_created_during_the_job`, `merged_move_preserves_source_when_its_attributes_change`, `merged_move_can_remove_a_readonly_source_when_it_is_unchanged`, `merged_move_never_removes_files_through_a_directory_junction`, `merge_never_writes_through_a_destination_junction`, and `cross_volume_path_flushes_then_deletes_the_exact_source_handle`.

### KI-022 - Earlier full-suite claims exceeded recorded verification (fixed in Step 03b)
`scripts/test-all.ps1` now holds the promised runner, with license and vulnerability audits, packaged runtime checks with axe-core, scroll frame times and a speed gate; `docs/test-and-speed-plan.md` lists what actually runs and which later step builds the rest. Screenshot comparison stays by hand. Not yet run: full mode on GitHub. Commits `d39f90b`, `0d235b4`.

### KI-018 - Individual conflict choices were ignored (fixed in Step 03b)
The destination template now builds the real target path, so with "Do this for all" cleared each conflict asks and gets its own Replace, Keep both or Skip. Fixed in commit `3652e53`; test "applies Replace then Keep both separately when the for-all box is cleared" (`src/__tests__/fileOpConfirmations.test.tsx`).

### KI-019 - Some partial moves had no Undo entry (fixed in Step 03b)
Moves keep an exact transfer plan (`crates/fs-service/src/transfer.rs`), and an Undo entry is pushed whenever anything changed on disk, even when the job was cancelled before a single source finished. Fixed in commit `3652e53`; tests `cancelled_move_undoes_retained_copies_and_redoes_only_written_files`, `partial_move_deletion_failure_separates_moved_files_from_retained_copies` and "records destination changes from a cancelled move before any source completed".

### KI-020 - Move and delete did not warn about system items (fixed in Step 03b)
Move, recycle, permanent delete and Replace check fresh attributes (also inside folders) before changing anything and ask first, with Cancel focused (`src-tauri/src/operation_safety.rs`). Fixed in commit `3652e53`; Rust tests in `operation_safety.rs` and UI tests in `fileOpConfirmations.test.tsx`.

### KI-021 - Restore and Replace Undo tests failed on Windows CI (fixed in Step 03b)
Cause: GitHub's runner keeps its temporary folder under a short 8.3 name (`C:\Users\RUNNER~1\...`), while the Recycle Bin records the long path, so restore lookups found no match. Paths are now compared in their long form (`winpath::long_path_wide`). Fixed in commit `3652e53` (tests `restore_accepts_a_short_parent_path_without_swapping_extensions`, `replacing_with_a_short_parent_path_keeps_the_exact_undo_entry`); the three tests pass on GitHub run 41001206899.

### KI-014 - Renaming had no Undo (fixed in Step 03b)
Rename now pushes an undo entry: the toast after a rename has an Undo button (Ctrl+Z), Ctrl+Y redoes it, and Recent actions lists it. The undo stack (contract 11) is shared by rename, copy, move, delete, create, and paste. Fixed in commit `815731b` (engine and jobs in `4330f4b`/`ec167e4`).

### KI-017 - App start looked slower than Step 01b (closed after measuring, Step 03a)
One early 03a run took 1.14 s to be ready. Measured side by side with
`scripts/measure-startup.ps1` (cold WebView2, 5 runs each after the
one-time first run): the `v0.0.4-step02` build was ready in 825-874 ms
(median 841) and Step 03a in 702-870 ms (median 779), with first paint
around 90 ms in both. Step 03a is not slower than Step 02 and every run is
inside the 1 s Fast tier; the time added since Step 01b (0.70 s) comes
from Step 02's Home data. The 1.14 s run was a one-off. Numbers:
`docs/benchmarks/2026-10-28-startup-step02.json` and
`docs/benchmarks/2026-10-28-startup-step03a.json`.

### KI-013 - Hidden and system files were always shown (fixed in Step 03a)
Hidden items are now hidden by default, like Windows, and **View** >
**Hidden items** shows them (dimmed); the choice is saved in settings
(schema 3). Fixed in commit `08a6cef`, earlier than its 10b target because
the Step 03a View menu asks for the toggle.

### KI-010 - Explorer-state save was not fully atomic and reads were unlocked (fixed in Step 02)
When the first rename failed, the writer deleted `explorer-state.json`
before renaming its replacement, so a crash in between lost pins and
recent folders; the settings and session files used the same writer. The
shared writer now flushes the temp file, replaces the target in one rename
step, and retries a busy target instead of deleting it; state reads take
the writers' lock. Fixed in commit `4f774c3` (tested: replace without
leftovers, target never deleted when it cannot be replaced).

### KI-011 - File IDs lost precision crossing to TypeScript (fixed in Step 02)
`file_id` was a JSON number, which JavaScript cannot hold exactly above
2^53. It is now a decimal string on both sides, before tags (Step 11b)
rely on it. Fixed in commit `5cc8df0` (tested with an ID above 2^53).

### KI-012 - A very large Windows Recent folder could delay Home (fixed in Step 02)
Every shortcut was resolved before the 30-item limit applied. Shortcuts are
now sorted by their own time and resolved newest-first until 30 live
targets are found. Fixed in commit `e6074a3` (tested: 5,000 shortcuts, 31
resolved).

### KI-006 - Help center showed no pages in the packaged app (fixed in Step 01b)
The help client sent `language` where the Rust commands expect `lang`, so
every help call failed. Fixed in commit `1f902bd` (argument names aligned;
verified in the packaged app: 6 pages listed and rendered).

### KI-007 - Maximize button rectangle never reached Windows (fixed in Step 01b)
The button's `ref` was never attached, and the new `set_maximize_rect`
command was missing from the isolation allowlist - two silent failures in
a row. Fixed in commit `7362de4`; verified: the maximize area now returns
`HTMAXBUTTON` (9), close/content return `HTCLIENT` (1).

### KI-008 - Hardcoded-text lint false positive on TypeScript generics (fixed in Step 01b)
The lint's JSX-text regex could span from a generic's `>` across ordinary
code and flag it as UI text. Code-like spans are now skipped; the lint
still fails on a planted hardcoded string (probe-tested). Fixed in commit
`7422092`.
