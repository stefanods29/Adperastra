# Copying and moving files

Copy, move, and rename files and folders with the command bar, the right-click menu, or the keyboard. Everything works with Windows Explorer too: you can copy files here and paste them there, and the other way around.

## Copy and paste

- Select the items, then choose **Copy** (Ctrl+C) or **Cut** (Ctrl+X).
- Open the folder you want and choose **Paste** (Ctrl+V).
- Cut items move; copied items stay where they were.
- Pasting into the same folder makes a copy named like "report - Copy".

## When a name is already taken

If an item with the same name is already in the folder, you are asked what to do:

- **Merge** (two folders with the same name) adds your files to the existing folder and keeps the files that are already there. Files with the same name are skipped and listed when the operation ends.
- **Skip** leaves both alone.
- **Keep both** keeps the existing item and adds yours as "report - Copy" (then "report - Copy (2)"). A moved item that keeps both gets a number, like "report (1)".

Tick **Do this for all conflicts** to use the same answer for the whole operation. Nothing is ever replaced or overwritten. A file and a folder with the same name cannot be combined; that item is skipped and listed when the operation ends. Replacing files will arrive with the full conflict window.

## New items

- **New** > **New folder** (Ctrl+Shift+N) or **New** > **Text file** creates an empty item and opens its name ready to edit.
- Press **Enter** to keep the name, or **Escape** to cancel; the item itself is kept, and you can delete it with **Delete** if you don't want it.
- When the name is taken, the new item counts from one: "New folder (1)", "New folder (2)". Downloads and pasted files use the same numbered names.

## Big operations

Copying or moving a lot runs in the background: a small panel shows progress, and you can keep working or press **Cancel**. Cancel never leaves a half-copied file behind, and items that could not be copied (for example because another app is using them) are listed at the end.

Every copy and move can be undone: see "Undo".

See also: "Deleting and the Recycle Bin", "Drag and drop", and "Paste as file".

## System items and folder links

Moving, merging into, or deleting a Windows system item, including one inside a selected folder, shows a separate warning before anything changes. **Cancel** is selected first. Choose **Continue** only if you know it is safe. Other files do not need this extra confirmation. Untouched files inside a merged folder do not cause a warning.

Drive roots and the Windows and Program Files folders are protected. A move or deletion that contains a folder link or junction is skipped instead of following that link. Combining with an item through such a folder link is also skipped. The operation panel lists what was skipped; ordinary copies keep their existing link-loop protection.
