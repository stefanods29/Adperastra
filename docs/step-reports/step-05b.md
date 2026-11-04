# Step 05b report - Column view

Dates: 2026-10-30. Status: built on the local branch `step-05b-column-view`
(no push, pull request, merge or tag: the owner's local-only rule for this
batch). The owner's checks, the speed runs and the screenshots are still to
do.

## How to try it

```powershell
.\scripts\gate.ps1 -Package
.\build\Adperastra\Adperastra.exe
```

## Owner checklist

Create the test folder `%TEMP%\adp-05b` first (all files are plain text
unless the table says otherwise):

| Path (inside `%TEMP%\adp-05b`) | Content |
|---|---|
| `Projects\Alpha\plan.txt` | the text `plan` |
| `Projects\Alpha\notes.md` | the text `# Notes` |
| `Projects\Alpha\Drafts\draft 1.txt` | the text `draft` |
| `Projects\Beta\` | an empty folder |
| `Photos\picture.png` | a copy of `docs\screenshots\step-01a\06-first-run-en-light.png` |
| `Deep\L1\L2\L3\L4\L5\deep.txt` | the text `deep` |
| `report.txt` | the text `report` |
| `a very long file name that will not fit in one column of the column view.txt` | the text `long` |
| `secret.txt` | the text `secret`; then turn on its Hidden attribute (right-click > Properties > Hidden) |

The 100,000-item folder comes from `.\scripts\generate-corpus.ps1`.

1. Open the test folder. **View** lists **Columns** as the ninth view, without a shortcut. Choose it: one column with the folder's items; the check mark moves to **Columns**.
2. Click `Projects`: a second column with `Alpha` and `Beta` appears on the right at once. Click `Alpha` there: a third column. Click `plan.txt`: the preview shows its type, size and date; **Open** opens it in a tab.
3. The address bar, the status bar and the Details pane (Alt+Shift+P) always describe the column with the blue selection. Back returns to the previous folder, still in columns.
4. Keyboard in the columns: Up and Down move; Right enters the selected folder at its first item; Left goes back one column; in the first column Left opens `%TEMP%` and the columns grow to the left. Type "pl" to jump to `plan.txt`; F2 renames it inside the column; Enter opens it; Delete recycles it and Ctrl+Z brings it back.
5. With `Alpha` open, click `report.txt` in the first column: the columns go back to the test folder with `report.txt` selected. Right-click `notes.md` in a column on the left: the menu opens for `notes.md` (its Properties show `notes.md`).
6. Double-click a file in a column on the left: it opens. Drag `report.txt` onto `Beta` in another column: it moves; Ctrl+Z. Drag a file onto the empty part of a column on the left: it moves into that column's folder; Ctrl+Z. Drag a file from Windows Explorer onto a column: it lands in that column's folder.
7. Drag the edge between two columns: all columns change width together; double-click the edge: back to the standard width. Settings > Views > **Column view**: the slider shows the same width and changes it; turning off **Show a preview of the selected file** removes the preview.
8. The long file name is cut with "…" in its column; pointing at it shows the whole name.
9. `secret.txt` shows only with **View** > **Hidden items** on, in every column.
10. Choose Columns in the test folder, open `Projects\Alpha` through the columns, go to Home, then open the test folder again: still Columns. Open another folder from the navigation pane (for example Documents): it uses its own view. In `Projects\Alpha` (in columns), choose Large icons: Column view ends.
11. Open `Deep\L1\L2\L3\L4\L5` through the columns: the strip always scrolls to show the last column.
12. Open the 100,000-item folder in Columns: scrolling is smooth; arrow keys answer at once; selecting a subfolder shows its column within a second.
13. Group by type in Columns: no headings, folders first, the same order as in List.
14. Repeat checks 2 and 7 in Spanish and in the dark theme: texts fit, colors follow the theme, the selection, the gray "way" item and the divider are visible.

## What works

- Column view is the ninth view: id `columns`, label "Columns", icon
  `Columns3`, no shortcut, last in the default View order, help page
  `view-modes`; it can be hidden, reordered, made the default view and
  remembered per folder like every other view (settings schema 7).
- The open folder is the active column; the columns to its left are the
  folders above it up to the trail root (at most 24), and the column to its
  right shows the selected folder's contents or the selected file's preview.
- Trail rules: Column view stays on inside its folders, moving above the root
  makes that folder the new root, going Home and back keeps the trail, and
  choosing another view ends it.
- Every side column is its own virtualized list (28 px rows) that loads and
  caches its folder (`listFolder`), starts the child 150 ms after the
  selection, reloads on F5, after file operations, on a sort change and when
  a folder that was open becomes a side column again, and cancels what is no
  longer wanted.
- Skeleton after 0.1 s, "Still loading..." after 1 s, "Not available" after
  15 s, and the empty/failed/skipped notes, inside each column.
- Keyboard: everything from Details in the active column, plus Right (opens
  the selected folder at its first item) and Left (goes one column back, or
  opens the parent folder in the first column).
- Mouse: click in a side column opens that folder and selects the item;
  right-click opens the item's menu once it is selected; double-click opens
  the item; dragging a side-column item drags only that item.
- Drop targets: every folder row in every column and the empty part of every
  column, for drops inside the app and from Windows.
- One shared column width, dragged by the divider or set with the slider in
  Settings > Views (160 to 480, standard 240, double-click resets); the
  preview column is at least 280 px wide.
- The preview column: type tile, name (3 lines), type, size, date modified,
  "Online only" for cloud files, and an **Open** button. It reads nothing from
  the file.
- Cancelling a folder listing now removes it from Rust's job table at once.
- Help: `view-modes` rewritten for Column view in English and Spanish, and the
  View bullet of `command-bar` lists Columns.

## Not in this step (on purpose)

- No real previews in the preview column (pictures, text, PDF pages, video
  frames): Step 07b (and 07a for thumbnails).
- No keyboard shortcut for Column view (Step 10b can add one).
- Column view for the Home page, This PC, Gallery and Network is unchanged.
- No group headers in columns, no rubber-band selection (Step 09d), no
  per-column width, no split view (Step 09i), no saved columns in tab sessions
  (Step 09a).

## Decisions and plan changes made during the step

- `scripts/measure-ui.mjs` item 1 of T10 ("the step value `05a` becomes
  `05b`") needed no literal change: the JSON record's `step` is the CLI
  argument, and `scripts/measure-ui.ps1` derives it from the branch name
  (`step-05b-column-view` gives `05b`). No `05a` string exists in the script.
- In the new screenshot steps, the rows are found with
  `document.querySelectorAll(".adp-colview-row")` instead of
  `window.__m.rows()`: the guide says "the row whose text includes ..."
  without naming a selector, and `window.__m.rows()` only sees the active
  column's rows (because only that column carries `adp-filelist-scroll`).
  The generic row selector works in every column.
- Doc comments that said "eight view ids" were updated to nine in
  `crates/fs-service/src/folder_views.rs` and `src/services/settings.ts`
  (comments only, no behavior).
- In `viewsSettings.test.tsx`, the move-down check for `content` now compares
  the last three entries (`tiles, columns, content`) because `columns` is the
  new last entry; the task text says the same.
- All other decisions follow the step file as written; no library was added
  and no contract changed.

## Speed (development PC, packaged release build)

Not run: this batch does not run measurements or the packaged gate. Pending.

| Interaction | Tier | Measured (median) | Result |
|---|---|---|---|
| Switch to Column view in the 100,000-item folder | Fast (1 s) | pending | pending |
| Arrow key move in Column view, 100,000 items | Instant (0.1 s) | pending | pending |
| A selected subfolder's column appears | Fast (1 s) | pending | pending |
| Moving between columns with Right and Left | Fast (1 s) | pending (by hand, check 4) | pending |
| Scrolling a 100,000-item column | Smooth | pending (by hand, check 12) | pending |
| Every existing measurement | as before | pending | pending |

The three new measurements are written into `scripts/measure-ui.mjs`
(`100k folder: switch to Column view (View menu)`,
`100k folder: arrow key move in Column view`,
`100k folder: show a subfolder's column`) and wait for the owner's run.

## Checks by hand

| Check | English light | Spanish dark | Result |
|---|---|---|---|
| 1 to 14 above | pending | pending | waiting for the owner |

## Verification

What was run after every task of this step, and passed:

- `cargo fmt --all`
- `cargo check --workspace --all-targets`
- `npm run lint:i18n` (488 keys, 29 help pages, 70 tsx files)
- `npm run lint:ipc` (57 commands, 56 invoke calls)
- `npm run build` (`tsc --noEmit` and `vite build`)

Per the owner's rule for this batch, `npm test` / `vitest`, `cargo test` and
`scripts/gate.ps1` were not run, here or anywhere in the step. The full suite
and the packaged gate are for the owner's later run.

New tests written (name lists as the step file gives them):

- Rust: `cancelling_a_listing_drops_its_job` (T1);
  `settings_v6_migrates_to_v7_keeping_language_and_theme`,
  `settings_validate_rejects_bad_column_width` (T2);
  `crates/fs-service/tests/step05b_column_view_tests.rs`:
  `columns_is_the_ninth_view_mode` (T2).
- UI: `columnTrail.test.ts` (T3), the four `useViewMode` tests (T4),
  `columnListing.test.ts` and `useColumnListings.test.tsx` (T5),
  `columnPane.test.tsx` (T6), `columnView.test.tsx` (T7),
  `useColumnNavigation.test.tsx` and the `itemView` test (T8), the
  ViewsSettings test (T9); existing tests updated exactly where T2 and T9 say.

## Screenshots

`docs/screenshots/step-05b/`: `22-column-view` and `23-column-preview` are
written into the screenshot part of `scripts/measure-ui.mjs`; they are
pending (this batch takes no screenshots).

## Known issues

- New: none.
- Fixed: none recorded as an issue; the cancelled-listing leak (D19) was
  fixed inside this step as T1 before it reached a release.
- Still open: KI-003 (Major, cold start after a reboot not measured), KI-015
  (Minor placeholder text now out of date), KI-024, KI-030, KI-032, KI-001,
  KI-002, KI-004, KI-005, KI-009, KI-016; none touched by this step.

## Design deviations, dependencies, licenses

- `DESIGN_DEVIATIONS.md`: none.
- New dependencies: none.

## Commits

```
b691cc3 fix(explorer): drop cancelled folder listings at once [step-05b/T1]
618fa93 feat(settings): Column view id and settings (schema 7) [step-05b/T2]
7f39eb9 feat(views): column trail rules [step-05b/T3]
7680657 feat(views): keep Column view on while browsing its folders [step-05b/T4]
1f8e454 feat(views): load and cache the other columns' folders [step-05b/T5]
ef3a01b feat(views): one column of Column view [step-05b/T6]
af70ca8 feat(views): Column view with the preview column [step-05b/T7]
ab8568d feat(explorer): show Column view in folders [step-05b/T8]
c625db2 feat(settings): Column view settings and help [step-05b/T9]
792591b test(speed): Column view measurements and screenshots [step-05b/T10]
```

## Next step

Step 05c: Movable toolbars and panels, layout presets (from `plan/STATUS.md`).

Note for the owner: `plan/STATUS.md` was not edited (this batch keeps the
plan files untouched) and KI-015 still describes List and the icon views as
disabled placeholders, which Step 05a already resolved.
