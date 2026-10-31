# Step 06e: Archives: create, passwords, RAR

| | |
|---|---|
| State | guide |
| Difficulty | ★★★ |
| Branch | `step-06e-archives-create` |
| Tag | `v0.0.18-step06e` |
| Depends on | Built 06d archive/helper/jobs contracts; reviewed 06b/06c baseline |
| Baseline read | Local `testing` at `b2732b3`, plus documentation-only KI-079/KI-080 records; no dependency on 06f |

This is a **guide** step: the names, types, algorithms, limits, messages, tests and task order below are the recipe. Write the implementation, not a different design. The newer owner decisions in `plan/STATUS.md` apply: local branches only; quick checks while building; the combined full gate and release-app review belong to the coordinator. No publishing, remote operation, installer build or installation is authorized by this guide.

## Goal

Select files or folders and use **Compress to…** to create one ZIP or 7z archive, optionally protected with a password. Open and extract password-protected ZIP/7z files, and single-volume RAR files through a separately installed 7-Zip. Read bzip2 streams, tar.bz2 archives and bzip2-compressed ZIP/7z entries. Creation and extraction remain cancellable jobs, never replace another item, retain the originals, report skipped files and offer Undo for new output.

## Do not do in this step

- No CSV/JSON/font/hex changes: 06f is independent work from the same baseline. Preserve the existing `HelperProcess`, `HelperIo`, `DriveTimings`, `JobContext`, `OpProgress`, handler props and settings schema 11.
- No TAR/gzip/xz/bzip2 creation UI, compression presets, archive updating or editing an archive in place. Presets and extra conversions belong to 08b; editing inside archives remains in the backlog.
- No RAR creation, bundled 7-Zip, linked 7z DLL, UnRAR code, installation or automatic download. RAR uses only a separately installed `7z.exe`; a missing installation affects only RAR runtime checks.
- No multipart or self-extracting RAR, filesystem links, alternate data streams, archive copy/paste/drag-out (09c), or replacing/merging existing extraction targets (09f). Fail closed on an ambiguous external listing.
- No password persistence, credential-manager entry, settings field or saved password in a job/Undo/report. “Remember” means bounded memory until this app process closes.
- Do not repair old ordinary extraction or text-save paths. KI-079 describes the existing 06d writer's ownership/flush defect; KI-068/KI-069 cover older content saves. Every new 06e mutation uses the additive owned writer below. The old normal unencrypted extraction route stays unchanged and its limitation stays open.

## Read first

- `plan/STATUS.md`, `rules.md`, `conventions.md`, `pitfalls.md`, `contracts.md` (5, 10, 11, 13, 20), `libraries.md`, `speed.md`, `glossary.md`, `ui-kit.md`, `design-spec.md`, `guide-ledger.md`, `backlog.md`; dependency, command, translation and help recipes. Read KI-079 and the 06d report's later safety review.
- `crates/archive/src/` in full, especially `entry.rs`, `format.rs`, `list.rs`, `read_7z.rs`, `read_zip.rs`, `plan.rs`, `extract.rs`, `write.rs`, `limits.rs`; its existing tests. Do not copy the unsafe cleanup in the old writer.
- `crates/fs-service/src/{lib,list,rename,ops,attributes}.rs`, and the owned-handle patterns in `src-tauri/src/template_copy_handles.rs` and `version_files.rs`.
- `src-tauri/src/{archive,archive_helper,helper,jobs,file_dialogs,zone}.rs`, `main.rs` (early helper dispatch, managed state, handler registration), isolation allowlist; `src/services/{archive,jobs,fileops,undo,errors}.ts`.
- `src/archive/archiveFiles.ts`, `src/handlers/archive/`, `src/views/explorer/{useArchiveExtract,JobsPanel,jobsTypes}.ts(x)`, `ExplorerHome.tsx` (job tracking, `showResult`, action factory, dialog area), `App.tsx` (archive extraction handoff), `commands/{explorerCommands,menus}.ts`, `components/{Dialog,TextInput,Button,ProgressBar}.tsx`.
- Existing archive/service/command/default-apps tests, `scripts/measure-ui.mjs`, `measure-ui.ps1`, `check-06bc-ui.mjs`. Measurements must use fresh retained folders, never the legacy permanent-cleanup path.

## Decisions (already made)

- D1. **Dependencies.** Pin `zip` exactly to 9.1.3 because its public ZipCrypto extension is explicitly unstable even across patch versions. Keep default features off; retain `deflate`, `deflate64`, `ppmd`, `zstd`, add `aes-crypto` and `bzip2`. Keep `sevenz-rust2` 0.24 (locked 0.24.2), defaults off, retain `aes256`, `ppmd`, add `compress`, `bzip2`. Add `bzip2` 0.6.1 with its default pure-Rust backend, and existing approved `blake3` 1.8 for output verification. No second archive library.
- D2. **Formats.** Add `Bz2`, `TarBz2`, `Rar` to `ArchiveFormat`/`ArchiveFormatId`. Claim `bz2`, `tbz`, `tbz2`, `rar`; recognize `.tar.bz2` as a compound name. A bzip2 signature is `BZh` followed by a digit 1–9. Decode at most the first 512 bytes to distinguish tar, under the existing helper memory limit. RAR signatures are the standard RAR4 seven-byte or RAR5 eight-byte signature at offset zero; do not scan executable prefixes.
- D3. **Creating.** The dialog creates ZIP (Deflate level 6) or non-solid 7z (LZMA2 level 6, 8 MiB dictionary, one compression thread). ZIP encryption choices: None, AES-256, ZipCrypto compatibility. 7z choices: None, AES-256; “Encrypt file names” is available only for encrypted 7z and defaults on. No deterministic salt/IV. Explicitly set 7z AES `num_cycles_power` to 19; its library default of 8 is not accepted.
- D4. **No overwrite.** Creation produces a new archive only. If the chosen name exists, publish to the first free one-based numbered name, with at most 10,000 candidates. Never recycle, truncate or replace the old name. Sources are read only; no version snapshot is needed for a newly created destination.
- D5. **Owned I/O.** Add a small Windows-only `fs-service::owned_io` module, separate from all old save/extract functions. Pin the canonical destination and its canonical ancestor directory chain against rename/deletion; reject reparse components in that resolved chain. Exclusively create an adjacent random staging file with delete access; retain its handle. Flush and `sync_all`, then rename that handle with replacement disabled. Cancellation and errors dispose only that owned handle. Do not remove a guessed partial path, follow a substituted junction, or release ownership before publication.
- D6. **Helper boundary for creation.** The helper never publishes a user-visible archive. It writes only a uniquely named spool under `<data>/archive-create/<request-id>/archive.spool`, then flushes/syncs and returns its BLAKE3 and bounded report. The parent reads only that expected regular, non-reparse spool through a locked source handle, copies to its own destination staging while recomputing the hash, and publishes only after hash/size equality. A helper crash leaves only app-owned spool data, no unreported published archive.
- D7. **Creation limits.** At most 1,000 selected roots and 256 KiB total UTF-8 root-path text; tell the user to compress a parent folder rather than silently clip selection. Enumerated descendants: existing 200,000-entry/64-level/1,024-character inner-path bounds, 32 MiB manifest text, source total at most 1 TiB. The spool/output cap is 8 GiB; reject beyond it while preserving sources and existing destinations. One creation job per data folder, serialized with an OS `create.lock`; another returns `archive.create_busy`. App-owned spool data has the same 8 GiB total cap, with the 64 MiB free-space margin. Boundary tests use small injected limits, not multi-GB allocation.
- D8. **Source walking.** Remove duplicate selections and children of already selected folders. Sort roots/children naturally and enumerate metadata first. Skip and report links/reparse points, online-only, unreadable, and hidden/system descendants when hidden items are off. Never hydrate online-only entries. Open each accepted file with a read guard denying write/delete sharing; compare its identity, size and modified time with enumeration before reading, then check again after EOF. Check cancellation between 64 KiB chunks. A changed file is skipped; a failed writer aborts unpublished output. Reports must disclose all skips.
- D9. **Passwords.** Exact strings, never trimmed: 1–256 Unicode scalar values and at most 1,024 UTF-8 bytes, without NUL/CR/LF/control characters. Creation confirmation must match. Strength is an informational estimate, never permission to downgrade encryption: weak below 8 characters or fewer than 4 distinct characters; fair otherwise; strong only at least 16 characters and 8 distinct characters. No claim of cryptographic strength. No password/hash in command-line arguments, environment variables, filenames, logs, Debug output, progress, reports, settings, sessions or Undo. Private Tauri/helper request payloads and operation-local memory are the intentional transport.
- D10. **Remembering.** `ArchivePasswords` keeps at most eight successful credentials, each at most 1 KiB, keyed by canonical archive identity, size and exact modified time. LRU eviction; changed/missing archives evict their credential. Default unchecked. Cache only after successful header/data verification, never after merely listing unencrypted headers. Ordinary close of a tab does not change “until the app closes”; process exit clears the cache. No on-disk serialization of this state. Do not promise secure erasure of every library/browser allocation.
- D11. **Password reads.** Keep old APIs; add `list_with_options` and `extract_with_options`. Missing credentials for selected encrypted data return `password_required` before any new write. Wrong credentials return `bad_password`; do not conflate damaged unencrypted data with a password failure. New authenticated/Bzip2/RAR extraction uses `secure_extract` and the owned writer, preserving exact-size checks, CRC/authentication completion, bomb/free-space checks, MOTW and created/skipped reporting. Old ordinary unencrypted extraction uses the old route unchanged (KI-079).
- D12. **RAR.** Use `7z.exe` only in the archive helper; no `x`/`e` command with a destination directory. Listing uses technical UTF-8 output, stdout extraction of one exact file uses a pipe, and Rust alone creates output. Canonical archive source remains guarded through full listing, exact selection probe and extraction. Refuse multipart/volume/SFX/link/anti/stream layouts and duplicate Windows-normalized paths. Full details, including textual lossiness, are in T7. A job object/timeout is not described as a filesystem/network sandbox.
- D13. **Feedback.** Compression uses the existing Explorer job panel, Cancel, skipped-item report, result selection and Undo/Redo (recycle/restore new output, never recompress on Redo). Reading encrypted headers and opening an entry use existing archive loading/strip feedback. Wrong/missing-password attempts that changed no files may prompt and retry; an attempt that already published files stops with its report and Undo, never silently repeats those effects.
- D14. **Parallel work.** This guide consumes only the current 06d helper/jobs/handler interfaces. 06f can be built in another worktree from the same reviewed baseline. Shared registration, translation, Cargo lock and measurement conflicts are integrated by the coordinator; neither worker merges the other's unfinished code. No settings bump or generic helper change is reserved here.

## Data shapes

All new wire structs use snake_case fields, additive optional/default fields, and redacted manual Debug where credentials can occur. Existing field meanings remain unchanged.

### Types and limits

| Type / constant | File | Fields / behavior |
|---|---|---|
| `ArchiveAuth` | `src-tauri/src/archive_passwords.rs`, mirrored in `src/services/archive.ts` | `password: String`, `remember_session: bool` (false). Operation input only; custom Debug redacts password |
| `ArchiveReadOptions` | `crates/archive/src/read_options.rs` | `password: Option<String>`, `seven_zip: Option<PathBuf>`; Default has neither; never expose the executable path as a UI-controlled option |
| `ArchivePasswords` | `src-tauri/src/archive_passwords.rs` | managed bounded memory cache; methods `get(path)`, `remember(path,password)`, `invalidate(path)`; resolve/check identity outside its mutex |
| `CreateFormat` | `crates/archive/src/create_types.rs` | `Zip`, `SevenZ`, serialized `zip`, `seven_z` |
| `CreateEncryption` | same | `None`, `Aes256`, `ZipCrypto`, serialized `none`, `aes256`, `zip_crypto` |
| `CreateOptions` | same | `format`, `encryption`, `password: Option<String>`, `encrypt_names: bool`, `include_hidden: bool`; validate combinations in both parent/helper; custom redacted Debug |
| `CreateRequest` | `src-tauri/src/archive_create.rs` | `sources: Vec<String>`, `dest_dir: String`, `file_name: String`, `format`, `encryption`, `password: Option<String>`, `encrypt_names: bool`; no executable path and no settings snapshot from UI |
| `CreateEntry` | `crates/archive/src/create_plan.rs` | `source: PathBuf`, `inner_path: String`, `kind: EntryKind`, `size: u64`, `modified_unix: u64`, opened-object identity used internally; never serialized into UI |
| `CreatePlan` | same | accepted entries, bounded skipped entries/count, total file bytes and root metadata; at most 32 MiB retained path/metadata text |
| `ArchiveCreateReport` | `src-tauri/src/archive_create.rs`, mirrored in `src/services/archiveCreate.ts` | `created: Vec<String>` (0 or 1), `files_written: u64`, `folders_written: u64`, `source_bytes: u64`, `archive_size: u64`, `skipped: Vec<SkippedEntry>`, `skipped_more: u64`, `cancelled: bool`, `error: Option<String>`; never credentials |
| `CreateSpoolReport` | `crates/archive/src/create_types.rs` | same counts/skips, `size: u64`, `blake3: String` (64 lowercase hex); no path needed because the parent already knows the exact spool location |
| `RarToolStatus` | `src-tauri/src/archive_rar.rs`, mirrored in `src/services/archive.ts` | `available: bool`, `version: Option<String>`; no raw executable path returned |
| `PinnedDirectory` | `crates/fs-service/src/owned_io/directory.rs` | owned handle chain for a resolved canonical destination; at most 256 directory components, deny delete sharing, reject reparse-point substitution |
| `PinnedSource` | `crates/fs-service/src/owned_io/source.rs` | actual regular-file handle, identity/size/time check, read sharing only, no write/delete authority over user sources |
| `OwnedOutput` | `crates/fs-service/src/owned_io/output.rs` | create exclusively below pinned directory; `file_mut`, `flush_sync`, `publish_name`, owned-handle cleanup; publication is no-replace and returns actual path |
| `MAX_CREATE_SOURCES` / `MAX_CREATE_PATH_BYTES` | create types | 1,000 / 262,144 |
| `MAX_CREATE_MANIFEST_BYTES` / `MAX_CREATE_OUTPUT_BYTES` | create types | 33,554,432 / 8,589,934,592 |
| `MAX_PASSWORD_CHARS` / `MAX_PASSWORD_BYTES` / `MAX_REMEMBERED_PASSWORDS` | read options/password module | 256 / 1,024 / 8 |
| `MAX_RAR_LINE_BYTES` / `MAX_RAR_LIST_BYTES` | RAR module | 16,384 / 67,108,864; stream records, never collect unbounded process output |
| `MAX_RAR_DIAGNOSTIC_BYTES` | RAR process | 65,536 retained bytes, redacted/discarded after code mapping; never returned verbatim |

### Additive archive APIs

| Item | Parameters | Result / behavior |
|---|---|---|
| `list_with_options` | path, limits, token, progress sink, `ArchiveReadOptions` reference | `Listing`; authenticated headers and new formats; the old `list` remains an empty-options wrapper |
| `extract_with_options` | path, existing `ExtractRequest`, limits, token, events, read options | `ExtractReport`; use secure route for a password, any selected encrypted data, RAR/Bzip2; otherwise retain old route |
| `plan_extract_with_options` | listing, request, facts, limits, `allow_encrypted: bool` | `ExtractPlan`; same path/bomb limits; old `plan_extract` keeps its original encrypted-skip behavior |
| `plan_create` | sources, include-hidden, limits, token, progress sink | `CreatePlan`; metadata only; no output created |
| `create_spool` | plan, create options, expected private spool path, limits, token, progress sink | `CreateSpoolReport`; all bytes stay in helper-owned app storage |
| `archive_open_start` | existing arguments plus optional `auth: ArchiveAuth` | existing job/summary, unchanged legacy calls |
| `archive_open_entry_start`, `archive_extract_start` | existing arguments plus optional `auth: ArchiveAuth` | existing result shape; authenticated routes use new safe writer; password cache checked when auth omitted |
| `archive_create_start` | window, app, jobs, request_id, `request: CreateRequest` | validate first, begin shared job, helper-spool then parent publication; `ArchiveCreateReport` in completion |
| `archive_rar_status` | window, app | async status via bounded helper probe, no path accepted from UI |
| `HelperRequest` | add optional/default `options` to List/Extract; add `Create` and `RarStatus` variants | old JSON requests still deserialize; keep helper request line cap 1 MiB; never Debug-print payloads |
| `HelperMessage` | add `SpoolCreated { report }`, `RarStatus { status }` | no user-visible archive created in helper; existing messages unchanged |
| `archiveOpen` / `archiveOpenEntry` / `archiveExtract` | keep existing arguments, optional `auth` last | keep `Promise<JobHandle<...>>`; forward auth in literal invoke arguments |
| `archiveCreate` | request, optional progress sink | `Promise<JobHandle<ArchiveCreateReport>>`; browser preview rejects `archive.other` |

New error variants/codes: `BadPassword/bad_password`, `InvalidPassword/invalid_password`, `PasswordMismatch/password_mismatch`, `CreateBusy/create_busy`, `CreateTooLarge/create_too_large`, `TooManySources/too_many_sources`, `SourceChanged/source_changed`, `SevenZipMissing/seven_zip_missing`, `SevenZipUnsupported/seven_zip_unsupported`, `AmbiguousRar/ambiguous_rar`, `MultiVolume/multi_volume`, `OutputChanged/output_changed`. `ArchiveError::code` remains the only public error text. New skip reasons are `online_only`, `hidden`, `source_changed`; reuse `link_entry`, `access_denied`, `name_taken`, `size_mismatch`, `damaged`, `other`. Errors contain no password or external diagnostic text.

### UI contracts

| Item | Props / behavior |
|---|---|
| `ArchivePasswordDialog` | `name`, optional error code, `onSubmit(auth): Promise<void>`, `onCancel`; password hidden by default, explicit remember checkbox, clears on completion/cancel/unmount |
| `useArchivePasswordPrompt` | stable `ask(name, code?): Promise<ArchiveAuth|null>` and dialog state; only one prompt at a time; cancel all pending promises on unmount/path change |
| `PasswordFields` | value, confirmation optional, show state, disabled, onChange; uses the existing input styling and show/hide IconButton; no native form submission or storage |
| `CompressDialog` | sources, initial folder, `onCreate(request): Promise<void>`, `onClose`, `onOpenHelp`; owns format/name/encryption/password fields; stays open until start accepted and errors are visible |
| `useArchiveCreate` | dependencies from existing job/Undo/result helpers; starts one archive job, records only actual output, selects it, shows Undo; cancellation and failed helpers never become a successful toast |
| `ExplorerActions.compressTo` | new action, used by `explorer.compressTo`; visible/enabled for nonempty real selection with an active disk folder, not Home/archive rows |
| `explorer.compressTo` | label `commands.compressTo`, existing `PackageOpen` icon, help `creating-archives`, no shortcut; risk `writes-files` using the existing command risk spelling |

`useArchiveSession` accepts an optional stable password-asking callback without changing existing callers. Missing/wrong-password errors prompt and repeat only after explicit submission. Enter on a locked entry asks rather than showing the old unsupported note. On cancellation keep the tab usable with its normal cancelled/retry state. Explorer extraction retries only when no output was published; preserve and report effects otherwise.

### Translation keys

Add these in English and Spanish in the task that first renders them; regenerate pseudo-locale. Reuse `common.cancel`, `common.close`, existing archive loading/retry labels, folder picker, help labels and standard errors.

| Key | English | Spanish (es-419) |
|---|---|---|
| `commands.compressTo` | Compress to… | Comprimir en… |
| `archive.createTitle` | Create an archive | Crear un archivo comprimido |
| `archive.create` | Create | Crear |
| `archive.fileName` | File name | Nombre del archivo |
| `archive.destination` | Save in | Guardar en |
| `archive.chooseDestination` | Choose folder… | Elegir carpeta… |
| `archive.chooseDestinationTitle` | Choose where to save the archive | Elegir dónde guardar el archivo comprimido |
| `archive.createSelection` | {count, plural, one {# selected item} other {# selected items}} | {count, plural, one {# elemento seleccionado} other {# elementos seleccionados}} |
| `archive.createFormat` | Format | Formato |
| `archive.format.zip` | ZIP archive | Archivo ZIP |
| `archive.format.seven_z` | 7z archive | Archivo 7z |
| `archive.format.bz2` | bzip2 file | Archivo bzip2 |
| `archive.format.tar_bz2` | TAR archive (bzip2) | Archivo TAR (bzip2) |
| `archive.format.rar` | RAR archive | Archivo RAR |
| `archive.encryption` | Encryption | Cifrado |
| `archive.encryptionNone` | None | Ninguno |
| `archive.encryptionAes` | AES-256 | AES-256 |
| `archive.encryptionZipCrypto` | ZipCrypto (compatibility only) | ZipCrypto (solo por compatibilidad) |
| `archive.zipCryptoWarning` | ZipCrypto is weak. Use it only when the receiving app cannot open AES-256 archives. | ZipCrypto es débil. Úsalo solo si la aplicación de destino no puede abrir archivos con AES-256. |
| `archive.encryptNames` | Encrypt file names | Cifrar los nombres de archivo |
| `archive.zipNamesVisible` | ZIP file names remain visible, even with a password. | Los nombres de los archivos ZIP siguen visibles, incluso con contraseña. |
| `archive.passwordTitle` | Password for {name} | Contraseña de {name} |
| `archive.password` | Password | Contraseña |
| `archive.confirmPassword` | Confirm password | Confirmar contraseña |
| `archive.showPassword` | Show password | Mostrar contraseña |
| `archive.hidePassword` | Hide password | Ocultar contraseña |
| `archive.rememberPassword` | Remember until the app closes | Recordar hasta que se cierre la aplicación |
| `archive.passwordOpen` | Open | Abrir |
| `archive.passwordStrength` | Strength estimate | Estimación de seguridad |
| `archive.passwordWeak` | Weak | Débil |
| `archive.passwordFair` | Fair | Media |
| `archive.passwordStrong` | Strong | Alta |
| `archive.passwordHint` | Use a long, unique passphrase. This estimate is only a guide. | Usa una frase larga y única. Esta estimación es solo una guía. |
| `archive.keepBothNote` | Existing items are kept. A number is added if this name is taken. | Se conservan los elementos existentes. Se agrega un número si el nombre ya existe. |
| `archive.extensionRequired` | The name must end in {extension}. | El nombre debe terminar en {extension}. |
| `archive.rarNotIncluded` | RAR uses your installed 7-Zip. It is not included with Adperastra. | RAR usa tu instalación de 7-Zip. No se incluye con Adperastra. |
| `archive.encryptedNote` | {count, plural, one {# item needs a password to open.} other {# items need a password to open.}} | {count, plural, one {# elemento necesita una contraseña para abrirse.} other {# elementos necesitan una contraseña para abrirse.}} |
| `files.newArchiveName` | Archive | Archivo comprimido |
| `jobs.compressing` | {count, plural, one {Creating # archive} other {Creating # archives}} | {count, plural, one {Creando # archivo comprimido} other {Creando # archivos comprimidos}} |
| `toast.archiveCreated` | Created {name} | Se creó {name} |
| `errors.archive.password_required` | This archive needs a password. | Este archivo comprimido necesita una contraseña. |
| `errors.archive.bad_password` | The password is incorrect, or the encrypted data is damaged. | La contraseña es incorrecta o los datos cifrados están dañados. |
| `errors.archive.invalid_password` | Enter 1–256 characters without control characters or line breaks. | Escribe de 1 a 256 caracteres, sin caracteres de control ni saltos de línea. |
| `errors.archive.password_mismatch` | The passwords do not match. | Las contraseñas no coinciden. |
| `errors.archive.create_busy` | Another archive is being created. Wait for it or cancel that job. | Ya se está creando otro archivo comprimido. Espera o cancela esa tarea. |
| `errors.archive.create_too_large` | This archive exceeds the 8 GB creation limit. Select fewer files or use another app. | Este archivo supera el límite de creación de 8 GB. Selecciona menos archivos o usa otra aplicación. |
| `errors.archive.too_many_sources` | Select fewer items, or select their parent folder instead. | Selecciona menos elementos o selecciona su carpeta principal. |
| `errors.archive.source_changed` | Skipped: the source changed while it was being read. | Omitido: el origen cambió mientras se leía. |
| `errors.archive.online_only` | Skipped: open this online-only file first to download it. | Omitido: abre primero este archivo solo en línea para descargarlo. |
| `errors.archive.hidden` | Skipped: hidden and system items are off in this view. | Omitido: los elementos ocultos y del sistema no se muestran en esta vista. |
| `errors.archive.seven_zip_missing` | Install 7-Zip from 7-zip.org to open RAR files here, or open this file in your Windows app. | Instala 7-Zip desde 7-zip.org para abrir archivos RAR aquí o abre este archivo en tu aplicación de Windows. |
| `errors.archive.seven_zip_unsupported` | This 7-Zip installation could not be used safely. Update it from 7-zip.org or use your Windows app. | No se pudo usar esta instalación de 7-Zip de forma segura. Actualízala desde 7-zip.org o usa tu aplicación de Windows. |
| `errors.archive.ambiguous_rar` | This RAR listing cannot identify the selected file safely. Nothing was written. | Esta lista RAR no permite identificar el archivo de forma segura. No se escribió nada. |
| `errors.archive.multi_volume` | Multipart and self-extracting RAR files are not supported here. Use your Windows app. | Los archivos RAR divididos en partes y los autoextraíbles no se admiten aquí. Usa tu aplicación de Windows. |
| `errors.archive.output_changed` | The prepared archive could not be verified. No archive was published. | No se pudo verificar el archivo preparado. No se publicó ningún archivo comprimido. |

## Tasks

Every task writes its tests. Workers run only the quick checks in the current owner brief; the coordinator runs the full gate and app review. Never replace an old regression with a weaker assertion. All new modules stay below 400 lines; use the named splits rather than growing existing monoliths.

### T1 - Dependency features and exact ZIP compatibility pin

**Files:** `crates/archive/Cargo.toml`, `Cargo.lock`, `THIRD_PARTY_LICENSES.md`, `docs/dependency-and-license-table.md`.

1. Apply D1; retain existing features and dev-dependencies, with ZIP's exact 9.1.3 pin. Do not turn default feature sets on. Add `blake3` to this crate, using the existing locked 1.8 version.
2. Record bzip2 0.6.1 (MIT OR Apache-2.0), its pure-Rust `libbz2-rs-sys` backend (bzip2-1.0.6), and any new allowed AES transitive dependencies from the resolved lock. Keep the existing SQLite/Office notices.
3. No 7-Zip binary, DLL, installer or archive fixture is checked in. Dependency resolution is not permission to install a program.

**Checks:** dependency metadata matches the pinned sources in the research notes; source-default backends contain no unapproved library. Existing crate interfaces remain unchanged in this task.

**Commit:** `deps(archive): enable passwords, creation and bzip2 [step-06e/T1]`

### T2 - Owned output and pinned source primitives

**Files:** create `crates/fs-service/src/owned_io/{mod,directory,source,output}.rs`, `crates/fs-service/tests/step06e_owned_io_tests.rs`; modify `crates/fs-service/src/lib.rs` (additive exports only).

1. Implement the three owned types above with existing windows 0.61 file APIs. Directory handles use backup-semantics/reparse flags and exclude delete sharing; pin the entire resolved ancestor chain. Source guards open actual regular files against write/rename, record volume/file identity and exact metadata; never request delete access on user sources.
2. Staging names contain a random UUID and a bounded name hint, next to the target. CREATE_NEW failure produces no owned file and therefore no cleanup. Output has read/write/delete access, exclusive sharing, and rejects reparse metadata. Keep the handle until flush, sync, final metadata and no-replace `FileRenameInfo` publication all succeed.
3. `publish_name` accepts a validated single component, not a new directory. Errors/cancel use `FileDispositionInfo` only on the owned handle. Do not call an old `write_new_file`, `partial_path`, `write_entry` or `recycle_target` here. Use no new lint suppression.

| Test | Input / action | Expected |
|---|---|---|
| `foreign_partial_survives_create_failure` | pre-create a colliding staging name through an injected deterministic name source | original bytes unchanged, no ownership or removal |
| `publication_never_replaces_an_arrival` | create target after staging | error, arriving target unchanged, owned staging cleaned |
| `cancel_disposes_only_the_owned_handle` | cancel after one chunk, place another partial alongside it | no target, foreign partial remains |
| `pinned_ancestor_cannot_be_swapped` | attempt parent/ancestor rename or junction substitution while output is open | no write escapes the pinned directory |
| `source_guard_refuses_changed_identity` | substitute a source between metadata and guarded open | source_changed, no output published |
| `flush_failure_leaves_old_names_untouched` | injected sync failure | no published file, old file unchanged |

**Commit:** `feat(archive): owned staging for new archive work [step-06e/T2]`

### T3 - Bzip2 reading through the new safe extraction route

**Files:** modify archive `entry.rs`, `format.rs`, `list.rs`, `lib.rs`; create `read_options.rs`, `read_bzip2.rs`, `secure_extract.rs`, `secure_extract_readers.rs`, `secure_extract_paths.rs`, `tests/step06e_bzip2_tests.rs`; update `src/services/archive.ts` format union and the format translation keys.

1. Implement Bz2/TarBz2 detection/listing using `MultiBzDecoder`; preserve concatenated members and validate CRC errors. Reuse existing collectors, limits, activity, tar reader, inner-path normalization and reports.
2. Add the options-aware list/extract entry points. The new extraction planner permits encrypted entries only explicitly, retains all existing path/depth/size checks, and invokes the owned writer for Bzip2 now and authenticated/RAR later. Keep old ordinary extraction behavior and KI-079 intact.
3. New extraction path construction pins destination directories, creates only new output scaffolds, reports exact top-level creations, rejects link/reparse ancestors, and uses bounded numbered root allocation. Never merge into a pre-existing top-level tree. Preserve MOTW through a handle-bound stream before publication; if the filesystem cannot preserve a required mark, skip/report rather than silently dropping it. Maintain timestamps and exact-size/CRC completion before publication.

| Test | Input | Expected |
|---|---|---|
| `detects_bzip2_and_tar_bzip2_by_bytes` | `.dat` files containing each valid stream | Bz2 / TarBz2 regardless of suffix |
| `reads_concatenated_bzip2_members` | compressed `abc` then `def` | one six-byte file `abcdef` |
| `bzip2_tar_names_use_existing_safety_rules` | tar with normal, traversal and symlink entries | normal file only; unsafe/link skips reported |
| `bzip2_crc_failure_never_publishes_a_partial` | truncate/corrupt final CRC | damaged, no new file; foreign partial preserved |
| `bzip2_stops_at_injected_size_and_ratio_limits` | synthetic small limits | Bomb before output; cancellation also leaves no owned partial |
| `new_extraction_refuses_required_motw_loss` | fake stream failure/FAT-like capability | skip with explicit reason, no silently unmarked published file |

**Commit:** `feat(archive): read bzip2 with owned extraction [step-06e/T3]`

### T4 - ZIP and 7z password-aware readers

**Files:** create `crates/archive/src/read_encrypted.rs`, `secure_extract_zip.rs`, `secure_extract_7z.rs`, `tests/step06e_password_tests.rs`; modify `read_zip.rs`, `read_7z.rs`, `read_options.rs`, `error.rs`, `lib.rs`, options-aware dispatch and planner; add corresponding error translations.

1. ZIP metadata remains readable with `by_index_raw`; encrypted data uses `by_index_decrypt` and the supplied exact UTF-8 bytes. Map missing/invalid passwords separately. Read through EOF to validate CRC/authentication before owned publication; never count a partial decrypted file as complete.
2. For 7z, pass `Password` to header reading and `ArchiveReader`. Derive an entry's encrypted flag through `archive.stream_map.file_block_index` and its block coders' AES256-SHA256 method ID; do not assume every file is encrypted or that every header exposes names. Missing password and failed encrypted header/data authentication use the password codes, while corrupt plain data remains corrupt.
3. Metadata preflight of a requested selection with encrypted entries and no usable credential fails before creating user output. A later failed encrypted entry returns the exact created/skipped report with error; UI retries only if it created nothing. Do not automatically repeat partial work.

| Test | Input | Expected |
|---|---|---|
| `zip_aes_and_zipcrypto_require_the_exact_password` | writer-generated small fixtures, correct/wrong/missing password | exact original bytes only with correct password; no partial on rejection |
| `seven_z_reports_data_and_header_encryption` | plain header/encrypted data; encrypted header; unencrypted file | per-file flags correct; header names appear only after password |
| `wrong_password_does_not_publish_a_zero_length_file` | encrypted empty and nonempty files | bad_password or password_required, no publication |
| `authenticated_selection_uses_owned_output` | existing partial and target race | foreign names unchanged |
| `partial_password_failure_reports_every_effect` | earlier plain file, later differently encrypted file | exact created list retained; no automatic retry |

**Commit:** `feat(archive): open password-protected ZIP and 7z files [step-06e/T4]`

### T5 - Bounded source planning for creation

**Files:** create `crates/archive/src/{create_types,create_plan,create_walk}.rs`, `tests/step06e_create_plan_tests.rs`; modify `lib.rs` and creation error keys.

Implement D7/D8 and all input validation before a user-visible write. Use checked arithmetic and bounded metadata text. Normalize archive-relative names with the existing Windows path rules. Explicitly add directories, including empty ones. Reject duplicate output root names from unrelated selected roots before spooling; do not silently rename internal source names. Resolve output parent separately and exclude the chosen final archive/spool if it would be inside a selected tree. No path or secret is written into progress except actual current source/destination names.

| Test | Input | Expected |
|---|---|---|
| `parent_selection_subsumes_its_child` | folder plus its nested file twice | one copy of each entry |
| `unrelated_roots_with_same_name_are_rejected` | two different `docs` folders | bad_request, no spool |
| `walk_skips_links_hidden_online_and_denied` | controlled metadata/real junction fixtures | expected bounded skips, no hydration or traversal |
| `create_plan_caps_roots_entries_depth_and_text` | injected small limits | fail without clipping or output |
| `empty_folders_are_explicit_entries` | empty tree | directory entry retained |
| `cancelled_walk_creates_no_spool` | cancel metadata walk | cancelled, zero files written |

**Commit:** `feat(archive): plan bounded archive creation [step-06e/T5]`

### T6 - ZIP and 7z spool writers

**Files:** create `crates/archive/src/{create,create_zip,create_7z,create_stream}.rs`, `tests/step06e_create_tests.rs`; modify `lib.rs`.

1. Write only the expected app-owned spool with exclusive creation. Source reads use pinned guards; progress and cancellation occur between 64 KiB reads. Bound actual output writes to the injected/default output cap; abort the unpublished spool on write/space/finish failure.
2. ZIP uses `ZipWriter::new`, `SimpleFileOptions`, `large_file(true)`, Deflate level 6, directories, timestamps and `finish`. AES uses random-salt `with_aes_encryption(Aes256, password)`; ZipCrypto uses the exact-pinned public `FileOptionsExt` method, only when explicitly selected. Do not copy private methods from the library.
3. 7z uses `ArchiveWriter::new` on the owned file, non-solid `push_archive_entry`, LZMA2 level 6 with 8 MiB dictionary. Add AES options before LZMA2 in content-method order, use random IV/salt and cycle power 19; explicitly set header encryption according to the request. Do not use `push_source_path`, which would bypass the planned guarded walk.
4. Finish, flush, sync, then hold the completed spool against write/rename while hashing it in bounded chunks. Return only the verified report; no user output path is published by this function.

| Test | Input | Expected |
|---|---|---|
| `zip_and_seven_z_round_trip_files_and_empty_folders` | fixed small tree | same names/bytes/timestamps, no source modified |
| `zip_aes_and_compatibility_are_explicit_choices` | none/AES/ZipCrypto options | expected method; correct password works, wrong does not |
| `seven_z_encrypts_names_only_when_requested` | encrypted archive with names on/off | header readable only with password when on |
| `seven_z_uses_configured_kdf_and_dictionary` | inspect generated coder metadata | cycle power 19 and 8 MiB dictionary |
| `output_cap_uses_small_injected_limit` | incompressible synthetic reader | create_too_large, no user output |
| `cancel_and_finish_failure_preserve_sources` | controlled cancellation/failing writer | no publication; all original bytes unchanged |

**Commit:** `feat(archive): create ZIP and 7z archives in bounded spools [step-06e/T6]`

### T7 - Read-only external RAR adapter

**Files:** create `crates/archive/src/{rar,rar_listing,rar_process,rar_probe}.rs`, `tests/step06e_rar_tests.rs`; create `src-tauri/src/archive_rar.rs`; modify format/error/options dispatch, `ArchiveFormatId`, handler format labels and extension helpers.

1. Discover only standard installed `7z.exe` locations under Program Files/Program Files (x86), not the working directory, a UI-provided path or arbitrary PATH result. Probe the resolved executable with no archive argument in a hidden helper child; require an identifiable 7-Zip version supporting the tested switches. Do not install, download or load a DLL. Missing/unknown installations return the dedicated codes. Real-tool compatibility is a coordinator/owner runtime check, not a fact established by fake-process tests.
2. Launch with `Command` arguments and piped I/O, hidden window, no shell. Keep the original archive handle read-locked throughout the operation; reject identity/size/time changes. Force the RAR archive type; reject SFX signatures, multipart/volume metadata, links, alternate streams, anti-items, ambiguous or duplicate normalized paths. Never give 7-Zip a destination directory and never let it create output files.
3. Full listing uses `l`, technical mode `-slt`, UTF-8 `-sccUTF-8`, progress off, and `--` before the absolute archive path. Parse bounded records, splitting each property on its **first** ` = `; reject duplicate keys, malformed numbers, malformed UTF-8, unknown record boundaries, a line/output over its cap and inconsistent records. Preserve equals signs and spaces in values. Reject non-normal Windows names rather than repairing them. Parse UTC timestamps with an explicit UTC listing switch supported by the selected version; absent/invalid timestamps become 0, never guessed local dates.
4. 7-Zip normalizes CR/LF in printed names to underscores. Therefore printed paths are candidates, not identities. Before opening/extracting **each** candidate file, run a second technical listing with `-spd` (literal wildcard mode), `-ssc` (case sensitive), `-r-` (no recursion), and `--` before archive and candidate positional arguments. Require exactly one regular entry and exact normalized path/size/encryption/type agreement with the full listing. `--` also prevents `@name` becoming a list-file argument. Zero results, duplicate results, mismatches or a lossy candidate that cannot be reselected fail `ambiguous_rar` without writing.
5. Stream only that verified file using `e`, `-so`, the same literal/case/recursion flags and positional separator. Status/error text goes to stderr, not file-data stdout. Drain both pipes concurrently under caps/timeouts; count every stdout byte against the verified declared size, require successful child completion, and publish only through the owned writer after all checks. An empty stdout is not proof that an empty selected file existed: the prior exact listing remains mandatory. Check cancellation, kill and reap the child on failure; it remains inside the archive helper's process job. Validate descendant-job inheritance in runtime checks; never claim an unimplemented filesystem sandbox.
6. For RAR **reading**, omit the `-p` switch. When a password is supplied, pipe exactly its UTF-8 bytes plus one newline, then close stdin; when none is supplied close stdin immediately. The official reading callback prompts only when the password-defined flag is false; bare `-p` can define an empty password and bypass this input. Password values never appear in arguments/environment/disk. Retain only bounded diagnostics for code mapping and discard them; return codes, never their raw text. UTF-8 stdin behavior is source-verified but not locally tested with the missing executable.
7. A listing may report unsupported volume/layout metadata: stop before any extraction and return `multi_volume`. Do not claim that rejecting a listing afterward proves the external process did not probe companion files. A real-tool test must establish the accepted single-volume boundary; if that cannot be proved for an encrypted-header/volume layout, refuse that layout rather than enabling an unsafe path. This uncertainty is an explicit runtime acceptance condition, not hidden support.

| Test | Fixture / fake process | Expected |
|---|---|---|
| `rar_values_split_only_the_first_delimiter` | `Path = a = b.txt` | exact candidate `a = b.txt` |
| `rar_duplicate_keys_and_record_injection_are_rejected` | repeated Path/Size, malformed continuation/boundary | ambiguous_rar, no output |
| `rar_lossy_name_needs_exact_second_selection` | full `a_b.txt`, exact second listing empty | ambiguous_rar even for declared size 0 |
| `rar_real_underscore_and_at_names_are_literal` | exact single matching entry, candidate beginning @ or containing brackets | no list-file/wildcard expansion; expected bytes |
| `rar_duplicate_case_or_normalized_names_are_refused` | duplicate candidates across slash/case normalization | no extraction command |
| `rar_volume_links_streams_and_sfx_are_refused` | corresponding signature/metadata cases | no output or uncontrolled extraction path |
| `rar_password_is_only_on_stdin` | secret containing spaces/non-ASCII, fake process records transport | no secret in argv/env/log/debug; one UTF-8 stdin line |
| `rar_failed_or_oversized_stream_never_publishes` | crash, wrong password, extra/short bytes, timeout | owned partial only cleaned; old destination untouched |

**Commit:** `feat(archive): bounded read-only RAR adapter [step-06e/T7]`

### T8 - Password memory and additive helper/command integration

**Files:** create `src-tauri/src/archive_passwords.rs`, `archive_read_jobs.rs`, associated tests; modify `archive.rs` only at command delegation points, `archive_helper.rs`, `main.rs`, isolation allowlist and `src/services/archive.ts`.

1. Implement the bounded credential cache and auth validation with no disk writes. Only successful authenticated reads remember credentials when requested. Wrong credentials invalidate only that archive's cached entry. All debug representations redact auth/options. Do not derive raw password Debug on a request enum or print serialized requests.
2. Add helper options/variants and the `archive_rar_status` command; register every command and managed state. Existing request JSON still deserializes. Old no-auth wrapper callers remain valid. General helper/jobs code stays unchanged.
3. Route only new password/RAR/Bzip2 mutations to the new extractor; preserve ordinary old paths and KI-079. Publish no native mutation before argument/credential checks. Keep cached-state mutexes released during I/O. New commands validate the main-window label, absolute paths, lengths and request IDs before beginning jobs.
4. New service auth is the final optional argument; browser behavior stays as before. Do not keep password fields in `ArchiveSummary`, `Session`, `ExtractArgs`, job result, Undo or persisted tab/session state.

**Tests:** `auth_rejects_controls_and_oversized_utf8`, `auth_preserves_spaces_and_unicode`, `remembered_passwords_require_success`, `credential_identity_change_invalidates`, `credential_lru_is_bounded`, `auth_debug_is_redacted`, `old_helper_requests_still_deserialize`, `new_command_validation_precedes_job_begin`, and service tests named “auth is optional and sent only to start commands” / “passwords are absent from results and errors”. Test with synthetic secrets only.

**Commit:** `feat(archive): ephemeral password sessions and helper options [step-06e/T8]`

### T9 - Creation job, verified parent publication and cleanup

**Files:** create `src-tauri/src/{archive_create,archive_create_spool,archive_create_publish}.rs`, `src/services/archiveCreate.ts`, focused Rust/service tests; modify archive-helper dispatch, `main.rs` and isolation allowlist.

1. Validate CreateRequest before `jobs.begin`. Derive hidden-item behavior from confirmed Rust settings, not a supplied UI bool. Validate extension/format/encryption/password combinations and destination. Take the per-data-folder OS creation lock without blocking a settings/job mutex; a busy request fails cleanly.
2. Create a unique private spool directory and enforce total stored spool usage/free space before writing. Never follow a link or remove a foreign entry. Helper Create receives only validated selected roots/options and the expected app-owned spool location. Throttle progress to 100 ms and send activity only when bytes/metadata actually advance.
3. The parent accepts only a complete `SpoolCreated` report with bounded counts/hash/size. Open exactly the expected spool, pinned against mutation; copy in bounded chunks into `OwnedOutput` at the user destination, recompute hash and compare exact size. On cancellation/error/invalid report publish nothing. On verified completion flush/sync and try base name, then one-based candidates up to 10,000. Record the actual published path before reporting completion.
4. Return a report even when a later step fails after publication, retaining the actual created path for Undo. Parent source/spool handles and helper are closed on every exit. Remove only app-owned spool/staging through verified ownership; a killed helper never authorizes a path-based delete. Startup recovery may reclaim only verified app-owned abandoned spool records, under the creation lock and cap; otherwise retain them and report `create_busy`/space instead of guessing ownership.
5. Progress stays in existing `OpProgress`: metadata phase indeterminate; input bytes/items while compressing; an extra final output item keeps completion below 100% until verified publication. No invented byte counts. The parent alone completes the job after publication/cleanup outcome is known.

| Test | Controlled case | Expected |
|---|---|---|
| `create_validation_precedes_job_or_spool` | invalid path/name/options/secret | no job entry/output |
| `helper_death_leaves_no_published_archive` | fail before/after spool report | no user destination changed |
| `spool_path_and_hash_are_not_trusted` | wrong file/link/hash/size from fake helper | output_changed, no publication |
| `create_keeps_both_from_one_and_exhausts_safely` | existing names through injected small candidate limit | original unchanged; first free (1); exhaustion preserves all old files |
| `cancel_before_publish_keeps_sources_and_old_target` | cancel compress/copy/sync boundary | no new archive, no foreign deletion |
| `publication_report_keeps_actual_effect_on_late_failure` | publish then simulate cleanup/report issue | created path still returned for Undo |
| `spool_budget_is_shared_and_bounded` | competing creation lock and injected small byte limit | busy/too_large, no unbounded retained data |

**Commit:** `feat(archive): verified archive creation jobs [step-06e/T9]`

### T10 - Password UI and retry lifecycle

**Files:** create `src/archive/{PasswordFields,ArchivePasswordDialog}.tsx`, `useArchivePasswordPrompt.ts`, `passwordStrength.ts`, tests; modify `TextInput.tsx` only for optional autocomplete/max-length/ref attributes if needed, `useArchiveSession.ts`, `ArchiveView.tsx`, `useArchiveExtract.ts`; add password translations/styles in `src/styles/archive-create.css`.

1. Use existing Dialog/Button/input/focus styling. Inputs are password type by default, autocomplete off, no form/name/action persistence, explicit show/hide button, max length and accessible labels/descriptions. Dialog initially focuses password; Escape/Cancel resolve null and clear values. Never include the entered password in error text, screenshot setup, local storage, tests' snapshots or report fixtures.
2. Implement the informational strength rule in D9 as a pure helper; label and numeric meter are accessible without color. Do not weaken CSP or reuse a light-only background for dark text. Confirm field exists only for creation.
3. Add a stable asking callback to archive session/open-entry flows. Missing/wrong-password reads with no output can prompt and retry explicitly, preserving cancel/stale-response guards. Remove only the old “encrypted cannot open yet” early return. Parent-folder changes and unmount cancel jobs and all pending prompts. Remember remains unchecked until the user chooses it.
4. Explorer extraction prompts on password error before any effects, repeats only after a submission and records each real attempt honestly. If a report already has created output, stop and retain its Undo/report; never silently rerun partial work. Non-password errors continue through the standard error path.

**Tests:** “passwords start hidden and remember starts off”; “show and hide change both accessible fields”; “cancel clears a pending secret and resolves once”; “wrong password keeps a retry dialog without exposing the value”; “closing the tab cancels its pending prompt and job”; “opening an encrypted entry asks and then opens the verified copy”; “partial extraction is not automatically repeated”; strength tests for empty, `aaaa`, `abcdefgh`, `abcdefghijklmnop`, and a 16-character/8-distinct non-ASCII passphrase with the exact D9 classifications.

**Commit:** `feat(archive): password prompts and session-only remembering [step-06e/T10]`

### T11 - Compression dialog, Explorer command and Undo

**Files:** create `src/archive/{CompressDialog,compressNames}.ts(x)`, `src/views/explorer/useArchiveCreate.ts`, tests; modify `ExplorerHome.tsx`, `explorerCommands.ts`, `menus.ts`, `src/main.tsx` for styles, translations; create both `creating-archives` help pages in this task so the command help target exists.

1. Register `explorer.compressTo` after the Extract submenu in item menus and beside extraction in the command bar. Use the current live selection and folder; do not capture stale sources in the memoized actions. A missing folder/Home/empty selection is disabled. Opening the dialog does not read source bytes.
2. Dialog fields, in order: selected-item count; destination path plus Choose folder; file name; format; encryption; password/confirmation/show/hide and informational strength; optional 7z name encryption; Keep both note; Cancel/Create footer and Help. Default ZIP/None; one root uses its file stem or folder name, several use `files.newArchiveName`, with the selected format extension. Format switches replace the previous matching extension; a custom mismatching extension blocks Create with the translated note. Native folder-picker cancellation leaves the confirmed destination unchanged.
3. Switching encryption to None clears secret/confirmation and forces encrypt_names false; switching ZipCrypto to 7z selects AES-256, never a silent downgrade. Confirmation mismatch/invalid characters/options disable Create and report the relevant field error. File names are validated single components with at most 255 UTF-16 units; keep both remains automatic.
4. `useArchiveCreate` uses `trackJob`, verb `compressing`, count 1, reason area `archive`. After the start is accepted the job panel owns progress/cancel and the dialog clears/closes. A start error keeps the dialog. Actual created output records `recycle` Undo and `restore` Redo, label `toast.archiveCreated`; never store password/source recompression work in Undo. Select/refresh the output without navigating again to an already open folder (KI-033).

| Test | Action | Expected |
|---|---|---|
| “compression needs a real nonempty disk selection” | Home, empty, files, folder | appropriate enabled state; existing command list assertions extended |
| “name follows the chosen format without discarding custom text” | default/custom extension transitions | exact `.zip`/`.7z` names and mismatch note |
| “ZipCrypto is an explicit warned choice” | select compatibility mode | warning visible; never auto-selected |
| “none clears secrets and 7z encryption enables names” | change encryption/format | valid defaults and no hidden stale secret |
| “start errors keep the dialog and duplicate clicks do not launch twice” | deferred/rejected start | one call; error visible; no false success |
| “completed creation records exact Undo and selection” | report numbered output | recycle/restore actual path only; source remains unchanged |
| “cancelled and failed creation do not offer false Undo” | no-created report | no output action; ordinary error/cancel feedback |

**Commit:** `feat(explorer): Compress to with cancellable jobs and Undo [step-06e/T11]`

### T12 - Format registration, help, fixtures and review measurements

**Files:** modify `src/archive/archiveFiles.ts`, `src/handlers/archive/index.ts`, relevant registry/default-apps/archive tests, both existing archives help pages, translations, `scripts/measure-ui.ps1`, `measure-ui.mjs`; add `scripts/check-06e-ui.mjs`, `help/{en,es}/archive-passwords.md`, report documentation.

1. Claim the new extensions; compound names lose the full `.tar.bz2` suffix. Existing Office ZIP containers remain routed by their own extensions. Tests that explicitly left RAR/bzip2 to Windows now assert the archive handler, preserving unsupported-format fallback tests for genuinely unknown types.
2. Add the complete help texts below, link them from the existing archives pages, and replace the existing password/RAR/bzip2 “later” notes with current behavior and limits. Mark KI-040/041/042 as fixed only for implemented/verified support; keep external-tool and old writer limitations explicit in the report. Never claim a missing installed-tool/runtime test passed.
3. Add a scoped `-Review06e` runner patterned after the safe retained 06b/06c mode. Fresh data/fixtures only; no legacy permanent cleanup, no signing/installer, only the owned test process closed. Generate normal tiny fixtures and synthetic boundary readers, never multi-GB files on this PC. Do not embed entered passwords in screenshots/results: password fields must remain masked, and setup uses synthetic test credentials held only for the run.
4. Seven-run measurements: `open Compress to dialog`, `switch archive encryption option` (Instant); `open encrypted small ZIP` (Fast); `create small ZIP (one MiB)` and `create encrypted small 7z (one MiB)` (Waiting with feedback, at most 10 s; use completion condition, not just the first paint). Keep existing measurements; comparisons need same-build baselines, otherwise explicitly pending. Real RAR operations are additional owner/coordinator tests only once the program exists.
5. Screenshots: `49-compress-dialog` (AES selected, masked values or empty input, filename visible), `50-password-open` (synthetic file name, value masked), `51-compression-job` (real progressing job) in English light, Spanish dark and pseudo-locale. Check keyboard focus, wrapping, scrollable body within viewport, text contrast and every result. Reserve next screenshot 52 for 06f; no settings-schema reservation.

**Tests:** `new_archive_extensions_preserve_office_handlers`, `compound_bzip2_name_loses_the_whole_suffix`, “unknown formats still use Windows”, help/translation symmetry, runner argument/record scope validation. Do not run UI/storage/crypto boundary tests by allocating their default multi-GB limits.

**Commit:** `test(archive): document and measure archive creation and passwords [step-06e/T12]`

## Help pages (full text)

### `help/en/creating-archives.md`

```markdown
# Creating archives

Select files or folders, then choose **Compress to…** from the command bar or right-click menu. Choose a folder, a name and ZIP or 7z, then **Create**. The originals are unchanged. If the name already exists, the new archive gets a number starting at (1).

ZIP is a widely used format. 7z often makes smaller files. For a password, choose **AES-256**, enter it twice and keep it somewhere safe: Adperastra cannot recover a forgotten password. ZIP names remain visible. Encrypted 7z can also hide file names. **ZipCrypto** is offered only for old software and is weak.

Creation runs in File operations with progress and **Cancel**. Cancel before completion publishes no archive. Read the skipped-items report: links, online-only files, inaccessible files and hidden items that are off in the view are not silently included. Open online-only files first in Windows if you want to download them.

Undo sends the newly created archive to the Recycle Bin; Redo brings that exact archive back. Neither changes the source files. This version creates one archive at a time and has an 8 GB output limit. Select a parent folder when too many individual items are selected.

See also: “Archives” and “Archive passwords”.
```

### `help/es/creating-archives.md`

```markdown
# Crear archivos comprimidos

Selecciona archivos o carpetas y elige **Comprimir en…** en la barra de comandos o el menú del clic derecho. Elige una carpeta, un nombre y ZIP o 7z, y pulsa **Crear**. Los originales no cambian. Si el nombre ya existe, el nuevo archivo recibe un número desde (1).

ZIP es un formato muy usado. 7z suele crear archivos más pequeños. Para usar una contraseña, elige **AES-256**, escríbela dos veces y guárdala en un lugar seguro: Adperastra no puede recuperar una contraseña olvidada. Los nombres ZIP siguen visibles. Un 7z cifrado también puede ocultar los nombres. **ZipCrypto** se ofrece solo para programas antiguos y es débil.

La creación aparece en Operaciones de archivos con progreso y **Cancelar**. Si cancelas antes de terminar, no se publica ningún archivo. Lee el informe de elementos omitidos: los enlaces, los archivos solo en línea, los inaccesibles y los ocultos que no se muestran en la vista no se incluyen silenciosamente. Abre primero los archivos solo en línea en Windows si quieres descargarlos.

Deshacer envía el nuevo archivo comprimido a la Papelera; Rehacer recupera ese mismo archivo. Ninguno cambia los originales. Esta versión crea un archivo a la vez y tiene un límite de salida de 8 GB. Selecciona una carpeta principal si hay demasiados elementos individuales seleccionados.

Consulta también: «Archivos comprimidos» y «Contraseñas de archivos comprimidos».
```

### `help/en/archive-passwords.md`

```markdown
# Archive passwords

When an archive or an item inside it needs a password, Adperastra asks for it. Passwords are case-sensitive and spaces matter. **Show password** lets you check what you typed. Cancel leaves the existing files untouched.

**Remember until the app closes** is off by default. When selected, a verified password stays only in bounded app memory until Adperastra closes or that archive changes. It is not saved in settings or on disk. Without remembering, opening another protected item may ask again, even after protected names were listed.

If the password is wrong, try again. Damaged encrypted data can produce the same error. If an extraction already created files before a later failure, read its report and use Undo; the app does not silently repeat those effects.

RAR uses a 7-Zip you installed separately from **7-zip.org**; it is not included. Install or update it yourself only if you want RAR support here. Multipart, self-extracting, linked, or ambiguous RAR layouts are refused. You can still use your Windows app for them. No RAR creation is offered.

See also: “Creating archives” and “Archives”.
```

### `help/es/archive-passwords.md`

```markdown
# Contraseñas de archivos comprimidos

Cuando un archivo comprimido o uno de sus elementos necesita una contraseña, Adperastra la pide. Las mayúsculas y los espacios cuentan. **Mostrar contraseña** permite revisar lo que escribiste. Cancelar deja intactos los archivos existentes.

**Recordar hasta que se cierre la aplicación** está desactivado al principio. Si lo eliges, una contraseña verificada queda solo en la memoria limitada de la aplicación, hasta que Adperastra se cierre o cambie ese archivo. No se guarda en Configuración ni en el disco. Si no la recuerdas, abrir otro elemento protegido puede pedirla otra vez, aunque ya se hayan mostrado sus nombres.

Si la contraseña es incorrecta, inténtalo de nuevo. Los datos cifrados dañados pueden causar el mismo error. Si una extracción ya creó archivos antes de fallar después, lee el informe y usa Deshacer; la aplicación no repite esos cambios silenciosamente.

RAR usa un 7-Zip que hayas instalado por separado desde **7-zip.org**; no se incluye. Instálalo o actualízalo tú solo si quieres usar RAR aquí. Se rechazan los archivos RAR divididos en partes, autoextraíbles, con enlaces o con una estructura ambigua. Puedes seguir usando tu aplicación de Windows. No se ofrece crear RAR.

Consulta también: «Crear archivos comprimidos» y «Archivos comprimidos».
```

Existing `archives` help: replace its “passwords/RAR/bzip2 arrive later” paragraph with current password prompting, bzip2 support and the separate-installation/unsupported-layout limits, then add links to these two pages. Preserve the existing safe-name, bomb, Undo and extracted-copy explanations; disclose KI-079 in the technical report, not as a false “all extraction is fixed” claim.

## Check by hand (owner/coordinator, release app)

Use a newly generated retained disposable folder, never the owner's real documents. Passwords in these tests are synthetic; no real account password is requested.

| File / folder | Content |
|---|---|
| `notes.txt` | `First line` then `Second line`, CRLF |
| `docs/empty/` | empty directory |
| `docs/meeting = notes.txt` | `Meeting` |
| `docs/a_b.txt` | `Underscore` |
| `docs/@literal.txt` | `At sign` |
| `docs/ñandú.txt` | `Español` |
| `taken.zip` and `~taken.zip.partial` | distinct sentinel text; must remain unchanged |

1. Select notes/docs, create ZIP and 7z, browse each, open and extract content; verify exact bytes, empty folder, names and dates. New output is selected and sources unchanged. Create into the taken name: (1), then (2); old archive and old partial unchanged.
2. Create AES ZIP and AES 7z; show/hide, mismatch and length validation; verify the weak-compatibility warning appears only for explicitly chosen ZipCrypto. Test 7z hidden names both on/off; ZIP names remain visible.
3. Close/reopen with no remembered password; wrong password, Cancel and retry. Repeat with remembering and then restart: no remembered credential survives restart. Replacing the test archive invalidates its remembered credential.
4. Undo/Redo the created output; Redo restores that exact archive without asking for a password or recompressing changed sources. Cancel during compression and during parent publication; no complete archive is announced or overwrites a sentinel.
5. Exercise new bzip2 stream, concatenated members, tar.bz2 and bzip2 entries in ZIP/7z; corrupt/truncated, path traversal, duplicate names, source changes, required-MOTW failure and cancelled output must remain safe and report incomplete work.
6. If RAR is wanted, the owner installs current 7-Zip from its official site; the coordinator first verifies hidden-child startup, version/switch behavior, UTF-8 stdin password prompting, literal selection of underscore/equal/@ names, exact empty-file identity, child-job cancellation and multipart refusal. Only then run real single-volume password/plain RAR opening/extraction tests. These checks are **pending while the executable is absent**, not skipped passing tests. Unknown or unprovable layouts fail closed.
7. Repeat in Spanish dark and pseudo-locale, use Tab/Shift+Tab/Enter/Escape only, inspect focus and labels, read skipped results and try a removable destination disappearing during an operation. Do not test by removing a real drive holding personal files.

## Speed

| Interaction | Tier | Measurement |
|---|---|---|
| Open compression dialog | Instant (100 ms) | `open Compress to dialog` |
| Switch encryption option | Instant (100 ms) | `switch archive encryption option` |
| Open an encrypted small ZIP after submitting its password | Fast (1 s) | `open encrypted small ZIP` |
| Create small ZIP / AES 7z (one MiB input) | Waiting with feedback (10 s) | completion measurements from T12 |
| Large compression, source walk, RAR extraction | Background job | progress, Cancel, usable foreground; no fixed completion-time claim |
| Existing interactions | existing tiers | compare only valid matching baselines; missing comparison remains pending |

## Screenshots

`docs/screenshots/step-06e/`: `49-compress-dialog`, `50-password-open`, `51-compression-job` in English light, Spanish dark, pseudo-locale. Values remain masked. These dialogs have no dedicated design frame: compare with this guide, the existing Dialog/JobsPanel and measured tokens; record deviations. Dialog widths: compression width/max-width min(640px,92vw); password width/max-width min(480px,92vw). Body is scrollable within 80vh, fields one column with 12px gaps, labels above inputs, footer wraps with 8px gap. Use existing text/surface/border/radius/focus tokens; strength meter uses text plus value rather than color alone. Every modal initially focuses its first input and restores opener focus after closing.

## Done when

- [ ] Creation and password/Bzip2/RAR new mutations use owned staging, flush+sync, verified sizes/hash/authentication and no-replace publication; all original/sentinel bytes survive failures.
- [ ] ZIP/7z creation/encryption, optional 7z hidden names, explicit weak ZipCrypto, Bzip2 variants and bounded session-only credentials follow this recipe and its tests.
- [ ] External RAR selection/password/volume boundaries are proved with the actual installed version before RAR runtime support is called verified; absent/unproven capability remains explicitly pending/refused.
- [ ] Every new command is validated/registered/allowlisted and every string/help page is bilingual with regenerated pseudo-locale.
- [ ] Quick checks, coordinator gate, release-app functional/visual/contrast/focus checks and genuine speed records are recorded. No test or warning is weakened/hidden; open old issues remain open.
- [ ] Report/CHANGELOG/KNOWN_ISSUES distinguish implemented work, verified work, missing owner actions, old safety limitations and missing regression baselines. Local only; no tag, main merge or release until the owner's current process allows it.

## Research and implementation traps (2026-10-31)

- Installed primary sources checked: zip 9.1.3 `src/write/options.rs`, `src/unstable.rs`, writer API and Cargo features; sevenz-rust2 0.24.2 `archive.rs`, `block.rs`, `encoder_options.rs`, `writer.rs`, README and features. ZipCrypto's public extension requires an exact patch pin; sevenz's default AES cycle power is 8, overridden above. Do not infer an entry's encryption from the archive extension or hard-code library-private fields.
- bzip2 0.6.1 API reference: https://docs.rs/bzip2/0.6.1/bzip2/ and its `read::MultiBzDecoder` / `write::BzEncoder`. The backend license was already approved; record all resolved notices.
- Official 7-Zip sources: https://github.com/ip7z/7zip/blob/main/CPP/7zip/UI/Console/List.cpp ; https://github.com/ip7z/7zip/blob/main/CPP/Common/StdOutStream.cpp ; https://github.com/ip7z/7zip/blob/main/CPP/Common/StdInStream.cpp ; https://github.com/ip7z/7zip/blob/main/CPP/7zip/UI/Console/OpenCallbackConsole.cpp ; https://github.com/ip7z/7zip/blob/main/CPP/7zip/UI/Console/Main.cpp ; https://github.com/ip7z/7zip/blob/main/CPP/7zip/UI/Common/ArchiveCommandLine.cpp . These establish newline normalization, first-delimiter parsing needs, reading-password flags/stdin codepage, and `--` protection from @ list-file expansion. They do **not** constitute a local executable test or a filesystem sandbox.
- Program inventory found no 7-Zip in standard installed locations, PATH or the normal registry records. No program was installed and no actual password-pipe/RAR trial was run. The real-tool acceptance boundary above is mandatory.
- Existing large files are not refactoring targets: `archive.rs`, `extract.rs`, `ArchiveView.tsx` already exceed the newer size guideline. New logic goes in the named modules/hooks; integration adds only delegation. The existing writer remains KI-079, not silently “fixed” by adding a separate safe route.
- Tests at default limits must not allocate 8 GiB/1 TiB fixtures. Inject small limits and synthetic streams; the existing development PC has limited remaining disk space while two workers are active.

## Implementation corrections (2026-10-31)

Checked against the installed pinned sources while building; these do not
change any decision, only the names the code must use.

- ZipCrypto's public trait is `zip::unstable::write::FileOptionsExt`.
  `zip::write` only has a private inherent method. `SimpleFileOptions` is
  `FileOptions<'static, 'static, ()>`; an encrypted entry uses
  `FileOptions<'a, 'static, ()>` so the options borrow the exact password
  for the `start_file` call.
- 7z AES options are at `sevenz_rust2::encoder_options::AesEncoderOptions`;
  `NtTime::new` and the public `ArchiveEntry.last_modified_date` field carry
  timestamps.
- The app binary did not depend on `blake3` directly; it is added with its
  own `deps(app)` commit (already an approved workspace library).
  `fs-service` uses the existing `uuid` 1 crate for random staging names.
- Two additive helpers were needed: `OwnedOutput::keep` (a verified helper
  spool must outlive the helper) and `plan_create_with_exclusion` (D8's
  "exclude the chosen final archive/spool if it would be inside a selected
  tree").
- The guide names no UTC listing switch for 7-Zip. The parser accepts a
  timestamp only when it carries an explicit ` UTC` suffix and records 0
  otherwise; the real-tool acceptance check stays mandatory (KI-081).
- Abandoned app-owned spool folders are retained, not reclaimed: T9.4
  allows that fallback and requires `create_busy`/space instead of guessing
  ownership (KI-082).
