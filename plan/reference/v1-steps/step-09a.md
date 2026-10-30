# Step 09a: Tabs: groups, saved groups, dragging between tabs, and sessions (★★★)

**Needs:** 05, 08c. **Builds:** tab sessions, tab groups, cross-tab drag. **Figma frames:** File Explorer · Word abierto and PNG abierto (tab group).

## Tasks
- **Explorer extras:** rubber-band selection, column chooser, resize and grouping, remembered view per folder.
- **More tabs:** extra closeable folder tabs ("+" button, "Open in new tab") next to the permanent Explorer tab; pin, duplicate, reorder, reopen closed tab; Ctrl+Tab and Ctrl+1..9.
- **Sessions:** restore tabs, groups, and each tab's state (folder and view, file, page or scroll position, zoom) on restart (optional in Settings > Startup).
- **Tab groups** like the purple named group in Figma: create a group from tabs, name it, pick a color, collapse/expand, drag tabs in and out, close a whole group.
  - Right-click a tab: "Add tab to group" with a submenu listing "New group" and every existing group (with its color and name); "Remove from group".
  - Right-click a group label: rename, change color, collapse, "Ungroup" (keeps the tabs open, removes the group), "Close group", "Save group".
- **Saved groups:** "Save group" (or closing a group and choosing "Save and close") stores its name, color, tabs in order, and each tab's state in a "Saved groups" list in the navigation pane and the tab bar's "+" menu. Reopening restores all its tabs, opening each through the normal pipeline (the visible tab first, the rest in the background). A moved or deleted file shows that tab as "File not found" with "Locate..." instead of failing the whole group. Saved groups can be renamed, updated with the current tabs, exported/imported as a small file, and used from the command palette (09b) and the assistant (17a).
- **Dragging between tabs:** drag files and hover over another tab for about 0.6 s (configurable) to switch to it, then drop. Drop on a folder tab: copy or move there (Step 03b rules). Drop on the tab bar: open the files as new tabs. Drop on a tab group: open them inside it. Drop on a file tab: the file type decides (insert an image into a document or slide, attach a file to a PDF, add an image as a layer, add a clip to a video, import a CSV into a sheet) or asks when it's ambiguous; editors that don't exist yet register this when they arrive. Drag tabs themselves to reorder, group, or ungroup.
- **Copying content between file tabs:** copy and paste, or drag, text, table cells, images, and pages between viewers and editors, keeping formatting where both sides support it (for example sheet cells into a document table, a PDF page image into the image editor). Each new editor in later steps must support this.
- **Single instance and file associations:** files opened from Windows ("Open with Adperastra", double-click) appear as new tabs in the running window, through the same open pipeline.

## Parts to consider
Files (MIT) for ideas and reusable code.

## Help pages
Working with tabs; tab groups; saved groups; dragging between tabs; sessions; opening files from Windows.

## Done when
I can group tabs, ungroup them, save a group, close it, and reopen it later with every tab restored (including a "File not found" tab); drag files between tabs into folders and groups; and restart the app with my tabs and groups restored.
