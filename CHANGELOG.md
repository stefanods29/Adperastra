# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Editing text and code (Step 06a): text, code and Markdown files are changed right in their tab, with undo and redo, Save (Ctrl+S) and Save as (Ctrl+Shift+S), find and replace (Ctrl+H, Match case, Whole word), a choice of eight save encodings and of Windows or Unix line endings, and a spelling check per file. Saving is safe: the new text is written to a temporary file and swapped in only when complete, and a file changed by another program is never overwritten without asking. Files bigger than 10 MB, files from the internet, read-only files and some Asian encodings stay read-only with a note saying why (Save as still makes a copy).
- Markdown files gained Split mode: the source you edit on the left and the formatted page on the right, following your typing; Reading view and Source stay, and switching between them keeps unsaved edits.
- Unsaved changes (Step 06a): a dot on the tab and "Unsaved changes" in the status bar; closing a tab, reloading or closing the window asks Save, Don't save or Cancel (one question for several tabs). A recovery copy is kept a couple of seconds after typing and offered back with Restore or Discard after a crash.
- Help pages for editing text and code and for unsaved changes and recovery, in English and Spanish; the text and Markdown pages now describe editing.
- Six built-in themes (Step 05d): Adperastra light (the standard look) with Bright and Paper for light mode, and Adperastra dark with AMOLED black and High contrast for dark mode, each with a small live preview in Settings > Theme. A theme is chosen for Light mode and one for Dark mode; System still follows Windows. Every theme is checked for contrast, and the whole app changes at once.
- Appearance settings (Step 05d): UI scale from 75 % to 200 %, applied to the whole window and restored at start without a jump; density (Compact, Comfortable, Spacious) that sets the spacing and the height of the rows in every list; corner radius (Square, Standard, Round); and animations (Full, Reduced, Off), which always follow Windows' "show fewer animations" setting.
- A rebuilt Settings page (Step 05d): a search box that finds sections and the labels inside them, a list of sections to jump to, **Reset to default** for each section and **Reset all settings…**, both with Undo, and **Export settings…** / **Import settings…** through Windows' file dialogs. A replaced settings file goes to the Recycle Bin first, and settings files from older versions are migrated.
- Help pages for themes and appearance and for the Settings page, in English and Spanish; "Changing language and theme" rewritten (Step 05d).
- Text, code and Markdown viewers (Step 04b): text files, logs, settings files and source code open in a read-only tab with colors for about 30 languages, search, word wrap, line numbers, zoom and a choice of 12 encodings; files over 10 MB open at once, read-only, in parts of 1 MB. Markdown opens as a formatted page or as its source, and its web and email links ask before opening in the browser or mail app.
- Ribbons in file tabs: one row of grouped buttons with Alt key tips; the picture viewer's controls moved there and gained Rotate left, Rotate right and Actual size.
- A search box on file tabs for viewers that can search: Ctrl+F, Enter or F3 for the next match, Shift+Enter or Shift+F3 for the previous one, Esc to clear.
- Files with no known extension (README, LICENSE) open as text when their content looks like text; programs, shortcuts and web pages still open in Windows, and scripts (.bat, .ps1, .js) open as text so they never run by accident.
- Help pages for the ribbon, viewing text and code, and viewing Markdown, in English and Spanish.
- Files open in tabs (Step 04a): double-click a picture and it opens next to the Explorer tab, fitted to the window; the Explorer keeps its folder, selection and scroll. Middle-click opens a background tab, closing returns to the Explorer, and open tabs come back after a restart. Files without a viewer still open in their Windows app.
- Picture viewer: fit, zoom from 5 % to 1600 %, Ctrl+wheel toward the pointer, drag to pan, rotate left/right and actual size, with a checkerboard behind transparency. File bytes reach the page only through per-file access tokens (`adpfile`), never through a path in a URL.
- Help pages for opening files in tabs and viewing images, in English and Spanish.
- Column view (Step 05b): each folder in its own column, the selected folder's contents on the right, and a preview of the selected file; the open folder's column keeps the blue selection and the columns to its left show the way. Right and Left move between columns, clicking anything in another column opens that folder, and files can be dragged onto folders or the empty part of any column. The column width is dragged or set in Settings > Views, the preview column can be turned off, and Column view can be hidden, reordered, made the default and remembered per folder like every other view (settings schema 7).
- Movable toolbars, panels and tabs (Step 05c): put the toolbar at the top, at the bottom or on either side, in the standard, compact, icons-only or hide-until-pointed-at look, from its right-click menu; the same choice applies to the Explorer's command bar and to every file tab's ribbon. Tabs can sit at the top, at the bottom or in a column, which can shrink to icons. The navigation pane can go right or hide, and the Details pane can sit under the files. Three ready-made layout presets (Standard, Minimal, Classic) set everything at once, and up to 20 presets of your own are saved in Settings > Layout. Your layout comes back after a restart.
- Audio and video player; protected view for downloads; Open as text or hex; choose where each file type opens (Step 04c).
- File operations (Step 03b): New folder and text file, Cut, Copy, Paste, and Delete through the command bar, menus, and keyboard; big copies and moves run as background jobs with progress and Cancel; name conflicts ask first (Merge for two folders, Skip, or Keep both). Merge never touches an existing file; a file and a folder with the same name cannot be combined, and a whole drive can never be moved or deleted. Replace is not offered yet: it returns with the full conflict window, once recycling can be bound to the exact item you approved.
- Undo for almost everything: Ctrl+Z / Ctrl+Y, an Undo button on the toast after each action, and a Recent actions list. Deleting goes to the Recycle Bin and restores from it; Shift+Delete deletes permanently after a warning that it cannot be undone.
- Drag and drop: drag items onto folders in the list, navigation pane, address bar, or drives (Ctrl copies, Shift moves, Alt creates a shortcut), drag files in from Windows Explorer or the desktop, and drag files out to them.
- Paste as file: pasted text becomes a .txt, .md, or .csv file and a pasted screenshot becomes a .png (or .jpg, chosen in Settings), with the name ready to edit. Image decoding runs in a separate helper process, so a damaged image cannot hang the app.
- Duplicate names are clear: New items, downloads and pasted files count from one ("report (1)"); a copied item that keeps both uses Explorer's "report - Copy", and a moved item uses "report (1)".
- Help pages for copying and moving, deleting and the Recycle Bin, undo, drag and drop, and paste as file, in English and Spanish.

### Fixed

- Finding text in a Markdown page no longer fails on engines without the CSS Custom Highlight API (KI-031).
- A cancelled folder listing is dropped at once, so its items no longer stay in memory (needed by Column view, which cancels many listings).
- Choosing each conflict separately now works; a cancelled or partly finished move can be undone exactly; moving, recycling or deleting system items asks first.
- A copy or move can no longer recycle a file that appeared after the conflict prompt: Replace is unavailable until recycling can be bound to the exact approved item.
- A move deletes a source only after its identity and bytes match the finished copy; a source changed or replaced during the job stays where it is.
- Pasting an image can no longer overwrite a file created while it was being saved, and a damaged image is decoded in a separate process.
- Redo after Undo never overwrites or recycles an item restored at the destination; it reports the conflict instead.
- The speed and runtime checks stop only their own test app and its child processes, never every Adperastra window on the PC.
- Tabs can be switched with the keyboard (arrow keys, Home, End).
- Screen-reader fixes: the tab strip, column headers and the language tag of the page follow the accessibility rules, and the small "Folders in" arrows in the address bar are easier to hit.
- Every app instance keeps its browser data in its own data folder, and the app talks to its core directly instead of through a slower fallback.

### Changed

- The dark theme writes black on its accent color instead of white, so the text on accent-colored buttons and rows is easy to read (Step 05d).
- File tab viewers share a ribbon: the picture viewer's zoom, fit, actual size and rotate controls moved there, and the new text and Markdown viewers use the same frame.
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
