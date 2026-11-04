# Step 05b: Column view

| | |
|---|---|
| State | guide |
| Difficulty | ★★★ |
| Branch | `step-05b-column-view` |
| Tag | `v0.0.11-step05b` |
| Depends on | 05a |
| Written before | P2 was built (written from the 04a, 04b and 04c recipes and the 05a guide; names from Step 05a are in `plan/guide-ledger.md`) |

This is a **guide** step (AGENTS.md "Steps come in two kinds"): every decision is below, but no code. Write the code exactly as described: the names, files, types, numbers and texts given here, and nothing else. If something you must write is not decided here, stop with `BLOCKED.md` (AGENTS.md section 5).

## Goal

The View menu gets a ninth view, **Columns** (Column view, like the Finder on a Mac): every folder shows in its own column, side by side. Clicking a folder opens its contents in a new column on the right; clicking a file shows a preview of it (type, size, date and an Open button) in the last column. The keyboard works as in the other views, plus Right and Left to move between columns. Files can be dragged onto any folder or any column. Columns are virtualized, so a folder with 100,000 items stays smooth. The column width can be dragged or set in Settings > Views, the preview column can be turned off, and Column view follows the Step 05a rules: it can be hidden, reordered, chosen as the default view and remembered per folder.

## Do not do in this step

- No real previews in the preview column (pictures, text, PDF pages, video frames): it shows the colored type tile and the facts from the listing. Step 07b (Quick preview) puts real previews there; Step 07a brings thumbnails.
- No keyboard shortcut for Column view (Windows has none to copy). Step 10b's keyboard customization can add one.
- Column view only shows folders. The Home page lists, This PC, Gallery and Network keep their current look.
- No group headers in columns (the grouped order is kept, as in List view). No rubber-band selection (Step 09d).
- Tab sessions do not remember the columns (Step 09a saves view state). No split view (Step 09i).
- No width per column: all columns share one width.
- Do not change how sorting, grouping, the search filter, opening, renaming, the Details pane, the status bar or file operations work. No new libraries.

## Read first

- `plan/conventions.md`, `plan/pitfalls.md` (P-04, P-10, P-11, P-13, P-16, P-18, P-20, P-25, P-28, P-32), `plan/rules.md` R-UI, R-LANG and R-FS.
- Recipes: `plan/recipes/add-settings-field.md`, `plan/recipes/add-translation-keys.md`, `plan/recipes/add-help-page.md`.
- Code (Step 05a): everything in `src/views/explorer/views/` (`viewModes.ts`, `gridLayout.ts`, `useItemInteractions.ts`, `FileGrid.tsx`, `ListModeView.tsx`, `ItemView.tsx`, `useViewMode.ts`), `src/views/explorer/FileList.tsx`, `src/services/folderViews.ts`, `src/views/settings/ViewsSettings.tsx`, `crates/fs-service/src/folder_views.rs`, and the tests `src/__tests__/fileGrid.test.tsx` (the mock and helpers to copy), `useViewMode.test.tsx`, `viewsSettings.test.tsx`, `itemView.test.tsx`, `viewModes.test.ts`, `settings.test.ts`, `commands.test.ts`.
- Code (older): `src/services/explorer.ts` (`startListDir`, `displayPath`, `pathSegments`, `parentPathOf`, `samePath`), `src/services/grouping.ts`, `src/services/selection.ts`, `src/services/settings.ts`, `src/commands/explorerCommands.ts` (the view mode part); in `src-tauri/src/main.rs` the settings part (from `CURRENT_SCHEMA` to the end of `migrate`), `ListJob`, `drain_job`, `list_dir_start`, `list_dir_poll`, `list_dir_cancel` and the tests module; in `src/views/ExplorerHome.tsx` the parts each task names (`refresh`, the "Show in folder" effect with `pendingSelectRef`, `openContextMenu`, the drag-and-drop section with `dragSession`, `listProps`, `folderContent`).

## Decisions (already made)

- D1. Column view is the ninth view mode, id `columns`, label "Columns", lucide icon `Columns3`, no shortcut, help page `view-modes`. It goes after `content` in the default order, so it is last in the View menu.
- D2. **The open folder is the active column.** The Explorer's location stays the single folder it is today: the address bar, status bar, Details pane, search box, commands, Paste and New all use it, unchanged. The active column shows the Explorer's own listing and selection. The columns to its left are the folders above it, up to the **trail root** (the first column); the column to its right shows the contents of the selected folder, or the preview of the selected file.
- D3. Clicking an item in any other column opens that column's folder (one normal navigation, with a Back entry) and selects the item. Clicking the empty part of a column to the left opens that folder with the folder you came from selected. Clicking the empty part of the column on the right opens that folder with nothing selected.
- D4. **The trail rule** (`columnTrailStep`, used by `useViewMode`): while Column view is on, opening a folder inside the trail root (or the root itself) keeps Column view and the root; opening a folder above the root keeps Column view and makes that folder the root; opening any other folder uses that folder's own view (Step 05a), and Column view starts again there (that folder as the root) only when its own view is Columns. Choosing a view from the menu sets the trail: Columns makes the open folder the root; any other view ends the trail. Going to Home or This PC keeps the trail, so Back returns to the columns. This keeps Column view on while you browse inside it, even though the folders you open have no remembered view of their own.
- D5. A trail shows at most 24 columns (the last 24); paths are compared with `folderViewKey` from Step 05a (case-insensitive, with or without `\\?\`, trailing backslash ignored).
- D6. Columns other than the active one load their own listing through a new service (`listFolder`, using the existing `startListDir`), sorted like the open folder and filtered by Hidden items like the open folder. The selected folder's column starts loading 150 ms after it is selected (moving quickly through folders does not list each one). Listings are cached per folder (at most 24; the oldest unused ones are dropped). The open folder is always listed by the Explorer itself, as today.
- D7. Only the open folder is watched for changes (as today). The other columns reload, keeping their rows on screen until the new list arrives, after F5, after every file operation, when the sort changes, and when a folder that was the open folder becomes a side column again.
- D8. While the Explorer is still loading the open folder, its column shows the cached rows of that folder (when there are any), so moving between columns never blinks. Columns are keyed by folder, so a column keeps its rows and scroll position when it changes role (the column you click becomes the active column in place; a double-click on a file in a side column therefore opens it).
- D9. Each column is its own virtualized list (`@tanstack/react-virtual`), rows 28 px high. Only the active column holds the blue selection; in the columns to its left, the item that leads to the next column is marked gray ("on the way"). Check boxes and the rename box appear only in the active column.
- D10. Keyboard in the active column: everything as in Details (Up, Down, Home, End, Page Up, Page Down, Shift, Ctrl, type-ahead, Enter, F2, the menu key, Ctrl+A). **Right**: when exactly one folder is selected, open it and select its first item (nothing selected when its column has not loaded yet or is empty); otherwise nothing. **Left**: open the column before it, selecting the folder you came from; in the first column, open the folder that contains it (it becomes the new root); at a drive root, nothing. With Shift, Ctrl, Alt or Meta held, Left and Right do nothing special (Alt+Left and Alt+Right stay Back and Forward).
- D11. Mouse in a side column: click = open its folder and select the item; right-click on an item = the same, then the item's menu opens as soon as the item is selected (if that happens within 1 second); right-click on empty space = open that column's folder (no menu; the background menu needs the folder open first); double-click = open the item; middle-click does nothing. Dragging an item from a side column drags only that item and does not change the selection.
- D12. Drop targets: every folder row in every column, and the empty part of each column (drops into that column's folder). Drops from other apps follow the same rule.
- D13. Width: all columns share one width, setting `column_width` (160 to 480 px, default 240), changed by dragging the divider at the right edge of any column (the change is saved when the mouse is released; double-click a divider for 240) or with a slider in Settings > Views. The preview column is `max(column width, 280)` wide.
- D14. The preview column (setting `column_preview`, on by default) appears for exactly one selected file: the type tile (96 px box, 48 px icon), the name (up to 3 lines), the type, then Size and Date modified, "Online only" with a cloud icon for online-only files, and an **Open** button. It reads nothing from the file (R-FS-1).
- D15. Loading states in side columns: skeleton rows after 0.1 s, "Still loading..." after 1 s, "Not available" after 15 s (R-FS-5), "This folder could not be opened." when the listing fails, "This folder is empty." for empty folders, and "Some items in this folder could not be read." when the listing skipped items (P-12).
- D16. The column strip scrolls to its right end when the open folder, the selected folder or the previewed file changes. When the open folder changes and the keyboard focus is on nothing or inside the column strip, the active column's list gets the focus.
- D17. Only the active column's scrolling element has the class `adp-filelist-scroll` (and `role="listbox"` with `aria-multiselectable`). Side columns use `adp-colview-list`. Every row in every column has `role="option"`. The measurement script and the tests rely on this.
- D18. Settings schema 7, section `explorer`, two new fields (table below). `view_mode_order` normalization in TypeScript adds `columns` to schema-6 lists (Step 05a's rule already appends missing ids); Rust keeps the stored list as it is.
- D19. Bug fix needed by Column view (which cancels many listings): a cancelled folder listing is removed from Rust's job table at once (today it stays in memory forever, because nobody polls it again).

## Data shapes

### Settings (schema 7), section `explorer`: new fields

| Field | Rust type | TypeScript type | Default | Allowed | Rust `validate()` |
|---|---|---|---|---|---|
| `column_width` | `u32` | `number` | 240 | 160 to 480 | must be from `COLUMN_WIDTH_MIN` (160) to `COLUMN_WIDTH_MAX` (480) |
| `column_preview` | `bool` | `boolean` | `true` | | |

TypeScript normalization (`normalizeSettings`):
- `column_width`: `normalizeColumnWidth` (a finite number is rounded to the nearest whole number, then clamped to 160..480; anything else gives 240).
- `column_preview`: a boolean, else `true`.

The view mode lists of Step 05a get the ninth id: Rust `fs_service::VIEW_MODES` (now 9 entries, `columns` last) and TypeScript `VIEW_MODE_IDS` / `ViewModeId`.

### New TypeScript exports

| Name | File | Shape |
|---|---|---|
| `COLUMN_WIDTH_DEFAULT`, `COLUMN_WIDTH_MIN`, `COLUMN_WIDTH_MAX` | `src/services/settings.ts` | numbers 240, 160, 480 |
| `clampColumnWidth` | `src/services/settings.ts` | (`width: number`) returns number: `min(480, max(160, round(width)))` |
| `normalizeColumnWidth` | `src/services/settings.ts` | (`value: unknown`) returns number: a number that is finite gives `clampColumnWidth(value)`; anything else 240 |
| `FolderListing` | `src/services/columnListing.ts` | `items` (`ExplorerItem[]`), `partial` (boolean) |
| `FolderRequest` | `src/services/columnListing.ts` | `done` (`Promise<FolderListing>`), `cancel` (function, no arguments, returns nothing) |
| `ColumnNote` | `src/views/explorer/views/columnTrail.ts` | `"loading"`, `"empty"`, `"noResults"` or `null` |
| `ColumnStep` | `columnTrail.ts` | `mode` (`ViewModeId`), `root` (string or `null`) |
| `ColumnViewOptions` | `columnTrail.ts` | table below |
| `ColumnListing` | `src/views/explorer/views/useColumnListings.ts` | `status` (`"loading"`, `"ready"` or `"error"`), `items` (`ExplorerItem[]`), `partial` (boolean), `version` (string) |
| `ColumnRole` | `src/views/explorer/views/ColumnPane.tsx` | `"parent"`, `"active"` or `"child"` |
| `ColumnNavigationInput` | `src/views/explorer/views/useColumnNavigation.ts` | Task T8 |
| `ViewModeState.columnRoot` | `src/views/explorer/views/useViewMode.ts` (new field) | string or `null`: the first column's folder while Column view is on |

`ColumnViewOptions` (what the Explorer gives the column view):

| Field | Type | Meaning |
|---|---|---|
| `folder` | string | the open folder (the Explorer's location path) |
| `root` | string | the first column's folder |
| `note` | `ColumnNote` | what the open folder's column shows instead of rows |
| `loading` | boolean | the Explorer is still loading the open folder |
| `showHidden` | boolean | the View setting "Hidden items" |
| `groupBy` | `GroupBy` | the grouping (columns keep the grouped order without headers) |
| `refreshKey` | number | changes when the side columns must reload |
| `width` | number | `column_width` from settings |
| `showPreview` | boolean | `column_preview` from settings |
| `onWidthChange` | function (`width: number`), returns nothing | saves a new width |
| `onNavigate` | function (`folder: string`, `select: string` or `null`, `menuPoint`: an object with `x` and `y` numbers, or `null`), returns nothing | open `folder`, select `select` in it, then open the item menu at `menuPoint` when given |
| `onDragItem` | function (`event`: React mouse event, `item: ExplorerItem`), returns nothing | mouse-down on a side column's item (may start a drag) |

### Constants (`columnTrail.ts`, all exported)

| Name | Value |
|---|---|
| `COLUMN_ROW_HEIGHT` | 28 |
| `PREVIEW_MIN_WIDTH` | 280 |
| `MAX_TRAIL_COLUMNS` | 24 |
| `CHILD_LOAD_DELAY_MS` | 150 |
| `COLUMN_CACHE_LIMIT` | 24 |
| `COLUMN_SKELETON_ROWS` | 6 |
| `SKELETON_DELAY_MS` | 100 |
| `SLOW_NOTE_DELAY_MS` | 1000 |
| `LISTING_TIMEOUT_MS` | 15000 |
| `PENDING_MENU_MS` | 1000 |

### Commands

| Command id | Label key | Icon (lucide) | Shortcut |
|---|---|---|---|
| `explorer.viewColumns` (new) | `commands.viewColumns` | `Columns3` | none |

### Translation keys (all new keys of this step)

| Key | English | Spanish |
|---|---|---|
| `commands.viewColumns` | Columns | Columnas |
| `explorer.columnPreview` | Preview | Vista previa |
| `settings.viewsColumns` | Column view | Vista de columnas |
| `settings.columnWidth` | Column width | Ancho de las columnas |
| `settings.columnWidthNote` | You can also drag the edge of a column. Double-click the edge to go back to the standard width. | También puedes arrastrar el borde de una columna. Haz doble clic en el borde para volver al ancho estándar. |
| `settings.columnPreview` | Show a preview of the selected file | Mostrar una vista previa del archivo seleccionado |

Existing keys this step reuses (do not add them again): `explorer.emptyFolder`, `explorer.loadError`, `explorer.stillLoading`, `explorer.notAvailable`, `explorer.someItemsUnreadable`, `explorer.noSearchResults`, `explorer.onlineOnly`, `explorer.isLink`, `explorer.details.size`, `explorer.details.modified`, `commands.open`. Each task says which keys it adds; after editing `en.json`, run `npm run i18n:pseudo`.

## Tasks

After changing Rust code, run `cargo fmt --all` before the gate (the gate checks the formatting).

### T1 - Drop cancelled folder listings at once (Rust)

**Files:** modify `src-tauri/src/main.rs`.

**Do this:**

1. Right after `drain_job`, add a public pure function `cancel_list_job` with parameters `jobs` (a mutable reference to the same `HashMap<String, ListJob>` type that `AppState.list_jobs` holds) and `request_id: &str`, returning `bool`. Doc comment: "Cancel a listing and forget it at once: nobody polls a cancelled listing again, so leaving it in the table would keep its items in memory." Behavior: when the map has the id, set that job's cancellation token to true (the same `store(true, Ordering::Relaxed)` call `list_dir_cancel` makes today), remove the job from the map, return true; otherwise return false.
2. In `list_dir_cancel`, the block that locks `list_jobs` takes the lock mutably and calls `cancel_list_job` with it instead of setting the token itself. Keep the `if let Ok(...)` form (a poisoned lock still returns `Ok(())`, as today). Nothing else in the command changes.
3. Nothing else changes: the listing thread already looks its job up with `get_mut` before every write, so a removed job is simply skipped.

**Tests** (the tests module at the bottom of `main.rs`):

| Test | Steps | Expected |
|---|---|---|
| `cancelling_a_listing_drops_its_job` | make a `ListJob` like the existing poll test does (one empty batch, not done, no outcome, no error, a new cancellation token); keep a clone of its token; insert it under `list-a`; call `cancel_list_job` for `list-a`; then again for `list-a` | first call returns true, the map is empty and the token clone reads true; the second call returns false |

**Traps:** never call `unwrap` on the lock (P-20). Do not change `list_dir_poll`: a poll that arrives after the cancel gets its existing "unknown list request" error, which the UI ignores because it cancelled.

**Commit:** `fix(explorer): drop cancelled folder listings at once [step-05b/T1]`

### T2 - The Column view id and its settings (schema 7)

**Files:** modify `crates/fs-service/src/folder_views.rs`, `src-tauri/src/main.rs`, `src/services/settings.ts`, `src/views/explorer/views/viewModes.ts`, `src/commands/explorerCommands.ts`, `src/views/explorer/views/ItemView.tsx`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`), `scripts/measure-ui.ps1`, `src/__tests__/settings.test.ts`, `src/__tests__/viewModes.test.ts`, `src/__tests__/commands.test.ts`, `src/__tests__/viewsSettings.test.tsx`; create `crates/fs-service/tests/step05b_column_view_tests.rs`.

This is `plan/recipes/add-settings-field.md` with N = 7, plus the new view id everywhere a list of view ids exists. Adding `columns` to `ViewModeId` breaks every record keyed by it, so all of this is one task. After this task the View menu has **Columns**; choosing it still draws the folder in Details until T8.

**Translation keys:** `commands.viewColumns`.

**Do this (Rust):**

1. `folder_views.rs`: `VIEW_MODES` becomes an array of 9 entries: the 8 existing ids in the same order, then `columns`. Nothing else in the file changes.
2. `main.rs`, settings part:
   - `CURRENT_SCHEMA` becomes 7.
   - Add two public constants next to `default_view_mode`: `COLUMN_WIDTH_MIN` (`u32`, 160) and `COLUMN_WIDTH_MAX` (`u32`, 480), and a default function `default_column_width` giving 240.
   - In `ExplorerViewSettings`, after `hidden_view_modes`, add `column_width` (serde default from `default_column_width`) and `column_preview` (serde default from the existing `default_true`), and their defaults in its `Default`. Add this sentence to the struct's doc comment: "Schema 7 (Step 05b) adds the Column view's column width and preview column."
   - In `validate`, after the `hidden_view_modes` check, add: `column_width` must be from `COLUMN_WIDTH_MIN` to `COLUMN_WIDTH_MAX`, else a validation error whose message names the field, the bad value and the range.
   - In `migrate`, the arm for 4 or 5 also takes 6 (one arm for 4, 5 or 6, same body).
3. Existing Rust tests: in `settings_defaults`, the expected schema version 6 becomes 7. In `settings_v5_migrates_to_v6_keeping_language_and_theme`, the expected schema version 6 becomes `CURRENT_SCHEMA` (its expected `view_mode_order`, `default_view_mode_order()`, now has 9 entries by itself).
4. New Rust tests in `main.rs`:
   - `settings_v6_migrates_to_v7_keeping_language_and_theme`: a schema-6 JSON value with language `es`, theme mode `dark`; explorer with `show_hidden` true, `group_by` `type`, `view_mode` `tiles`, `remember_view_per_folder` false, `view_mode_order` the 8 schema-6 ids in Step 05a order, `hidden_view_modes` `[list]` (and the other schema-3 flags); files `paste_image_format` `jpg`; open with `protected_view` false and `open_with` mapping `txt` to `windows`. After `migrate`: schema 7; language `es`; theme mode `dark`; `show_hidden` true; `group_by` `type`; `view_mode` `tiles`; `remember_view_per_folder` false; `view_mode_order` exactly the 8 given ids (Rust does not add `columns`; the UI adds it when it loads the settings); `hidden_view_modes` `[list]`; `column_width` 240; `column_preview` true; `protected_view` false; `open_with` maps `txt` to `windows`.
   - `settings_validate_rejects_bad_column_width`: starting each time from the default settings, `validate` fails for `column_width` 159, 481 and 0, and passes for 160, 480, for `view_mode` `columns`, and for `hidden_view_modes` `[columns]`.
5. Create `crates/fs-service/tests/step05b_column_view_tests.rs` with one test, `columns_is_the_ninth_view_mode`: `VIEW_MODES` has 9 entries and its last is `columns`; `is_view_mode` is true for `columns` and false for `Columns`; a default `FolderViews` `set` of `C:\A` to `columns` at time 1 returns true, and `get` of `c:\a\` gives `columns`.

**Do this (TypeScript):**

1. `settings.ts`:
   - `SETTINGS_SCHEMA_VERSION` becomes 7.
   - `ViewModeId` gets `"columns"`; `VIEW_MODE_IDS` gets `columns` as its ninth entry (its doc comment stays true: same ids and order as Rust).
   - Above `ExplorerViewSettings`, add the exports `COLUMN_WIDTH_DEFAULT`, `COLUMN_WIDTH_MIN`, `COLUMN_WIDTH_MAX`, `clampColumnWidth` and `normalizeColumnWidth` (table "New TypeScript exports").
   - `ExplorerViewSettings` gets `column_width` (number; comment "Column view's column width in pixels (schema 7).") and `column_preview` (boolean; comment "Column view shows a preview of the selected file (schema 7)."); `defaultSettings()` gives 240 and `true`; `normalizeSettings()` follows "TypeScript normalization".
2. `viewModes.ts`: `GridModeId` becomes `ViewModeId` without `"details"`, `"list"` and `"columns"`; `isGridMode` returns false for `columns` too. Nothing else changes (`zoomTarget` already treats a mode outside `ZOOM_ORDER` like Tiles and Content; `skeletonVariant` already gives `rows`).
3. `explorerCommands.ts`:
   - `VIEW_MODE_COMMANDS`, `VIEW_MODE_LABEL_KEYS` and `VIEW_MODE_ICONS` get their `columns` entries from the Commands table (import `Columns3` from lucide).
   - `viewModeShortcut` now returns `string | undefined`: `undefined` for `columns`, otherwise the same text as before. The `viewMode` factory passes it as the shortcut, so `explorer.viewColumns` has none. The list of commands needs no change (it already makes one command per entry of `VIEW_MODE_IDS`).
4. `ItemView.tsx`: add a branch before the `FileGrid` one: `columns` shows `FileList` with the props, exactly like `details` (comment "Column view arrives in Step 05b, T8."). The `FileGrid` branch's `mode` must be a `GridModeId` (narrow it with `isGridMode`).

**Do this (`scripts/measure-ui.ps1`):** in the `$settings` block, the schema version becomes 7, the `view_mode_order` array gets `"columns"` as its last entry, and the `explorer` part gets `column_width = 240` and `column_preview = $true`. Keep the file's Windows line endings (P-32).

**Tests** (change these existing tests; never delete or skip them):

- `src/__tests__/settings.test.ts`:
  - "keeps valid Explorer view options and repairs invalid ones": the expected schema version 6 becomes 7; the expected explorer object gets `column_width` 240 and `column_preview` true, and its expected `view_mode_order` is the 9 ids.
  - "normalizes the view settings (schema 6)": the rows that expect the default order now expect the 9 ids; the row with `[content, content, bogus, details]` now expects `[content, details, extraLargeIcons, largeIcons, mediumIcons, smallIcons, list, tiles, columns]`.
  - New test "normalizes the Column view settings (schema 7)":

    | Input to `normalizeSettings` (inside `explorer`) | Expected |
    |---|---|
    | nothing (`{}`) | `column_width` 240, `column_preview` true |
    | `column_width` 300 | 300 |
    | `column_width` 100 | 160 |
    | `column_width` 999 | 480 |
    | `column_width` 241.6 | 242 |
    | `column_width` `"wide"` | 240 |
    | `column_width` `Number.POSITIVE_INFINITY` | 240 |
    | `column_preview` false; then `"no"` | false; then true |
    | `view_mode` `columns` | `columns` |
    | `hidden_view_modes` `[columns]` | `[columns]` |
    | `view_mode_order` the 8 schema-6 ids | those 8, then `columns` |

  - New test "clampColumnWidth rounds and keeps the limits": 159.4 gives 160; 300.4 gives 300; 480.5 gives 480; -5 gives 160.
- `src/__tests__/viewModes.test.ts`:
  - "visibleViewModes keeps the order and drops hidden views": the expected list is `extraLargeIcons, largeIcons, mediumIcons, smallIcons, list, details, content, columns`.
  - "zoomTarget walks the sizes and skips hidden views": add (`columns`, 1) gives `mediumIcons` and (`columns`, -1) gives `details`.
  - New test "Column view is not a grid": `isGridMode` is false for `columns` and true for `tiles`; `skeletonVariant` of `columns` is `rows`.
- `src/__tests__/commands.test.ts`, in "view mode commands are live and follow the settings": add that `explorer.viewColumns` has no shortcut and that running it calls the `setViewMode` action with `columns`. (The loop over `VIEW_MODE_IDS` now also checks `columns`.)
- `src/__tests__/viewsSettings.test.tsx`:
  - "moveViewMode swaps a view with its neighbour": the default order's `content` moved down now ends with `tiles, columns, content`; add `columns` moved down: unchanged.
  - "lists the views in order and hides one with its switch": 9 items `.adp-views-item` (was 8).

**Traps:**
- The Rust migration keeps an 8-entry `view_mode_order` as it is; that is valid (no duplicates, every entry an id). Do not add `columns` in Rust.
- `viewModeShortcut` is used by the status bar buttons in `App.tsx`; `IconButton`'s `shortcut` prop is optional, so `string | undefined` needs no change there.

**Commit:** `feat(settings): Column view id and settings (schema 7) [step-05b/T2]`

### T3 - Pure column rules

**Files:** create `src/views/explorer/views/columnTrail.ts`, `src/__tests__/columnTrail.test.ts`.

**Do this:** module doc comment "Column view (Step 05b): which folders form the columns, and when Column view stays on. Pure." The types `ColumnNote`, `ColumnStep`, `ColumnViewOptions` and the constants from "Data shapes" (type imports: `ExplorerItem` from the explorer service, `GroupBy` from grouping, `ViewModeId` from settings, and React's mouse event type), and these exported functions:

| Function | Parameters | Returns | Behavior |
|---|---|---|---|
| `isSameOrInside` | `path: string`, `root: string` | boolean | `k = folderViewKey(path)`, `r = folderViewKey(root)` (from `src/services/folderViews.ts`). False when `r` is empty. True when `k` equals `r`, or `k` starts with `r` followed by one backslash. |
| `columnName` | `path: string` | string | the label of the last entry of `pathSegments(path)`; `displayPath(path)` when there is none |
| `columnChain` | `root: string`, `folder: string` | string array | 1. `segs = pathSegments(folder)`; when empty, return a list with `displayPath(folder)`. 2. When `isSameOrInside(folder, root)` is false, return a list with the last entry's path. 3. Find the first index whose `folderViewKey(path)` equals `folderViewKey(root)`; none: return a list with the last entry's path. 4. Take the paths from that index to the end. 5. Keep only the last `MAX_TRAIL_COLUMNS` of them. |
| `columnTrailStep` | `trailRoot: string` or `null`, `folder: string` or `null`, `baseMode: ViewModeId`, `columnsVisible: boolean` | `ColumnStep` | Rules in order, the first that applies wins: 1. `columnsVisible` false: `baseMode`, root `null`. 2. `folder` is `null`: `baseMode`, root `trailRoot` (kept). 3. `trailRoot` is not `null` and `isSameOrInside(folder, trailRoot)`: `columns`, root `trailRoot`. 4. `trailRoot` is not `null` and `isSameOrInside(trailRoot, folder)`: `columns`, root `folder`. 5. `baseMode` is `columns`: `columns`, root `folder`. 6. Otherwise: `baseMode`, root `null`. |
| `displayItems` | `items: readonly ExplorerItem[]`, `groups`: `ItemGroup<ExplorerItem>[]` or `null` | `readonly ExplorerItem[]` | `groups` null: `items` itself (no copy); otherwise every group's items, one group after another |
| `columnItems` | `items: readonly ExplorerItem[]`, `showHidden: boolean`, `groupBy: GroupBy`, `typeLabel` (function from item to string), `now: Date` | `ExplorerItem[]` | 1. Keep the items where `showHidden` is true or the item is neither hidden nor system. 2. `groupBy` `none`: that list. Otherwise the items of `groupItems(list, groupBy, now, typeLabel)`, one group after another. |
| `singleSelected` | `selection: SelectionState`, `items: readonly ExplorerItem[]` | `ExplorerItem` or `null` | when exactly one path is selected, the item of `items` with exactly that path; otherwise (or when it is not in `items`) `null` |
| `isFolderLike` | `item: ExplorerItem` | boolean | kind `folder` or `drive` |
| `columnLeftTarget` | `chain: readonly string[]`, `folder: string` | an object with `folder` and `select` (strings), or `null` | chain length 2 or more: `folder` = the entry before the last, `select` = `displayPath(folder)`. Otherwise: `parent = parentPathOf(folder)`; `null` when there is none, else `folder` = `parent`, `select` = `displayPath(folder)`. |

**Tests** (`src/__tests__/columnTrail.test.ts`; the item helper from `fileList.test.tsx`, with an optional kind and optional hidden/system flags):

| Test | Input | Expected |
|---|---|---|
| "isSameOrInside compares whole folder names" | (`C:\A\B`, `C:\A`); (`C:\A`, `c:\a\`); (`\\?\C:\A\B`, `C:\`); (`C:\AB`, `C:\A`); (`D:\A`, `C:\`); (`\\srv\share\x`, `\\srv\share`) | true; true; true; false; false; true |
| "columnChain lists the folders from the root" | (`C:\`, `C:\A\B`); (`c:\a\`, `\\?\C:\A\B`); (`C:\A`, `C:\A`); (`D:\X`, `C:\A`); (`\\srv\share`, `\\srv\share\docs`) | [`C:\`, `C:\A`, `C:\A\B`]; [`C:\A`, `C:\A\B`]; [`C:\A`]; [`C:\A`]; [`\\srv\share`, `\\srv\share\docs`] |
| "columnChain keeps the last 24 columns" | root `C:\`, folder `C:\d1\d2\...\d30` (30 levels) | 24 entries; the last is the folder; the first is `C:\d1\d2\d3\d4\d5\d6\d7` |
| "columnName shows the last part" | `C:\Users\Ana`; `C:\`; `\\srv\share` | `Ana`; `C:\`; `\\srv\share` |
| "columnTrailStep keeps Column view inside its folders" | (null, `C:\A`, `columns`, true); (null, `C:\A`, `details`, true); (`C:\A`, `C:\A\B`, `details`, true); (`C:\A`, `C:\A`, `tiles`, true); (`C:\A\B`, `C:\A`, `details`, true); (`C:\A`, `D:\X`, `largeIcons`, true); (`C:\A`, `D:\X`, `columns`, true); (`C:\A`, null, `details`, true); (`C:\A`, `C:\A\B`, `details`, false); (`c:\a\`, `\\?\C:\A\B`, `details`, true) | (`columns`, `C:\A`); (`details`, null); (`columns`, `C:\A`); (`columns`, `C:\A`); (`columns`, `C:\A`); (`largeIcons`, null); (`columns`, `D:\X`); (`details`, `C:\A`); (`details`, null); (`columns`, `c:\a\`) |
| "columnItems hides hidden items and keeps the grouped order" | items `b.txt`, `a` (folder), `h.txt` (hidden), `s.sys` (system); type label "Folder" for folders, "TXT file" otherwise: (showHidden false, `none`); (true, `none`); (false, `type`) | [`b.txt`, `a`]; all four in the given order; [`a`, `b.txt`] |
| "displayItems flattens groups" | items [a, b, c]; groups null; groups (b) and (c, a) | the very same array; [b, c, a] |
| "singleSelected finds the one selected item" | items a, b: `selectOnly(b)`; both selected; `selectOnly` of a path not in the items; nothing selected | b; null; null; null |
| "columnLeftTarget goes one column back, then up" | ([`C:\`, `C:\A`], `C:\A`); ([`C:\A`], `C:\A`); ([`C:\`], `C:\`); ([`\\srv\share`], `\\srv\share`) | (`C:\`, `C:\A`); (`C:\`, `C:\A`); null; null |

**Commit:** `feat(views): column trail rules [step-05b/T3]`

### T4 - Column view stays on while you browse inside it

**Files:** modify `src/views/explorer/views/useViewMode.ts`, `src/__tests__/useViewMode.test.tsx`.

**Do this (`useViewMode.ts`):**

1. `ViewModeState` gets `columnRoot` (string or `null`; comment "The first column's folder while Column view is on (Step 05b); null otherwise.").
2. A new state `trailRoot` (string or `null`, starting `null`).
3. What the hook calls `mode` today becomes `baseMode` (still `effectiveViewMode(view, folder's mode)`). Then `step = columnTrailStep(trailRoot, folderPath, baseMode, visibleModes includes "columns")`; the returned `mode` is `step.mode`; `columnRoot` is `step.root` when `step.mode` is `columns`, else `null`.
4. An effect whose only dependency is the folder key (`folderViewKey(folderPath)`, or `null` without a folder path), with the same "exhaustive-deps" disable comment Step 05a uses: set `trailRoot` to `step.root`. (Only a navigation stores the trail; this is what lets a view change from the menu end the trail, see trap 1.)
5. `setMode`: after its existing work (and only when the mode is visible), set `trailRoot` to the folder path when the mode is `columns`, else to `null`.
6. `zoomStep` keeps using the returned `mode`.

**Tests** (add to `src/__tests__/useViewMode.test.tsx`, using its probe; tests are not Tauri, so the folder memory lives only in the hook's own map):

| Test | Steps | Expected (`mode`, `columnRoot`) |
|---|---|---|
| "Column view stays on inside its folders" | default settings, folder `C:\A`: set mode `columns`; render with folder `C:\A\B`; `C:\A\B\C`; `C:\`; `D:\X`; `C:\A` | (`columns`, `C:\A`); (`columns`, `C:\A`); (`columns`, `C:\A`); (`columns`, `C:\`); (`details`, null); (`columns`, `C:\A`) |
| "choosing another view leaves Column view" | folder `C:\A`: set mode `columns`; render `C:\A\B`; set mode `largeIcons`; render `C:\A\B\C` | after the second set: (`largeIcons`, null); last: (`details`, null) |
| "with folder memory off, Column view follows the default view" | memory off and view mode `columns`, folder `C:\A`; render `C:\A\B`; set mode `details`; render again with view mode `details` | (`columns`, `C:\A`); (`columns`, `C:\A`); `onViewChange` called with view mode `details`; (`details`, null) |
| "a hidden Column view never shows" | view mode `columns` with hidden `[columns]` (not normalized), folder `C:\A` | (`details`, null) |

**Traps:**
1. Do not store the trail from every render (for example an effect that depends on `step.root`): with folder memory off, choosing another view changes the settings a moment later, and in between `baseMode` is still `columns`, which would store the trail again and Column view could never be left.
2. Step 05a's existing tests in this file must pass unchanged.

**Commit:** `feat(views): keep Column view on while browsing its folders [step-05b/T4]`

### T5 - Loading the other columns

**Files:** create `src/services/columnListing.ts`, `src/views/explorer/views/useColumnListings.ts`, `src/__tests__/columnListing.test.ts`, `src/__tests__/useColumnListings.test.tsx`.

**Do this (`src/services/columnListing.ts`):** module doc comment "One folder listing for a side column in Column view (Step 05b): all batches collected, then returned at once." Export `FolderListing`, `FolderRequest` and:

| Function | Parameters | Returns | Behavior |
|---|---|---|---|
| `listFolder` | `path: string`, `sort: SortSpec` | `FolderRequest` | 1. A `cancelled` flag (false) and a `handle` (none). 2. `done` is an async run: outside Tauri (`isTauriRuntime()` false) it resolves to no items and `partial` false. Otherwise it collects every batch from `startListDir(path, sort, onBatch)` into one array; when the handle arrives and `cancelled` is already true, it calls the handle's `cancel` and rejects with an error whose message is `cancelled`; otherwise it waits for `completion` and resolves to the collected items with `partial` = (the outcome's `skipped` list is not empty). Errors from the listing reject `done`. 3. `cancel` sets `cancelled` and, when the handle exists, calls its `cancel` (without waiting). |

**Do this (`src/views/explorer/views/useColumnListings.ts`):** module doc comment "Cached listings of the side columns (Step 05b). The open folder is listed by the Explorer itself." Export `ColumnListing` and two hooks.

`useDelayedFlag` (`active: boolean`, `delayMs: number`), returns boolean: false while `active` is false; when `active` becomes true, a timer turns the result true after `delayMs`; when `active` becomes false, the result is false at once and the timer is cleared (cleanup, P-28).

`useColumnListings` (`folders: readonly string[]`, `child: string | null`, `active: string`, `sort: SortSpec`, `refreshKey: number`), returns a function (`path: string`) giving `ColumnListing` or `null`. Inside, in this order:

1. `key(path)` = `folderViewKey(path)`. `version` = sort key, `|`, sort direction, `|`, `refreshKey` (for example `name|ascending|0`).
2. State `listings`: a `Map` from key to `ColumnListing`, starting empty. Every write makes a new `Map`, deletes the key, sets it again (so the map's order is oldest write first), then trims: while the map has more than `COLUMN_CACHE_LIMIT` entries, delete the oldest key that is not wanted (see 5). Keep a ref `listingsRef` assigned the latest map on every render.
3. Refs: `inflight` (a `Map` from key to an object with `version` and the request's `cancel`), `staleKeys` (a `Set` of keys), `previousActive` (the last active key, starting `null`), `wantedKeys` (a `Set`).
4. Effect A, depending on the active key: when `previousActive` is set and differs from the active key, add it to `staleKeys`; then store the active key in `previousActive`. (A folder that was open may have changed; it reloads when it becomes a side column again.) Declare it before effect C.
5. State `readyChild` (string or `null`). Effect B, depending on the child key (or `null`) and `version`: without a child, `readyChild` becomes `null`. When the cache already has any listing for the child, `readyChild` becomes the child at once. Otherwise `readyChild` becomes `null` and a timer of `CHILD_LOAD_DELAY_MS` sets it to the child; the cleanup clears the timer. The wanted folders are `folders`, plus the child when `readyChild` is not `null` and has the child's key.
6. Effect C, depending on the joined wanted keys, `version` and the active key:
   1. Put the wanted keys in `wantedKeys`.
   2. For every `inflight` entry whose key is not wanted, or whose version differs from `version`: call its `cancel` and remove it.
   3. For every wanted folder (key `k`): skip it when the cache has a listing for `k` with this `version`, a status other than `loading`, and `k` is not in `staleKeys`; also skip it when `inflight` has `k`. Otherwise remove `k` from `staleKeys`, start `listFolder(path, sort)`, store it in `inflight` with `version`, and when the cache has no listing for `k`, write one with status `loading`, no items, `partial` false and version `""`. When `done` resolves: if `inflight` still holds this same request for `k`, remove it and write status `ready` with the items, `partial` and `version`. When it rejects: with the same check, remove it and write status `error`, no items, `partial` false, `version`.
7. An effect with no dependencies whose cleanup cancels every `inflight` request (P-28).
8. The returned function gives `listings.get(key(path))`, or `null`.

**Tests** (`src/__tests__/columnListing.test.ts`; mock `../services/explorer` so that `startListDir` is a `vi.fn`, and mock `../services/settings` keeping everything from the real module except `isTauriRuntime`, which returns a test variable `tauri` (true unless a test changes it)):

| Test | Steps | Expected |
|---|---|---|
| "collects every batch and reports skipped items" | `startListDir` calls its batch callback with [a] and then [b, c], and returns a handle whose `completion` resolves with one skipped entry | `done` resolves to items a, b, c and `partial` true |
| "cancel stops the listing" | `startListDir` returns a handle with a `cancel` spy and a `completion` that never resolves; wait one tick; call the request's `cancel` | the handle's `cancel` was called once |
| "cancelling before the listing starts stops it as soon as it starts" | `startListDir` resolves its handle only after the test calls the request's `cancel` | the handle's `cancel` is called once; `done` rejects |
| "outside the app it lists nothing" | `tauri` false | `done` resolves to no items and `partial` false; `startListDir` not called |

`src/__tests__/useColumnListings.test.tsx` (plain React DOM with a probe component that calls the hook and stores the returned function in a variable; mock `../services/columnListing` so that `listFolder` is a `vi.fn` returning `{ done, cancel }` where `done` is a promise the test resolves or rejects by hand and `cancel` is a spy; sort `name`/`ascending` unless a test says otherwise; use Vitest's fake timers where a test waits):

| Test | Steps | Expected |
|---|---|---|
| "loads a parent folder once and keeps it" | folders [`C:\A`], child null, active `C:\A\B`; resolve [a.txt]; render again with the same props | `listFolder` called once with `C:\A` and the sort; the listing of `c:\a\` is `ready` with 1 item |
| "waits before loading the selected folder" | folders [], child `C:\A\B`, active `C:\A`; advance 100 ms; then 50 ms more | no call after 100 ms; one call with `C:\A\B` after 150 ms |
| "cancels a listing that is no longer wanted" | child `C:\A\B`, advance 150 ms; then child `C:\A\C`, advance 150 ms | the first request's `cancel` called once; `listFolder` called twice |
| "reloads on refresh and keeps the old rows meanwhile" | folders [`C:\A`] resolved with [a.txt]; render with `refreshKey` 1; then resolve the second request with [a.txt, b.txt] | 2 calls; before the second resolves the listing is `ready` with 1 item; after it, 2 items |
| "a sort change reloads" | folders [`C:\A`] resolved; render with sort `size`/`ascending` | a second call whose sort key is `size` |
| "a folder that cannot be listed is an error" | folders [`C:\A`]; reject | status `error`, no items |
| "a folder that was open reloads when it becomes a side column" | folders [`C:\A`], active `C:\A\B`, resolved; then folders [], active `C:\A`; then folders [`C:\A`], active `C:\A\B` | `listFolder` called twice for `C:\A` |
| "useDelayedFlag turns on after the delay and off at once" | a probe with `active` true and 100 ms: check at 99 ms and at 100 ms; then `active` false | false; true; false |

**Traps:**
- Never keep a request after its folder stops being wanted: cancel it, or listings pile up in Rust (T1 makes the cancel free).
- A late answer from a cancelled request must never overwrite a newer listing: the "same request" check in step 6.3 is required.
- `done` rejects when a request is cancelled; always attach both handlers so tests show no unhandled rejection.

**Commit:** `feat(views): load and cache the other columns' folders [step-05b/T5]`

### T6 - One column

**Files:** create `src/views/explorer/views/ColumnRow.tsx`, `src/views/explorer/views/ColumnPane.tsx`, `src/styles/columns.css`, `src/__tests__/columnPane.test.tsx`; modify `src/main.tsx` (import `./styles/columns.css` right after `./styles/views.css`).

**Do this (`ColumnRow.tsx`):** the exported component `ColumnRowContent` draws what is inside one row (the row element itself belongs to the pane). Props: `item` (`ExplorerItem`), `showExtensions` (boolean), `check` (React node, optional), `renaming` (React node, optional). It returns, in this order: `check` when given; the type tile exactly as `FileList` draws it (a `span` with classes `adp-file-tile adp-file-tile--<tone>` from `fileTile(name, kind)`, holding the icon at size 13, hidden from screen readers); `renaming` when given, else a `span` with class `adp-file-name` and a `title`, both the shown name (`displayName(name, kind, showExtensions)`); `FileList`'s two badges (cloud when online-only, link when it is a link, same classes, sizes and translated `title`/`aria-label`); and, for folder-like items (`isFolderLike`), a `span` with class `adp-colview-chevron`, hidden from screen readers, holding a 14 px `ChevronRight`.

**Do this (`ColumnPane.tsx`):** export the type `ColumnRole` and the default component `ColumnPane`. One component draws every column, so a column keeps its element, rows and scroll position when its role changes (D8).

Props:

| Prop | Type | Used by |
|---|---|---|
| `role` | `ColumnRole` | all |
| `folder` | string | all: the column's folder (display path) |
| `name` | string | all: `columnName(folder)` |
| `width` | number | all |
| `listing` | `ColumnListing` or `null` | all: the cached listing of `folder` |
| `pathItem` | string or `null` | `parent`: the next column's folder |
| `view` | `ItemViewProps` | all (the active column uses everything; the others use `showExtensions`, `typeLabel` and `onOpen`) |
| `note` | `ColumnNote` | `active` |
| `loading` | boolean | `active` |
| `showHidden` | boolean | all |
| `groupBy` | `GroupBy` | all |
| `onNavigateKey` | function (`direction`: `"left"` or `"right"`) | `active` |
| `onSelectItem` | function (`item`, `menuPoint`: an object with `x`, `y`, or `null`) | `parent`, `child` |
| `onOpenColumn` | function, no arguments | `parent`, `child` |
| `onDragItem` | function (React mouse event, `item`) | `parent`, `child` |

Behavior, in this order:

1. `listRef`: a ref to the scrolling `div` (P-04: the tests check it is attached by finding the list). `active` = role is `active`.
2. `cached` (`useMemo` on the listing's items, `showHidden`, `groupBy`, `view.typeLabel`): `columnItems` of the listing's items (an empty list constant when there is no listing) with a new `Date`.
3. `rows`: for the active role, `displayItems(view.items, view.groups)` (a `useMemo`); but when that is empty, `loading` is true and the listing's status is `ready`, use `cached` instead (D8). For the other roles, `cached`. `order` = the rows' paths (`useMemo`).
4. `status` = the listing's status, or `loading` without a listing. For side roles: `skeleton = useDelayedFlag(status is loading and cached is empty, SKELETON_DELAY_MS)`, `slow = useDelayedFlag(status is loading, SLOW_NOTE_DELAY_MS)`, `timedOut = useDelayedFlag(status is loading, LISTING_TIMEOUT_MS)`. Call the three hooks for every role (hooks are never conditional) with `active` false for the active role.
5. `pathIndex`: for the parent role, the index in `rows` of the item whose path is `samePath` with `pathItem`; -1 otherwise.
6. Virtualizer: count = number of rows; scroll element = `listRef`; estimated size `COLUMN_ROW_HEIGHT`; overscan 8.
7. Effects:
   - For the active role, the same two first-paint effects as `FileList` (on `view.items`, calling `view.onFirstPaint`).
   - For the active role, the caret effect of `FileList` (on the caret path): the caret's index in `order`, scrolled to with alignment `auto`.
   - For the parent role, on `pathIndex`: when it is 0 or more, scroll to it with alignment `auto`.
8. Interactions: call `useItemInteractions(view, options)` on every render, for every role (hooks are unconditional; only the active role attaches its handlers), with `order`, `orderItems` = `rows`, `scrollRef` = `listRef`, and:
   - `moveTarget`: ArrowDown `next`, ArrowUp `previous`, Home `first`, End `last`, PageDown `pageDown`, PageUp `pageUp`; other keys `null`. The result is `linearMoveTarget` with that move, the current index, the row count and a page size of `max(1, floor(height / COLUMN_ROW_HEIGHT) - 1)`, where height is the list's `clientHeight` (280 when missing), exactly like `FileList`.
   - `elementForIndex`: the element with that `data-index` inside the list, or `null`.
9. Key handler of the active list: when the event's target is the list itself, the key is ArrowLeft or ArrowRight, and none of Alt, Ctrl, Meta and Shift is held: prevent the default, call `onNavigateKey` with `left` or `right`, and stop. Otherwise pass the event to the hook's `onListKeyDown`.
10. Markup (classes exactly as named):
    - Root: a `div` with classes `adp-colview-column adp-colview-column--<role>`, a width of `width` pixels, `data-drop-folder` = `folder` and `data-drop-name` = `name` (D12).
    - Notes, before the list, each a `p`:
      - active role: `note` `empty`: class `adp-empty-note adp-colview-note`, text `explorer.emptyFolder`; `noResults`: same classes, `explorer.noSearchResults`; `loading` while the cached rows are not shown: `<Skeleton>` with variant `rows` and `COLUMN_SKELETON_ROWS` rows (no extra delay: the Explorer only sends `loading` after 0.1 s).
      - side roles, each only when its condition holds:

        | Condition | Element |
        |---|---|
        | the listing is `partial` | class `adp-note adp-colview-note`, `role="status"`, text `explorer.someItemsUnreadable` |
        | status `error` | class `adp-empty-note adp-colview-note`, text `explorer.loadError` |
        | status `ready` and no rows | class `adp-empty-note adp-colview-note`, text `explorer.emptyFolder` |
        | `timedOut` | class `adp-empty-note adp-colview-note`, text `explorer.notAvailable` |
        | `skeleton` and not `timedOut` | `<Skeleton>` with variant `rows` and `COLUMN_SKELETON_ROWS` rows |
        | `slow` and not `timedOut` | class `adp-note adp-colview-note`, text `explorer.stillLoading` |
    - The list: a `div` with `ref` = `listRef`, `role="listbox"`, the classes `adp-filelist-scroll adp-colview-list` for the active role and `adp-colview-list` for the others (D17). Active role: `aria-multiselectable` true, `aria-label` = `view.label`, `aria-activedescendant` = the id of the caret's row (when it has an index), `tabIndex` 0, the key handler of step 9, and the hook's `onListClick` and `onListContextMenu`. Side roles: `aria-label` = `name`, `tabIndex` -1, a click handler that calls `onOpenColumn`, and a context-menu handler that prevents the default, stops propagation and calls `onOpenColumn`.
    - Inside the list: a `div` with class `adp-colview-inner`, as tall as the virtualizer's total size.
    - One row per virtual item: a `div` with React key = path, `data-index` = index, `role="option"`, placed with a vertical translate of its start and a height of `COLUMN_ROW_HEIGHT`; classes `adp-colview-row`, plus `adp-colview-row--hidden` (hidden or system item), plus for the active role `adp-colview-row--selected` and `adp-colview-row--focused` when they apply, plus for the parent role `adp-colview-row--path` at `pathIndex`; `aria-selected` = selected (active role) or at `pathIndex` (parent role) or false (child role); `data-drop-folder` = path and `data-drop-name` = name for folder-like items. Active role only: `id` = the component's `useId` value followed by `-item-<index>`.
    - Row handlers, active role: mouse-down = `view.onItemMouseDown`; click, double-click, context menu and aux-click = the hook's `onItemClick`, `onItemDoubleClick`, `onItemContextMenu`, `onItemAuxClick`. Side roles: mouse-down calls `onDragItem` with the event and the item; click stops propagation and calls `onSelectItem` with the item and `null`; double-click stops propagation and calls `view.onOpen` with the item; context menu prevents the default, stops propagation and calls `onSelectItem` with the item and the event's client point.
    - Row content: `ColumnRowContent` with the item and `view.showExtensions`; for the active role also `check` = the check box exactly as `FileList` draws it when `view.checkboxes` is on (class `adp-row-check`, plus `adp-row-check--on` when selected, hidden from screen readers, a 12 px `Check` when selected, its click = the hook's `onCheckClick`), and `renaming` = `RenameInput` (same props as in `FileList`) when the row is `view.renamingPath`.

**Do this (`src/styles/columns.css`):** a comment line "Column view (Step 05b). Colors only through tokens.", then these rules. Write each with the CSS properties that do exactly what the table says; use only the tokens named.

| Selector | Layout | Size and spacing | Look |
|---|---|---|---|
| `.adp-colview` | flex row; children stretch to the full height; grows (flex 1); may shrink below its content (min-height 0, min-width 0); scrolls sideways (horizontal overflow auto), never vertically (vertical overflow hidden) | | top border 1 px `--adp-color-border-default` |
| `.adp-colview-column` | flex column; positioned (relative); no growing or shrinking (flex none); min-height 0; border-box sizing | | right border 1 px `--adp-color-border-default` |
| `.adp-colview-list` | grows (flex 1); min-height 0; vertical overflow auto; horizontal overflow hidden | padding 4 px top and bottom | |
| `.adp-colview-list:focus-visible` | | | outline 2 px `--adp-accent-current`, offset -2 px |
| `.adp-colview-inner` | positioned (relative) | full width | |
| `.adp-colview-row` | absolutely positioned at the top, 4 px from the left and the right; flex row, items centered vertically; border-box sizing | gap `--adp-space-2`; padding 0 top and bottom, `--adp-space-3` left and right | corner radius `--adp-radius-sm`; text `--adp-color-text-primary`; font size `--adp-font-body`; pointer cursor; text not selectable |
| `.adp-colview-row` on hover, and `.adp-colview-row--path` (also on hover) | | | background `--adp-color-surface-selected` |
| `.adp-colview-row--selected`, also on hover | | | background `--adp-color-surface-selected-row` |
| `.adp-colview-row--hidden` | | | opacity 0.55 |
| `.adp-colview-row--focused` inside a focused-visible `.adp-colview-list` | | | inset ring of 1 px in `--adp-accent-current` (box shadow) |
| `.adp-colview-row .adp-file-name` | grows (flex 1); may shrink to 0 width | | |
| `.adp-colview-row` that contains `.adp-rename` (`:has`) | stacked above the other rows (z-index 5) | | |
| `.adp-colview-row .adp-rename` | grows (flex 1) | | |
| `.adp-colview-chevron` | inline flex; does not shrink; pushed to the right end (left margin auto) | | text `--adp-color-text-secondary` |
| `.adp-colview-note` | | margin 0; padding `--adp-space-3` | |
| `.adp-colview-column > .adp-skeleton-rows` | | padding `--adp-space-3` | |
| `.adp-colview-resizer` | does not grow or shrink; positioned (relative); stacked above the columns (z-index 2); column-resize cursor | 6 px wide; margin -3 px left and right | transparent background |
| `.adp-colview-resizer` on hover | | | background `--adp-color-border-input` |
| `.adp-colview-preview` | flex column, items centered horizontally; does not grow or shrink; vertical overflow auto; border-box sizing | gap `--adp-space-3`; padding `--adp-space-7` | |
| `.adp-colview-preview-tile` | inline flex, content centered | 96 px wide and tall | corner radius `--adp-radius-md` |
| `.adp-colview-preview-name` | at most 3 lines, the rest cut off (the `-webkit-box` line clamp with 3 lines, vertical box orient, overflow hidden); long words wrap anywhere | full width | text centered; font size `--adp-font-section`; weight 600 |
| `.adp-colview-preview-type` | | | text `--adp-color-text-secondary`; font size `--adp-font-small`; centered |
| `.adp-colview-preview-facts` | grid with two columns (as wide as its content, then the rest) | full width; margin 0; row gap `--adp-space-1`, column gap `--adp-space-3` | font size `--adp-font-small` |
| `.adp-colview-preview-facts dt` | | | text `--adp-color-text-secondary` |
| `.adp-colview-preview-facts dd` | | margin 0 | text `--adp-color-text-primary` |
| `.adp-colview-preview-cloud` | inline flex, items centered | gap `--adp-space-1` | text `--adp-color-text-secondary`; font size `--adp-font-small` |

**Tests** (`src/__tests__/columnPane.test.tsx`): copy from `fileGrid.test.tsx` the mock of `@tanstack/react-virtual`, the `item` helper and the four items `alpha.txt`, `beta.txt`, `bravo.txt`, `charlie.txt`. Extend the `item` helper with three optional parameters after the kind: a full path (default `C:\F\` followed by the name), `hidden` and `system` (default false). A helper `ready(items)` makes a listing with status `ready`, `partial` false, version `v`. A helper `renderPane(overrides, initialSelection)` renders `ColumnPane` with: role `active`, folder `C:\F`, name `F`, width 240, listing `null`, `pathItem` null, `view` = the props of `fileGrid.test.tsx`'s helper with a real selection state that follows changes (items = the four items), note `null`, loading false, showHidden false, groupBy `none`, and spies for `onNavigateKey`, `onSelectItem`, `onOpenColumn`, `onDragItem`. Use Vitest's fake timers where a test waits.

| Test | Steps | Expected |
|---|---|---|
| "a parent column lists its folder and marks the way on" | role `parent`, folder `C:\`, name `C:\`, listing ready with `F` (folder, path `C:\F`), `Other` (folder, path `C:\Other`), `a.txt` (path `C:\a.txt`); `pathItem` `C:\F` | 3 options; the row with "F" has class `adp-colview-row--path` and `aria-selected` true; the list has no class `adp-filelist-scroll`; the root has `data-drop-folder` `C:\` and class `adp-colview-column--parent` |
| "hidden items show only with Hidden items on" | role `child`, listing ready with `a.txt` and hidden `h.txt`; then showHidden true | 1 option; then 2 |
| "clicks in a side column ask to open it" | role `child`, listing ready with `a.txt`: click its row; right-click it at (40, 50); double-click it; click the empty list | `onSelectItem` with a.txt and `null`; `onSelectItem` with a.txt and (40, 50), and that event was default-prevented; `view.onOpen` with a.txt; `onOpenColumn` called once |
| "side rows drag only their own item" | role `child`, listing ready with `a.txt`: mouse-down on its row | `onDragItem` called with a.txt; `view.onItemMouseDown` not called; the selection did not change |
| "an empty, failed or slow column says so" | role `child`: listing ready with nothing; listing with status `error`; listing `null` checked at 99 ms, 100 ms, 1000 ms and 15000 ms | the text of `explorer.emptyFolder`; the text of `explorer.loadError`; no `.adp-skeleton-rows`, then one, then also the text of `explorer.stillLoading`, then the text of `explorer.notAvailable` and no skeleton |
| "folders get a chevron and are drop targets" | role `child`, listing ready with `docs` (folder) and `a.txt` | the docs row has a `.adp-colview-chevron` and `data-drop-folder` = docs's path; the a.txt row has neither |
| "the open folder's column is the file list" | default (active) | 4 options inside the element with classes `adp-filelist-scroll` and `adp-colview-list`, which has `role="listbox"`, `aria-multiselectable` true and `tabIndex` 0; the root has class `adp-colview-column--active` |
| "Up and Down move like Details" | starting with alpha selected, keys on the list: ArrowDown; Shift+ArrowDown | selected beta; then beta and bravo |
| "Left and Right ask to change columns" | keys on the list: ArrowRight; ArrowLeft; Alt+ArrowLeft; Shift+ArrowRight | `onNavigateKey` with `right`, then `left`; called twice in total |
| "clicks, Enter and the menu key work as in Details" | click alpha; Ctrl+click beta; Enter on the list; the ContextMenu key on the list | alpha; alpha and beta; `onCommandKey` with `explorer.open`; `onContextMenu` called with beta as the item |
| "rename box and check boxes live in the open folder's column" | `renamingPath` = beta's path; then check boxes on, click the `.adp-row-check` of the row with `data-index` 3 | an `.adp-rename-input` inside the row with `data-index` 1; the selection contains charlie |
| "shows the cached rows while the folder loads" | `view.items` empty, loading true, listing ready with `x.txt` and `y.txt` | 2 options with the texts x.txt and y.txt; no `.adp-skeleton-rows` |
| "notes of the open folder show inside its column" | items empty and note `empty`; note `noResults`; note `loading` without a listing | "This folder is empty." and the `.adp-filelist-scroll` list still exists; "No items match your search."; an `.adp-skeleton-rows` |

Write every expected text as `i18n.t` of its key (import the app's `i18n` instance), never by copying the English text, so the tests follow the translation files.

**Traps:**
- Never put the class `adp-filelist-scroll` on a side column's list: the measurement script and Step 05a's tests find the open folder's list by it.
- Keep every "stop propagation" in the row handlers: without it, a click on a row also reaches the list's click handler.
- The three `useDelayedFlag` calls and `useItemInteractions` run on every render for every role.
- `ColumnPane.tsx` must stay under 400 lines (`plan/conventions.md` section 2); the row content already lives in `ColumnRow.tsx`. If it still grows past 400, stop with `BLOCKED.md` instead of splitting it your own way.

**Commit:** `feat(views): one column of Column view [step-05b/T6]`

### T7 - The preview and the column view

**Files:** create `src/views/explorer/views/ColumnPreview.tsx`, `src/views/explorer/views/ColumnView.tsx`, `src/__tests__/columnView.test.tsx`; modify `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** `explorer.columnPreview`.

**Do this (`ColumnPreview.tsx`):** the default export `ColumnPreview` takes `item` (`ExplorerItem`), `width` (number), `showExtensions` (boolean), `typeLabel` (function from item to string) and `onOpen` (function taking the item). Markup:

1. An `aside` with class `adp-colview-preview`, `aria-label` from `explorer.columnPreview`, a width of `width` pixels.
2. The tile: a `span` with classes `adp-file-tile adp-file-tile--<tone> adp-colview-preview-tile` (`fileTile`), hidden from screen readers, holding the tile's icon at size 48.
3. A `span` with class `adp-colview-preview-name` and a `title`, both the shown name (`displayName`).
4. A `span` with class `adp-colview-preview-type` with `typeLabel(item)`.
5. A `dl` with class `adp-colview-preview-facts`: `dt` `explorer.details.size`, `dd` `formatSize(item.size, language)`; `dt` `explorer.details.modified`, `dd` `formatDate(item.modified_unix, language)` when `modified_unix` is above 0, else empty.
6. When the item is online-only: a `span` with class `adp-colview-preview-cloud` holding a 12 px `Cloud` icon (hidden from screen readers) and the text `explorer.onlineOnly`.
7. A `Button` (default variant) with the text `commands.open`, whose click calls `onOpen` with the item.

**Do this (`ColumnView.tsx`):** the default export `ColumnView` takes `ItemViewProps` plus `options` (`ColumnViewOptions`). In this order:

1. `chain` = `columnChain(options.root, options.folder)` (`useMemo`); `parents` = all but the last; `activeFolder` = the last.
2. `selected` = `singleSelected(props.selection, props.items)`. `child` = `displayPath(selected.path)` when `selected` is folder-like and its `folderViewKey` differs from the key of every `chain` entry (a link that points back up never repeats a column); else `null`. `preview` = `selected` when it is not folder-like and `options.showPreview` is on; else `null`.
3. `sort` (`useMemo` on the sort key and direction) = the props' `sortKey` and `sortDirection`. `getListing` = `useColumnListings(parents, child, activeFolder, sort, options.refreshKey)`.
4. Width: a state `dragWidth` (number or `null`, starting `null`); `width` = `dragWidth`, or `options.width` when it is `null`. An effect on `options.width` sets `dragWidth` back to `null`.
5. Divider drag (`startResize`, the mouse-down handler of every divider): only the main button; prevent the default and stop propagation; remember the start x and the current `width`. A window `mousemove` listener sets `dragWidth` to `clampColumnWidth(start width + (x - start x))`. A window `mouseup` listener removes both listeners and works out the final width the same way: when it equals `options.width`, set `dragWidth` to `null`; otherwise call `options.onWidthChange` with it (the `dragWidth` stays until the new setting arrives). Keep the function that removes the listeners in a ref and call it from the cleanup of an effect with no dependencies (P-28). A double-click on a divider calls `options.onWidthChange(COLUMN_WIDTH_DEFAULT)`.
6. `onNavigateKey`:
   - `right`: nothing without `child`. Otherwise, when the child's listing is `ready`, take the first item of `columnItems(its items, options.showHidden, options.groupBy, props.typeLabel, new Date())`; call `options.onNavigate(child, that item's path, or null when there is none or the listing is not ready, null)`.
   - `left`: `columnLeftTarget(chain, activeFolder)`; when it is not `null`, call `options.onNavigate(its folder, its select, null)`.
7. Effects:
   - Scroll to the end: on the active folder's key, the child's key and the preview's path: set the strip's horizontal scroll position to its scroll width (assignment; the browser clamps it).
   - Focus: on the active folder's key (it also runs on mount): when `document.activeElement` is missing, is `document.body`, or is inside the strip, focus the list inside `.adp-colview-column--active` (found with `querySelector` in the strip).
8. Markup:
   - A `div` with class `adp-colview`, a ref (the strip), `role="group"` and `aria-label` from `commands.viewColumns`.
   - For each `chain` entry `path` at position `i`, with `k = folderViewKey(path)`: a `ColumnPane` with React key `k`; role `active` for the last entry, `parent` for the others; `folder` = `path`; `name` = `columnName(path)`; `width`; `listing` = `getListing(path)`; `pathItem` = the next entry (none for the last); `view` = the props without `options`; `note`, `loading`, `showHidden` and `groupBy` from `options`; `onNavigateKey`; `onSelectItem` = (item, point) calls `options.onNavigate(path, item.path, point)`; `onOpenColumn` calls `options.onNavigate(path, the next entry, null)` (the active column never calls it; give it the same function with `null` for the next entry); `onDragItem` = `options.onDragItem`. Right after it, the divider: a `div` with React key `r-` followed by `k`, class `adp-colview-resizer`, hidden from screen readers, with `startResize` on mouse-down and the reset on double-click.
   - When `child` is set: a `ColumnPane` with React key = its key, role `child`, `folder` = `child`, `name` = `columnName(child)`, `listing` = `getListing(child)`, `pathItem` none, the same `view` and options as above, `onSelectItem` = (item, point) calls `options.onNavigate(child, item.path, point)`, `onOpenColumn` calls `options.onNavigate(child, null, null)`, `onDragItem` = `options.onDragItem`; then its divider (key `r-` and its key).
   - When `preview` is set: a `ColumnPreview` with React key `preview`, the item, width `max(width, PREVIEW_MIN_WIDTH)`, `showExtensions`, `typeLabel` and `onOpen` from the props.

**Tests** (`src/__tests__/columnView.test.tsx`; the virtualizer mock, the `item` helper and the props helper as in `columnPane.test.tsx`; mock `../services/columnListing` so `listFolder` is a `vi.fn`; by default it returns a request whose `done` resolves, for `C:\`, to `F` (folder, path `C:\F`) and `Other` (folder, path `C:\Other`), and for any other path never resolves; tests that need another answer set `mockImplementation`). The helper `renderView(viewOverrides, optionOverrides, initialSelection)` renders `ColumnView` with the items `docs` (folder, path `C:\F\docs`), `alpha.txt`, `beta.txt` (paths in `C:\F`) and options: folder `C:\F`, root `C:\`, note `null`, loading false, showHidden false, groupBy `none`, refreshKey 0, width 240, showPreview true, and spies for `onWidthChange`, `onNavigate`, `onDragItem`. After rendering, let pending promises settle inside `act`.

| Test | Steps | Expected |
|---|---|---|
| "shows the columns from the root to the open folder" | render | 2 `.adp-colview-column`; the first has class `adp-colview-column--parent` and its row "F" has class `adp-colview-row--path`; the second has class `adp-colview-column--active`; `listFolder` called with `C:\` and sort `name`/`ascending` |
| "a selected folder adds its column after a short wait" | fake timers; `docs` selected; `listFolder` for `C:\F\docs` resolves to `inside.txt` (path `C:\F\docs\inside.txt`); advance 150 ms | `listFolder` called with `C:\F\docs`; 3 columns; the last has class `adp-colview-column--child` and a row "inside.txt" |
| "a selected file shows its preview" | alpha selected; click the preview's button; then render with showPreview false | `.adp-colview-preview` contains "alpha.txt" and the helper's type label; `onOpen` called with alpha; then no `.adp-colview-preview` |
| "Right opens the selected folder at its first item" | fake timers; `docs` selected; its listing resolves to `inside.txt`, `more.txt` (paths in `C:\F\docs`); advance 150 ms; ArrowRight on the active list | `onNavigate` with `C:\F\docs`, `C:\F\docs\inside.txt`, `null` |
| "Right before the folder has loaded opens it with nothing selected" | `docs` selected; its listing never resolves; ArrowRight | `onNavigate` with `C:\F\docs`, `null`, `null` |
| "Right on a file does nothing" | alpha selected; ArrowRight | `onNavigate` not called |
| "Left goes one column back" | ArrowLeft on the active list | `onNavigate` with `C:\`, `C:\F`, `null` |
| "Left at the first column opens the parent folder" | root `C:\F`; ArrowLeft | `onNavigate` with `C:\`, `C:\F`, `null`; `listFolder` never called |
| "Left at a drive root does nothing" | folder `C:\`, root `C:\`, no items; ArrowLeft | `onNavigate` not called |
| "clicking in another column opens it" | click the row "Other" in the first column; click the first column's empty list | `onNavigate` with `C:\`, `C:\Other`, `null`; then with `C:\`, `C:\F`, `null` |
| "dragging a divider resizes every column" | mouse-down (button 0) on the first `.adp-colview-resizer` at x 100; a window `mousemove` at x 160; a window `mouseup` at x 160 | after the move every `.adp-colview-column` has the inline width `300px`; `onWidthChange` called once, with 300 |
| "the divider keeps the limits and double-click resets it" | drag from x 100 to x 1000; then double-click the divider | `onWidthChange` with 480; then with 240 |
| "a link back up never repeats a column" | an extra item `up` (folder, path `C:\`) selected | 2 columns; `listFolder` called only for `C:\` |
| "the open folder's column gets the focus" | `document.body` focused before rendering | `document.activeElement` is the `.adp-colview-list` inside `.adp-colview-column--active` |
| "only the open folder's column is the file list" | render | exactly one `.adp-filelist-scroll`, inside `.adp-colview-column--active` |

**Traps:**
- `columnChain`'s entries are display paths; item paths from listings start with `\\?\`. Always compare with `samePath` or `folderViewKey`, never with `===` (P-11).
- Every column has a React key from its folder, never its position: that keeps a column's element when it changes role (D8).
- Do not wrap the panes in `React.memo`: their handlers are new on every render, and the virtualized rows are cheap.

**Commit:** `feat(views): Column view with the preview column [step-05b/T7]`

### T8 - Show Column view in the Explorer

**Files:** create `src/views/explorer/views/useColumnNavigation.ts`, `src/__tests__/useColumnNavigation.test.tsx`; modify `src/views/explorer/views/ItemView.tsx`, `src/views/ExplorerHome.tsx`, `src/__tests__/itemView.test.tsx`.

**Do this (`useColumnNavigation.ts`):** module doc comment "Opening a folder from Column view (Step 05b): select an item in it, then open its menu once it is selected." Export the interface `ColumnNavigationInput` and the hook `useColumnNavigation`.

`ColumnNavigationInput`:

| Field | Type |
|---|---|
| `location` | `ExplorerLocation` |
| `orderPaths` | read-only list of strings |
| `selection` | `SelectionState` |
| `itemByPath` | read-only map from path to `ExplorerItem` |
| `goToFolder` | function (`path: string`) |
| `setSelection` | function (`next: SelectionState`) |
| `pendingSelectRef` | an object with a mutable `current` (string or `null`) |
| `openContextMenu` | function (`point` with `x`, `y`; `item`: `ExplorerItem` or `null`) |

`useColumnNavigation(input)` returns a stable function `(folder, select, menuPoint)` (the `onNavigate` of `ColumnViewOptions`):

1. A ref holding the latest `input`, assigned on every render; a ref `pendingMenu` (an object with `path`, `point` and `at` (a `performance.now()` time), or `null`).
2. The returned function (a `useCallback` with no dependencies, reading the input ref):
   1. When the location is a folder and `folderViewKey(location.path)` equals `folderViewKey(folder)` (never `samePath` here: it does not ignore a trailing backslash): when `select` is not `null`, find the path in `orderPaths` that is `samePath` with it; when found, call `setSelection(selectOnly(match))` and set `pendingMenu` to `{ path: match, point: menuPoint, at: now }` when `menuPoint` is given, else `null`. Stop.
   2. Otherwise call `goToFolder(folder)`, then set `pendingSelectRef.current` to `select`, and `pendingMenu` to `{ path: select, point: menuPoint, at: now }` when both are given, else `null`. (After `goToFolder`, because a later navigation must replace an older wish.)
3. An effect on `input.selection` and `input.itemByPath`: with no `pendingMenu`, nothing. When more than `PENDING_MENU_MS` passed since its `at`, clear it and stop. When exactly one path is selected, it is `samePath` with the pending path, and `itemByPath` has that path: clear `pendingMenu`, then call `openContextMenu(pending point, that item)`.

**Do this (`ItemView.tsx`):** add the optional prop `columnOptions` (`ColumnViewOptions`; comment "Column view only (Step 05b)."). Take it out of the props with `mode` and `onZoomStep`. The `columns` branch (T2) becomes: with `columnOptions`, `ColumnView` with React key `columns`, the remaining props and `options` = `columnOptions`; without them, `FileList` as before.

**Do this (`ExplorerHome.tsx`, about 30 lines):**

1. Imports: `useColumnNavigation` and the type `ColumnViewOptions`.
2. Next to `refreshNonce`, a state `columnsNonce` (number, starting 0). In `refresh`, inside the branch for a folder location, also add 1 to `columnsNonce` (F5 and every file operation go through `refresh`; folder-watch refreshes do not, D7). Do not change `refresh`'s dependencies.
3. Right after `closeMenu` is defined: `navigateColumns` = `useColumnNavigation` with `location`, `orderPaths`, `selection`, `itemByPath`, `goToFolder`, `setSelection`, `pendingSelectRef` and `openContextMenu`.
4. In `folderContent`, in the branch that draws the folder:
   - `columnsMode` = the current view mode (`viewModeState.mode`) is `columns`.
   - The skeleton, the empty note and the no-results note outside the list are drawn only when `columnsMode` is false (Column view draws them inside its column).
   - `columnOptions` (`ColumnViewOptions`): `folder` = the location's path; `root` = `viewModeState.columnRoot`, or the location's path when it is `null`; `note` = `loading` when the skeleton would show, else `empty` when the empty note would show, else `noResults` when the no-results note would show, else `null`; `loading` = the Explorer's `loading` state; `showHidden` = `view.show_hidden`; `groupBy` = `view.group_by`; `refreshKey` = `columnsNonce`; `width` = `view.column_width`; `showPreview` = `view.column_preview`; `onWidthChange` calls `onViewChange` with `column_width` = the width; `onNavigate` = `navigateColumns`; `onDragItem`: only for the main button, set `dragSession.current` to mode `pending`, the paths = a list with the item's path, and the event's client x and y (the same shape `listProps.onItemMouseDown` uses, but the selection is not touched).
   - The `ItemView` is drawn when there are visible items **or** `columnsMode` is true, and gets `columnOptions` = `columnOptions` when `columnsMode` is true, else nothing.
5. Nothing else changes: the notes "Still loading...", "not available" and "some items could not be read" stay above the view as today.

**Tests:**

`src/__tests__/useColumnNavigation.test.tsx` (a probe component calls the hook with props from the test and stores the returned function):

| Test | Steps | Expected |
|---|---|---|
| "opens another folder and remembers what to select" | location folder `C:\F`; call with `C:\Other`, `C:\Other\x.txt`, `null` | `goToFolder` called with `C:\Other`; `pendingSelectRef.current` is `C:\Other\x.txt`; `openContextMenu` not called |
| "selects at once in the open folder" | location `C:\F`, `orderPaths` [`\\?\C:\F\a.txt`, `\\?\C:\F\b.txt`]; call with `c:\f\`, `C:\F\b.txt`, `null` | `goToFolder` not called; `setSelection` called with the selection of only `\\?\C:\F\b.txt` |
| "opens the item menu once the item is selected" | call with `C:\Other`, `C:\Other\x.txt`, (5, 6); render again with selection = only `\\?\C:\Other\x.txt` and `itemByPath` holding it; render once more | `openContextMenu` called once, with (5, 6) and that item |
| "an old wish never opens a menu" | `performance.now` returns 1000 for the call, then 2600; call with a menu point; render again with the item selected | `openContextMenu` not called |

`src/__tests__/itemView.test.tsx`: add the test "Column view needs its options": mode `columns` with column options (folder `C:\F`, root `C:\F`, the other fields as in `columnView.test.tsx`'s defaults) shows an `.adp-colview`; mode `columns` without them shows an `.adp-filelist-header`. The existing tests stay unchanged.

**Traps:**
- `navigateColumns` must not call `goToFolder` for the folder that is already open: `goToLocation` empties the list, and the same location never loads again.
- The pending menu is opened only for the exact item the user right-clicked, within 1 second; never open it for whatever happens to be selected.
- Keep `ExplorerHome.tsx` within about 30 new lines; the logic lives in the hook.

**Commit:** `feat(explorer): show Column view in folders [step-05b/T8]`

### T9 - Settings, help pages

**Files:** modify `src/views/settings/ViewsSettings.tsx`, `src/__tests__/viewsSettings.test.tsx`, `help/en/view-modes.md`, `help/es/view-modes.md`, `help/en/command-bar.md`, `help/es/command-bar.md`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** `settings.viewsColumns`, `settings.columnWidth`, `settings.columnWidthNote`, `settings.columnPreview`.

**Do this (`ViewsSettings.tsx`):** after the row with the list of views, add:

1. An `h4` with class `adp-heading`, text `settings.viewsColumns`.
2. A row (`div` with class `adp-setting-row`): a label (class `adp-setting-label`) `settings.columnWidth`; a `Slider` with `value` = `column_width`, `min` = `COLUMN_WIDTH_MIN`, `max` = `COLUMN_WIDTH_MAX`, `label` = the translated `settings.columnWidth`, whose change calls `onChange` with a copy where `column_width` is `clampColumnWidth` of the value; then a note (`p`, class `adp-note`) `settings.columnWidthNote`.
3. A row: a `Switch` with label `settings.columnPreview`, checked = `column_preview`, changing that field.

**Tests** (`src/__tests__/viewsSettings.test.tsx`): new test "changes the Column view settings": render with the default explorer settings; set the range input's value to 300 with the native value setter, then dispatch a bubbling `input` event and a bubbling `change` event; click the switch named "Show a preview of the selected file" | the last `onChange` call before the click has `column_width` 300; the last call has `column_preview` false.

**Help pages:** replace both `view-modes.md` pages with the exact text in "Help pages" below, and change `command-bar.md` as described there.

**Commit:** `feat(settings): Column view settings and help [step-05b/T9]`

### T10 - Speed measurements and screenshots

**Files:** modify `scripts/measure-ui.mjs`.

**Do this:**

1. In the record written to the JSON file, the step value `05a` becomes `05b`.
2. In the full measurement mode, right after the measurement named "100k folder: switch to List (Ctrl+Shift+5)", add three measurements. "Ctrl+Shift+6" below means the script's `window.__m.key` on `window` with key `^`, code `Digit6`, Ctrl and Shift held (back to Details). "The Columns entry" is `document.querySelectorAll(".adp-ctxmenu [role=menuitemradio]")[8]` (the ninth view in the default order).

   | Name | How |
   |---|---|
   | `100k folder: switch to Column view (View menu)` | the script's `measure` helper: setup clicks `window.__m.menuButton(2)` (the View menu); action clicks the Columns entry with `window.__m.click`; cleanup Ctrl+Shift+6 |
   | `100k folder: arrow key move in Column view` | `measure`: setup is an async function that clicks `window.__m.menuButton(2)`, waits a frame, clicks the Columns entry, waits until `window.__m.rows()` is not empty, clicks `window.__m.rows()[0]` and focuses `window.__m.list()`; action ArrowDown sent to `window.__m.list()`; cleanup Ctrl+Shift+6 |
   | `100k folder: show a subfolder's column` | a loop of `RUNS` runs written like the existing "details pane filled" measurement: first switch to Column view once (View menu, Columns entry, wait until rows exist); in run `n`, `window.__m.timeUntil` clicks `window.__m.rows()[n]` (the 100,000-item folder's first rows are its subfolders `folder-000`, `folder-001`, ...) and is done when `.adp-colview-column--child` contains an element with `role="option"` or an `.adp-empty-note`; after the loop, Ctrl+Shift+6; record name, median, max and runs like that measurement |

3. In the screenshot part, after Step 05a's last action (Ctrl+Shift with code `Digit6`, back to Details), add, each action through the script's `step` helper: click `window.__m.menuButton(2)`; click the Columns entry; wait 300 ms; click the row whose text includes "Invoices"; wait 600 ms; blur the active element; shot `22-column-view`. Click the row whose text includes "Q4 Budget 2026.xlsx"; wait 300 ms; shot `23-column-preview`. Ctrl+Shift with code `Digit6` (back to Details).

**Tests:** none (the script runs in AGENTS.md section 4, C.3 and C.4).

**Commit:** `test(speed): Column view measurements and screenshots [step-05b/T10]`

## Help pages

### New text of `help/en/view-modes.md` (replace the whole page)

```markdown
# Views: icons, list, details, tiles, content and columns

Choose how a folder shows its files: as big icons, a compact list, a table with details, tiles, or columns that show the folders inside each other. Every view selects, opens, renames and drags files the same way.

## Choose a view

- Click **View** in the command bar, or right-click an empty part of the folder and choose **View**. Then pick a view.
- Or press a shortcut:
  - **Ctrl+Shift+1**: **Extra large icons**
  - **Ctrl+Shift+2**: **Large icons**
  - **Ctrl+Shift+3**: **Medium icons**
  - **Ctrl+Shift+4**: **Small icons**
  - **Ctrl+Shift+5**: **List**
  - **Ctrl+Shift+6**: **Details**
  - **Ctrl+Shift+7**: **Tiles**
  - **Ctrl+Shift+8**: **Content**
- **Columns** has no shortcut; choose it from the **View** menu.
- Hold **Ctrl** and turn the mouse wheel over the files: up makes the icons bigger, down makes them smaller.
- The two buttons at the right end of the status bar switch between **Details** and **Large icons**.

## What each view shows

- **Extra large icons**, **Large icons**, **Medium icons**: a grid of icons with the name underneath. Long names show on two lines; point at a name to see all of it.
- **Small icons**: small icons with the name beside them, in rows.
- **List**: small icons in columns. The list scrolls sideways, also with the mouse wheel.
- **Details**: one row per item with its date, type and size. Click a column title to sort.
- **Tiles**: a medium icon with the name, type and size.
- **Content**: one wide row per item with its type, date modified and size.
- **Columns**: each folder in its own column, from left to right. See "Column view" below.

For now the icons show the type of each file. Previews of pictures, videos and documents arrive in a later version.

## Column view

- The folder you have open is the column with the blue selection. The columns on its left are the folders it is inside; in each of them, the gray item shows the way.
- Click a folder: what it contains appears in a new column on the right. Click a file: a preview with its type, size and date appears on the right. Click **Open** there to open the file.
- Click anything in another column to go back to that folder. Click the empty part of a column on the left to go back to it.
- With the keyboard: **Up arrow** and **Down arrow** move in the column. **Right arrow** opens the selected folder. **Left arrow** goes back to the column before; in the first column, it opens the folder that contains it.
- Drag the edge of a column to make all columns wider or narrower. Double-click the edge to go back to the standard width.
- Drag files onto a folder in any column, or onto the empty part of a column, to move them into that folder.
- Right-click a file or folder in any column to see its menu. For the menu of a column's empty part, click that column first.
- Column view stays on while you open folders from its columns, go back or go up. Choosing another view turns it off.

## Each folder remembers its view

- When you choose a view, the open folder keeps it: the next time you open that folder, it opens in the same view. Folders you haven't changed use the default view.
- To use one view everywhere, open **Settings** > **Views** and turn off **Remember each folder's view**. Then choosing a view changes it for all folders.
- **Forget folder views**, in the same place, makes every folder use the default view again.

## Choose the views in the View menu

In **Settings** > **Views**:

- **Default view** is the view of every folder that doesn't have its own.
- Turn a view off to hide it from the **View** menu. Its shortcut stops working too. **Details** is always shown.
- Use the up and down arrows to change the order of the views in the menu.
- Under **Column view**, **Column width** sets how wide the columns are, and **Show a preview of the selected file** turns the preview column on or off.

## With the keyboard

- The arrow keys follow the layout: in the icon views, left and right go to the previous and next item, up and down go to the item above or below. In **List**, left and right jump to the next column. In **Columns**, left and right move between the folders.
- Everything else works as in **Details**: **Shift** extends the selection, **Ctrl+A** selects everything, typing a name jumps to it, **F2** renames, **Enter** opens.

## Good to know

- Sorting and grouping work in every view. Groups show as headings in the icon views, **Tiles** and **Content**; **List** and **Columns** keep the same order without headings.
- In **Columns**, only the open folder's column shows changes made by other apps right away. Press **F5** to update the other columns.
- The search box looks in the open folder only; in **Columns**, that is the column with the blue selection.
- Views only change how files look. Choosing a view never changes your files.

See also: "Selecting files", "The command bar" and "Browsing folders".
```

### New text of `help/es/view-modes.md` (replace the whole page)

```markdown
# Vistas: iconos, lista, detalles, mosaicos, contenido y columnas

Elige cómo muestra una carpeta sus archivos: como iconos grandes, una lista compacta, una tabla con detalles, mosaicos o columnas que muestran las carpetas una dentro de otra. En todas las vistas los archivos se seleccionan, se abren, se cambian de nombre y se arrastran de la misma forma.

## Elegir una vista

- Haz clic en **Ver** en la barra de comandos, o haz clic derecho en una parte vacía de la carpeta y elige **Ver**. Luego elige una vista.
- O usa un atajo:
  - **Ctrl+Mayús+1**: **Iconos muy grandes**
  - **Ctrl+Mayús+2**: **Iconos grandes**
  - **Ctrl+Mayús+3**: **Iconos medianos**
  - **Ctrl+Mayús+4**: **Iconos pequeños**
  - **Ctrl+Mayús+5**: **Lista**
  - **Ctrl+Mayús+6**: **Detalles**
  - **Ctrl+Mayús+7**: **Mosaicos**
  - **Ctrl+Mayús+8**: **Contenido**
- **Columnas** no tiene atajo; elígela en el menú **Ver**.
- Mantén presionada la tecla **Ctrl** y gira la rueda del mouse sobre los archivos: hacia arriba los iconos se agrandan y hacia abajo se achican.
- Los dos botones del extremo derecho de la barra de estado cambian entre **Detalles** e **Iconos grandes**.

## Qué muestra cada vista

- **Iconos muy grandes**, **Iconos grandes**, **Iconos medianos**: una cuadrícula de iconos con el nombre debajo. Los nombres largos ocupan dos líneas; apunta a un nombre para verlo completo.
- **Iconos pequeños**: iconos pequeños con el nombre al lado, en filas.
- **Lista**: iconos pequeños en columnas. La lista se desplaza hacia los lados, también con la rueda del mouse.
- **Detalles**: una fila por elemento con su fecha, tipo y tamaño. Haz clic en el título de una columna para ordenar.
- **Mosaicos**: un icono mediano con el nombre, el tipo y el tamaño.
- **Contenido**: una fila ancha por elemento con su tipo, fecha de modificación y tamaño.
- **Columnas**: cada carpeta en su propia columna, de izquierda a derecha. Consulta «Vista de columnas» más abajo.

Por ahora los iconos muestran el tipo de cada archivo. Las vistas previas de imágenes, videos y documentos llegan en una próxima versión.

## Vista de columnas

- La carpeta que tienes abierta es la columna con la selección azul. Las columnas a su izquierda son las carpetas que la contienen; en cada una, el elemento gris muestra el camino.
- Haz clic en una carpeta: lo que contiene aparece en una columna nueva a la derecha. Haz clic en un archivo: a la derecha aparece una vista previa con su tipo, tamaño y fecha. Haz clic en **Abrir** ahí para abrir el archivo.
- Haz clic en cualquier elemento de otra columna para volver a esa carpeta. Haz clic en la parte vacía de una columna de la izquierda para volver a ella.
- Con el teclado: **Flecha arriba** y **Flecha abajo** se mueven en la columna. **Flecha derecha** abre la carpeta seleccionada. **Flecha izquierda** vuelve a la columna anterior; en la primera columna, abre la carpeta que la contiene.
- Arrastra el borde de una columna para que todas las columnas sean más anchas o más angostas. Haz doble clic en el borde para volver al ancho estándar.
- Arrastra archivos a una carpeta de cualquier columna, o a la parte vacía de una columna, para moverlos a esa carpeta.
- Haz clic derecho en un archivo o una carpeta de cualquier columna para ver su menú. Para el menú de la parte vacía de una columna, primero haz clic en esa columna.
- La vista de columnas sigue activa mientras abres carpetas desde sus columnas, vuelves atrás o subes de nivel. Al elegir otra vista, se desactiva.

## Cada carpeta recuerda su vista

- Cuando eliges una vista, la carpeta abierta la conserva: la próxima vez que abras esa carpeta, se abrirá con la misma vista. Las carpetas que no cambiaste usan la vista predeterminada.
- Para usar una sola vista en todas partes, abre **Configuración** > **Vistas** y desactiva **Recordar la vista de cada carpeta**. Así, elegir una vista la cambia en todas las carpetas.
- **Olvidar las vistas de carpetas**, en el mismo lugar, hace que todas las carpetas vuelvan a usar la vista predeterminada.

## Elegir las vistas del menú Ver

En **Configuración** > **Vistas**:

- **Vista predeterminada** es la vista de todas las carpetas que no tienen una propia.
- Desactiva una vista para ocultarla del menú **Ver**. Su atajo también deja de funcionar. **Detalles** siempre se muestra.
- Usa las flechas hacia arriba y hacia abajo para cambiar el orden de las vistas en el menú.
- En **Vista de columnas**, **Ancho de las columnas** define qué tan anchas son las columnas, y **Mostrar una vista previa del archivo seleccionado** activa o desactiva la columna de vista previa.

## Con el teclado

- Las teclas de flecha siguen la disposición: en las vistas de iconos, izquierda y derecha van al elemento anterior y al siguiente, y arriba y abajo van al elemento de arriba o de abajo. En **Lista**, izquierda y derecha saltan a la columna siguiente. En **Columnas**, izquierda y derecha se mueven entre las carpetas.
- Todo lo demás funciona como en **Detalles**: **Mayús** amplía la selección, **Ctrl+A** selecciona todo, escribir un nombre salta a él, **F2** cambia el nombre y **Entrar** abre.

## Para tener en cuenta

- Ordenar y agrupar funcionan en todas las vistas. Los grupos se muestran como títulos en las vistas de iconos, **Mosaicos** y **Contenido**; **Lista** y **Columnas** mantienen el mismo orden, sin títulos.
- En **Columnas**, solo la columna de la carpeta abierta muestra al instante los cambios que hacen otras aplicaciones. Presiona **F5** para actualizar las demás columnas.
- El cuadro de búsqueda busca solo en la carpeta abierta; en **Columnas**, es la columna con la selección azul.
- Las vistas solo cambian cómo se ven los archivos. Elegir una vista nunca cambia tus archivos.

Consulta también: «Seleccionar archivos», «La barra de comandos» y «Explorar carpetas».
```

### Changes to `command-bar.md`

- `help/en/command-bar.md`: in the **View** bullet (Step 05a's text), the list in parentheses becomes "(**Extra large icons**, **Large icons**, **Medium icons**, **Small icons**, **List**, **Details**, **Tiles**, **Content**, **Columns**; see "Views")". Nothing else changes.
- `help/es/command-bar.md`: in the **Ver** bullet, the list in parentheses becomes "(**Iconos muy grandes**, **Iconos grandes**, **Iconos medianos**, **Iconos pequeños**, **Lista**, **Detalles**, **Mosaicos**, **Contenido**, **Columnas**; consulta «Vistas»)". Nothing else changes.
- In both languages, the last line ("See also" / "Consulta también") names the new title of the views page: "Views: icons, list, details, tiles, content and columns" / «Vistas: iconos, lista, detalles, mosaicos, contenido y columnas».

## Check by hand (the owner, in the packaged app)

Before telling the owner, create this test folder and give the owner its path. All files are plain text unless the table says otherwise.

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

The 100,000-item folder comes from `.\scripts\generate-corpus.ps1` (already used by the speed measurements).

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

## Speed

| Interaction | Tier | How measured |
|---|---|---|
| Switch to Column view in the 100,000-item folder | Fast (1 s) | `100k folder: switch to Column view (View menu)` |
| Arrow key move in Column view, 100,000 items | Instant (0.1 s) | `100k folder: arrow key move in Column view` |
| A selected subfolder's column appears | Fast (1 s) | `100k folder: show a subfolder's column` |
| Moving between columns with Right and Left | Fast (1 s) | by hand (check 4) |
| Scrolling a 100,000-item column | Smooth | by hand (check 12) |
| Every existing measurement | as before | not more than 20% slower than step 05a's JSON |

## Screenshots

`22-column-view`, `23-column-preview` (added in T10), in English light, Spanish dark and the pseudo-locale, in `docs/screenshots/step-05b/`.

## Done when

- [ ] T1 to T10 are committed, each after `GATE PASSED`.
- [ ] Column view shows the folders from the trail root to the open folder, the selected folder's contents and the selected file's preview.
- [ ] The keyboard (Up, Down, Right, Left, type-ahead, F2, Enter, Delete), clicks in any column, right-click menus, double-click and drag and drop work as described in D10 to D12.
- [ ] Column view stays on while browsing inside it and ends when another view is chosen (`useViewMode` tests).
- [ ] Column width (drag and Settings) and the preview switch work and survive a restart.
- [ ] Settings schema 7 loads a schema-6 file without losing anything (Rust test `settings_v6_migrates_to_v7_keeping_language_and_theme`).
- [ ] A cancelled folder listing leaves nothing behind in Rust (`cancelling_a_listing_drops_its_job`).
- [ ] Step 05a's tests still pass, changed only where T2 says.
- [ ] The speed table rows meet their tiers; the screenshots exist; the step report is written.
