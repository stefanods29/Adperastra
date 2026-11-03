# Known issues

Every defect, deferral, and speed miss is recorded here instead of being
silently forgotten or quietly relaxed. Severity rules are in
`plan/rules.md` section 11 and in `AGENTS.md` section 4.

Each entry: ID, severity, the step where it was found, a plain-language
description, any workaround, and the target step or milestone for the fix.
When an issue is fixed, move it to the **Fixed** section with the commit
that fixed it.

## Open

### KI-088 - Saving or extracting below a folder that is a mounted volume is refused (Minor)
- **Found in:** the KI-068 repair, 2026-10-31. **Severity:** Minor (a rare setup; nothing is written and nothing is lost).
- **What:** The folder pin refuses every folder that redirects to another place, which includes a drive mounted into a folder. Cloud-synced folders are allowed by a test of their tag only: a real OneDrive folder has not been tried.
- **Workaround:** use the drive's own letter.
- **Target:** reviewed at the next milestone.

### KI-087 - Save as cannot replace an existing file (Major)
- **Found in:** the KI-068 repair, 2026-10-31. **Severity:** Major (a part of Save as is unavailable; choosing a new name is the workaround).
- **What:** Recycling can't yet be tied to the exact file the user approved (`plan/contracts.md`, approved Replace targets), so Save as onto an existing file stops with a message and changes nothing. Windows' dialog still asks "replace?" first, and answering yes leads to that message.
- **Workaround:** choose a new name, or move the old file away first.
- **Target:** Step 09f, because the fix needs the conflict window's approval and recovery work, the same as Replace and version copies. Remove the dialog's question or enable Replace there.

### KI-086 - JSON numbers beyond 64 bits show rounded in the tree (Minor)
- **Found in:** Step 06f (D8), 2026-10-31. **Severity:** Minor (the value is still readable, and Open as text shows the exact text; the file is never changed).
- **What:** The tree reads numbers as 64-bit integers or doubles, so an integer beyond 64 bits, or a very long decimal, can appear rounded in the tree.
- **Workaround:** use Open as text to see the exact number.
- **Target:** reviewed at the next milestone.

### KI-082 - App-owned spool folders are retained, not reclaimed (Minor)
- **Found in:** Step 06e T9 implementation, 2026-10-31. **Severity:** Minor (no data loss; a full budget refuses new work instead of guessing ownership).
- **What:** A helper that is killed leaves its `%LOCALAPPDATA%\Adperastra\archive-create\<request-id>` folder (marker plus incomplete `archive.spool`). The parent only removes spool folders it created and can still verify; it does not reclaim abandoned ones at startup. Until the App storage page exists, those bytes stay and can eventually make new creations fail with the translated "another archive is being created" or no-space message.
- **Workaround:** close the app and delete only the `archive-create` folder under the data folder; it holds no user files.
- **Target:** Step 12a (App storage) with a verified ownership record and the creation lock; do not delete paths by guess before that.

### KI-081 - RAR runtime is unverified without a separately installed 7-Zip (Minor, pending acceptance)
- **Found in:** Step 06e T7 implementation, 2026-10-31. **Severity:** Minor while the executable is absent; becomes Major if RAR support is called verified without it.
- **What:** The read-only adapter, literal re-selection, stdin password transport and layout refusals are covered by fake-process tests. No 7-Zip is installed on this PC, so hidden-child startup, version/switch behavior, UTF-8 password prompting, exact empty-file identity and multipart refusal have not been exercised against the real program. The guide does not name the UTC listing switch; the parser accepts timestamps only with an explicit ` UTC` suffix and otherwise records 0.
- **Workaround:** open RAR files in the app Windows uses; they remain readable there.
- **Target:** owner/coordinator runtime check with a current 7-Zip from 7-zip.org before RAR is described as verified. Unknown or unprovable layouts already fail closed.

### KI-080 - Hex view stays on its error after a later read recovers (Minor)
- **Found in:** the owner's earlier review note, confirmed during 06f planning, 2026-10-31.
- **What:** the existing HexView read effect sets failed on rejection but never resets it when another read starts or succeeds. A later valid range can load bytes while the view still renders the old error.
- **Workaround:** close and reopen the file tab.
- **Target:** later owner-approved repair of existing reader error state; not silently bundled into the new search/offset work under the existing-error policy.

### KI-078 - The editor status keeps the file's opening byte size after saving (Minor)
- **Found in:** release screenshots during the 06b/06c review, 2026-10-31. **Severity:** Minor.
- **What:** after seven saves the real file and history show 107 bytes, while the editor status still shows its original 45 bytes. The status reads the original file metadata in the existing editor path; no save data was lost. This existing display issue is documented under the owner's no-existing-fixes policy.
- **Target:** a later owner-approved editor metadata refresh; hand-check other status fields with it.


### KI-075 - The packaged editor reports blocked inline-style CSP violations (Major)
- **Found in:** local 06b/06c review, 2026-10-31. **Severity:** Major.
- **What:** Release-app verification captured two style-src violations while opening the editor. Tauri adds a style nonce, which makes unsafe-inline ineffective. The CSP declaration and CodeMirror setup are unchanged from testing at 33fbe83; no baseline executable comparison has been run. English/Spanish/pseudo functional flows completed, but their console-clean check remains failed. No CSP relaxation or warning suppression was applied.
- **Target:** Existing configuration investigation remains outside this batch under the owner's existing-error policy. Fix before release; current runtime verification must not be called entirely clean.



### KI-069 - Content replacement has a close-to-replace path race (Major)
- **Found in:** local 06b/06c review, 2026-10-31. **Severity:** Major.
- **What:** The existing explicit content-save contract uses path-based ReplaceFileW. The new restore path holds a target read/rename guard through staging, snapshot and identity revalidation, then must close it before ReplaceFileW. A concurrent path swap in that final interval is not atomically bound to the inspected object. The safety review does not claim that identity revalidation closes this race.
- **Target:** A shared identity-bound content replacement/recovery design is required before release; keep this limitation visible alongside the approved Replace contract. The KI-068 repair moved saves to owned staging, but the swap itself is still path-based, so this race remains.

### KI-070 - Template build tools include two high advisories in an unused image parser (Minor, bounded deferral)
- **Found in:** local 06b/06c review, 2026-10-31. **Severity:** Minor, bounded deferral.
- **What:** npm audit including development tools reports 9 moderate and 2 high findings; npm audit --omit=dev reports zero. The high findings are image-size 1.2.1 via pptxgenjs 4.0.1: GHSA-5p2g-fcmc-qvqq (JXL/HEIF) and GHSA-w3rx-r6r6-pgpr (ICNS). The template generator adds text and no images, so those parser paths are not called; none of these build packages ships in the app. image-size 2.0.3 is MIT but outside the declared ^1.2.1 range; no forced override or dependency downgrade was applied.
- **Target:** Review by 2026-11-07 and before any image input is added to the generator or v0.1 is prepared. Upgrade through a compatible upstream fix or a verified build-only change; do not describe these as only obsolete utility warnings.




















### KI-048 - The UI build prints a chunk-size warning (Minor)
- **Found in:** Step 06b, 2026-10-30, while building after each task. **Severity:** Minor (a build warning only; package/runtime verification belongs to the step reports).
- **What:** `npm run build` ends with "(!) Some chunks are larger than 500 kB after minification" for the main `index-*.js` chunk (about 535 kB, about 160 kB gzipped). That is Vite's default warning limit, not an error.
- **Workaround:** none needed; the warning does not stop the build.
- **Target:** reviewed at the next milestone (a code-splitting pass would silence it).

### KI-042 - Archives compressed with bzip2 are not read yet (Minor, deferral)
- **Found in:** Step 06d. **Severity:** Minor (deliberate deferral named in the step file; the owner allowed the bzip2 library for Step 06e).
- **What:** `.bz2`, `.tbz`, `.tbz2` and `.tar.bz2` files open in their Windows app instead of a tab, and a zip or 7z entry compressed with bzip2 is skipped with "Skipped: it's compressed in a way the app can't read".
- **Workaround:** open those files in another app that reads bzip2.
- **Target:** Step 06e (archives: create, passwords, RAR), which adds bzip2.

### KI-041 - RAR archives open in their Windows app (Minor, deferral)
- **Found in:** Step 06d. **Severity:** Minor (deliberate deferral named in the step file; RAR is read through a 7-Zip the owner installs, which comes with the archive-creation work).
- **What:** Double-clicking a `.rar` file opens it in the app Windows uses for RAR files; it does not open as a tab in Adperastra.
- **Workaround:** none needed; the Windows app shows the archive.
- **Target:** Step 06e (archives: create, passwords, RAR).

### KI-040 - Archives protected with a password can't be opened yet (Minor, deferral)
- **Found in:** Step 06d. **Severity:** Minor (deliberate deferral named in the step file: protected items are listed and explained, never opened, so nothing is lost).
- **What:** Items inside a zip or 7z archive that are protected with a password are listed with the note that they can't be opened yet; extracting them skips them with "Skipped: it's protected with a password" and nothing is written.
- **Workaround:** open the archive in another app that asks for the password.
- **Target:** Step 06e (archives: create, passwords, RAR).
### KI-039 - The speed record's step name comes only from the runner (Minor)
- **Found in:** Step 06a, while applying the guide's "the step value `05d` becomes `06a`" (2026-10-30). **Severity:** Minor (tooling; nothing the user sees, and no measuring result is wrong).
- **What:** `scripts/measure-ui.mjs` has no hardcoded step value: the JSON record's `step` comes from the 9th argument, which `scripts/measure-ui.ps1` fills from `-Step` or the branch name. A run outside a step branch, without `-Step`, records `"unknown"`, and the guide's instruction has nothing to change. The same instruction in Step 05d's guide was not applied for the same reason.
- **Workaround:** pass `-Step 06a` (or run on the step's branch) so the record is named correctly.
- **Target:** reviewed at the next milestone.

### KI-037 - The Undo history can report no room after only a few file operations (Major)
- **Found in:** Step 05d screenshot runs, 2026-10-30; the code dates from Step 03b. **Severity:** Major until explained (a file operation is refused, though no file changes).
- **What:** The Spanish dark screenshot run twice showed `ops.undo_limit` ("Not enough room in the Undo history") after a handful of file operations in a fresh session. The English run showed no such message, but its panel keeps a "Copying 1 item" row with no progress bar. Each running transfer reserves 32 MiB of a 128 MiB budget, so four unfinished reservations are enough to cause this; a reservation that is never released is the first thing to check. In one other run, `notes.txt` also did not come back within 15 s after Delete and Undo; that run was not repeated.
- **Workaround:** restart the app.
- **Target:** not fixed yet; the owner decides when.

### KI-034 - Narrow layouts crowd the address bar and the Size column (Minor)
- **Found in:** Step 05c screenshots, 2026-10-30, at 1200 x 900. **Severity:** Minor (the owner approved the designs with these visible).
- **What:** With tabs on the left, the last part of a long address wraps and runs into the search box. With the toolbar on the left and both panes open, the Size column is cut off.
- **Workaround:** widen the window, hide a pane, or scroll the list sideways.
- **Target:** reviewed at the next milestone.

### KI-033 - Going to the folder that is already open empties the list (Major)
- **Found in:** Step 05c screenshot run, 2026-10-30; the code path dates from Steps 02 and 03a. **Severity:** Major until checked by hand (it can look as if a folder lost its files, though no file changes).
- **What:** `goToLocation` in `src/views/ExplorerHome.tsx` clears the list, but the listing effect only reloads when the path, sort or refresh count changes. Typing the open folder's path in the address bar leaves the list empty, and the status bar says "No items". Other routes through `goToLocation`, such as clicking the open folder in the navigation pane, may do the same; they have not been tried.
- **Workaround:** press F5, or open another folder and come back.
- **Target:** not fixed yet; the owner decides when. Steps building other work only document it (owner's decision, 2026-10-30).

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

### KI-096 - OCR search routing and the PDF text overlay were incomplete (Major, fixed during 07e integration)
- **Found in:** integration review of Step 07e, 2026-11-03.
- **What:** **Copy all text** worked, but the Find row did not search recognized image text, and the PDF viewer had no overlaid word layer, so OCR search had no visible matches.
- **Fix:** the image viewer now routes Find to OCR and highlights the current match; the PDF page renders the same inert overlay with `rotation={0}` and the raster-to-view zoom, and its Find row uses OCR only when the page has no native text.
- **Verification:** TypeScript build and the focused OCR/PDF suites pass; the full gate result is recorded in the step report. Real recognition remains an owner environment check.

### KI-094 - Incoming PDF helper handoff did not compile against the integrated toolchain (Major, fixed during 07d integration)
- **Found in:** first `cargo check`, Clippy and TypeScript build of the received 07d handoff, 2026-11-03; never accepted into the local baseline in this state.
- **Cause:** the control frame used the same `kind` tag as a payload field, the child imported a missing reply-shape validator, a nested outline counter captured a non-capturable parameter, the PDF.js 6.4 API has no `PDFDocumentProxy.destroy`, and TypeScript 7 rejects `Uint8Array<ArrayBufferLike>` as a `BlobPart`/`BufferSource`. Several public helper items are also unused until 07e.
- **Fix:** renamed the wire tag to `frame`, implemented the cheap reply-shape check, passed the outline limit explicitly, shut documents down through the loading task, made fresh `ArrayBuffer` copies for Blob/digest/upload, and scoped dead-code allows to the producer modules with the unused imports and Clippy findings corrected.
- **Verification:** 375 app tests and 38 focused PDF/handler UI tests pass; the full gate result is recorded in the step report.

### KI-093 - Incoming Gallery handoff did not compile against the integrated baseline (Major, fixed during 07c integration)
- **Found in:** first `cargo check` and full gate of the received 07c handoff, 2026-11-03; never accepted into the local baseline in this state.
- **Cause:** the scan referenced a `gallery_source` module that was not declared, called a non-existent `fs_service::list_dir_with_ids_cancellable`, used Gallery callbacks before their declarations, and two submitted tests named different fixture paths than the list they created. The command metadata test also rejected the guide's documented `gallery.*` label keys.
- **Fix:** declared the canonical module, used the existing ID-aware `list_dir_cancellable`, moved the callbacks before the stable actions memo, corrected the two expected paths without changing behavior, and allowed the documented Gallery label prefix in the command metadata test. The translation linter false positive and test-only aria-label templates were also rewritten.
- **Verification:** the 45 focused Gallery/settings tests pass, and the full gate result is recorded in the step report.

### KI-092 - Incoming quick preview and metadata handoff needed safety wiring (Major, fixed during 07b integration)
- **Found in:** static review and integration tests of the received 07b handoff, 2026-11-02; never accepted into the local baseline in this state.
- **Cause:** the submitted files were module fragments with a different managed-state shape, the metadata commands/helper dispatch were not registered, one locale block was inserted at the wrong level and hid the detail labels, and the modal restored `inert` to its previous `undefined` instead of `false`.
- **Fix:** declared the fragments under their canonical parent modules, injected the 07a `Arc` services directly, registered `metadata_read_start`/`metadata_release` and `preview_detect`/`preview_grant`/`preview_revoke` with the isolation allowlist, kept one top-level `metadata` label block plus `errors.metadata`, and restore the real boolean inert state. The dialog also keeps a named export for 07c.
- **Verification:** the 45 focused 07b UI tests pass, including late-grant revocation, modal shortcut isolation, inert restoration, stale metadata responses and read-only guards; the full gate is recorded in the step report.

### KI-089 - Incoming preview cache could touch foreign files or exceed its physical budget (Blocker, fixed during 07a integration)
- **Found in:** review and regression tests of the received 07a handoff, 2026-11-02; never accepted into the local baseline in this state.
- **Cause:** content-only accounting, filename-based ownership, lookup-to-open and cleanup path races, coercion of corrupt index fields, and helper output written before storage admission.
- **Fix:** account index/sidecars/pending/foreign bytes; native ownership receipts and same-handle open/deletion; bounded validated rows; inspect schema before writes; crash-cleaned helper staging preallocated under a cross-process budget lock. Foreground cloud-open policy is retained through a separate background API.
- **Verification:** the final 523-test Rust run includes physical-budget, substitution, foreign-byte retention, corrupt/oversized/newer index, OFFLINE refusal, actual crash cleanup and separate-process reservation regressions. Packaged-app verification is recorded separately in the step report.

### KI-090 - Incoming thumbnails had wrong channels and mirrored EXIF orientations (Major, fixed during 07a integration)
- **Found in:** exact RGBA roundtrip and asymmetric six-pixel EXIF tests, 2026-11-02.
- **Fix:** the public decoder returns actual RGBA and encoding converts to WIC BGRA. EXIF5/7 mappings match WIC transform ordering. All eight pixel orientation oracles remain unchanged.
- **Verification:** regression failed before correction; all 24 focused thumbnail tests passed afterward.

### KI-091 - Incoming preview cancellation and refresh could strand work or leak leases (Major, fixed during 07a integration)
- **Found in:** incoming group/job review and UI regressions, 2026-11-02.
- **Fix:** independent group cancellation, per-consumer start reservations, admission before user-job allocation, generation-safe completion, final-consumer cleanup, late-result lease release, listing revision invalidation, live status and one shared paused-preview eligibility poll. Ordinary scrolling releases no longer scan the full cache; explicit pending clear cleanup remains immediate.
- **Verification:** focused group/policy/UI regressions and the full UI suite passed. The real-job/lease runtime runner records its separate result; unit tests are not claimed as full saturation evidence.


### KI-079 - Archive extraction could delete a partial file it did not create (Blocker, fixed after Step 06f)
- **Found in:** Step 06e guide research, 2026-10-31, by reading the Step 06d code.
- **What:** A failed extraction removed the predictable `~name.partial` next to the target, even when that file belonged to someone else. The file was not flushed to the disk before it got its final name.
- **Fix:** `write_entry` now writes through `OwnedOutput` below a `PinnedDirectory`: a random staging name, flushed, published without replacing, and removed only through its own handle. After a killed helper, only abandoned `~adp-<name>-<uuid>.partial` files that nobody holds are removed. Each file is now flushed to the disk, which makes extracting many small files somewhat slower; this has not been measured.
- **Fixed in:** 7806263 (step-06d/F3).

### KI-068 - Text Save and Save as had unsafe staging and replacement paths (Blocker, fixed after Step 06f)
- **Found in:** local 06b/06c review, 2026-10-31.
- **What:** A save could truncate or remove a file that already had the predictable `~name.partial` name, or follow a link there. A save to a missing file and Save as used a rename that replaces. Save as sent the old file to the Recycle Bin before the new content was written, and could not tie that to the file the user approved. The same review of the code found one more way to lose data: when `ReplaceFileW` failed after removing the old file, the new content was deleted too.
- **Fix:** Saves use the same owned staging and no-replace publication as KI-079, and look at the target again just before the swap. After a failed swap the staging file is removed only when the old file is known to still be in place; otherwise the content is published or kept. Save as now only creates new files (KI-087). The remaining race in the swap itself is KI-069.
- **Fixed in:** 1a6209f (step-06a/F3).

### KI-032 - The hex viewer had no search or Go to offset (fixed in Step 06f)
- **Found in:** Step 04c, 2026-10-30.
- **Fix:** Step 06f adds whole-file search (text or bytes; Ctrl+F then Enter or F3, wrapping once) and Go to offset (Ctrl+G), with the match highlighted across a row. Commit `feat(viewer): hex search and Go to offset [step-06f/T10]`.

### KI-85 - A RAR file record with no size was treated as an empty file (Major, fixed in Step 06e)
- **Found in:** the full gate for Step 06e, 2026-10-31.
- **Fix:** `rar_listing.rs` refuses such a listing as ambiguous. Tested with a fake runner only; no real 7-Zip was available (KI-081).

### KI-84 - A wrong or missing archive password could leave output, or only skip files (Major, fixed in Step 06e)
- **Found in:** the full gate for Step 06e, 2026-10-31.
- **What:** With a wrong password, folders were created before the password was tried, and the run could report success with skipped files. With no password, encrypted files were skipped instead of the request being refused (guide D11).
- **Fix:** a selected encrypted item with no password now returns `password_required` before any write on every route. When the plan's first file is an encrypted ZIP entry, the password is tried before anything is created. When a plain file comes first, it is written and the failure is reported with what was created, as the guide's test requires.

### KI-83 - The new owned-staging folder pin always failed (Blocker, fixed in Step 06e)
- **Found in:** the full gate for Step 06e, 2026-10-31.
- **What:** `PinnedDirectory::open` opened the bare `\\?\C:` prefix, which is the volume device and not a folder, so Windows returned "Incorrect function". Creating archives and the new password and bzip2 extraction could not work at all.
- **Fix:** pinning starts at the volume root (`owned_io/directory.rs`).

### KI-076 - Added diff text was unreadable in the dark theme (Major)
- **Found in:** local 06b/06c review, 2026-10-31. **Severity:** Major.
- **What:** The recipe used a fixed pale green background while inheriting light text in dark mode. The Spanish dark screenshot exposed it. Added rows now mix the existing Excel accent with the current surface token and explicitly use the primary text token; release verification measures actual added/removed text contrast against the 4.5:1 minimum.
- **Fixed:** local 06b/06c review; full gate passed (349 Rust/462 UI tests), release screenshots inspected in English light, Spanish dark and pseudo-locale. Contrast and 640px/bounds checks passed; separate existing CSP failures remain recorded.

### KI-077 - The template window was constrained to the generic dialog width (Minor)
- **Found in:** local 06b/06c review, 2026-10-31. **Severity:** Minor.
- **What:** The template selector set width 640px but inherited the generic dialog max-width 520px. Release screenshots confirmed the narrower window. Its own max-width now matches the planned min(640px,92vw); verification checks the measured rectangle and overflow.
- **Fixed:** local 06b/06c review; full gate passed (349 Rust/462 UI tests), release screenshots inspected in English light, Spanish dark and pseudo-locale. Contrast and 640px/bounds checks passed; separate existing CSP failures remain recorded.

### KI-074 - Editor refresh failure could discard the successful restore Undo ID (Major)
- **Found in:** local 06b/06c review, 2026-10-31. **Severity:** Major.
- **What:** A restore writes the file before the editor callback finishes. A rejected callback previously prevented the dialog from storing previous_id and reported only failure. The recovery ID is now kept immediately after the successful disk operation; status also states that restoration occurred. A new regression test reproduces the callback failure and verifies Undo uses the exact prior ID.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-065 - Pending snapshots had no disk budget (Major)
- **Found in:** local 06b/06c review, 2026-10-31. **Severity:** Major.
- **What:** A stalled importer could let pending raw copies grow without the configured compressed-blob limit. Pending publication now enforces a separate 1 GiB budget; exhaustion fails the save before its source changes.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-066 - A long history could exceed the IPC response bound (Major)
- **Found in:** local 06b/06c review, 2026-10-31. **Severity:** Major.
- **What:** The command returned every version in one response. SQL now fetches bounded pages (2,000 rows plus one lookahead), validates a same-file date/ID cursor, and the dialog offers Load more.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-067 - Two version tests used incompatible fixtures (Minor)
- **Found in:** local 06b/06c review, 2026-10-31. **Severity:** Minor.
- **What:** The space-limit test used timestamps near 1970 with a 2023 retention clock, so age trimming correctly deleted all versions. Its samples now fall within retention and every assertion remains. The editor test expected CRLF inside CodeMirror; it now expects normalized LF and additionally checks the CRLF save setting.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-071 - An oversized source open for writing returned the wrong snapshot error (Minor)
- **Found in:** local 06b/06c review, 2026-10-31. **Severity:** Minor.
- **What:** The source consistency guard opened the source before checking the size and returned a sharing error for a file above 256 MiB. A size-only early observation now returns TooLarge as specified; every actual copy is still checked from the guarded opened handle. The existing test remains unchanged.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-072 - Pending publication could replace a colliding completion record (Major)
- **Found in:** local 06b/06c review, 2026-10-31. **Severity:** Major.
- **What:** A targeted regression test reproduced std::fs::rename replacing an existing internal completion record. Both raw-copy and completion-record publication now use the existing atomic no-replace helper. The test checks that the prior record survives and only owned staging is removed.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-073 - Version-store transitive license notices were incomplete (Major)
- **Found in:** local 06b/06c review, 2026-10-31. **Severity:** Major.
- **What:** The newly built arrayvec, constant_time_eq, fallible iterator crates, hashlink and libsqlite3-sys were missing from the notices, as was build-only vcpkg. Installed manifests confirm allowed licenses; both notice records now include them. The Windows build does not include rsqlite-vfs or sqlite-wasm-rs.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-049 - Template copies could overwrite or delete an existing partial file (Blocker)
- **Found in:** review of Step 06c, 2026-10-31. **Severity:** Blocker.
- **What:** Copying to a predictable partial path used a truncating write and path-based cleanup. A partial file or link already at that name could lose data. The correction uses exclusively created owned handles.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-050 - A template publication race could replace another file (Blocker)
- **Found in:** review of Step 06c, 2026-10-31. **Severity:** Blocker.
- **What:** The chosen final name was only probed before a replacing rename. A newly created destination, or exhaustion of numbered names, could be overwritten. Publication must refuse replacement and retry bounded numbered names.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-051 - A changed template path could escape the approved folders (Blocker)
- **Found in:** review of Step 06c, 2026-10-31. **Severity:** Blocker.
- **What:** Source authorization canonicalized a path but copying reopened it later. A swapped file or parent junction could redirect the read. Authorization and copying must use the same opened source handle.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-052 - Template listing failures looked like empty folders (Major)
- **Found in:** review of Step 06c, 2026-10-31. **Severity:** Major.
- **What:** Listing errors and skipped entries were discarded in Rust and in the picker. The correction preserves diagnostics and displays translated errors or a partial-results note.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-053 - Pressing Enter could create a different template from the focused one (Major)
- **Found in:** review of Step 06c, 2026-10-31. **Severity:** Major.
- **What:** Tab could focus Budget or a personal template without changing the selected item; Enter created the previous selection. Focus must update selection.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-054 - Large template copies had no progress or cancellation (Major)
- **Found in:** review of Step 06c, 2026-10-31. **Severity:** Major.
- **What:** Create dismissed the picker before an arbitrary-size copy completed. The correction uses shared jobs, byte progress, cancellation, and leaves the picker open until completion.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-055 - A chosen template folder could appear saved when persistence failed (Major)
- **Found in:** review of Step 06c, 2026-10-31. **Severity:** Major.
- **What:** The new folder flow used a callback that did not await saving settings and suppressed errors. The correction waits for persistence, preserves the confirmed folder on failure and reports the error.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-056 - An interrupted snapshot copy could be imported as a complete version (Blocker)
- **Found in:** review of Step 06b, 2026-10-31. **Severity:** Blocker.
- **What:** The pending raw file was visible while it was still being copied and had no completion evidence. A crash could leave a truncated version. The correction publishes flushed completed copies with their expected length.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-057 - Concurrent version imports and cleanup could delete live content (Blocker)
- **Found in:** review of Step 06b, 2026-10-31. **Severity:** Blocker.
- **What:** The worker and commands opened independent store connections; database commits and blob deletion could interleave. The correction serializes store mutations and composite restore work with an OS lock.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-058 - Restore could return the wrong undo snapshot or none after deduplication (Major)
- **Found in:** review of Step 06b, 2026-10-31. **Severity:** Major.
- **What:** previous_id was chosen from the newest row reason instead of the actual snapshot result. Skipped snapshots could reuse an unrelated old restore row, and deduplicated snapshots could lose undo. Restore must preserve and return its exact bounded snapshot even when ordinary history is off.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-059 - Stale version identifiers could restore another file's content (Blocker)
- **Found in:** review of Step 06b, 2026-10-31. **Severity:** Blocker.
- **What:** Deleting versions allowed SQLite IDs to be reused. A retained undo ID could then name a different file's content. IDs must remain monotonic across deletion and restore must verify the ID belongs to the requested path.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-060 - Delete all versions left pending snapshots to reappear (Major)
- **Found in:** review of Step 06b, 2026-10-31. **Severity:** Major.
- **What:** The delete operation cleared imported records but left pending snapshots. The next import resurrected content the user asked to remove. Pending cleanup must be part of the same serialized operation.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-061 - Saving a version copy recycled the old file before preparing the new one (Blocker)
- **Found in:** review of Step 06b, 2026-10-31. **Severity:** Blocker.
- **What:** A staging or disk-space failure could leave the original path missing. The guide also authorized a path-based recycle that cannot bind approval to an exact object. Existing destinations are now to be refused until the approved Replace contract is implemented; new names use flushed owned staging and publication without replacement.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-062 - Editor restores offered no Undo button (Major)
- **Found in:** review of Step 06b, 2026-10-31. **Severity:** Major.
- **What:** The guide promised Undo in editor history dialogs, but only Explorer restores were added to an undo stack. Editor dialogs must offer Undo using the exact previous snapshot and await the editor reload.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-063 - A growing file could exceed the version preview read limit (Blocker)
- **Found in:** review of Step 06b, 2026-10-31. **Severity:** Blocker.
- **What:** The preview checked stale metadata, then read the entire response into memory. A file growing past the limit could cause a large allocation and freeze. Reads now need a bounded range, stream cap and cancellation.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-064 - Extracted version copies had no space limit and were not counted (Major)
- **Found in:** review of Step 06b, 2026-10-31. **Severity:** Major.
- **What:** Repeatedly opening compressed versions could fill the open-copy folder while Settings reported only compressed blob bytes. The correction adds an explicit open-cache budget, bounded decompression and actual disk-usage reporting.
- **Fixed:** local 06b/06c review, 2026-10-31; full gate passed (349 Rust tests, 462 UI tests). Relevant real-filesystem and interface regressions remain enabled.

### KI-047 - Some libraries the archive crate pulls in were missing from the license notices (Major, fixed in Step 06d)
- **Found in:** the review of Step 06d, 2026-10-30.
- **Fix:** `THIRD_PARTY_LICENSES.md` and `docs/dependency-and-license-table.md` now list them, with the licenses `cargo metadata` reports. All are on the allowed list.

### KI-046 - A settings file with bad values imported as all defaults, with no error (Major, fixed in Step 05d)
- **Found in:** the review of Step 05d, 2026-10-30.
- **Fix:** `parse_import` checks the file itself and refuses it with `settingsFile.invalid`. Loading the app's own settings file at startup still falls back to the defaults, so a damaged file can never stop the app from starting.

### KI-045 - Very large archives could stop with a timeout (Major, fixed in Step 06d)
- **Found in:** the review of Step 06d, 2026-10-30, by reading the code.
- **Fix:** the helper sends a message every 5 s while it is really reading archive data, so a long file is not taken for a hang, and a helper that stops reading is still stopped after 30 s. Extraction also reports progress while a file is written, naming it, so the partial file of a stopped helper is found and removed. Covered by a test of the activity count; not yet tried on a real multi-GB archive.

### KI-044 - Extraction did not report what it skipped (Major, fixed in Step 06d)
- **Found in:** the full gate after joining Steps 06a and 06d, 2026-10-30.
- **What:** Unsafe names, links and protected items were correctly never written, but the final report left them out, so the user was not told.
- **Fix:** the plan's skipped list now starts the report (`crates/archive/src/extract.rs`).

### KI-043 - A search typed while an archive was opening was dropped (Minor, fixed in Step 06d)
- **Found in:** the same gate, 2026-10-30.
- **What:** Text typed in the archive tab's search box before the archive had opened was never searched.
- **Fix:** the search runs again once the archive is open (`ArchiveView.tsx`).

### KI-035 - The toolbar did not fill its row and could hide its buttons (Major, fixed in Step 05d)
- **Found in:** Step 05c screenshots; its worse effect in the Step 05d density screenshots, 2026-10-30.
- **What:** Since Step 05c the command bar was only as wide as its buttons, so the line under it stopped partway. When it measured itself again, as after a density change, it decided there was no room and moved nearly every button into the overflow menu.
- **Fix:** a bar above or below the content now fills the row (`src/styles/layout.css`). Confirmed in the density screenshots.

### KI-036 - A pasted image could be saved under a garbled name (Blocker, fixed in Step 05d)
- **Found in:** the Step 05d full gate, 2026-10-30; the code dates from Step 03b. **Severity:** Blocker (wrong file name, a read past a buffer, and a false success report in a normal flow).
- **What:** ImagePartial::publish gave Windows a file name with no terminating zero. For some path lengths Windows read past the buffer, so the file got extra characters in its name and the conflict check looked at that wrong name. No existing file was overwritten in the failing test, but the image did not reach the name the app reported.
- **Fix:** the buffer now holds the terminating zero. New test `image_output_gets_exactly_the_chosen_name_at_every_path_length`.

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
