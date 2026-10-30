# Step 03b: File operations, job runner, undo, drag and drop, and paste as file (★★)

**Needs:** 03a. **Builds:** job runner and background scheduler, undo stack, drag-and-drop service.

## Tasks
- **File operations:** new folder and file, cut, copy, paste, rename, delete. Delete goes to the Recycle Bin; Shift+Delete is permanent and asks for confirmation first, stating it can't be undone. Copying or moving onto an existing file asks what to do (a simple dialog now; the full conflict window comes in Step 09c).
- **Job runner v1:** copy, move, and delete run as background jobs with progress and Cancel, so big operations never freeze the UI; job priorities (foreground, normal, background) ready for later background tasks. Progress UI in the Figma style.
- **Undo stack v1 and undo toasts** for delete, move, copy, rename, and new items (see `rules.md`, section 3). Ctrl+Z / Ctrl+Y.
- **Drag-and-drop service v1:** drag files within the Explorer and to/from other apps (Windows Explorer, desktop, email). Same rules as Windows: same drive moves, different drive copies; Ctrl forces copy, Shift forces move, Alt creates a shortcut; a badge under the cursor says "Copy to <folder>" or "Move to <folder>". Every drop runs as an undoable job.
- **Paste as file:** pasting in a folder when the clipboard holds text, an image, or a screenshot (not files) creates a new file there: text becomes .txt (or .md if it looks like Markdown, .csv if it looks like a table), images become .png (or .jpg, chosen in Settings), with a translated default name ("Pasted image 2026-10-27 13-15.png") selected for renaming. Also available as "Paste as file" in the right-click menu and command bar, with an undo toast.
- File-system edge cases from `rules.md` section 6 apply to every operation (permissions prompt for a single operation when needed, access-denied items skipped and listed, link loops never followed, drives disappearing handled).

## Parts to consider
Windows shell APIs via the `windows` crate (Recycle Bin, file operations), or the `trash` crate (MIT).

## Help pages
Copying and moving files; deleting and the Recycle Bin; undo; drag and drop; paste as file.

## Done when
I can manage files safely in daily use, cancel a big copy, undo mistakes from the toast or Ctrl+Z, drag between the app and Windows Explorer, and paste a screenshot as a file.
