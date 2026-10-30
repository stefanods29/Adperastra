# Integration contracts

Contracts are the plug-in points every feature builds on. They were designed in Step 00 (`ARCHITECTURE.md` section 3 has the original sketches). Each row says where the contract lives in the code today, or which step builds it. Extend contracts; never replace them. A feature that needs something no contract offers first extends a contract here, in its own commit (AGENTS.md section 5).

| # | Contract | Lives in (code) | Built in | Notes |
|---|---|---|---|---|
| 1 | Setup window + dependency manifest | `crates/setup`, `crates/setup-core`, `dependencies.json` | 01a | Packs wired in 12a |
| 2 | Design tokens + themes | `themes/*.tokens.json` -> `npm run tokens` -> `src/styles/tokens.css` | 01b | 05d: one file per theme (`light`, `bright`, `paper`, `dark`, `amoled`, `highContrast`), same keys in every file (test), selectors `:root[data-theme=<id>]` and `[data-theme-preview=<id>]`; catalog `src/appearance/themes.ts`; appearance overrides in `src/styles/appearance.css` (`data-scheme`, `data-density`, `data-radius`, `data-motion`). Editor 10a |
| 3 | Settings + i18n | Rust `Settings` in `src-tauri/src/main.rs`, TS `src/services/settings.ts`, `src/i18n/` | 01b | Schema changes: `plan/recipes/add-settings-field.md` |
| 4 | Help system | `help/<lang>/<slug>.md`, `src/services/help.ts`, `src/views/HelpCenter.tsx` | 01b | Every step adds pages |
| 5 | Security base | CSP in `tauri.conf.json`, `src-tauri/isolation/index.html`, `ensure_main`, `validate_absolute_path` | 01b | 06d: first risky-parser helper (`src-tauri/src/helper.rs`: `HelperProcess` in a job object with a memory limit, JSON lines, `drive` with idle and cancel timeouts; `archive_helper.rs` = `--archive-helper`). Step 07a builds the general helper framework on it |
| 6 | Crash capture + session | `install_panic_hook`, `session.json` (`SessionState`) | 01b | File tabs in the session 04a; recovery UI 09h |
| 7 | Command registry | `src/commands/registry.ts`, `src/commands/explorerCommands.ts` | 02 | `Command<C>` becomes generic over its context in 04b |
| 8 | File-system service | `crates/fs-service` (`list`, `stat_path`, `read_range`, `watch`, `ops`) | 02 | 06d: `move_without_replacing` is public (every "put a new file in place" uses it). Archive entries use their own `ArchiveItem` type in the archive tab, so `BackingKind::Archive` stays reserved |
| 9 | Menus from commands | `src/commands/menus.ts` (`MenuEntry`, `BarEntry`), `src/components/Menu.tsx` | 03a | Menu editor 10e |
| 10 | Jobs | `file_op_start/poll/cancel` (03b); shared `src-tauri/src/jobs.rs` + `job_poll/job_cancel` + `src/services/jobs.ts` from 06d | 03b | `jobs.rs` has `Jobs`, `JobContext`, `spawn_job`; `jobs.ts` has `runJob`, `newRequestId`; job progress is `OpProgress`. The Explorer's jobs panel takes any job through `trackJob` (`TrackJobOptions`, `JobView.reasonArea`, 06d). Pause/verify/queue 09f |
| 11 | Undo stack | `src/services/undo.ts` (`UndoStack`, `FileAction`), executed by `executeFileAction` in `src/services/fileops.ts` | 03b | New action kinds are added to `FileAction` and `executeFileAction` together (06b: `restoreVersion`) |
| 12 | Drag and drop | Internal: mouse events + `data-drop-folder` (`ExplorerHome.tsx`); from other apps: `onDragDropEvent`; out: `start_external_drag` | 03b | Tabs and content 09c |
| 13 | Handler registry + open pipeline | `src/handlers/` (`types.ts`, `registry.ts`, `openPipeline.ts`, `index.ts`), `src-tauri/src/files.rs` (`file_detect`, `file_grant`, `adpfile` protocol) | 04a | `supportsFind` and the `find` prop 04b; `protectedView` prop and `FileTypeInfo.from_internet` 04c; 06a: `Handler.editable`, `Handler.supportsReplace`, view props `onDirtyChange`, `registerSave` (`SaveHandle` with `save` and `discard`), `onPathChange`, `FindRequest.options` and `.replace` (all optional); 06b: `onOpenFile`; 06d: `onExtractArchive` (optional); thumbnails 07a |
| 14 | Default apps | Settings `open.open_with` (extension to `"builtin"` or `"windows"`, schema 5), read by `planOpen(path, registry, openWith)`; page section `src/views/settings/OpeningFilesSettings.tsx` | 04c | Mark of the Web: `src-tauri/src/zone.rs`, `open.protected_view` |
| 15 | Cache store | `crates/cache-store` (SQLite index + blob files, size cap) | 07a | |
| 16 | Ribbon framework | `src/ribbon/` (`types.ts`, `Ribbon.tsx`, `ViewerFrame.tsx`, `shortcuts.ts`, `keyTips.ts`) | 04b | Hidden groups and key tips skipped 04c; docking 05c: `ViewerFrame` places the ribbon with `ToolbarDock`, and `Ribbon` reads `ToolbarLayoutContext` (side, orientation, style) |
| 17 | Layout engine | Settings `layout` section (schema 8) + `src/layout/` (`presets.ts`, `LayoutContext.tsx`, `toolbarLayout.ts`, `ToolbarDock.tsx`, `TabStrip.tsx`, `Flyout.tsx`); toolbar menu commands in `src/commands/layoutCommands.ts` | 05c | The layout is six values plus saved presets; every toolbar is drawn through `ToolbarDock`, every tab through `TabStrip`. Free docking stays in the backlog |
| 18 | View modes + item sources | `src/views/explorer/views/` | 05a, 05b | A view takes `ItemViewProps` and uses `useItemInteractions`; `ItemView.tsx` switches by mode. Column view (05b): `ColumnView`, `ColumnPane`, side-column listings in `useColumnListings` (service `src/services/columnListing.ts`), the trail rule `columnTrailStep` used by `useViewMode`. Timeline etc. 11b |
| 19 | Version store | `crates/version-store`; Rust `before_modify(path, reason)` hook in `src-tauri/src/versions.rs` (`ModifyReason`: `Save`, `SaveAs` in 06a) | hook 06a, store 06b | Every editor saves through it. Text saves go through `text_save.rs` (`fs_service::replace_contents`: partial file then `ReplaceFileW`). 06b: `before_modify(app, path, reason)` copies the file to `<data>/versions/pending/`; the `VersionWorker` thread stores it (BLAKE3 dedup, zstd) in `crates/version-store` and trims to `settings.versions`; reasons `save`, `saveAs`, `restore` (converter, cleaner and AI add theirs); history UI `src/versions/VersionHistoryDialog.tsx`; undo action `restoreVersion` |
| 20 | Archive service | `crates/archive` (detect, list, `ArchiveTree`, `plan_extract`, `extract`, `write_entry`), `src-tauri/src/archive.rs` (sessions, `archive_*` commands), `src/services/archive.ts`, handler `src/handlers/archive/` | 06d, 06e | Archives open in a file tab; every byte is parsed in the archive helper. Extraction runs in the Explorer's jobs panel (`useArchiveExtract`; archive tabs hand requests over through `HandlerViewProps.onExtractArchive` and App's `extractRequest`). 06e adds creating, passwords and RAR |
| 21 | Metadata service | `src-tauri/src/metadata.rs` (Windows property system, in the helper process) | 07b | |
| 22 | OCR service | `src-tauri/src/ocr.rs` (Windows.Media.Ocr) | 07e | |
| 23 | Converter registry | `src/convert/` (TS registry, options schema) + `crates/convert` | 08a | |
| 24 | Privacy cleaner | `crates/privacy` | 08c | |
| 25 | Release pipeline | `.github/workflows/release.yml` | 08d | |
| 26 | Tab sessions | `src/services/tabs.ts` (`TabsState`, `tabsFromSession`, `sessionFromTabs`) | 04a (file tabs), 09a (groups, view state) | |
| 27 | Encrypted containers | (outline) | 09k | |
| 28 | Setup files | (outline) | 10e | |
| 29-36 | Index, search modes, tags, packs, engine adapters, AI runtime, AI evaluation, assistant tools | (outline) | 11a-17a | See `ARCHITECTURE.md` section 3 for the original sketches |
| 37 | Home and navigation-pane sections | (outline) | 09b, 10e, 11b | |

## Rules for every contract

1. A feature registers itself (a handler in `src/handlers/index.ts`, a command in its commands factory, a converter in the converter registry). It does not edit the code of other features.
2. Data that crosses from Rust to TypeScript keeps snake_case field names on both sides.
3. A contract's types live in one file (listed above). Copying a type into another file is not allowed; import it.
4. Changing an existing field's meaning is not allowed. Add a new optional field instead.


## File-operation safety (contract 10, Step 03b)

`FileOpRequest.allow_system` defaults to `false`. A job checks fresh metadata before making any change, including system items nested inside moved/deleted folders and existing Replace targets. If confirmation is needed, the job returns `ops.system_confirmation_required` with no changes; the UI shows a translated warning with Cancel focused and can retry that same operation once with `allow_system: true` after Continue. Ordinary jobs never show this warning. Cancellation during the check returns a cancelled report without changing files. The check reads metadata only, reports progress through the existing job transport, and never reads file contents.

Drive/share roots and the actual Windows/Program Files folders are always refused; confirmation cannot override this. Destructive operations do not follow directory links or junctions: a top-level item containing one is skipped with `link_not_supported`, leaving its source untouched. Copy keeps its existing source loop guard; Replace target checks also refuse directory reparse points. Metadata failures are skipped and reported. Undo/Redo transfer jobs check their existing source and destination paths under the same rules; missing counterpart paths are expected and are left for the operation engine to validate.

## Step 03b: exact transfer effects for Undo (contracts 10 and 11)

A move report retains an exact transfer plan even when cancelled or only partly successful. Each TransferEffect records from, to, kind (file, directory scaffold, or atomic tree rename), source_removed, and destination_created. Directory scaffolds are never mistaken for an atomic renamed tree. File targets are the actual names written, including Keep both names. Effects are recorded as disk changes succeed; completed remains a user-facing top-level summary, never the source of truth for Undo.

Undo first recreates source directory scaffolds that the operation removed, moves back only items whose sources were actually removed, recycles copies whose sources remain, and removes only empty directory scaffolds it created. Pre-existing merged destination contents are untouched. The exact replaced Recycle Bin entries are restored afterward. Redo repeats only recorded effects, including retained copies, and removes only empty source scaffolds that were originally removed; it never retries skipped source files.

Undo and redo never overwrite a new item at an expected target, and nonempty scaffolds changed by another program are preserved. A skipped, failed, or cancelled history operation raises its translated error and leaves the history cursor unchanged. The existing file_op_start transport executes transfer history as a job with cancel/progress and the same absolute-path, root, reparse-point and system-item checks as other operations. Transfer plans stay in Rust behind opaque identifiers so a large folder does not turn into a large UI response; identifiers are local, bounded with the 100-entry undo history, and never commands or paths supplied without validation.

Transfer history reserves at most 32 MiB per forward operation before any mutation and keeps at most 100 referenced plans within 128 MiB total. Capacity exhaustion returns FsError::UndoLimit / ops.undo_limit, not a filename error; no effects are clipped or silently evicted. The user can select fewer items or restart to begin a fresh local history. Plans already referenced by Undo/Redo, including pending groups and in-flight jobs, remain retained.
