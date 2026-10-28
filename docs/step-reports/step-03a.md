# Step 03a report - Selection, Details pane, command bar, and right-click menu

Dates: 2026-10-28. Status: implemented on branch `step-03a-selection-details-menus`, awaiting owner approval. Proposed tag after approval: `v0.0.5-step03a`.

## Owner decisions and additions (all implemented)

- Step 02 approved and closed first (PR #5 merged, tag `v0.0.4-step02`), including the folder and This PC screens.
- The Step 03a design preview (command bar, Details pane, menus, View menu, rename box, status bar) was approved before building; recorded in DESIGN_DEVIATIONS.md.
- New, Cut, Copy, Paste, Delete and the List/icon views are shown disabled until Steps 03b and 05 (KI-015). Rename works now; its Undo arrives with the undo stack in 03b (KI-014, Major, deferral approved).
- "Show more options" opens the real classic Windows menu in a separate process (ADR 0006).

## How to build and run

```powershell
.\scripts\package-app.ps1
.\build\Adperastra\Adperastra.exe
$env:CARGO_TARGET_DIR="$env:TEMP\adperastra-target"; cargo test --workspace
npm test; npm run lint:i18n; npm run build
.\scripts\generate-corpus.ps1            # 100k-item test folder in %TEMP%
.\scripts\measure-ui.ps1                 # Step 03a speed + screenshots (release build)
```

## Test checklist for the owner

1. Open a folder. Click a file: it is selected and the status bar shows "1 item selected" and its size.
2. Ctrl+click two more files, then Shift+click another: the selection follows Windows rules. Ctrl+A selects everything, even when the list doesn't have focus.
3. Type the first letters of a file name: the list jumps to it. Type the same letter again: it moves to the next match.
4. Press F2 on a file: only the name (not the extension) is selected. Type `a?b` and press Enter: a message explains the problem and nothing changes. Type a new name and press Enter: the file is renamed. Try renaming a file to the name of another file: it refuses and keeps both.
5. Click a selected file's name again after a moment: the rename box opens (a double-click opens the file instead).
6. Click **Details** at the right of the command bar (or Alt+Shift+P): the pane shows the file's size, location, dates and attributes; select several files to see the total; select nothing to see the folder.
7. Right-click a file: Open, Open with…, Add to favorites, Copy as path, Properties, and the icon row. Try **Properties** and **Open with…**.
8. Right-click empty space: View, Sort by and New submenus, Open in Terminal (opens Windows Terminal in that folder), Properties.
9. Choose **Show more options** (or press Shift+F10): the classic Windows menu appears with your other apps' items (7-Zip, Send to, ...). Choose one, for example Properties.
10. Use **Sort** > **Group by** > **Type**: the list shows group headers. Use **View** > **Hidden items**, **File name extensions**, **Item check boxes**; restart the app: your choices are kept.
11. Right-click a file and **Add to favorites**; on Home, switch to **Favorites**: it is listed. Right-click it there and use **Show in folder**.
12. Make the window narrow: buttons that don't fit move into **See more** (•••).
13. Switch to Spanish and the dark theme in Settings and repeat a few of these.

## What works

- Selection model (pure, unit-tested): click, Ctrl, Shift and Ctrl+Shift ranges, keyboard moves (arrows, Home/End, Page Up/Down, with Shift or Ctrl), Ctrl+Space, Ctrl+A (anywhere in the Explorer), type-ahead with same-letter cycling, select none, invert, item check boxes, pruning after refreshes.
- Rename: F2 and one-step rename, name-only selection, instant validation (reserved names, invalid characters, length) mirrored by Rust, never overwrites (`MoveFileExW` without replace), case-only changes, clear translated errors (exists, in use, access denied, not found, too long).
- Details pane: one item (instant from the listing; created/accessed dates and attributes from `GetFileAttributesExW` without opening the file, skeleton after 0.1 s), several items (counts and total size), nothing selected (the open folder).
- Command bar from data (contract 9) in the Figma order with the Details toggle, tooltips with shortcuts, disabled states, collapse into See more when narrow.
- Menus from commands: one renderer for right-click menus, dropdowns, submenus and See more; keyboard (arrows, Enter, Escape, Left/Right, letters), check marks, the Menu key and Shift+F10, viewport clamping.
- Commands: Open (folders in the app, files in their Windows default app, shortcuts to folders open in the app), Open with…, Properties (one or several items), Share (Windows share sheet), Copy as path, Add to/Remove from favorites, Show in folder, Open in Terminal (Windows Terminal, PowerShell fallback), Select all/none/invert, Sort and Group by, View toggles, Pin folder (now in See more).
- Show more options: the classic menu with every shell extension, in a helper process with a 5 s timeout and a "Loading more options…" note after 0.3 s.
- Settings schema 3 (view options, v2 files keep language and theme), Explorer state schema 2 (favorites), Favorites list on Home.

## What deliberately does not work yet

- New, Cut, Copy, Paste, Delete: Step 03b (file operations, undo, jobs). Rename has no Undo yet (KI-014).
- List and icon views: Step 05. Rich metadata and previews in the Details pane: Step 07a.
- Opening files uses the Windows default app; the open pipeline and built-in viewers start in Step 04a.

## Speed (development PC in docs/benchmarks/MACHINE.md)

Packaged release build, measured inside the page from the action to the next painted frame, median of 7 runs (`scripts/measure-ui.ps1`).

| Interaction | Tier | Measured (median) | Result |
|---|---|---|---|
| Select an item (click) | Instant 0.1 s | 14 ms | Pass |
| Add an item (Ctrl+click) | Instant 0.1 s | 7 ms | Pass |
| Type-ahead jump | Instant 0.1 s | 12 ms | Pass |
| Right-click menu on a file | Instant 0.1 s | 9 ms | Pass |
| Right-click menu on empty space | Instant 0.1 s | 15 ms | Pass |
| Command bar View menu | Instant 0.1 s | 8 ms | Pass |
| Rename box (F2) | Instant 0.1 s | 9 ms | Pass |
| Details pane hide/show | Instant 0.1 s | 9 ms | Pass |
| 100k folder: select an item | Instant 0.1 s | 8 ms | Pass |
| 100k folder: arrow key move | Instant 0.1 s | 14 ms | Pass |
| 100k folder: select all (Ctrl+A) | Instant 0.1 s | 30 ms | Pass |
| 100k folder: right-click with all selected | Instant 0.1 s | 10 ms | Pass |
| 100k folder: Shift+click range | Instant 0.1 s | 16 ms | Pass |
| Show more options (classic menu on screen) | Waiting with feedback 1-10 s | 0.55-0.74 s warm, 2.1 s first time | Pass (note after 0.3 s, timeout 5 s) |
| App start, cold WebView2 (first paint / ready) | Fast 1 s | 107-176 ms / 0.77-1.14 s (3 runs; Step 01b: 87 ms / 0.70 s) | Miss in 1 of 3 runs, logged as KI-017 |
| First start of a freshly built exe | one-time | 1.14 s paint / 2.48 s ready | Known one-time cost (KI-002) |

Our own menus never touch shell extensions, so they stay instant however slow an installed extension is; the classic menu is the only part that waits on extensions, and it can't block the app. Raw numbers: `docs/benchmarks/2026-10-28-ui-step03a.json`.

## Verification

- `cargo test --workspace`: 70 pass (app 28 incl. classic-menu helper timeout/ready/crash and request checks; fs-service 26 incl. 10 new for rename, details and favorites); `cargo clippy --workspace --all-targets` and `cargo fmt --check` clean.
- `npm test`: 46/46 (selection, names, grouping, commands and menus, FileList keys/type-ahead/rename/groups, help pages in both languages); `tsc` clean; `npm run lint:i18n` passes (263 keys); `npm audit`: 0 vulnerabilities; release build passes.
- Packaged app driven through the WebView2 debugging port (`scripts/measure-ui.ps1`): speed table above and the screenshots below. Fixed from that run: Ctrl+A selected the page's text, the Details pane's folder icon was invisible, the rename message was covered by the next row, and Home columns overflowed.
- Not done yet: the full suite on `testing` and the plan review (both stopped when the usage limit was reached); the Step 02 startup baseline for KI-017.

## Screenshots vs. Figma

`docs/screenshots/step-03a/`: Home with the command bar (`00-home`), a folder with the Details pane (`01`), the item menu (`02`), the empty-space menu with the View submenu (`03`), several items selected (`04`), a refused rename (`05`), and the Sort menu (`06`), each in English light, Spanish dark and the pseudo-locale. Compared with `plan/design-sc/screens/01-explorer-home.png`: the command bar order, icons, separators and heights match; the address row and command bar now span the window like the frame; the Recent/Favorites pills keep the Step 02 segmented style; the Details toggle, pane and menus are the approved extensions (DESIGN_DEVIATIONS.md).

## Help pages

New in English and Spanish: Selecting files, The Details pane, The command bar, The right-click menu. Updated: The Home page (favorites, Show in folder), Browsing folders (hidden items, opening files), Pinning folders (Pin folder moved to See more). A test checks that every command's help page exists in both languages.

## Known issues

New: KI-014 (Major, deferral approved: no Undo for rename until 03b), KI-015 (Minor: placeholder entries until 03b/05), KI-016 (Minor: some classic-menu commands such as its Rename may do nothing outside Windows Explorer).
Fixed: KI-013 (hidden items) in `08a6cef`, earlier than its 10b target.
Still open: KI-001, KI-002, KI-004, KI-005 (Minor), KI-003 (Major, after-reboot cold start, due before v0.1), KI-009 (Minor, 07a).

## Design deviations and licenses

- DESIGN_DEVIATIONS.md: "Command bar, Details pane, menus and rename (Step 03a)", approved by the owner on 2026-10-28.
- New dependency: `windows-collections` 0.2 (MIT/Apache-2.0, already in the lock file as part of the windows crate) for the share sheet; new `windows` features for DataTransfer, Storage, Ole, LibraryLoader and Shell Common. Recorded in docs/dependency-and-license-table.md.
- Found and fixed along the way: CI had never passed (the secrets check matched its own error message case-insensitively, and the build step called a missing `tauri` command); the hardcoded-text lint mistook TypeScript arrows for JSX text.

## Commits (branch step-03a-selection-details-menus, from testing 69280e7)

- `34ba3a5` docs(records): known issues, design deviation, decision record and changelog for step 03a [step-03a]
- `f3fd280` docs(screenshots): add step-03a screenshots in English, Spanish and pseudo-locale [step-03a]
- `5d35b31` test(bench): measure Explorer interactions in the packaged app [step-03a]
- `530fc57` fix(explorer): let date and type columns shrink in narrow layouts [step-03a]
- `390cdf8` fix(explorer): show the folder icon in the details pane and keep rename messages on top [step-03a]
- `02282bd` fix(explorer): select files with Ctrl+A anywhere and keep interface text unselectable [step-03a]
- `c92e1c0` docs(help): add pages for selecting files, the details pane, the command bar and the right-click menu [step-03a]
- `0b09bfd` feat(explorer): add the share sheet and the classic menu (Show more options) [step-03a]
- `ec02e83` deps: add windows-collections 0.2 and shell/WinRT features (MIT/Apache-2.0) [step-03a]
- `08a6cef` feat(explorer): add the command bar, right-click menus, details pane and multi-select [step-03a]
- `cfd60d6` feat(i18n): add command bar, menu, details and rename strings [step-03a]
- `048d02b` feat(settings): add explorer view options to the UI settings model [step-03a]
- `5d15f0f` fix(i18n): stop the text lint flagging arrow functions [step-03a]
- `dadb677` feat(explorer): add selection, naming and grouping helpers [step-03a]
- `e8ba567` feat(explorer): add details, rename, favorites and shell commands [step-03a]
- `abf4a6c` feat(settings): add explorer view options (schema 3) [step-03a]
- `bf0d2a2` deps: enable the windows Win32_UI_Shell_Common feature [step-03a]
- `b1245ce` feat(fs): add item details, rename in place, and favorites [step-03a]
- `5ba4b35` refactor: satisfy the newer clippy lints [step-03a]
- `e965700` docs(plan): add step-03a implementation plan and owner decisions [step-03a]

## Proposal for the next step

Step 03b (file operations, job runner, undo stack, drag and drop, paste as file). It turns on the disabled New/Cut/Copy/Paste/Delete entries (KI-015), adds Undo to rename (KI-014), and gives the undo toasts their first real use.
