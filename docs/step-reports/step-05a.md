# Step 05a report - View modes: List, Icons, Tiles, Content

Dates: 2026-10-30. Status: **built and merged into local `testing`; the speed run, the screenshots and the owner's hand checks are still to do**. Nothing was pushed and `main` was not touched (owner's local-only decision, 2026-10-30).

## How to try it

```powershell
$env:CARGO_TARGET_DIR="$env:TEMP\adperastra-target"
npx -y @tauri-apps/cli@2 build --no-bundle
& "$env:TEMP\adperastra-target\release\Adperastra.exe"
```

## Owner checklist

Create this test folder first. All files are plain text unless the table says otherwise.

| Path (inside `%TEMP%\adp-05a`) | Content |
|---|---|
| `Folder A\` | a folder holding `page 1.md` to `page 5.md`, each with the text `# Page <n>` |
| `Folder B\` | an empty folder |
| `note 01.txt` to `note 40.txt` | the text `note <n>` |
| `picture.png` | a copy of `docs\screenshots\step-01a\06-first-run-en-light.png` |
| `a very long file name that will not fit on two lines under a large icon.txt` | the text `long` |

The 100,000-item folder comes from `.\scripts\generate-corpus.ps1`.

1. Open the test folder. **View** in the command bar lists the 8 views in Windows' order with Ctrl+Shift+1 to Ctrl+Shift+8; the check mark is on **Details**.
2. Try every view from the menu and with Ctrl+Shift+1 to 8. Each draws the files as the help page describes; the long name shows on two lines in Large icons, and fully when you point at it.
3. Ctrl+mouse wheel over the files: up goes Details, List, Small, Medium, Large, Extra large; down goes back. The page itself never zooms or scrolls.
4. In Large icons: the arrow keys move as the icons are laid out; Shift+arrows extend the selection; Ctrl+A; typing "no" jumps to "note 01.txt"; F2 shows the rename box under the icon; Enter opens a file; Delete recycles it and Ctrl+Z brings it back.
5. Right-click an icon and empty space: the right menus open. Drag a file onto "Folder B" (it moves) and undo.
6. Group by type in Large icons: the headers sit on their own rows. Switch to List: no headers, same order. In List, the mouse wheel scrolls sideways and Left/Right jump a column.
7. Turn on **Item check boxes** in Large icons: each icon has a box at its top-left corner that selects it.
8. Folder memory: set Folder A to Large icons; open Folder B (Details); go back to Folder A (Large icons). Close and reopen the app: still the same.
9. Settings > Views: turn off **Remember each folder's view**, then choose Tiles in Folder B: Folder A also shows Tiles now. Turn it on again: Folder A shows Large icons again. **Forget folder views**: the message appears, and every folder now uses the default view.
10. Settings > Views: hide Tiles: it disappears from the View menu and Ctrl+Shift+7 does nothing. Move Content to the top: the menu order changes. Change **Default view** to List: folders without their own view open in List.
11. The status bar buttons switch between Details and Large icons, and the pressed one follows the view.
12. Open the 100,000-item folder in Large icons: scrolling is smooth; arrow keys answer at once.
13. Repeat checks 2 and 9 in Spanish and in the dark theme: texts fit, colors follow the theme.

## What works

Covered by the automated checks; not yet tried by hand.

- Eight views: Extra large, Large, Medium and Small icons, List, Details, Tiles and Content, with shortcuts, the View menu, Ctrl+wheel and the status bar buttons.
- Every view shares one set of item interactions (`useItemInteractions`).
- Each folder remembers its view in `folder-views.json` (newest first, at most 1000 folders).
- Settings > Views: default view, folder memory, forgetting folder views, and hiding and ordering views.
- Settings schema 6 loads a schema-5 file.

## Not in this step (on purpose)

- Column view: Step 05b.
- Movable toolbars and panes: Step 05c.

## Decisions and plan changes made during the step

- Built as one batch, with a quick check after each task instead of the full gate (owner's decision, 2026-10-30, `plan/STATUS.md`). The full gate ran at the end and found the two problems below.
- **F1:** the lint required `sort_by_key` in `FolderViews::normalized` instead of the guide's `sort_by`. Both are stable sorts, so the order is the same.
- **F2:** `saves_and_loads_the_same_list` set the newer folder first, which `FolderViews::set` and the later sort on load order differently. The test now sets the folders in time order, as the app does. It still compares the saved and loaded lists in full.
- The step was first started on T1 of Step 04c, then moved onto the finished 04c before any 05a task was committed.
- The step's report was written after the worker building it had stopped, from the step file, the commits and the gate results.

## Speed (development PC, packaged release build)

| Interaction | Tier | Measured (median) | Result |
|---|---|---|---|
| Switch to Large icons in the 100,000-item folder | Fast (1 s) | pending | pending |
| Arrow key move in Large icons, 100,000 items | Instant (0.1 s) | pending | pending |
| Switch to List in the 100,000-item folder | Fast (1 s) | pending | pending |
| Scrolling Large icons, 100,000 items | Smooth | by hand (check 12) | waiting for the owner |
| Every existing measurement | as before | pending | not more than 20% slower than Step 04c |

Raw numbers: pending.

## Checks by hand

| Check | English light | Spanish dark | Result |
|---|---|---|---|
| Owner steps 1-13 above | waiting | waiting | waiting for the owner |

## Verification

- `.\scripts\gate.ps1` (without `-Package`) on `bca1ab2`: **GATE PASSED**, with 179 Rust tests and 196 UI tests (41 files).
- One UI test, in `fileOpConfirmations.test.tsx` ("applies Merge then Keep both separately when the for-all box is cleared"), timed out at 5 s in one earlier full run while the PC was busy. It passed alone and in the later full runs.
- The "Done when" item "each task committed after `GATE PASSED`" does not apply to this batch, because of the owner's decision above.
- Not run: `.\scripts\gate.ps1 -Package`, the speed run, the screenshots, and the owner's hand checks.

## Screenshots

`docs/screenshots/step-05a/`: `17-large-icons`, `18-tiles`, `19-content`, `20-list`, `21-view-menu` - pending.

## Known issues

- New: none.
- Fixed: none.
- Still open: see `KNOWN_ISSUES.md`.

## Design deviations, dependencies, licenses

- `DESIGN_DEVIATIONS.md`: no new entry written with this report.
- New dependencies: none.

## Commits

```
bca1ab2 fix(test): set folder views in time order in the save and load test [step-05a/F2]
ba15995 fix(fs-service): sort folder views with a sort key so the lint passes [step-05a/F1]
fa360e3 test(speed): view mode measurements and screenshots [step-05a/T11]
81049af feat(settings): Views section [step-05a/T10]
bcc0063 feat(explorer): show the views, view shortcuts and status bar buttons [step-05a/T9]
f8f4d8d feat(explorer): view commands, menus and folder memory [step-05a/T8]
59fff5c feat(views): list view [step-05a/T7]
bb16f1b feat(views): icon, tiles and content views [step-05a/T6]
4d7389f refactor(explorer): share item interactions between views [step-05a/T5]
6298169 feat(views): grid layout and view mode rules [step-05a/T4]
40cf276 feat(views): folder view commands [step-05a/T3]
7f6a9d2 feat(settings): view mode settings (schema 6) [step-05a/T2]
5bce030 feat(fs-service): remember a view per folder [step-05a/T1]
```

## Next step

Step 05b: Column view (from `plan/STATUS.md`).
