# Integration contracts

Contracts are the plug-in points every feature builds on. They were designed in Step 00 (`ARCHITECTURE.md` section 3 has the original sketches). Each row says where the contract lives in the code today, or which step builds it. Extend contracts; never replace them. A feature that needs something no contract offers first extends a contract here, in its own commit (AGENTS.md section 5).

| # | Contract | Lives in (code) | Built in | Notes |
|---|---|---|---|---|
| 1 | Setup window + dependency manifest | `crates/setup`, `crates/setup-core`, `dependencies.json` | 01a | Packs wired in 12a |
| 2 | Design tokens + themes | `themes/*.tokens.json` -> `npm run tokens` -> `src/styles/tokens.css` | 01b | 05d: one file per theme (`light`, `bright`, `paper`, `dark`, `amoled`, `highContrast`), same keys in every file (test), selectors `:root[data-theme=<id>]` and `[data-theme-preview=<id>]`; catalog `src/appearance/themes.ts`; appearance overrides in `src/styles/appearance.css` (`data-scheme`, `data-density`, `data-radius`, `data-motion`). Editor 10a |
| 3 | Settings + i18n | Rust `Settings` in `src-tauri/src/main.rs`, TS `src/services/settings.ts`, `src/i18n/` | 01b | Schema changes: `plan/recipes/add-settings-field.md` |
| 4 | Help system | `help/<lang>/<slug>.md`, `src/services/help.ts`, `src/views/HelpCenter.tsx` | 01b | Every step adds pages |
| 5 | Security base | CSP in `tauri.conf.json`, `src-tauri/isolation/index.html`, `ensure_main`, `validate_absolute_path` | 01b | 06d: first risky-parser helper (`src-tauri/src/helper.rs`: `HelperProcess` in a job object with a memory limit, JSON lines, `drive` with idle and cancel timeouts; `archive_helper.rs` = `--archive-helper`; 06f: `font_helper.rs` = `--font-helper`). Step 07a builds the general helper framework on it |
| 6 | Crash capture + session | `install_panic_hook`, `session.json` (`SessionState`) | 01b | File tabs in the session 04a; recovery UI 09h |
| 7 | Command registry | `src/commands/registry.ts`, `src/commands/explorerCommands.ts` | 02 | `Command<C>` becomes generic over its context in 04b |
| 8 | File-system service | `crates/fs-service` (`list`, `stat_path`, `read_range`, `watch`, `ops`) | 02 | 06e: `owned_io` (`PinnedDirectory`, `OwnedOutput`, `ClosedOutput`, `dispose_orphaned_staging`) is how new content reaches a folder; saves and extraction use it since the KI-068 and KI-079 repairs. 06d: `move_without_replacing` is public. Archive entries use their own `ArchiveItem` type in the archive tab, so `BackingKind::Archive` stays reserved |
| 9 | Menus from commands | `src/commands/menus.ts` (`MenuEntry`, `BarEntry`), `src/components/Menu.tsx` | 03a | Menu editor 10e |
| 10 | Jobs | `file_op_start/poll/cancel` (03b); shared `src-tauri/src/jobs.rs` + `job_poll/job_cancel` + `src/services/jobs.ts` from 06d | 03b | `jobs.rs` has `Jobs`, `JobContext`, `spawn_job`; `jobs.ts` has `runJob`, `newRequestId`; job progress is `OpProgress`. The Explorer's jobs panel takes any job through `trackJob` (`TrackJobOptions`, `JobView.reasonArea`, 06d). Pause/verify/queue 09f |
| 11 | Undo stack | `src/services/undo.ts` (`UndoStack`, `FileAction`), executed by `executeFileAction` in `src/services/fileops.ts` | 03b | New action kinds are added to `FileAction` and `executeFileAction` together (06b: `restoreVersion`) |
| 12 | Drag and drop | Internal: mouse events + `data-drop-folder` (`ExplorerHome.tsx`); from other apps: `onDragDropEvent`; out: `start_external_drag` | 03b | Tabs and content 09c |
| 13 | Handler registry + open pipeline | `src/handlers/` (`types.ts`, `registry.ts`, `openPipeline.ts`, `index.ts`), `src-tauri/src/files.rs` (`file_detect`, `file_grant`, `adpfile` protocol) | 04a | `supportsFind` and the `find` prop 04b; `protectedView` prop and `FileTypeInfo.from_internet` 04c; 06a: `Handler.editable`, `Handler.supportsReplace`, view props `onDirtyChange`, `registerSave` (`SaveHandle` with `save` and `discard`), `onPathChange`, `FindRequest.options` and `.replace` (all optional); 06b: `onOpenFile`; 06d: `onExtractArchive` (optional); 06f: `onOpenAsText` (optional), handlers `table`, `json`, `font`; thumbnails 07a |
| 14 | Default apps | Settings `open.open_with` (extension to `"builtin"` or `"windows"`, schema 5), read by `planOpen(path, registry, openWith)`; page section `src/views/settings/OpeningFilesSettings.tsx` | 04c | Mark of the Web: `src-tauri/src/zone.rs`, `open.protected_view` |
| 15 | Cache store | `crates/cache-store` (SQLite index + blob files, size cap) | 07a | |
| 16 | Ribbon framework | `src/ribbon/` (`types.ts`, `Ribbon.tsx`, `ViewerFrame.tsx`, `shortcuts.ts`, `keyTips.ts`) | 04b | Hidden groups and key tips skipped 04c; docking 05c: `ViewerFrame` places the ribbon with `ToolbarDock`, and `Ribbon` reads `ToolbarLayoutContext` (side, orientation, style) |
| 17 | Layout engine | Settings `layout` section (schema 8) + `src/layout/` (`presets.ts`, `LayoutContext.tsx`, `toolbarLayout.ts`, `ToolbarDock.tsx`, `TabStrip.tsx`, `Flyout.tsx`); toolbar menu commands in `src/commands/layoutCommands.ts` | 05c | The layout is six values plus saved presets; every toolbar is drawn through `ToolbarDock`, every tab through `TabStrip`. Free docking stays in the backlog |
| 18 | View modes + item sources | `src/views/explorer/views/` | 05a, 05b | A view takes `ItemViewProps` and uses `useItemInteractions`; `ItemView.tsx` switches by mode. Column view (05b): `ColumnView`, `ColumnPane`, side-column listings in `useColumnListings` (service `src/services/columnListing.ts`), the trail rule `columnTrailStep` used by `useViewMode`. Timeline etc. 11b |
| 19 | Version store | `crates/version-store`; Rust `before_modify(path, reason)` hook in `src-tauri/src/versions.rs` (`ModifyReason`: `Save`, `SaveAs` in 06a) | hook 06a, store 06b | Every editor saves through it. Text saves go through `text_save.rs` (`fs_service::replace_contents`: owned staging file then `ReplaceFileW`; a failed swap removes the staging file only when the old file is known to be in place). Save as only creates new files (`write_new_file`) until the Replace contract below is met (KI-087). 06b: `before_modify(app, path, reason)` copies the file to `<data>/versions/pending/`; the `VersionWorker` thread stores it (BLAKE3 dedup, zstd) in `crates/version-store` and trims to `settings.versions`; reasons `save`, `saveAs`, `restore` (converter, cleaner and AI add theirs); history UI `src/versions/VersionHistoryDialog.tsx`; undo action `restoreVersion` |
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

## Version-history safety and bounded reads (contract 19, review of 06b)

Store operations use an OS lock, with a borrowed `VersionSession` for a whole
read/snapshot/restore sequence. A live `VersionStore` does not itself retain the
lock: the standalone snapshot API remains usable while a store object exists.
Pending copies become importable only after a complete, flushed copy and its
expected length are published. Pending copies have a separate fixed 1 GiB
budget; exhaustion stops the user write with a snapshot error, never the
skippable oversized-source error. Pending publication has its own OS lock so
small saves do not wait for background compression. Lock order is store then
pending. Version identifiers are never reused after
deletion; restore binds an identifier to its original normalized file path.
Restore preserves its exact bounded undo snapshot even when ordinary version
history is off; an existing file too large to preserve is refused safely.
Delete-all includes pending copies under the same lock.

Extracted open copies have an explicit 1 GiB cache budget and bounded
decompression. `stored_bytes` retains its compressed-blob meaning; the additional
`disk_bytes` operation measures physical store usage for the Settings command.
Editor dialogs add optional `allowUndo` and may await `onRestored`; previews use
a 1 MiB range/stream cap and revoke grants on failure or cancellation.

History listing pages contain at most 2,000 rows. `versions_list` accepts an
optional `before_id` cursor, and `VersionList` adds optional `next_before_id`.
The cursor names the last row on the page; the next page follows the existing
date/id sort order. The window offers a translated Load more button and never
silently presents a truncated page as the entire history.

Saving a version copy to an existing destination remains unavailable under the
approved Replace contract below (`versions.replace_unavailable`). A new copy
is fully staged and flushed before atomic publication without replacement.

## Template creation and diagnostics (contracts 8 and 10, review of 06c)

The original `template_create` remains available. The UI uses the additive
`template_create_start(request_id, request)` command and shared job polling and
cancellation. `TemplateCreateRequest` contains `template_path`, `dest_dir` and
`name` (snake_case). The service keeps its `Promise<string>` result and adds
optional `TemplateCreateOptions` with `signal` and `onProgress`.

The same opened source handle is authorized and copied. The destination and
allowed roots remain pinned; temporary files are exclusively created, flushed,
published without replacement and cleaned up through their owned handles. Copy
work reports bytes and checks cancellation between 1 MiB chunks and before
publication. Numbered destination names start at one and have a bounded search.

`TemplateList` adds optional/defaulted `user_error` and `user_skipped` diagnostics.
The picker reports errors and incomplete listings, follows keyboard focus,
awaits successful file creation and folder persistence, and cancels on unmount.

## Rules for every contract

1. A feature registers itself (a handler in `src/handlers/index.ts`, a command in its commands factory, a converter in the converter registry). It does not edit the code of other features.
2. Data that crosses from Rust to TypeScript keeps snake_case field names on both sides.
3. A contract's types live in one file (listed above). Copying a type into another file is not allowed; import it.
4. Changing an existing field's meaning is not allowed. Add a new optional field instead.


## Clipboard image parser isolation (contract 5, Step 03b)

Paste as file runs Windows clipboard image decoding and encoding in a separate
`Adperastra.exe --clipboard-image-helper` process. The helper starts before the
normal app initialization, receives only the explicitly validated output format
(`png` or `jpg`), and opens the clipboard itself; it receives no destination
path or file handle. Clipboard formats, dimensions, decoded pixels, and encoded
output remain bounded, including the existing 32,768-pixel axis, 64-million-pixel,
512 MiB encoded input, and 321 MiB encoded output limits. Image bytes never
travel through the UI or JSON.

The parent drains the helper's bounded binary output concurrently with its
execution, requires a complete framed response and a successful process exit,
and enforces a 15-second wall-clock timeout. On timeout, abnormal exit, malformed
or truncated output, or output over the cap, it terminates and reaps the helper
and reports a translated failure. The parent alone owns the destination's
exclusive staging handle, copies at most the bounded output into it, flushes it,
and publishes by handle without replacing an existing item. Failure removes only
the staging file identified by that handle. A process/job limit and cleanup must
not be described as a filesystem or network sandbox unless those restrictions
are actually enforced.

Tests use synthetic images and controlled helper responses, never the owner's
clipboard. They cover PNG and JPEG, malformed and oversized inputs and outputs,
short or malformed frames, timeout, crash, process cleanup, and a destination
appearing during encoding. An error or timeout must not leave a published file
or remove another item. The helper-process transport is a narrow early use of
contract 5; Step 06d may generalize it without changing these guarantees.

## File-operation safety (contract 10, Step 03b)

`FileOpRequest.allow_system` defaults to `false`. A job checks fresh metadata before making any change, including system items nested inside moved/deleted folders and existing Replace targets. If confirmation is needed, the job returns `ops.system_confirmation_required` with no changes; the UI shows a translated warning with Cancel focused and can retry that same operation once with `allow_system: true` after Continue. Ordinary jobs never show this warning. Cancellation during the check returns a cancelled report without changing files. The check reads metadata only, reports progress through the existing job transport, and never reads file contents.

Drive/share roots and the actual Windows/Program Files folders are always refused; confirmation cannot override this. Destructive operations do not follow directory links or junctions: a top-level item containing one is skipped with `link_not_supported`, leaving its source untouched. Copy keeps its existing source loop guard; Replace target checks also refuse directory reparse points. Metadata failures are skipped and reported. Undo/Redo transfer jobs check their existing source and destination paths under the same rules; missing counterpart paths are expected and are left for the operation engine to validate.

## Step 03b: exact transfer effects for Undo (contracts 10 and 11)

A move report retains an exact transfer plan even when cancelled or only partly successful. Each TransferEffect records from, to, kind (file, directory scaffold, or atomic tree rename), source_removed, and destination_created. Directory scaffolds are never mistaken for an atomic renamed tree. File targets are the actual names written, including Keep both names. Effects are recorded as disk changes succeed; completed remains a user-facing top-level summary, never the source of truth for Undo.

Undo first recreates source directory scaffolds that the operation removed, moves back only items whose sources were actually removed, recycles copies whose sources remain, and removes only empty directory scaffolds it created. Pre-existing merged destination contents are untouched. The exact replaced Recycle Bin entries are restored afterward. Redo repeats only recorded effects, including retained copies, and removes only empty source scaffolds that were originally removed; it never retries skipped source files.

Undo and redo never overwrite a new item at an expected target, and nonempty scaffolds changed by another program are preserved. A skipped, failed, or cancelled history operation raises its translated error and leaves the history cursor unchanged. The existing file_op_start transport executes transfer history as a job with cancel/progress and the same absolute-path, root, reparse-point and system-item checks as other operations. Transfer plans stay in Rust behind opaque identifiers so a large folder does not turn into a large UI response; identifiers are local, bounded with the 100-entry undo history, and never commands or paths supplied without validation.

Transfer history reserves at most 32 MiB per forward operation before any mutation and keeps at most 100 referenced plans within 128 MiB total. Capacity exhaustion returns FsError::UndoLimit / ops.undo_limit, not a filename error; no effects are clipped or silently evicted. The user can select fewer items or restart to begin a fresh local history. Plans already referenced by Undo/Redo, including pending groups and in-flight jobs, remain retained.

## Step 03b: approved Replace targets and recovery (contracts 10 and 11)

**Required behavior.** Replace is permission to replace the specific items
shown to the user, not blanket permission to recycle whatever later occupies
the same paths. Conflict discovery produces a bounded, Rust-owned snapshot of
the existing conflicting targets, including nested file conflicts in merged
folders, and returns an opaque token plus the information needed to display
the choices. It uses metadata only and obeys cancellation, link, system-item,
and online-only rules. The UI associates each Replace choice (including
"Do this for all") with the displayed snapshot. An optional token on the
existing request carries that approval; a missing, expired, invalid, changed,
or incomplete approval never authorizes a replacement. No path, identity, or
token supplied by the UI bypasses Rust validation. New conflicts or changed
targets are skipped and reported or require a fresh confirmation; they are
never silently recycled. Conflict snapshots have explicit memory and item
limits, fail without mutation when capacity is exceeded, and have a bounded
lifetime. Existing non-Replace requests need no token.

Before any target changes, the job revalidates the approved identity (on
Windows, a stable volume and file identity obtained from the opened object),
its type and applicable safety checks. Publishing the completed, flushed
temporary copy uses an atomic no-replace operation. If another item appears at
the destination at any point, that item remains untouched. The original
approved item is recoverable, with its exact Recycle Bin identity and original
path recorded for Undo; a failed or cancelled operation reports every effect
that occurred. Undo and Redo obey the same identity, no-overwrite and safety
rules and do not advance the history cursor on incomplete work.

If a replacement needs intermediate staging, persist a bounded recovery
journal under the app data folder before the first mutation, with durable state
and enough identity and path information to recover safely after a crash at
any transition. Recovery never overwrites a new destination or deletes an
unverified item; when automatic restoration is unsafe, retain the recoverable
item and clearly report the pending recovery. Journal and staging cleanup must
not remove unrelated files. Normal operation and recovery must remain offline.

**Step 03b status (owner decision 2026-10-30).** Replace is unavailable in
Step 03b. The UI offers Merge for two folders with the same name, Skip, and
Keep both; the command boundary returns `ops.replace_unavailable` for
`replace`. Merge never replaces a file. Replace is enabled only when the
full conflict window implements the approval and recovery rules above.
This is the fail-safe branch of this contract, not a relaxation of it.

**Implementation research still required.** The existing path-based
`trash::delete` call does not establish that the item recycled is the one
whose identity was approved. A handle-based rename to staging is a candidate,
but by itself does not prove that a later path-based recycle cannot race with
replacement of the staged path. Before enabling Replace, prove and test an
end-to-end Windows mechanism that binds recycling to the approved object,
including protection of any staging path, failure handling, and crash
recovery. If that guarantee cannot be established, fail safely and leave
Replace unavailable for the affected case; do not weaken this contract or
claim that identity revalidation alone closes the race. Tests must exercise
new, changed, and swapped targets, nested conflicts, cancellation and failures,
and crash recovery at each durable transition using disposable folders.


## Future shared contracts: reviewed parallel guide packet (2026-11-02)

This additive register binds future steps07a–22b without claiming their code exists. The full canonical definitions, exact parameters/types/errors/limits/ownership are in their producing guides, indexed verbatim in [parallel/CONTRACT-INDEX.md](parallel/CONTRACT-INDEX.md) and hashed in [parallel/GUIDE-MANIFEST.json](parallel/GUIDE-MANIFEST.json). Consumers import those definitions, never copy a type or depend on a producer's private variables. Later amendments in the whole producer guide are part of its contract.

07a owns shared source identity/cache/scheduler;07d owns file-memory backing/PDF source union/private persistent framed helper.08a owns immutable snapshot authority, authorized encoder MIME sets and multi-output conversion;08c owns privacy closure acceptance.09a owns document controllers/revision+content identity, native drafts, Save as new and close/recovery integration.09e/09f extend reviewed file actions with explicit_names/expected_sources and exact receipts while retaining object-bound replacement gates.12a/12b own verified packs and engine sessions;13/14a/b/15 own read/edit models and microsecond time.14c owns local AI inputs/tasks.17a owns optional Local/API assistant inference and consent;17b–d own actions/speech/semantic/extraction consumers.19b adds the native-only timeline graph dispatch.20a E20–E25 owns Office proposals, clone evaluation, human confirmation, transactional application, lease resolution and blank/deck draft factories; consumers20b–22b use it.

The assistant is Local by default, with API key as an explicit alternative and Meta first among API providers. Credential status never reveals a key. File-derived outbound requests require one-use approval bound to actual payload/provider/model/source revisions; no automatic cloud fallback, history resend or paid retry. Local speech/image/embeddings remain local. Provider protocol/source evidence is in [parallel/AI-API-EVIDENCE.md](parallel/AI-API-EVIDENCE.md).

All future encoded captures retain native sensitivity and the captured revision/content tuple. Source MIME is descriptive; a trusted native encoder registers its output MIME before capture. Save copy does not clean/rebind; Save as new follows09a's atomic all-view registry contract. Virtual/sensitive content cannot acquire a fabricated disk path. No model/tool output directly mutates files or approves its own confirmation.

The coordinator integrates shared declarations/registries and later enum extensions. Existing baseline files and shared roots are coordinator-owned during simultaneous coding. Workers write code/tests and return exact shared proposals; they execute no build/tests/install/generator/app/API call. Implementation acceptance, real artifact hashes, performance/screenshots and checkpoints are separate future evidence.

### Step 07a integration additions (2026-11-02)

The producing guide records additive same-handle `CacheStore::open_blob`, `PinnedSource::open_background`, optional thumbnail `sourceRevision`, and shared `subscribeBackgroundEligible` contracts. Existing foreground source opens and wire request shapes retain their behavior. Cache cleanup requires indexed native ownership receipts; helper staging uses kernel delete-on-close lifetime guards.

Cache-store also exposes `with_staging_budget<T>(&self,bytes:u64,create:impl FnOnce()->Result<T,CacheError>)->Result<T,CacheError>`, with callback/physical preallocation rules defined by07a. Thumbnail helpers reserve their full output length under the shared OS cache lock before starting.
### Addendum to office-edit-1: slide text targets

A rendered textbox node may include an optional `deck_text` object with
`span: TextSpan` and `text: string`. The node ID remains the shape ID.
The span identifies one editable block at the render result's model revision.
Both endpoints must use the same block ID, and the span length in UTF-16
units must equal the text length, capped at 4,096 units. The native engine
must validate the block-to-shape relationship again on mutation. When this
field is absent, the node's accessibility name is only a label and is not
an editable text value.

A Writer paragraph or heading may supply `document_text` with the same
bounded `span` and `text` shape. The span block ID must equal the node ID.
The UI uses `replace_match` with the original text as its expected value.
Only a node marked editable at the render result's revision can supply it.

The local paper editor may open an immutable Office snapshot through the
existing read-only Office viewer. Snapshot MIME, revision and sensitivity
are resolved by ExportSnapshots. The job command `office_view_text_start`
returns bounded PDF text runs and a `complete` flag for one authorized
snapshot page. Coordinates
use unrotated page points and a top-left origin. The UI may associate a run
with an existing OOXML edit target only when the rendered text match is
unique and complete. Mutations still use the shared OfficeController and
the original target text at its expected revision. Each successful change
renders a fresh immutable snapshot before exposing further edit targets.
## Independent Home locations (session-3, Office preview)

A folder tab may store the exact reserved UI location `home` instead of an
absolute filesystem path. All other non-absolute paths remain invalid.
`home` opens ExplorerHome without an initial filesystem location and never
creates a filesystem watcher or grant. Navigation to a real folder stores
its absolute path; navigating back to Home stores `home` again. Each tab
keeps its independent identity, history and selection.

Session schema 3 writes this additional location. Schema 1/2 inputs remain
readable; older applications refuse the newer session rather than silently
rewriting its Home tabs. Filesystem commands still require absolute paths;
the reserved UI location is never accepted as a filesystem path.

The tab-bar plus action opens and activates a new Home folder tab. Its
adjacent arrow retains the extra tab menu. The permanent Explorer tab stays
unique and non-closeable.
