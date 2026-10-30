# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- File operations (Step 03b): New folder and text file, Cut, Copy, Paste, and Delete through the command bar, menus, and keyboard; big copies and moves run as background jobs with progress and Cancel; name conflicts ask first (Replace, Skip, or Keep both). Replace sends the item that was there to the Recycle Bin, so Undo brings it back; a file and a folder with the same name never replace each other, and a whole drive can never be moved or deleted.
- Undo for almost everything: Ctrl+Z / Ctrl+Y, an Undo button on the toast after each action, and a Recent actions list. Deleting goes to the Recycle Bin and restores from it; Shift+Delete deletes permanently after a warning that it cannot be undone.
- Drag and drop: drag items onto folders in the list, navigation pane, address bar, or drives (Ctrl copies, Shift moves, Alt creates a shortcut), drag files in from Windows Explorer or the desktop, and drag files out to them.
- Paste as file: pasted text becomes a .txt, .md, or .csv file and a pasted screenshot becomes a .png (or .jpg, chosen in Settings), with the name ready to edit.
- Help pages for copying and moving, deleting and the Recycle Bin, undo, drag and drop, and paste as file, in English and Spanish.

### Fixed

- Choosing Replace, Skip or Keep both for each conflict separately now works; a cancelled or partly finished move can be undone exactly; moving, recycling or deleting system items asks first.
- Screen-reader and keyboard fixes: the tab strip, column headers and the language tag of the page follow the accessibility rules, and the small "Folders in" arrows in the address bar are easier to hit.
- Every app instance keeps its browser data in its own data folder, and the app talks to its core directly instead of through a slower fallback.

### Changed

- The setup window no longer bundles fonts with a license outside the allowed list, and its downloads trust the certificates in the Windows certificate store.

## [v0.0.5-step03a] - 2026-10-28

### Added

- Selecting files the Windows 11 way (Step 03a): click, Ctrl and Shift, keyboard moves, type-ahead, item check boxes, and Ctrl+A; the status bar shows how many items are selected and their size.
- Rename with F2 or a second click on the name; only the name part is selected, problems show while typing, and an existing item is never replaced.
- The Figma command bar (New, Cut, Copy, Paste, Rename, Share, Delete, Sort, View, See more, Details), built from the command registry and collapsing into See more when narrow.
- Right-click menus for items and empty space (Open, Open with, Add to favorites, Show in folder, Copy as path, Properties, Open in Terminal, Share), and Show more options for the classic Windows menu in a separate process.
- The Details pane, group by name, date, type or size, View options for hidden items, file extensions and check boxes, and Favorites on the Home page.
- Help pages for selecting files, the Details pane, the command bar and the right-click menu, in English and Spanish.

### Changed

- The address row and command bar now span the window, as in the Figma frame; Pin folder moved into See more.
- Hidden items are hidden by default, like Windows (View > Hidden items shows them).

### Fixed

- Hidden and system files were always shown (KI-013).
- Ctrl+A outside the file list selected the app's own text.

## [v0.0.4-step02] - 2026-10-28

### Added

- Real folder browsing in the Explorer tab (Step 02): the Rust file-system service (streamed listings with file IDs from the Windows directory enumeration, natural sort, folder watching with batched events), the command registry, an editable breadcrumb address bar (Ctrl+L), a virtualized Details list that opens a 100,000-item folder with first rows in about 0.4 s, the Home page with Quick access and Recent items, This PC with live drive detection, and pinned folders saved in `explorer-state.json`. Help pages for browsing in English and Spanish.

### Fixed

- Pinned folders, recent folders, settings, and the saved session can no longer be lost if the app crashes while saving them (KI-010).
- File IDs keep their exact value in the UI (KI-011).
- Home opens quickly even when the Windows Recent folder holds thousands of shortcuts (KI-012).

## [v0.0.3-step01b] - 2026-10-28

### Added

- The Adperastra app window (Tauri 2 + React): custom title bar with the
  permanent Explorer tab, Help/Settings/component-gallery tabs, session
  restore, offline help center (F1), English/Spanish/pseudo-locale
  switching, light and derived dark themes from the design tokens.
- Security base: strict CSP, isolation allowlist, main-window-only
  commands, crash log and minidump capture (local only).
- The setup launcher now starts the app after a successful check.
- Known-issues register (KNOWN_ISSUES.md) and severity policy.

## [v0.0.2-step01a] - 2026-10-27

### Added

- Setup launcher that checks required components and repairs what is missing.
- Signed dependency manifest (dependencies.json) with pinned versions and checksums.
- First-run window for language, theme, and optional packs.
- Bundled WebView2 bootstrapper; static C runtime (no VC++ redistributable needed).

## [v0.0.1-step00] - 2026-10-27

### Added

- Build plan, architecture, contracts, and design inventory.
- Repository setup connected to the existing GitHub repository.
