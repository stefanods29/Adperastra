# Step 06f report - Tables (CSV), JSON, fonts, hex search

Dates: 2026-10-31. Status: built on local branch `step-06f-data-viewers`; **not** merged, tagged or pushed. The full gate, the release build, speed, screenshots and the owner's checks are still to come (coordinator).

## How to try it

```powershell
.\scripts\gate.ps1 -Package
.\build\Adperastra\Adperastra.exe
```

## Owner checklist

Still to do (the coordinator runs the hand checks later). The list is the step file's:

1. `people.csv`: a table with the headers and 4 rows. Click **age**: 9, 31, 100, then the empty cell last; click again: 100, 31, 9, empty last; again: file order.
2. Ctrl+F, type `lima`: one row and "1 of 4" in the status bar. Clear it.
3. **First row is headers** off: the first row joins the table and columns get numbers. Reopen the app: the choice is kept.
4. `semi.csv` shows two columns. `empty.csv` says it has no rows and offers **Open as text**.
5. `big.csv`: first view fast; scrolling smooth to the end; sorting shows words if it takes over a second.
6. **Open as text** opens `people.csv` in the editor and the table tab stays open.
7. `data.json`: a tree; Right/Left open and close; Ctrl+F `ok`, Enter opens `nested` to it; select `name`'s value, Ctrl+C, paste elsewhere: `Ana`.
8. `bad.json`: says line 1 and the column with **Open as text**. `long.json`: **Show more** adds the next 1,000.
9. A font from `C:\Windows\Fonts`: six sample sizes, details and a character map; type your name in **Sample text**; select a character and paste it elsewhere.
10. On the font, **Install** then **Cancel** does nothing.
11. `sample.bin` > **Open as** > **Open as hex**; Ctrl+F `FINDME`, Enter: moves to part 3, highlights across the row and shows the offset; Shift+F3 wraps and finds it again.
12. **Search as bytes**, `46 49 4E`: found; `4`: the pairs message.
13. Ctrl+G, `0x10`: goes there. `ZZ`: the message and the window stays open.
14. Repeat 1, 7, 9 and 11 in Spanish and in the dark theme; everything reachable by keyboard, focus visible.

## What works

- CSV and TSV files open as a read-only table: sorting on any column (ascending, descending, back to file order), filter while typing (200 ms pause), first row as headers (on by default unless the first row is all numbers), a sticky header and row-number column, keyboard scrolling, a truncated note, an empty state and a no-matches state.
- Parsing, sorting and filtering run in a new pure Rust crate (`crates/data-views`); the page asks Rust for pages of at most 500 rows, so a 100,000-row file never crosses IPC whole. Tables are limited to 128 MiB, 2,000,000 rows, 2,000 columns and 20,000,000 cells; one page carries at most 500 rows and each cell at most 2,000 characters.
- Text decoding is shared (UTF-8 BOM, UTF-16 LE/BE, valid UTF-8, otherwise Windows-1252) and the delimiter is detected (`.tsv` always tab).
- JSON files open as a foldable tree: root open, pages of 1,000 children with **Show more**, 300-character string previews, search over keys and values (Ctrl+F, Enter/F3, wrapping once), Ctrl+C copies a value (up to 1 MiB), line and column on invalid JSON with **Open as text**, and limits (32 MiB, 5,000,000 nodes, depth 128).
- Font files open as a sample sheet: the browser's own `FontFace` loads the bytes from the `adpfile` URL, six sample sizes with editable sample text kept in the tab state, details from a separate helper process, a virtual character map with copy, and **Install** through Windows' `install` verb after a dialog. WOFF/WOFF2 show the sheet but no map.
- The hex viewer searches the whole file (text as UTF-8 or pairs of hex digits, A-Z ignore case unless Match case), in 1 MiB range reads with overlap, wrapping once; matches are highlighted across the hex and text columns, and **Ctrl+G** goes to an offset (hex by default, decimal after `#`). A failing search has its own message and does not set the view's error (KI-080 untouched).
- **Open as text** on the table, JSON and font viewers through the new optional `onOpenAsText`; helper/session command contracts unchanged.
- New help pages: viewing tables, viewing JSON, viewing fonts (both languages); "Open as text or hex" now describes hex search and Go to offset.

## Not in this step (on purpose)

- No editing in the table or tree (Open as text for that); no column resizing, reordering, hiding, typed columns, charts or formulas (21a/21b).
- No thumbnails or quick preview (07a, 07b); no JSON editing, schema checks or JSON path queries; `.jsonc`, `.json5`, `.ipynb` stay in the text viewer.
- No font subsetting, comparison or uninstalling; no character map for WOFF/WOFF2; no settings changes (schema stays 11).
- KI-068, KI-069, KI-079 and KI-080 are not repaired (owner's existing-error policy).

## Decisions and plan changes made during the step

- No `docs(plan)` correction was needed: the guide's "See also" titles match the real help titles. One guide trap remains unverified by design: the T4 trap asks to run the invalid-JSON test and correct the expected column if serde_json reports another one. Tests are not run in this batch, so the guide's column 8 is kept as written; the coordinator should check `invalid_reports_the_place` when the suite runs.
- The `deps:` commit also carries the minimal `crates/data-views` manifest and an empty `lib.rs`, because a workspace member cannot be added without its manifest; the code follows in the `feat:` commit.
- Implementation choices written down where the guide left a detail open: `findInFile` uses `searchBytes` for the chunk scans; JSON pages are stored per page index so a large array can load the page that holds a match and the rows before it; the JSON root is always open; the hex `foundAt` offset is padded like the offset column; encoding names in status bars reuse the text viewer's technical labels; the table's 200-row page cache is capped at 20 pages.
- `crates/data-views` is not listed in `plan/libraries.md` (it is our own crate); the two new external libraries are recorded there in `docs/dependency-and-license-table.md` and `THIRD_PARTY_LICENSES.md`.

## Speed (development PC, packaged release build)

Not measured in this batch (the owner's rules replace the per-task gate; T12 only edits the script and does not run it).

| Interaction | Tier | Measured (median) | Result |
|---|---|---|---|
| Open a 100,000-row CSV | Fast (1 s) | pending | pending |
| Sort a 100,000-row CSV | Waiting with feedback (10 s) | pending | pending |
| Scrolling a table | Smooth | pending (by hand, check 5) | pending |
| Open a JSON file | Fast (1 s) | pending | pending |
| Open a font | Fast (1 s) | pending | pending |
| Hex search through 3 MB | Fast (1 s) | pending | pending |
| Every existing measurement | as before | pending (not more than 20% slower than the previous JSON) | pending |

## Checks by hand

The owner or the coordinator fills this table later.

| Check | English light | Spanish dark | Result |
|---|---|---|---|
| Table, sort, filter, headers (1-4) | waiting | waiting | pending |
| 100,000-row table and sort (5) | waiting | waiting | pending |
| Open as text (6) | waiting | waiting | pending |
| JSON tree, search, copy, invalid file (7-8) | waiting | waiting | pending |
| Font sheet, details, map, Install cancel (9-10) | waiting | waiting | pending |
| Hex search, bytes mode, wrap (11-12) | waiting | waiting | pending |
| Go to offset (13) | waiting | waiting | pending |
| Keyboard and focus (14) | waiting | waiting | pending |

## Verification

Per the owner's batch rules, no test run and no `scripts/gate.ps1` were performed. After each task that changed Rust code: `cargo fmt --all` and `cargo clippy --workspace --all-targets -- -D warnings` (passed). After every task: `npm run lint:i18n`, `npm run lint:ipc`, `npm run build` (passed). Last run of the checks:

- `npm run lint:i18n`: passed (981 keys, 43 help pages, 121 tsx files).
- `npm run lint:ipc`: passed (97 commands, 95 invoke calls checked).
- `npm run build` (`tsc --noEmit && vite build`): passed.
- `cargo clippy --workspace --all-targets -- -D warnings`: passed (last Rust change: T7).
- `node --check scripts/measure-ui.mjs`: passed.

New tests written (not run here):

- Rust, `crates/data-views/tests/step06f_decode_tests.rs`: `utf8_with_and_without_mark`, `utf16_both_orders`, `invalid_utf8_falls_back`, `odd_utf16_tail_is_replaced`.
- `step06f_table_tests.rs`: `delimiters_are_detected`, `quoted_delimiters_do_not_count`, `tsv_extension_wins`, `quotes_and_line_breaks_stay_in_a_cell`, `short_rows_read_empty`, `row_limit_truncates`, `cancel_stops_the_parse`, `header_detection`.
- `step06f_table_view_tests.rs`: `numbers_sort_as_numbers`, `empty_is_last_both_ways`, `text_ignores_case_and_ties_keep_file_order`, `header_stays_out`, `filter_matches_any_cell_without_case`, `no_header_keeps_row_zero`, `cells_are_cut`, `page_is_capped`, `cancel_stops_the_view`.
- `step06f_json_tests.rs`: `order_and_duplicates_stay`, `kinds_and_previews`, `invalid_reports_the_place`, `comments_are_invalid`, `trailing_text_is_invalid`, `too_deep_is_refused`, `pages_and_counts`, `long_strings_are_cut`, `find_walks_and_wraps`, `find_can_require_case`, `copy_is_bounded`, `copy_prints_pretty_json`.
- Rust, `src-tauri/src/data_views.rs`: `sessions_evict_the_oldest`, `total_bytes_evict_too`, `old_view_is_refused`, `bad_ids_and_paths_are_refused`.
- Rust, `src-tauri/src/font_helper.rs`: `merges_runs_and_drops_controls`, `reads_names_and_ranges`, `garbage_is_refused`, `woff_gives_no_names`, `old_helper_message_shape`, `install_refuses_other_types`.
- UI, `dataServices.test.ts`: "table services use job prefixes", "invalid JSON splits line and column", "close ignores errors".
- `tableView.test.tsx`: "shows headers and rows", "clicking a header sorts, then reverses, then clears", "typing filters after a pause and cancels the older view", "turning headers off asks for a new view", "an old view's rows are ignored", "an empty file offers Open as text", "a truncated file says so", "closes the session when the tab closes", "Open as text calls the prop".
- `fontCharMap.test.ts`: "codePointAt walks the ranges", "formatCodePoint pads to four digits", "charMapRows divides the cells".
- `fontView.test.tsx`: "draws the six sample sizes", "shows names from the details", "a WOFF font says there is no map", "Install asks first, and Cancel does nothing", "Install is disabled in protected view", "removes the font on close", "a bad font shows the error".
- `jsonTree.test.ts`: "closed containers hide children", "partly loaded containers get a more row", "depth follows nesting".
- `jsonView.test.tsx`: "root opens with its children", "Right opens and Left closes", "Show more loads the next page", "find expands to the match", "invalid JSON shows the place and Open as text", "Ctrl+C copies the selected value", "closes the session when the tab closes".
- `hexSearch.test.ts`: `searchBytes` forward/backward, `searchBytes` fold, `parseHexPattern`, `encodeTextPattern`, `parseOffset`, `offsetLocation`, `hexCharRange`, `findInFile` (across chunks, wrap, absent, aborted, backwards).
- `hexFind.test.tsx`: "Enter finds and shows the offset", "a match in a later part moves there", "bad bytes say so without reading", "a read failure doesn't show the view's error", "Ctrl+G goes to the offset", "a bad offset keeps the window open", "going inactive cancels the search".
- Updated: `defaultApps.test.tsx` (8 groups), `handlers.test.ts` (ties and size fallback for CSV and JSON).

## Screenshots

Pending: `52-table`, `53-table-sorted`, `54-json-tree`, `55-font`, `56-hex-search` in English light, Spanish dark and the pseudo-locale, in `docs/screenshots/step-06f/` (T12 adds them to `scripts/measure-ui.mjs`; the script was not run here).

## Known issues

- New: KI-086 (Minor) - JSON numbers beyond 64 bits show rounded in the tree (target: reviewed at the next milestone).
- Fixed: KI-032 (hex viewer search and Go to offset).
- Still open and untouched: KI-068, KI-069, KI-079, KI-080, KI-081, KI-082, KI-030, KI-033, KI-070, KI-075.

## Design deviations, dependencies, licenses

- `DESIGN_DEVIATIONS.md`: none.
- New dependencies: **csv** 1.4 with **csv-core** 0.1 (Unlicense OR MIT), **ttf-parser** 0.25 (MIT OR Apache-2.0, default features off, `std`), both recorded in `THIRD_PARTY_LICENSES.md` and `docs/dependency-and-license-table.md`.
- Small deviations from the guide's wording: the JSON row keys and the "more" rows are internal details; the table's filter shows while typing and applies after 200 ms; the hex found offset is padded to the offset column width; details like these are listed under "Decisions" above.

## Commits

```
5d6ec26 test(speed): tables, JSON, fonts and hex search measurements and screenshots [step-06f/T12]
612bda2 docs(help): tables, JSON, fonts and hex search [step-06f/T11]
d6b15c2 feat(viewer): hex search and Go to offset [step-06f/T10]
66e0d59 feat(viewer): JSON tree with search and copy [step-06f/T9]
59eb9f1 feat(viewer): font preview, character map and install [step-06f/T8]
1407544 feat(font): read font details in a helper process [step-06f/T7]
df48088 feat(viewer): CSV and TSV tables with sort and filter [step-06f/T6]
fee1f76 feat(data): table and JSON sessions and commands [step-06f/T5]
5c8584f feat(data): parse JSON into a navigable tree [step-06f/T4]
91d8a67 feat(data): sort and filter table rows [step-06f/T3]
330cb31 feat(data): parse CSV and TSV into a compact table [step-06f/T2]
6361dc1 feat(data): data views crate and text decoding [step-06f/T1]
6e0ffe3 deps: add csv 1.4 (Unlicense OR MIT) and ttf-parser 0.25 (MIT OR Apache-2.0) [step-06f/T1]
d30de79 docs(plan): guide for step 06f [step-06f/guide]
```

## Next step

Step 07a: Thumbnails, cache store, helper process, background work v1 (outline in `plan/STATUS.md`; its guide comes first).
