# ADR 0007: Step 03b file operations, jobs, undo, clipboard, and drag

Status: accepted (Step 03b, owner decisions 2026-10-28).

## Owner decisions

- **Design:** the preview of the jobs panel, conflict dialog, permanent-delete warning, Recent actions list, and paste-as-file via the rename box was approved before building (recorded in DESIGN_DEVIATIONS.md).
- **Drag and drop:** try the full both-ways drag; propose splitting drag-out into its own step if the spike balloons. (It did not: see the drag ruling below.)
- **Recycle Bin code:** check the `trash` crate first under the license gate.
- **Conflicts:** Replace / Skip / Keep both with a for-all choice; pasting into the same folder always keeps both ("name - Copy").
- **Paste and undo:** pasted images default to PNG with a PNG/JPG choice in Settings (schema 4); undoing a copy sends the copies to the Recycle Bin.

## Rulings

- **Replace never destroys data:** the existing item goes to the Recycle Bin before the new one takes its place (copies are written to a hidden `~name.partial` sibling and renamed in only when complete). The job report lists each replaced item with its exact bin entry (`$R...`, found through the bin's `$I` record), and Undo restores that entry, never a newer item with the same original path. Reports also list the top-most items an operation *created*, so undoing a merge into an existing folder removes only what was added. A file and a folder never replace each other, and drive roots are never moved, recycled, or deleted. (Added during the step review, after these holes were found.)

- **Operation engine:** our own chunked copy/move in `fs-service` (`ops.rs`), not `IFileOperation`: progress per byte and per item, cancel between chunks and items, partial copies deleted, per-item skips with stable reason codes, and link loops detected with a visited-folder set. Same-volume moves are renames; cross-volume moves copy, then delete only what copied.
- **Recycle Bin:** `trash` 5.2.9 (MIT, verified on crates.io/docs.rs 2026-10-28) deletes to the bin and lists it, but **restore is ours**, driven with `IFileOperation`: a probe proved Windows returns bin display names without the extension when "hide extensions" is on (`probe-restore` for `probe-restore.txt`), so the crate's `original_path()` never matches and its restore would drop the extension. Restore matches bin entries by the full original path in the bin's `$I` record (falling back to folder plus name-or-stem, newest first, only when a record can't be read) and moves the item back under its full known name; it never overwrites a name taken in the meantime.
- **Jobs transport:** the start/poll pattern from folder listing (ADR 0005), ten polls a second; completion returns one report with completed and skipped items instead of per-item events.
- **Conflicts are decided before the job starts** (`check_conflicts`), so a job never blocks mid-copy waiting for an answer. One answer can cover all conflicts; otherwise each conflict asks again. The full conflict window (per-file details) remains Step 09c.
- **Clipboard:** Win32 `CF_HDROP` plus "Preferred DropEffect", so Cut/Copy/Paste interoperate with Windows Explorer both ways. A cut is cleared from the clipboard after a paste moves the files. Text is capped at 10 MB and paths at 10,000 on both sides.
- **Images:** clipboard images are encoded with Windows Imaging (WIC) to PNG or JPG (settings schema 4), because screenshots arrive as bitmaps; no image library was added. Text classification (Markdown/CSV/plain) is a pure, unit-tested heuristic.
- **Drag out:** `SHCreateDataObject` from PIDLs plus `SHDoDragDrop` with the shell's default drop source, the same construction the Properties sheet already used; hand-written COM drag classes were rejected after the windows 0.61 `implement` macros proved to need a direct `windows-core` dependency and several trait-shape fixes. A returned "move" is finished by sending the sources to the Recycle Bin (the target has them; where they went is not reported, so this one action gets no Undo entry, and the bin keeps them in case the target failed). Changed from a permanent delete during the step review. Drops *in* use Tauri's drag-drop event over elements marked with `data-drop-folder`.
- **Undo (contract 11):** entries store inverse operations as data (`rename`, `movePairs`, `copy`, `recycle`, `restore`, `sequence`), capped at 100, executed on confirm-after-success: Ctrl+Z, the toast button, and Recent actions all drive the same stack, and an entry can only be undone in stack order.
- **Cut/Copy/Paste shortcuts** are handled in the Explorer's window key handler, so they also work when the file list does not have focus; typing in a text box is never intercepted.
