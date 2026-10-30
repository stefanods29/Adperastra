# Step 06a: Text editing

| | |
|---|---|
| State | guide |
| Difficulty | ★★ |
| Branch | `step-06a-text-editing` |
| Tag | `v0.0.14-step06a` |
| Depends on | 05d |
| Written before | P2 was built (written from the 04a, 04b and 04c recipes and the 05a to 05d guides; names from earlier guides are in `plan/guide-ledger.md`) |

This is a **guide** step (AGENTS.md "Steps come in two kinds"): every decision is below, but no code. Write the code exactly as described: the names, files, types, numbers and texts given here, and nothing else. If something you must write is not decided here, stop with `BLOCKED.md` (AGENTS.md section 5).

## Goal

Text, code and Markdown files can be edited in their tabs: type, undo and redo, save (Ctrl+S) and save as (Ctrl+Shift+S), find and replace (Ctrl+H), choose the encoding and line endings to save with, and turn spell checking on or off. Markdown gets a Split mode: the source on the left and the formatted page on the right, updated while typing. A dot on the tab shows unsaved changes; closing the tab, reloading, or closing the window asks first. Unsaved changes are kept in a recovery copy every few seconds, so after a crash the file offers them back. Saving is safe: the file is replaced only by a complete new copy, never written halfway, and a file changed by another program is never overwritten without asking.

## Do not do in this step

- No version history (Step 06b; this step adds only the no-op `before_modify` hook that Step 06b fills). No templates or New menu entries (Step 06c).
- No crash-recovery screen for the whole app (Step 09h); this step restores unsaved text per file when its tab opens.
- No editing of files over 10 MB (they stay read-only in parts, as in Step 04b), and no saving in Shift-JIS, GBK, Big5 or EUC-KR (they open read-only; Save as makes a UTF-8 copy).
- No choice of spelling language per document: the built-in checker uses the languages installed in Windows (added to `plan/backlog.md`).
- No automatic saving into the file itself (saving into the file happens only on Save); no code completion, formatting, or multiple cursors beyond CodeMirror's defaults.
- No editing in the image, audio, video or hex viewers.

## Read first

- `plan/conventions.md`, `plan/pitfalls.md` (P-03, P-07, P-08, P-10, P-19, P-20, P-25, P-28, P-30, P-31), `plan/rules.md` R-SAFE (all), R-SEC-1, R-SEC-8, R-FS-1, R-FS-6, R-FS-8, R-LANG-7.
- Recipes: `plan/recipes/add-tauri-command.md`, `plan/recipes/add-translation-keys.md`, `plan/recipes/add-help-page.md`.
- Code: `src/handlers/text/` (all files), `src/handlers/markdown/` (all files), `src/handlers/types.ts`, `src/views/FileTabView.tsx`, `src/services/tabs.ts`, `src/layout/TabStrip.tsx`, `src/ribbon/shortcuts.ts`, `src/App.tsx` (`closeTab`, the Ctrl+W handler, `windowAction`, the `FileTabView` element), `src-tauri/capabilities/main.json`, `src-tauri/src/settings_file.rs` (the dialog helpers), `src-tauri/src/files.rs` (`file_detect`), `crates/fs-service/src/state.rs` (`atomic_write`), `crates/fs-service/src/lib.rs`, the tests `src/__tests__/textFind.test.ts` and `src/__tests__/tabStrip.test.tsx`.

## Decisions (already made)

- D1. **One tab, view first, then edit.** Text and Markdown tabs open as today; when the text has loaded, editing turns on in place, unless one of these holds (then a note under the ribbon says which, and the text stays read-only): the file is over 10 MB (parts mode); protected view is on (until Unblock); the file has the Read-only attribute; its encoding cannot be saved (Shift-JIS, GBK, Big5, EUC-KR). In the last two cases **Save as…** still works (a UTF-8 copy for the encoding case).
- D2. **Safe save** (R-SAFE-3, R-SAFE-5): Rust calls the version hook `versions::before_modify` first; writes the new bytes to `~<name>.partial` next to the file and flushes them; then swaps it in with Windows' `ReplaceFileW`, which keeps the file's creation date, attributes and permissions. A failure removes only the partial file. A missing file (deleted meanwhile) is written by renaming the partial file into place.
- D3. **Changed on disk**: every save sends the modified time and size the tab last read or wrote; when the file on disk differs, Rust refuses (`textSave.changed_on_disk`) and the tab asks: **Overwrite**, **Reload** (drop my changes) or **Cancel**.
- D4. **Save as**: the Windows save dialog (the helpers from Step 05d move to a shared module). When the chosen file exists, Windows asks first; the old file goes to the Recycle Bin, then the new one is written (partial file, then rename; R-SAFE-2). The tab then shows the new file.
- D5. **Encodings**: the text is saved with a chosen "Save with" encoding: UTF-8, UTF-8 with BOM, UTF-16 LE, UTF-16 BE, Windows-1252, ISO-8859-15, Windows-1250, Windows-1251 (default: the file's own encoding and BOM when it can be saved; else UTF-8). Rust encodes: UTF-8 and UTF-16 itself, single-byte encodings with a 256-character table the UI builds with `TextDecoder` (no new library). A character the encoding cannot hold stops the save; the UI names its line and column first.
- D6. **Line endings**: Windows (CRLF) or Unix (LF); the default is the file's own (for mixed files the more frequent one, CRLF on a tie; CRLF for files without any line break). CodeMirror keeps `\n` inside; the text is joined with the chosen ending when saving.
- D7. **Unsaved changes**: a dot on the tab and the word "Unsaved changes" in the file tab's status bar; closing the tab (button, middle-click, Ctrl+W), reloading (F5, the reload button) and closing the window ask **Save**, **Don't save** or **Cancel** (the window asks once for all such tabs).
- D8. **Recovery copies**: 2 s after the last change, and when the tab is hidden, Rust writes the text to `recovery/<key>.json` in the data folder (crash-safe write, off the UI thread). A save or "Don't save" deletes it. When a file tab opens a file that has a recovery copy, a bar offers **Restore** (the text comes back as unsaved changes) or **Discard**, and says when the file was changed after the copy was made. At most 50 copies of at most 32 MiB each (the oldest are removed).
- D9. **Find and replace**: the search box (Step 04b) keeps finding; Ctrl+H opens a row under the navigation row with **Replace with**, **Match case**, **Whole word**, **Replace** and **Replace all** (one undo step). Match case and Whole word also apply to the search box.
- D10. **Markdown**: three modes on the ribbon: **Reading view**, **Source** (now editable) and **Split** (editable source on the left, the page on the right, re-rendered 300 ms after typing, through the same safe page renderer as Step 04b).
- D11. **Spelling**: a ribbon toggle **Check spelling** per document (saved in the tab's view state; default on for `.txt`, `.md`, `.markdown`, off otherwise) turns on the webview's own checker (Windows' dictionaries), with the app language as the text's language.
- D12. **Keys**: CodeMirror's default keys plus undo and redo (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z), Ctrl+] and Ctrl+[ to indent; Tab moves the focus out of the editor (accessibility). Ctrl+S saves and Ctrl+Shift+S saves as. `useCommandShortcuts` no longer runs a command for a key that the focused control has already handled, so a key is never acted on twice.
- D13. **Fonts**: the editor's font list gets monospaced CJK fallbacks that come with Windows (referenced by name, never shipped): `MS Gothic`, `NSimSun`, `GulimChe`. CodeMirror handles IME input.
- D14. The handler contract gets two optional fields (`Handler.editable`, `Handler.supportsReplace`), three optional view props (`onDirtyChange`, `registerSave`, `onPathChange`) and two optional `FindRequest` fields (`options`, `replace`). Existing handlers and tests stay valid.

## Data shapes

### Rust: `TextSaveRequest` (`src-tauri/src/text_save.rs`)

| Field | Rust type | TypeScript | Validation |
|---|---|---|---|
| `path` | `String` | `string` | `validate_absolute_path`; else `textSave.bad_request` |
| `text` | `String` | `string` | at most `MAX_SAVE_TEXT_BYTES` (33,554,432) bytes of UTF-8; else `textSave.too_large` |
| `encoding` | `String` | `SaveEncodingId` | one of the eight ids of "Save encodings"; else `textSave.bad_request` |
| `table` | `Option<Vec<String>>` | `string[] \| null` | required for the five single-byte ids: exactly 256 entries, each one character (a `char`); else `textSave.bad_request` |
| `mode` | `String` | `"save" \| "saveAs"` | else `textSave.bad_request` |
| `expected_modified_unix` | `Option<u64>` | `number \| null` | used by `save` |
| `expected_size` | `Option<u64>` | `number \| null` | used by `save` |
| `force` | `bool` | `boolean` | `save` only: true skips the changed-on-disk check (after the user chose Overwrite) |

Returns `SavedFile`: `path` (display form), `size` (`u64`), `modified_unix` (`u64`).

### Save encodings (`src/editor/saveEncoding.ts`, mirrored in Rust)

| Id | Label | Bytes |
|---|---|---|
| `utf-8` | UTF-8 | UTF-8, no BOM |
| `utf-8-bom` | UTF-8 with BOM | EF BB BF, then UTF-8 |
| `utf-16le` | UTF-16 LE | FF FE, then UTF-16 little-endian |
| `utf-16be` | UTF-16 BE | FE FF, then UTF-16 big-endian |
| `windows-1252` | Windows-1252 | one byte per character, table |
| `iso-8859-15` | ISO-8859-15 | table |
| `windows-1250` | Windows-1250 | table |
| `windows-1251` | Windows-1251 | table |

`ENCODINGS` of Step 04b also has `iso-8859-1` (in browsers it is Windows-1252: its save choice is `windows-1252`), and four that cannot be saved: `shift_jis`, `gbk`, `big5`, `euc-kr`.

### Recovery copy (`recovery/<key>.json`, fs-service `drafts.rs`)

| Field | Rust | TypeScript | Notes |
|---|---|---|---|
| `schema_version` | `u32` | `number` | 1 |
| `path` | `String` | `string` | the file's display path |
| `text` | `String` | `string` | the editor's text with `\n` line breaks |
| `saved_unix` | `u64` | `number` | when the copy was written |
| `file_modified_unix` | `u64` | `number` | the file's modified time when the tab last read or saved it |

`<key>` = 16 lower-case hex digits of the 64-bit FNV-1a hash of the lower-case display path (offset basis 14695981039346656037, prime 1099511628211, over the UTF-8 bytes).

### New TypeScript exports

| Name | File | Shape / behavior |
|---|---|---|
| `SaveEncodingId`, `SAVE_ENCODINGS`, `SAVE_ENCODING_LABELS` | `src/editor/saveEncoding.ts` | the table above |
| `LineEndingChoice` | same | `"crlf"` or `"lf"` |
| `Handler.editable` | `src/handlers/types.ts` | optional boolean: the view can edit and save (text, Markdown) |
| `Handler.supportsReplace` | same | optional boolean: the view follows replace requests (text, Markdown) |
| `FindRequest.options` | same | optional `{ caseSensitive: boolean; wholeWord: boolean }` |
| `FindRequest.replace` | same | optional `{ text: string; request: number; all: boolean }`: a new `request` number asks for one replacement (or all when `all`) |
| `HandlerViewProps.onDirtyChange` | same | optional (`dirty: boolean`) |
| `SaveHandle` | same | `save` (function returning `Promise<boolean>`: true when saved) and `discard` (function: forget the unsaved changes and their recovery copy) |
| `HandlerViewProps.registerSave` | same | optional (`handle`: `SaveHandle` or `null`) |
| `HandlerViewProps.onPathChange` | same | optional (`path: string`): the file was saved under a new name |
| `setTabPath` | `src/services/tabs.ts` | (`state`, `id`, `path`, `title`) returns `TabsState`: that file tab with the new path and title |

### Constants

| Name | File | Value |
|---|---|---|
| `MAX_SAVE_TEXT_BYTES` | `text_save.rs` | 33,554,432 |
| `MAX_DRAFT_BYTES` | fs-service `drafts.rs` | 33,554,432 |
| `MAX_DRAFTS` | `drafts.rs` | 50 |
| `DRAFT_DELAY_MS` | `src/editor/useTextDocument.ts` | 2000 |
| `PREVIEW_DELAY_MS` | `src/handlers/markdown/MarkdownView.tsx` | 300 |

### Tauri commands

| Command (module) | Arguments | Returns | Errors |
|---|---|---|---|
| `text_save` (`text_save.rs`) | `request: TextSaveRequest` | `SavedFile` | `textSave.bad_request`, `too_large`, `unmappable`, `cannot_encode`, `changed_on_disk`, `read_only`, `in_use`, `not_found`, `recycle_failed`, `write_failed`, `other` |
| `text_pick_save_path` (`text_save.rs`) | `title`, `file_name`, `filter_name` (strings) | `Option<String>` | `textSave.bad_request`, `textSave.other` |
| `recovery_write` (`recovery.rs`) | `path: String`, `text: String`, `file_modified_unix: u64` | nothing | `recovery.bad_request`, `recovery.too_large`, `recovery.other` |
| `recovery_read` (`recovery.rs`) | `path: String` | `Option<Draft>` | `recovery.bad_request`, `recovery.other` |
| `recovery_delete` (`recovery.rs`) | `path: String` | nothing | `recovery.bad_request`, `recovery.other` |

### Commands (text and Markdown viewers, context `TextCtx` / `MarkdownCtx` gain `editable`, `dirty`, `canSaveAs`)

| Command id | Label key | Icon (lucide) | Shortcut | Enabled when |
|---|---|---|---|---|
| `text.save` | `editor.save` | `Save` | Ctrl+S | editable and dirty |
| `text.saveAs` | `editor.saveAs` | `SaveAll` | Ctrl+Shift+S | `canSaveAs` (not in parts mode) |
| `text.undo` | `editor.undoHint` | `Undo2` | (none: CodeMirror handles Ctrl+Z) | editable and there is something to undo |
| `text.redo` | `editor.redoHint` | `Redo2` | (none) | editable and there is something to redo |
| `text.spellcheck` | `editor.spellcheck` | `SpellCheck` | | always (toggle) |
| `markdown.split` | `markdown.splitMode` | `Columns2` | | always (radio) |

The Markdown viewer uses the same ids prefixed `markdown.` for save, save as, undo, redo and spelling (`markdown.save`, `markdown.saveAs`, `markdown.undo`, `markdown.redo`, `markdown.spellcheck`), with help slug `editing-text-and-code`; the text ones use `editing-text-and-code` too. Undo and redo show "Ctrl+Z" and "Ctrl+Y" in their tooltips through the label (`editor.undoHint`, `editor.redoHint`), because a `shortcut` would make the key run twice.

### Translation keys (all new keys of this step)

| Key | English | Spanish |
|---|---|---|
| `editor.save` | Save | Guardar |
| `editor.saveAs` | Save as… | Guardar como… |
| `editor.undoHint` | Undo (Ctrl+Z) | Deshacer (Ctrl+Z) |
| `editor.redoHint` | Redo (Ctrl+Y) | Rehacer (Ctrl+Y) |
| `editor.spellcheck` | Check spelling | Revisar ortografía |
| `editor.saveWith` | Save with | Guardar con |
| `editor.lineEndings` | Line endings | Finales de línea |
| `editor.lineEndingCrlf` | Windows (CRLF) | Windows (CRLF) |
| `editor.lineEndingLf` | Unix (LF) | Unix (LF) |
| `editor.file` | File | Archivo |
| `editor.edit` | Edit | Edición |
| `editor.unsaved` | Unsaved changes | Cambios sin guardar |
| `editor.saved` | Saved | Guardado |
| `editor.readOnlyLarge` | This file is too large to edit here. It opens read-only, in parts. | Este archivo es demasiado grande para editarlo aquí. Se abre en modo de solo lectura, por partes. |
| `editor.readOnlyProtected` | Editing is off for files from the internet. Unblock the file to edit it. | La edición está desactivada para los archivos de Internet. Desbloquea el archivo para editarlo. |
| `editor.readOnlyAttribute` | This file is read-only. Use Save as… to save a copy. | Este archivo es de solo lectura. Usa Guardar como… para guardar una copia. |
| `editor.readOnlyEncoding` | Files in {encoding} can be read but not saved. Use Save as… to save a copy in UTF-8. | Los archivos en {encoding} se pueden leer, pero no guardar. Usa Guardar como… para guardar una copia en UTF-8. |
| `editor.unmappable` | “{char}” on line {line}, column {column} can't be saved in {encoding}. Choose UTF-8 in Save with. | “{char}” en la línea {line}, columna {column}, no se puede guardar en {encoding}. Elige UTF-8 en Guardar con. |
| `editor.changedTitle` | This file changed on disk | Este archivo cambió en el disco |
| `editor.changedBody` | Another program changed {name} after you opened it. | Otro programa cambió {name} después de que lo abriste. |
| `editor.overwrite` | Overwrite | Sobrescribir |
| `editor.reload` | Reload | Volver a cargar |
| `editor.saveAsTitle` | Save as | Guardar como |
| `editor.allFiles` | All files | Todos los archivos |
| `editor.unsavedTitle` | Save changes to {name}? | ¿Guardar los cambios en {name}? |
| `editor.unsavedBody` | Your changes will be lost if you don't save them. | Tus cambios se perderán si no los guardas. |
| `editor.unsavedManyTitle` | Save your changes? | ¿Guardar los cambios? |
| `editor.unsavedManyBody` | {count, plural, one {# file has unsaved changes:} other {# files have unsaved changes:}} | {count, plural, one {# archivo tiene cambios sin guardar:} other {# archivos tienen cambios sin guardar:}} |
| `editor.saveAll` | Save all | Guardar todo |
| `editor.dontSave` | Don't save | No guardar |
| `editor.recovered` | Unsaved changes from {time} were kept for this file. | Se conservaron los cambios sin guardar de {time} para este archivo. |
| `editor.recoveredChanged` | Unsaved changes from {time} were kept for this file, but the file changed after that. | Se conservaron los cambios sin guardar de {time} para este archivo, pero el archivo cambió después. |
| `editor.restore` | Restore | Restaurar |
| `editor.discard` | Discard | Descartar |
| `editor.replaceWith` | Replace with | Reemplazar con |
| `editor.replace` | Replace | Reemplazar |
| `editor.replaceAll` | Replace all | Reemplazar todo |
| `editor.matchCase` | Match case | Coincidir mayúsculas y minúsculas |
| `editor.wholeWord` | Whole word | Palabra completa |
| `editor.closeReplace` | Close replace | Cerrar reemplazar |
| `markdown.splitMode` | Split | Dividida |
| `errors.textSave.other` | Couldn't save the file. Try again. | No se pudo guardar el archivo. Vuelve a intentarlo. |
| `errors.textSave.bad_request` | This file can't be saved here. | Este archivo no se puede guardar aquí. |
| `errors.textSave.too_large` | The text is too large to save. | El texto es demasiado grande para guardarlo. |
| `errors.textSave.unmappable` | Some characters can't be saved in this encoding. Choose UTF-8 in Save with. | Algunos caracteres no se pueden guardar con esta codificación. Elige UTF-8 en Guardar con. |
| `errors.textSave.cannot_encode` | This encoding can't be saved. Use Save as… to save a copy in UTF-8. | Esta codificación no se puede guardar. Usa Guardar como… para guardar una copia en UTF-8. |
| `errors.textSave.changed_on_disk` | The file changed on disk. | El archivo cambió en el disco. |
| `errors.textSave.read_only` | The file is read-only. Use Save as… to save a copy. | El archivo es de solo lectura. Usa Guardar como… para guardar una copia. |
| `errors.textSave.in_use` | Another program is using the file. Close it there and save again. | Otro programa está usando el archivo. Ciérralo allí y vuelve a guardar. |
| `errors.textSave.not_found` | The folder of this file no longer exists. Use Save as… | La carpeta de este archivo ya no existe. Usa Guardar como… |
| `errors.textSave.recycle_failed` | The file you chose couldn't be moved to the Recycle Bin, so nothing was saved. | No se pudo mover a la Papelera de reciclaje el archivo que elegiste, así que no se guardó nada. |
| `errors.textSave.write_failed` | Couldn't write the file. Your text is still here; try again or use Save as… | No se pudo escribir el archivo. Tu texto sigue aquí; vuelve a intentarlo o usa Guardar como… |
| `errors.recovery.other` | Couldn't keep a recovery copy of your changes. | No se pudo guardar una copia de recuperación de tus cambios. |
| `errors.recovery.bad_request` | That recovery copy isn't valid. | Esa copia de recuperación no es válida. |
| `errors.recovery.too_large` | The text is too large for a recovery copy. Save it soon. | El texto es demasiado grande para una copia de recuperación. Guárdalo pronto. |

After editing `en.json`, run `npm run i18n:pseudo`.

## Tasks

After changing Rust code, run `cargo fmt --all` before the gate.

### T1 - Safe replace of a file's content (fs-service)

**Files:** create `crates/fs-service/src/save.rs`, `crates/fs-service/tests/step06a_save_tests.rs`; modify `crates/fs-service/src/lib.rs`.

**Do this:** module doc comment "Safe save of a file's new content (Step 06a): partial file, flush, then replace. Never writes the target halfway (R-SAFE-3)." Exports (re-exported from `lib.rs`):

| Item | Kind | Content / behavior |
|---|---|---|
| `SaveExpect` | struct (`Debug`, `Clone`, `Copy`, `PartialEq`, `Eq`) | `modified_unix: u64`, `size: u64` |
| `SaveError` | enum (`Debug`, `PartialEq`, `Eq`) | `ChangedOnDisk`, `ReadOnly`, `InUse`, `FolderMissing`, `TargetExists`, `RecycleFailed`, `Io(String)` |
| `recycle_target` | fn (`target: &Path`) returns `Result<(), SaveError>` | sends an existing target to the Recycle Bin with `trash::delete` (Save as over an existing file, R-SAFE-2); a failure gives `RecycleFailed`; a missing target is Ok |
| `SavedInfo` | struct (`Debug`, `Clone`, `PartialEq`, `Eq`) | `size: u64`, `modified_unix: u64` |
| `partial_path` | fn (`target: &Path`) returns `PathBuf` | the same folder, file name `~` + the target's file name + `.partial` |
| `replace_contents` | fn (`target: &Path`, `bytes: &[u8]`, `expect: Option<SaveExpect>`) returns `Result<SavedInfo, SaveError>` | in order: 1. When the target exists: its metadata; the Read-only attribute gives `ReadOnly`; when `expect` is given and the modified time (seconds since 1970) or the size differs, `ChangedOnDisk`. 2. When the target's folder does not exist, `FolderMissing`. 3. Write `bytes` to `partial_path(target)` (create or truncate), `sync_all`. A failure removes the partial file and gives `Io` (a sharing violation, Windows error 32, gives `InUse`). 4. When the target exists: replace it with the partial file using `ReplaceFileW` (no backup file, flag `REPLACEFILE_IGNORE_MERGE_ERRORS`); otherwise rename the partial file to the target. On failure remove the partial file; Windows error 32 gives `InUse`, others `Io`. 5. Return the target's new size and modified time. |
| `write_new_file` | fn (`target: &Path`, `bytes: &[u8]`) returns `Result<SavedInfo, SaveError>` | `TargetExists` when the target exists; `FolderMissing` when its folder does not; otherwise steps 3 and 5 of `replace_contents` with a rename at the end (for Save as, after the old file went to the Recycle Bin) |

Wrap the `ReplaceFileW` call in a small function with a `// SAFETY:` comment (wide strings that outlive the call). Never call `remove_file` on the target (P-08); only the partial file is ever removed.

**Tests** (`tempfile::tempdir()`):

| Test | Steps | Expected |
|---|---|---|
| `replaces_the_content_and_leaves_no_partial_file` | write `a.txt` "old"; `replace_contents` with "new" and the expectation from its metadata | Ok; the file reads "new"; no `~a.txt.partial` |
| `refuses_when_the_file_changed_on_disk` | expectation with size 999 | `ChangedOnDisk`; the file still reads "old" |
| `refuses_a_read_only_file` | set the Read-only attribute; replace | `ReadOnly`; content unchanged; clear the attribute at the end |
| `writes_a_file_that_was_deleted` | replace a target that does not exist (folder exists), no expectation | Ok; the file reads the new bytes |
| `reports_a_missing_folder` | target in a folder that does not exist | `FolderMissing` |
| `write_new_file_never_overwrites` | `write_new_file` on an existing file; on a new name | `TargetExists` and the old content kept; then Ok |
| `keeps_the_creation_time` | read `a.txt`'s creation time; wait 1.1 s; replace | the creation time is the same |
| `partial_path_sits_next_to_the_target` | `C:\x\a.txt` | `C:\x\~a.txt.partial` |

**Commit:** `feat(fs-service): safe replace of a file's content [step-06a/T1]`

### T2 - Saving text: version hook, encodings, the save command

**Files:** create `src-tauri/src/versions.rs`, `src-tauri/src/text_save.rs`, `src/services/textFiles.ts`; modify `src-tauri/src/main.rs`, `src-tauri/isolation/index.html`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** every `errors.textSave.*` key.

**Do this (`versions.rs`):** module doc comment "Version hook (contract 19). Step 06a: a no-op; Step 06b keeps a snapshot here before any change." A public enum `ModifyReason` (`Save`, `SaveAs`) and a public function `before_modify(path: &Path, reason: ModifyReason) -> Result<(), String>` that returns `Ok(())` (both parameters unused, named with a leading underscore).

**Do this (`text_save.rs`):** module doc comment "Saving text files (Step 06a): encode, version hook, safe replace." Contents:

1. `TextSaveRequest` and `SavedFile` (Data shapes; `Debug`, `Clone`, `Serialize`, `Deserialize`), the constant `MAX_SAVE_TEXT_BYTES`, and `SINGLE_BYTE_IDS`: `windows-1252`, `iso-8859-15`, `windows-1250`, `windows-1251`.
2. Pure `encode_text(text: &str, encoding: &str, table: Option<&[String]>) -> Result<Vec<u8>, String>`: `utf-8`: the bytes; `utf-8-bom`: EF BB BF then the bytes; `utf-16le`/`utf-16be`: FF FE / FE FF then each UTF-16 unit in that byte order; a single-byte id: `table` must have 256 entries of one character each (else `textSave.bad_request`); build a map from each entry's character to its byte index, skipping U+FFFD; every character of the text must be in the map (else `textSave.unmappable`); `shift_jis`, `gbk`, `big5`, `euc-kr`: `textSave.cannot_encode`; anything else `textSave.bad_request`.
3. Pure `check_request(request: &TextSaveRequest) -> Result<(), String>` with the validation column of `TextSaveRequest`.
4. Pure `save_error_code(error: &fs_service::SaveError) -> String`: `ChangedOnDisk` gives `textSave.changed_on_disk`, `ReadOnly` `textSave.read_only`, `InUse` `textSave.in_use`, `FolderMissing` `textSave.not_found`, `RecycleFailed` `textSave.recycle_failed`, `TargetExists` `textSave.write_failed`, `Io` `textSave.write_failed`.
5. Command `text_save(window, request)` (async): `ensure_main`; `check_request`; in `spawn_blocking`: `encode_text`; `crate::versions::before_modify(path, Save or SaveAs)`; mode `save`: `fs_service::replace_contents` with the expectation built from the two expected fields when both are present and `force` is false; mode `saveAs`: `fs_service::recycle_target` first (nothing is written when it fails), then `fs_service::write_new_file`. Map errors with `save_error_code`. Return `SavedFile` with the path without `\\?\`.
6. Tests at the bottom: `encodes_utf8_and_utf16_with_their_marks` ("Aé" as `utf-8` is 41 C3 A9; `utf-8-bom` starts EF BB BF; `utf-16le` is FF FE 41 00 E9 00; `utf-16be` is FE FF 00 41 00 E9); `encodes_single_byte_text_with_the_table` (a table where index 233 is "é" and index 65 is "A", the rest "\u{FFFD}": "Aé" gives 41 E9; "A€" gives `textSave.unmappable`; a table of 255 entries gives `textSave.bad_request`); `refuses_encodings_that_cannot_be_saved` (`shift_jis` gives `textSave.cannot_encode`; `klingon` gives `textSave.bad_request`); `checks_the_request` (a relative path, `mode` `append`, and a single-byte id without a table each give `textSave.bad_request`).

**Do this (`main.rs`, isolation):** `mod versions;`, `mod text_save;`; `text_save::text_save` in `generate_handler!` and `'text_save'` in `ALLOWED`.

**Do this (`src/services/textFiles.ts`):** the interfaces `TextSaveRequest` and `SavedFile` (snake_case, mirroring Rust) and `saveText(request: TextSaveRequest): Promise<SavedFile>` (invokes `text_save` with `{ request }`).

**Commit:** `feat(editor): save text safely with the version hook [step-06a/T2]`

### T3 - Shared file dialogs and Save as

**Files:** create `src-tauri/src/file_dialogs.rs`; modify `src-tauri/src/settings_file.rs`, `src-tauri/src/text_save.rs`, `src-tauri/src/main.rs`, `src-tauri/isolation/index.html`, `src/services/textFiles.ts`.

**Do this:**
1. Move the Windows dialog helpers of `settings_file.rs` (Step 05d T8 step 3) into `file_dialogs.rs` unchanged in behavior, as two crate-visible functions: `pick_save_path(owner: isize, title: &str, file_name: &str, filter_name: &str, pattern: &str, default_extension: &str) -> Result<Option<String>, String>` and `pick_open_path(owner: isize, title: &str, filter_name: &str, pattern: &str) -> Result<Option<String>, String>`; errors are the plain code `dialog.failed` and each caller maps it to its own `<area>.other`. `settings_file.rs` calls them with pattern `*.json` and default extension `json`. Module doc comment: "Windows open and save dialogs (Step 05d, shared since Step 06a). Call from a blocking thread."
2. `text_save.rs`: command `text_pick_save_path(window, title, file_name, filter_name)` (async): `ensure_main`; titles and filter names at most 200 characters and not empty, the file name at most 255 characters and passing `fs_service::validate_new_name` (else `textSave.bad_request`); in `spawn_blocking`, `file_dialogs::pick_save_path` with the owner window, pattern `*.*` and the default extension = the file name's extension (empty when none); `dialog.failed` becomes `textSave.other`.
3. `main.rs`: `mod file_dialogs;`; register `text_save::text_pick_save_path`; add `'text_pick_save_path'` to `ALLOWED`.
4. `textFiles.ts`: `pickSavePath(title, fileName, filterName)`, returns `Promise<string | null>` (invokes `text_pick_save_path` with `{ title, fileName, filterName }`).

**Tests:** the existing `settings_file.rs` tests pass unchanged; add in `text_save.rs` `checks_save_dialog_texts` testing the pure check (make it a pure function `check_dialog_texts(title, file_name, filter_name)`): (`Save as`, `notes.txt`, `All files`) ok; an empty title, a file name `CON`, a 256-character name each `textSave.bad_request`.

**Commit:** `refactor(dialogs): shared Windows file dialogs and Save as path [step-06a/T3]`

### T4 - Recovery copies

**Files:** create `crates/fs-service/src/drafts.rs`, `crates/fs-service/tests/step06a_drafts_tests.rs`, `src-tauri/src/recovery.rs`, `src/services/recovery.ts`; modify `crates/fs-service/src/lib.rs`, `src-tauri/src/main.rs`, `src-tauri/isolation/index.html`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** every `errors.recovery.*` key.

**Do this (`drafts.rs`):** module doc comment "Recovery copies of unsaved text (Step 06a): one JSON file per document in <data>/recovery." Exports: `DRAFTS_SCHEMA` (1), `MAX_DRAFT_BYTES`, `MAX_DRAFTS`, struct `Draft` (the "Recovery copy" fields; `Debug`, `Clone`, `PartialEq`, `Eq`, `Serialize`, `Deserialize`; `schema_version` defaults to 1), and functions:

| Function | Parameters | Returns | Behavior |
|---|---|---|---|
| `draft_key` | `path: &str` | `String` | the FNV-1a key of "Recovery copy", computed on the display path (no `\\?\`) in lower case |
| `write_draft` | `dir: &Path`, `draft: &Draft` | `Result<(), String>` | `recovery.too_large` when the text is longer than `MAX_DRAFT_BYTES`; create `dir`; write pretty JSON with `crate::state::atomic_write` to `<dir>/<key>.json`; then `trim_drafts(dir)`; I/O errors give `recovery.other` |
| `read_draft` | `dir`, `path: &str` | `Option<Draft>` | the parsed file for that key whose `path` is the same path ignoring case; a missing, unreadable or other file gives `None` |
| `delete_draft` | `dir`, `path` | `Result<(), String>` | remove `<dir>/<key>.json` when it exists (this is our own recovery file, not a user file); errors give `recovery.other` |
| `trim_drafts` | `dir` | nothing | when more than `MAX_DRAFTS` `.json` files are in `dir`, remove the ones with the oldest modified time until `MAX_DRAFTS` remain |

**Do this (`recovery.rs`):** three async commands (`ensure_main`; `validate_absolute_path` gives `recovery.bad_request`; text longer than `MAX_DRAFT_BYTES` gives `recovery.too_large`; work in `spawn_blocking`; the folder is `<data_dir>/recovery` from the managed `AppState`): `recovery_write(window, path, text, file_modified_unix)` (builds a `Draft` with `saved_unix` = `crate::unix_now()`), `recovery_read(window, path)`, `recovery_delete(window, path)`. Register all three; add them to `ALLOWED`.

**Do this (`src/services/recovery.ts`):** the interface `Draft` (snake_case) and `writeDraft(path, text, fileModifiedUnix)`, `readDraft(path)` (returns `Draft | null`; outside Tauri `null`), `deleteDraft(path)`; outside Tauri the first and last do nothing.

**Tests** (`step06a_drafts_tests.rs`):

| Test | Steps | Expected |
|---|---|---|
| `draft_key_ignores_case_and_the_long_path_prefix` | `C:\A\b.txt`, `c:\a\B.TXT`, `\\?\C:\A\b.txt` | the same 16-character key; `C:\A\c.txt` differs |
| `writes_reads_and_deletes_a_draft` | write a draft for `C:\A\b.txt`; read `c:\a\b.txt`; delete; read | the same draft; then `None` |
| `refuses_a_too_large_text` | text of `MAX_DRAFT_BYTES` + 1 bytes | `recovery.too_large`; no file written |
| `keeps_at_most_50_drafts` | write 52 drafts for different paths (set increasing modified times by writing them in order with a 10 ms pause) | 50 files remain; the first two paths read `None` |

**Commit:** `feat(editor): recovery copies of unsaved text [step-06a/T4]`

### T5 - Pure editor rules

**Files:** create `src/editor/saveEncoding.ts`, `src/__tests__/saveEncoding.test.ts`.

**Do this:** module doc comment "Save encodings, line endings and the read-only rules of the editor (Step 06a). Pure." Exports `SaveEncodingId`, `SAVE_ENCODINGS`, `SAVE_ENCODING_LABELS` (Data shapes), `LineEndingChoice`, `ReadOnlyReason` (`"large"`, `"protected"`, `"attribute"`, `"encoding"`), and:

| Function | Parameters | Returns | Behavior |
|---|---|---|---|
| `canSaveEncoding` | `encoding: EncodingName` | boolean | false for `shift_jis`, `gbk`, `big5`, `euc-kr`; true otherwise |
| `defaultSaveEncoding` | `encoding: EncodingName`, `hadBom: boolean` | `SaveEncodingId` | `utf-8` with BOM: `utf-8-bom`; `utf-8`: `utf-8`; `utf-16le`/`utf-16be`: the same; `windows-1252` and `iso-8859-1`: `windows-1252`; `iso-8859-15`, `windows-1250`, `windows-1251`: the same; the four others: `utf-8` |
| `singleByteTable` | `id: SaveEncodingId` | `string[]` or `null` | `null` for the UTF ids; otherwise the 256 strings `new TextDecoder(id).decode(Uint8Array.of(i))` for `i` from 0 to 255 |
| `firstUnmappable` | `text: string`, `table: readonly string[]` | `{ char: string; line: number; column: number }` or `null` | the first character (by code point) of `text` that is not in `table` (U+FFFD entries do not count); `line` and `column` start at 1 (a `\n` starts a new line) |
| `defaultLineEnding` | `text: string` | `LineEndingChoice` | count `\r\n` and lone `\n`: `lf` when lone `\n` are more; otherwise `crlf` (also with no line breaks) |
| `joinLines` | `lines: readonly string[]`, `ending: LineEndingChoice` | string | the lines joined with `\r\n` or `\n` |
| `readOnlyReason` | `{ paged, protectedView, readOnly, encoding }` (booleans and an `EncodingName`) | `ReadOnlyReason` or `null` | in this order: `large` when `paged`; `protected`; `attribute` when `readOnly`; `encoding` when `canSaveEncoding` is false; else `null` |
| `spellcheckDefault` | `ext: string` | boolean | true for `txt`, `md`, `markdown`; false otherwise |

**Tests** (`src/__tests__/saveEncoding.test.ts`):

| Test | Input | Expected |
|---|---|---|
| "default save encodings keep the file's own" | (`utf-8`, true); (`utf-8`, false); (`iso-8859-1`, false); (`windows-1251`, false); (`gbk`, false) | `utf-8-bom`; `utf-8`; `windows-1252`; `windows-1251`; `utf-8` |
| "single-byte tables come from the browser" | `singleByteTable("windows-1252")`; `singleByteTable("utf-8")` | 256 entries, entry 233 is "é", entry 128 is "€"; `null` |
| "firstUnmappable names the line and column" | "ab\ncdé" with the Windows-1251 table; "abc" with the Windows-1252 table | `{ char: "é", line: 2, column: 3 }`; `null` |
| "defaultLineEnding picks the most common" | "a\r\nb\r\nc\nd"; "a\nb\nc\r\nd"; "a\r\nb\nc"; "abc" | `crlf`; `lf`; `crlf` (tie); `crlf` |
| "joinLines uses the chosen ending" | [`a`, `b`, ``] with `crlf`; with `lf` | "a\r\nb\r\n"; "a\nb\n" |
| "readOnlyReason checks in order" | all false and `utf-8`; `paged` and `protectedView`; `protectedView` and `readOnly`; `readOnly` and `shift_jis`; only `big5` | `null`; `large`; `protected`; `attribute`; `encoding` |
| "spelling is on for prose" | `txt`; `md`; `js` | true; true; false |

**Commit:** `feat(editor): save encodings, line endings and read-only rules [step-06a/T5]`

### T6 - Editing extensions and one key, one action

**Files:** modify `src/handlers/text/editorSetup.ts`, `src/ribbon/shortcuts.ts`, `src/__tests__/textFind.test.ts`, `src/__tests__/ribbon.test.tsx`.

**Do this:**
1. `shortcuts.ts`, in `useCommandShortcuts`' key handler: return at once when `event.defaultPrevented` is true (a control such as the editor already handled the key). Update the doc comment with that sentence.
2. `editorSetup.ts`:
   - The `.cm-scroller` font family becomes `"Cascadia Mono", Consolas, "Courier New", "MS Gothic", NSimSun, GulimChe, monospace`.
   - New export `editableExtensions(options: { phrases: Record<string, string> })` returning the same list as `readOnlyExtensions` except: no `EditorState.readOnly`; `history()`; the keymap is `defaultKeymap` plus `historyKeymap` (from `@codemirror/commands`, already installed); `EditorView.contentAttributes.of({ autocapitalize: "off", autocorrect: "off" })`. Do not add `indentWithTab` (Tab must leave the editor).
   - New export `spellcheckAttributes(on: boolean, lang: string)` returning `EditorView.contentAttributes.of({ spellcheck: on ? "true" : "false", lang })`.
   - `runFind` gets a fourth optional parameter `options` (`{ caseSensitive: boolean; wholeWord: boolean }`, default both false) used in the `SearchQuery` (`caseSensitive`, `wholeWord`). New export `runReplace(view, search: string, replace: string, all: boolean, options)`: does nothing when `search` is empty; otherwise sets the query (with `replace`) like `runFind` and calls `replaceAll(view)` or `replaceNext(view)` from `@codemirror/search`.

**Tests:**
- `textFind.test.ts`: the three existing tests unchanged; add "edits, undoes and redoes" (an `EditorView` with `editableExtensions`: dispatch an insertion of "x" at 0 with the user event `input.type`; `undo(view)` from `@codemirror/commands` brings the text back; `redo(view)` re-applies it; `view.state.readOnly` is false), "match case and whole word narrow the search" (text "Cat cat category": `runFind(view, "cat", "here", { caseSensitive: true, wholeWord: true })` selects 4 to 7) and "replace one or all" (text "a a a": `runReplace(view, "a", "b", false, both false)` then the text starts with "b"; `runReplace(view, "a", "b", true, …)` gives "b b b"; after one `undo(view)` the text is "b a a").
- `ribbon.test.tsx`: add "a key the focused control handled runs nothing" (a command with shortcut `Ctrl+B`; dispatch a cancelable Ctrl+B `keydown` on a `div` inside the document whose own listener calls `preventDefault`, then a plain one on `window`: the command ran once, for the second event only).

**Commit:** `feat(editor): editing extensions, CJK fonts, and one action per key [step-06a/T6]`

### T7 - The text document hook

**Files:** create `src/editor/useTextDocument.ts`, `src/__tests__/useTextDocument.test.tsx`.

**Do this:** module doc comment "One text document in a tab (Step 06a): loads, edits, saves, keeps recovery copies. Used by the text and Markdown views." Export the hook `useTextDocument(options)` with these options and results. It replaces the loading and editor code of `TextView` (T8 moves `TextView` onto it) and is written so `MarkdownView` can use it too (T10).

Options:

| Option | Type | Meaning |
|---|---|---|
| `info` | `FileTypeInfo` | the file |
| `url` | string | where its bytes are served |
| `active` | boolean | the tab is visible |
| `protectedView` | boolean | from the props |
| `paged`, `part` | boolean, number | parts mode and the current part (text viewer only; Markdown passes false and 0) |
| `extensions` | CodeMirror `Extension[]` | extra extensions (language, wrap, line numbers), added through the hook's compartments by the caller |
| `phrases` | record | CodeMirror phrases (as today) |
| `spellcheck`, `lang` | boolean, string | D11 |
| `onDirtyChange`, `registerSave`, `onPathChange` | optional props from `HandlerViewProps` | D14 |
| `onTextChange` | optional (`text: string`) | called after each change (Markdown's preview) |

Results: `hostRef` (the `div` the editor lives in), `viewRef`, `encoding` and `setReadEncoding` (the "read as" encoding of Step 04b), `saveEncoding` and `setSaveEncoding`, `lineEnding` and `setLineEnding`, `readOnly` (`ReadOnlyReason` or `null`), `dirty`, `failed`, `cursor` (`{ line, column, lines }`), `save()` and `saveAs()` (both `Promise<boolean>`), `discard()` (step 9), `conflict` (boolean) with `resolveConflict(choice: "overwrite" | "reload" | "cancel")`, `notice` (a translated error text or `null`) with `clearNotice()`, `draft` (`Draft` or `null`) with `restoreDraft()` and `discardDraft()`, `canUndo`, `canRedo`, `undo()`, `redo()`.

Behavior, in order:

1. **Editor**: created once in `hostRef` with `readOnlyExtensions` inside an `editable` compartment, the caller's `extensions`, a `spellcheck` compartment (`spellcheckAttributes`), and an update listener that tracks the cursor (as Step 04b), `dirty` (step 5), `canUndo`/`canRedo` (`undoDepth` and `redoDepth` from `@codemirror/commands` above 0) and calls `onTextChange`. Destroyed on unmount.
2. **Loading** (as Step 04b's `TextView`): fetch the bytes (or the part), `detectEncoding` once (remember `hadBom` = its `bomLength` above 0), decode, put the text in the editor with an annotation `loading` (`Transaction.userEvent` `"adp.load"`) so it never counts as a change, and remember `baseline` = the editor's `doc` after loading, plus `expected` = `{ modified_unix: info.modified_unix, size: info.size }`. Set `saveEncoding` to `defaultSaveEncoding(encoding, hadBom)` and `lineEnding` to `defaultLineEnding` of the decoded text (first 65,536 characters).
3. **Read-only**: `readOnly` = `readOnlyReason({ paged, protectedView, readOnly: info.read_only, encoding })`. When it is `null` and the text has loaded, reconfigure the `editable` compartment with `editableExtensions`; otherwise `readOnlyExtensions`. (When protected view ends after Unblock, the prop changes and editing turns on without reloading.)
4. **Read as**: `setReadEncoding` only works while `dirty` is false (the UI disables the list otherwise); it re-decodes and resets `baseline`.
5. **Dirty**: `dirty` = the document is not equal to `baseline` (`doc.eq`), or `saveEncoding`/`lineEnding` differ from the values chosen at load or last save. Call `onDirtyChange` when it changes (and with false on unmount).
6. **Recovery copy**: while `dirty`, `DRAFT_DELAY_MS` after the last change (one timer, restarted on each change) and when `active` becomes false, call `writeDraft(info.path, text, expected.modified_unix)`, ignoring errors except `recovery.too_large` (shown once as `notice`). When `dirty` becomes false by saving or by "Don't save" (step 9), call `deleteDraft`.
7. **Draft found**: after loading (not in parts mode), `readDraft(info.path)`; when there is one and its text differs from the loaded text, set `draft`. `restoreDraft` replaces the editor's text with the draft's (a normal change, so it becomes dirty and undoable) and clears `draft`; `discardDraft` calls `deleteDraft` and clears it. The bar's text says the file changed after the copy when `info.modified_unix` is above the draft's `file_modified_unix`.
8. **Save** (`save()`): when `readOnly` is not `null` return false. Text = `joinLines` of the document's lines with `lineEnding`. For a single-byte `saveEncoding`: `table = singleByteTable(saveEncoding)`; when `firstUnmappable` finds a character, set `notice` to `editor.unmappable` (with `char`, `line`, `column`, `encoding` = the label) and return false. Call `saveText` with mode `save`, the path, the text, the encoding, the table, `expected`, and `force` false. On success: `baseline` = the saved document, `expected` = the result's size and modified time, remember the encoding and line ending as saved, delete the draft, return true. On `textSave.changed_on_disk`: set `conflict` and return the promise that `resolveConflict` settles: `overwrite` saves again with `force` true; `reload` drops the changes (delete the draft) and reloads the file from disk (fetch again, reset `baseline`); `cancel` returns false. Other errors: `notice` = `errorText(t, error, "textSave")`, return false.
9. **Discard** (used by "Don't save"): a function `discard()` in the results that deletes the draft and marks the document clean for the close flow (no change to the file).
10. **Save as** (`saveAs()`): not in parts mode. `pickSavePath(t("editor.saveAsTitle"), info.name, t("editor.allFiles"))`; `null` returns false. Encoding: `saveEncoding`, or `utf-8` when the file's encoding cannot be saved. Call `saveText` with mode `saveAs` and the chosen path (no expectation). On success: `baseline` and `expected` as for save; delete the old path's draft; call `onPathChange(result.path)` when the path differs; return true.
11. **Register save**: `registerSave?.({ save, discard })` once after mount (both functions stable: they read the latest state through refs), and `registerSave?.(null)` on unmount.

**Tests** (`src/__tests__/useTextDocument.test.tsx`; mock `../services/textFiles` (`saveText`, `pickSavePath` as `vi.fn`), `../services/recovery` (all three as `vi.fn`) and `fetch` (returns the bytes of "one\r\ntwo\r\n" for any URL); a probe component renders the host `div` and stores the hook's results; `info` has name `a.txt`, path `C:\A\a.txt`, size 10, modified 100, `read_only` false; let promises settle in `act`):

| Test | Steps | Expected |
|---|---|---|
| "loads clean and becomes editable" | render | the editor shows "one\ntwo\n"; `dirty` false; `readOnly` null; `view.state.readOnly` false; `lineEnding` `crlf`; `saveEncoding` `utf-8` |
| "typing makes it dirty and saving makes it clean" | insert "x" at 0 as a user input; `save()` with `saveText` resolving `{ path, size: 11, modified_unix: 200 }` | `dirty` true and `onDirtyChange(true)`; `saveText` got text "xone\r\ntwo\r\n", mode `save`, expected 100/10, `force` false; then `dirty` false and `deleteDraft` called |
| "protected view keeps it read-only" | render with `protectedView` true; then false | `readOnly` `protected`; then null and editable |
| "a changed file asks before overwriting" | make it dirty; `saveText` rejects `textSave.changed_on_disk` once, then resolves; call `save()`, then `resolveConflict("overwrite")` | `conflict` true; the second call had `force` true; `save()` resolved true |
| "unmappable characters stop the save" | `setSaveEncoding("windows-1251")`; insert "é"; `save()` | `saveText` not called; `notice` contains "line 1" |
| "a recovery copy is written two seconds after typing" | fake timers; insert "x"; advance 1999 ms; then 1 ms | `writeDraft` not called; then called once with the path, the text and 100 |
| "a found draft can be restored" | `readDraft` resolves a draft with text "changed"; call `restoreDraft()` | `draft` set before; then the editor shows "changed" and `dirty` is true |
| "Save as switches to the new file" | make it dirty; `pickSavePath` resolves `C:\A\b.txt`; `saveText` resolves with that path | mode `saveAs`; `onPathChange("C:\\A\\b.txt")`; `dirty` false |

**Traps:**
- Loading must never count as a change (the `adp.load` user event and the `baseline` reset), or every opened file looks unsaved.
- Never write to the user's file except in `save()`/`saveAs()` (R-SAFE-7, P-31); recovery copies go to the data folder.
- Keep this file under 400 lines; the pure rules are in `saveEncoding.ts`.

**Commit:** `feat(editor): text document hook with save, conflicts and recovery [step-06a/T7]`

### T8 - Editing in the text viewer

**Files:** modify `src/handlers/text/TextView.tsx`, `src/handlers/text/index.ts`, `src/handlers/types.ts`, `src/styles/viewers.css`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`); create `src/__tests__/textEditing.test.tsx`.

**Translation keys:** `editor.save`, `editor.saveAs`, `editor.undoHint`, `editor.redoHint`, `editor.spellcheck`, `editor.saveWith`, `editor.lineEndings`, `editor.lineEndingCrlf`, `editor.lineEndingLf`, `editor.file`, `editor.edit`, `editor.unsaved`, `editor.saved`, the four `editor.readOnly*` keys, `editor.unmappable`, `editor.changedTitle`, `editor.changedBody`, `editor.overwrite`, `editor.reload`, `editor.saveAsTitle`, `editor.allFiles`, `editor.recovered`, `editor.recoveredChanged`, `editor.restore`, `editor.discard`.

**Do this:**
1. `types.ts`: add the optional fields and props of D14 / Data shapes (`Handler.editable`, `Handler.supportsReplace`, `FindRequest.options`, `FindRequest.replace`, `HandlerViewProps.onDirtyChange`, `registerSave`, `onPathChange`), each with a one-line comment naming Step 06a.
2. `text/index.ts`: `editable: true`, `supportsReplace: true`.
3. `TextView.tsx` keeps its ribbon, commands, zoom, wrap, numbers, encoding list, parts and status, but its editor and loading come from `useTextDocument` (pass `extensions` = the three compartments' initial values, `spellcheck` = the saved `spellcheck` value (new field of `SavedTextState`, default `spellcheckDefault(info.ext)`), `lang` = the i18n language, and the four optional props from its props). Its own editor-creation and loading effects are removed.
4. Context `TextCtx` gets `editable` (`readOnly` is null), `dirty`, `canSaveAs` (not `paged`), `canUndo`, `canRedo`, `spellcheck`. New commands (Data shapes; help slug `editing-text-and-code`; undo and redo with `labelKey` `editor.undoHint`/`editor.redoHint` and no shortcut).
5. Ribbon: a new first tab is not added; instead the existing `view` tab gets, before its groups, a group `file` (label `editor.file`: `text.save` and `text.saveAs`, key tips `S` and `A`) and a group `edit` (label `editor.edit`: `text.undo` and `text.redo` icons only, key tips `Z` and `Y`); after the `encoding` group, a group `saving` (label `editor.saveWith`) with two custom controls: a `select` "Save with" (the `SAVE_ENCODINGS` labels; disabled unless editable) and a `select` "Line endings" (`editor.lineEndingCrlf`, `editor.lineEndingLf`; disabled unless editable); the `show` group gets the toggle `text.spellcheck` (key tip `K`). The Encoding ("read as") list is disabled while `dirty`.
6. Under the ribbon (inside the viewer content, before the editor host), in this order: the read-only note when `readOnly` is not null (a `div` with class `adp-text-notice`, `role="note"`, text `editor.readOnly<Reason>`, the encoding one with `encoding` = the encoding's label; parts mode keeps today's `text.largeFileNotice` and does not show a second note); the draft bar when `draft` is set (a `div` with class `adp-editor-bar`, `role="status"`: the text `editor.recovered` or `editor.recoveredChanged` with `time` = `formatDate(draft.saved_unix, language)`, then `Button`s `editor.restore` (primary) and `editor.discard`); the notice when set (a `div` with class `adp-editor-bar adp-editor-bar--error`, `role="alert"`, its text and a `Button` `common.dismiss`).
7. The conflict dialog when `conflict`: a `Dialog` titled `editor.changedTitle`, the text `editor.changedBody` with `name` = `info.name`, and `div.adp-dialog-actions` with `Button`s `editor.overwrite`, `editor.reload` and `common.cancel` calling `resolveConflict`.
8. Status bar: the first item is `editor.unsaved` while dirty (else nothing extra).

**Do this (`viewers.css`):** add `.adp-editor-bar` (flex row, items centered; gap `--adp-space-3`; padding `--adp-space-2` `--adp-space-5`; background `--adp-color-surface-header`; bottom border 1 px `--adp-color-border-panel`; text `--adp-color-text-primary`; font size `--adp-font-small`) and `.adp-editor-bar--error` (background `--adp-color-status-caution-background`; text `--adp-color-status-caution`).

**Tests** (`src/__tests__/textEditing.test.tsx`; render `TextView` with props like the existing text tests, the same mocks as `useTextDocument.test.tsx`, and `onDirtyChange`/`registerSave` spies):

| Test | Steps | Expected |
|---|---|---|
| "Save is off until the text changes" | render; type into the editor; click the button named "Save" | before typing the Save button is disabled; after it, enabled, `onDirtyChange(true)`, and the status bar list starts with "Unsaved changes"; after the click `saveText` was called |
| "Ctrl+S saves while typing" | type; dispatch Ctrl+S on the editor content | `saveText` called once |
| "read-only files say why and still offer Save as" | `info.read_only` true | the note `editor.readOnlyAttribute`; Save disabled; Save as enabled |
| "the encoding list waits for a save" | type | the Encoding `select` is disabled; the Save with `select` is enabled |
| "registers its save handle" | render | `registerSave` called with an object that has a `save` and a `discard` function |

**Commit:** `feat(editor): edit and save in the text viewer [step-06a/T8]`

### T9 - Find and replace

**Files:** modify `src/views/FileTabView.tsx`, `src/handlers/text/TextView.tsx`, `src/styles/filetabs.css`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`); create `src/__tests__/findReplace.test.tsx`.

**Translation keys:** `editor.replaceWith`, `editor.replace`, `editor.replaceAll`, `editor.matchCase`, `editor.wholeWord`, `editor.closeReplace`.

**Do this (`FileTabView.tsx`):**
1. States `replaceOpen` (false), `replaceText` (""), `options` (`{ caseSensitive: false, wholeWord: false }`). The `find` value passed to the view gets `options` and, when a replace is asked, `replace` = `{ text: replaceText, request: <counter>, all }` (a counter state incremented on each Replace / Replace all).
2. In the existing key handler (active tab only): Ctrl+H (when the handler has `supportsReplace`) opens the replace row and focuses its text box; Escape inside the row closes it and focuses the search box.
3. When `replaceOpen`: a `div` with class `adp-filetab-replace` right under the navigation row: a `TextInput` with `ariaLabel` `editor.replaceWith` (placeholder the same text); two `Switch`es `editor.matchCase` and `editor.wholeWord` (changing `options`); `Button`s `editor.replace` and `editor.replaceAll` (disabled while the search box is empty); an `IconButton` (`X`, `labelKey` `editor.closeReplace`) closing the row. Enter in the text box is Replace; Ctrl+Alt+Enter is Replace all.

**Do this (`TextView.tsx`):** the find effect passes `find.options` to `runFind`; a new effect on `find.replace?.request` (skipping the first render) calls `runReplace(view, find.text, find.replace.text, find.replace.all, find.options)` when the document is editable.

**Do this (`filetabs.css`):** `.adp-filetab-replace` (flex row, items centered, wrapping; gap `--adp-space-3`; padding `--adp-space-2` `--adp-space-7`; bottom border 1 px `--adp-color-border-default`; background `--adp-color-surface-window`) and `.adp-filetab-replace .adp-text-input` (width 270 px).

**Tests** (`src/__tests__/findReplace.test.tsx`; render `FileTabView` with a fake handler whose view records the `find` prop it gets; the handler has `supportsFind` and `supportsReplace`; mock `../services/files` so detection and the token resolve):

| Test | Steps | Expected |
|---|---|---|
| "Ctrl+H opens the replace row" | dispatch Ctrl+H on `window` | an `.adp-filetab-replace` with the text box focused |
| "replace and replace all ask the view" | type "a" in the search box and "b" in the replace box; click Replace; click Replace all | the view got `replace` `{ text: "b", request: 1, all: false }`, then `{ text: "b", request: 2, all: true }` |
| "match case reaches the view" | switch on Match case | the view's `find.options.caseSensitive` is true |
| "no replace row for viewers that can't replace" | a handler without `supportsReplace`; Ctrl+H | no `.adp-filetab-replace` |

**Commit:** `feat(editor): find and replace [step-06a/T9]`

### T10 - Markdown: editable source and Split mode

**Files:** modify `src/handlers/markdown/MarkdownView.tsx`, `src/handlers/markdown/index.ts`, `src/styles/viewers.css`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`); create `src/__tests__/markdownSplit.test.tsx`.

**Translation keys:** `markdown.splitMode`.

**Do this:**
1. `markdown/index.ts`: `editable: true`, `supportsReplace: true`.
2. `MarkdownView.tsx`:
   - `SavedMarkdownState.mode` accepts `"split"` too (`readSaved` keeps `split`); a new saved field `spellcheck` (default `spellcheckDefault(info.ext)`).
   - The source editor (Source and Split modes) comes from `useTextDocument` (with the Markdown language extension, `paged` false, part 0), created once and kept while the mode changes: the editor host stays mounted in every mode and is hidden (`hidden` attribute) in Reading view, so edits are never lost when switching modes. The old code that rebuilt a read-only editor on each mode change is removed.
   - The page (Reading and Split) is rendered from the editor's current text: the existing `renderMarkdownPage` input `source` becomes the editor's text, updated through `onTextChange` with a `PREVIEW_DELAY_MS` timer (cleared on unmount, P-28); the first render uses the loaded text at once.
   - Split: a `div` with class `adp-md-split` holding the editor host and the page frame side by side.
   - Commands and ribbon: a radio `markdown.split` after `markdown.source`; the `file`, `edit` groups and the spelling toggle as in the text viewer (ids prefixed `markdown.`); the saving group (Save with, Line endings) as in the text viewer.
   - The same read-only note, draft bar, notice and conflict dialog as the text viewer.
   - Find: in Reading view as today (`findInPage`); in Source and Split the editor's `runFind`/`runReplace`.
3. `viewers.css`: `.adp-md-split` (flex row; grows; may shrink; min-height 0) and its two children (each flex 1, min-width 0; the first with a right border 1 px `--adp-color-border-panel`).

**Tests** (`src/__tests__/markdownSplit.test.tsx`; the same mocks; `fetch` returns "# Title\n"):

| Test | Steps | Expected |
|---|---|---|
| "Split shows the source and the page" | saved state mode `split` | an `.adp-md-split` holding the editor host and the page frame |
| "typing updates the page after a short pause" | fake timers; type "x" at the end; advance 299 ms; then 1 ms | the frame's `srcdoc` does not contain "Titlex" at 299 ms; then it does |
| "switching modes keeps unsaved edits" | type; switch to Reading view; back to Source | the editor still has the typed text; `dirty` true |

**Commit:** `feat(markdown): editable source and Split mode [step-06a/T10]`

### T11 - Unsaved changes on close, reload and exit

**Files:** modify `src/views/FileTabView.tsx`, `src/services/tabs.ts`, `src/layout/TabStrip.tsx`, `src/App.tsx`, `src-tauri/capabilities/main.json`, `src/styles/layout.css`, `src/__tests__/tabs.test.ts`, `src/__tests__/tabStrip.test.tsx`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`); create `src/views/UnsavedDialog.tsx`, `src/views/useUnsavedChanges.tsx`, `src/__tests__/unsavedDialog.test.tsx`, `src/__tests__/useUnsavedChanges.test.tsx`.

**Translation keys:** `editor.unsavedTitle`, `editor.unsavedBody`, `editor.unsavedManyTitle`, `editor.unsavedManyBody`, `editor.saveAll`, `editor.dontSave`.

**Do this:**
1. `tabs.ts`: `setTabPath` (Data shapes). Test in `tabs.test.ts`: "setTabPath renames a file tab": a file tab gets the new path and title; other tabs unchanged; an unknown id gives the same state.
2. `FileTabView.tsx`: new optional props `onDirtyChange` (`dirty: boolean`), `registerSave` (as in `HandlerViewProps`), `onPathChange` (`path: string`), `isDirty` (boolean); passed to the handler's view. The reload button and F5: when `isDirty`, call a new optional prop `onConfirmDiscard` (returns `Promise<boolean>`: true when the user chose Don't save or saved) before reloading.
3. `UnsavedDialog.tsx`: the default export takes `names` (list of file names), `onSave`, `onDontSave`, `onCancel`. One name: title `editor.unsavedTitle` with `name`, text `editor.unsavedBody`, buttons `editor.save` (primary), `editor.dontSave`, `common.cancel`. Several: title `editor.unsavedManyTitle`, text `editor.unsavedManyBody` with `count`, then a list (`ul`) of the names, buttons `editor.saveAll` (primary), `editor.dontSave`, `common.cancel`. Built on `Dialog` (Escape = Cancel).
4. `useUnsavedChanges.tsx` (module doc comment "Unsaved changes across file tabs (Step 06a): the dots, the questions, the saves."): the hook `useUnsavedChanges(tabs: readonly TabState[])` returns:

   | Member | Behavior |
   |---|---|
   | `dirtyIds` | a `Set` of tab ids (state) |
   | `onDirtyChange(id, dirty)` | adds or removes the id (a new `Set`) |
   | `registerSave(id, handle)` | stores or removes the tab's `SaveHandle` in a ref `Map` |
   | `confirmClose(ids)` | returns `Promise<boolean>`: the dirty ones among `ids`; none: true at once. Otherwise it sets a state with their names (the tabs' titles) and a resolver, which shows the dialog. **Save** / **Save all**: run each handle's `save()` in order; true only when every one returned true (a failed or cancelled save keeps everything open: false). **Don't save**: call each handle's `discard()`, then true. **Cancel**: false. The state is cleared after any answer. |
   | `dialog` | the `UnsavedDialog` element while a question is open, else `null` |

5. `App.tsx` (about 30 lines):
   - `const unsaved = useUnsavedChanges(tabs)`; render `unsaved.dialog` at the end of the shell.
   - `closeTab(id)` (the button, middle-click and Ctrl+W all go through it) first awaits `unsaved.confirmClose([id])` and closes only on true.
   - Window close: the title bar's close button calls `confirmClose` with every file tab's id and, on true, `getCurrentWindow().destroy()`. Also, once at start and only in Tauri, `getCurrentWindow().onCloseRequested(handler)`: the handler prevents the default, then does the same as the button (keep the unlisten function and call it on unmount, P-28).
   - Each `FileTabView` gets `isDirty` = its id is in `unsaved.dirtyIds`, `onDirtyChange` and `registerSave` bound to its id, `onPathChange` (updates the tab with `setTabPath`, title = the last part of the new path), and `onConfirmDiscard` = `() => unsaved.confirmClose([tab id])`.
   - `TabStrip` gets the new optional prop `dirtyIds` = `unsaved.dirtyIds`.
6. `TabStrip.tsx`: a tab whose id is in `dirtyIds` shows a `span` with class `adp-tab-dirty` (a dot, hidden from screen readers) before its close button, and gets `aria-description` = the translated `editor.unsaved` (its accessible name stays its title).
7. `src-tauri/capabilities/main.json`: add the permission `core:window:allow-destroy` (the window is destroyed after a prevented close request).
8. `layout.css`: `.adp-tab-dirty` (inline block; 8 × 8 px; round, corner radius 50 %; background `--adp-color-text-secondary`; does not shrink).

**Tests:**
- `src/__tests__/unsavedDialog.test.tsx`: one name shows "Save changes to notes.txt?" and three buttons; several names show the count text, the list and "Save all"; each button calls its callback; Escape calls `onCancel`.
- `src/__tests__/tabStrip.test.tsx`: add "unsaved tabs show a dot": with `dirtyIds` holding the file tab's id, that tab has an `.adp-tab-dirty` and `aria-description` "Unsaved changes"; the Explorer tab has none.
- `src/__tests__/useUnsavedChanges.test.tsx` (a probe component renders the hook's `dialog` and stores the hook; two file tabs `t1` (`a.txt`) and `t2` (`b.txt`) with handles whose `save` and `discard` are spies):

  | Test | Steps | Expected |
  |---|---|---|
  | "clean tabs close without a question" | `confirmClose(["t1"])` | resolves true; no dialog |
  | "Save saves, then closes" | mark `t1` dirty; `confirmClose(["t1"])`; click Save (its `save` resolves true) | the dialog named `a.txt`; `save` called once; resolves true |
  | "a failed save keeps the tab" | the same, `save` resolves false | resolves false |
  | "Don't save discards" | mark both dirty; `confirmClose(["t1", "t2"])`; click Don't save | the dialog lists both names; both `discard` called; resolves true |
  | "Cancel keeps everything" | mark `t1` dirty; click Cancel | resolves false; no `save` or `discard` call |

**Traps:**
- A save started from the dialog can itself ask (changed on disk): the dialog waits for that answer; a "Cancel" there keeps the tab open.
- Never destroy the window before every save resolved true; when the user cancels, the app stays exactly as it was.
- `onCloseRequested` exists only in Tauri: guard it with `isTauriRuntime()`.

**Commit:** `feat(editor): ask before losing unsaved changes [step-06a/T11]`

### T12 - Help pages, speed and screenshots

**Files:** create `help/en/editing-text-and-code.md`, `help/es/editing-text-and-code.md`, `help/en/unsaved-changes-and-recovery.md`, `help/es/unsaved-changes-and-recovery.md`; modify `help/en/viewing-text.md`, `help/es/viewing-text.md`, `help/en/viewing-markdown.md`, `help/es/viewing-markdown.md`, `scripts/measure-ui.mjs`.

**Do this:**
1. Help pages: the exact texts and changes in "Help pages".
2. `scripts/measure-ui.mjs`: the step value `05d` becomes `06a`. In the full mode, after Step 05d's measurements, open `notes.txt` from the demo folder in a tab (double-click its row; wait until `.adp-filetab:not([hidden]) .cm-content` exists and is editable, `contenteditable="true"`), then add:

   | Name | How |
   |---|---|
   | `type a character in the text editor` | `measure` with setup = focus the visible `.cm-content`; action = dispatch an `input`-type edit through the editor: `document.execCommand("insertText", false, "x")`; cleanup = `document.execCommand("undo")` |
   | `save a small text file (Ctrl+S)` | a loop of `RUNS` runs like "details pane filled": each run types one character (as above) and then `timeUntil` dispatches Ctrl+S on the `.cm-content` and is done when the status bar no longer starts with the `editor.unsaved` text; afterwards undo all and save once more so `notes.txt` is unchanged |

   Then close the tab (Ctrl+W).
3. Screenshots, after Step 05d's last action: open `notes.txt` (double-click), type "Hello" at the end, wait 300 ms, shot `39-text-editing`; press Ctrl+H, type "Hello" in the search box and "Hi" in the replace box, shot `40-find-replace`; press Ctrl+W (the unsaved dialog opens), shot `41-unsaved-dialog`; click Don't save. There is no Split-mode screenshot (the demo folder has no Markdown file); the owner checks it by hand.

**Commit:** `docs(help): editing text, unsaved changes and recovery; speed and screenshots [step-06a/T12]`

## Help pages

### New page `help/en/editing-text-and-code.md` (exact text)

```markdown
# Editing text and code

Text files, code and Markdown files can be changed right in their tab, and saved safely.

## Edit and save

- Click in the text and type. **Ctrl+Z** undoes and **Ctrl+Y** redoes.
- **Ctrl+S** (or **Save** on the ribbon) saves. A dot on the tab means there are unsaved changes.
- **Ctrl+Shift+S** (or **Save as…**) saves under another name or in another folder. If a file with that name exists, Windows asks first, and the old file goes to the Recycle Bin.
- **Tab** leaves the text, so you can reach the ribbon with the keyboard. To indent lines, use **Ctrl+]**, and **Ctrl+[** to undo the indent.

## Find and replace

- Type in the search box at the top right (**Ctrl+F**) to find text.
- **Ctrl+H** opens the replace row: type the new text, then click **Replace** (or press **Enter**) for one match, or **Replace all**. **Ctrl+Z** undoes a **Replace all** in one step.
- **Match case** and **Whole word** narrow what counts as a match.

## Encoding, line endings and spelling

- **Save with** chooses how the text is stored: UTF-8 (the usual choice), UTF-16, or an older Windows encoding. If a character can't be stored in the chosen encoding, the app tells you where it is and saves nothing.
- **Line endings** chooses **Windows (CRLF)** or **Unix (LF)**.
- **Check spelling** underlines words that look misspelled, using the languages installed in Windows.

## Markdown

Markdown files have three views on the ribbon: **Reading view**, **Source** (where you edit), and **Split**, which shows the source and the formatted page side by side. The page follows your typing.

## When editing is off

Some files open read-only, and a note under the ribbon says why:

- files bigger than 10 MB, which open in parts;
- files from the internet, until you unblock them (see "Protected view");
- files marked read-only in Windows, and files in some Asian encodings. Use **Save as…** to save a copy you can edit.

## Good to know

- Saving never writes the file halfway: the new text is written to a temporary file first and swapped in only when it's complete.
- If another program changed the file after you opened it, the app asks before saving: **Overwrite**, **Reload** (keeps the other program's version) or **Cancel**.
- While you type, the app keeps a recovery copy of your changes (see "Unsaved changes and recovery").

See also: "Unsaved changes and recovery", "Viewing text and code" and "Viewing Markdown".
```

### New page `help/es/editing-text-and-code.md` (exact text)

```markdown
# Editar texto y código

Los archivos de texto, de código y Markdown se pueden cambiar en su propia pestaña y guardar de forma segura.

## Editar y guardar

- Haz clic en el texto y escribe. **Ctrl+Z** deshace y **Ctrl+Y** rehace.
- **Ctrl+S** (o **Guardar** en la cinta de opciones) guarda. Un punto en la pestaña indica que hay cambios sin guardar.
- **Ctrl+Mayús+S** (o **Guardar como…**) guarda con otro nombre o en otra carpeta. Si ya existe un archivo con ese nombre, Windows pregunta primero, y el archivo anterior va a la Papelera de reciclaje.
- **Tab** sale del texto, para que puedas llegar a la cinta de opciones con el teclado. Para aplicar sangría a las líneas, usa **Ctrl+]**, y **Ctrl+[** para quitarla.

## Buscar y reemplazar

- Escribe en el cuadro de búsqueda de arriba a la derecha (**Ctrl+F**) para buscar texto.
- **Ctrl+H** abre la fila de reemplazo: escribe el texto nuevo y haz clic en **Reemplazar** (o presiona **Entrar**) para una coincidencia, o en **Reemplazar todo**. **Ctrl+Z** deshace un **Reemplazar todo** en un solo paso.
- **Coincidir mayúsculas y minúsculas** y **Palabra completa** limitan lo que cuenta como coincidencia.

## Codificación, finales de línea y ortografía

- **Guardar con** elige cómo se guarda el texto: UTF-8 (lo habitual), UTF-16 o una codificación antigua de Windows. Si un carácter no se puede guardar con la codificación elegida, la aplicación te dice dónde está y no guarda nada.
- **Finales de línea** elige **Windows (CRLF)** o **Unix (LF)**.
- **Revisar ortografía** subraya las palabras que parecen mal escritas, con los idiomas instalados en Windows.

## Markdown

Los archivos Markdown tienen tres vistas en la cinta de opciones: **Vista de lectura**, **Código fuente** (donde editas) y **Dividida**, que muestra el código fuente y la página con formato lado a lado. La página sigue lo que escribes.

## Cuando la edición está desactivada

Algunos archivos se abren en modo de solo lectura, y una nota debajo de la cinta de opciones explica por qué:

- los archivos de más de 10 MB, que se abren por partes;
- los archivos de Internet, hasta que los desbloquees (consulta «Vista protegida»);
- los archivos marcados como de solo lectura en Windows y los archivos en algunas codificaciones asiáticas. Usa **Guardar como…** para guardar una copia que puedas editar.

## Para tener en cuenta

- Guardar nunca escribe el archivo a medias: el texto nuevo se escribe primero en un archivo temporal y se coloca en su lugar solo cuando está completo.
- Si otro programa cambió el archivo después de que lo abriste, la aplicación pregunta antes de guardar: **Sobrescribir**, **Volver a cargar** (conserva la versión del otro programa) o **Cancelar**.
- Mientras escribes, la aplicación guarda una copia de recuperación de tus cambios (consulta «Cambios sin guardar y recuperación»).

Consulta también: «Cambios sin guardar y recuperación», «Ver texto y código» y «Ver Markdown».
```

### New page `help/en/unsaved-changes-and-recovery.md` (exact text)

```markdown
# Unsaved changes and recovery

The app makes sure you never lose text you typed but didn't save.

## Before closing

When you close a tab with unsaved changes, reload it, or close the window, the app asks:

- **Save** (or **Save all**) saves first, then closes.
- **Don't save** closes and drops the changes.
- **Cancel** keeps everything open as it was.

## Recovery copies

- While you type, the app keeps a copy of your unsaved changes in its own folder on your PC, a couple of seconds after you stop typing.
- If the app or Windows closes unexpectedly, open the file again (the app reopens your tabs by itself). A bar offers your unsaved changes: **Restore** puts them back in the text, unsaved; **Discard** removes the copy.
- If the file changed after the copy was made, the bar says so. Restore it only if you want your version back.
- Saving, or choosing **Don't save**, removes the copy.

## Good to know

- Recovery copies never change your file. Only **Save** does.
- The app keeps copies for up to 50 files; the oldest are removed first.

See also: "Editing text and code".
```

### New page `help/es/unsaved-changes-and-recovery.md` (exact text)

```markdown
# Cambios sin guardar y recuperación

La aplicación se asegura de que nunca pierdas un texto que escribiste y no guardaste.

## Antes de cerrar

Cuando cierras una pestaña con cambios sin guardar, la vuelves a cargar o cierras la ventana, la aplicación pregunta:

- **Guardar** (o **Guardar todo**) guarda primero y luego cierra.
- **No guardar** cierra y descarta los cambios.
- **Cancelar** deja todo abierto como estaba.

## Copias de recuperación

- Mientras escribes, la aplicación guarda una copia de tus cambios sin guardar en su propia carpeta de tu computadora, un par de segundos después de que dejas de escribir.
- Si la aplicación o Windows se cierran de forma inesperada, vuelve a abrir el archivo (la aplicación vuelve a abrir tus pestañas por sí sola). Una barra te ofrece tus cambios sin guardar: **Restaurar** los vuelve a poner en el texto, sin guardar; **Descartar** elimina la copia.
- Si el archivo cambió después de hacer la copia, la barra te lo indica. Restáurala solo si quieres recuperar tu versión.
- Guardar, o elegir **No guardar**, elimina la copia.

## Para tener en cuenta

- Las copias de recuperación nunca cambian tu archivo. Solo **Guardar** lo hace.
- La aplicación guarda copias de hasta 50 archivos; las más antiguas se eliminan primero.

Consulta también: «Editar texto y código».
```

### Changes to existing pages

- `help/en/viewing-text.md`: in "Good to know", the bullet "The viewer never changes the file. Editing arrives in a later update." becomes "You can edit and save the file in the same tab (see "Editing text and code")." The last line becomes: "See also: "Editing text and code", "Viewing Markdown" and "The ribbon"."
- `help/es/viewing-text.md`: the matching bullet becomes "Puedes editar y guardar el archivo en la misma pestaña (consulta «Editar texto y código»)." and the last line "Consulta también: «Editar texto y código», «Ver Markdown» y «La cinta de opciones»."
- `help/en/viewing-markdown.md`: in "Reading view and source", the first bullet becomes "**View** > **Reading view** shows the formatted page. **View** > **Source** shows the text the page is made from, where you can edit it. **View** > **Split** shows both side by side." The last line becomes "See also: "Editing text and code" and "Viewing text and code"."
- `help/es/viewing-markdown.md`: the matching bullet becomes "**Vista** > **Vista de lectura** muestra la página con formato. **Vista** > **Código fuente** muestra el texto con el que está hecha la página, donde puedes editarlo. **Vista** > **Dividida** muestra las dos lado a lado." and the last line "Consulta también: «Editar texto y código» y «Ver texto y código»."

## Check by hand (the owner, in the packaged app)

Before telling the owner, create this test folder. All files are plain text unless the table says otherwise.

| Path (inside `%TEMP%\adp-06a`) | Content |
|---|---|
| `notes.txt` | three lines `one`, `two`, `three` with Windows line endings |
| `unix.txt` | the same three lines with Unix line endings |
| `latin.txt` | the text `Árbol café` saved in Windows-1252 (one byte per letter) |
| `readme.md` | `# Title`, an empty line, `Some *text*.` |
| `locked.txt` | the text `locked`; then turn on its Read-only attribute |
| `big.log` | the line `0123456789 log line` repeated until the file is about 12 MB |

1. Open `notes.txt`, type a word: a dot on the tab and "Unsaved changes" in the status bar. Ctrl+S: the dot goes away; reopen the file in Notepad: the word is there, line endings still Windows.
2. Ctrl+Z / Ctrl+Y work; Tab leaves the text; Ctrl+] indents.
3. Ctrl+H: replace `two` with `2`; Replace all with Match case; Ctrl+Z undoes Replace all in one step.
4. `unix.txt`: edit and save: still Unix line endings. Change **Line endings** to Windows and save: Notepad shows Windows endings.
5. `latin.txt`: shows "Árbol café"; edit and save: still one byte per letter (the size grows only by the letters typed). Then type the Cyrillic letter "Ж" and save (Save with is still Windows-1252): the message names the line and column, and nothing is saved.
6. Edit `notes.txt`, then change it in Notepad and save there; save in the app: the "changed on disk" question; try Reload and Overwrite.
7. **Save as…** `notes copy.txt`: the tab shows the new name; save as onto an existing file: Windows asks; the old file is in the Recycle Bin.
8. `locked.txt`: the read-only note; Save is off; Save as works. `big.log`: parts mode, read-only. A file downloaded from the internet: editing off until Unblock, then on without reopening.
9. `readme.md`: Split mode: typing updates the page after a short pause; switching modes keeps the edits; save works.
10. Type in `notes.txt` and close the tab: Save / Don't save / Cancel each behave; with two unsaved tabs, close the window: one question listing both.
11. Type in `notes.txt`, wait 3 seconds, end the app with Task Manager; start it again: the tab comes back with the Restore bar; Restore brings the text back unsaved; Discard removes it.
12. Check spelling: a misspelled word is underlined in `notes.txt` (on by default) and not in a `.js` file (off by default) until switched on.
13. Repeat checks 1, 3 and 10 in Spanish and in the dark theme.

## Speed

| Interaction | Tier | How measured |
|---|---|---|
| Typing a character | Instant (0.1 s) | `type a character in the text editor` |
| Saving a small file | Fast (1 s) | `save a small text file (Ctrl+S)` |
| Editing turns on after the view | Fast (1 s) | by hand (check 1) |
| Split preview update after typing | Fast (1 s, after the 0.3 s pause) | by hand (check 9) |
| Every existing measurement | as before | not more than 20% slower than step 05d's JSON |

## Screenshots

`39-text-editing`, `40-find-replace`, `41-unsaved-dialog` (added in T12), in English light, Spanish dark and the pseudo-locale, in `docs/screenshots/step-06a/`.

## Done when

- [ ] T1 to T12 are committed, each after `GATE PASSED`.
- [ ] Text and Markdown files edit and save safely (partial file, then replace; the version hook is called first); a file changed by another program is never overwritten without asking.
- [ ] Encodings and line endings are kept or changed as chosen; unmappable characters stop the save with their position.
- [ ] Closing a tab, reloading and closing the window ask before losing changes; recovery copies come back after a forced end.
- [ ] Find and replace, Markdown Split mode and spell checking work.
- [ ] Every existing test passes unchanged except where T6, T7 and T11 say.
- [ ] The speed table rows meet their tiers; the screenshots exist; the step report is written.
