# Step 05a: View modes: List, Icons, Tiles, Content

| | |
|---|---|
| State | guide |
| Difficulty | ★★ |
| Branch | `step-05a-view-modes` |
| Tag | `v0.0.10-step05a` |
| Depends on | 04c |

This is a **guide** step (AGENTS.md "Steps come in two kinds"): every decision is below, but no code. Write the code exactly as described: the names, files, types, numbers and texts given here, and nothing else. If something you must write is not decided here, stop with `BLOCKED.md` (AGENTS.md section 5).

## Goal

The View menu works. A folder can be shown as Extra large icons, Large icons, Medium icons, Small icons, List, Details, Tiles or Content, with Windows' shortcuts Ctrl+Shift+1 to Ctrl+Shift+8 and Ctrl+mouse wheel. Each folder remembers its own view (this can be turned off). Settings gets a "Views" section: default view, hide views from the View menu, change their order, and forget the remembered views. The status bar gets Details and Large icons buttons, like Windows 11. In every view, selecting, the keyboard, type-ahead, renaming, right-click menus, drag and drop and check boxes work exactly as in Details.

## Do not do in this step

- No pictures of the file content (thumbnails) in the icon views: icons are the colored type tiles from `fileTile()`. Thumbnails arrive in Step 07a.
- No Column view (Step 05b). No rubber-band selection, column chooser or column resizing (Step 09d). Only the view is remembered per folder, not the sort order or grouping.
- The Home page lists (Recent, Favorites), This PC (drives), Gallery and Network keep their current look.
- Do not change how sorting, grouping, the search filter, opening, renaming, drag and drop, the Details pane or file operations work.
- No animation when switching views. No new libraries.

## Read first

- `plan/conventions.md`, `plan/pitfalls.md` (P-02, P-03, P-04, P-08, P-13, P-16, P-20, P-25, P-28, P-32), `plan/rules.md` R-UI and R-LANG.
- Recipes: `plan/recipes/add-settings-field.md`, `plan/recipes/add-tauri-command.md`, `plan/recipes/add-translation-keys.md`, `plan/recipes/add-help-page.md`.
- Code: `src/views/explorer/FileList.tsx` (all of it), `src/__tests__/fileList.test.tsx` (all of it), `src/services/selection.ts`, `src/services/settings.ts`, `src/commands/registry.ts`, `src/commands/explorerCommands.ts`, `src/commands/menus.ts`, `src/__tests__/commands.test.ts`, `crates/fs-service/src/state.rs`, `crates/fs-service/src/lib.rs`; in `src-tauri/src/main.rs` the settings part (from `CURRENT_SCHEMA` to the end of `migrate`), `AppState`, `main()` and the settings tests; `src/views/settings/OpeningFilesSettings.tsx` (the pattern for a settings section), `src/views/SettingsView.tsx`; in `src/views/ExplorerHome.tsx` the parts each task names.

## Decisions (already made)

- D1. Eight view modes. Their ids, in this order (Windows' View menu order, which is also the order of Ctrl+Shift+1 to Ctrl+Shift+8): `extraLargeIcons`, `largeIcons`, `mediumIcons`, `smallIcons`, `list`, `details`, `tiles`, `content`. This order is the default order of the View menu.
- D2. Three kinds of view component:
  - **Details**: the existing `FileList` (rows with columns), unchanged in look.
  - **Grid** (new `FileGrid`): Extra large, Large, Medium and Small icons, Tiles and Content. Items flow left to right, then on to the next row. Content always has one item per row.
  - **List** (new `ListModeView`): items flow top to bottom, then on to the next column; the view scrolls sideways.
- D3. Sizes are fixed per mode (table "Grid sizes"). The number of items per row follows the window width.
- D4. Grouping: grid views show the group headers across the full width, and each group starts on a new row. List draws no headers but keeps the grouped order. Details is unchanged.
- D5. Keyboard: the same keys as Details. In grids, Left/Right go to the previous/next item (wrapping to the next or previous row), Up/Down go to the same column in the row above or below (to that row's last item when it is shorter). In List, Up/Down go to the previous/next item, Left/Right jump one column. Home, End, Page Up and Page Down work in every view. Shift and Ctrl work as in Details.
- D6. Shortcuts Ctrl+Shift+1 to Ctrl+Shift+8 pick the view by key position (the keyboard event's `code`, `Digit1` to `Digit8`; never its `key`, which is a symbol while Shift is held). Ctrl+mouse wheel over the items: wheel up = bigger (Details, List, Small, Medium, Large, Extra large icons), wheel down = smaller; from Tiles or Content, up goes to Medium icons and down goes to Details; hidden views are skipped. Ctrl+wheel never scrolls or zooms the page.
- D7. Remember per folder (on by default): choosing a view while a folder is open stores it for that folder. Folders without a stored view use the default view (Settings > Views; Details unless changed). When the setting is off, choosing a view changes the default view, and stored views are ignored (not deleted). "Forget folder views" deletes all stored views.
- D8. Stored views live in `folder-views.json` in the data folder (Rust `fs_service::FolderViews`): newest first, at most 1000 folders (the oldest change is dropped), paths of at most 1024 characters (longer paths are not remembered), compared like pinned folders (case-insensitive, with or without `\\?\`, trailing backslash ignored). Failing to store a view never shows an error: the view still changes on screen.
- D9. Settings > Views (new section, before "Opening files"): Default view (dropdown), "Remember each folder's view" (switch), "Forget folder views" (button), and the list of views in menu order, each with a switch (shown in the View menu or not) and Move up / Move down buttons. Details cannot be hidden. Hiding the current default view sets the default to Details.
- D10. Settings schema 6, section `explorer`, four new fields (table below).
- D11. View-mode commands are radio items, enabled only while a folder is open, left out of menus when hidden in settings, with help page `view-modes`, and are no longer `pending`.
- D12. The status bar (Explorer tab, folder open) gets two small buttons at its right end: Details and Large icons, pressed when that view is on. Large icons is left out when it is hidden in settings.
- D13. The click, right-click, keyboard, type-ahead and rename-timer logic moves out of `FileList` into a hook used by all three view components, so every view behaves the same. `FileList`'s existing tests must pass unchanged.
- D14. Every view component keeps the class `adp-filelist-scroll` on its scrolling element and `role="option"` on every item. The measurement script and the tests find items this way.

## Data shapes

### Settings (schema 6), section `explorer`: new fields

| Field | Rust type | TypeScript type | Default | Allowed | Rust `validate()` |
|---|---|---|---|---|---|
| `view_mode` | `String` | `ViewModeId` | `"details"` | one of the 8 ids | must be an id |
| `remember_view_per_folder` | `bool` | `boolean` | `true` | | |
| `view_mode_order` | `Vec<String>` | `ViewModeId[]` | the 8 ids in D1 order | ids, each once | at most 16 entries, each an id, no duplicates |
| `hidden_view_modes` | `Vec<String>` | `ViewModeId[]` | empty | ids except `"details"`, each once | each an id, not `"details"`, no duplicates |

TypeScript normalization (`normalizeSettings`), field by field:
- `hidden_view_modes`: anything that is not an array gives an empty list. Otherwise keep the entries that are ids and not `"details"`, first occurrence only, in the given order.
- `view_mode`: one of the 8 ids, else `"details"`; then, when the result is in the normalized `hidden_view_modes`, `"details"`.
- `view_mode_order`: anything that is not an array gives the default order. Otherwise keep the entries that are ids, first occurrence only, in the given order, then append every missing id in default order. The result always has all 8.
- `remember_view_per_folder`: a boolean, else `true`.

### `folder-views.json` (data folder)

| Field | JSON type | Notes |
|---|---|---|
| `schema_version` | number | 1 |
| `folders` | array of FolderView | newest first |

FolderView:

| Field | Rust type | TypeScript type | Notes |
|---|---|---|---|
| `path` | `String` | `string` | display form (no `\\?\` prefix), in the user's case |
| `mode` | `String` | `string` | a view id |
| `used_unix` | `u64` | `number` | seconds since 1970 when the view was chosen; 0 when missing in the file |

### Grid sizes (pixels)

| Mode | Layout | Cell width | Cell height | Gap | Tile box | Icon | Name |
|---|---|---|---|---|---|---|---|
| `extraLargeIcons` | stacked | 272 | 312 | 12 | 256 | 128 | under the tile, up to 2 lines |
| `largeIcons` | stacked | 128 | 152 | 8 | 96 | 56 | under the tile, up to 2 lines |
| `mediumIcons` | stacked | 96 | 104 | 8 | 48 | 28 | under the tile, up to 2 lines |
| `smallIcons` | inline | 240 | 24 | 4 | 16 | 12 | beside the tile, 1 line |
| `tiles` | tile | 280 | 64 | 8 | 48 | 28 | beside the tile: name, type, size (1 line each) |
| `content` | content | 0 (full width) | 64 | 0 | 48 | 28 | beside the tile: name and type; right column: date modified and size |
| List view | inline | column 260 | item 24 | 0 | 16 | 12 | beside the tile, 1 line |

Stacked cell height = 8 (top padding) + tile + 8 (gap) + 32 (two lines of 16) + 8 (bottom padding). Group header height: 32 (as in Details). The grid's content has 8 px of padding on every side. When the measured width is 0 (hidden tab, tests) use 960; when the measured height is 0 use 600. The Content view's right column is 220 wide.

### New TypeScript types

| Type | File | Shape |
|---|---|---|
| `ViewModeId` | `src/services/settings.ts` | union of the 8 id strings |
| `GridModeId` | `src/views/explorer/views/viewModes.ts` | `ViewModeId` without `"details"` and `"list"` |
| `GridLayoutKind` | `viewModes.ts` | one of `"stacked"`, `"inline"`, `"tile"`, `"content"` |
| `GridSpec` | `viewModes.ts` | `layout` (`GridLayoutKind`); `cellWidth`, `cellHeight`, `gap`, `tile`, `icon` (numbers; `cellWidth` 0 means full width) |
| `GridRow` | `src/views/explorer/views/gridLayout.ts` | a header row: `type` `"header"`, `key` (string), `group` (number); or a cells row: `type` `"cells"`, `key`, `group`, `first` (flat index of the row's first item), `count` (items in the row) |
| `GridLayout` | `gridLayout.ts` | `rows` (`GridRow[]`); `lines` (number[]: the indexes in `rows` of the cells rows, top to bottom); `count` (number of items) |
| `GridMove` | `gridLayout.ts` | one of `"left"`, `"right"`, `"up"`, `"down"`, `"home"`, `"end"`, `"pageUp"`, `"pageDown"` |
| `FolderView` | `src/services/folderViews.ts` | `path` (string), `mode` (string), `used_unix` (number) |
| `ItemViewProps` | `src/views/explorer/views/useItemInteractions.ts` | exactly today's `FileListProps` (moved and renamed) |
| `InteractionOptions`, `ItemInteractions` | `useItemInteractions.ts` | Task T5 |
| `ViewModeState` | `src/views/explorer/views/useViewMode.ts` | `mode` (`ViewModeId`), `visibleModes` (`ViewModeId[]`), `setMode` (takes a `ViewModeId`), `zoomStep` (takes 1 or -1) |
| `ExplorerViewModeRequest` | `src/views/ExplorerHome.tsx` | `mode` (`ViewModeId`), `nonce` (number) |

### Commands

| Command id | Label key | Icon (lucide) | Shortcut |
|---|---|---|---|
| `explorer.viewExtraLargeIcons` (new) | `commands.viewExtraLargeIcons` | `Square` | Ctrl+Shift+1 |
| `explorer.viewLargeIcons` | `commands.viewLargeIcons` | `LayoutGrid` | Ctrl+Shift+2 |
| `explorer.viewMediumIcons` | `commands.viewMediumIcons` | `Grid2x2` | Ctrl+Shift+3 |
| `explorer.viewSmallIcons` | `commands.viewSmallIcons` | `Grid3x3` | Ctrl+Shift+4 |
| `explorer.viewList` | `commands.viewList` | `Rows3` | Ctrl+Shift+5 |
| `explorer.viewDetails` | `commands.viewDetails` | `List` | Ctrl+Shift+6 |
| `explorer.viewTiles` (new) | `commands.viewTiles` | `LayoutList` | Ctrl+Shift+7 |
| `explorer.viewContent` (new) | `commands.viewContent` | `AlignJustify` | Ctrl+Shift+8 |

### Translation keys (all new keys of this step)

| Key | English | Spanish |
|---|---|---|
| `commands.viewExtraLargeIcons` | Extra large icons | Iconos muy grandes |
| `commands.viewTiles` | Tiles | Mosaicos |
| `commands.viewContent` | Content | Contenido |
| `explorer.contentModified` | Date modified: {date} | Fecha de modificación: {date} |
| `explorer.contentSize` | Size: {size} | Tamaño: {size} |
| `settings.views` | Views | Vistas |
| `settings.viewsDefault` | Default view | Vista predeterminada |
| `settings.viewsRemember` | Remember each folder's view | Recordar la vista de cada carpeta |
| `settings.viewsRememberNote` | When this is off, choosing a view changes it for all folders. | Si está desactivado, elegir una vista la cambia en todas las carpetas. |
| `settings.viewsForget` | Forget folder views | Olvidar las vistas de carpetas |
| `settings.viewsForgotten` | Folder views forgotten. All folders now use the default view. | Se olvidaron las vistas de carpetas. Ahora todas las carpetas usan la vista predeterminada. |
| `settings.viewsMenu` | Views in the View menu | Vistas del menú Ver |
| `settings.viewsMenuNote` | Turn a view off to hide it from the View menu. Details is always shown. | Desactiva una vista para ocultarla del menú Ver. Detalles siempre se muestra. |
| `settings.viewsMoveUp` | Move {name} up | Subir {name} |
| `settings.viewsMoveDown` | Move {name} down | Bajar {name} |
| `errors.folderViews.other` | Couldn't change the remembered folder views. Try again. | No se pudieron cambiar las vistas de carpetas recordadas. Vuelve a intentarlo. |
| `errors.folderViews.bad_path` | That folder path isn't valid. | La ruta de esa carpeta no es válida. |
| `errors.folderViews.bad_mode` | That view isn't available. | Esa vista no está disponible. |
| `errors.folderViews.path_too_long` | This folder's path is too long to remember its view. | La ruta de esta carpeta es demasiado larga para recordar su vista. |

The existing keys `commands.viewDetails`, `commands.viewList`, `commands.viewSmallIcons`, `commands.viewMediumIcons` and `commands.viewLargeIcons` stay as they are. Each task says which keys it adds; after editing `en.json`, run `npm run i18n:pseudo`.

## Tasks

After changing Rust code, run `cargo fmt --all` before the gate (the gate checks the formatting).

### T1 - Folder view store (Rust, fs-service)

**Files:** create `crates/fs-service/src/folder_views.rs`, `crates/fs-service/tests/step05a_folder_views_tests.rs`; modify `crates/fs-service/src/state.rs`, `crates/fs-service/src/lib.rs`.

**Do this:**

1. In `state.rs`, make the two private functions `normalize_for_compare` and `without_verbatim_prefix` visible to the crate (`pub(crate)`). Nothing else in that file changes.
2. Create `folder_views.rs`. Module doc comment: "Remembered view per folder (Step 05a): `folder-views.json` in the data folder. Newest first and capped; paths compare like pinned folders."

   Constants (all public):

   | Name | Type | Value |
   |---|---|---|
   | `FOLDER_VIEWS_SCHEMA` | `u32` | 1 |
   | `MAX_FOLDER_VIEWS` | `usize` | 1000 |
   | `MAX_FOLDER_VIEW_PATH` | `usize` | 1024 (characters, counted with `chars().count()`) |
   | `VIEW_MODES` | array of 8 `&str` | the 8 ids in D1 order |

   Types:

   | Type | Fields | Derives and defaults |
   |---|---|---|
   | `FolderView` (public) | the three public fields of the FolderView table | `Debug`, `Clone`, `PartialEq`, `Eq`, `Serialize`, `Deserialize`; `used_unix` takes serde's default (0) when missing |
   | `FolderViews` (public) | public `schema_version: u32`, public `folders: Vec<FolderView>` | the same derives; `schema_version`'s serde default comes from a private function `default_schema` returning `FOLDER_VIEWS_SCHEMA`; `folders` defaults to empty; `Default` gives schema 1 and no folders |

   Functions:

   | Function | Parameters | Returns | Behavior, in order |
   |---|---|---|---|
   | `is_view_mode` (public) | `mode: &str` | `bool` | true when `VIEW_MODES` contains `mode` exactly (case-sensitive) |
   | `valid_path` (private) | `path: &str` | `bool` | the trimmed path is not empty, and the path has at most `MAX_FOLDER_VIEW_PATH` characters |
   | `FolderViews::normalized` | `self` (by value) | `Self` | 1. Keep only entries whose path passes `valid_path` and whose mode passes `is_view_mode`. 2. Sort by `used_unix`, newest first, with the stable sort (`sort_by`, never the unstable one). 3. Keep only the first entry for each compare key (`normalize_for_compare` of the path), using a set of keys. 4. Keep at most `MAX_FOLDER_VIEWS`. 5. Set `schema_version` to `FOLDER_VIEWS_SCHEMA`. |
   | `FolderViews::get` | `&self`, `path: &str` | `Option<&str>` | the mode of the first entry whose compare key equals the compare key of `path` |
   | `FolderViews::set` | `&mut self`, `path: &str`, `mode: &str`, `now_unix: u64` | `bool` | When `path` fails `valid_path` or `mode` fails `is_view_mode`: change nothing, return false. Otherwise remove every entry with the same compare key, insert a new entry at the front (path = `without_verbatim_prefix(path)`, the mode, `used_unix` = `now_unix`), keep at most `MAX_FOLDER_VIEWS`, return true. |
   | `FolderViews::clear` | `&mut self` | nothing | empties `folders` |
   | `FolderViews::load` | `path: &Path` | `Self` | read the file as text, parse it, return it normalized. A missing or unreadable file, or bad JSON, gives the default value (the same pattern as `ExplorerState::load`). |
   | `FolderViews::save` | `&self`, `path: &Path` | the crate's `Result<()>` | pretty JSON of a normalized copy, written with `crate::state::atomic_write`; errors convert to `FsError` |

3. In `lib.rs`: declare the public module `folder_views` after `details`, and re-export from it `is_view_mode`, `FolderView`, `FolderViews`, `MAX_FOLDER_VIEWS`, `MAX_FOLDER_VIEW_PATH` and `VIEW_MODES` (next to the re-exports from `details`).

**Tests** (`crates/fs-service/tests/step05a_folder_views_tests.rs`; files in `tempfile::tempdir()`):

| Test | Steps | Expected |
|---|---|---|
| `set_then_get_matches_every_form_of_the_path` | set `C:\Photos` to `largeIcons` at 10 | `set` returns true; `get` of `c:\photos\`, `\\?\C:\Photos` and `C:\Photos` gives `largeIcons`; `get` of `C:\Other` gives none |
| `set_replaces_the_old_entry_and_moves_it_first` | set `C:\A` largeIcons at 1, `C:\B` tiles at 2, `c:\a` content at 3 | 2 entries; the first has path `c:\a`, mode `content`, `used_unix` 3; the second has path `C:\B` |
| `refuses_unknown_views_and_bad_paths` | set `C:\A` to `huge`; set `"   "` to `list`; set `C:\` followed by 1100 letters `a` to `list` | each returns false; no entries |
| `keeps_at_most_the_newest_1000` | for i from 0 to 1000: set `C:\F<i>` to `list` at i | `MAX_FOLDER_VIEWS` entries; `get` of `C:\F0` gives none; `get` of `C:\F1000` gives `list` |
| `saves_and_loads_the_same_list` | set two folders; save to `folder-views.json` in a temp folder; load it | equal to the saved value |
| `a_missing_or_corrupt_file_loads_empty` | load a path that does not exist; write the text `not json` to a file and load it | both equal the default value |
| `load_drops_invalid_entries_and_keeps_the_newest_duplicate` | write a file with three entries: `C:\A` list 5; `c:\a\` tiles 9; `C:\B` giant 7; load it | one entry, mode `tiles` |
| `clear_forgets_everything` | set one folder, then `clear` | no entries; `get` gives none |
| `view_mode_ids_are_exact` | | `is_view_mode` is true for `details`, false for `Details` and for the empty string |

**Traps:**
- `clear` and `save` never delete the file: an empty list is written instead (pitfall P-08).
- The compare key is lower case; the stored path keeps the user's case.

**Commit:** `feat(fs-service): remember a view per folder [step-05a/T1]`

### T2 - Settings: view modes (schema 6)

**Files:** modify `src-tauri/src/main.rs`, `src/services/settings.ts`, `src/__tests__/settings.test.ts`, `scripts/measure-ui.ps1`.

This is `plan/recipes/add-settings-field.md` with N = 6.

**Do this (Rust, `main.rs`):**

1. `CURRENT_SCHEMA` becomes 6.
2. Next to `default_group_by`, add two default functions: `default_view_mode` (gives `"details"`) and `default_view_mode_order` (gives every entry of `fs_service::VIEW_MODES` as a `String`, in order).
3. In `ExplorerViewSettings`, after `group_by`, add the four fields of the settings table. Serde defaults: `view_mode` from `default_view_mode`; `remember_view_per_folder` from the existing `default_true`; `view_mode_order` from `default_view_mode_order`; `hidden_view_modes` serde's plain default (empty). Add this sentence to the struct's doc comment: "Schema 6 (Step 05a) adds the view mode, per-folder memory, and the View menu's order and hidden views." Add the four defaults to its `Default`.
4. In `validate`, after the `group_by` check, add three checks in the same style (each returns a validation error whose message names the field and the bad value):
   - `view_mode` must pass `fs_service::is_view_mode`.
   - `view_mode_order`: at most 16 entries; every entry passes `is_view_mode`; no entry appears twice.
   - `hidden_view_modes`: every entry passes `is_view_mode` and is not `"details"`; no entry appears twice.
5. In `migrate`, the arm for version 4 (which calls `migrate_keep_known`) also takes version 5: one arm for 4 or 5, same body.
6. Existing tests: in `settings_defaults`, the expected schema version 5 becomes 6. In `settings_v4_migrates_to_v5_keeping_language_and_theme`, the expected schema version 5 becomes `CURRENT_SCHEMA`. In `migrate_v3_round_trips`, the `ExplorerViewSettings` value gets the new fields from `ExplorerViewSettings::default()` (struct update form).
7. New tests in the same test module:
   - `settings_v5_migrates_to_v6_keeping_language_and_theme`: a schema-5 JSON value with language `es`, theme mode `dark`, explorer with `show_hidden` true and `group_by` `type` (and the other three schema-3 flags), files `paste_image_format` `jpg`, open with `protected_view` false and `open_with` mapping `txt` to `windows`. After `migrate`: schema 6; language `es`; theme mode `dark`; `show_hidden` true; `group_by` `type`; `view_mode` `details`; `remember_view_per_folder` true; `view_mode_order` equal to `default_view_mode_order()`; `hidden_view_modes` empty; `protected_view` false; `open_with` maps `txt` to `windows`.
   - `settings_validate_rejects_bad_view_settings`: starting each time from the default settings, `validate` fails for: `view_mode` `huge`; `view_mode_order` `[list, list]`; `view_mode_order` `[giant]`; `view_mode_order` with 17 entries; `hidden_view_modes` `[details]`; `hidden_view_modes` `[tiles, tiles]`. It passes for: `hidden_view_modes` `[tiles]`; `view_mode` `content`; `view_mode_order` `[details]`.

**Do this (TypeScript, `settings.ts`):**

1. `SETTINGS_SCHEMA_VERSION` becomes 6.
2. Above `ExplorerViewSettings`, add these exports:

   | Export | Kind | Content |
   |---|---|---|
   | `ViewModeId` | type | union of the 8 ids |
   | `VIEW_MODE_IDS` | read-only array of `ViewModeId` | the 8 ids in D1 order; doc comment "Same ids and order as Rust `fs_service::VIEW_MODES`." |
   | `isViewModeId` | function (`value: unknown`), type guard to `ViewModeId` | true for the 8 ids |
   | `normalizeViewModeOrder` | function (`value: unknown`), returns `ViewModeId[]` | the `view_mode_order` rule of "TypeScript normalization" |
   | `normalizeHiddenViewModes` | function (`value: unknown`), returns `ViewModeId[]` | the `hidden_view_modes` rule |

3. Add the four fields to `ExplorerViewSettings`, each with a one-line doc comment, and their defaults to `defaultSettings()` (`view_mode_order` is a new copy of `VIEW_MODE_IDS`).
4. In `normalizeSettings()`, inside the explorer part, add the four fields following "TypeScript normalization" (work out the hidden list first, then the view mode).

**Do this (`scripts/measure-ui.ps1`):** in the `$settings` block, the schema version becomes 6, and the `explorer` part gets the four new fields with their defaults: `view_mode` "details", `remember_view_per_folder` true, `view_mode_order` the 8 ids in D1 order (a PowerShell array), `hidden_view_modes` an empty PowerShell array. Keep the file's Windows line endings (P-32).

**Tests** (`src/__tests__/settings.test.ts`):
- In "keeps valid Explorer view options and repairs invalid ones": the expected schema version 5 becomes 6, and the expected explorer object gets the four new fields with their defaults.
- New test "normalizes the view settings (schema 6)":

  | Input to `normalizeSettings` | Expected |
  |---|---|
  | `{}` | `view_mode` `details`, `remember_view_per_folder` true, `view_mode_order` equal to the 8 ids in D1 order, `hidden_view_modes` empty |
  | explorer `view_mode` `tiles` | `view_mode` `tiles` |
  | explorer `view_mode` `huge` | `view_mode` `details` |
  | explorer `view_mode` `tiles` and `hidden_view_modes` `[tiles]` | `view_mode` `details`; `hidden_view_modes` `[tiles]` |
  | explorer `hidden_view_modes` `[details, list, list, x]` | `hidden_view_modes` `[list]` |
  | explorer `view_mode_order` `[content, content, bogus, details]` | `[content, details, extraLargeIcons, largeIcons, mediumIcons, smallIcons, list, tiles]` |
  | explorer `view_mode_order` `"nope"` | the default order |
  | explorer `remember_view_per_folder` false; then `"no"` | false; then true |

**Commit:** `feat(settings): view mode settings (schema 6) [step-05a/T2]`

### T3 - Folder view commands and service

**Files:** create `src-tauri/src/folder_views.rs`, `src/services/folderViews.ts`, `src/__tests__/folderViews.test.ts`; modify `src-tauri/src/main.rs`, `src-tauri/isolation/index.html`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Do this (Rust, `src-tauri/src/folder_views.rs`)**, following `plan/recipes/add-tauri-command.md`:

1. Module doc comment: "Remembered folder views (Step 05a): commands over `fs_service::FolderViews` in `folder-views.json`."
2. A public tuple struct `FolderViewsLock` with one public field of type `Mutex<()>`, deriving `Default`. Comment: "One lock for the file, so a read never races a write."
3. Private function `folder_views_file(data_dir)`: the path of `folder-views.json` inside `data_dir`.
4. Public pure function `check_set_args(path: &str, mode: &str)`, returning `Result<(), String>`, checking in this order: `crate::validate_absolute_path` fails: `folderViews.bad_path`; the mode fails `fs_service::is_view_mode`: `folderViews.bad_mode`; the path has more than `fs_service::MAX_FOLDER_VIEW_PATH` characters: `folderViews.path_too_long`.
5. Three commands. Each is a public async command whose first parameter is the window; it starts with `ensure_main` on the window's label, takes a clone of the window's app handle (the `tauri::Manager` trait must be in scope), and does all file work inside `tauri::async_runtime::spawn_blocking`. Inside, it reads the managed `AppState` (for `data_dir`) and the managed `FolderViewsLock` from that handle, and locks the lock; a poisoned lock gives `folderViews.other` (never `unwrap`, P-20). A failed save gives `folderViews.other`. A failed join gives the join error's text.

   | Command | Arguments | Returns | Work |
   |---|---|---|---|
   | `folder_views_get` | none | list of `fs_service::FolderView` | lock, load, return the `folders` |
   | `folder_view_set` | `path: String`, `mode: String` | nothing | `check_set_args` first (before `spawn_blocking`); then lock, load, `set` with `crate::unix_now()`, save |
   | `folder_views_clear` | none | nothing | lock, load, `clear`, save |

6. A test module with `check_set_args_validates_every_argument`: `C:\Photos` with `largeIcons` is accepted; `relative\path` with `list` gives `folderViews.bad_path`; `C:\Photos` with `huge` gives `folderViews.bad_mode`; `C:\` followed by 1100 letters `a`, with `list`, gives `folderViews.path_too_long`.

**Do this (`main.rs`, isolation):**
1. Declare the module `folder_views` after `files`.
2. Register a default `folder_views::FolderViewsLock` as managed state, right after the `files::FileGrants` one.
3. Add the three commands to `generate_handler!`.
4. Add `folder_views_get`, `folder_view_set` and `folder_views_clear` to `ALLOWED` in `src-tauri/isolation/index.html`.

**Do this (TypeScript, `src/services/folderViews.ts`):**

| Export | Kind | Behavior |
|---|---|---|
| `FolderView` | interface | mirrors Rust (snake_case fields) |
| `FOLDER_VIEWS_CLEARED_EVENT` | constant | `"adp-folder-views-cleared"` |
| `folderViewKey` | pure function (`path: string`), returns string | the display path (`displayPath`), without trailing backslashes, in lower case: `\\?\C:\Photos\` and `C:\Photos` give `c:\photos`; `C:\` gives `c:` |
| `folderViewMap` | pure function (`entries: readonly FolderView[]`), returns `Map<string, ViewModeId>` | in order, for each entry whose mode passes `isViewModeId` and whose key is not in the map yet, map its key to its mode |
| `getFolderViews` | async, no parameters, returns `FolderView[]` | outside Tauri (`isTauriRuntime()` false): an empty list; otherwise the result of the Rust command `folder_views_get` |
| `setFolderView` | async (`path: string`, `mode: ViewModeId`), returns nothing | outside Tauri: nothing; otherwise calls `folder_view_set` with the arguments `path` and `mode` |
| `clearFolderViews` | async, no parameters, returns nothing | in Tauri, waits for `folder_views_clear`; then, in every case, dispatches a plain DOM event named `FOLDER_VIEWS_CLEARED_EVENT` on `window` |

**Translation keys:** the four `errors.folderViews.*` keys.

**Tests** (`src/__tests__/folderViews.test.ts`):
- "folderViewKey ignores case, the long-path prefix and a trailing backslash": the three examples above.
- "folderViewMap keeps the first entry per folder and known views only": entries `C:\A` tiles (9), `c:\a\` list (5), `C:\B` giant (1) give a map with one entry: `c:\a` to `tiles`.
- "clearFolderViews tells open Explorers to forget": a `window` listener for the event counts calls; after `clearFolderViews()` finishes (tests are not Tauri) the count is 1; remove the listener at the end.

**Commit:** `feat(views): folder view commands [step-05a/T3]`

### T4 - Pure rules: caret moves, grid layout, view modes

**Files:** modify `src/services/selection.ts`, `src/__tests__/selection.test.ts`; create `src/views/explorer/views/gridLayout.ts`, `src/views/explorer/views/viewModes.ts`, `src/__tests__/gridLayout.test.ts`, `src/__tests__/viewModes.test.ts`.

**Do this (`selection.ts`):** add two exported functions after `moveFocus`, then make `moveFocus` use them.

| Function | Parameters | Returns | Behavior |
|---|---|---|---|
| `linearMoveTarget` | `move: FocusMove`, `current: number`, `count: number`, `pageSize: number` | number | `count` 0 gives -1. With `last = count - 1` and `page = max(1, pageSize)`: `first` gives 0; `last` gives `last`; otherwise, when `current < 0`, 0; `next` gives `min(last, current + 1)`; `previous` gives `max(0, current - 1)`; `pageDown` gives `min(last, current + page)`; `pageUp` gives `max(0, current - page)`. |
| `moveFocusTo` | `state: SelectionState`, `order: readonly string[]`, `target: number`, `options: MoveOptions` (optional, default empty) | `SelectionState` | Empty `order` gives `state` itself. Clamp `target` to the first and last index; take that path. With `options.shift`: `selectRange` from the anchor to that path, adding to the selection when `options.ctrl` is true. Else with `options.ctrl`: the same state with only `focus` moved to that path. Else: `selectOnly` that path. |

New behavior of `moveFocus`: empty `order` gives `state`; otherwise `current` is the index of `state.focus` in `order` (-1 when there is none), and the result is `moveFocusTo` with the target from `linearMoveTarget` (page size from `options.pageSize`, or 10 when not given) and the same options. The existing `moveFocus` tests must pass unchanged.

**Do this (`gridLayout.ts`):** the types `GridRow`, `GridLayout`, `GridMove` (Data shapes) and these pure functions:

| Function | Parameters | Returns | Behavior |
|---|---|---|---|
| `columnsFor` | `width`, `cellWidth`, `gap` (numbers) | number | `cellWidth` 0 or less gives 1; otherwise `max(1, floor((width + gap) / (cellWidth + gap)))` |
| `buildGridLayout` | `groupSizes: readonly number[]`, `columns: number`, `headers: boolean` | `GridLayout` | `cols = max(1, floor(columns))`, offset starts at 0. For each group `g` of size `n`: skip it when `n` is 0 or less; when `headers`, add a header row with key `h<g>` and group `g`; then add cells rows `r = 0, 1, ...` while `r * cols < n`: key `c<g>-<r>`, group `g`, `first = offset + r * cols`, `count = min(cols, n - r * cols)`, and record each cells row's index in `lines`; then add `n` to the offset. `count` is the final offset. |
| `lineOfIndex` | `layout: GridLayout`, `index: number` | number | binary search over `layout.lines` for the cells row with `first <= index < first + count`; its position in `lines`, or -1. Never a scan of every row (100,000 items). |
| `gridMove` | `layout: GridLayout`, `index: number`, `move: GridMove`, `pageLines: number` | number | `count` 0 gives -1. An `index` outside the items gives 0. `left`: `max(0, index - 1)`; `right`: `min(count - 1, index + 1)`; `home`: 0; `end`: `count - 1`. For `up`, `down`, `pageUp`, `pageDown`: take the item's line (`lineOfIndex`) and its column (index minus the row's `first`); move the line by -1, +1, `-max(1, pageLines)` or `+max(1, pageLines)`, clamped to the first and last line; return the target row's `first` plus the smaller of the column and that row's `count - 1`. |
| `flowMove` | `count`, `rowsPerColumn`, `pageColumns`, `index` (numbers), `move: GridMove` | number | For List view. `count` 0 gives -1; `rpc = max(1, rowsPerColumn)`; an `index` outside the items gives 0. `up`: `max(0, index - 1)`; `down`: `min(count - 1, index + 1)`; `home`: 0; `end`: `count - 1`; `left`: `index - rpc` when that is 0 or more, else `index`; `right`: `index + rpc` when that is at most `count - 1`, else `count - 1` when `floor(index / rpc) < floor((count - 1) / rpc)`, else `index`; `pageUp`: `max(0, index - rpc * max(1, pageColumns))`; `pageDown`: `min(count - 1, index + rpc * max(1, pageColumns))`. |

**Do this (`viewModes.ts`):**
- The types `GridModeId`, `GridLayoutKind`, `GridSpec` (Data shapes).
- `GRID_SPECS`: a record from each `GridModeId` to its `GridSpec`, with the values of the "Grid sizes" table (`content` has cell width 0).
- Constants: `GRID_PADDING` 8, `GROUP_HEADER_HEIGHT` 32, `LIST_ITEM_HEIGHT` 24, `LIST_COLUMN_WIDTH` 260, `CONTENT_META_WIDTH` 220, `FALLBACK_WIDTH` 960, `FALLBACK_HEIGHT` 600, `ZOOM_STEP_DELTA` 100, `ZOOM_STEP_INTERVAL_MS` 150.
- `ZOOM_ORDER`: read-only list `details`, `list`, `smallIcons`, `mediumIcons`, `largeIcons`, `extraLargeIcons`.
- Pure functions:

| Function | Parameters | Returns | Behavior |
|---|---|---|---|
| `isGridMode` | `mode: ViewModeId` | type guard to `GridModeId` | true for every mode except `details` and `list` |
| `visibleViewModes` | `view` (has `view_mode_order` and `hidden_view_modes`) | `ViewModeId[]` | `normalizeViewModeOrder` of the order, without the hidden modes; `details` is always kept |
| `effectiveViewMode` | `view` (has `view_mode`, `remember_view_per_folder`, `hidden_view_modes`), `folderMode: ViewModeId` or undefined | `ViewModeId` | the folder's mode when memory is on, the folder has a mode and it is not hidden; else `view_mode` when it is not hidden; else `details` |
| `zoomTarget` | `current: ViewModeId`, `direction` (1 or -1), `visible: readonly ViewModeId[]` | `ViewModeId` or `null` | `steps` = `ZOOM_ORDER` entries that are in `visible`. When `current` is in `steps`: the entry one place further in `direction`, or `null` past either end. Otherwise (Tiles, Content): direction 1 gives the first entry of `steps` at or after `mediumIcons` in `ZOOM_ORDER`, or `null`; direction -1 gives `details`. |
| `viewModeFromKey` | `event` (has `code`, `ctrlKey`, `metaKey`, `shiftKey`, `altKey`) | `ViewModeId` or `null` | `null` unless (Ctrl or Meta) and Shift and not Alt. `code` `Digit1` to `Digit8` gives the id at that position (1 to 8) of `VIEW_MODE_IDS`; any other code gives `null`. |
| `skeletonVariant` | `mode: ViewModeId` | `"rows"` or `"tiles"` | `tiles` for `mediumIcons`, `largeIcons`, `extraLargeIcons` and `tiles`; `rows` otherwise |

**Tests:**

`src/__tests__/selection.test.ts`, new group "moving the caret by index":
- "linearMoveTarget follows the keys": (`next`, -1, 5, 10) gives 0; (`next`, 2, 5, 10) 3; (`next`, 4, 5, 10) 4; (`previous`, 0, 5, 10) 0; (`pageDown`, 1, 5, 3) 4; (`pageUp`, 4, 5, 3) 1; (`first`, 3, 5, 10) 0; (`last`, 0, 5, 10) 4; (`next`, 0, 0, 10) -1.
- "moveFocusTo selects, extends, or only moves the caret": order `a b c d`, starting from `selectOnly("b")`. Target 3: selected `d`, focus `d`. Target 3 with Shift: selected `b c d`, anchor `b`. Target 0 with Ctrl: selected `b`, focus `a`. Target 99: focus `d`. Target -4: focus `a`. Empty order: the very same state object.

`src/__tests__/gridLayout.test.ts`:

| Test | Input | Expected |
|---|---|---|
| "columnsFor fits whole cells" | (960, 128, 8); (135, 128, 8); (264, 128, 8); (0, 128, 8); (500, 0, 8) | 7; 1; 2; 1; 1 |
| "buildGridLayout splits a group into rows" | ([5], 2, false) | three cells rows, `first` 0, 2, 4 and `count` 2, 2, 1; `lines` [0, 1, 2]; `count` 5 |
| "starts each group on a new row under its header" | ([3, 2], 2, true) | row types header, cells, cells, header, cells; cells `first` 0, 2, 3 and `count` 2, 1, 2; `lines` [1, 2, 4]; header groups 0 and 1 |
| "skips empty groups" | ([0, 3], 3, true) | a header for group 1, then one cells row with `first` 0 and `count` 3 |
| "lineOfIndex finds the line of an item" | layout of ([3, 2], 2, true); indexes 0, 2, 4, 5 | 0, 1, 2, -1 |
| "gridMove: left and right wrap across rows" | layout of ([7], 3, false): right from 2; left from 3; left from 0; right from 6 | 3; 2; 0; 6 |
| "gridMove: up and down keep the column" | same layout: down from 1; down from 4; down from 6; up from 6; up from 1 | 4; 6; 6; 3; 1 |
| "gridMove: home, end and pages" | same layout: home from 5; end from 0; pageDown from 0 with 2 page lines; pageUp from 6 with 5 page lines | 0; 6; 6; 0 |
| "gridMove: starts at the first item without a caret" | down from -1 on the same layout; any move on the layout of ([], 3, false) | 0; -1 |
| "gridMove: crosses group headers" | layout of ([2, 3], 2, true): down from 1; down from 3; up from 2 | 3; 4; 0 |
| "flowMove moves by items and columns" | count 10, 4 rows per column, 2 page columns: down from 3; up from 4; right from 1; right from 5; right from 7; right from 9; left from 2; left from 6; pageDown from 0; pageUp from 9; home from 5; end from 0; down from -1 | 4; 3; 5; 9; 9; 9; 2; 2; 8; 1; 0; 9; 0 |

`src/__tests__/viewModes.test.ts`:
- "effectiveViewMode prefers the folder's own view": with view mode `details`, memory on, nothing hidden: folder mode `tiles` gives `tiles`; no folder mode gives `details`. Memory off with folder mode `tiles`: `details`. Hidden `[tiles]` with folder mode `tiles`: `details`. View mode `list`, hidden `[list]`, no folder mode: `details`.
- "visibleViewModes keeps the order and drops hidden views": the default order with hidden `[tiles, details]` gives the default order without `tiles`.
- "zoomTarget walks the sizes and skips hidden views": all visible: (`details`, 1) `list`; (`list`, 1) `smallIcons`; (`extraLargeIcons`, 1) `null`; (`details`, -1) `null`; (`mediumIcons`, -1) `smallIcons`; (`tiles`, 1) `mediumIcons`; (`content`, -1) `details`. Without `smallIcons`: (`list`, 1) `mediumIcons`. Without `mediumIcons`: (`tiles`, 1) `largeIcons`.
- "viewModeFromKey reads the key position": Ctrl+Shift with `Digit1` gives `extraLargeIcons`, `Digit6` `details`, `Digit8` `content`, `Digit9` `null`; Ctrl without Shift `null`; Ctrl+Shift+Alt `null`; Meta+Shift with `Digit2` `largeIcons`.
- "skeletonVariant and sizes": `largeIcons` gives `tiles`; `list` and `details` give `rows`; the cell heights of `mediumIcons`, `largeIcons` and `extraLargeIcons` are 104, 152 and 312; the cell width of `content` is 0.

**Commit:** `feat(views): grid layout and view mode rules [step-05a/T4]`

### T5 - One set of item interactions for every view

**Files:** create `src/views/explorer/views/useItemInteractions.ts`; modify `src/views/explorer/FileList.tsx`.

This task moves code; the behavior must not change. `src/__tests__/fileList.test.tsx` is the check and must pass **unchanged**.

**Do this:**

1. Create `useItemInteractions.ts` and move into it, from `FileList.tsx`:
   - The whole `FileListProps` interface, renamed `ItemViewProps` (same fields, same comments), exported.
   - The constants `TYPE_AHEAD_RESET_MS` (1000) and `RENAME_CLICK_DELAY_MS` (500).
2. In the same file, export the interface `InteractionOptions`:

   | Field | Type | Meaning |
   |---|---|---|
   | `order` | read-only list of paths | the items' paths in display order |
   | `orderItems` | read-only list of `ExplorerItem` | the same items, same order |
   | `scrollRef` | React ref to a `div` (may be null) | the element with `role="listbox"` |
   | `moveTarget` | function (`key: string`, `current: number`), returns number or `null` | the index a navigation key moves to, or `null` when the key is not a navigation key; `current` is -1 without a caret |
   | `elementForIndex` | function (`index: number`), returns an `Element` or `null` | the element that shows that item, or `null` when it is not drawn |

3. Export the hook `useItemInteractions`, with parameters `props: ItemViewProps` and `options: InteractionOptions`, returning `ItemInteractions` (an exported interface with the public members of this table). It is made of FileList's current code:

   | Member | Comes from | Change |
   |---|---|---|
   | (inside) the `typeAhead` and `renameTimer` refs, and the unmount effect that clears the timer | FileList | none |
   | `cancelRenameTimer` | FileList's `cancelRenameTimer` | none |
   | `onItemClick` (event, item) | FileList's `onRowClick` | uses `options.order` |
   | `onItemDoubleClick` (event, item) | the row's inline double-click handler | stops propagation, cancels the rename timer, then opens the item (`onOpen`) unless it is the item being renamed |
   | `onItemContextMenu` (event, item) | FileList's `onRowContextMenu` | none |
   | `onItemAuxClick` (event, item) | the row's inline aux-click handler | none (the middle button on a file opens it in the background) |
   | `onCheckClick` (event, item) | the check box's inline click handler | none (stops propagation, cancels the rename timer, toggles the item) |
   | (inside) `menuPointForFocus` | FileList's `menuPointForFocus` | the caret's index is its position in `options.order` (-1 without a caret); the element is `options.elementForIndex` of that index (none when -1); the point is worked out as today; the item is `options.orderItems` at that index when its path is selected, else `null` |
   | `onListKeyDown` (event) | FileList's `onKeyDown` | keep the first check (the event's target must be `options.scrollRef`'s element). Replace the `KEY_MOVES` part with: when Alt is not held, ask `options.moveTarget` for the key and the caret's index; when it gives a number, prevent the default and call `onSelectionChange` with `moveFocusTo` for that target, with shift = Shift held and ctrl = Ctrl or Meta held, then stop. Everything after it stays the same. Type-ahead takes the names from `options.orderItems` (`displayName` with `showExtensions`, as today) and the paths from `options.order`. |
   | `onListClick` | the scroll element's inline click handler | none |
   | `onListContextMenu` (event) | the scroll element's inline context-menu handler | none |

4. In `FileList.tsx`:
   - Replace the interface with an exported type alias `FileListProps` equal to `ItemViewProps` (existing imports keep working).
   - Remove everything that moved. Keep `ROW_HEIGHT`, `HEADER_HEIGHT`, `KEY_MOVES`, the rows, the virtualizer, the first-paint effects, the caret-scroll effect, `renderRow`, the header and the select-all check box.
   - Add `orderItems`: the items of `itemRows`, in a `useMemo`.
   - Call the hook once per render, unconditionally, after `rowIndexOfPath`, with:
     - `moveTarget`: `KEY_MOVES` of the key; no entry gives `null`; otherwise `linearMoveTarget` with that move, the current index, the number of items, and a page size of `max(1, floor(height / ROW_HEIGHT) - 1)`, where height is the scroll element's `clientHeight` at the moment of the key press (280 when the element is missing).
     - `elementForIndex`: the row number of that path from `rowIndexOfPath`, then the element with that `data-row` value inside the scroll element, or `null`.
   - In `renderRow` and on the scroll element, use the hook's members instead of the inline handlers. The mouse-down handler stays inline.
   - Remove imports that are no longer used.

**Tests:** no new tests. Every test in `src/__tests__/fileList.test.tsx` and `src/__tests__/explorerHome.test.tsx` passes without changes. If one fails, the move changed behavior: compare with `git diff` and fix the hook, never the test (P-25).

**Traps:**
- Keep every "stop propagation" where it was. Without it, a click on an item also reaches the list's own click handler and clears the selection.
- The hook returns new functions on every render that read the current `props`; do not memoize them with stale dependencies.

**Commit:** `refactor(explorer): share item interactions between views [step-05a/T5]`

### T6 - Icon, Tiles and Content views

**Files:** create `src/views/explorer/views/FileGrid.tsx`, `src/styles/views.css`, `src/__tests__/fileGrid.test.tsx`; modify `src/main.tsx` (import `./styles/views.css` right after `./styles/components.css`), `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** `explorer.contentModified`, `explorer.contentSize`.

**Do this (`FileGrid.tsx`):** the default export `FileGrid` takes `ItemViewProps` plus `mode` (`GridModeId`).

1. `spec` is the mode's `GridSpec` from `GRID_SPECS`.
2. Display order, each in a `useMemo`: `orderItems` = the groups' items one group after another when `groups` is not null, else `items`; `order` = their paths; `groupSizes` = the number of items of each group, or a single entry with the item count when there are no groups.
3. Width: a state that starts at 0. In a layout effect that runs once, read the scroll element's `clientWidth`; when the browser has `ResizeObserver` (check that it exists), observe the element and update the state from its `clientWidth` on every change; disconnect in the cleanup. The usable width is the state (or `FALLBACK_WIDTH` when it is 0) minus twice `GRID_PADDING`.
4. Columns: 1 when the spec's cell width is 0, else `columnsFor(usable width, cell width, gap)`. `layout` = `buildGridLayout(groupSizes, columns, groups are present)`, in a `useMemo`.
5. Virtualizer (`useVirtualizer`), one virtual item per layout row: count = number of layout rows; scroll element = the scroll element ref; estimated size = `GROUP_HEADER_HEIGHT` for header rows and cell height + gap for cells rows; item key = the row's `key`, from a callback that depends on `layout` (a new layout makes the virtualizer measure again); overscan 4; padding at the start and at the end = `GRID_PADDING`.
6. First paint: the same two effects as FileList (the painted flag, `requestAnimationFrame`, `onFirstPaint`).
7. Caret on screen: an effect on the caret path (same pattern as FileList's): find the caret's index in `order`, its line with `lineOfIndex`, and when the line exists, scroll the virtualizer to that line's row (`layout.lines` at the line) with alignment `auto`.
8. Interactions: the hook with `order`, `orderItems`, the scroll ref, and:
   - `moveTarget`: ArrowLeft `left`, ArrowRight `right`, ArrowUp `up`, ArrowDown `down`, Home `home`, End `end`, PageUp `pageUp`, PageDown `pageDown`; other keys `null`. The result is `gridMove` with the layout, the current index, the move and `pageLines = max(1, floor(height / (cell height + gap)) - 1)`, where height is the scroll element's `clientHeight` (0 when missing).
   - `elementForIndex`: the element with that `data-index` value inside the scroll element, or `null`.
9. Markup (classes exactly as named):
   - Root: a `div` with classes `adp-filelist adp-itemgrid adp-itemgrid--<mode>`. There is no column header row.
   - Scroll element: a `div` with classes `adp-filelist-scroll adp-itemgrid-scroll`, the scroll ref, `role="listbox"`, `aria-multiselectable` true, `aria-label` from the `label` prop, `aria-activedescendant` = the id of the caret's item (when it has an index), `tabIndex` 0, and the key-down, click and context-menu handlers from the hook.
   - Inside it: a `div` with class `adp-itemgrid-inner`, as tall as the virtualizer's total size.
   - Each virtual row is placed with a vertical translate of its start and the row's height (32, or the cell height). A header row is a `div` with classes `adp-group-header adp-itemgrid-header` and `role="presentation"`, holding the same three spans as FileList's group header: the label (the group's `label`, or the translation `explorer.group.<id>`), the count (`adp-group-count`, the group's item count) and the rule (`adp-group-rule`). A cells row is a `div` with class `adp-itemgrid-row`, `role="presentation"` and the spec's gap between its items.
   - Each item, for every index from the row's `first` to `first + count - 1`: a `div` with React key = path, `id` = the component's `useId` value followed by `-item-<index>`, `data-index` = index, `role="option"`, `aria-selected`; classes `adp-itemgrid-cell adp-itemgrid-cell--<layout>` plus `adp-itemgrid-cell--selected`, `adp-itemgrid-cell--focused` and `adp-itemgrid-cell--hidden` (hidden or system item) when they apply; a width of the spec's cell width in pixels (no width when it is 0); `data-drop-folder` and `data-drop-name` exactly as FileList sets them; the mouse-down handler as in FileList; and the hook's click, double-click, context-menu and aux-click handlers.
10. Item content, in this order:

    | Layout | Content |
    |---|---|
    | every layout | when check boxes are on: the check box exactly as FileList draws it (class `adp-row-check`, plus `adp-row-check--on` when selected, with a 12 px `Check` icon), whose click is the hook's `onCheckClick` |
    | every layout | the tile: a `span` with classes `adp-file-tile adp-file-tile--<tone> adp-itemgrid-tile` from `fileTile(name, kind)`, as wide and as tall as the spec's tile size, holding the tile's icon at the spec's icon size, hidden from screen readers |
    | stacked, inline | the name: a `span` with classes `adp-file-name adp-itemgrid-name` and a `title` with the shown name (`displayName`, as in FileList), or `RenameInput` (same props as in FileList) when this item is being renamed; then a `span` with class `adp-itemgrid-badges` holding FileList's two badges (cloud when online-only, link when it is a link) |
    | tile | a `span` with class `adp-itemgrid-text` holding the name (as above), a `span` with class `adp-itemgrid-detail` with the type label (`typeLabel` prop), and another with the size (`formatSize`; empty for folders and drives); then the badges |
    | content | a `span` with class `adp-itemgrid-text` holding the name and a detail `span` with the type label; then a `span` with class `adp-itemgrid-meta` holding two detail spans: `explorer.contentModified` with the formatted date when the item has a date (else empty), and `explorer.contentSize` with the formatted size for files (else empty); then the badges |

**Do this (`src/styles/views.css`):** a comment line "View modes (Step 05a). Colors only through tokens.", then these rules. Write each with the CSS properties that do exactly what the table says; use only the tokens named.

| Selector | Layout | Size and spacing | Look |
|---|---|---|---|
| `.adp-itemview` | flex column; grows to fill (flex 1); may shrink below its content height (min-height 0) | | |
| `.adp-itemgrid-inner` | positioned (relative) | full width | |
| `.adp-itemgrid-header` | absolutely positioned at the top left | full width | |
| `.adp-itemgrid-row` | absolutely positioned at the top, from left 0 to right 0; flex row | horizontal padding 8 px | |
| `.adp-itemgrid-row` that contains `.adp-rename` (`:has`) | stacked above other rows (z-index 5) | | |
| `.adp-itemgrid-cell` | positioned (relative); flex; does not shrink; hides overflow | | corner radius `--adp-radius-sm`; text `--adp-color-text-primary`; font size `--adp-font-body`; pointer cursor; text not selectable |
| `.adp-itemgrid-cell` on hover | | | background `--adp-color-surface-selected` |
| `.adp-itemgrid-cell--selected`, also on hover | | | background `--adp-color-surface-selected-row` |
| `.adp-itemgrid-cell--hidden` | | | opacity 0.55 |
| `.adp-itemgrid-cell--focused` inside a focused-visible `.adp-filelist-scroll` | | | inset ring of 1 px in `--adp-accent-current` (box shadow) |
| `.adp-itemgrid-cell` that contains `.adp-rename` | overflow visible; stacked above others (z-index 5) | | |
| `.adp-itemgrid-cell--stacked` | flex column, items centered | gap 8 px; padding 8 px top and bottom, 4 px left and right | |
| `.adp-itemgrid-cell--inline` | flex row, items centered vertically | gap `--adp-space-2`; padding 0 top and bottom, `--adp-space-2` left and right | |
| `.adp-itemgrid-cell--tile` | flex row, items centered vertically | gap `--adp-space-3`; padding 0 and `--adp-space-3` | |
| `.adp-itemgrid-cell--content` | flex row, items centered vertically; grows to fill the row (flex 1) | gap `--adp-space-4`; padding 0 and `--adp-space-3` | no corner radius; bottom border 1 px `--adp-color-border-subtle` |
| `.adp-itemgrid-tile` | | | corner radius `--adp-radius-sm` |
| `.adp-itemgrid-tile` in a stacked cell | | | corner radius `--adp-radius-md` |
| `.adp-itemgrid-name` in a stacked cell | at most 2 lines, the rest cut off (the `-webkit-box` line clamp with 2 lines, vertical box orient, overflow hidden); long words wrap anywhere | full width; line height 16 px | text centered; normal white space |
| `.adp-rename` in a stacked cell | does not grow or shrink (flex none) | full width | |
| `.adp-row-check` in a stacked cell | absolutely positioned | 4 px from the top and the left | |
| `.adp-itemgrid-badges` | inline flex; does not shrink | gap 2 px | |
| `.adp-itemgrid-badges` in a stacked cell | absolutely positioned | 4 px from the top and the right | |
| `.adp-itemgrid-text` | flex column; grows (flex 1); may shrink to 0 width | gap 2 px | |
| `.adp-itemgrid-detail` | one line, cut with an ellipsis | | text `--adp-color-text-secondary`; font size `--adp-font-small` |
| `.adp-itemgrid-meta` | flex column; fixed width, no growing or shrinking | width 220 px; gap 2 px | |

**Tests** (`src/__tests__/fileGrid.test.tsx`): copy from `fileList.test.tsx` the mock of `@tanstack/react-virtual`, the `item` helper, the four items (`alpha.txt`, `beta.txt`, `bravo.txt`, `charlie.txt`) and the `renderList` helper; name the helper `renderGrid`, make it render `FileGrid`, and give it a `mode` (default `largeIcons`). jsdom has no layout, so the width falls back to 960: Large icons fit 7 per row, Extra large icons 3 per row.

| Test | Steps | Expected |
|---|---|---|
| "draws every item as an option in a listbox" | render | 4 options with the four names; the listbox has the class `adp-filelist-scroll` |
| "lays items out in rows" | render Large icons; then Extra large icons | 1 element `.adp-itemgrid-row`; then 2 (with 3 and 1 options) |
| "arrow keys move by the grid" | Extra large icons, starting with alpha selected; keys on the listbox: ArrowDown; ArrowRight; ArrowUp; ArrowRight; Shift+ArrowDown | selected charlie; still charlie; alpha; beta; beta, bravo and charlie |
| "clicks select like Details" | click alpha; Ctrl+click bravo; Shift+click charlie | alpha; alpha and bravo; bravo and charlie |
| "group headers start new rows" | groups "Text files" (alpha, beta, bravo) and "Other" (charlie), Large icons | 2 elements `.adp-itemgrid-header` with those labels and the counts 3 and 1; 2 elements `.adp-itemgrid-row` |
| "shows the rename box inside the cell" | `renamingPath` = beta's path | an `.adp-rename-input` inside the element with `data-index` 1 |
| "tiles and content show more details" | mode `tiles`; then mode `content` | an item's text contains the helper's type label; an item's text contains "Date modified:" and "Size:" |
| "check boxes toggle items" | check boxes on; click the `.adp-row-check` of the third option | the selection contains bravo |
| "routes Enter, F2 and the menu key to the Explorer" | select alpha, focus the listbox; Enter; F2; the ContextMenu key | `onCommandKey` with `explorer.open`; with `explorer.rename`; `onContextMenu` with alpha as the item |
| "double-click opens and middle-click opens in the background" | double-click option 0; aux-click option 0 with button 1 | `onOpen` with alpha; `onOpenInBackground` with alpha |

**Traps:**
- The name element must have the class `adp-file-name`: a slow second click on it starts renaming (the hook looks for it).
- jsdom has no `ResizeObserver`: check that it exists before using it.
- Ids and `data-index` use the item's flat index, never the row number.

**Commit:** `feat(views): icon, tiles and content views [step-05a/T6]`

### T7 - List view

**Files:** create `src/views/explorer/views/ListModeView.tsx`, `src/__tests__/listModeView.test.tsx`; modify `src/styles/views.css`.

**Do this (`ListModeView.tsx`):** the default export `ListModeView` takes `ItemViewProps`.

1. `orderItems` and `order` as in FileGrid (groups one after another, in group order). No group headers.
2. Height: a state measured like FileGrid's width, from `clientHeight`. Rows per column = `max(1, floor((height, or FALLBACK_HEIGHT when 0, minus twice GRID_PADDING) / LIST_ITEM_HEIGHT))`. Columns = the item count divided by rows per column, rounded up.
3. Virtualizer: horizontal; one virtual item per column; estimated size `LIST_COLUMN_WIDTH`; overscan 2; padding at the start and at the end `GRID_PADDING`; the scroll element ref.
4. First paint: the same two effects as FileList. Caret on screen: the caret's column (its index divided by rows per column, rounded down), scrolled to with alignment `auto`.
5. Interactions: the hook, with `moveTarget` mapping the same keys as FileGrid to `flowMove(item count, rows per column, page columns, current index, move)`, where page columns = `max(1, floor(scroll element clientWidth (0 when missing) / LIST_COLUMN_WIDTH))`; `elementForIndex` as in FileGrid.
6. Wheel: in an effect, add a native `wheel` listener to the scroll element that is not passive (React's wheel prop cannot stop scrolling); remove it in the cleanup. When Ctrl is held: do nothing (the event goes on to the view switcher). Otherwise, when the vertical delta is larger than the horizontal one: add the vertical delta (times 40 when the delta mode is "lines", 1) to the element's horizontal scroll position, and prevent the default.
7. Markup: root `div` with classes `adp-filelist adp-flowlist`; scroll element `div` with classes `adp-filelist-scroll adp-flowlist-scroll` and the same attributes and handlers as FileGrid's; inside, a `div` with class `adp-flowlist-inner` as wide as the virtualizer's total size; one `div` per virtual column with class `adp-flowlist-column`, `role="presentation"`, placed with a horizontal translate of its start, `LIST_COLUMN_WIDTH` wide, holding the items of that column. Each item is built like FileGrid's inline layout (same attributes, handlers and content), with classes `adp-itemgrid-cell adp-itemgrid-cell--inline adp-flowlist-item` plus the state classes, a 16 px tile and a 12 px icon.

**Do this (`views.css`):** add

| Selector | Layout | Size and spacing |
|---|---|---|
| `.adp-flowlist-scroll` | scrolls sideways (horizontal overflow auto), never vertically (vertical overflow hidden) | |
| `.adp-flowlist-inner` | positioned (relative) | full height |
| `.adp-flowlist-column` | absolutely positioned, 8 px from the top, at left 0; flex column; border-box sizing | padding 8 px on the right |
| `.adp-flowlist-item` | | height 24 px |

**Tests** (`src/__tests__/listModeView.test.tsx`; the same mock and helpers as `fileGrid.test.tsx`; where a test needs 30 items, make `f00.txt` to `f29.txt` in a loop). jsdom has no layout, so the height falls back to 600: 24 items per column.

| Test | Steps | Expected |
|---|---|---|
| "flows items down, then into the next column" | 30 items | 2 elements `.adp-flowlist-column`; 24 options in the first, 6 in the second |
| "Down goes to the next item, Right jumps a column" | 30 items, starting with f00 selected: ArrowDown; ArrowRight; ArrowRight; ArrowLeft; End; Home | f01; f25; f25; f01; f29; f00 |
| "ignores groups but keeps their order" | groups (beta, alpha) and (charlie) | option names in the order beta, alpha, charlie; no `.adp-group-header` |
| "the mouse wheel scrolls sideways, Ctrl+wheel is left alone" | dispatch a cancelable wheel event with vertical delta 120 on the listbox; then the same with Ctrl | the first is default-prevented; the second is not |
| "clicks select and Enter opens" | click the third option; focus the listbox; Enter | it is selected; `onCommandKey` with `explorer.open` |

**Commit:** `feat(views): list view [step-05a/T7]`

### T8 - View commands, menus, folder memory and help pages

**Files:** modify `src/commands/registry.ts`, `src/commands/explorerCommands.ts`, `src/commands/menus.ts`, `src/views/ExplorerHome.tsx`, `src/__tests__/commands.test.ts`, `src/__tests__/addressBar.test.tsx`, `help/en/command-bar.md`, `help/es/command-bar.md`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`); create `src/views/explorer/views/useViewMode.ts`, `src/__tests__/useViewMode.test.tsx`, `help/en/view-modes.md`, `help/es/view-modes.md`.

After this task the View menu changes the view setting and remembers it per folder; the folder still draws in Details until T9 puts the new views on screen.

**Translation keys:** `commands.viewExtraLargeIcons`, `commands.viewTiles`, `commands.viewContent`.

**Do this:**

1. `registry.ts`: `ViewContext` gets `viewMode` (`ViewModeId`) and `hiddenViewModes` (read-only list of `ViewModeId`), with a type import from the settings service.
2. `explorerCommands.ts`:
   - `ExplorerActions` gets `setViewMode`, taking a `ViewModeId` (comment "Step 05a").
   - Export `VIEW_MODE_COMMANDS`, `VIEW_MODE_LABEL_KEYS` and `VIEW_MODE_ICONS`: records from each `ViewModeId` to its command id, label key and lucide icon from the Commands table; and the function `viewModeShortcut` (`mode: ViewModeId`, returns string): `Ctrl+Shift+` followed by the mode's position in `VIEW_MODE_IDS` plus 1.
   - The `viewMode` factory takes only the mode and builds the command: id, label key and icon from the three records; shortcut from `viewModeShortcut`; risk `read-only`; help slug `view-modes`; check kind `radio`; checked when the context's view mode is this mode; enabled when the location is a folder; visible when the context's hidden modes do not include this mode; running it calls `setViewMode` with this mode. No `pending`. Delete the comment about Step 05.
   - Replace the five `viewMode` entries in the list with the commands of all modes of `VIEW_MODE_IDS`, in that order, in the same place.
3. `menus.ts`:
   - `viewMenuFor` (`order`: read-only list of `ViewModeId`, returns `MenuEntry[]`): one command entry per mode in `order` (the mode's command id), then a separator and the four toggles as today.
   - `backgroundMenuFor` and `commandBarFor` (same parameter): today's `BACKGROUND_MENU` and `COMMAND_BAR`, whose "view" menu entries are `viewMenuFor(order)`.
   - Keep the constants, now built from the functions with `VIEW_MODE_IDS`: `VIEW_MENU`, `BACKGROUND_MENU`, `COMMAND_BAR`.
4. `useViewMode.ts`: export the hook `useViewMode`, with one parameter (an object with `view` (`ExplorerViewSettings`), an optional `onViewChange` (takes a partial `ExplorerViewSettings`), and `folderPath` (string or `null`)), returning `ViewModeState`:
   - State: a map from folder key to `ViewModeId`, starting empty.
   - On mount: load with `getFolderViews()` and store `folderViewMap` of the result; ignore errors; a "cancelled" flag set by the cleanup drops a late answer (P-28).
   - On mount: a `window` listener for `FOLDER_VIEWS_CLEARED_EVENT` that empties the map; removed in the cleanup.
   - `visibleModes` = `visibleViewModes(view)`; the folder's mode = the map's entry for `folderViewKey(folderPath)` when there is a folder path; `mode` = `effectiveViewMode(view, folder's mode)`.
   - `setMode` (a mode): nothing when the mode is not in `visibleModes`. When there is a folder path and `remember_view_per_folder` is on: put the mode in a new copy of the map under the folder's key, and call `setFolderView(folderPath, mode)`, ignoring errors. Otherwise call `onViewChange` with `view_mode` = the mode.
   - `zoomStep` (direction): `zoomTarget(mode, direction, visibleModes)`; when it is not `null`, `setMode` it.
5. `ExplorerHome.tsx` (about 15 lines):
   - `DEFAULT_VIEW` becomes `defaultSettings().explorer` (import `defaultSettings`).
   - The type of `VIEW_SETTING`'s values becomes exactly the four boolean field names `details_pane`, `show_hidden`, `show_extensions`, `item_checkboxes` (the old `keyof Omit<...>` form would now include the new non-boolean fields).
   - Right after the line that sets `location` from the history: call `useViewMode` with `view`, `onViewChange` and the folder path (the location's path when it is a folder, else `null`); name the result `viewModeState`; keep it also in a ref `viewModeRef`, assigned on every render (like `live`).
   - In the command context's `view`, add `viewMode` = `viewModeState.mode` and `hiddenViewModes` = `view.hidden_view_modes`.
   - In the `actions` object, after `toggleView`, add `setViewMode`, which calls `setMode` of `viewModeRef.current`. Do not change the `useMemo` dependency list.
   - Before `listProps`: `commandBar` = `commandBarFor(view.view_mode_order)` and `backgroundMenu` = `backgroundMenuFor(view.view_mode_order)`, each in a `useMemo` that depends on `view.view_mode_order`. Use `commandBar` for the `CommandBar`'s entries and `backgroundMenu` instead of `BACKGROUND_MENU` in the context menu; remove `COMMAND_BAR` and `BACKGROUND_MENU` from the import.
6. Test data: in `src/__tests__/commands.test.ts` (`baseCtx`'s `view`) and `src/__tests__/addressBar.test.tsx` (its `view` object), add `viewMode` `details` and `hiddenViewModes` empty.
7. Help pages: create `help/en/view-modes.md` and `help/es/view-modes.md` with the exact text in "Help pages" below, and change `command-bar.md` as described there.

**Tests:**

`src/__tests__/commands.test.ts`:
- Replace the test "keeps not-yet-built commands disabled even with a selection" (it checks the placeholders this step replaces) with "view mode commands are live and follow the settings":
  - For every mode of `VIEW_MODE_IDS`: its command exists, is not pending, has check kind `radio` and help slug `view-modes`.
  - `explorer.viewList` is enabled with `baseCtx`, and disabled with location `home`.
  - With view mode `tiles` in the context: `explorer.viewTiles` is checked and `explorer.viewDetails` is not.
  - With hidden modes `[list]`: `explorer.viewList` is not visible (`isCommandVisible`).
  - Shortcuts: `explorer.viewExtraLargeIcons` Ctrl+Shift+1, `explorer.viewDetails` Ctrl+Shift+6, `explorer.viewContent` Ctrl+Shift+8.
  - Running `explorer.viewContent` calls the `setViewMode` action with `content`.
- New, in the group "menus from commands": "the View menu follows the chosen order": `viewMenuFor` of an order starting `details, list` (then the other six) starts with the command entries `explorer.viewDetails` and `explorer.viewList`; `VIEW_MENU` starts with `explorer.viewExtraLargeIcons`; the "view" menu of `commandBarFor(order)` and the "view" submenu of `backgroundMenuFor(order)` have exactly the entries of `viewMenuFor(order)`.

`src/__tests__/useViewMode.test.tsx` (plain React DOM as in `fileList.test.tsx`; a small probe component calls the hook and stores the result in a variable the test reads; tests are not Tauri, so nothing is stored on disk):

| Test | Steps | Expected |
|---|---|---|
| "uses the default view and remembers a folder's own view" | default settings, folder `C:\A`: set mode `tiles`; render again with folder `C:\B`; again with `c:\a\` | `tiles` and `onViewChange` not called; `details`; `tiles` |
| "changes the default view when folder memory is off" | memory off, folder `C:\A`: set mode `list` | `onViewChange` called with view mode `list` |
| "ignores hidden views and forgets on the cleared event" | hidden `[tiles]`, folder `C:\A`: set mode `tiles`; set mode `content`; dispatch the cleared event on `window` | still `details`; `content`; `details` |
| "zoomStep walks the sizes" | folder `C:\A`: zoom step 1 twice, then -1 | `list`, `smallIcons`, `list` |

**Commit:** `feat(explorer): view commands, menus and folder memory [step-05a/T8]`

### T9 - Show the views, shortcuts, Ctrl+wheel and the status bar buttons

**Files:** create `src/views/explorer/views/ItemView.tsx`, `src/__tests__/itemView.test.tsx`; modify `src/views/ExplorerHome.tsx`, `src/App.tsx`, `src/styles/views.css`.

**Do this (`ItemView.tsx`):** the default export `ItemView` takes `ItemViewProps` plus `mode` (`ViewModeId`) and an optional `onZoomStep` (takes 1 or -1).

1. Take `mode` and `onZoomStep` out of the props and pass the rest unchanged to the view: `details` shows `FileList`; `list` shows `ListModeView` (React key `list`); every other mode shows `FileGrid` with React key = the mode and `mode` = the mode (a new view starts fresh).
2. Everything sits inside a `div` with class `adp-itemview` and a ref.
3. Ctrl+wheel: keep `onZoomStep` in a ref updated on every render. In an effect that runs once, add a native `wheel` listener that is not passive to the root element, and remove it in the cleanup. On each event: when Ctrl is not held, do nothing. Otherwise prevent the default and add the vertical delta (times 40 when the delta mode is 1) to an accumulator kept in a ref. When the accumulator's absolute value reaches `ZOOM_STEP_DELTA`: if at least `ZOOM_STEP_INTERVAL_MS` passed since the last step (time from `Date.now()`), call `onZoomStep` with 1 when the accumulator is negative and -1 when it is positive, and remember the time; in both cases reset the accumulator to 0.

**Do this (`ExplorerHome.tsx`, about 25 lines):**

1. Export the interface `ExplorerViewModeRequest` (Data shapes) next to `ExplorerNavigateRequest`, and add the optional prop `viewModeRequest` (that type or `null`; comment "Status bar view buttons (Step 05a); a new `nonce` runs it again."), defaulting to `null`.
2. `ExplorerStats` gets `viewMode` (`ViewModeId` or `null`; comment "The open folder's view; null when no folder is open."). In the effect that calls `onStatsChange`, add `viewMode` = the current mode when the location is a folder, else `null`, and add the current mode to that effect's dependencies.
3. In the window shortcut effect ("Window-level shortcuts from the registry metadata"), right after the line that defines `ctrl`: when `viewModeFromKey(event)` gives a mode, prevent the default, run the command `VIEW_MODE_COMMANDS[mode]` through `runById`, and stop.
4. Right after that effect, a new effect that depends only on the request's `nonce` (with the same "exhaustive-deps" disable comment as the `navigateRequest` effect): when there is a request, run `VIEW_MODE_COMMANDS[request mode]` through `runById`.
5. In `folderContent`: the folder skeleton's variant comes from `skeletonVariant` of the current mode; the `FileList` element that has `onSort` becomes an `ItemView` with the same props plus `mode` = the current mode and `onZoomStep` = `viewModeState.zoomStep`. The Home list (the `FileList` with `virtual` false) stays as it is.

**Do this (`App.tsx`):**

1. Add the `List` icon to the lucide import; import `viewModeShortcut` from the Explorer commands and the type `ExplorerViewModeRequest`.
2. The initial Explorer stats get `viewMode` `null`.
3. A state `viewModeRequest` (`ExplorerViewModeRequest` or `null`, starting `null`), passed to `ExplorerHome`.
4. In the footer's Explorer part, after the selection text, when the stats' view mode is not `null`: a `span` with class `adp-status-views` holding two `IconButton`s with class `adp-status-view-btn`:

   | Button | Icon | labelKey | pressed | shortcut | On click | Shown |
   |---|---|---|---|---|---|---|
   | Details | `List` | `commands.viewDetails` | stats view mode is `details` | `viewModeShortcut("details")` | set the request to mode `details` with nonce = the previous nonce + 1 (1 when there was none) | always |
   | Large icons | `LayoutGrid` | `commands.viewLargeIcons` | stats view mode is `largeIcons` | `viewModeShortcut("largeIcons")` | the same with `largeIcons` | when the settings' hidden modes do not include `largeIcons` |

**Do this (`views.css`):** add

| Selector | Layout | Size and spacing | Look |
|---|---|---|---|
| `.adp-status-views` | inline flex, items centered; pushed to the right end (left margin auto) | gap 2 px | |
| `.adp-status-view-btn` | | 24 px wide, 20 px tall | |
| `.adp-status-view-btn` when `aria-pressed` is true | | | background `--adp-color-surface-selected-row` |

**Tests** (`src/__tests__/itemView.test.tsx`; the same mock and helpers as `fileGrid.test.tsx`):

| Test | Steps | Expected |
|---|---|---|
| "shows the component for the mode" | modes `details`, `list`, `tiles` | an `.adp-filelist-header` exists; an `.adp-flowlist` exists; an `.adp-itemgrid--tiles` exists |
| "Ctrl+wheel steps the view and never scrolls the page" | with Vitest's fake timers and a fixed system time, on `.adp-itemview` dispatch cancelable wheel events with Ctrl: delta -120; at once delta -120; 200 ms later delta 120; restore real timers at the end | `onZoomStep` called with 1 once (the second event came too soon), then with -1; every event default-prevented |
| "small touchpad steps add up" | two Ctrl wheel events with delta -60 | `onZoomStep` with 1, once |
| "without Ctrl the wheel is left alone" | a wheel event with delta 120, no Ctrl | `onZoomStep` not called; not default-prevented |

**Traps:**
- Never React's wheel prop for these listeners: it is passive, so preventing the default does not work and the page scrolls.
- The shortcuts read the event's `code`. With Shift held, the `key` of the 1 key is a symbol, and a different one on a Spanish keyboard.

**Commit:** `feat(explorer): show the views, view shortcuts and status bar buttons [step-05a/T9]`

### T10 - Settings > Views

**Files:** create `src/views/settings/ViewsSettings.tsx`, `src/__tests__/viewsSettings.test.tsx`; modify `src/views/SettingsView.tsx`, `src/styles/views.css`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** all `settings.views*` keys.

**Do this (`ViewsSettings.tsx`):**

1. Two exported pure helpers:

   | Function | Parameters | Returns | Behavior |
   |---|---|---|---|
   | `moveViewMode` | `order` (read-only list of `ViewModeId`), `mode`, `delta` (-1 or 1) | a new list | a copy of `order` where `mode` swaps places with its neighbour in that direction; an unchanged copy when `mode` is missing or already at that end |
   | `withViewModeHidden` | `explorer` (`ExplorerViewSettings`), `mode`, `hidden` (boolean) | `ExplorerViewSettings` | `details`: `explorer` unchanged. Hiding: a copy with `mode` added to `hidden_view_modes` (when missing) and, when `view_mode` is `mode`, `view_mode` set to `details`. Showing: a copy with `mode` removed from `hidden_view_modes`. |

2. The default export `ViewsSettings` takes `explorer` (`ExplorerViewSettings`), `onChange` (takes `ExplorerViewSettings`) and `onOpenHelp` (takes a slug), and is built like `OpeningFilesSettings`:
   - A `section` with class `adp-settings-section`, labelled by its heading; header `div` with class `adp-view-header` holding an `h3` (id `adp-views-title`, class `adp-heading`, text `settings.views`) and a `HelpButton` that opens `view-modes`.
   - Row (`div` with class `adp-setting-row`): label `settings.viewsDefault` (class `adp-setting-label`), then a native `select` with class `adp-defaultapps-select`, accessible name `settings.viewsDefault`, value = `view_mode`, one option per mode of `visibleViewModes(explorer)` (text from `VIEW_MODE_LABEL_KEYS`). Choosing calls `onChange` with a copy where `view_mode` is the chosen mode.
   - Row: a `Switch` with label `settings.viewsRemember`, checked = `remember_view_per_folder`, changing that field; then a note (`p`, class `adp-note`) `settings.viewsRememberNote`.
   - Row: a `Button` `settings.viewsForget`, disabled while it runs, which calls `clearFolderViews()`; then a note with `role="status"` showing `settings.viewsForgotten`, or on failure the text from `errorText(t, error, "folderViews")`.
   - Row: label `settings.viewsMenu`, note `settings.viewsMenuNote`, then a list (`ul`, class `adp-views-list`) with one item (`li`, class `adp-views-item`) per mode of `view_mode_order`: the mode's icon (`VIEW_MODE_ICONS`, 16 px, hidden from screen readers); a `Switch` with the view's name as label, checked = not hidden, disabled for `details`, whose change calls `onChange` with `withViewModeHidden(explorer, mode, not checked)`; then two buttons with class `adp-icon-btn`, whose accessible name and `title` are `settings.viewsMoveUp` / `settings.viewsMoveDown` with the view's name, holding a 16 px `ChevronUp` / `ChevronDown` icon hidden from screen readers, disabled at the first / last position, calling `onChange` with a copy where `view_mode_order` is `moveViewMode(order, mode, -1 or 1)`.
3. `SettingsView.tsx`: right before the Opening files section, show `ViewsSettings` with the settings' `explorer`, an `onChange` that applies the settings with the new `explorer`, and `onOpenHelp` = `onOpenHelpPage`.
4. `views.css`:

   | Selector | Layout | Size and spacing |
   |---|---|---|
   | `.adp-views-list` | flex column; no list bullets | no margin, no padding; gap `--adp-space-2` |
   | `.adp-views-item` | flex row, items centered vertically | gap `--adp-space-3` |

**Tests** (`src/__tests__/viewsSettings.test.tsx`):

| Test | Steps | Expected |
|---|---|---|
| "moveViewMode swaps a view with its neighbour" | default order: `largeIcons` up; `extraLargeIcons` up; `content` down | starts `largeIcons, extraLargeIcons`; unchanged; unchanged |
| "withViewModeHidden hides a view and resets the default" | view mode `tiles`: hide `tiles`; then show `tiles`; hide `details` | hidden `[tiles]` and view mode `details`; hidden empty; unchanged |
| "lists the views in order and hides one with its switch" | render with the default explorer settings; click the switch named "Tiles" | 8 items `.adp-views-item`; `onChange` got hidden `[tiles]`; the "Details" switch is disabled |
| "moves a view up" | click the button named "Move Large icons up" | `onChange` got an order starting `largeIcons, extraLargeIcons` |
| "changes the default view" | change the select to `list` | `onChange` got view mode `list` |

**Commit:** `feat(settings): Views section [step-05a/T10]`

### T11 - Speed measurements and screenshots

**Files:** modify `scripts/measure-ui.mjs`.

**Do this:**

1. In the record written to the JSON file, the step value `04c` becomes `05a`.
2. In the full measurement mode, right after the measurement named "100k folder: Shift+click range", add three measurements with the script's `measure` helper (name, setup, action, cleanup). Keys are sent with the script's `window.__m.key` helper on `window`, with Ctrl and Shift held, using the `key` and `code` given:

   | Name | Setup | Action | Cleanup |
   |---|---|---|---|
   | `100k folder: switch to Large icons (Ctrl+Shift+2)` | nothing | key `@`, code `Digit2` | key `^`, code `Digit6` |
   | `100k folder: arrow key move in Large icons` | key code `Digit2`; click the first item (`window.__m.rows()` index 0); focus `window.__m.list()` | ArrowRight sent to `window.__m.list()` | key code `Digit6` |
   | `100k folder: switch to List (Ctrl+Shift+5)` | nothing | key `%`, code `Digit5` | key code `Digit6` |

3. In the screenshot part, after the `16-protected-view` shot and its Ctrl+W, add these, each action through the script's `step` helper: Ctrl+Shift with code `Digit2`; click the third item; blur the active element; wait 300 ms; shot `17-large-icons`. Code `Digit7`; shot `18-tiles`. Code `Digit8`; shot `19-content`. Code `Digit5`; shot `20-list`. Click `window.__m.menuButton(2)` (the View menu); wait 200 ms; shot `21-view-menu`; close the menus. Code `Digit6` (back to Details).

**Tests:** none (the script runs in AGENTS.md section 4, C.3 and C.4).

**Commit:** `test(speed): view mode measurements and screenshots [step-05a/T11]`

## Help pages

### New page `help/en/view-modes.md` (exact text)

```markdown
# Views: icons, list, details, tiles and content

Choose how a folder shows its files: as big icons, a compact list, a table with details, or tiles. Every view selects, opens, renames and drags files the same way.

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
- Hold **Ctrl** and turn the mouse wheel over the files: up makes the icons bigger, down makes them smaller.
- The two buttons at the right end of the status bar switch between **Details** and **Large icons**.

## What each view shows

- **Extra large icons**, **Large icons**, **Medium icons**: a grid of icons with the name underneath. Long names show on two lines; point at a name to see all of it.
- **Small icons**: small icons with the name beside them, in rows.
- **List**: small icons in columns. The list scrolls sideways, also with the mouse wheel.
- **Details**: one row per item with its date, type and size. Click a column title to sort.
- **Tiles**: a medium icon with the name, type and size.
- **Content**: one wide row per item with its type, date modified and size.

For now the icons show the type of each file. Previews of pictures, videos and documents arrive in a later version.

## Each folder remembers its view

- When you choose a view, the open folder keeps it: the next time you open that folder, it opens in the same view. Folders you haven't changed use the default view.
- To use one view everywhere, open **Settings** > **Views** and turn off **Remember each folder's view**. Then choosing a view changes it for all folders.
- **Forget folder views**, in the same place, makes every folder use the default view again.

## Choose the views in the View menu

In **Settings** > **Views**:

- **Default view** is the view of every folder that doesn't have its own.
- Turn a view off to hide it from the **View** menu. Its shortcut stops working too. **Details** is always shown.
- Use the up and down arrows to change the order of the views in the menu.

## With the keyboard

- The arrow keys follow the layout: in the icon views, left and right go to the previous and next item, up and down go to the item above or below. In **List**, left and right jump to the next column.
- Everything else works as in **Details**: **Shift** extends the selection, **Ctrl+A** selects everything, typing a name jumps to it, **F2** renames, **Enter** opens.

## Good to know

- Sorting and grouping work in every view. Groups show as headings in the icon views, **Tiles** and **Content**; **List** keeps the same order without headings.
- Views only change how files look. Choosing a view never changes your files.

See also: "Selecting files", "The command bar" and "Browsing folders".
```

### New page `help/es/view-modes.md` (exact text)

```markdown
# Vistas: iconos, lista, detalles, mosaicos y contenido

Elige cómo muestra una carpeta sus archivos: como iconos grandes, una lista compacta, una tabla con detalles o mosaicos. En todas las vistas los archivos se seleccionan, se abren, se cambian de nombre y se arrastran de la misma forma.

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
- Mantén presionada la tecla **Ctrl** y gira la rueda del mouse sobre los archivos: hacia arriba los iconos se agrandan y hacia abajo se achican.
- Los dos botones del extremo derecho de la barra de estado cambian entre **Detalles** e **Iconos grandes**.

## Qué muestra cada vista

- **Iconos muy grandes**, **Iconos grandes**, **Iconos medianos**: una cuadrícula de iconos con el nombre debajo. Los nombres largos ocupan dos líneas; apunta a un nombre para verlo completo.
- **Iconos pequeños**: iconos pequeños con el nombre al lado, en filas.
- **Lista**: iconos pequeños en columnas. La lista se desplaza hacia los lados, también con la rueda del mouse.
- **Detalles**: una fila por elemento con su fecha, tipo y tamaño. Haz clic en el título de una columna para ordenar.
- **Mosaicos**: un icono mediano con el nombre, el tipo y el tamaño.
- **Contenido**: una fila ancha por elemento con su tipo, fecha de modificación y tamaño.

Por ahora los iconos muestran el tipo de cada archivo. Las vistas previas de imágenes, videos y documentos llegan en una próxima versión.

## Cada carpeta recuerda su vista

- Cuando eliges una vista, la carpeta abierta la conserva: la próxima vez que abras esa carpeta, se abrirá con la misma vista. Las carpetas que no cambiaste usan la vista predeterminada.
- Para usar una sola vista en todas partes, abre **Configuración** > **Vistas** y desactiva **Recordar la vista de cada carpeta**. Así, elegir una vista la cambia en todas las carpetas.
- **Olvidar las vistas de carpetas**, en el mismo lugar, hace que todas las carpetas vuelvan a usar la vista predeterminada.

## Elegir las vistas del menú Ver

En **Configuración** > **Vistas**:

- **Vista predeterminada** es la vista de todas las carpetas que no tienen una propia.
- Desactiva una vista para ocultarla del menú **Ver**. Su atajo también deja de funcionar. **Detalles** siempre se muestra.
- Usa las flechas hacia arriba y hacia abajo para cambiar el orden de las vistas en el menú.

## Con el teclado

- Las teclas de flecha siguen la disposición: en las vistas de iconos, izquierda y derecha van al elemento anterior y al siguiente, y arriba y abajo van al elemento de arriba o de abajo. En **Lista**, izquierda y derecha saltan a la columna siguiente.
- Todo lo demás funciona como en **Detalles**: **Mayús** amplía la selección, **Ctrl+A** selecciona todo, escribir un nombre salta a él, **F2** cambia el nombre y **Entrar** abre.

## Para tener en cuenta

- Ordenar y agrupar funcionan en todas las vistas. Los grupos se muestran como títulos en las vistas de iconos, **Mosaicos** y **Contenido**; **Lista** mantiene el mismo orden, sin títulos.
- Las vistas solo cambian cómo se ven los archivos. Elegir una vista nunca cambia tus archivos.

Consulta también: «Seleccionar archivos», «La barra de comandos» y «Explorar carpetas».
```

### Changes to `command-bar.md`

- `help/en/command-bar.md`: replace the whole **View** bullet with this line: "- **View**: choose how the folder shows its items (**Extra large icons**, **Large icons**, **Medium icons**, **Small icons**, **List**, **Details**, **Tiles**, **Content**; see "Views"), and show or hide the **Details pane**, **Hidden items**, **File name extensions**, and **Item check boxes**. These choices are saved." Delete the section "## Coming in later versions" with its paragraph (everything it lists exists now), and end the page with this line: "See also: "Views: icons, list, details, tiles and content" and "Selecting files"."
- `help/es/command-bar.md`: replace the whole **Ver** bullet with this line: "- **Ver**: elige cómo muestra la carpeta sus elementos (**Iconos muy grandes**, **Iconos grandes**, **Iconos medianos**, **Iconos pequeños**, **Lista**, **Detalles**, **Mosaicos**, **Contenido**; consulta «Vistas»), y muestra u oculta el **Panel de detalles**, los **Elementos ocultos**, las **Extensiones de nombre de archivo** y las **Casillas de elementos**. Estas opciones se guardan." Delete the section "## Lo que llega en próximas versiones" with its paragraph, and end the page with this line: "Consulta también: «Vistas: iconos, lista, detalles, mosaicos y contenido» y «Seleccionar archivos»."

## Check by hand (the owner, in the packaged app)

Before telling the owner, create this test folder and give the owner its path. All files are plain text unless the table says otherwise.

| Path (inside `%TEMP%\adp-05a`) | Content |
|---|---|
| `Folder A\` | a folder holding `page 1.md` to `page 5.md`, each with the text `# Page <n>` |
| `Folder B\` | an empty folder |
| `note 01.txt` to `note 40.txt` | the text `note <n>` |
| `picture.png` | a copy of `docs\screenshots\step-01a\06-first-run-en-light.png` |
| `a very long file name that will not fit on two lines under a large icon.txt` | the text `long` |

The 100,000-item folder comes from `.\scripts\generate-corpus.ps1` (already used by the speed measurements).

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

## Speed

| Interaction | Tier | How measured |
|---|---|---|
| Switch to Large icons in the 100,000-item folder | Fast (1 s) | `100k folder: switch to Large icons (Ctrl+Shift+2)` |
| Arrow key move in Large icons, 100,000 items | Instant (0.1 s) | `100k folder: arrow key move in Large icons` |
| Switch to List in the 100,000-item folder | Fast (1 s) | `100k folder: switch to List (Ctrl+Shift+5)` |
| Scrolling Large icons, 100,000 items | Smooth | by hand (check 12) |
| Every existing measurement | as before | not more than 20% slower than step 04c's JSON |

## Screenshots

`17-large-icons`, `18-tiles`, `19-content`, `20-list`, `21-view-menu` (added in T11), in English light, Spanish dark and the pseudo-locale, in `docs/screenshots/step-05a/`.

## Done when

- [ ] T1 to T11 are committed, each after `GATE PASSED`.
- [ ] `fileList.test.tsx` and `explorerHome.test.tsx` are unchanged and pass (T5 moved code without changing behavior).
- [ ] All 8 views work with the mouse, the keyboard, check boxes, rename, right-click and drag and drop.
- [ ] Ctrl+Shift+1 to 8 and Ctrl+wheel switch views; the page never zooms.
- [ ] Folder views are remembered after a restart, can be turned off, and can be forgotten.
- [ ] Settings > Views hides, orders and sets the default view; Details cannot be hidden.
- [ ] The status bar buttons work.
- [ ] Settings schema 6 loads a schema-5 file without losing anything (Rust test `settings_v5_migrates_to_v6_keeping_language_and_theme`).
- [ ] The speed table rows meet their tiers; the screenshots exist; the step report is written.
