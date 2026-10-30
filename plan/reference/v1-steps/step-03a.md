# Step 03a: Selection, Details pane, command bar, and right-click menu (★★)

**Needs:** 02. **Builds:** selection context, menus built from commands. **Figma frames:** File Explorer · Light.

## Tasks
- **Selection:** click, Ctrl/Shift multi-select, keyboard navigation, type-ahead, F2 rename, and one-step rename (clicking the name of an already-selected item starts renaming, with only the name selected, not the extension). Status bar shows item count and selection count and size.
- **Details pane** (right, toggled by a "Details" button at the right of the command bar, as in Windows 11): a single left-click instantly shows name, type, size, created/modified/accessed dates, full path, and attributes; multiple selection shows count and total size. (Previews and rich metadata come in Step 07a.)
- **Command bar** as drawn in Figma: New ▾ (folder, text file) | Cut, Copy, Paste, Rename, Share, Delete | Sort ▾ (name, date, type, size; ascending/descending; group by) | View ▾ (details, list, small/medium/large icons; show hidden files, file extensions, item checkboxes) | ••• overflow | Details toggle. Commands that need a selection are disabled until something is selected. The bar collapses into ••• when narrow and adapts to the selection (for example "Extract all" for archives in Step 06c). Tooltips with shortcut hints on every button.
- **Right-click menu** built from the command registry. On a file: Open, Open with..., Share (system share sheet), Add to favorites, Cut/Copy/Paste, Copy path, Rename, Delete, Show in folder, Properties. On empty space: View, Sort, New, Paste, Open in Terminal (opens Windows Terminal in this folder; falls back to PowerShell if Windows Terminal isn't installed), Properties.
- The right-click menu opens within the **Instant** tier: our items render immediately; the classic Windows shell-extension items load only when "Show more options" is opened, in the background, with a timeout so a slow third-party extension can't freeze the menu.

## Parts to consider
Windows shell APIs via the `windows` crate (properties, share, shell extensions).

## Help pages
Selecting files; the Details pane; the command bar; the right-click menu.

## Done when
Selection, renaming, the Details pane, the command bar, and the right-click menu work as described; the menu always appears instantly, even with slow shell extensions installed.
