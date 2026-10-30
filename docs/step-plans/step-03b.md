# Step 03b Implementation Plan

> Native (inline) execution, slice by slice, tests first where the logic is pure. Steps use checkbox (`- [x]`) syntax.

**Goal:** Daily file management works safely: New, Cut, Copy, Paste, Rename, Delete (Recycle Bin; Shift+Delete permanent after a warning), big operations run as cancellable background jobs with progress, every change can be undone (toast, Ctrl+Z, Recent actions), files drag inside the app and to/from Windows Explorer, and text/images on the clipboard paste as files.

**Architecture:** A pure Rust operation engine in `fs-service` (`ops.rs`: create, chunked copy, move, recycle, restore, permanent delete) reports progress through a cancellation token and never overwrites without a decision made beforehand (`check_conflicts` -> one simple dialog -> policy for the job). The Tauri layer runs operations as polled jobs (the start/poll transport ADR 0005 proved; Channels do not arrive under isolation). Windows clipboard (files with cut/copy effect, text, image) and external drag (OLE `DoDragDrop`) live in Rust behind validated commands. The TypeScript undo stack (contract 11) stores inverse operations as data shared by Ctrl+Z/Ctrl+Y, undo toasts, and Recent actions. Commands turn on through the existing registry (`src/commands/explorerCommands.ts`), menus through `src/commands/menus.ts` (contract 9).

**Spec:** `plan/steps/step-03b.md`; contracts `ARCHITECTURE.md` rows 10, 11, 12; design approved by the owner on 2026-10-28 (preview shown in chat, recorded in `DESIGN_DEVIATIONS.md`).

## Global Constraints

- Branch `step-03b-file-operations` from `testing`; tag `v0.0.6-step03b`. Conventional Commits with `[step-03b]`; dependencies in their own `deps:` commits.
- Owner decisions 2026-10-28: the new-screens design preview (progress panel, conflict dialog, permanent-delete warning, Recent actions, paste-as-file via the rename box) is approved; try full drag both ways and propose a split if the drag-out spike balloons; check the `trash` crate first (MIT gate) before hand-writing Recycle Bin code; conflicts offer Replace / Skip / Keep both with a for-all checkbox and same-folder paste auto-keeps both; pasted images default to PNG with a Settings choice, and undoing a copy sends the copies to the Recycle Bin.
- Owner decisions 2026-10-30, after the safety review: **Replace is removed from this step** because Windows has no documented way to bind a Recycle Bin call to the exact file the user approved; the conflict dialog offers **Merge** (folders only), **Skip** and **Keep both**, approved as a revised preview. Replace returns with the full conflict window, where the approved-target mechanism in `plan/contracts.md` is built. **Keep both** and same-folder copies use `name (1)`, `name (2)` so the original and the new item are obviously related. The owner also chose to keep this step local-only: no push, pull request, or `main` change.
- KI-014 (Major) must close: rename gets Undo. KI-015 closes for New/Cut/Copy/Paste/Delete; List/icon views stay disabled until Step 05.
- Never overwrite silently. Delete goes to the Recycle Bin; Shift+Delete (`irreversible`) warns it cannot be undone before running.
- Every new Tauri command: `ensure_main`, `validate_absolute_path`, `spawn_blocking` for disk work, `copy.<reason>`-style error codes, and an isolation allowlist entry.
- Background jobs never read online-only placeholders on their own; an explicit user copy/move of a selected item may (it is a foreground request, like opening the file).
- Settings schema 4 (pasted-image format) migrates v3 files keeping language, theme and view options, in Rust and TypeScript.
- All user-visible text from locale files (EN/ES + pseudo); `npm run lint:i18n` must pass. Shortcuts shown via `formatShortcut`.
- Speed: command/menu/undo feedback is Instant (0.1 s); big copies are background jobs with progress and Cancel; startup must not regress >20% vs `docs/benchmarks/2026-10-28-startup-step03a.json`.

## Review Focus

- A cancelled or failed copy never leaves a partial file behind and never deletes a source whose copy did not complete.
- Undo data stays valid when items were renamed by the operation itself (keep-both names, restores).
- Cut/paste with Windows Explorer works both ways (clipboard drop effect honored; a cut source is removed only after a successful paste).
- Link loops inside copied folders are detected and never followed endlessly; access-denied items are skipped and listed, drives disappearing mid-job end the job cleanly.
- Paths from the UI are validated in Rust; clipboard and drag payloads are treated as untrusted input.

## Safety review (2026-10-30)

A review of the finished step found five Blockers. The fixes are part of this
step, not a later one:

| Issue | Fix |
|---|---|
| KI-025: image paste could overwrite a file created after the name was chosen, and the PNG decoder could outlive its buffer | The image goes through an exclusive `create_new` staging handle; publishing renames by handle without replace; failure deletes only that handle's file; the input buffer lives through decoding. |
| KI-026: copy/move could recycle a destination that appeared after the conflict prompt | Replace is refused at the command boundary (owner decision 2026-10-30). Merge never touches a file; Skip and Keep both are safe. Replace returns only with the exact approved-target mechanism. |
| KI-027: a move could delete a source changed during the copy | The copy keeps a file-identity/metadata snapshot; the source is reopened with write/delete denied, compared with the copy and its snapshot, and deleted by handle only when unchanged. Merged moves refuse directory links; same-volume renames use a no-replace rename. |
| KI-028: Redo after undoing a replacement failed | The UI path that produced it is gone with Replace. A stored replacement history now fails safely (`ops.exists`) and leaves the restored item untouched. |
| KI-029: clipboard image decoding ran in the app process | The app starts `Adperastra.exe --clipboard-image-helper`; the parent attaches a memory-limited job and a 15 s timeout, drains a framed binary response, and owns the destination handle. The helper receives only `png` or `jpg`, never a path. |

The same review found that the speed and runtime scripts stopped every
`Adperastra.exe` and every WebView2 process on the PC. The scripts now start
each test run in its own Windows job and stop only that job's processes.

---

### Slice 1: Rust operation engine and jobs

- [x] `deps:` adopt `trash` 5.2.9 (MIT) in `fs-service` after verifying the license and restore API; record in THIRD_PARTY_LICENSES.md and docs/dependency-and-license-table.md.
- [x] `ops.rs`: unique names (`name (2).ext`, `name - Copy.ext`), create folder/file, chunked copy with progress + cancel + partial cleanup, same-volume rename move with cross-volume fallback, recursive walk with link-loop guard, recycle via `trash`, restore by matching original path in the Recycle Bin, permanent delete; per-item skip report with stable reason codes. Unit tests on temp folders.
- [x] Tauri jobs: `check_conflicts`, `file_op_start` / `file_op_poll` / `file_op_cancel` (kinds copy, move, recycle, restore, permanent), `create_item`; AppState job map; isolation allowlist; command validation tests.

### Slice 2: Undo stack and toasts

- [x] `src/services/undo.ts` (pure): push/undo/redo, grouping, non-undoable entries; unit tests.
- [x] `src/services/fileops.ts`: typed wrappers, job polling, executing undo/redo actions as data (rename back, move back, recycle created copies, restore recycled items).
- [x] Explorer: rename pushes an undo entry + toast (closes KI-014); Ctrl+Z / Ctrl+Y; Recent actions dialog from See more; `explorer.undo` / `explorer.redo` / `explorer.recentActions` commands.

### Slice 3: File operations through the registry

- [x] Turn on New folder / New text file, Cut, Copy, Paste, Delete; add Paste as file and permanent delete commands; menus in `menus.ts` (command bar, item menu with Cut/Copy/Paste/Delete, background menu with Paste + Paste as file); keyboard Ctrl+X/C/V, Delete, Shift+Delete, Ctrl+Shift+N in FileList/Explorer.
- [x] Conflict dialog (Merge / Skip / Keep both, for-all; Replace removed by the 2026-10-30 owner decision) and permanent-delete warning dialog (approved design); job panel with progress + Cancel and skipped-item report.
- [x] Clipboard in Rust: `clipboard_set_files` (CF_HDROP + Preferred DropEffect), `clipboard_read` (files + effect, text with size limit), paste honors cut by moving; friendly errors as `ops.<reason>` codes.

### Slice 4: Paste as file

- [x] Settings schema 4: `files.paste_image_format` (png/jpg) in Rust + TS with v3 migration tests; Settings page row.
- [x] Pure text classification (Markdown / CSV / plain) and translated default names with locale date; Rust `clipboard_image_file` writes the clipboard image as PNG/JPG via Windows imaging; created file opens in the rename box; undo toast.

### Slice 5: Drag and drop

- [x] Spike: native drag out (`start_external_drag`, OLE data object with CF_HDROP, copy/move/link effects). If it balloons, stop and propose the split to the owner before continuing.
- [x] Internal drag: rows draggable, drop targets (folder rows, nav pane, breadcrumbs, drives) with Copy/Move/Shortcut badge following the cursor; modifiers Ctrl/Shift/Alt; drops run as undoable jobs; `create_shortcut` for Alt.
- [x] Drop in from other apps: Tauri drag-drop event, coordinates mapped to the folder under the cursor, same job path as internal drops.

### Slice 6: Help, records, verification

- [ ] Help pages (EN/ES): copying and moving, deleting and the Recycle Bin, undo, drag and drop, paste as file.
- [ ] KNOWN_ISSUES (close KI-014, the 03b part of KI-015), DESIGN_DEVIATIONS, CHANGELOG, ADR 0007.
- [ ] Speed: extend `scripts/measure-ui.mjs` with 03b interactions; big-copy job timing; startup vs Step 03a; screenshots in EN light / ES dark / pseudo; step report; whole-branch review; merge to `testing`, full suite, owner approval, PR to `main`, tag `v0.0.6-step03b`.
