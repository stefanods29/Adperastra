# Step 09d: Split view, disk images, clipboard history, and Open in Terminal (★★★)

**Needs:** 09a. **Builds:** split view.

## Tasks
- **Split view inside a tab:** show two files (or a file and a folder) side by side in one tab, like Edge's split screen, with a draggable divider and a swap button; vertical or horizontal split. Open it with right-click "Open in split view", by dragging a tab onto the right half of another tab, or from the command palette. Each side keeps its own ribbon (the active side's ribbon shows, marked with its accent color); drag and drop and copy/paste between sides use the drag-and-drop service. "Sync scrolling" for comparing two PDFs, documents, or versions. Closing one side turns it back into a normal tab. Split tabs are restored with sessions and saved groups.
- **Mount disk images:** double-click or right-click "Mount" on ISO, IMG, VHD, and VHDX files to open them as a drive (Windows' built-in mounting), shown in the navigation pane under This PC with an "Eject" button; mounting a VHD that needs admin rights asks first (for that one operation). Mounted images open in a new tab.
- **Clipboard history (inside the app):** a panel (Ctrl+Shift+V) listing what I copied recently in the app and, optionally, in Windows: files and folders (with paths), text, and images, with thumbnails, time, and source. Click to paste again, pin items, search, and clear. Respects the Windows flags that mark clipboard content as private (password managers) and never stores those; keeps history only in memory by default (optional "keep after restart"); limits size; can be turned off entirely. Separate from Windows' own Win+V.
- **Open in Terminal:** the app has no built-in terminal. "Open in Terminal" (right-click, command bar •••, command palette) opens the Windows default terminal (Windows Terminal, `wt.exe -d <folder>`) in the current folder, falling back to PowerShell if Windows Terminal isn't installed.

## Help pages
Split view; mounting disk images; clipboard history; opening a terminal.

## Done when
I can compare two PDFs side by side with sync scrolling, mount and eject an ISO, paste something I copied earlier from the clipboard history, and open Windows Terminal in the current folder.
