# ADR 0006: Step 03a selection, menus, and shell actions

Status: accepted (Step 03a, owner decisions 2026-10-28).

## Owner decisions

- **Design:** the preview of the command bar, Details pane, right-click
  menus, View menu, rename box and status bar was approved before
  building (recorded in DESIGN_DEVIATIONS.md).
- **Not-yet-built commands:** New, Cut, Copy, Paste, Delete (Step 03b)
  and the List/icon views (Step 05) are shown disabled, with tooltips
  saying they arrive later (KI-015), so the bar matches Figma now.
- **Rename undo:** rename works in 03a; its Undo toast and Ctrl+Z arrive
  with the undo stack in 03b (KI-014, Major, deferral approved).
- **Show more options:** the real classic Windows menu, run in a separate
  process.

## Rulings

- **Classic menu helper:** the app's own executable started with
  `--classic-menu` reads the request (paths, screen point) on stdin, builds
  the menu with `IContextMenu` (items) or `CreateViewObject` (empty
  space), prints `ready` just before showing it, and stays alive while a
  window it opened (for example Properties) is visible. The app waits at
  most 5 s for `ready`, then kills the helper and shows a message, so a
  slow or crashing shell extension can never freeze or crash the app. The
  helper runs with the user's normal rights (shell verbs need them); it is
  separate for crash and hang isolation, not as a low-privilege sandbox.
- **Rename:** `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING`, so a name
  clash fails instead of overwriting; the new name is validated in the UI
  while typing and again in Rust; a case-only change is allowed.
- **Item details:** read with `GetFileAttributesExW`, which never opens the
  file, so online-only placeholders are never downloaded by selecting
  them.
- **Opening files:** the Windows default app (`ShellExecuteExW`) until the
  open pipeline (Step 04a); shortcuts to folders and folders open inside
  the app. Opening many files stops at 15, like Windows.
- **Share:** the Windows share sheet through `IDataTransferManagerInterop`
  on the window's thread; the files are resolved on a worker thread when
  Windows asks for them. Folders can't be shared (Windows limitation).
- **Open in Terminal:** `wt.exe -d .` with the folder as working
  directory, PowerShell when Windows Terminal is missing; the path is
  never placed on a command line.
- **Settings schema 3:** hidden items, file extensions, check boxes, the
  Details pane and group-by. Hidden items are hidden by default, like
  Windows (fixes KI-013 early). Explorer state schema 2 adds favorites.
- **Menus from commands (contract 9):** `MenuDef` entries (command,
  submenu, separator, icon row) drawn by one renderer; commands gained
  check state, visibility and context labels. The menu editor (10b) can
  change the data without a format change.
- **Measuring:** `scripts/measure-ui.ps1` starts the packaged app with the
  WebView2 debugging port and times each interaction inside the page up to
  the next painted frame (`docs/benchmarks/2026-10-28-ui-step03a.json`).
