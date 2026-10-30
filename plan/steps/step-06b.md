# Step 06b: Version history

| | |
|---|---|
| State | guide |
| Difficulty | ★★★ |
| Branch | `step-06b-version-history` |
| Tag | `v0.0.15-step06b` |
| Depends on | 06a |
| Written before | P2 was built (written from the 04a to 04c recipes and the 05a to 06a guides; names from earlier guides are in `plan/guide-ledger.md`) |

This is a **guide** step (AGENTS.md "Steps come in two kinds"): every decision is below, but no code. Write the code exactly as described: the names, files, types, numbers and texts given here, and nothing else. If something you must write is not decided here, stop with `BLOCKED.md` (AGENTS.md section 5).

## Goal

Every time the app is about to change a file (today: saving in the text and Markdown editors; later the converter, the privacy cleaner and AI features), it first keeps the old content in a local version store. Saving never waits for it: the old content is copied aside and stored compressed (identical content only once) in the background. A Version history window, opened from the right-click menu, the Details pane or the editor's ribbon, lists the versions of a file, shows what changed (for text files), opens any version, saves it as a copy, or restores it (and the restore can be undone). Settings > Version history turns it on or off and limits how long and how much is kept; Windows' own "Previous versions" stay one click away.

## Do not do in this step

- No versions for changes made by other programs; only the app's own changes (the version hook). No versions of folders.
- No side-by-side comparison of images, PDFs or documents (their viewers add it in Steps 07d, 13 and 14); for them the window offers Open and Save a copy.
- No App storage page (Step 12a reads `versions_store_size`). No cloud copies.
- The converter, the privacy cleaner and AI features call the same hook when they are built (Steps 08a, 08c, 17b); no new callers here besides restore.
- No reading of Windows' shadow copies: the "Previous versions from Windows…" button opens the file's Windows Properties (which has that tab).

## Read first

- `plan/conventions.md`, `plan/pitfalls.md` (P-07, P-08, P-10, P-19, P-20, P-22, P-25, P-28), `plan/rules.md` R-SAFE (all), R-BG, R-SEC-1, R-SEC-8, `plan/recipes/add-dependency.md`, `plan/recipes/add-settings-field.md`, `plan/recipes/add-tauri-command.md`, `plan/recipes/add-help-page.md`, `plan/libraries.md` (rusqlite, blake3, zstd).
- Code: `src-tauri/src/versions.rs` and `src-tauri/src/text_save.rs` (Step 06a), `src-tauri/src/file_dialogs.rs`, `crates/fs-service/src/save.rs`, `src-tauri/src/main.rs` (settings part, `AppState`, the `setup` closure, `generate_handler!`), `src/services/undo.ts`, `src/services/fileops.ts` (`executeFileAction`), `src/commands/explorerCommands.ts`, `src/commands/menus.ts` (`ITEM_MENU`), `src/views/explorer/DetailsPane.tsx`, `src/views/ExplorerHome.tsx` (the actions object, `notifyAction`, the dialogs at the end of the markup), `src/editor/useTextDocument.ts`, `src/handlers/text/TextView.tsx`, `src/handlers/markdown/MarkdownView.tsx`, `src/views/settings/sections.ts`, `src/services/files.ts` (`fileGrant`, `fileUrl`, `fileRevoke`), `src/handlers/text/encoding.ts`.

## Decisions (already made)

- D1. A new crate `crates/version-store` (contract 19) holds the store; it uses rusqlite 0.41 (feature `bundled`, MIT, needs Rust 1.89), blake3 1.8 (CC0-1.0 OR Apache-2.0) and zstd 0.14 (BSD-3-Clause), all checked on docs.rs at these versions. The store lives in `<data>/versions/`: `index.sqlite3`, `blobs/<first two hex digits>/<hash>.zst`, `pending/` (copies waiting to be stored) and `open/` (versions extracted to look at).
- D2. **Snapshot without waiting**: `versions::before_modify` copies the current file into `pending/` (a plain copy plus a small JSON sidecar) and wakes a background worker; it does not hash or compress. A missing file or a folder is skipped; a file over 256 MiB is skipped (its change goes on; a line in the history window says large files are not kept). If the copy fails, the change stops (`<area>.version_failed`): the old content is never lost silently.
- D3. **Background worker** (one thread, below-normal priority, R-BG-1): for each pending copy, hash it (BLAKE3 of the original bytes), store it compressed (zstd level 3) unless that hash is already stored, add a version row, delete the pending files; then trim to the limits. It also runs once at start (copies left by a crash are stored then). Background work never touches user files (R-SAFE-7).
- D4. **Deduplication**: identical content is stored once (a reference count per blob); a snapshot equal to the file's newest version adds no row.
- D5. **Limits** (settings schema 10, section `versions`): `enabled` (on), `keep_days` (30; 7, 30, 90 or 365), `max_mb` (1024; 256, 512, 1024, 2048 or 5120). Trimming deletes versions older than `keep_days`, then the oldest versions overall until the stored size is within `max_mb`. Turning versions off stops new snapshots and keeps the existing ones.
- D6. **Looking at a version**: Rust extracts it to `open/<id>-<file name>` with the Read-only attribute; the UI reads it through the existing file access (`fileGrant`, `fileUrl`) and decodes text with Step 04b's encoding detection, so no file bytes travel as JSON (P-10). Text-like files up to 1 MiB show **Changes** (a line diff with the current file) and **This version**; other files offer **Open** (the read-only copy in a tab; the editor treats it as read-only, Step 06a D1).
- D7. **Restore**: the current content is snapshotted first (reason `restore`), then the version's content replaces the file through `fs_service::replace_contents` (partial file, then replace). Rust returns the id of that snapshot, so the restore is undoable: in the Explorer through a new undo action `restoreVersion` (contract 11) with a toast; in an editor tab, through an Undo button in the window, after which the editor reloads the file.
- D8. **Save a copy**: the Windows save dialog (shared helpers of Step 06a); an existing chosen file goes to the Recycle Bin first (R-SAFE-2); then the version is written as a new file (partial file, then rename).
- D9. **Entry points**: the Explorer command **Version history…** (right-click menu of one file, after Properties; also the Details pane), and the text and Markdown ribbons' File group. The window is a dialog over the place it was opened from.
- D10. **Line diff**: our own Myers diff on lines in TypeScript (no library), stopped after 4,000 changed lines ("too many changes to show"); unchanged runs collapse to 3 lines of context around each change.
- D11. Settings > **Version history** (new section, after Opening files): the switch, the two limits, the store's current size, and **Delete all versions…** (asks first and says it cannot be undone; it deletes only the app's stored copies, never a user file).

## Data shapes

### Store files (`<data>/versions/`)

`index.sqlite3` (WAL journal mode, busy timeout 5 s), schema version 1 in table `meta`:

| Table | Columns |
|---|---|
| `meta` | `key TEXT PRIMARY KEY`, `value TEXT NOT NULL` (row `schema_version` = `1`) |
| `files` | `id INTEGER PRIMARY KEY`, `path_key TEXT NOT NULL UNIQUE` (lower-case display path), `path TEXT NOT NULL` (display path as last seen) |
| `blobs` | `hash TEXT PRIMARY KEY` (64 hex digits), `stored_size INTEGER NOT NULL` (compressed bytes), `refs INTEGER NOT NULL` |
| `versions` | `id INTEGER PRIMARY KEY`, `file_id INTEGER NOT NULL`, `created_unix INTEGER NOT NULL`, `reason TEXT NOT NULL`, `size INTEGER NOT NULL` (original bytes), `hash TEXT NOT NULL`, `file_modified_unix INTEGER NOT NULL`; index `versions_by_file` on (`file_id`, `created_unix`) |

`pending/<name>.raw` (the copy) and `pending/<name>.json` (sidecar: `path`, `reason`, `created_unix`, `file_modified_unix`), where `<name>` = the snapshot time in nanoseconds since 1970 (decimal) + `-` + a process-wide counter. The sidecar is written first (crash-safe), the copy second; the importer ignores a sidecar without its copy for 60 s and then deletes it.

### `version-store` crate API (`crates/version-store/src/lib.rs`, re-exported)

| Item | Kind | Behavior |
|---|---|---|
| `MAX_SNAPSHOT_BYTES` | `u64` | 268,435,456 |
| `STORE_SCHEMA` | `u32` | 1 |
| `StoreError` | enum (`Debug`, `PartialEq`, `Eq`) | `Sql(String)`, `Io(String)`, `NotFound`, `TooLarge` |
| `VersionInfo` | struct (`Debug`, `Clone`, `PartialEq`, `Eq`, `Serialize`, `Deserialize`) | `id: i64`, `created_unix: u64`, `reason: String`, `size: u64`, `file_modified_unix: u64` |
| `path_key` | fn (`path: &str`) returns `String` | the display path (no `\\?\`), trailing backslashes removed, lower case |
| `snapshot_to_pending` | fn (`dir: &Path`, `path: &Path`, `reason: &str`, `now_unix: u64`) returns `Result<bool, StoreError>` | false (nothing done) when `path` is missing or not a regular file; `TooLarge` when it is over `MAX_SNAPSHOT_BYTES`; otherwise write the sidecar (with `crate`'s own atomic write: partial then rename) and then copy the file to the `.raw` name (`std::fs::copy`), and return true. A failed copy removes both pending files and gives `Io` |
| `VersionStore::open` | (`dir: &Path`) returns `Result<VersionStore, StoreError>` | create `dir`, `blobs`, `pending`, `open`; open `index.sqlite3` (`Connection::open`), set `journal_mode` to WAL (`pragma_update`), create the tables and the index when missing (`execute_batch`), insert `schema_version` when missing |
| `VersionStore::import_pending` | (`&mut self`, `now_unix`) returns `Result<usize, StoreError>` | for each `.json` sidecar in `pending/` (oldest name first) whose `.raw` exists: hash the copy (a `blake3::Hasher` fed with `std::io::copy`; the hex text is `finalize().to_string()`); when `blobs` has no row for the hash: compress the copy with `zstd::stream::copy_encode` (level 3) into `blobs/<aa>/<hash>.zst.partial`, rename it to `.zst`, insert the blob with `refs` 0; in one transaction: find or insert the `files` row (update its `path`), and unless the file's newest version has the same hash, insert the version and add 1 to the blob's `refs`; then delete both pending files. A sidecar without a copy older than 60 s is deleted. Returns how many versions were added |
| `VersionStore::list` | (`&self`, `path: &str`) returns `Result<Vec<VersionInfo>, StoreError>` | the file's versions, newest first (none for an unknown file) |
| `VersionStore::extract` | (`&self`, `id: i64`, `dest: &Path`) returns `Result<(), StoreError>` | `NotFound` for an unknown id; decompress the blob with `zstd::stream::copy_decode` into `dest` + `.partial`, then rename to `dest` |
| `VersionStore::read_bytes` | (`&self`, `id`) returns `Result<Vec<u8>, StoreError>` | `zstd::decode_all` of the blob |
| `VersionStore::trim` | (`&mut self`, `keep_days: u32`, `max_bytes: u64`, `now_unix: u64`) returns `Result<usize, StoreError>` | delete versions with `created_unix` < `now_unix - keep_days × 86,400`; then, while the sum of `stored_size` of blobs with `refs` > 0 is above `max_bytes`, delete the oldest version overall; each deleted version lowers its blob's `refs`; blobs at 0 are deleted with their `.zst` file; returns how many versions were deleted |
| `VersionStore::delete_all` | (`&mut self`) | delete every row of `versions`, `blobs` and `files`, and every file under `blobs/` and `open/` |
| `VersionStore::stored_bytes` | (`&self`) returns `Result<u64, StoreError>` | the sum of `stored_size` of all blobs |

Use the APIs exactly as verified for these versions: `Connection::open`, `execute`, `execute_batch`, `query_row` (with `OptionalExtension::optional`), `prepare` + `Statement::query_map` (the statement is `mut`), `transaction` (needs `&mut`), `pragma_update`, `params!`; `blake3::Hasher` implements `std::io::Write`; `Hash::to_hex` returns a fixed-size string, so use `to_string()`; `zstd::stream::copy_encode(source, destination, level)` and `copy_decode(source, destination)`.

### Settings (schema 10): new section `versions`

| Field | Rust | TypeScript | Default | Allowed | Rust `validate()` |
|---|---|---|---|---|---|
| `enabled` | `bool` | `boolean` | `true` | | |
| `keep_days` | `u32` | `KeepDays` | 30 | 7, 30, 90, 365 | must be one of them |
| `max_mb` | `u32` | `MaxVersionsMb` | 1024 | 256, 512, 1024, 2048, 5120 | must be one of them |

TypeScript: `VersionSettings` (`enabled`, `keep_days`, `max_mb`), `KEEP_DAYS` and `MAX_VERSIONS_MB` arrays; normalization: a boolean else true; a listed number else the default. Rust: `VersionSettings`, `KEEP_DAYS`, `MAX_VERSIONS_MB`.

### Tauri commands (`src-tauri/src/versions.rs`)

| Command | Arguments | Returns | Errors |
|---|---|---|---|
| `versions_list` | `path: String` | `VersionList`: `versions` (`Vec<VersionInfo>`), `too_large` (bool: the current file is over 256 MiB) | `versions.bad_request`, `versions.other` |
| `versions_extract` | `id: i64`, `file_name: String` | `String`: the extracted copy's path | `versions.bad_request`, `versions.not_found`, `versions.other` |
| `versions_restore` | `path: String`, `id: i64` | `RestoreResult`: `previous_id` (`Option<i64>`: the snapshot of the content before restoring), `saved` (`SavedFile`) | `versions.bad_request`, `versions.not_found`, `versions.snapshot_failed`, `versions.read_only`, `versions.in_use`, `versions.other` |
| `versions_save_copy` | `id: i64`, `title`, `file_name`, `filter_name` (strings) | `Option<String>`: the written path, none when cancelled | `versions.bad_request`, `versions.not_found`, `versions.recycle_failed`, `versions.other` |
| `versions_delete_all` | none | nothing | `versions.other` |
| `versions_store_size` | none | `u64` | `versions.other` |

`before_modify` (changed): `before_modify(app: &tauri::AppHandle, path: &Path, reason: ModifyReason) -> Result<(), String>`; `ModifyReason` gains `Restore`; reasons are stored as `save`, `saveAs`, `restore`. Errors: `versions.snapshot_failed`.

### Undo action (contract 11)

`FileAction` gains `{ type: "restoreVersion"; path: string; versionId: number }`; `executeFileAction` runs it with `versionsRestore(path, versionId)`.

### Commands

| Command id | Label key | Icon | Shortcut | Enabled / visible |
|---|---|---|---|---|
| `explorer.versionHistory` | `commands.versionHistory` | `History` | none | enabled when exactly one file is selected (not a folder) |
| `text.versionHistory`, `markdown.versionHistory` | `commands.versionHistory` | `History` | none | enabled when not in parts mode |

Help slug `version-history` for all three.

### Translation keys (all new keys of this step)

| Key | English | Spanish |
|---|---|---|
| `commands.versionHistory` | Version history… | Historial de versiones… |
| `versions.title` | Version history of {name} | Historial de versiones de {name} |
| `versions.current` | Current file | Archivo actual |
| `versions.reason.save` | Saved in Adperastra | Guardado en Adperastra |
| `versions.reason.saveAs` | Replaced with Save as | Reemplazado con Guardar como |
| `versions.reason.restore` | Before restoring a version | Antes de restaurar una versión |
| `versions.reason.other` | Changed by Adperastra | Cambiado por Adperastra |
| `versions.empty` | No versions yet. A version is kept each time Adperastra changes this file. | Todavía no hay versiones. Se conserva una versión cada vez que Adperastra cambia este archivo. |
| `versions.tooLarge` | Files over 256 MB don't get versions. | Los archivos de más de 256 MB no tienen versiones. |
| `versions.off` | Version history is off. Existing versions are kept. | El historial de versiones está desactivado. Las versiones existentes se conservan. |
| `versions.changes` | Changes | Cambios |
| `versions.thisVersion` | This version | Esta versión |
| `versions.noChanges` | This version is the same as the current file. | Esta versión es igual al archivo actual. |
| `versions.tooManyChanges` | There are too many changes to show. Open the version to look at it. | Hay demasiados cambios para mostrarlos. Abre la versión para verla. |
| `versions.noPreview` | This kind of file can't be shown here. Open it to look at it. | Este tipo de archivo no se puede mostrar aquí. Ábrelo para verlo. |
| `versions.unchanged` | {count, plural, one {# unchanged line} other {# unchanged lines}} | {count, plural, one {# línea sin cambios} other {# líneas sin cambios}} |
| `versions.open` | Open | Abrir |
| `versions.saveCopy` | Save a copy… | Guardar una copia… |
| `versions.saveCopyTitle` | Save a copy of this version | Guardar una copia de esta versión |
| `versions.restore` | Restore this version | Restaurar esta versión |
| `versions.restoreTitle` | Restore this version? | ¿Restaurar esta versión? |
| `versions.restoreBody` | The file goes back to the version from {date}. Its current content is kept in the history, so you can undo this. | El archivo vuelve a la versión del {date}. Su contenido actual se conserva en el historial, así que puedes deshacerlo. |
| `versions.restoreUnsaved` | Your unsaved changes in this tab will be lost. | Se perderán los cambios sin guardar de esta pestaña. |
| `versions.restored` | Restored the version from {date}. | Se restauró la versión del {date}. |
| `versions.windowsVersions` | Previous versions from Windows… | Versiones anteriores de Windows… |
| `versions.allFiles` | All files | Todos los archivos |
| `toast.versionRestored` | Restored a version of {name} | Se restauró una versión de {name} |
| `settings.versions` | Version history | Historial de versiones |
| `settings.versionsEnabled` | Keep versions of files that Adperastra changes | Conservar versiones de los archivos que cambia Adperastra |
| `settings.versionsKeep` | Keep versions for | Conservar versiones durante |
| `settings.versionsDays` | {count, plural, one {# day} other {# days}} | {count, plural, one {# día} other {# días}} |
| `settings.versionsMax` | Space for versions | Espacio para versiones |
| `settings.versionsUsed` | Versions use {size} now. | Las versiones ocupan {size} ahora. |
| `settings.versionsDeleteAll` | Delete all versions… | Eliminar todas las versiones… |
| `settings.versionsDeleteTitle` | Delete all versions? | ¿Eliminar todas las versiones? |
| `settings.versionsDeleteBody` | Every kept version of every file is deleted. This can't be undone. Your files themselves are not changed. | Se eliminan todas las versiones conservadas de todos los archivos. Esto no se puede deshacer. Tus archivos no cambian. |
| `settings.versionsDeleteConfirm` | Delete all versions | Eliminar todas las versiones |
| `settings.versionsDeleted` | All versions were deleted. | Se eliminaron todas las versiones. |
| `errors.versions.other` | Something went wrong with the version history. Try again. | Algo salió mal con el historial de versiones. Vuelve a intentarlo. |
| `errors.versions.bad_request` | That version can't be used. | Esa versión no se puede usar. |
| `errors.versions.not_found` | That version no longer exists. | Esa versión ya no existe. |
| `errors.versions.snapshot_failed` | Couldn't keep the current content first, so nothing was changed. | No se pudo conservar primero el contenido actual, así que no se cambió nada. |
| `errors.versions.read_only` | The file is read-only, so it can't be restored. Save a copy instead. | El archivo es de solo lectura, así que no se puede restaurar. Guarda una copia en su lugar. |
| `errors.versions.in_use` | Another program is using the file. Close it there and try again. | Otro programa está usando el archivo. Ciérralo allí y vuelve a intentarlo. |
| `errors.versions.recycle_failed` | The file you chose couldn't be moved to the Recycle Bin, so nothing was saved. | No se pudo mover a la Papelera de reciclaje el archivo que elegiste, así que no se guardó nada. |
| `errors.textSave.version_failed` | Couldn't keep the previous version, so the file wasn't saved. Free some space, or turn off version history in Settings. | No se pudo conservar la versión anterior, así que el archivo no se guardó. Libera espacio o desactiva el historial de versiones en Configuración. |

The "Space for versions" options show `formatSize(max_mb × 1,048,576)` (for example "1 GB"; `formatSize` already gives locale-aware numbers). After editing `en.json`, run `npm run i18n:pseudo`.

## Tasks

After changing Rust code, run `cargo fmt --all` before the gate.

### T1 - The version-store crate and its libraries

**Files:** create `crates/version-store/Cargo.toml`, `crates/version-store/src/lib.rs` (a module doc comment only: "Local version store (contract 19, Step 06b)."); modify the workspace `Cargo.toml` (`members` gets `crates/version-store`), `THIRD_PARTY_LICENSES.md`, `docs/dependency-and-license-table.md`.

**Do this:** follow `plan/recipes/add-dependency.md` (Rust part). First run `rustc --version`: it must print 1.89 or newer (rusqlite 0.41 needs it; `plan/libraries.md` asks for 1.93 or newer before this step: run `rustup update stable` if it is older). The crate's `[package]`: name `version-store`, edition and license from the workspace. `[dependencies]`: `rusqlite = { version = "0.41", features = ["bundled"] }`, `blake3 = "1.8"`, `zstd = "0.14"`, `serde` (with `derive`) and `serde_json` as the other crates use them; `[dev-dependencies]`: `tempfile = "3"`; `[target.'cfg(windows)'.dependencies]`: none. `src-tauri/Cargo.toml` gets `version-store = { path = "../crates/version-store" }` in this same commit.

Records: `THIRD_PARTY_LICENSES.md`: "**rusqlite** 0.41 (MIT) with the bundled SQLite (public domain) - the index of kept file versions (Step 06b).", "**blake3** 1.8 (CC0-1.0 OR Apache-2.0) - recognizes identical versions so they are stored once (Step 06b).", "**zstd** 0.14 (BSD-3-Clause) - compresses kept versions (Step 06b)."; `docs/dependency-and-license-table.md`: one row per library for the version history area.

**Tests:** none (the gate builds the empty crate).

**Commit:** `deps: add rusqlite 0.41 (MIT), blake3 1.8 (CC0-1.0 OR Apache-2.0), zstd 0.14 (BSD-3-Clause) [step-06b/T1]`

### T2 - Snapshots, import and reading

**Files:** create `crates/version-store/src/store.rs`, `crates/version-store/src/pending.rs`, `crates/version-store/tests/step06b_store_tests.rs`; modify `crates/version-store/src/lib.rs`.

**Do this:** implement the API table except `trim`, `delete_all` and `stored_bytes` (T3): `pending.rs` holds `snapshot_to_pending`, the sidecar struct `PendingSidecar` (`path`, `reason`, `created_unix`, `file_modified_unix`; serde) and the private atomic write (temporary name `<name>.tmp` in the same folder, `sync_all`, rename); `store.rs` holds `VersionStore` (one `rusqlite::Connection`), `open`, `import_pending`, `list`, `extract`, `read_bytes`; `lib.rs` declares both modules, `path_key`, the constants, `StoreError` (with `From` conversions from `rusqlite::Error` and `std::io::Error` into `Sql` and `Io` with the error's text) and `VersionInfo`, and re-exports. `file_modified_unix` comes from the file's metadata at snapshot time (seconds since 1970, 0 when unknown).

**Tests** (`tempfile::tempdir()` for the store and for user files):

| Test | Steps | Expected |
|---|---|---|
| `snapshot_then_import_lists_one_version` | write `a.txt` "one"; `snapshot_to_pending(dir, a, "save", 100)`; open; `import_pending(200)`; `list(a)` | true; 1 added; one version with reason `save`, size 3, created 100; `pending/` is empty |
| `extract_gives_back_the_same_bytes` | after the above, `extract(id, out.txt)` and `read_bytes(id)` | `out.txt` reads "one"; the bytes are "one"; no `.partial` left |
| `identical_content_is_stored_once` | snapshot "one" for `a.txt` and for `b.txt`; import | two versions (one per file); one file under `blobs/` |
| `an_unchanged_snapshot_adds_no_version` | snapshot `a.txt` twice with the same content (times 100 and 101); import | one version |
| `missing_files_and_folders_are_skipped` | snapshot a missing path; a folder | false; false; nothing in `pending/` |
| `too_large_files_are_refused` | a sparse file of `MAX_SNAPSHOT_BYTES + 1` bytes (set its length) | `TooLarge`; nothing in `pending/` |
| `path_key_ignores_case_and_prefix` | `C:\A\B.txt`, `\\?\c:\a\b.TXT`, `C:\A\` | the first two equal `c:\a\b.txt`; the third is `c:\a` |
| `a_lonely_sidecar_is_cleaned_after_a_minute` | write only a sidecar in `pending/` with a modified time 61 s ago (set it); import | 0 added; the sidecar is gone |
| `versions_are_listed_newest_first` | three snapshots with different contents at 100, 200, 300 | list order 300, 200, 100 |

**Commit:** `feat(versions): version store with snapshots, deduplication and extract [step-06b/T2]`

### T3 - Limits

**Files:** modify `crates/version-store/src/store.rs`; create `crates/version-store/tests/step06b_limits_tests.rs`.

**Do this:** implement `trim`, `delete_all` and `stored_bytes` as the API table says (one transaction per trim; blob files are removed after the transaction commits).

**Tests:**

| Test | Steps | Expected |
|---|---|---|
| `trim_removes_versions_older_than_the_limit` | versions at days 1, 10 and 40 before `now` (created = now - days × 86,400); `trim(30, u64::MAX, now)` | 1 deleted (the 40-day one); two left |
| `trim_keeps_the_size_within_the_limit` | three versions with different 100-byte contents (stored sizes s1, s2, s3); `trim(365, s2 + s3, now)` | the oldest deleted; `stored_bytes` ≤ s2 + s3 |
| `shared_content_stays_until_its_last_version_goes` | `a.txt` and `b.txt` with the same content (one blob); delete `a`'s version by trimming with `a` older | the blob and its file remain for `b` |
| `delete_all_empties_the_store` | some versions and an extracted file in `open/` | no versions; `stored_bytes` 0; `blobs/` and `open/` hold no files |

**Commit:** `feat(versions): keep the store within its time and size limits [step-06b/T3]`

### T4 - Settings: version history (schema 10)

**Files:** modify `src-tauri/src/main.rs`, `src/services/settings.ts`, `src/__tests__/settings.test.ts`, `scripts/measure-ui.ps1`, and any test file building `AppSettings` literally.

This is `plan/recipes/add-settings-field.md` with N = 10 and a new section `versions` (Data shapes), added to `Settings` after `appearance`, to `impl Default for Settings` and to `migrate_v1`. `migrate`: the arm "4 to 8" also takes 9. Tests: `settings_defaults` expects 10; `settings_v8_migrates_to_v9_keeping_language_and_theme` expects `CURRENT_SCHEMA`; new `settings_v9_migrates_to_v10_keeping_language_and_theme` (schema 9 with language `es`, theme mode `dark`, `appearance.density` `compact`: after `migrate` schema 10, those kept, `versions` equal to its default) and `settings_validate_rejects_bad_versions` (`keep_days` 14 and `max_mb` 100 fail; `keep_days` 365 and `max_mb` 5120 pass). TypeScript: schema 10; the "keeps valid Explorer view options and repairs invalid ones" test expects schema 10 and the `versions` section; new test "normalizes the version settings (schema 10)": `{}` gives the defaults; `enabled` false is kept, `"no"` gives true; `keep_days` 90 kept, 14 gives 30; `max_mb` 256 kept, 3000 gives 1024. `measure-ui.ps1`: schema 10 and a `versions` part with the defaults (P-32).

**Commit:** `feat(settings): version history settings (schema 10) [step-06b/T4]`

### T5 - The version hook, the worker and the commands

**Files:** modify `src-tauri/src/versions.rs`, `src-tauri/src/text_save.rs`, `src-tauri/src/main.rs`, `src-tauri/isolation/index.html`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`); create `src/services/versions.ts`, `src/__tests__/versionsService.test.ts`.

**Translation keys:** every `errors.versions.*` key and `errors.textSave.version_failed`.

**Do this (Rust, `versions.rs`):** update the module doc comment ("Version hook and version history (contract 19, Steps 06a and 06b).").
1. `ModifyReason` gains `Restore`; a private function `reason_text` gives `save`, `saveAs`, `restore`.
2. A public managed struct `VersionWorker` holding a `Mutex<Option<std::sync::mpsc::Sender<()>>>`, with `start(app: tauri::AppHandle)`: spawns one thread that first lowers its own priority to below normal (Windows `SetThreadPriority` with `THREAD_PRIORITY_BELOW_NORMAL`, `// SAFETY:` comment; the `windows` feature `Win32_System_Threading` is already on), then loops: open the store at `<data>/versions`, `import_pending(unix_now)`, `trim` with the current settings' `keep_days` and `max_mb` (read from `AppState`, lock released before working), drop the store, then wait for the next message (exits when the channel closes). Errors are ignored (the next run retries). `notify(&self)` sends one message when the sender exists. `start` is called from the `setup` closure; the managed `VersionWorker` is registered with `.manage` next to the other managed states.
3. `before_modify(app, path, reason)`: when `versions.enabled` is off in the settings, `Ok(())`; otherwise `version_store::snapshot_to_pending(<data>/versions, path, reason_text(reason), unix_now())`: `Ok(_)` and `Err(TooLarge)` give `Ok(())` (after `notify` when a copy was made), other errors give `versions.snapshot_failed`.
4. Pure `check_id(id: i64) -> Result<(), String>`: above 0, else `versions.bad_request`.
5. Commands (async, `ensure_main`, arguments checked first, work in `spawn_blocking`, each opens its own `VersionStore`, which first imports pending copies so the list is complete):
   - `versions_list(path)`: `validate_absolute_path`; returns the list and `too_large` (the file's size over `MAX_SNAPSHOT_BYTES`).
   - `versions_extract(id, file_name)`: `check_id`; the file name at most 255 characters and passing `fs_service::validate_new_name`; destination `<data>/versions/open/<id>-<file_name>`; when it already exists, return it as is; otherwise `extract`, then set the Read-only attribute on it; return its path.
   - `versions_restore(path, id)`: `validate_absolute_path`, `check_id`; read the version's bytes (`NotFound` gives `versions.not_found`); `before_modify(app, path, Restore)` (an error stops); import pending at once so the snapshot has an id: `previous_id` = the newest version id of the file after the import when its reason is `restore`, else `None`; `fs_service::replace_contents(path, bytes, None)` (errors: `ReadOnly` gives `versions.read_only`, `InUse` gives `versions.in_use`, others `versions.other`); return `RestoreResult`.
   - `versions_save_copy(id, title, file_name, filter_name)`: `check_id`; dialog texts checked with `crate::text_save::check_dialog_texts` (make that function `pub(crate)` if it is private; its error codes stay `textSave.bad_request`, so map them to `versions.bad_request`); owner window handle taken before spawning; `file_dialogs::pick_save_path` (pattern `*.*`, default extension from the file name); `None` returns `Ok(None)`; read the bytes; `fs_service::recycle_target` (`versions.recycle_failed`, nothing written); `fs_service::write_new_file`; return the path without `\\?\`.
   - `versions_delete_all()` and `versions_store_size()`.
6. Register the six commands and add them to `ALLOWED`.

**Do this (`text_save.rs`):** the call becomes `crate::versions::before_modify(&app, path, reason)` (take the app handle from the window before spawning), and any error from it becomes `textSave.version_failed`.

**Do this (TypeScript, `src/services/versions.ts`):** interfaces `VersionInfo`, `VersionList`, `RestoreResult` (snake_case; `RestoreResult.saved` is Step 06a's `SavedFile`) and functions `versionsList(path)`, `versionsExtract(id, fileName)`, `versionsRestore(path, id)`, `versionsSaveCopy(id, title, fileName, filterName)`, `versionsDeleteAll()`, `versionsStoreSize()`; outside Tauri: an empty list (`too_large` false), `null` for save copy, 0 for the size; the others reject with `versions.other`.

**Tests:**
- Rust (bottom of `versions.rs`): `check_id_refuses_zero_and_negative` (1 ok; 0 and -5 give `versions.bad_request`); `reasons_have_stable_names` (`Save`, `SaveAs`, `Restore` give `save`, `saveAs`, `restore`).
- `src/__tests__/versionsService.test.ts`: "outside the app the history is empty": `versionsList` resolves `{ versions: [], too_large: false }`; `versionsStoreSize` resolves 0; `versionsSaveCopy` resolves `null`.

**Traps:**
- `before_modify` must stay fast: no hashing or compressing in it, only the copy.
- Never hold the settings lock while copying or importing (P-20).
- The store is the app's own data: deleting its files is allowed; user files are only written through `fs_service` (P-08).

**Commit:** `feat(versions): keep a version before every change, background storing, commands [step-06b/T5]`

### T6 - Line diff

**Files:** create `src/versions/lineDiff.ts`, `src/__tests__/lineDiff.test.ts`.

**Do this:** module doc comment "Line differences between two texts (Step 06b): Myers' algorithm, capped. Pure." Exports:

| Export | Kind | Content / behavior |
|---|---|---|
| `DiffOp` | type | `{ kind: "same" \| "added" \| "removed"; text: string }` |
| `DiffRow` | type | a `DiffOp`, or `{ kind: "skip"; count: number }` |
| `MAX_DIFF_EDITS` | number | 4000 |
| `CONTEXT_LINES` | number | 3 |
| `splitLines` | (`text: string`) returns `string[]` | split on `\r\n`, `\r` or `\n`; a final line break does not make an empty last line |
| `diffLines` | (`before: readonly string[]`, `after: readonly string[]`) returns `DiffOp[]` or `null` | Myers' greedy O(ND) algorithm on lines (equal = the same string); `null` when the edit distance would exceed `MAX_DIFF_EDITS`; the result lists every line of both texts in order: `same` lines once, `removed` lines (from `before`) before `added` lines (from `after`) within each change |
| `withContext` | (`ops: readonly DiffOp[]`) returns `DiffRow[]` | keeps every changed op and the `CONTEXT_LINES` `same` ops before and after each change; each run of other `same` ops becomes one `skip` row with its count; with no changes at all, an empty list |

**Tests** (`src/__tests__/lineDiff.test.ts`):

| Test | Input | Expected |
|---|---|---|
| "splitLines handles every line break" | "a\r\nb\nc\rd\n" | [`a`, `b`, `c`, `d`] |
| "equal texts have no changes" | [`a`, `b`] and [`a`, `b`] | two `same` ops; `withContext` gives [] |
| "one changed line" | [`a`, `b`, `c`] and [`a`, `x`, `c`] | `same a`, `removed b`, `added x`, `same c` |
| "added and removed lines at the ends" | [`a`, `b`] and [`b`, `c`] | `removed a`, `same b`, `added c` |
| "context collapses long unchanged runs" | before: lines `1` to `20`; after: the same with line `10` replaced by `X` | rows: `skip 6`, `same 7`, `same 8`, `same 9`, `removed 10`, `added X`, `same 11`, `same 12`, `same 13`, `skip 7` |
| "too many changes" | 5000 lines `a0` to `a4999` and 5000 lines `b0` to `b4999` | `null` |
| "empty texts" | [] and [`a`]; [`a`] and [] | `added a`; `removed a` |

**Commit:** `feat(versions): line diff with context [step-06b/T6]`

### T7 - The Version history window

**Files:** create `src/versions/VersionHistoryDialog.tsx`, `src/styles/versions.css`, `src/__tests__/versionHistoryDialog.test.tsx`; modify `src/main.tsx` (import `./styles/versions.css` after `./styles/layout.css`), `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** every `versions.*` key.

**Do this:** the default export `VersionHistoryDialog` takes:

| Prop | Type | Meaning |
|---|---|---|
| `path` | string | the file |
| `name` | string | its name (title) |
| `currentModified`, `currentSize` | numbers | for the "Current file" row |
| `versionsEnabled` | boolean | settings' `versions.enabled` |
| `hasUnsavedChanges` | boolean (optional) | opened from an editor with unsaved changes |
| `onOpenCopy` | function (`path: string`) | opens an extracted copy (in a tab) |
| `onRestored` | function (`result: RestoreResult`, `version: VersionInfo`) | after a restore |
| `onShowWindowsVersions` | function | opens Windows Properties |
| `onClose` | function | |

Behavior:
1. On mount: `versionsList(path)`; a skeleton (rows, 4) while waiting more than 0.1 s; errors show `errorText(t, error, "versions")`.
2. Layout (inside `Dialog` with the title `versions.title` and `name`; the dialog gets the extra class `adp-versions-dialog`): a `div.adp-versions` with a list on the left (`ul` with `role="listbox"`, `aria-label` = the title) and a detail area on the right.
   - The list: first a non-selectable row `versions.current` with `formatDate(currentModified)` and `formatSize(currentSize)`; then one `li` (`role="option"`, `aria-selected`) per version: the date (`formatDate(created_unix)`), the size, and the reason text (`versions.reason.<reason>`, `versions.reason.other` for unknown reasons). Arrow keys move the selection; the first version starts selected.
   - Notes under the list: `versions.empty` when there are none; `versions.tooLarge` when `too_large`; `versions.off` when `versionsEnabled` is false.
3. Detail area for the selected version:
   - When the file's extension is one of the text handler's or the Markdown handler's extensions and the version's size and `currentSize` are both at most 1,048,576: a segmented pair of buttons `versions.changes` / `versions.thisVersion` (`aria-pressed`). The texts: `versionsExtract(id, name)` gives a path; `fileGrant` it, `fetch` its `fileUrl`, decode with `detectEncoding` + `decodeText`, `fileRevoke`; the current file the same way from `path`. Changes: `withContext(diffLines(splitLines(old), splitLines(current)))` drawn as rows (`div.adp-diff-row` with `adp-diff-row--added`, `--removed`, `--same`, `--skip`; `skip` rows show `versions.unchanged` with `count`); `null` shows `versions.tooManyChanges`; no rows shows `versions.noChanges`. This version: the old text in a `pre` with class `adp-versions-text`.
   - Otherwise: the note `versions.noPreview`.
   - Buttons (`div.adp-dialog-actions`): `versions.open` (extract, then `onOpenCopy(extracted path)`), `versions.saveCopy` (`versionsSaveCopy(id, t("versions.saveCopyTitle"), name, t("versions.allFiles"))`; a path shows nothing more, `null` nothing), `versions.restore` (primary; opens the confirmation), and at the left `versions.windowsVersions` (subtle; calls `onShowWindowsVersions`).
4. Restore confirmation (a second `Dialog`): title `versions.restoreTitle`, the text `versions.restoreBody` with `date`, plus `versions.restoreUnsaved` when `hasUnsavedChanges`; buttons `versions.restore` (primary) and `common.cancel`. Confirming calls `versionsRestore(path, id)`; success calls `onRestored(result, version)`, reloads the list and shows `versions.restored` with `date` in a `p` with `role="status"`; failure shows the error text.

**Do this (`versions.css`):** comment "Version history window (Step 06b). Colors only through tokens."; `.adp-versions-dialog` (width min(880 px, 92 vw)); `.adp-versions` (grid with columns 280 px and the rest; gap `--adp-space-5`; height min(520 px, 70 vh)); the list (vertical overflow auto; border 1 px `--adp-color-border-panel`; corner radius `--adp-radius-md`); list rows (padding `--adp-space-2` `--adp-space-4`; flex column; gap 2 px; selected: background `--adp-color-surface-selected-row`; secondary texts `--adp-color-text-secondary`, `--adp-font-small`); the detail area (flex column; min-height 0; gap `--adp-space-3`); `.adp-diff-row` (monospace like the editor; white-space pre-wrap; padding 0 `--adp-space-3`; font size `--adp-font-small`); `--added` (background `--adp-accent-light-excel`, and a left border 3 px `--adp-accent-excel`); `--removed` (background `--adp-color-status-caution-background`, left border 3 px `--adp-accent-pdf`, text decoration line-through); `--skip` (text `--adp-color-text-tertiary`, italic); `.adp-versions-text` (the same monospace; overflow auto; margin 0).

**Tests** (`src/__tests__/versionHistoryDialog.test.tsx`; mock `../services/versions` and `../services/files`; `fetch` returns per URL the text the test sets):

| Test | Steps | Expected |
|---|---|---|
| "lists the current file and the versions" | `versionsList` resolves two versions (reasons `save` and `restore`) | "Current file" first; two options with "Saved in Adperastra" and "Before restoring a version"; the first option is selected |
| "shows the changes of a text file" | `notes.txt`, old text "a\nb\n", current "a\nc\n" | one `.adp-diff-row--removed` "b" and one `--added` "c" |
| "other files offer Open" | `photo.png`; click Open | the note `versions.noPreview`; `versionsExtract` called; `onOpenCopy` got its result |
| "restore asks first and reports" | click Restore; confirm | `versionsRestore` called with the path and the id; `onRestored` called; the status text "Restored the version from …" |
| "says when there are no versions" | an empty list | `versions.empty` |
| "unsaved changes are mentioned before restoring" | `hasUnsavedChanges` true; click Restore | the confirmation contains `versions.restoreUnsaved` |

**Commit:** `feat(versions): Version history window with changes, open, copy and restore [step-06b/T7]`

### T8 - Version history in the Explorer

**Files:** modify `src/services/undo.ts`, `src/services/fileops.ts`, `src/commands/explorerCommands.ts`, `src/commands/menus.ts`, `src/views/explorer/DetailsPane.tsx`, `src/views/ExplorerHome.tsx`, `src/App.tsx`, `src/__tests__/commands.test.ts`, `src/__tests__/undo.test.ts`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`); create `help/en/version-history.md`, `help/es/version-history.md` (the exact texts in "Help pages"; the help check over every command's slug needs them in this task).

**Translation keys:** `commands.versionHistory`, `toast.versionRestored`.

**Do this:**
1. `undo.ts`: `FileAction` gains `restoreVersion` (Data shapes). `fileops.ts`: `executeFileAction` runs it with `versionsRestore(action.path, action.versionId)`.
2. `explorerCommands.ts`: `ExplorerActions` gains `versionHistory` (comment "Step 06b"); the command `explorer.versionHistory` (Commands table; risk `read-only`; visible and enabled when exactly one file and no folder is selected). `menus.ts`: in `ITEM_MENU`, right after `cmd("explorer.properties")`, add `cmd("explorer.versionHistory")`.
3. `DetailsPane.tsx`: a new optional prop `onShowHistory` (`path: string`); for a single selected file (not a folder) and when the prop is given, a `Button` (variant `subtle`) with the text `commands.versionHistory` under the details grid, calling it with the file's path.
4. `ExplorerHome.tsx` (about 25 lines): a state `historyFor` (`ExplorerItem` or `null`); the action `versionHistory` sets it to the single selected item; `DetailsPane` gets `onShowHistory` (finds the item and sets the state). When set, render `VersionHistoryDialog` with its path, name, `modified_unix`, `size`, `versionsEnabled` from a new optional ExplorerHome prop `versionsEnabled` (App passes `settings.versions.enabled`; default true), `onOpenCopy` = `onOpenFile(path, false)`, `onShowWindowsVersions` = `showProperties([path])`, `onClose` clearing the state, and `onRestored` pushing an undo entry `{ labelKey: "toast.versionRestored", labelArgs: { name }, undo: { type: "restoreVersion", path, versionId: previous_id }, redo: { type: "restoreVersion", path, versionId: the restored version's id } }` (only when `previous_id` is not null), showing the toast through `notifyAction`, and refreshing.
5. `App.tsx` passes `versionsEnabled` to `ExplorerHome` (one line).

**Tests:**
- `commands.test.ts`: in the group checking commands and menus, add "version history needs one file": with a context of one selected file `explorer.versionHistory` is enabled; with a folder, or two files, it is not visible; `ITEM_MENU` lists it right after `explorer.properties`. (The existing help-page check then also covers `version-history`.)
- `undo.test.ts`: "restoreVersion entries undo and redo" — push an entry whose undo and redo are `restoreVersion` actions; `peekUndo` returns it with those actions unchanged (the stack stores actions as data).

**Commit:** `feat(versions): Version history from the Explorer, with undoable restore [step-06b/T8]`

### T9 - Version history in the editors

**Files:** modify `src/editor/useTextDocument.ts`, `src/handlers/types.ts`, `src/handlers/text/TextView.tsx`, `src/handlers/markdown/MarkdownView.tsx`, `src/views/FileTabView.tsx`, `src/App.tsx`, `src/__tests__/textEditing.test.tsx`.

**Do this:**
1. `useTextDocument.ts`: two new results: `expected` (the `{ modified_unix, size }` the hook already tracks) and `reloadFromDisk()`: fetch the file again (as on load), reset `baseline`, set `expected` from `fsStat(path)` (`modified_unix` and `size`), keep the read-only rules, and delete the draft.
2. `TextView.tsx` and `MarkdownView.tsx`: the command `text.versionHistory` / `markdown.versionHistory` (Commands table) in the ribbon's `file` group after Save as (key tip `H`); a state `showHistory`; the dialog with `path` = `info.path`, `name` = `info.name`, `currentModified`/`currentSize` = the hook's `expected`, `versionsEnabled` = true (the views do not read settings; the window's note about versions being off appears only in the Explorer), `hasUnsavedChanges` = `dirty`, `onOpenCopy` = a new optional view prop `onOpenFile` (`HandlerViewProps.onOpenFile`, optional, Step 06b: FileTabView passes App's `openFile` with background false) when given, `onShowWindowsVersions` = `showProperties([info.path])`, and `onRestored` = discard the unsaved changes (`discard()`) and `reloadFromDisk()`.
3. `types.ts`: `HandlerViewProps.onOpenFile` (optional; `path: string`; comment "Step 06b"). `FileTabView.tsx` gets the optional prop `onOpenFile` and passes it to the view; `App.tsx` passes `(path) => openFile(path, false)` to each `FileTabView`.

**Tests** (`textEditing.test.tsx`, mocks extended with `../services/versions`): "the ribbon opens the version history": click the button named "Version history…"; the dialog titled "Version history of a.txt" appears; "a restore reloads the text": make it dirty, open the history, `versionsRestore` resolves, confirm the restore: `discard` happened (`deleteDraft` called), the editor shows the newly fetched text and `dirty` is false.

**Commit:** `feat(editor): Version history from the text and Markdown editors [step-06b/T9]`

### T10 - Settings > Version history

**Files:** create `src/views/settings/VersionsSettings.tsx`, `src/__tests__/versionsSettings.test.tsx`; modify `src/views/settings/sections.ts`, `src/views/SettingsView.tsx`, `src/__tests__/settingsSections.test.ts`, `src/__tests__/settingsView.test.tsx`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** every `settings.versions*` key.

**Do this:**
1. `VersionsSettings` (built like the other sections; heading `settings.versions`, `h3` id `adp-versions-title`, `HelpButton` to `version-history`; props `settings`, `onApply`, `onOpenHelp`): a `Switch` `settings.versionsEnabled`; a `select` `settings.versionsKeep` (`data-versions-field` `keep_days`) with the four `KEEP_DAYS` values as `settings.versionsDays`; a `select` `settings.versionsMax` (`data-versions-field` `max_mb`) with the five values as `formatSize(mb × 1,048,576)`; a note `settings.versionsUsed` with `size` = `formatSize(versionsStoreSize())` (asked on mount and after a delete); a `Button` `settings.versionsDeleteAll` opening a `Dialog` (title `settings.versionsDeleteTitle`, text `settings.versionsDeleteBody`, a primary `Button` `settings.versionsDeleteConfirm` calling `versionsDeleteAll()` then showing `settings.versionsDeleted` in a `role="status"` note, and `common.cancel`).
2. `sections.ts`: a seventh section `versions` after `openingFiles` (title `settings.versions`, help `version-history`, keywords `settings.versionsEnabled`, `settings.versionsKeep`, `settings.versionsMax`, `settings.versionsDeleteAll`); `resetSection("versions")` resets `versions`. `SettingsView.tsx` renders the new section's block.
3. Tests: in `settingsView.test.tsx` (Step 05d), the test "lists the six sections in order" now expects 7 nav items and 7 blocks, the seventh titled "Version history" (keep the test, change its expectations; its name may stay). In `settingsSections.test.ts` add: `resetSection("versions")` sets `keep_days` back to 30 and leaves `appearance` unchanged. `versionsSettings.test.tsx`: "changes the limits" (the `keep_days` select to 90 gives `onApply` with 90; the switch off gives `enabled` false); "delete all asks first" (click the delete button, then Cancel: `versionsDeleteAll` not called; again and confirm: called once and the deleted note shows).

**Commit:** `feat(settings): Version history section [step-06b/T10]`

### T11 - Speed and screenshots

**Files:** modify `scripts/measure-ui.mjs`.

**Do this:**
1. The step value `06a` becomes `06b`.
2. In the full mode, after Step 06a's measurements: a loop of `RUNS` runs like "details pane filled": in each run open `notes.txt` (double-click, wait until editable), type one character, then `timeUntil` sends Ctrl+S and is done when the status bar no longer shows `editor.unsaved` — named `save a small text file with version history (Ctrl+S)`; after the loop, undo the typing, save once, close the tab. Then `measure` named `open the version history (right-click menu)`: setup selects the `notes.txt` row and opens its right-click menu; action clicks the menu item whose text is the translated `commands.versionHistory`; cleanup presses Escape.
3. Screenshots, after Step 06a's last action: select `notes.txt`, open its right-click menu, click Version history…, wait 600 ms, shot `42-version-history`; click "This version", shot `43-version-text`; Escape.

**Commit:** `test(speed): version history measurements and screenshots [step-06b/T11]`

## Help pages

### New page `help/en/version-history.md` (exact text)

```markdown
# Version history

Each time Adperastra is about to change a file (for example when you save it in a text tab), it first keeps a copy of how the file was. You can look at those versions, compare them with the file, and bring one back.

## Open the history

- Right-click a file and choose **Version history…**, or click **Version history…** in the **Details** pane.
- In a text or Markdown tab, click **Version history…** on the ribbon.

## Look at a version

- The list shows the current file first, then each kept version with its date, size and what made it.
- For text files, **Changes** shows what is different from the current file: removed lines are crossed out, added lines are green. **This version** shows the whole text of that version.
- For other files, **Open** opens a read-only copy of the version in a tab.

## Bring a version back

- **Restore this version** puts the file back the way it was then. The current content is kept in the history first, so you can undo the restore with **Ctrl+Z** (in the Explorer) or restore the newer version again.
- **Save a copy…** saves that version as a separate file and leaves the file as it is.
- **Previous versions from Windows…** opens the file's Windows properties, where Windows shows its own older copies, if it keeps any.

## How long versions are kept

In **Settings** > **Version history** you can turn versions off, choose how long they're kept (7 days to a year) and how much space they may use. When the space is full, the oldest versions are removed first. **Delete all versions…** removes every kept version; your files themselves don't change.

## Good to know

- Versions are kept only for changes made by Adperastra, not by other programs.
- The same content is stored only once, and compressed, so versions take little space.
- Files bigger than 256 MB don't get versions.
- Versions stay on this PC, in the app's own folder. Nothing is sent anywhere.

See also: "Editing text and code" and "The Settings page".
```

### New page `help/es/version-history.md` (exact text)

```markdown
# Historial de versiones

Cada vez que Adperastra está por cambiar un archivo (por ejemplo, cuando lo guardas en una pestaña de texto), primero conserva una copia de cómo estaba. Puedes ver esas versiones, compararlas con el archivo y recuperar una.

## Abrir el historial

- Haz clic derecho en un archivo y elige **Historial de versiones…**, o haz clic en **Historial de versiones…** en el panel de **Detalles**.
- En una pestaña de texto o de Markdown, haz clic en **Historial de versiones…** en la cinta de opciones.

## Ver una versión

- La lista muestra primero el archivo actual y luego cada versión conservada, con su fecha, su tamaño y qué la creó.
- En los archivos de texto, **Cambios** muestra lo que difiere del archivo actual: las líneas eliminadas aparecen tachadas y las agregadas, en verde. **Esta versión** muestra el texto completo de esa versión.
- En los demás archivos, **Abrir** abre una copia de solo lectura de la versión en una pestaña.

## Recuperar una versión

- **Restaurar esta versión** deja el archivo como estaba en ese momento. Antes se conserva el contenido actual en el historial, así que puedes deshacer la restauración con **Ctrl+Z** (en el Explorador) o volver a restaurar la versión más reciente.
- **Guardar una copia…** guarda esa versión como un archivo aparte y deja el archivo como está.
- **Versiones anteriores de Windows…** abre las propiedades de Windows del archivo, donde Windows muestra sus propias copias anteriores, si las conserva.

## Cuánto tiempo se conservan las versiones

En **Configuración** > **Historial de versiones** puedes desactivar las versiones, elegir cuánto tiempo se conservan (de 7 días a un año) y cuánto espacio pueden ocupar. Cuando el espacio se llena, se eliminan primero las versiones más antiguas. **Eliminar todas las versiones…** elimina todas las versiones conservadas; tus archivos no cambian.

## Para tener en cuenta

- Solo se conservan versiones de los cambios que hace Adperastra, no de los que hacen otros programas.
- El mismo contenido se guarda una sola vez y comprimido, así que las versiones ocupan poco espacio.
- Los archivos de más de 256 MB no tienen versiones.
- Las versiones se quedan en esta computadora, en la carpeta de la aplicación. No se envía nada a ningún lado.

Consulta también: «Editar texto y código» y «La página de configuración».
```

## Check by hand (the owner, in the packaged app)

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

## Speed

| Interaction | Tier | How measured |
|---|---|---|
| Saving a small file, now with a version | Fast (1 s) | `save a small text file with version history (Ctrl+S)` (within 20% of Step 06a's "save a small text file") |
| Opening the Version history window | Fast (1 s) | `open the version history (right-click menu)` |
| Showing the changes of a 1 MB text file | Fast (1 s) | by hand (check 1, with a large file) |
| Every existing measurement | as before | not more than 20% slower than step 06a's JSON |

## Screenshots

`42-version-history`, `43-version-text` (added in T11), in English light, Spanish dark and the pseudo-locale, in `docs/screenshots/step-06b/`.

## Done when

- [ ] T1 to T11 are committed, each after `GATE PASSED`.
- [ ] Every save keeps the previous content first; saving is not noticeably slower; storing happens in the background and survives a crash.
- [ ] Identical content is stored once; limits remove the oldest versions; versions can be turned off and deleted.
- [ ] The Version history window lists, compares (text), opens, saves a copy of and restores versions; restores are undoable.
- [ ] Settings schema 10 loads a schema-9 file without losing anything (Rust test `settings_v9_migrates_to_v10_keeping_language_and_theme`).
- [ ] The speed table rows meet their tiers; the screenshots exist; the step report is written.
