# Step 06d: Archives: open, browse, extract

| | |
|---|---|
| State | guide |
| Difficulty | ★★★ |
| Branch | `step-06d-archives` |
| Tag | `v0.0.17-step06d` |
| Depends on | 06c |
| Written before | P2 was built (written from the 04a to 04c recipes and the 05a to 06c guides; names from earlier guides are in `plan/guide-ledger.md`) |

This is a **guide** step (AGENTS.md "Steps come in two kinds"): every decision is below, but no code. Write the code exactly as described: the names, files, types, numbers and texts given here, and nothing else. If something you must write is not decided here, stop with `BLOCKED.md` (AGENTS.md section 5).

## Goal

Double-clicking a `.zip`, `.7z`, `.tar`, `.tar.gz` (`.tgz`), `.tar.xz` (`.txz`), `.gz` or `.xz` file opens it in a file tab that looks like a folder: the owner moves through its folders, searches the whole archive, and opens any file inside in its own tab (the app copies it out by itself). **Extract all** (into a new folder named after the archive), **Extract here**, **Extract to…** and **Extract selected…** run as background jobs with progress and Cancel in the Explorer's jobs panel, never overwrite anything, and can be undone. Archives that try to write outside the folder, or that would fill the disk ("zip bombs"), are refused safely. All reading of archive files happens in a separate helper process with a memory limit, so a damaged or hostile archive can never crash or freeze the app.

## Do not do in this step

- No creating archives ("Compress to…") and no password-protected archives (Step 06e). Protected items are listed and explained, never opened.
- No RAR (Step 06e, through a 7-Zip the owner installed). `.rar` files keep opening in their Windows app.
- No bzip2 (`.bz2`, `.tbz`, `.tar.bz2`, and bzip2-compressed entries inside zip and 7z files): Step 06e adds it (the owner allowed its "bzip2-1.0.6" license). Until then such entries are skipped with "compressed in a way the app can't read", and `.bz2` files open in their Windows app.
- No dragging files out of an archive, no copy and paste from an archive (Step 09c). No editing inside an archive (backlog).
- Only the Details layout inside an archive tab; other view modes in archives are in the backlog.
- No Replace or Merge choices when extracting (Step 09f's conflict window may add them). Extraction always keeps both: a new name with a number.
- No thumbnails or previews of files inside archives (Step 07a/07b may add them).
- The general helper-process framework and the Background work settings are Step 07a. This step adds only the archive helper and the small runner it needs (`src-tauri/src/helper.rs`), which 07a reuses.
- The file operations of Step 03b keep their own `file_op_start/poll/cancel` commands; only new jobs use the shared job table (Step 09f may move them).

## Read first

- `plan/conventions.md` (3.2 start/poll/cancel and the shared job table, 4.1 services), `plan/pitfalls.md` (P-01, P-02, P-03, P-07, P-08, P-10, P-11, P-12, P-19, P-20, P-21, P-25, P-26, P-28), `plan/rules.md` R-SAFE-2, R-SAFE-3, R-SAFE-6, R-SEC-1, R-SEC-7, R-SEC-8, R-SEC-9, R-FS-1, R-FS-2, R-FS-3, R-FS-4, R-UI-2, R-LIC, `plan/recipes/add-dependency.md`, `plan/recipes/add-tauri-command.md`, `plan/recipes/add-help-page.md`, `plan/recipes/add-translation-keys.md`.
- Code: `src-tauri/src/classic_menu.rs` (the helper-process pattern: `HELPER_FLAG`, `wait_until_ready`, the tests that start `powershell.exe`), `src-tauri/src/main.rs` (`main()`'s helper check, `valid_request_id`, `parse_sort`, `FileJob`, `file_op_start/poll/cancel`, `ThreadPriorityGuard`, `generate_handler!`), `src-tauri/src/zone.rs`, `src-tauri/src/files.rs`, `src-tauri/src/file_dialogs.rs`, `src-tauri/src/templates.rs` (`templates_pick_folder`), `crates/fs-service/src/ops.rs` (`OpProgress`, `unique_destination`), `crates/fs-service/src/rename.rs` (`move_without_replacing`), `crates/fs-service/src/save.rs` (`partial_path`), `crates/fs-service/src/list.rs` (`validate_new_name`, `CancellationToken`), `crates/fs-service/src/sort.rs` (`sort_items`, `natural_cmp`), `src/handlers/types.ts`, `src/handlers/index.ts`, `src/handlers/hex/HexView.tsx` (a viewer with a ribbon), `src/views/FileTabView.tsx`, `src/App.tsx` (`openFile`, `showInExplorer`, the `navigateRequest` pattern), `src/views/ExplorerHome.tsx` (`runTracked`, `recordJob`, `toastReport`, `notifyAction`, `pendingSelectRef`, the actions object, the `navigateRequest` effect), `src/views/explorer/JobsPanel.tsx`, `src/views/explorer/FileList.tsx` (its props), `src/commands/explorerCommands.ts`, `src/commands/menus.ts` (`ITEM_MENU`, `commandBarFor`, `resolveMenu`), `src/components/Menu.tsx`, `src/components/Breadcrumb.tsx`, `src/services/fileops.ts` (`startFileJob`, `OpProgress`, `SkippedItem`), `src/services/errors.ts`, `src/services/shortcuts.ts`, `src/__tests__/defaultApps.test.tsx`, `src/__tests__/commands.test.ts`, `scripts/measure-ui.ps1`, `scripts/measure-ui.mjs`.

## Decisions (already made)

- D1. **Formats.** Read by content, not by name: zip (stored, Deflate, Deflate64, PPMd, Zstandard entries), 7z (LZMA, LZMA2, PPMd and the usual filters), tar, tar inside gzip, tar inside xz, and a single gzip or xz file (shown as an archive with one file). The handler claims the extensions `zip`, `7z`, `tar`, `gz`, `tgz`, `xz`, `txz`. Libraries (all checked at these versions, licenses allowed): `zip` 9.1 (MIT), `sevenz-rust2` 0.24 (Apache-2.0), `tar` 0.4 (MIT OR Apache-2.0), `flate2` 1.1 (MIT OR Apache-2.0), `lzma-rust2` 0.22 (Apache-2.0, pure Rust; it replaces the planned `liblzma`, which needs a C build and libclang). Entries that use other methods (bzip2, LZMA-in-zip, XZ-in-zip) are skipped with `unsupported_method`.
- D2. **Isolation (R-SEC-9).** Every byte of an archive is parsed in a helper process: `Adperastra.exe --archive-helper`, the classic-menu pattern. The helper runs inside a Windows job object with a 1 GiB per-process memory limit, "kill on job close" and "die on unhandled exception". It gets one request as a JSON line on stdin and answers with JSON lines on stdout; a later stdin line `cancel` asks it to stop. The app kills it when it is silent for 30 s, when it does not stop within 5 s of a cancel, or when a line is longer than 8 MiB. A crash, a memory failure or a kill becomes a translated error, never a crash of the app.
- D3. **Browsing.** An archive opens in a file tab (contract 20). The listing is read once (a job with progress after 1 s and Cancel), kept in the app's Rust side as a *session*, and the tab asks for one folder at a time (at most 5,000 items per answer, P-10) or for search results (at most 1,000). The tab shows the Explorer's own Details list (`FileList`), a path bar (`Breadcrumb`), the file tab's search box (searches names in the whole archive), and a ribbon. Folders without their own entry in the archive appear anyway (made from the paths).
- D4. **Opening a file inside.** Double-click or Enter copies the one file to `<data>/archive-open/<request id>/<name>` (with a progress strip after 0.15 s and Cancel), marks the copy Read-only, and opens it in a new tab through the open pipeline. Editors therefore open it read-only; "Save as" keeps changes elsewhere. Folders older than 24 hours in `archive-open` are removed at the next start (this is the app's own temporary folder, not user data).
- D5. **Extraction runs in the Explorer.** Every extraction is a job in the Explorer's jobs panel with progress and Cancel, an undo entry (Recycle Bin, Redo restores) and a toast. From an archive tab, the tab hands the request to the App, which switches to the Explorer showing the destination folder; when the job ends the new items are selected. Modes: **Extract all** = a new folder named after the archive, next to it (numbered if the name is taken); **Extract here** = the archive's folder; **Extract to…** = a chosen folder, with a new folder named after the archive inside it; **Extract selected…** (archive tab) = the selected items straight into a chosen folder, keeping their folders below the current one. Several archives selected in the Explorer: one job each, one grouped undo entry, at most 20 at once.
- D6. **Never overwrite (R-SAFE-2/3).** If a top-level item that extraction would create already exists, the new one gets a Windows-style number ("docs (2)", "readme (2).txt"). Every file is written to `~<name>.partial` next to its target, counted, then moved into place with a rename that refuses to replace. A cancelled or failed file leaves no partial file. Inside a new top-level folder nothing can clash; a duplicate name inside the archive is skipped (`name_taken`).
- D7. **Unsafe names (R-FS-3, R-SEC-8).** An entry path that is absolute, has a drive letter, contains `..`, or has a component Windows refuses (`fs_service::validate_new_name`: reserved names, `< > : " | ? *`, control characters, trailing dot or space), or is longer than 1,024 characters or deeper than 64 folders, is hidden from the listing (counted, with a note) and never extracted. Links (symbolic and hard) are listed with the type "Link" and never extracted.
- D8. **Bomb and space limits.** Refused before anything is written: more than 200,000 entries (`too_many_entries`); a planned total over 1 TiB, or over 1 GiB and more than 500 times the archive file's size (`bomb`); a total that does not fit the destination drive's free space with a 64 MiB margin (`no_space`). While writing, an entry that produces more or fewer bytes than its declared size is stopped and skipped (`size_mismatch`). xz streams decode with a 512 MiB memory limit.
- D9. **Mark of the Web.** When the archive carries the internet mark (Step 04c, zone 3 or higher), every extracted file and every opened copy gets the same `Zone.Identifier` text, so the protected view (and Windows SmartScreen) still apply.
- D10. **Dates.** Extracted files keep the entry's modified time. Zip stores local time without a time zone: it is converted with Windows' time-zone rules (`TzSpecificLocalTimeToSystemTime`). 7z and tar store UTC.
- D11. **Shared job table (contract 10).** A new `src-tauri/src/jobs.rs` holds every new job (archives now; conversions and later features reuse it), with the commands `job_poll` and `job_cancel`, and `src/services/jobs.ts` (`runJob`, polling every 100 ms, `newRequestId`). Job progress uses the existing `OpProgress` shape, so the jobs panel shows it unchanged.

## Data shapes

### Crate `crates/archive` (pure Rust, depends on `fs-service`)

| Item | Kind | Fields / signature | Notes |
|---|---|---|---|
| `ArchiveFormat` | enum (serde snake_case) | `Zip`, `SevenZ`, `Tar`, `TarGz`, `TarXz`, `Gz`, `Xz` | serialized `zip`, `seven_z`, `tar`, `tar_gz`, `tar_xz`, `gz`, `xz` |
| `EntryKind` | enum (serde snake_case) | `File`, `Folder`, `Link` | |
| `ArchiveEntry` | struct (serde) | `index: u32`, `path: String`, `name: String`, `kind: EntryKind`, `size: u64`, `packed_size: u64`, `modified_unix: u64`, `encrypted: bool`, `problem: Option<String>` | `index`: position among all entries the format's reader yields (zip index, 7z file index, tar sequence number, 0 for gz/xz), counting entries left out of the listing. `path`: the normalized inner path (`/` separators, no trailing `/`), or, when `problem` is set, the raw name with `\` turned into `/`. `name`: the last component. `packed_size` 0 = unknown. `modified_unix` 0 = unknown. `problem`: `"unsafe_path"` or `"invalid_name"` |
| `IMPLICIT_INDEX` | const `u32` | `u32::MAX` | index of folders made from paths |
| `Listing` | struct (serde) | `format: ArchiveFormat`, `entries: Vec<ArchiveEntry>`, `partial: bool` | `partial`: the archive is damaged after the entries read |
| `ArchiveError` | enum (thiserror) | `NotFound`, `Unsupported`, `Corrupt`, `PasswordRequired`, `TooManyEntries`, `Bomb`, `NoSpace`, `Changed`, `Cancelled`, `BadRequest`, `NotAFile`, `DestMissing`, `AccessDenied`, `Io(std::io::Error)` | method `code(&self) -> &'static str` gives `archive.not_found`, `archive.unsupported`, `archive.corrupt`, `archive.password_required`, `archive.too_many_entries`, `archive.bomb`, `archive.no_space`, `archive.changed`, `archive.cancelled`, `archive.bad_request`, `archive.not_a_file`, `archive.dest_missing`, `archive.access_denied`, `archive.other` |
| `Limits` | struct, `Default` | `max_entries: usize` (200,000), `max_total_bytes: u64` (1 TiB = 1,099,511,627,776), `max_ratio: u64` (500), `ratio_floor_bytes: u64` (1 GiB = 1,073,741,824), `space_margin_bytes: u64` (64 MiB = 67,108,864), `max_inner_path_chars: usize` (1,024), `max_depth: usize` (64), `xz_memory_kb: u32` (524,288) | tests build smaller limits |
| `CHUNK_BYTES` | const | 65,536 | read/write chunk |
| `MAX_SKIPPED_REPORT` | const | 1,000 | more skipped entries only increase `skipped_more` |
| `ExtractRequest` | struct (serde) | `paths: Vec<String>`, `base: String`, `dest_dir: String`, `new_folder: Option<String>`, `expected_size: u64`, `expected_modified: u64`, `single_file: bool`, `zone: Option<String>` | `paths`: normalized inner paths (files or folders; a folder means everything below it); empty = everything below `base`. `base`: inner folder the output is relative to (`""` = root). `single_file`: open mode (exactly one file). `zone`: `Zone.Identifier` text to copy |
| `SkippedEntry` | struct (serde) | `path: String` (inner path), `reason: String` | reasons: `unsafe_path`, `invalid_name`, `link_entry`, `password_required`, `unsupported_method`, `size_mismatch`, `name_taken`, `damaged`, `access_denied`, `other` |
| `ExtractReport` | struct (serde) | `created: Vec<String>`, `files_written: u64`, `folders_created: u64`, `skipped: Vec<SkippedEntry>`, `skipped_more: u64`, `cancelled: bool`, `opened: Option<String>`, `error: Option<String>` | `created`: the top-level items this run made (or the new folder), as written paths. `opened`: the written file in `single_file` mode. `error`: filled by the app when the helper failed after creating items |
| `ExtractEvents` | trait | `progress(&mut self, progress: &fs_service::OpProgress)`, `created(&mut self, path: &Path)` | the helper forwards both as messages |
| `ArchiveTree` | struct | see T4 | the browsing index |
| `TreeStats` | struct (serde) | `files: u64`, `folders: u64`, `links: u64`, `encrypted: u64`, `total_size: u64`, `packed_size: u64`, `hidden: u64` | |

### Tauri side

| Item | File | Shape |
|---|---|---|
| `Jobs` | `jobs.rs` | managed state: a `Mutex` around a map from request id to a private `JobEntry` (`progress: OpProgress`, `done`, `result: Option<serde_json::Value>`, `error: Option<String>`, `token: CancellationToken`, `finished_at: Option<Instant>`) |
| `JobPoll` | `jobs.rs` | `progress: OpProgress`, `done: bool`, `result: Option<serde_json::Value>`, `error: Option<String>` |
| `JobContext` | `jobs.rs` | given to job work: `token(&self) -> &CancellationToken`, `set_progress(&self, progress: &OpProgress)` |
| `HelperLine` | `helper.rs` | enum `Line(String)`, `TooLong`, `Closed` |
| `DriveEnd` | `helper.rs` | enum `Finished`, `Cancelled` |
| `DriveTimings` | `helper.rs` | `tick` (100 ms), `idle` (30 s), `grace` (5 s); `Default` gives these |
| `HelperRequest` | `archive_helper.rs` | serde, tag `op`, snake_case: `List { path: String }`, `Extract { path: String, request: archive::ExtractRequest }` |
| `HelperMessage` | `archive_helper.rs` | serde, tag `type`, snake_case: `Progress { progress: OpProgress }`, `Entries { entries: Vec<ArchiveEntry> }`, `Listed { format: ArchiveFormat, partial: bool }`, `Created { path: String }`, `Extracted { report: ExtractReport }`, `Failed { code: String }` |
| `ArchiveSummary` | `archive.rs` | `session: String`, `format: ArchiveFormat`, `files`, `folders`, `links`, `encrypted_entries`, `hidden_entries` (all `u64`), `total_size: u64`, `packed_size: u64`, `partial: bool`, `temporary: bool` |
| `ArchiveItem` | `archive.rs` | `path: String`, `name: String`, `kind: EntryKind`, `size: u64`, `packed_size: u64`, `modified_unix: u64`, `encrypted: bool` |
| `ArchiveFolderPage` | `archive.rs` | `items: Vec<ArchiveItem>`, `total: usize`, `truncated: bool` |
| `OpenEntryArgs` | `archive.rs` | `archive: String`, `inner_path: String`, `expected_size: u64`, `expected_modified: u64` |
| `ExtractArgs` | `archive.rs` | `archive: String`, `paths: Vec<String>`, `base: String`, `dest_dir: String`, `new_folder: Option<String>`, `expected_size: u64`, `expected_modified: u64` |
| `OpenedEntry` | `archive.rs` | `path: String` |

Constants (`archive.rs` unless noted): `MAX_SESSIONS` 8, `MAX_FOLDER_PAGE` 5,000, `MAX_SEARCH_RESULTS` 1,000, `MAX_SEARCH_CHARS` 200, `MAX_EXTRACT_PATHS` 10,000, `MAX_INNER_PATH` 1,024, `OPEN_FOLDER` `"archive-open"`, `OPEN_FOLDER_MAX_AGE` 24 hours; `jobs.rs`: `MAX_JOBS` 32 (unfinished), `STALE_AFTER` 10 minutes; `helper.rs`: `MAX_HELPER_LINE` 8 MiB (8,388,608), `CREATE_NO_WINDOW` 0x0800_0000; `archive_helper.rs`: `HELPER_FLAG` `"--archive-helper"`, `HELPER_MEMORY_LIMIT` 1 GiB (1,073,741,824), `MAX_REQUEST_LINE` 1 MiB, `ENTRY_BATCH` 2,000, `PROGRESS_INTERVAL` 100 ms.

### Tauri commands

| Command | Arguments | Returns | Errors (`archive.*` unless noted) |
|---|---|---|---|
| `job_poll` | `request_id: String` | `JobPoll` | `jobs.unknown`, `invalid request id` |
| `job_cancel` | `request_id: String` | `()` | none for an unknown id |
| `archive_open_start` | `request_id: String`, `path: String` | `()`; the job's result is `ArchiveSummary` | `bad_request`; job errors: `not_found`, `unsupported`, `corrupt`, `password_required`, `too_many_entries`, `cancelled`, `helper_failed`, `timeout` |
| `archive_folder` | `session: String`, `folder: String`, `sort_key: String`, `sort_direction: String` | `ArchiveFolderPage` | `bad_request` (also an unknown folder), `no_session` |
| `archive_search` | `session: String`, `text: String` | `ArchiveFolderPage` | `bad_request`, `no_session` |
| `archive_close` | `session: String` | `()` | none |
| `archive_open_entry_start` | `request_id: String`, `request: OpenEntryArgs` | `()`; result `OpenedEntry` | `bad_request`; job errors: `not_found`, `changed`, `not_a_file`, `password_required`, `unsupported_method`, `size_mismatch`, `damaged`, `bomb`, `no_space`, `cancelled`, `helper_failed`, `timeout`, `other` |
| `archive_extract_start` | `request_id: String`, `request: ExtractArgs` | `()`; result `ExtractReport` | `bad_request`, `dest_missing`; job errors: `not_found`, `changed`, `bomb`, `no_space`, `corrupt`, `unsupported`, `password_required`, `access_denied`, `helper_failed`, `timeout` |
| `archive_pick_folder` | `title: String` | `Option<String>` | `bad_request`, `other` |

### TypeScript

| Item | File | Shape |
|---|---|---|
| `JobHandle<T>` | `src/services/jobs.ts` | `id: string`, `cancel(): Promise<void>`, `completion: Promise<T>` |
| `POLL_INTERVAL_MS` | `src/services/jobs.ts` | 100 |
| `ArchiveFormatId` | `src/services/archive.ts` | `"zip" \| "seven_z" \| "tar" \| "tar_gz" \| "tar_xz" \| "gz" \| "xz"` |
| `ArchiveSummary`, `ArchiveItem`, `ArchiveFolderPage`, `ArchiveExtractReport`, `ArchiveSkippedEntry` | `src/services/archive.ts` | mirror the Rust structs (snake_case) |
| `ArchiveExtractRequest` | `src/services/archive.ts` | mirrors `ExtractArgs` |
| `OpenEntryRequest` | `src/services/archive.ts` | mirrors `OpenEntryArgs` |
| `ExtractMode` | `src/archive/archiveFiles.ts` | `"newFolder" \| "here" \| "to"` |
| `ARCHIVE_EXTENSIONS` | `src/archive/archiveFiles.ts` | `zip`, `7z`, `tar`, `gz`, `tgz`, `xz`, `txz` |
| `ExplorerExtractRequest` | `src/views/explorer/useArchiveExtract.ts` | `request: ArchiveExtractRequest`, `nonce: number` |
| `TrackJobOptions<T>`, `TrackJob` | `src/views/explorer/JobsPanel.tsx` | T10 |
| `HandlerViewProps.onExtractArchive` | `src/handlers/types.ts` | optional, takes an `ArchiveExtractRequest` (comment "Step 06d") |

### Commands

Archive tab (`src/handlers/archive/archiveCommands.ts`, context `ArchiveCtx`, help slug `archives`):

| Command id | Label key | Icon (lucide) | Shortcut | Risk | Enabled when |
|---|---|---|---|---|---|
| `archive.extractAll` | `archive.extractAll` | `PackageOpen` | — | `change` | ready, `canExtract`, `files` > 0 |
| `archive.extractSelected` | `archive.extractSelected` | `FolderOutput` | — | `change` | ready, `canExtract`, `selectedCount` > 0 |
| `archive.openEntry` | `archive.openEntry` | `ExternalLink` | — (Enter in the list) | `read-only` | ready, not `busy`, `single` is a folder or an unprotected file |
| `archive.openLocation` | `archive.openLocation` | `FolderSearch` | — | `read-only` | visible only while `searching`; `single` is set |
| `archive.up` | `archive.up` | `FolderUp` | `Backspace` | `read-only` | ready, `folder` not empty, not `searching` |
| `archive.refresh` | `archive.refresh` | `RefreshCw` | `F5` | `read-only` | not loading |

Explorer (`src/commands/explorerCommands.ts`, help slug `archives`, risk `change`, no shortcut):

| Command id | Label key | Icon | Runs |
|---|---|---|---|
| `explorer.extractToFolder` | `commands.extractAll` | `PackageOpen` | `extractArchives("newFolder")` |
| `explorer.extractHere` | `commands.extractHere` | `FolderInput` | `extractArchives("here")` |
| `explorer.extractTo` | `commands.extractTo` | `FolderOutput` | `extractArchives("to")` |

All three are visible and enabled when the selection has no folders, at least one file, and every selected path is an archive (`isArchivePath`).

### Translation keys (all new keys of this step)

| Key | English | Spanish |
|---|---|---|
| `handlers.archive` | Archive | Archivo comprimido |
| `archive.ribbonTab` | Archive | Archivo comprimido |
| `archive.groupExtract` | Extract | Extraer |
| `archive.groupNavigate` | Navigate | Navegar |
| `archive.extractAll` | Extract all | Extraer todo |
| `archive.extractSelected` | Extract selected… | Extraer lo seleccionado… |
| `archive.openEntry` | Open | Abrir |
| `archive.openLocation` | Open item location | Abrir ubicación del elemento |
| `archive.up` | Up one level | Subir un nivel |
| `archive.refresh` | Refresh | Actualizar |
| `archive.listLabel` | Contents of {name} | Contenido de {name} |
| `archive.pathLabel` | Folder in the archive | Carpeta del archivo comprimido |
| `archive.reading` | Reading the archive… | Leyendo el archivo comprimido… |
| `archive.readingPercent` | Reading the archive… {percent}% | Leyendo el archivo comprimido… {percent}% |
| `archive.readCancelled` | Reading was cancelled. | Se canceló la lectura. |
| `archive.tryAgain` | Try again | Volver a intentar |
| `archive.emptyFolder` | This folder is empty. | Esta carpeta está vacía. |
| `archive.emptyArchive` | This archive is empty. | Este archivo comprimido está vacío. |
| `archive.noMatches` | No items match “{text}”. | Ningún elemento coincide con «{text}». |
| `archive.searchNote` | Matches in the whole archive | Coincidencias en todo el archivo comprimido |
| `archive.truncated` | Showing the first {count, number} items. Use the search box to find the others. | Se muestran los primeros {count, number} elementos. Usa el cuadro de búsqueda para encontrar los demás. |
| `archive.searchTruncated` | Showing the first {count, number} matches. | Se muestran las primeras {count, number} coincidencias. |
| `archive.hiddenNote` | {count, plural, one {# item is hidden because its name can't be used safely on Windows.} other {# items are hidden because their names can't be used safely on Windows.}} | {count, plural, one {# elemento está oculto porque su nombre no se puede usar de forma segura en Windows.} other {# elementos están ocultos porque sus nombres no se pueden usar de forma segura en Windows.}} |
| `archive.encryptedNote` | {count, plural, one {# item is protected with a password and can't be opened yet.} other {# items are protected with a password and can't be opened yet.}} | {count, plural, one {# elemento está protegido con contraseña y todavía no se puede abrir.} other {# elementos están protegidos con contraseña y todavía no se pueden abrir.}} |
| `archive.partialNote` | This archive seems damaged: only part of it could be read. | Este archivo comprimido parece dañado: solo se pudo leer una parte. |
| `archive.opening` | Opening {name}… | Abriendo {name}… |
| `archive.linkCannotOpen` | Links inside archives can't be opened. | Los vínculos dentro de los archivos comprimidos no se pueden abrir. |
| `archive.statusItems` | {count, plural, one {# item} other {# items}} | {count, plural, one {# elemento} other {# elementos}} |
| `archive.statusFiles` | {count, plural, one {# file} other {# files}}, {size} when extracted | {count, plural, one {# archivo} other {# archivos}}, {size} al extraer |
| `archive.linkType` | Link | Vínculo |
| `archive.pickFolderTitle` | Choose where to extract | Elige dónde extraer |
| `archive.format.zip` | ZIP archive | Archivo comprimido ZIP |
| `archive.format.seven_z` | 7z archive | Archivo comprimido 7z |
| `archive.format.tar` | TAR archive | Archivo TAR |
| `archive.format.tar_gz` | TAR archive (gzip) | Archivo TAR (gzip) |
| `archive.format.tar_xz` | TAR archive (xz) | Archivo TAR (xz) |
| `archive.format.gz` | gzip file | Archivo gzip |
| `archive.format.xz` | xz file | Archivo xz |
| `commands.extract` | Extract | Extraer |
| `commands.extractAll` | Extract all | Extraer todo |
| `commands.extractHere` | Extract here | Extraer aquí |
| `commands.extractTo` | Extract to… | Extraer en… |
| `jobs.extracting` | {count, plural, one {Extracting # archive} other {Extracting # archives}} | {count, plural, one {Extrayendo # archivo comprimido} other {Extrayendo # archivos comprimidos}} |
| `toast.extracted` | Extracted {name} | Se extrajo {name} |
| `toast.extractedMany` | {count, plural, one {Extracted # archive} other {Extracted # archives}} | {count, plural, one {Se extrajo # archivo comprimido} other {Se extrajeron # archivos comprimidos}} |
| `explorer.extractFirst` | Only the first {count} archives were extracted. | Solo se extrajeron los primeros {count} archivos comprimidos. |
| `files.extractedFolderName` | Extracted files | Archivos extraídos |
| `keys.backspace` | Backspace | Retroceso |
| `errors.archive.other` | Something went wrong with this archive. Try again. | Algo salió mal con este archivo comprimido. Vuelve a intentarlo. |
| `errors.archive.bad_request` | That can't be done with this archive. | Eso no se puede hacer con este archivo comprimido. |
| `errors.archive.not_found` | The archive can't be found. It may have been moved or deleted. | No se encuentra el archivo comprimido. Puede que se haya movido o eliminado. |
| `errors.archive.unsupported` | This kind of archive can't be opened here. Try opening it in another app. | Este tipo de archivo comprimido no se puede abrir aquí. Prueba a abrirlo en otra aplicación. |
| `errors.archive.corrupt` | This archive is damaged and can't be read. | Este archivo comprimido está dañado y no se puede leer. |
| `errors.archive.password_required` | This item is protected with a password, which isn't supported yet. | Este elemento está protegido con contraseña, algo que todavía no es compatible. |
| `errors.archive.too_many_entries` | This archive has more than 200,000 items, too many to open safely. | Este archivo comprimido tiene más de 200 000 elementos, demasiados para abrirlo de forma segura. |
| `errors.archive.bomb` | This archive would expand to far more data than it holds. It wasn't extracted, to protect your disk. | Este archivo comprimido ocuparía muchísimo más espacio que su tamaño. No se extrajo, para proteger tu disco. |
| `errors.archive.no_space` | There isn't enough free space on the drive to extract this. | No hay suficiente espacio libre en la unidad para extraer esto. |
| `errors.archive.changed` | The archive changed since it was opened. Refresh and try again. | El archivo comprimido cambió desde que se abrió. Actualiza y vuelve a intentarlo. |
| `errors.archive.cancelled` | Cancelled. | Cancelado. |
| `errors.archive.not_a_file` | Only files can be opened. | Solo se pueden abrir archivos. |
| `errors.archive.access_denied` | You don't have permission to write in that folder. | No tienes permiso para escribir en esa carpeta. |
| `errors.archive.dest_missing` | The folder to extract to doesn't exist anymore. | La carpeta donde extraer ya no existe. |
| `errors.archive.helper_failed` | The archive couldn't be read. It may be damaged, or it needs more memory than the app allows. | No se pudo leer el archivo comprimido. Puede estar dañado o necesitar más memoria de la que permite la aplicación. |
| `errors.archive.timeout` | Reading the archive stopped responding. | La lectura del archivo comprimido dejó de responder. |
| `errors.archive.no_session` | This archive is no longer open. Refresh to open it again. | Este archivo comprimido ya no está abierto. Actualiza para volver a abrirlo. |
| `errors.archive.unsafe_path` | Skipped: its name could write outside the folder. | Omitido: su nombre podría escribir fuera de la carpeta. |
| `errors.archive.invalid_name` | Skipped: its name can't be used on Windows. | Omitido: su nombre no se puede usar en Windows. |
| `errors.archive.link_entry` | Skipped: links are never extracted. | Omitido: los vínculos nunca se extraen. |
| `errors.archive.unsupported_method` | Skipped: it's compressed in a way the app can't read. | Omitido: está comprimido de una forma que la aplicación no puede leer. |
| `errors.archive.size_mismatch` | Skipped: its size doesn't match what the archive says. | Omitido: su tamaño no coincide con lo que indica el archivo comprimido. |
| `errors.archive.name_taken` | Skipped: an item with this name was already there. | Omitido: ya había un elemento con este nombre. |
| `errors.archive.damaged` | Skipped: this item is damaged. | Omitido: este elemento está dañado. |

After editing `en.json`, run `npm run i18n:pseudo`.

## Tasks

After changing Rust code, run `cargo fmt --all` before the gate.

### T1 - The archive crate and its libraries

**Files:** create `crates/archive/Cargo.toml`, `crates/archive/src/lib.rs`; modify `Cargo.toml` (workspace), `src-tauri/Cargo.toml`, `Cargo.lock`, `THIRD_PARTY_LICENSES.md`, `docs/dependency-and-license-table.md`.

**Do this:** `plan/recipes/add-dependency.md` (Rust).
1. Workspace `Cargo.toml`: add `crates/archive` to `members` (after `crates/fs-service`).
2. `crates/archive/Cargo.toml`: package `archive`, version `0.1.0`, `edition.workspace = true`, `license.workspace = true`. Dependencies:

| Dependency | Version | Default features | Features |
|---|---|---|---|
| `fs-service` | path `../fs-service` | | |
| `serde` | 1 | | `derive` |
| `thiserror` | 2 | | |
| `zip` | 9.1 | off | `deflate`, `deflate64`, `ppmd`, `zstd` |
| `sevenz-rust2` | 0.24 | off | `aes256`, `ppmd` |
| `tar` | 0.4 | on | |
| `flate2` | 1.1 | on | |
| `lzma-rust2` | 0.22 | off | `std`, `xz` |
| `windows` (Windows only, `[target.'cfg(windows)'.dependencies]`) | 0.61 | | `Win32_Foundation`, `Win32_System_Time`, `Win32_Storage_FileSystem` |

   Dev-dependencies: `tempfile` 3; `sevenz-rust2` 0.24 (default features off, features `compress`, to write test archives); `lzma-rust2` 0.22 (default features off, features `std`, `xz`, `encoder`).
3. `crates/archive/src/lib.rs`: only the crate doc comment "Archive reading for Adperastra (Step 06d): format detection, listings, the browsing tree, extraction plans and safe extraction. Pure Rust, no Tauri. Runs inside the archive helper process, never in the app itself." (no modules yet).
4. `src-tauri/Cargo.toml`: a path dependency named `archive` on `../crates/archive`; the `windows` feature list gains `Win32_Security` and `Win32_System_JobObjects`.
5. `cargo build -p archive -p adperastra-app` (with `CARGO_TARGET_DIR` as in `gate.ps1`) to update `Cargo.lock`. `rustc --version` must be 1.93 or newer.
6. Records: `THIRD_PARTY_LICENSES.md` ("App shell libraries"): **zip** 9.1 (MIT), **sevenz-rust2** 0.24 (Apache-2.0), **tar** 0.4 (MIT OR Apache-2.0), **flate2** 1.1 (MIT OR Apache-2.0), **lzma-rust2** 0.22 (Apache-2.0) - "read zip, 7z, tar, gzip and xz archives in the archive helper (Step 06d)"; also the libraries their features pull in: **deflate64** (MIT), **ppmd-rust** (CC0-1.0 OR MIT-0), **zopfli** (Apache-2.0), **zlib-rs** (Zlib), with "used by zip/sevenz-rust2". `docs/dependency-and-license-table.md`: one row "Archives (Step 06d)" with the five libraries and licenses.

**Traps:** default features of `zip` and `sevenz-rust2` would add bzip2 (it comes in Step 06e, with its own records) and an xz-in-zip copy of `lzma-rust2` 0.23 (a second version): keep `default-features = false` exactly as in the table. After the build, `cargo tree -p archive -i bzip2` must find nothing.

**Commit:** `deps: add zip 9.1, sevenz-rust2 0.24, tar 0.4, flate2 1.1, lzma-rust2 0.22 for the archive crate (MIT/Apache-2.0) [step-06d/T1]`

### T2 - Crate basics: errors, entries, limits, safe paths, dates, format detection

**Files:** create `crates/archive/src/error.rs`, `entry.rs`, `limits.rs`, `path.rs`, `time.rs`, `format.rs`, `crates/archive/tests/step06d_basics_tests.rs`; modify `crates/archive/src/lib.rs`, `crates/fs-service/src/rename.rs`, `crates/fs-service/src/lib.rs`.

**Do this:**
1. `fs-service`: make `move_without_replacing(from, to)` public (both the Windows and the other version keep their bodies) and re-export it from `lib.rs` next to `rename_in_place`. Its doc comment: "Move or rename without ever replacing an existing item (the target must not exist). Used by renames and by archive extraction."
2. `error.rs`: `ArchiveError` (Data shapes) with `code()`. `From<std::io::Error>`: `NotFound` kind gives `NotFound`, `PermissionDenied` gives `AccessDenied`, others `Io`.
3. `entry.rs`: `ArchiveFormat`, `EntryKind`, `ArchiveEntry`, `IMPLICIT_INDEX`, `Listing` (Data shapes; all derive `Debug, Clone, Serialize, Deserialize`, the enums also `Copy, PartialEq, Eq`).
4. `limits.rs`: `Limits` with `Default`; `CHUNK_BYTES`; pure `check_bomb(total: u64, archive_size: u64, limits: &Limits) -> Result<(), ArchiveError>`: `Bomb` when `total > max_total_bytes`, or when `total > ratio_floor_bytes` and `total > max_ratio × max(archive_size, 1)` (use saturating multiplication); pure `check_space(total: u64, free: Option<u64>, limits: &Limits) -> Result<(), ArchiveError>`: `None` passes; `NoSpace` when `total + space_margin_bytes > free`; `free_bytes(dir: &Path) -> Option<u64>`: `GetDiskFreeSpaceExW` on the folder (the "free bytes available to the caller" value; `None` on failure).
5. `path.rs`, all pure:
   - `normalize_inner_path(raw: &str, limits: &Limits) -> Result<String, &'static str>`, in order: (a) turn `\` into `/`; (b) `unsafe_path` when it starts with `/`, or its second character is `:` (a drive letter); (c) split on `/`, drop empty and `.` components; (d) `unsafe_path` when any component is `..`; (e) `invalid_name` when nothing is left, when more than `max_depth` components, when the joined result is longer than `max_inner_path_chars` characters, or when any component fails `fs_service::validate_new_name`; (f) Ok with the components joined by `/`.
   - `is_root_entry(raw: &str) -> bool`: true when the raw name, after turning `\` into `/`, has only `/` and `.` characters (for example `./`, `/`, `.`). Root entries are left out of listings silently (bsdtar writes `./`).
   - `parent_of(inner: &str) -> &str` (text before the last `/`, or `""`), `name_of(inner: &str) -> &str` (text after the last `/`), `relative_to<'a>(inner: &'a str, base: &str) -> Option<&'a str>` (base `""`: the whole path; else the rest after `base` + `/`; `None` when not below base or equal to it), `first_component(relative: &str) -> &str`.
6. `time.rs`: `dos_local_to_unix(year: u16, month: u8, day: u8, hour: u8, minute: u8, second: u8) -> u64`: 0 unless 1980 ≤ year ≤ 2107, 1 ≤ month ≤ 12, 1 ≤ day ≤ 31, hour < 24, minute < 60, second < 60; build a `SYSTEMTIME` (day of week 0, milliseconds 0), `TzSpecificLocalTimeToSystemTime(None, local, utc)`, `SystemTimeToFileTime(utc, filetime)`, then `fs_service::filetime_to_unix` of the 64-bit tick value; any failure gives 0. `// SAFETY:` comments: pointers to locals that outlive the calls.
7. `format.rs`: `detect_format(path: &Path) -> Result<ArchiveFormat, ArchiveError>`: read up to the first 512 bytes (a missing file gives `NotFound`), then in this order: `PK` followed by bytes 3,4 or 5,6 or 7,8 gives `Zip`; bytes `37 7A BC AF 27 1C` give `SevenZ`; `1F 8B` gives gzip and `FD 37 7A 58 5A 00` gives xz: decompress up to 512 bytes of the start (`flate2::read::MultiGzDecoder`, `lzma_rust2::XzReader::new_mem_limit(reader, true, limits.xz_memory_kb)` with the default limits) and when bytes 257 to 261 of the decompressed data are `ustar`, `TarGz` / `TarXz`, else `Gz` / `Xz`; bytes 257 to 261 of the file equal to `ustar` give `Tar`; a file whose extension is `tar` (any case) and that is at least 512 bytes long gives `Tar`; anything else (also RAR, bzip2, empty files) gives `Unsupported`.
8. `lib.rs`: the modules above and re-exports of every public item.

**Tests** (`step06d_basics_tests.rs`; default `Limits` unless said):

| Test | Input | Expected |
|---|---|---|
| `normalizes_good_paths` | `docs/plan.md`; `docs\plan.md`; `./docs//plan.md`; `docs/`; `ünïcödé/файл.txt` | `docs/plan.md` three times; `docs`; the same text |
| `refuses_paths_that_leave_the_folder` | `/etc/passwd`; `\\server\share\x`; `C:/Windows/x.dll`; `C:x.txt`; `a/../../evil.txt`; `a/../b.txt` | `unsafe_path` for all |
| `refuses_names_windows_does_not_allow` | `CON/x.txt`; `notes.txt:evil`; `folder./x.txt`; empty text; `.`; 65 components `a/a/…/a`; a 1,025-character name | `invalid_name` for all |
| `recognizes_root_entries` | `./`; `/`; `.`; `./a` | true, true, true, false |
| `splits_inner_paths` | `parent_of("docs/a/b.txt")`, `parent_of("b.txt")`, `name_of("docs/a/b.txt")`, `relative_to("docs/a/b.txt", "docs")`, `relative_to("docs2/x", "docs")`, `relative_to("docs", "docs")`, `relative_to("x", "")`, `first_component("a/b/c")` | `docs/a`, `""`, `b.txt`, `Some("a/b.txt")`, `None`, `None`, `Some("x")`, `a` |
| `bomb_rule` | `(500 MiB, 1 KiB)`; `(2 GiB, 1 MiB)`; `(2 GiB, 8 MiB)`; `(2 TiB, 1 TiB)` | Ok; `Bomb` (2048 > 500); Ok (256); `Bomb` (over 1 TiB) |
| `space_rule` | `(13, Some(10))`; `(13, Some(100 MiB))`; `(13, None)` | `NoSpace`; Ok; Ok |
| `dos_time_uses_the_local_zone` | `(2024, 1, 15, 12, 0, 0)` | within 14 hours (50,400 s) of 1,705,320,000 |
| `dos_time_refuses_impossible_dates` | `(1979, 1, 1, 0, 0, 0)`; `(2024, 13, 1, 0, 0, 0)`; `(2024, 2, 30, 0, 0, 0)` | 0 each |
| `detects_formats_by_content` | in a tempdir: a zip made with `zip::ZipWriter` named `photo.7z`; a text file `fake.zip`; an empty `empty.zip`; a tar (made with `tar::Builder`) named `data.bin`; that tar gzipped (`flate2::write::GzEncoder`, `Compression::default()`) named `x.gz`; a gzipped text named `notes.txt.gz` | `Zip`; `Unsupported`; `Unsupported`; `Tar`; `TarGz`; `Gz` |
| `error_codes` | each `ArchiveError` variant | its `archive.*` code from the table |

**Commit:** `feat(archive): safe inner paths, limits, zip dates and format detection [step-06d/T2]`

### T3 - Listings for every format

**Files:** create `crates/archive/src/list.rs`, `read_zip.rs`, `read_7z.rs`, `read_tar.rs`, `read_stream.rs`, `crates/archive/tests/common/mod.rs`, `crates/archive/tests/step06d_list_tests.rs`; modify `crates/archive/src/lib.rs`.

**Do this:**
1. `list.rs`: `list(path: &Path, limits: &Limits, token: &CancellationToken, progress: &mut dyn FnMut(&OpProgress)) -> Result<Listing, ArchiveError>`: `detect_format`, then the format's lister. Shared rules for every lister: the token is checked at least every 256 entries (`Cancelled`); more than `max_entries` entries gives `TooManyEntries`; every raw name goes through `is_root_entry` (left out, index still counted) and `normalize_inner_path` (on `Err(problem)` the entry is kept with `problem` set, its raw path and raw last part); progress (at most every 100 ms) reports `bytes_done` = compressed bytes read so far and `bytes_total` = the archive's size (for zip and 7z one report at the end is enough).
2. `read_zip.rs` (`list_zip(file, limits, token)`): `zip::ZipArchive::new` over a `BufReader` of the file; errors: `InvalidArchive` and `Io` give `Corrupt`, `UnsupportedArchive` and `CompressionMethodNotSupported` give `Unsupported`. `len()` over the limit gives `TooManyEntries`. For each index: `by_index_raw(i)` (metadata only, nothing decompressed or decrypted); an error marks the listing `partial` and continues with the next index. Fields: raw name from `name()` (an error marks `partial` and skips the entry); kind `Folder` when `is_dir()`, `Link` when `is_symlink()`, else `File`; `size()`, `compressed_size()`, `encrypted()`; `last_modified()` through `dos_local_to_unix(year(), month(), day(), hour(), minute(), second())`, or 0.
3. `read_7z.rs` (`list_7z(file, limits, token)`): `sevenz_rust2::Archive::read(&mut reader, &Password::empty())` over a `BufReader`; errors: `PasswordRequired` and `MaybeBadPassword` give `PasswordRequired`; `Unsupported`, `UnsupportedCompressionMethod`, `UnsupportedVersion`, `ExternalUnsupported` give `Unsupported`; everything else `Corrupt`. For each `(i, entry)` of `files`: skip `is_anti_item` entries (index still counted); kind `Folder` when `is_directory()`, else `File`; `size()`, `compressed_size` (0 is fine), modified = `SystemTime::from(entry.last_modified_date())` minus the Unix epoch in whole seconds (an error gives 0); `encrypted` false (7z marks protection per block; Step 06e adds it).
4. `read_tar.rs` (`list_tar(reader, packed: bool, limits, token, counter)` used for `Tar`, `TarGz` (over `MultiGzDecoder`) and `TarXz` (over `XzReader::new_mem_limit(…, true, limits.xz_memory_kb)`)): a small counting reader around the file adds every byte read to a shared counter (an `Arc<AtomicU64>`) for progress. `tar::Archive::new(decoder)`, `entries()`; an `Err` from the iterator (or from an entry) marks the listing `partial` and stops. Index = position among all yielded entries. Raw name from `path_bytes()` as lossy UTF-8. Kind from `header().entry_type()`: `is_file()` gives `File`, `is_dir()` gives `Folder`, `is_symlink()` or `is_hard_link()` gives `Link`; any other type is left out (index still counted). `size()` of the entry; `packed_size` = size for plain tar, 0 for compressed; `header().mtime()` or 0.
5. `read_stream.rs` (`list_stream(file, format, path, limits, token, counter)` for `Gz` and `Xz`): one entry, index 0, kind `File`, name = the archive's file name without its last extension (`notes.txt.gz` gives `notes.txt`; an empty result gives `data`), size = the number of bytes the decoder produces, counted by reading to the end in `CHUNK_BYTES` pieces (token checked per piece; more than `max_total_bytes` stops with `Bomb`; a decode error gives `Corrupt`), `packed_size` = the file's size, modified = the archive file's modified time.
6. `tests/common/mod.rs` (shared test builders, used from T3 on): functions that write the sample archives into a folder and return their paths:

| Builder | Contents (in this order) |
|---|---|
| `sample_zip` (`ZipWriter`, `SimpleFileOptions`, Deflated) | `README.txt` = "hello" (5 bytes); folder `docs/` (`add_directory`); `docs/plan.md` = "# Plan\n" (7 bytes); `images/logo.png` = 100 zero bytes (Stored); `../evil.txt` = "x"; `CON.txt` = "c" |
| `sample_7z` (`ArchiveWriter::create`, `push_archive_entry`, `finish`) | `ArchiveEntry::new_directory("docs")` (no reader); `ArchiveEntry::new_file("docs/plan.md")` with "# Plan\n"; `ArchiveEntry::new_file("README.txt")` with "hello" |
| `sample_tar_bytes` (`tar::Builder` over a `Vec<u8>`, `Header::new_gnu`) | `README.txt` (regular, "hello", mtime 1,600,000,000); `docs/` (directory); `docs/plan.md` ("# Plan\n"); `link` (entry type `Symlink`, size 0, target set with `set_link_name("README.txt")`); an entry whose name bytes `../evil.txt` are written straight into `as_old_mut().name` (bypassing the builder's path check), then `set_cksum`, data "x" |
| `sample_tar`, `sample_tar_gz`, `sample_tar_xz` | those bytes as a file, gzipped (`GzEncoder`), and xz (`lzma_rust2::XzWriter::new(file, XzOptions::default())`, `finish`) |
| `sample_gz`, `sample_xz` | 1,000 bytes of `a` as `notes.txt.gz` and `notes.txt.xz` |

**Tests** (`step06d_list_tests.rs`):

| Test | Input | Expected |
|---|---|---|
| `lists_a_zip` | `sample_zip` | format `Zip`, 6 entries, `partial` false; `README.txt` size 5, kind `File`; `docs` kind `Folder`; `../evil.txt` with `problem` `unsafe_path`; `CON.txt` with `invalid_name`; every safe entry's `problem` is `None` |
| `lists_a_7z` | `sample_7z` | format `SevenZ`; `README.txt` size 5; `docs` `Folder`; `docs/plan.md` size 7 |
| `lists_tar_tar_gz_and_tar_xz_alike` | the three tar builders | formats `Tar`, `TarGz`, `TarXz`; the same paths in the same order: `README.txt`, `docs`, `docs/plan.md`, `link` (`Link`), `../evil.txt` (`unsafe_path`); `README.txt` modified 1,600,000,000 |
| `lists_single_gz_and_xz_files` | `sample_gz`, `sample_xz` | one entry `notes.txt`, size 1,000, formats `Gz`, `Xz` |
| `bsdtar_root_entries_are_left_out` | a zip written with entries `./` (directory) and `./a.txt` | one entry `a.txt` with index 1 |
| `a_damaged_tar_is_partial` | the first 1,536 bytes of `sample_tar_bytes` (header and data block of `README.txt`, header of `docs/`) followed by 100 bytes of a cut header | `partial` true; `README.txt` listed |
| `a_truncated_zip_is_corrupt` | the first 100 bytes of `sample_zip` | `Err(Corrupt)` |
| `too_many_entries_is_refused` | `sample_zip` with `max_entries` 3 | `Err(TooManyEntries)` |
| `cancel_stops_listing` | the token set before calling | `Err(Cancelled)` |

**Traps:**
- `ZipFile::name()` returns a `ZipResult`; never use `enclosed_name()` here: our own `normalize_inner_path` is stricter and the same for every format.
- `tar`'s `Archive::entries` needs `&mut`; the builder refuses `..` in paths, which is why the test writes the name bytes directly.
- `XzReader::new_mem_limit` returns the reader itself, not a `Result`.

**Commit:** `feat(archive): list zip, 7z, tar, tar.gz, tar.xz, gz and xz archives [step-06d/T3]`

### T4 - The browsing tree and the extraction plan

**Files:** create `crates/archive/src/tree.rs`, `crates/archive/src/plan.rs`, `crates/archive/tests/step06d_tree_tests.rs`, `crates/archive/tests/step06d_plan_tests.rs`; modify `crates/archive/src/lib.rs`.

**Do this (`tree.rs`):** `ArchiveTree` (fields private) with:
1. `build(entries: Vec<ArchiveEntry>) -> ArchiveTree`: entries with a `problem` are only counted (`hidden`). For every other entry, in order: make sure each parent folder exists (a missing one is added as an implicit folder entry: `index` `IMPLICIT_INDEX`, kind `Folder`, sizes and date 0) and is listed in its own parent's children; then add the entry to its parent's children, except a `Folder` whose exact path already exists: then copy its `index` and `modified_unix` into the existing folder entry (it keeps its place). Children lists keep insertion order. Paths are compared exactly (case matters).
2. `entry(&self, i: usize) -> &ArchiveEntry`, `children(&self, folder: &str) -> Option<&[usize]>` (`""` = root; `None` when the folder does not exist), `is_folder(&self, path: &str) -> bool`.
3. `sorted_children(&self, folder: &str, spec: fs_service::SortSpec) -> Option<Vec<usize>>`: the children ordered like `fs_service::sort_items`: folders first in both directions; then by the key (Name: `fs_service::natural_cmp` of names; Modified; Size; Kind: the lower-case extension after the last dot, `""` without one); Descending reverses only the key; ties by natural name.
4. `search(&self, text: &str, limit: usize) -> (Vec<usize>, usize)`: entries (in tree order, implicit folders included) whose name contains `text` ignoring case (both sides lower-cased); the first `limit` and the total count.
5. `stats(&self) -> TreeStats` (files, folders, links, encrypted, total size and packed size of files, hidden).

**Do this (`plan.rs`):**
1. `ArchiveFacts { size: u64, modified_unix: u64 }`; `PlannedEntry { index: u32, inner: String, relative: Vec<String>, size: u64, modified_unix: u64 }`; `ExtractPlan { files: Vec<PlannedEntry>, folders: Vec<PlannedEntry>, skipped: Vec<SkippedEntry>, bytes_total: u64, top_names: Vec<String> }`.
2. `plan_extract(listing: &Listing, request: &ExtractRequest, facts: ArchiveFacts, limits: &Limits) -> Result<ExtractPlan, ArchiveError>`, in order:
   1. `Changed` when `facts.size` differs from `expected_size`, or `expected_modified` is not 0 and differs from `facts.modified_unix`.
   2. `base`: `""` or a path that `normalize_inner_path` leaves unchanged and that is a folder of the listing (explicit or implied by a deeper path); else `BadRequest`. Every requested path must be normalized, exist in the listing (as an entry or an implied folder) and be below `base` (`relative_to` is `Some`); else `BadRequest`. More than 10,000 paths: `BadRequest`.
   3. Selected entries (listing order): every entry when `paths` is empty and `base` is `""`; with `paths` empty, every entry below `base`; otherwise entries equal to a requested path or below it (`path` starts with it plus `/`).
   4. Per selected entry: `problem` set gives a skip with that reason (its raw path); `Link` gives `link_entry`; an encrypted `File` gives `password_required`; a `Folder` goes to `folders`; a `File` goes to `files`. `relative` = the components of `relative_to(path, base)`.
   5. `single_file`: exactly one requested path, and it must be a `File` entry: a folder, a link, an unknown path or several paths give `NotAFile`, a protected one `PasswordRequired`, a problem entry `BadRequest`.
   6. `bytes_total` = the sum of the files' sizes; `check_bomb(bytes_total, facts.size, limits)`.
   7. `top_names`: the distinct first relative components of files and folders, in first-seen order (compared ignoring case).
3. `top_level_names(plan: &ExtractPlan, root: &Path) -> Vec<(String, String)>`: for each top name, `(name, actual)` where `actual` is the name when `root/name` does not exist, else the file name of `fs_service::unique_destination(root, name)`.

**Tests** (`step06d_tree_tests.rs`, synthetic entries, no files): entries in order `a/b/c.txt` (file 10), `a/d.txt` (file 20), `e.txt` (file 5), `../x` (file 1, `problem` `unsafe_path`), `a` (folder, modified 1,000).

| Test | Expected |
|---|---|
| `builds_folders_from_paths` | root children names `a`, `e.txt`; children of `a`: `b`, `d.txt`; of `a/b`: `c.txt`; exactly one `a`, with modified 1,000; `children("zzz")` is `None`; `is_folder("a/b")` true, `is_folder("e.txt")` false |
| `counts_files_and_hidden_items` | stats: files 3, folders 2, total size 35, hidden 1 |
| `sorts_like_the_explorer` | root by Name ascending: `a`, `e.txt`; children of `a` by Size descending: `b`, `d.txt` (folders first); extra entries `x.zip`, `y.txt`, `z.md` in a new tree, Kind ascending: `z.md`, `y.txt`, `x.zip`; `file 10.txt` and `file 9.txt`, Name ascending: `file 9.txt`, `file 10.txt` |
| `searches_names_in_the_whole_archive` | `search("txt", 1000)`: `c.txt`, `d.txt`, `e.txt`, total 3; `search("C.TXT", 1000)`: `c.txt`; `search("txt", 2)`: 2 results, total 3 |

**Tests** (`step06d_plan_tests.rs`): a synthetic `Listing` (format `Zip`) with entries index 0 `README.txt` (file 5, packed 3), 1 `docs` (folder), 2 `docs/plan.md` (file 7), 3 `docs/old/x.md` (file 1), 4 `link` (`Link`), 5 `../evil.txt` (file 1, `unsafe_path`), 6 `secret.txt` (file 4, encrypted); facts size 1,000, modified 50; requests have `expected_size` 1,000 and `expected_modified` 50 unless said.

| Test | Request | Expected |
|---|---|---|
| `extract_all_skips_what_is_unsafe` | paths empty, base `""` | files `README.txt`, `docs/plan.md`, `docs/old/x.md`; folders `docs`; bytes_total 13; skipped `link` (`link_entry`), `../evil.txt` (`unsafe_path`), `secret.txt` (`password_required`) in that order; top names `README.txt`, `docs` |
| `a_selection_is_relative_to_the_base` | paths `docs/old`, base `docs` | files `docs/old/x.md` with relative `old`, `x.md`; no folders; top names `old`; bytes 1 |
| `a_folder_selection_takes_everything_below` | paths `docs`, base `""` | files `docs/plan.md`, `docs/old/x.md`; folders `docs`; top names `docs` |
| `paths_outside_the_base_are_refused` | paths `README.txt`, base `docs`; paths `nope.txt`; base `nope` | `BadRequest` each |
| `single_file_rules` | single_file with `docs`; with `secret.txt`; with `link`; with `README.txt` | `NotAFile`; `PasswordRequired`; `NotAFile`; Ok with one file, relative `README.txt` |
| `a_changed_archive_is_refused` | facts size 999 | `Changed`; with `expected_modified` 0 and facts modified 77 (size right): Ok |
| `bombs_are_refused` | a listing with one file of 2 GiB; facts size 1 MiB, then 8 MiB (expected sizes matching) | `Bomb`; Ok |
| `top_level_names_keep_both` | tempdir root with a folder `docs` and a file `README.txt`; the plan of the first test | `README.txt` → `README (2).txt`, `docs` → `docs (2)`; in an empty root both unchanged |

**Commit:** `feat(archive): browsing tree and extraction plan [step-06d/T4]`

### T5 - Safe extraction

**Files:** create `crates/archive/src/write.rs`, `crates/archive/src/extract.rs`, `crates/archive/tests/step06d_extract_tests.rs`; modify `read_zip.rs`, `read_7z.rs`, `read_tar.rs`, `read_stream.rs`, `lib.rs`.

**Do this (`write.rs`):**
1. `WriteFailure` enum: `Skip(&'static str)` (a skip reason), `Cancelled`.
2. `write_entry(target: &Path, reader: &mut dyn Read, declared: u64, modified_unix: u64, zone: Option<&str>, token: &CancellationToken, on_bytes: &mut dyn FnMut(u64)) -> Result<(), WriteFailure>`, in order:
   1. The target exists (`symlink_metadata` succeeds): `Skip("name_taken")`.
   2. Create its folder (`create_dir_all` of the parent; access denied gives `Skip("access_denied")`, other errors `Skip("other")`).
   3. Open `fs_service::partial_path(target)` with "create new" (an existing partial file gives `Skip("name_taken")`; access denied `Skip("access_denied")`), wrapped in a `BufWriter`.
   4. Loop: read at most `CHUNK_BYTES`; 0 ends the loop; add to a running total; when the total exceeds `declared`, stop with `Skip("size_mismatch")`; write the bytes; `on_bytes(n)`; when the token is set, stop with `Cancelled`. A read error stops with `Skip("damaged")`; a write error with `Skip("access_denied")` (permission) or `Skip("other")`.
   5. After the loop a total below `declared` gives `Skip("size_mismatch")`.
   6. Flush; when `modified_unix` > 0, `set_modified` on the file to that time (errors ignored); close it.
   7. `fs_service::move_without_replacing(partial, target)`; an "already exists" error (Windows codes 80 or 183) gives `Skip("name_taken")`, others `Skip("other")`.
   8. With `zone`: write the text to the stream path `<target>:Zone.Identifier` (only when the target's file name has no `:`; errors ignored).
   Every failure after step 3 removes the partial file first (this is the only `remove_file` in the crate; it removes only our own unfinished partial file, R-SAFE-3). Nothing is ever written to `target` directly.

**Do this (`extract.rs`):**
1. `extract(path: &Path, request: &ExtractRequest, limits: &Limits, token: &CancellationToken, events: &mut dyn ExtractEvents) -> Result<ExtractReport, ArchiveError>`, in order:
   1. The archive's metadata (missing: `NotFound`) gives `ArchiveFacts`.
   2. `list(...)` (progress ignored), then `plan_extract`.
   3. `dest` = `std::fs::canonicalize(dest_dir)` (failure or not a folder: `DestMissing`).
   4. `check_space(plan.bytes_total, free_bytes(dest), limits)`.
   5. Root: with `new_folder` (checked with `validate_new_name`, else `BadRequest`), `unique_destination(dest, name)`, created with `create_dir` (an "already exists" race tries `unique_destination` once more; access denied gives `AccessDenied`), reported with `events.created`, and listed in `report.created`; without it, the root is `dest` and the top-level names come from `top_level_names`.
   6. Folders of the plan (in order): `create_dir_all` of root plus the mapped relative path (a file in the way: skip `name_taken`; access denied: `access_denied`); counted in `folders_created`.
   7. Files: the format's extraction loop (below) calls an `Extractor` method for each planned file with a reader; it maps the first component through the top-level names, calls `write_entry`, records skips (at most `MAX_SKIPPED_REPORT`, then `skipped_more`), counts `files_written`, and reports progress (`items_done`/`items_total` = files written or skipped / planned files, `bytes_done`/`bytes_total` = bytes written / `bytes_total`, `current` = the target path) at most every 100 ms.
   8. Without `new_folder`: after each written file or created folder, when its top-level path is not yet in `report.created`, add it and call `events.created`.
   9. `Cancelled` from a write, or the token seen between entries: stop, `report.cancelled` true (items already written stay; Undo removes them).
   10. `single_file`: `report.opened` = the written file's path; when that one file is skipped instead, the report has no `opened` and its one skipped item says why (T8 turns it into the job's error).
2. Format loops:
   - zip (`extract_zip`): for each planned file in index order: `by_index_raw(index)` and `encrypted()` gives a `password_required` skip; then `by_index(index)`: `UnsupportedArchive(ZipError::PASSWORD_REQUIRED)` or `InvalidPassword` give `password_required`; other `UnsupportedArchive` and `CompressionMethodNotSupported` give `unsupported_method`; other errors give `damaged`; else write from the entry.
   - 7z (`extract_7z`): `ArchiveReader::new(BufReader, Password::empty())`; build a map from planned inner path to a queue of planned files; `for_each_entries` with a closure that normalizes the entry's `name()` the same way as the listing, and when it is planned and not yet done, writes it from the given reader; otherwise reads the reader to the end into a sink in `CHUNK_BYTES` pieces (token checked per piece). The closure returns `Ok(true)` to go on and `Ok(false)` once the token is set (and on every later call, without reading). An `Err` from `for_each_entries`: `PasswordRequired` or `MaybeBadPassword` turn every planned file not yet done into `password_required` skips; `UnsupportedCompressionMethod`, `Unsupported` and `ExternalUnsupported` into `unsupported_method`; anything else into `damaged`. After the loop, planned files never seen become `damaged` skips.
   - tar family (`extract_tar`): iterate the entries again with the same index counting as the listing; a planned index is written from the entry itself (`tar::Entry` reads its data); an iterator error turns the remaining planned files into `damaged` skips. Never call the `tar` crate's `unpack`.
   - gz/xz (`extract_stream`): the one planned file is written from the decoder.

**Tests** (`step06d_extract_tests.rs`; a `RecordingEvents` test type keeps the created paths; dest is a fresh tempdir):

| Test | Steps | Expected |
|---|---|---|
| `extracts_a_zip_into_a_new_folder` | `sample_zip`, all, `new_folder` `sample` | `dest/sample/README.txt` = "hello", `dest/sample/docs/plan.md`, `dest/sample/images/logo.png` (100 bytes); `created` = [`…\sample`] (also recorded by the events); `files_written` 3; skipped `../evil.txt` (`unsafe_path`) and `CON.txt` (`invalid_name`); the tempdir holds only `dest` and the archive; no file name starting with `~` anywhere |
| `extracting_twice_keeps_both` | `sample_zip` all into `dest` twice, no `new_folder`, with a second-run file time check | second run creates `README (2).txt`, `docs (2)`, `images (2)`; the first run's files keep their content and modified time; second `created` has those three |
| `extracts_every_format` | `sample_7z`, `sample_tar`, `sample_tar_gz`, `sample_tar_xz`, `sample_gz`, `sample_xz` into separate folders | the right files with the exact bytes; for the tars `link` is skipped with `link_entry` and nothing named `link` exists |
| `keeps_modified_times` | `sample_tar` | `README.txt` modified time 1,600,000,000 (±1 s) |
| `copies_the_internet_mark` | `sample_zip` with `zone` `[ZoneTransfer]\r\nZoneId=3\r\n` | reading `README.txt:Zone.Identifier` gives that text |
| `opens_one_file` | `sample_zip`, `single_file`, paths `docs/plan.md`, base `docs`, dest an empty folder | `opened` = `dest\plan.md`; only that file exists |
| `cancel_leaves_no_partial_file` | `sample_tar`, events set the token when the first item is created | `cancelled` true; no `~…partial` file; every written file is complete |
| `bombs_are_refused_before_writing` | a gz of 100,000 zero bytes, limits with `ratio_floor_bytes` 1,000 and `max_ratio` 10 | `Err(Bomb)`; dest still empty |
| `a_changed_archive_is_refused` | `expected_size` one byte off | `Err(Changed)` |
| `write_entry_counts_bytes` | readers of "hello" (declared 5); 10 bytes (declared 5); 3 bytes (declared 5); a target that exists with "old"; token already set; `modified_unix` 1,600,000,000 | Ok with content "hello"; `size_mismatch` and no target and no partial file; `size_mismatch`, nothing left; `name_taken`, content still "old"; `Cancelled`, nothing left; the file's modified time is 1,600,000,000 |

**Traps:**
- `std::fs::rename` replaces an existing file on Windows: only `move_without_replacing` may put a file in place.
- The 7z closure must read every entry's data to the end (solid archives cannot skip); never return early without reading unless the token is set.
- A selection can start below the archive's root: map only the first component of the *relative* path.

**Commit:** `feat(archive): extract safely with partial files, no overwrite and the internet mark [step-06d/T5]`

### T6 - Shared job table

**Files:** create `src-tauri/src/jobs.rs`, `src/services/jobs.ts`, `src/__tests__/jobs.test.ts`; modify `src-tauri/src/main.rs`, `src-tauri/isolation/index.html`.

**Do this (`jobs.rs`, module doc "Shared job table (Step 06d, contract 10): every new long task runs as a job polled by the UI with job_poll and stopped with job_cancel."):**
1. `Jobs` (managed, `Default`) with methods (all take `&self`, lock with `map_err`, never hold the lock during work, P-20):
   - `begin(id: &str, items_total: usize) -> Result<CancellationToken, String>`: first removes finished entries older than `STALE_AFTER`; an existing id gives `jobs.duplicate`; `MAX_JOBS` unfinished entries give `jobs.too_many`; inserts an entry with zero progress.
   - `set_progress(id, &OpProgress)`, `finish(id, Result<serde_json::Value, String>)` (sets `done`, `result` or `error`, `finished_at`).
   - `poll(id) -> Result<JobPoll, String>`: an unknown id gives `jobs.unknown`; a done entry is removed after being copied.
   - `cancel(id)`: sets the token (unknown: nothing).
2. `JobContext` (holds the `AppHandle`, the id and the token) and `spawn_job(app: AppHandle, id: String, token: CancellationToken, work)`: `work` is a closure taking `&JobContext` and returning `Result<serde_json::Value, String>`; it runs inside `tauri::async_runtime::spawn_blocking`; the result goes to `finish`.
3. Commands `job_poll(window, jobs: State<Jobs>, request_id)` and `job_cancel(window, jobs, request_id)`: `ensure_main`, `crate::valid_request_id`.
4. `main.rs`: `mod jobs;`, `.manage(jobs::Jobs::default())`, both commands in `generate_handler!`; `ALLOWED` gets them.
5. Tests at the bottom of `jobs.rs`: `begin_poll_finish` (begin `a`; poll gives done false; finish Ok(json 7); poll gives done true and result 7; poll again gives `jobs.unknown`); `duplicate_ids_are_refused`; `cancel_sets_the_token`; `too_many_unfinished_jobs` (33rd begin gives `jobs.too_many`); `errors_are_returned` (finish Err(`archive.corrupt`) then poll gives that error).

**Do this (`src/services/jobs.ts`, doc comment "Shared jobs (Step 06d): start a Rust job, poll it every 100 ms, cancel it."):**
1. `newRequestId(prefix: string): string`: prefix must be 1 to 12 lower-case ASCII letters (else throw `Error("jobs.bad_prefix")`); returns prefix, `-`, `Date.now()` in base 36, `-`, a counter that grows by one per call (always under 64 characters, valid for `valid_request_id`).
2. `runJob<T>(prefix: string, start: (requestId: string) => Promise<void>, onProgress?: (progress: OpProgress) => void): Promise<JobHandle<T>>`: outside Tauri (`isTauriRuntime()` false) rejects with `Error("jobs.unavailable")`; makes the id, awaits `start(id)`; `cancel` invokes `job_cancel` (errors ignored); `completion` loops: invoke `job_poll` with `{ requestId }`, call `onProgress(poll.progress)`, throw `Error(poll.error)` when set, resolve `poll.result as T` when done, else wait `POLL_INTERVAL_MS`.

**Tests** (`src/__tests__/jobs.test.ts`; mock `@tauri-apps/api/core` and `isTauriRuntime` from `../services/settings` returning true; fake timers):

| Test | Steps | Expected |
|---|---|---|
| "request ids are valid and unique" | two calls with `arc` | both start with `arc-`, differ, are under 64 characters and contain only letters, digits and `-` |
| "bad prefixes are refused" | `Arc`, empty, 13 letters | each throws `jobs.bad_prefix` |
| "a job resolves with its result" | polls answer not done (progress items_done 1), then done with result `{ ok: true }` | `onProgress` called twice; completion resolves `{ ok: true }`; `job_poll` called twice with the same `requestId` |
| "a job error rejects" | poll answers `error: "archive.corrupt"` | completion rejects with `archive.corrupt` |
| "cancel asks Rust to stop" | `cancel()` | `job_cancel` invoked with the id |

**Commit:** `feat(jobs): shared job table with job_poll and job_cancel [step-06d/T6]`

### T7 - The archive helper process

**Files:** create `src-tauri/src/helper.rs`, `src-tauri/src/archive_helper.rs`; modify `src-tauri/src/main.rs`.

**Do this (`helper.rs`, module doc "Helper processes (Step 06d): runs Adperastra.exe with a helper flag inside a Windows job object with a memory limit, talks to it in JSON lines, and kills it when it hangs. Step 07a reuses this."):**
1. A private `JobObject` wrapper owning the job `HANDLE`, marked `Send` with a `// SAFETY:` comment (a kernel handle may be used from any thread), closing it with `CloseHandle` on drop.
2. `HelperProcess` (fields: the `Child`, its stdin, a receiver of `HelperLine`s, the `JobObject`), with:
   - `spawn(flag: &str, memory_limit: usize) -> Result<HelperProcess, String>`: `spawn_command` of `Command::new(std::env::current_exe())` with the one argument `flag`.
   - `spawn_command(command: Command, memory_limit: usize) -> Result<HelperProcess, String>` (tests use it): stdin and stdout piped, stderr null, creation flags `CREATE_NO_WINDOW`; start; `CreateJobObjectW(None, PCWSTR::null())`; a `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` (`Default`) with `BasicLimitInformation.LimitFlags` = the three flags `JOB_OBJECT_LIMIT_PROCESS_MEMORY`, `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and `JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION` combined (`JOB_OBJECT_LIMIT` supports bitwise or), and `ProcessMemoryLimit` = `memory_limit`; `SetInformationJobObject` with the class `JobObjectExtendedLimitInformation`, a pointer to that struct and its size in bytes; `AssignProcessToJobObject` with the job and the child's raw handle (`AsRawHandle::as_raw_handle`, wrapped in `HANDLE`). Any failure kills the child and gives `helper.start_failed`. Nothing has been written to the helper yet, so it cannot have started working before it is in the job.
   - A reader thread over stdout: reads one line at a time with a cap (`read_capped_line(reader, MAX_HELPER_LINE)`, a pure function: reads up to the cap plus one byte or the next `\n`; returns the line without `\n` or `\r\n`, `TooLong` when the cap is passed, or end of stream); sends `Line`, then `TooLong` or `Closed` and ends.
   - `send_line(&mut self, text: &str) -> Result<(), String>` (writes the text and `\n`, flushes; errors give `helper.failed`), `recv(&self, timeout: Duration) -> Option<HelperLine>` (`None` on timeout), `kill(&mut self)` (kill and wait, errors ignored). Dropping a `HelperProcess` kills it.
3. A trait `HelperIo` with `recv`, `send_line`, `kill`, implemented by `HelperProcess`, and `drive(io: &mut dyn HelperIo, token: &CancellationToken, timings: DriveTimings, on_line: &mut dyn FnMut(&str) -> Result<bool, String>) -> Result<DriveEnd, String>`: loop: `recv(timings.tick)`; a `Line` resets the idle clock and goes to `on_line` (its `Err` is returned after `kill`; `Ok(true)` returns `Finished`); `TooLong` kills and gives `helper.failed`; `Closed` gives `Cancelled` when a cancel was sent, else `helper.failed`; then: token set and no cancel sent yet: `send_line("cancel")` (errors ignored), remember the time; a cancel sent at least `grace` ago: kill, `Cancelled`; idle at least `idle`: kill, `helper.timeout`.
4. Tests at the bottom: `capped_lines` (input `a\nbb\r\nccc` with cap 10 gives `a`, `bb`, `ccc`, then end; a 20-byte line with cap 10 gives `TooLong`); `drive` with a fake `HelperIo` (a queue of answers and a log of sent lines; timings tick 1 ms, idle 50 ms, grace 20 ms): lines `x` then `done` with `on_line` returning true on `done` gives `Finished`; `Closed` first gives `helper.failed`; nothing at all gives `helper.timeout` and a kill; a set token sends `cancel` once and, with no answer, ends `Cancelled` after the grace with a kill; `TooLong` gives `helper.failed`; the `powershell.exe` tests like `classic_menu.rs`: `a_helper_line_round_trip` (`Write-Output 'hello'` through `spawn_command`: `recv` within 20 s gives `Line("hello")`, then `Closed`) and `the_memory_limit_applies` (with a 300 MB limit, the script tries to allocate a 600,000,000-byte array inside `try`, writing `allocated` or `refused`: the line is `refused`).

**Do this (`archive_helper.rs`, module doc "The archive helper (Step 06d): Adperastra.exe --archive-helper reads and extracts archives in its own process (plan/rules.md R-SEC-9)."):**
1. `HELPER_FLAG`, `HELPER_MEMORY_LIMIT`, `MAX_REQUEST_LINE`, `ENTRY_BATCH`, `PROGRESS_INTERVAL`, `HelperRequest`, `HelperMessage` (Data shapes).
2. `run_helper() -> i32`: read the first stdin line (at most `MAX_REQUEST_LINE`; `read_capped_line`) and parse it; failure: write `Failed { code: "archive.bad_request" }`, return 2. Start a thread reading later stdin lines: `cancel`, end of input or an error set the token (an app that disappears stops the helper). A reporter writes each message as one JSON line and flushes; progress messages at most every `PROGRESS_INTERVAL`. `List`: `archive::list(path, &Limits::default(), &token, progress)`; on success the entries in `Entries` batches of `ENTRY_BATCH`, then `Listed`; on error `Failed` with `code()`. `Extract`: `archive::extract(...)` with events forwarding `Progress` and `Created`, then `Extracted`, or `Failed`. Return 0.
3. Pure `entry_batches(count: usize) -> Vec<(usize, usize)>` (start and end of each batch) used by `run_helper`.
4. `main.rs`: `mod helper;`, `mod archive_helper;`; in `main()`, right after the classic-menu check, the same check for `archive_helper::HELPER_FLAG` exiting with `archive_helper::run_helper()`.
5. Tests: `requests_round_trip` (a `List` and an `Extract` request to JSON and back; the JSON of `List` has `"op":"list"`); `messages_round_trip` (`Failed` JSON has `"type":"failed"` and the code; `Progress` keeps its numbers); `batches` (`entry_batches(0)` empty; `(5000)` gives (0, 2000), (2000, 4000), (4000, 5000)).

**Traps:**
- `HANDLE` is not `Send`: keep the raw job handle only inside the wrapper.
- Never install the panic hook or start Tauri in the helper: the flag check comes first in `main()`.
- Never build a command line from a path: the archive path travels in the JSON request (R-SEC-7).

**Commit:** `feat(archive): archive helper process with a job-object memory limit [step-06d/T7]`

### T8 - Archive commands: sessions, opening entries, extraction jobs

**Files:** create `src-tauri/src/archive.rs`, `src/services/archive.ts`; modify `src-tauri/src/main.rs`, `src-tauri/src/zone.rs`, `src-tauri/isolation/index.html`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** every `errors.archive.*` key.

**Do this:**
1. `zone.rs`: `internet_zone_text(path: &Path) -> Option<String>`: the `Zone.Identifier` stream text (at most `ZONE_STREAM_MAX` bytes, lossy UTF-8) when `is_from_internet(path)`, else `None`.
2. `archive.rs` (module doc "Archives (Step 06d, contract 20): browsing sessions, opening a file inside, extraction jobs. All archive bytes are read by the archive helper."):
   - `ArchiveSessions` (managed, `Default`): a `Mutex` around the sessions (id → `archive` path and `Arc<ArchiveTree>`) and their use order; adding the ninth drops the least recently used; `folder` and `search` mark a session as used. Copy the `Arc` out of the lock before sorting or searching (P-20).
   - A private `run_helper_job(ctx: &JobContext, request: &HelperRequest, on_message: …)`: `helper::HelperProcess::spawn(HELPER_FLAG, HELPER_MEMORY_LIMIT)`, sends the request as one JSON line, then `helper::drive` with default timings; every line is parsed as a `HelperMessage` (bad JSON: `archive.helper_failed`); `Progress` goes to `ctx.set_progress`; `Failed { code }` ends with that code. Codes `helper.failed`, `helper.start_failed` give `archive.helper_failed`; `helper.timeout` gives `archive.timeout`; `DriveEnd::Cancelled` gives `archive.cancelled` unless the caller handles it.
   - `archive_open_start(window, jobs, app, request_id, path)`: `ensure_main`, `valid_request_id`, `validate_absolute_path` (else `archive.bad_request`); `jobs.begin(request_id, 0)`; `spawn_job`: run the helper with `List`; collect `Entries` (more than `Limits::default().max_entries` in total: `archive.too_many_entries`); `Listed` ends; build the `ArchiveTree`; store the session under the request id; result = `ArchiveSummary` from `stats()`, the format, `partial`, and `temporary` = the canonical archive path starts with the canonical `<data>/archive-open`.
   - `archive_folder(window, sessions, session, folder, sort_key, sort_direction)`: `ensure_main`; `valid_request_id(session)`; `folder` at most `MAX_INNER_PATH` characters; `crate::parse_sort` (errors give `archive.bad_request`); unknown session `archive.no_session`; unknown folder `archive.bad_request`; `sorted_children`, the first `MAX_FOLDER_PAGE` as `ArchiveItem`s, `total` and `truncated`.
   - `archive_search(window, sessions, session, text)`: text 1 to `MAX_SEARCH_CHARS` characters; `search(text, MAX_SEARCH_RESULTS)`.
   - `archive_close(window, sessions, session)`: removes it (unknown: nothing).
   - `archive_open_entry_start(window, jobs, app, request_id, request: OpenEntryArgs)`: checks (absolute archive; `inner_path` 1 to `MAX_INNER_PATH` characters); the folder `<data>/archive-open/<request id>` is created; the crate request: `paths` = [inner path], `base` = `parent_of(inner path)`, `dest_dir` = that folder, `new_folder` none, `single_file` true, the expected values, `zone` = `zone::internet_zone_text(archive)`; run `Extract`; with `Extracted`: a report with `opened` sets the Read-only attribute on that file (`set_permissions`) and gives `OpenedEntry { path }`; a report whose only skipped item has a reason gives `archive.<reason>`; `Failed { code }` gives that code.
   - `archive_extract_start(window, jobs, app, request_id, request: ExtractArgs)`: checks (absolute archive and destination, the destination is an existing folder (else `archive.dest_missing`), at most `MAX_EXTRACT_PATHS` paths of 1 to `MAX_INNER_PATH` characters, `base` at most `MAX_INNER_PATH`, `new_folder` `None` or passing `validate_new_name`; any other failure `archive.bad_request`); the crate request with `single_file` false and the zone text; run `Extract`; collect `Created` paths; `Extracted` gives the report; a helper failure or kill after some `Created` messages gives a report with those `created` items, `cancelled` true when a cancel was asked, and `error` = the code (so the Explorer can record Undo); without any created item the code is the job's error. After a kill, remove `fs_service::partial_path` of the last progress `current` when it exists (only that one partial file).
   - `archive_pick_folder(window, title)`: like `templates_pick_folder` (title 1 to 200 characters; `file_dialogs::pick_folder_path`; `dialog.failed` gives `archive.other`).
   - `start_cleanup(data_dir: PathBuf)`: a background thread that calls the pure `cleanup_open_folder(root: &Path, max_age: Duration, now: SystemTime)`: for each folder directly inside `root` whose modified time is older than `now - max_age`, clear the Read-only attribute of every file in it, then remove it with `remove_dir_all` (the app's own temporary copies; never anything outside `root`).
3. `main.rs`: `mod archive;`, `.manage(archive::ArchiveSessions::default())`, the seven archive commands in `generate_handler!`, `archive::start_cleanup(data_dir.clone())` once at start (after the data folder exists); `ALLOWED` gets the commands.
4. `src/services/archive.ts` (doc comment "Archives (Step 06d): open, browse, open a file inside, extract. Mirrors src-tauri/src/archive.rs."): the types of Data shapes, and `archiveOpen(path, onProgress?)` (`runJob` for an `ArchiveSummary` with the prefix `arcopen`; its start function invokes `archive_open_start` with a literal object holding `requestId` (the job's id) and `path`), `archiveFolder(session, folder, sortKey, sortDirection)`, `archiveSearch(session, text)`, `archiveClose(session)` (errors ignored), `archiveOpenEntry(request, onProgress?)` (prefix `arcentry`; the result's path through `displayPath`), `archiveExtract(request, onProgress?)` (prefix `arcextract`; `created` through `displayPath`; skipped paths with `/` turned into `\`), `archivePickFolder(title)` (`null` outside Tauri). Outside Tauri the folder and search calls reject with `archive.other`. Always literal argument objects (P-03).
5. Tests at the bottom of `archive.rs`: `sessions_drop_the_oldest` (nine sessions: the first is gone, the second remains; using the second before adding a tenth keeps it); `extract_args_are_checked` (relative destination, 10,001 paths, a 1,025-character path, `new_folder` `CON` each give `archive.bad_request`); `cleanup_removes_only_old_folders` (tempdir with folders `a` and `b`, a read-only file in `a`; `now` = 25 hours from now: both removed; `now` = now: both kept); `temporary_archives_are_recognized` (a path inside `<tmp>/archive-open` true, beside it false).

**Commit:** `feat(archive): browsing sessions, open a file inside, extraction jobs [step-06d/T8]`

### T9 - The archive tab

**Files:** create `src/archive/archiveFiles.ts`, `src/handlers/archive/index.ts`, `src/handlers/archive/ArchiveView.tsx`, `src/handlers/archive/useArchiveSession.ts`, `src/handlers/archive/archiveItems.ts`, `src/handlers/archive/archiveCommands.ts`, `src/styles/archive.css`, `src/__tests__/archiveFiles.test.ts`, `src/__tests__/archiveItems.test.ts`, `src/__tests__/archiveView.test.tsx`, `help/en/archives.md`, `help/es/archives.md` (exact texts in "Help pages"); modify `src/handlers/index.ts`, `src/handlers/types.ts`, `src/services/shortcuts.ts`, `src/__tests__/shortcuts.test.ts`, `src/__tests__/defaultApps.test.tsx`, `src/main.tsx` (import `./styles/archive.css` right after `./styles/templates.css`), `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** `handlers.archive`, every `archive.*` key, `files.extractedFolderName`, `keys.backspace`.

**Do this (`src/archive/archiveFiles.ts`, pure):** `ARCHIVE_EXTENSIONS`, `ExtractMode`; `isArchivePath(path)`: the lower-case extension after the last dot of the last path part is in the list; `archiveBaseName(name)`: strip `.tar.gz` or `.tar.xz` (any case) when the name ends with one, else the last extension; `extractedFolderName(name, fallback)`: `archiveBaseName(name)` or `fallback` when that is empty; `extractRequestFor(item: { path, size, modified_unix }, mode, destDir: string | null, fallback)`: an `ArchiveExtractRequest` with `archive` = path, `paths` empty, `base` `""`, `dest_dir` = `parentPathOf(path)` for `newFolder` and `here` or `destDir` for `to`, `new_folder` = `extractedFolderName(file name, fallback)` for `newFolder` and `to`, `null` for `here`, and the item's size and modified time.

**Do this (`archiveItems.ts`, pure):** `toExplorerItem(item: ArchiveItem): ExplorerItem` (`path` = the inner path, `kind` `folder` for folders and `file` otherwise, `is_link` true for links, `hidden`, `system`, `online_only`, `file_id_stable` false, `file_id` null; these items never reach code that treats `path` as a disk path); `archiveTypeLabel(t, item)` (folders `explorer.folderType`; links `archive.linkType`; with an extension `explorer.fileType` with `ext` upper-cased; else `explorer.genericFile`); `breadcrumbSegments(archiveName, folder)` (the root segment `{ id: "", label: archiveName }`, then one per component with the cumulative path as id); `parentFolder(folder)`.

**Do this (`index.ts`):** `archiveHandler`: id `archive`, version 1, `labelKey` `handlers.archive`, icon `Archive`, accent `explorer`, extensions `ARCHIVE_EXTENSIONS`, `mimeTypes` empty (content types would also catch Office files, which are zips), `maxBytes` `Number.MAX_SAFE_INTEGER`, `helpSlug` `archives`, `speedTier` `waiting`, `supportsFind` true, lazy view `ArchiveView`. `src/handlers/index.ts` registers it after the hex handler. `types.ts`: `HandlerViewProps.onExtractArchive` (Data shapes).

**Do this (`useArchiveSession.ts`):** `useArchiveSession(path: string)` returns the phase (`loading` with the last `OpProgress` or null; `ready` with the `ArchiveSummary`; `error` with the error; `cancelled`), `cancelOpen()`, `reload()`, `folder`, `setFolder(folder)`, `sort` (key and direction, default name ascending), `setSort(key)` (the same key flips the direction; a new key starts ascending), `page` (`ArchiveFolderPage` or null), `results` (search results or null), `search(text)`.
1. On mount and on `reload()`: `archiveOpen(path, onProgress)`; keep the handle's `cancel`; completion gives `ready` and folder `""`; an error `archive.cancelled` gives `cancelled`, any other `error`.
2. While ready: `archiveFolder(session, folder, key, direction)` whenever these change; the previous page stays on screen until the new one arrives; an answer for an older request is ignored; `archive.no_session` reopens once (`reload()`); `archive.bad_request` goes back to the root.
3. `search(text)`: an empty text clears `results`; otherwise after 150 ms `archiveSearch(session, text)` (older answers ignored).
4. Cleanup (P-28): cancel a running open, `archiveClose(session)` when one exists.

**Do this (`archiveCommands.ts`):** `ArchiveCtx` (`ready`, `canExtract`, `files`, `selectedCount`, `single: ArchiveItem | null`, `folder`, `searching`, `busy`, `loading`); `createArchiveCommands(actions)` returning the six commands of the table (`actions`: `extractAll`, `extractSelected`, `openEntry`, `openLocation`, `up`, `refresh`); `ARCHIVE_RIBBON` (one tab `archive`, label `archive.ribbonTab`, key tip `A`; group `extract` (`archive.groupExtract`): `archive.extractAll` (label shown, key tip `E`), `archive.extractSelected` (label shown, `S`); group `navigate` (`archive.groupNavigate`): `archive.up` (`U`), `archive.openEntry` (`O`), `archive.openLocation` (`L`), `archive.refresh` (`R`)); `ARCHIVE_ITEM_MENU` (`archive.openEntry`, `archive.openLocation`, a separator, `archive.extractSelected`) and `ARCHIVE_BACKGROUND_MENU` (`archive.extractAll`, `archive.refresh`).

**Do this (`ArchiveView.tsx`):** default export, props `HandlerViewProps`.
1. Structure inside `ViewerFrame` (ribbon = `Ribbon` with `ARCHIVE_RIBBON`, the commands, the context, accent `explorer`, `active`): `div.adp-archive` holding, in order: `nav.adp-archive-bar` (`aria-label` `archive.pathLabel`) with `Breadcrumb` (segments from `breadcrumbSegments(info.name, folder)`; `onNavigate` sets the folder) and, while searching, `span.adp-archive-searchnote` with `archive.searchNote`; the notes `div.adp-archive-note` (`role="status"`, one per case: `archive.partialNote` when `partial`, `archive.hiddenNote` when `hidden_entries` > 0, `archive.encryptedNote` when `encrypted_entries` > 0, `archive.truncated` or `archive.searchTruncated` with the page's limit when truncated); `div.adp-archive-body` with the state; `div.adp-archive-strip` when opening a file or showing a message.
2. States of the body: loading: nothing for 100 ms, then `Skeleton` (rows, 8); after 1 s also `p.adp-archive-reading` with `archive.reading` or `archive.readingPercent` (`percent` = floor of bytes done × 100 / bytes total when the total is above 0) and a `Button` `common.cancel` calling `cancelOpen`; error: `div.adp-viewer-message` (`role="alert"`) with `errorText(t, error, "archive")` and a primary `Button` `fileTab.openInWindowsApp` calling `onOpenInWindowsApp`; cancelled: `div.adp-viewer-message` with `archive.readCancelled` and a `Button` `archive.tryAgain` (`reload`); ready: `FileList` with the items of `results` (searching) or `page` (`toExplorerItem`), `groups` null, the selection state, `sortKey`/`sortDirection`/`onSort`, `showExtensions` true, `checkboxes` false, `typeLabel` from `archiveTypeLabel`, `renamingPath` null, rename callbacks that do nothing (`onRenameCommit` resolves null), `onOpen`, `onContextMenu`, `onCommandKey` (only `explorer.open` acts: the focused item), `label` `archive.listLabel` with the name; an empty page shows `p.adp-archive-empty` with `archive.emptyArchive` (root) or `archive.emptyFolder`; empty search results show `archive.noMatches` with the text.
3. Searching: `find.text` trimmed and not empty, and not equal to a text the view set aside (opening a folder or a location from the results sets the current text aside, so the folder shows until the search text changes). `find.request` changing while results exist selects result number `request` modulo the count.
4. Opening an item: a folder sets the folder (selection cleared); a link shows `archive.linkCannotOpen` in the strip; a protected file shows `errorText(t, Error("archive.password_required"), "archive")`; a file starts `archiveOpenEntry({ archive: info.path, inner_path, expected_size: info.size, expected_modified: info.modified_unix })` (`busy` while it runs); after 150 ms the strip shows `archive.opening` with the name, a `ProgressBar` (the job's bytes percent) and `common.cancel`; done: `onOpenFile(path)` (a returned promise's rejection shows `errorText(t, error, "files")` in the strip); errors show `errorText(t, error, "archive")` in the strip with `common.dismiss`; a cancel clears the strip.
5. Commands: `extractAll`: request `extractRequestFor({ path: info.path, size: info.size, modified_unix: info.modified_unix }, "newFolder", null, t("files.extractedFolderName"))`; when the summary is `temporary`, first `archivePickFolder(t("archive.pickFolderTitle"))` (null: stop) and use mode `to` with that folder; then `onExtractArchive(request)`. `extractSelected`: `archivePickFolder` (null: stop), then a request with `paths` = the selected inner paths, `base` = `""` while searching else the folder, `dest_dir` = the chosen folder, `new_folder` null. `openEntry`: the single selected item. `openLocation`: set the result's parent folder, set the search aside, select it. `up`: parent folder. `refresh`: `reload()`. `canExtract` = `onExtractArchive` is given. `useCommandShortcuts(commands, ctx, active)`.
6. Menus: right-click on an item that is not selected selects only it first; the `Menu` component with `resolveMenu(ARCHIVE_ITEM_MENU or ARCHIVE_BACKGROUND_MENU, ctx, lookup)`, a point anchor, `onRun` running the command.
7. Status (`onStatus`): items `archive.statusItems` (the page's or results' total), `archive.statusFiles` (`files`, `size` = `formatSize(total_size, language)`), and `archive.format.<format>`.
8. When the tab becomes active and the list is ready, focus the list's scroll element inside this view (`.adp-filelist-scroll` within the view's own root element).

**Do this (`archive.css`):** comment "Archive tab (Step 06d). Colors only through tokens."

| Selector | Layout and look |
|---|---|
| `.adp-archive` | flex column; flex 1; min-width 0; min-height 0; background `--adp-color-surface-window` |
| `.adp-archive-bar` | flex row, items centered; gap `--adp-space-3`; height 40 px; padding 0 `--adp-space-7`; border-bottom 1 px `--adp-color-border-subtle` |
| `.adp-archive-searchnote` | margin-left auto; text `--adp-color-text-secondary`; font size `--adp-font-small` |
| `.adp-archive-note` | flex row, items centered; gap `--adp-space-3`; min-height 32 px; padding `--adp-space-2` `--adp-space-7`; background `--adp-color-status-caution-background`; border-bottom 1 px `--adp-color-border-subtle`; text `--adp-color-text-primary`; font size `--adp-font-body` |
| `.adp-archive-body` | flex 1; min-height 0; flex column (the list fills it) |
| `.adp-archive-reading`, `.adp-archive-empty` | padding `--adp-space-7`; text `--adp-color-text-secondary` |
| `.adp-archive-strip` | flex row, items centered; gap `--adp-space-4`; height 40 px; padding 0 `--adp-space-7`; border-top 1 px `--adp-color-border-subtle`; background `--adp-color-surface-chrome`; the progress bar inside 160 px wide |

**Do this (other files):** `shortcuts.ts`: `backspace` maps to `keys.backspace`. `shortcuts.test.ts`: `formatShortcut("Backspace", t)` gives "Retroceso" in Spanish. `defaultApps.test.tsx`: the group ids become `image`, `media`, `markdown`, `text`, `archive`.

**Tests:**
- `archiveFiles.test.ts`: `isArchivePath` of `C:\a\b.zip`, `C:\a\B.ZIP`, `C:\a\x.tar.gz`, `C:\a\x.tgz`, `C:\a\x.7z`, `\\?\C:\a\b.xz` (true each) and `C:\a\x.rar`, `C:\a\x.bz2`, `C:\a\x.docx`, `C:\a\zip` (false each); `archiveBaseName` of `photos.zip`, `photos.tar.gz`, `Photos.TAR.XZ`, `notes.txt.gz`, `backup.tgz`, `.zip`, `archive` gives `photos`, `photos`, `Photos`, `notes.txt`, `backup`, `""`, `archive`; `extractedFolderName(".zip", "Extracted files")` gives `Extracted files`; `extractRequestFor` of `{ path: "C:\\Users\\Ana\\Downloads\\photos.zip", size: 1234, modified_unix: 1700000000 }`: `newFolder` gives `dest_dir` `C:\Users\Ana\Downloads`, `new_folder` `photos`, `paths` empty, `base` `""`, sizes copied; `here` gives `new_folder` null; `to` with `D:\Out` gives `dest_dir` `D:\Out`, `new_folder` `photos`.
- `archiveItems.test.ts`: `toExplorerItem` of a file (`docs/plan.md`, 7 bytes, modified 100) keeps path, name, size and date, `kind` `file`, `is_link` false, `file_id` null; a link gives `kind` `file` and `is_link` true; a folder gives `kind` `folder`; `archiveTypeLabel` gives the four texts; `breadcrumbSegments("Project files.zip", "docs/old")` gives the three segments `""`/`Project files.zip`, `docs`/`docs`, `docs/old`/`old`, and for `""` only the first; `parentFolder` of `docs/old`, `docs`, `""` gives `docs`, `""`, `""`.
- `archiveView.test.tsx` (mock `../services/archive` and `@tanstack/react-virtual` like `fileList.test.tsx`; info `{ path: "C:\\D\\sample.zip", name: "sample.zip", size: 1000, modified_unix: 50, … }`; the summary has session `s1`, files 2, folders 1; the root page `docs` (folder) and `README.txt`; the `docs` page `plan.md`):

| Test | Steps | Expected |
|---|---|---|
| "lists the root of the archive" | render | rows `docs`, `README.txt`; breadcrumb `sample.zip`; `archiveFolder("s1", "", "name", "ascending")` |
| "opens a folder and goes back up" | double-click `docs`; then a Backspace key-down on `window` | `archiveFolder` with `docs`; row `plan.md`; breadcrumb `sample.zip`, `docs`; after Backspace `archiveFolder` with `""` again |
| "searches the whole archive" | render again with `find` text `plan`; advance 150 ms | `archiveSearch("s1", "plan")`; its results as rows; the `archive.searchNote` text |
| "opens a file in a new tab" | double-click `README.txt`; `archiveOpenEntry` resolves `C:\Data\archive-open\r1\README.txt` | `archiveOpenEntry` with `inner_path` `README.txt`, size 1000, modified 50; `onOpenFile` with that path |
| "extract all hands the request to the Explorer" | click the ribbon button `archive.extractAll` | `onExtractArchive` with archive `C:\D\sample.zip`, paths empty, base `""`, dest `C:\D`, new folder `sample`, size 1000, modified 50 |
| "extract selected asks for a folder" | click `README.txt`; click `archive.extractSelected`; the picker resolves `C:\Out` | `onExtractArchive` with paths `README.txt`, base `""`, dest `C:\Out`, new folder null |
| "a cancelled folder choice does nothing" | the picker resolves null | `onExtractArchive` not called |
| "shows why an archive can't be opened" | the open rejects `archive.corrupt` | the `errors.archive.corrupt` text; the button `fileTab.openInWindowsApp` calls `onOpenInWindowsApp` |
| "explains hidden and protected items" | summary `hidden_entries` 2, `encrypted_entries` 1 | the `archive.hiddenNote` (2) and `archive.encryptedNote` (1) texts |
| "closes the session when the tab closes" | unmount | `archiveClose("s1")` |

**Commit:** `feat(archive): archive file tab with folders, search and opening files inside [step-06d/T9]`

### T10 - Extraction from the Explorer and from archive tabs

**Files:** create `src/views/explorer/useArchiveExtract.ts`, `src/__tests__/archiveExtract.test.tsx`, `src/__tests__/jobsPanel.test.tsx`; modify `src/views/explorer/JobsPanel.tsx`, `src/views/ExplorerHome.tsx`, `src/commands/explorerCommands.ts`, `src/commands/menus.ts`, `src/__tests__/commands.test.ts`, `src/views/FileTabView.tsx`, `src/App.tsx`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** `commands.extract`, `commands.extractAll`, `commands.extractHere`, `commands.extractTo`, `jobs.extracting`, `toast.extracted`, `toast.extractedMany`, `explorer.extractFirst`.

**Do this:**
1. `JobsPanel.tsx`: `JobView` gains the optional `reasonArea` (`"ops"` or `"archive"`, default `"ops"`); skipped reasons are translated with `errors.<reasonArea>.<reason>`, falling back to `errors.<reasonArea>.other`. Export `TrackJobOptions<T>` (`verbKey: string`, `count: number`, `reasonArea?`, `start: (onProgress: (progress: OpProgress) => void) => Promise<{ cancel: () => Promise<void>; completion: Promise<T> }>`, `outcome: (result: T) => { cancelled: boolean; skipped: SkippedItem[] }`) and `TrackJob` (a generic function taking `TrackJobOptions<T>` and returning `Promise<T>`).
2. `ExplorerHome.tsx` (about 40 lines): move the body of `runTracked` into a new `trackJob` (a `TrackJob`: the same panel entry, 400 ms open timer, progress updates, cancel map, status from `outcome`, `reasonArea` stored on the entry); `runTracked` keeps its signature and calls `trackJob` with `startFileJob` and an outcome from the report. Then `const archive = useArchiveExtract({...})` with the dependencies below; actions `extractArchives(mode)` calling `archive.extractItems(selected paths, mode)`; a new optional prop `extractRequest` (`ExplorerExtractRequest | null`, default null) and an effect on its `nonce` (like the `navigateRequest` effect) calling `archive.runRequest(extractRequest.request)`; `showResult(destDir, select, navigate)`: when `navigate` and the location has not changed since the job started, set `pendingSelectRef` and `goToFolder(destDir)`; otherwise, when the current folder is `destDir` (`samePath`), set `pendingSelectRef` to `select` and `refreshAfterOp()`.
3. `useArchiveExtract.ts`: `useArchiveExtract(deps)`, deps: `t`, `trackJob`, `undoStack` (the `UndoStack` instance), `touchUndo`, `notify`, `notifyAction`, `notifyError`, `currentFolder` (function), `showResult`, `itemFor` (path to `ExplorerItem` or undefined). Returns `extractItems(paths, mode)` and `runRequest(request)`.
   - `runOne(request, navigate)`: `trackJob` with verb `extracting`, count 1, `reasonArea` `archive`, `start` = `archiveExtract(request, onProgress)`, outcome from the report (`cancelled`; `skipped` as `SkippedItem`s). The report: when `created` is not empty, push an undo entry `{ labelKey: "toast.extracted", labelArgs: { name: <archive file name> }, undo: { type: "recycle", paths: created }, redo: { type: "restore", originals: created } }` and `touchUndo`; `report.error` set: `notifyError(Error(report.error), "archive")`; skipped (or `skipped_more`) > 0: `notify(t("jobs.skippedItems", { count }))`; cancelled: `notify(t("jobs.cancelled"))`; then `showResult(request.dest_dir, created[0] or null, navigate)`. Errors of the job: `notifyError(error, "archive")`. Returns the undo entry or null.
   - `extractItems(paths, mode)`: only paths that are archives with a known item (`itemFor`); more than 20: use the first 20 and `notify(t("explorer.extractFirst", { count: 20 }))`; mode `to`: `archivePickFolder(t("archive.pickFolderTitle"))` once (null: stop); requests from `extractRequestFor(item, mode, folder, t("files.extractedFolderName"))`; one archive: `runOne(request, mode === "to")` and `notifyAction(t("toast.extracted", { name }), entry)` when an entry was made; several: `undoStack.beginGroup("toast.extractedMany", { count })`, run them one after another, `endGroup()`, `touchUndo`, then `notifyAction(t("toast.extractedMany", { count }), undoStack.peekUndo())` when anything was created.
   - `runRequest(request)` (from an archive tab, the App already shows `dest_dir`): `runOne(request, false)` and the single toast.
4. `explorerCommands.ts`: `ExplorerActions.extractArchives(mode: ExtractMode)` (comment "Step 06d"); the three commands of the Commands table right after `explorer.openAsHex`, with the visibility rule. `menus.ts`: in `ITEM_MENU`, right after the `openAs` submenu, the submenu `{ id: "extract", labelKey: "commands.extract", icon: PackageOpen }` with `explorer.extractToFolder`, `explorer.extractHere`, `explorer.extractTo`; in `commandBarFor`, the entry `explorer.extractToFolder` with its label shown, right after the `explorer.delete` entry (hidden unless archives are selected).
5. `FileTabView.tsx`: optional prop `onExtractArchive`, passed to the view. `App.tsx` (about 12 lines): a state `extractRequest` (`ExplorerExtractRequest | null`) and `extractArchive(request)`: `showInExplorer(request.dest_dir, null)` and a new request with the next nonce; `FileTabView` gets `onExtractArchive={extractArchive}`; `ExplorerHome` gets `extractRequest`.

**Tests:**
- `jobsPanel.test.tsx` (new): a finished job with `reasonArea` `archive` and one skipped item `docs\evil.txt` / `unsafe_path`: after clicking the skipped button, the list shows `evil.txt` and the `errors.archive.unsafe_path` text; the same job without `reasonArea` and reason `in_use` shows `errors.ops.in_use`.
- `archiveExtract.test.tsx` (a small test component calls the hook with fake deps; mock `../services/archive`; `trackJob` fake runs `start` and returns the completion):

| Test | Steps | Expected |
|---|---|---|
| "extract all makes a folder next to the archive" | `itemFor` knows `C:\D\a.zip`; `extractItems(["C:\\D\\a.zip"], "newFolder")`; the report creates `C:\D\a` | `archiveExtract` with dest `C:\D`, new folder `a`; `trackJob` with verb `extracting`, count 1, `reasonArea` `archive`; one undo entry `toast.extracted` (name `a.zip`) with undo recycle `C:\D\a` and redo restore it; `notifyAction` called; `showResult("C:\\D", "C:\\D\\a", false)` |
| "Extract to asks for a folder once" | two archives, mode `to`, the picker resolves `E:\X` | picker called once; two `archiveExtract` calls with dest `E:\X`; one undo entry `toast.extractedMany` (count 2); `showResult` with navigate true |
| "a cancelled folder choice extracts nothing" | mode `to`, the picker resolves null | `archiveExtract` not called |
| "nothing created, no undo" | the report has no created items and one skipped item | no undo entry; `notify` with `jobs.skippedItems` |
| "a failure after creating items keeps Undo" | report with created `C:\D\a` and error `archive.helper_failed` | undo entry pushed; `notifyError` with `archive.helper_failed` |

- `commands.test.ts`: add "extract commands appear only for archives": with selection paths `C:\D\a.zip` (files 1, folders 0) the three commands are visible and enabled; with `C:\D\a.txt`, or with a folder selected too, they are hidden; running `explorer.extractHere` calls `extractArchives("here")` (add the spy to the test's actions); `ITEM_MENU` has a submenu `extract` with the three ids in order. Update any assertion that lists the command bar's entries literally to include `explorer.extractToFolder` after `explorer.delete`.

**Commit:** `feat(explorer): Extract all, Extract here, Extract to and extraction from archive tabs [step-06d/T10]`

### T11 - Speed and screenshots

**Files:** modify `scripts/measure-ui.ps1`, `scripts/measure-ui.mjs`.

**Do this:**
1. `measure-ui.ps1`, after the demo folder block: the folder `%TEMP%\adperastra-corpus\archives` and, when missing, two zip files made with .NET's `System.IO.Compression.ZipFile` (load the `System.IO.Compression.FileSystem` assembly; open each new file in "Create" mode; one entry per name, each written with a UTF-8 text writer; dispose everything): `Project files.zip` with `README.txt` ("This archive holds the project files."), `docs/plan.md` ("# Plan"), `docs/notes.txt` ("Notes"), `docs/meeting notes.txt` ("Meeting"), the folder entry `images/`, `data/table.csv` ("a,b" and "1,2" on two lines); `Big archive.zip` with folders `folder 01` to `folder 10`, each holding `file 0001.txt` to `file 1000.txt` with the text "file <number>" (10,000 entries).
2. `measure-ui.mjs`: the step value `06c` becomes `06d`. In the full mode, after Step 06c's measurements, open the archives folder (`join(big, "..", "archives")`) and add (each a loop of `RUNS` runs with `timeUntil`, closing the archive tab with Ctrl+W after each run where the tab was opened):
   - `archive open (10,000 entries)`: double-click the `Big archive.zip` row; done when `.adp-filetab:not([hidden]) .adp-archive [role=option]` exists.
   - `archive folder change`: with the big archive open (opened once before the loop), double-click the `folder 05` row; done when the first row's text contains `file 0001`; between runs click the breadcrumb root.
   - `archive search (10,000 entries)`: type `file 0500` into `.adp-filetab:not([hidden]) .adp-filetab-search input` (insert the text at once); done when the archive list shows exactly 10 rows; between runs clear the search box.
3. Screenshots, after Step 06c's last action: open the archives folder, double-click `Project files.zip`, wait until rows exist and 400 ms more, shot `46-archive-tab`; type `notes` into the file tab's search box, wait 500 ms, shot `47-archive-search`; press Ctrl+W; right-click the `Project files.zip` row, click the menu item whose text is the translated `commands.extract` (a click opens the submenu), wait 300 ms, shot `48-extract-menu`; press Escape twice.

**Commit:** `test(speed): archive open, folder change and search; archive screenshots [step-06d/T11]`

## Help pages

### New page `help/en/archives.md` (exact text)

```markdown
# Opening and extracting archives

Archives are files that hold many files and folders in one, usually compressed: ZIP, 7z, TAR (also .tar.gz and .tar.xz), gzip (.gz) and xz (.xz) files. Adperastra opens them like folders and extracts them safely.

## Look inside an archive

1. Double-click an archive. It opens in its own tab and shows its folders and files.
2. Double-click a folder to open it. Use the path at the top, **Up one level** or **Backspace** to go back.
3. Type in the search box at the top right to find files anywhere in the archive. **Open item location** shows where a found file is.

## Open a file inside

Double-click a file (or select it and press **Enter**). Adperastra copies it out by itself and opens it in a new tab. This copy is read-only: to keep changes, use **Save as** and choose a folder.

## Extract

- **Extract all** (in the archive tab, or on the command bar when an archive is selected): makes a new folder named after the archive, next to it, and puts everything in it.
- Right-click an archive > **Extract** > **Extract here**: puts the contents in the archive's folder.
- Right-click an archive > **Extract** > **Extract to…**: choose a folder; a new folder named after the archive is made inside it.
- In the archive tab, select items and click **Extract selected…**: choose a folder; the selected items go straight into it.

Extracting runs in the background: the File operations panel shows the progress and has **Cancel**. When it finishes, the new items are selected, and **Undo (Ctrl+Z)** sends them to the Recycle Bin.

## Good to know

- Extracting never replaces anything. If a file or folder with the same name is already there, the new one gets a number, like "report (2).txt".
- Items whose names could write outside the folder, or that Windows doesn't allow, are hidden and never extracted. Links inside archives are shown but never extracted.
- An archive that would expand to far more data than it holds (a "zip bomb"), or that doesn't fit on the drive, is refused before anything is written.
- Archives protected with a password, RAR files and bzip2 files can't be opened yet. RAR files open in the app Windows uses for them.
- If the archive came from the internet, the files you extract or open keep that mark, so they open in protected view.
- Archives are read in a separate, limited process, so a damaged archive can't freeze Adperastra.

See also: "Opening files in tabs", "Copying and moving files" and "Undo".
```

### New page `help/es/archives.md` (exact text)

```markdown
# Abrir y extraer archivos comprimidos

Los archivos comprimidos guardan muchos archivos y carpetas en uno solo: archivos ZIP, 7z, TAR (también .tar.gz y .tar.xz), gzip (.gz) y xz (.xz). Adperastra los abre como carpetas y los extrae de forma segura.

## Ver el contenido de un archivo comprimido

1. Haz doble clic en un archivo comprimido. Se abre en su propia pestaña y muestra sus carpetas y archivos.
2. Haz doble clic en una carpeta para abrirla. Usa la ruta de arriba, **Subir un nivel** o **Retroceso** para volver.
3. Escribe en el cuadro de búsqueda de arriba a la derecha para encontrar archivos en cualquier parte del archivo comprimido. **Abrir ubicación del elemento** muestra dónde está un archivo encontrado.

## Abrir un archivo de adentro

Haz doble clic en un archivo (o selecciónalo y presiona **Entrar**). Adperastra lo copia por su cuenta y lo abre en una pestaña nueva. Esa copia es de solo lectura: para conservar los cambios, usa **Guardar como** y elige una carpeta.

## Extraer

- **Extraer todo** (en la pestaña del archivo comprimido, o en la barra de comandos cuando hay uno seleccionado): crea una carpeta nueva con el nombre del archivo comprimido, junto a él, y pone todo adentro.
- Clic con el botón derecho en un archivo comprimido > **Extraer** > **Extraer aquí**: pone el contenido en la carpeta del archivo comprimido.
- Clic con el botón derecho > **Extraer** > **Extraer en…**: elige una carpeta; adentro se crea una carpeta nueva con el nombre del archivo comprimido.
- En la pestaña del archivo comprimido, selecciona elementos y haz clic en **Extraer lo seleccionado…**: elige una carpeta; los elementos seleccionados van directamente a ella.

La extracción se hace en segundo plano: el panel Operaciones de archivo muestra el progreso y tiene **Cancelar**. Al terminar, los elementos nuevos quedan seleccionados y **Deshacer (Ctrl+Z)** los envía a la Papelera de reciclaje.

## Para tener en cuenta

- Extraer nunca reemplaza nada. Si ya hay un archivo o una carpeta con el mismo nombre, el nuevo recibe un número, como «informe (2).txt».
- Los elementos cuyo nombre podría escribir fuera de la carpeta, o que Windows no permite, se ocultan y nunca se extraen. Los vínculos dentro de los archivos comprimidos se muestran, pero nunca se extraen.
- Un archivo comprimido que ocuparía muchísimo más espacio que su tamaño (una «bomba zip»), o que no cabe en la unidad, se rechaza antes de escribir nada.
- Todavía no se pueden abrir los archivos comprimidos protegidos con contraseña, los archivos RAR ni los bzip2. Los archivos RAR se abren en la aplicación que Windows usa para ellos.
- Si el archivo comprimido vino de Internet, los archivos que extraigas o abras conservan esa marca y se abren en vista protegida.
- Los archivos comprimidos se leen en un proceso aparte y limitado, así que uno dañado no puede bloquear Adperastra.

Consulta también: «Abrir archivos en pestañas», «Copiar y mover archivos» y «Deshacer».
```

Check the Spanish name of the jobs panel against `jobs.title` in `es.json` and the Spanish shortcut word for Enter against `keys.enter`; if they differ from the text above, use the translation file's words in the page (they are what the app shows).

## Check by hand

Test files (the agent creates them in `%TEMP%\adperastra-check-06d`; Windows' own `tar.exe` makes every format with `-a` and the file extension):

| File | Content |
|---|---|
| `src\` | a folder with `README.txt` ("Hello from the archive"), `docs\plan.md` ("# Plan"), `docs\old\notes.txt` ("Old notes"), `images\` (empty folder) |
| `sample.zip`, `sample.7z`, `sample.tar`, `sample.tar.gz`, `sample.tar.xz` | the `src` folder's contents, made with `tar.exe -a` (bsdtar writes `./` names, which the app must hide silently) |
| `notes.txt.gz` | `README.txt` alone, gzipped |
| `downloaded.zip` | a copy of `sample.zip` with a `Zone.Identifier` stream "[ZoneTransfer]" / "ZoneId=3" |
| `bomb.zip` | a 1,500,000,000-byte file of zeros (made by setting the length of a new file, as `measure-ui.ps1` does for the demo files), zipped with `tar.exe -a` (the zip is about 1.5 MB), then the zeros file removed |
| `fake.zip` | the text "this is not an archive" |
| `big.zip` | `Big archive.zip` from `%TEMP%\adperastra-corpus\archives` |

1. Double-click `sample.zip`: a tab opens with `docs`, `images` and `README.txt` (no `.` entry, no "hidden" note). Open `docs`, then `old`; the path bar shows `sample.zip › docs › old`; Backspace goes up.
2. Double-click `README.txt` inside: it opens in a new tab, read-only (the editor says so). Close it.
3. Type `notes` in the search box: `notes.txt` is listed with the note "Matches in the whole archive"; **Open item location** shows `docs\old` with it selected.
4. Repeat steps 1 and 2 with `sample.7z`, `sample.tar`, `sample.tar.gz`, `sample.tar.xz` and `notes.txt.gz`. The status bar names the format.
5. **Extract all** in the `sample.zip` tab: the Explorer shows `%TEMP%\adperastra-check-06d` with the new folder `sample` selected; its contents match `src`. Click **Extract all** again: `sample (2)` appears; nothing in `sample` changed.
6. Ctrl+Z: `sample (2)` goes to the Recycle Bin; Ctrl+Y brings it back.
7. In the Explorer, right-click `sample.tar.gz` > **Extract** > **Extract here**: `README.txt`, `docs`, `images` appear (with numbers if they already exist). Right-click `sample.7z` > **Extract** > **Extract to…** > choose a folder: a `sample` folder appears inside it and the Explorer goes there.
8. Select `sample.zip` and `sample.7z` together > **Extract all** (command bar): two folders; one Ctrl+Z removes both.
9. Open `big.zip`: rows appear within about a second. **Extract all**, then click **Cancel** in the File operations panel within two seconds: "Cancelled"; the partly made folder has no file whose name starts with `~`; Ctrl+Z removes it.
10. Open `bomb.zip`: it lists one file of about 1.4 GB. **Extract all**: the message about expanding to far more data appears; nothing was written.
11. Open `fake.zip`: the "can't be opened here" message with **Open in Windows app**.
12. Open `downloaded.zip`, open `README.txt` inside: the tab shows the protected-view bar. Extract it: the extracted `README.txt` also opens in protected view.
13. Task Manager while opening `big.zip`: a second `Adperastra.exe` appears briefly and goes away.
14. Repeat steps 1, 5 and 7 in Spanish and in the dark theme; check the ribbon key tips (Alt), and that every control works with the keyboard alone (Tab, arrows, Enter, Backspace, Shift+F10 for the menu).
15. Settings > Opening files: the "Archive" group lists `7z, gz, tar, tgz, txz, xz, zip`; choosing the Windows app for it opens `.zip` files in Windows again.

## Speed

| Interaction | Tier | Measurement |
|---|---|---|
| Open a 10,000-entry zip (first rows) | Fast (1 s) | `archive open (10,000 entries)` |
| Open a folder inside an archive | Instant (0.1 s) | `archive folder change` |
| Search 10,000 entries | Instant (0.1 s) | `archive search (10,000 entries)` |
| Opening a file inside (small file) | Fast (1 s) | checked by hand (step 2) |
| Extracting | Background job | checked by hand (steps 5 and 9) |

Extraction of tar.gz and tar.xz reads the archive twice (once to plan, once to write); log it in `KNOWN_ISSUES.md` as Minor if extracting the 10,000-entry archive as tar.gz takes more than twice as long as the zip.

## Screenshots

`46-archive-tab`, `47-archive-search`, `48-extract-menu` (added in T11).

## Done when

- [ ] Zip, 7z, tar, tar.gz, tar.xz, gz and xz archives open in a tab, with folders, search and the path bar; files inside open in new read-only tabs.
- [ ] Extract all, Extract here, Extract to… and Extract selected… work, never overwrite, show progress with Cancel, and can be undone and redone.
- [ ] Unsafe names, links and protected items are never extracted; the zip bomb and a full disk are refused before writing; a damaged archive shows a message.
- [ ] All archive parsing runs in the helper process; a cancelled or killed job leaves no partial file.
- [ ] Extracted and opened files keep the internet mark.
- [ ] The help page `archives` exists in English and Spanish; every new text is translated.
- [ ] The gate passes after every task; the three speed measurements are within their tiers (or logged); screenshots 46 to 48 are taken.
- [ ] `KNOWN_ISSUES.md` lists, as Minor placeholders until Step 06e: protected archives, RAR and bzip2.
