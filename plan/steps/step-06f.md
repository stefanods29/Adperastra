# Step 06f: Tables (CSV), JSON, fonts, hex search

| | |
|---|---|
| State | guide |
| Difficulty | ★★ |
| Branch | `step-06f-data-viewers` |
| Tag | `v0.0.19-step06f` |
| Depends on | 06e |

This is a **guide** step (AGENTS.md "Steps come in two kinds"): every decision is below, but no code. Write the code exactly as described: the names, files, types, numbers and texts given here, and nothing else. When something here does not match the code, follow golden rule 4 and correct this file in its own `docs(plan)` commit.

## Goal

Double-clicking a `.csv` or `.tsv` file opens a read-only table that scrolls smoothly through a million rows, sorts by any column and filters as you search. A `.json` file opens as a tree you can fold, search and copy from. A font file (`.ttf`, `.otf`, `.ttc`, `.woff`, `.woff2`) opens as a sample sheet with a character map and an Install button. The hex viewer finds text or bytes anywhere in the file, and Ctrl+G goes to an offset.

## Do not do in this step

- No editing in the table or tree. To edit, the ribbon's **Open as text** opens the same file in the text editor (Step 06a).
- No column resizing, reordering or hiding, no typed columns, charts or formulas. Excel-style work is Steps 21a and 21b.
- No thumbnails or quick preview for these types (Steps 07a, 07b).
- No JSON editing, schema checks or JSON path queries. `.jsonc`, `.json5` and `.ipynb` stay in the text viewer (notebooks: Step 07f).
- No font subsetting, comparison or uninstalling. No character map for `.woff` and `.woff2`, because reading them needs decompression this step doesn't add. The sample sheet still works for them.
- Do not repair KI-080 (the hex view stays on its error), KI-068, KI-069 or KI-079. The owner decides when (`plan/STATUS.md`).
- No settings changes: the settings schema stays at 11.

## Read first

- `plan/conventions.md`, `plan/pitfalls.md` (P-01, P-10, P-11, P-28), `plan/rules.md` R-SEC-1, R-SEC-2, R-SEC-6, R-SEC-8, R-SEC-9, R-UI-2, R-UI-5, R-LANG-1, R-LANG-7, R-SPEED, `plan/recipes/add-dependency.md`, `plan/recipes/add-help-page.md`, `plan/recipes/add-tauri-command.md` if it exists, `plan/ui-kit.md`, `plan/glossary.md`.
- Code: `src/handlers/types.ts`, `index.ts`, `registry.ts`, `src/handlers/hex/` (all), `src/handlers/archive/useArchiveSession.ts` (job and stale-answer pattern), `src/views/FileTabView.tsx`, `src/App.tsx` (`openFileWith`), `src/services/jobs.ts`, `src/services/errors.ts`.
- Rust: `src-tauri/src/jobs.rs`, `src-tauri/src/helper.rs`, `src-tauri/src/archive.rs` (`archive_open_start`, `ArchiveSessions`, `run_helper_job`), `src-tauri/src/archive_helper.rs`, `src-tauri/src/shell.rs` (`shell_execute_default`), `src-tauri/src/main.rs` (helper flags and `generate_handler!`), `src-tauri/isolation/index.html`.

## Decisions (already made)

- D1. **Handlers.** Three new handlers: `table`, `json` and `font`. `table` and `json` register **before** `text` in `createHandlerRegistry`, because ties go to the handler registered first. Text keeps its extension list unchanged, so a file over the new handler's `maxBytes` still falls back to the text viewer, which opens big files in parts.
- D2. **Parsing lives in Rust; the UI asks for pages.** A million rows never cross IPC (P-10). New crate `crates/data-views` holds pure table and JSON logic. `src-tauri/src/data_views.rs` holds the sessions and commands. `@tanstack/react-table` from the old library list is **not** adopted: it sorts in the browser, which is what this design avoids.
- D3. **Table limits.** File at most 128 MiB (`maxBytes`), at most 2,000,000 rows, 2,000 columns and 20,000,000 cells. Reaching a row or cell limit stops reading and shows a note (`truncated`), and nothing is hidden silently. A row wider than 2,000 columns keeps its first 2,000 and sets `truncated`. One page answer carries at most 500 rows, and each cell at most 2,000 characters, with `…` added when cut.
- D4. **Text decoding (one shared function).** Byte-order mark for UTF-8, UTF-16 LE or UTF-16 BE first, then valid UTF-8, otherwise Windows-1252. Invalid UTF-16 becomes the replacement character.
- D5. **Delimiter.** `.tsv` is always tab. Otherwise, score `,`, `;`, tab and `|` on the first 64 KiB, as described in T2. Files with no clear winner use `,`. Rows may have different lengths: short rows show empty cells.
- D6. **Header row.** On by default unless every cell of the first row is a number. The ribbon toggle **First row is headers** changes it and is kept in the tab's saved state. Without headers the columns are named by number (`table.columnNumber`).
- D7. **Sort and filter are one job.** `table_view_start` builds the row order from the column, direction, header choice and filter text, off the UI thread and cancellable. Sorting: empty cells last in both directions, numbers before text and compared as numbers, text compared without case, and ties keep file order (stable). Filter: case-insensitive "contains" on any cell. The header row is never filtered or sorted away.
- D8. **JSON limits.** File at most 32 MiB (`maxBytes`), at most 5,000,000 nodes, depth at most 128 (serde_json's default limit, reported as `data.too_deep`). Key order and duplicate keys are kept. Comments and trailing commas are errors with line and column, and the view offers **Open as text**. Numbers are shown as parsed, so an integer beyond 64 bits or a very long decimal can show rounded: the help page says so, and a Minor known issue records it.
- D9. **JSON tree.** The root opens expanded. Children load on demand in pages of 1,000, with a **Show more** row. Strings preview at most 300 characters. Copy gives at most 1 MiB.
- D10. **Fonts.** The UI fetches the bytes from the existing `adpfile` URL and loads them with the browser's `FontFace`, whose font checks refuse bad files. Names and the character map come from a helper process (R-SEC-9): `Adperastra.exe --font-helper`, 256 MiB job limit, file at most 64 MiB (`maxBytes`). A `.ttc` shows its first face and says how many it holds.
- D11. **Install** is the user's explicit click, after a dialog saying that it can't be undone from this app. It uses Windows' own `install` verb through `ShellExecuteExW` with no command line (R-SEC-6, R-SEC-7). Only for `.ttf`, `.otf` and `.ttc`, and not while protected view is on. The app never writes into a fonts folder itself.
- D12. **Hex search** runs in the UI as async range reads of 1 MiB chunks, with the needle's length minus one byte of overlap, so a match across two chunks is found. It starts only on Enter, F3 or Shift+F3 (a search `request`), wraps around once, and is cancelled by new text, a new request, the tab going inactive or closing. Patterns are at most 1,024 bytes. **Text** mode encodes UTF-8, and A to Z ignore case unless Match case is on. **Bytes** mode reads hex pairs.
- D13. **Go to offset** is hexadecimal by default: `1F` and `0x1F` are hex, `#31` is decimal.
- D14. **KI-080 stays.** New hex code does not set or clear `failed`, and search failures use their own status text.
- D15. **Open as text** needs a new optional `HandlerViewProps.onOpenAsText`, passed through `FileTabView` from App's existing `openFileWith(path, "text")`.

## Data shapes

### Rust: `crates/data-views`

| Item | File | Fields or signature | Notes |
|---|---|---|---|
| Constants | `limits.rs` | `MAX_TABLE_FILE` 134,217,728; `MAX_TABLE_ROWS` 2,000,000; `MAX_TABLE_COLUMNS` 2,000; `MAX_TABLE_CELLS` 20,000,000; `MAX_PAGE_ROWS` 500; `MAX_CELL_CHARS` 2,000; `MAX_JSON_FILE` 33,554,432; `MAX_JSON_NODES` 5,000,000; `MAX_JSON_PAGE` 1,000; `MAX_JSON_PREVIEW` 300; `MAX_JSON_COPY` 1,048,576; `MAX_SEARCH_CHARS` 200 | Public |
| `DataError` | `error.rs` | `TooLarge`, `TooDeep`, `Invalid { line: u64, column: u64 }`, `Cancelled`, `Io` | `code()` gives `data.too_large`, `data.too_deep`, `data.invalid`, `data.cancelled`, `data.read_failed` |
| `decode_text` | `decode.rs` | `bytes: &[u8]` returns `(String, TextEncodingId)` | D4 |
| `TextEncodingId` | `decode.rs` | `Utf8`, `Utf16Le`, `Utf16Be`, `Windows1252`; serde snake_case | |
| `detect_delimiter` | `table.rs` | `text: &str`, `extension: &str` returns `u8` | D5 |
| `Table` | `table.rs` | private storage plus `rows()`, `columns()`, `truncated()`, `cell(row, column) -> &str` | One text buffer and cell end offsets |
| `parse_table` | `table.rs` | `text: &str`, `delimiter: u8`, `token: &CancellationToken` returns `Result<Table, DataError>` | Calls `parse_table_with_limits` with the constants |
| `parse_table_with_limits` | `table.rs` | the same plus `limits: TableLimits` | Public, so tests can use small limits |
| `TableLimits` | `table.rs` | `rows: usize`, `columns: usize`, `cells: usize` | `Default` gives the constants |
| `first_row_is_header` | `table.rs` | `table: &Table` returns `bool` | D6 |
| `SortDirection` | `table_view.rs` | `Ascending`, `Descending`; serde snake_case | |
| `TableViewRequest` | `table_view.rs` | `sort_column: Option<u32>`, `direction: SortDirection`, `has_header: bool`, `filter: String` | |
| `build_order` | `table_view.rs` | `table`, `request`, `token` returns `Result<Vec<u32>, DataError>` | D7, row indexes excluding the header |
| `compare_cells` | `table_view.rs` | `a: &str`, `b: &str`, `direction` returns `Ordering` | D7, used with a stable sort |
| `page_rows` | `table_view.rs` | `table`, `order`, `start: usize`, `count: usize` returns `Vec<Vec<String>>` | Cut per D3 |
| `JsonDoc` | `json.rs` | arena of nodes, `root()` | |
| `parse_json` | `json.rs` | `text: &str` returns `Result<JsonDoc, DataError>` | A custom serde visitor, so order and duplicates stay |
| `JsonKind` | `json.rs` | `Object`, `Array`, `String`, `Number`, `Bool`, `Null`; serde snake_case | |
| `JsonNodeInfo` | `json.rs` | `id: u32`, `key: Option<String>`, `index: Option<u32>`, `kind: JsonKind`, `preview: String`, `preview_cut: bool`, `child_count: u32` | snake_case to the UI |
| `children` | `json.rs` | `doc`, `id`, `start`, `count` returns `Vec<JsonNodeInfo>` | |
| `find_next` | `json.rs` | `doc`, `text`, `case_sensitive: bool`, `after: Option<u32>`, `backwards: bool` returns `Option<JsonMatch>` | Document order, wraps once |
| `JsonMatch` | `json.rs` | `id: u32`, `ancestors: Vec<u32>` (root first) | |
| `copy_text` | `json.rs` | `doc`, `id` returns `Result<String, DataError>` | A string's own text; others as pretty JSON; over `MAX_JSON_COPY` gives `TooLarge` |

### Tauri commands (`src-tauri/src/data_views.rs` and `font_view.rs`)

Every command starts with `ensure_main`, validates paths with `validate_absolute_path`, validates request ids with `valid_request_id`, and maps those failures to the `bad_request` code of its area. Text arguments over `MAX_SEARCH_CHARS` characters give `bad_request`. Add each to `generate_handler!` and `ALLOWED`.

| Command | Arguments | Returns | Error codes |
|---|---|---|---|
| `table_open_start` | `request_id`, `path` | `()`; job result `TableSummary` | `table.bad_request`; job: `data.too_large`, `data.read_failed`, `data.cancelled` |
| `table_view_start` | `request_id`, `session`, `request: TableViewRequest` | `()`; job result `TableViewInfo` | `table.bad_request`, `table.no_session`; job: `data.cancelled` |
| `table_rows` | `session`, `view`, `start`, `count` | `Vec<Vec<String>>` | `table.bad_request`, `table.no_session` |
| `table_close` | `session` | `()` | none |
| `json_open_start` | `request_id`, `path` | `()`; job result `JsonSummary` | `json.bad_request`; job: `data.too_large`, `data.too_deep`, `data.invalid`, `data.read_failed`, `data.cancelled` |
| `json_children` | `session`, `node`, `start`, `count` | `Vec<JsonNodeInfo>` | `json.bad_request`, `json.no_session` |
| `json_find` | `session`, `text`, `case_sensitive`, `after`, `backwards` | `Option<JsonMatch>` | `json.bad_request`, `json.no_session` |
| `json_copy` | `session`, `node` | `String` | `json.bad_request`, `json.no_session`, `data.too_large` |
| `json_close` | `session` | `()` | none |
| `font_info_start` | `request_id`, `path` | `()`; job result `FontInfo` | `font.bad_request`; job: `font.unreadable`, `font.helper_failed`, `font.timeout`, `font.cancelled` |
| `font_install` | `path` | `bool` (false: the user cancelled Windows' prompt) | `font.bad_request`, `font.install_failed` |

| Type | Fields |
|---|---|
| `TableSummary` | `session: String`, `columns: u32`, `rows: u64`, `truncated: bool`, `delimiter: String`, `encoding: TextEncodingId`, `has_header: bool`, `headers: Vec<String>` (first row, cut per D3) |
| `TableViewInfo` | `view: u64`, `rows: u64` |
| `JsonSummary` | `session: String`, `nodes: u32`, `encoding: TextEncodingId`, `root: JsonNodeInfo` |
| `FontInfo` (`font_helper.rs`) | `format: String` (`ttf`, `otf`, `ttc`, `woff`, `woff2`), `family`, `style`, `full_name`, `version`, `designer`, `copyright`, `license`: each `Option<String>`; `glyphs: u32`, `weight: u16`, `italic: bool`, `monospaced: bool`, `faces: u32`, `ranges: Vec<[u32; 2]>`, `ranges_cut: bool`, `code_points: u32` |

Sessions: `DataSessions` is `.manage`d state with at most 4 tables plus 4 JSON documents, and tables at most 256 MiB of file bytes in total. The least recently used session goes first. A closed or evicted session gives `no_session`, and the view reads the file once more (the `reopened` pattern in `useArchiveSession`). `view` numbers increase per session. `table_rows` with an old `view` number gives `table.no_session`, which also covers answers from before a new sort.

### TypeScript

| Item | File | Notes |
|---|---|---|
| `HandlerViewProps.onOpenAsText?: () => void` | `src/handlers/types.ts` | Optional, comment "Open this file in the text viewer (Step 06f)." |
| `tableOpen`, `tableView`, `tableRows`, `tableClose` | `src/services/tableView.ts` | Open and view return `JobHandle` through `runJob`, prefixes `tblopen` and `tblview` |
| `jsonOpen`, `jsonChildren`, `jsonFind`, `jsonCopy`, `jsonClose` | `src/services/jsonView.ts` | Open uses prefix `jsonopen` |
| `fontInfo`, `fontInstall` | `src/services/fontView.ts` | Info uses prefix `fontinfo` |
| `searchBytes`, `foldAscii`, `parseHexPattern`, `encodeTextPattern`, `parseOffset`, `offsetLocation`, `hexCharRange` | `src/handlers/hex/search.ts` | Pure |
| `findInFile` | `src/handlers/hex/findInFile.ts` | `size`, `needle`, `from`, `backwards`, `fold`, `read: (start, end) => Promise<Uint8Array>`, `signal`, `onProgress(percent)`; returns the offset or `null`; rejects with `AbortError` |
| `codePointAt`, `formatCodePoint`, `charMapRows` | `src/handlers/font/charMap.ts` | Pure |
| `flattenTree` | `src/handlers/json/tree.ts` | Pure: visible rows from expanded nodes and loaded pages |

### Commands (all `risk: "read-only"` except install)

| Id | Label key | Icon | Shortcut | Enabled or visible |
|---|---|---|---|---|
| `table.toggleHeader` | `table.firstRowHeaders` | `Heading1` | none | Toggle; pressed when on |
| `table.openAsText` | `viewer.openAsText` | `FileText` | none | Visible when `onOpenAsText` exists |
| `json.collapseAll` | `json.collapseAll` | `ListCollapse` | none | Enabled when something below the root is open |
| `json.copyValue` | `json.copyValue` | `Copy` | `Ctrl+C` | Enabled when a row is selected and focus is in the tree |
| `json.openAsText` | `viewer.openAsText` | `FileText` | none | As for the table |
| `font.install` | `font.install` | `Download` | none | Visible for `ttf`, `otf`, `ttc`; disabled while protected view is on |
| `hex.searchText` | `hex.searchText` | `CaseSensitive` | none | Radio: pressed in text mode |
| `hex.searchBytes` | `hex.searchBytes` | `Binary` | none | Radio: pressed in bytes mode |
| `hex.goToOffset` | `hex.goToOffset` | `LocateFixed` | `Ctrl+G` | Disabled for an empty file |

### Translation keys

| Key | English | Spanish |
|---|---|---|
| `handlers.table` | Table | Tabla |
| `handlers.json` | JSON | JSON |
| `handlers.font` | Font | Fuente |
| `viewer.openAsText` | Open as text | Abrir como texto |
| `table.label` | Table of {name} | Tabla de {name} |
| `table.firstRowHeaders` | First row is headers | La primera fila son encabezados |
| `table.columnNumber` | Column {number} | Columna {number} |
| `table.rowCount` | {count, plural, one {# row} other {# rows}} | {count, plural, one {# fila} other {# filas}} |
| `table.columnCount` | {count, plural, one {# column} other {# columns}} | {count, plural, one {# columna} other {# columnas}} |
| `table.filtered` | {shown} of {total} rows match | {shown} de {total} filas coinciden |
| `table.truncated` | This file is too big to show whole. Showing the first {count, plural, one {# row} other {# rows}}; use Open as text to see the rest. | Este archivo es demasiado grande para mostrarlo completo. Se muestra {count, plural, one {la primera fila} other {las primeras # filas}}; usa Abrir como texto para ver el resto. |
| `table.empty` | This file has no rows. | Este archivo no tiene filas. |
| `table.noMatches` | No rows match your search. | Ninguna fila coincide con tu búsqueda. |
| `table.reading` | Reading the table… | Leyendo la tabla… |
| `table.sorting` | Sorting… | Ordenando… |
| `table.delimiterComma` | Comma separated | Separado por comas |
| `table.delimiterSemicolon` | Semicolon separated | Separado por punto y coma |
| `table.delimiterTab` | Tab separated | Separado por tabulaciones |
| `table.delimiterPipe` | Pipe separated | Separado por barras verticales |
| `table.sortColumn` | Sort by {name} | Ordenar por {name} |
| `json.label` | Tree of {name} | Árbol de {name} |
| `json.reading` | Reading the JSON file… | Leyendo el archivo JSON… |
| `json.collapseAll` | Collapse all | Contraer todo |
| `json.copyValue` | Copy value | Copiar valor |
| `json.copied` | Value copied. | Valor copiado. |
| `json.copyFailed` | Couldn't copy this value. | No se pudo copiar este valor. |
| `json.showMore` | Show more ({count} left) | Mostrar más (quedan {count}) |
| `json.items` | {count, plural, one {# item} other {# items}} | {count, plural, one {# elemento} other {# elementos}} |
| `json.nodeCount` | {count, plural, one {# value} other {# values}} | {count, plural, one {# valor} other {# valores}} |
| `json.noMatches` | Nothing matches your search. | Nada coincide con tu búsqueda. |
| `json.invalidAt` | Line {line}, column {column} | Línea {line}, columna {column} |
| `font.label` | Preview of {name} | Vista previa de {name} |
| `font.sample` | The quick brown fox jumps over the lazy dog. 0123456789 | El veloz murciélago hindú comía feliz cardillo y kiwi. 0123456789 |
| `font.sampleLabel` | Sample text | Texto de muestra |
| `font.sizeLabel` | {size} px | {size} px |
| `font.install` | Install | Instalar |
| `font.installTitle` | Install this font? | ¿Instalar esta fuente? |
| `font.installBody` | Windows installs {name} and may ask for permission. This app can't undo it; to remove the font, use Fonts in Windows Settings. | Windows instala {name} y puede pedir permiso. Esta aplicación no puede deshacerlo; para quitar la fuente, usa Fuentes en Configuración de Windows. |
| `font.installConfirm` | Install | Instalar |
| `font.installed` | Windows is installing the font. | Windows está instalando la fuente. |
| `font.protectedNote` | Turn off protected view to install this font. | Desactiva la vista protegida para instalar esta fuente. |
| `font.loadError` | This font couldn't be shown. The file may be damaged. | No se pudo mostrar esta fuente. Es posible que el archivo esté dañado. |
| `font.details` | Details | Detalles |
| `font.family` | Family | Familia |
| `font.style` | Style | Estilo |
| `font.version` | Version | Versión |
| `font.designer` | Designer | Diseñador |
| `font.copyright` | Copyright | Derechos de autor |
| `font.license` | License | Licencia |
| `font.glyphs` | Glyphs | Glifos |
| `font.faces` | This file holds {count} fonts; the first is shown. | Este archivo contiene {count} fuentes; se muestra la primera. |
| `font.charMap` | Character map | Mapa de caracteres |
| `font.noCharMap` | The character map isn't available for this font format. | El mapa de caracteres no está disponible para este formato de fuente. |
| `font.rangesCut` | This font has more characters than the map can list. | Esta fuente tiene más caracteres de los que puede mostrar el mapa. |
| `font.copyChar` | Copy {code} | Copiar {code} |
| `hex.searchText` | Search as text | Buscar como texto |
| `hex.searchBytes` | Search as bytes | Buscar como bytes |
| `hex.searching` | Searching… {percent}% | Buscando… {percent} % |
| `hex.notFound` | Not found. | No se encontró. |
| `hex.foundAt` | Found at {offset} | Encontrado en {offset} |
| `hex.badPattern` | Enter pairs of hex digits, like 4D 5A. | Escribe pares de dígitos hexadecimales, como 4D 5A. |
| `hex.searchFailed` | The file couldn't be read to the end. | No se pudo leer el archivo hasta el final. |
| `hex.goToOffset` | Go to offset… | Ir al desplazamiento… |
| `hex.goToTitle` | Go to offset | Ir al desplazamiento |
| `hex.goToLabel` | Offset (hexadecimal, or decimal with #) | Desplazamiento (hexadecimal, o decimal con #) |
| `hex.goToConfirm` | Go | Ir |
| `hex.goToBad` | Enter an offset between 0 and {last}. | Escribe un desplazamiento entre 0 y {last}. |
| `errors.data.other` | Couldn't read this file. | No se pudo leer este archivo. |
| `errors.data.too_large` | This file is too large for this view. Use Open as text. | Este archivo es demasiado grande para esta vista. Usa Abrir como texto. |
| `errors.data.too_deep` | This JSON is nested too deeply to show as a tree. Use Open as text. | Este JSON tiene demasiados niveles para mostrarlo como árbol. Usa Abrir como texto. |
| `errors.data.invalid` | This isn't valid JSON. Use Open as text to see it. | Este JSON no es válido. Usa Abrir como texto para verlo. |
| `errors.data.read_failed` | Couldn't read this file. | No se pudo leer este archivo. |
| `errors.table.other` | Couldn't show this table. | No se pudo mostrar esta tabla. |
| `errors.json.other` | Couldn't show this JSON file. | No se pudo mostrar este archivo JSON. |
| `errors.font.other` | Couldn't read this font. | No se pudo leer esta fuente. |
| `errors.font.install_failed` | Windows couldn't install this font. | Windows no pudo instalar esta fuente. |


## Tasks

### T1 - Libraries and the crate

**Files:** create `crates/data-views/Cargo.toml`, `crates/data-views/src/lib.rs`, `limits.rs`, `error.rs`, `decode.rs`, `crates/data-views/tests/step06f_decode_tests.rs`; modify `Cargo.toml` (workspace member), `src-tauri/Cargo.toml`, `THIRD_PARTY_LICENSES.md`, `docs/dependency-and-license-table.md`.

**Do this:**
1. Follow `plan/recipes/add-dependency.md`, in a `deps:` commit first: `csv` 1.4 (Unlicense OR MIT, needs Rust 1.73; `ReaderBuilder::new`, `delimiter`, `has_headers`, `flexible`, `from_reader`, `read_byte_record` were checked at 1.4.0). `ttf-parser` 0.25 goes into `src-tauri` only, default features off, feature `std` (MIT OR Apache-2.0; `Face::parse` needs the names in T7). `serde` and `serde_json` as the workspace uses them. Do not turn on serde_json's `preserve_order`.
2. `decode_text`: as D4. UTF-8 BOM is removed. A Windows-1252 table covers bytes 0x80 to 0x9F; other bytes map to the same code point; undefined bytes (0x81, 0x8D, 0x8F, 0x90, 0x9D) map to the same code point.

**Tests** (`step06f_decode_tests.rs`):

| Test | Input bytes | Expected |
|---|---|---|
| `utf8_with_and_without_mark` | EF BB BF 61; 61 C3 B1 | `a` as `utf8`; `añ` as `utf8` |
| `utf16_both_orders` | FF FE 61 00; FE FF 00 61 | `a` as `utf16_le`; `a` as `utf16_be` |
| `invalid_utf8_falls_back` | 80 E9 | `€é` as `windows1252` |
| `odd_utf16_tail_is_replaced` | FF FE 61 00 62 | `a` followed by U+FFFD |

**Commit:** `feat(data): data views crate and text decoding [step-06f/T1]`, after `deps: add csv 1.4 (Unlicense OR MIT) and ttf-parser 0.25 (MIT OR Apache-2.0) [step-06f/T1]`

### T2 - Parse tables

**Files:** create `crates/data-views/src/table.rs`, `crates/data-views/tests/step06f_table_tests.rs`.

**Do this:**
1. `detect_delimiter`: extension `tsv` (any case) gives tab. Otherwise take at most the first 64 KiB, cut at a line end, ignoring text inside double quotes. For each candidate, in the order `,` `;` tab `|`, count per line. A candidate qualifies when at least 2 lines have a count of at least 1 and every non-empty line has the same count, or the file has one line and its count is at least 1. Pick the qualifying candidate with the highest count; ties go to the earlier candidate. None qualifies: `,`.
2. `parse_table`: `ReaderBuilder` with the delimiter, `has_headers(false)`, `flexible(true)`, reading with `read_byte_record` into one reused record. Check the token every 4,096 rows. Keep cells in one text buffer plus a `u64` end offset per cell and a `u32` start index per row. Stop at the limits in D3 and set `truncated`. A CSV read error at a position means stop and set `truncated`, keeping earlier rows. Bytes are valid UTF-8 because the text is.
3. `columns()` is the largest row length after the cut. `cell` beyond a row's length returns an empty string.
4. `first_row_is_header`, first rule that applies: a table with no rows gives false; a first row of only empty cells gives true; every non-empty cell of the first row parsing as a number by `parse_number` (`f64`, trimmed, not `NaN` or infinite) gives false; otherwise true.

**Tests:**

| Test | Input | Expected |
|---|---|---|
| `delimiters_are_detected` | `a,b\n1,2\n`; `a;b\n1;2\n`; `a\tb\n1\t2\n`; `a\|b\n1\|2\n`; `solo\n` | comma, semicolon, tab, pipe, comma |
| `quoted_delimiters_do_not_count` | `"a;b",c\n"d;e",f\n` | comma |
| `tsv_extension_wins` | `a,b\n` with extension `TSV` | tab |
| `quotes_and_line_breaks_stay_in_a_cell` | `"a,b","c\nd"\n1,2\n` with comma | 2 rows, 2 columns; cell (0,0) `a,b`; cell (0,1) `c`, line feed, `d` |
| `short_rows_read_empty` | `a,b,c\n1\n` | 3 columns; cell (1,2) empty |
| `row_limit_truncates` | 3 rows, `TableLimits` with `rows` 2 | 2 rows, `truncated` true |
| `cancel_stops_the_parse` | token already set | `Err(Cancelled)` |
| `header_detection` | `name,age\n`; `1,2\n3,4\n`; `,\n1,2\n`; empty text | true, false, true, false |

**Traps:** the CSV reader must get the decoded text's bytes, not the file's. Never index by character into the buffer; offsets are bytes.

**Commit:** `feat(data): parse CSV and TSV into a compact table [step-06f/T2]`

### T3 - Sort and filter

**Files:** create `crates/data-views/src/table_view.rs`, `crates/data-views/tests/step06f_table_view_tests.rs`.

**Do this:**
1. `compare_cells`: classes in order: number, text, empty. In ascending order numbers come first, then text, then empty. In descending order numbers and text reverse among themselves and their classes swap, and **empty stays last**. Numbers compare by `f64::total_cmp`. Text compares by lower-cased characters, then by the exact text.
2. `build_order`: start with all rows, skipping row 0 when `has_header`. Filter keeps a row when any cell contains the lower-cased filter. An empty filter keeps all. Sort stably when `sort_column` is set. Check the token every 4,096 rows while filtering. To allow a cancel during a sort, pre-compute the keys with the token checks, then sort.
3. `page_rows`: for `start..start + min(count, MAX_PAGE_ROWS)` within `order`, one `String` per column, cut to `MAX_CELL_CHARS` characters plus `…`.

**Tests:**

| Test | Input | Expected row order or result |
|---|---|---|
| `numbers_sort_as_numbers` | column `10`, `9`, `100` ascending | `9`, `10`, `100` |
| `empty_is_last_both_ways` | `b`, empty, `a`, `2` ascending; then descending | `2`, `a`, `b`, empty; then `b`, `a`, `2`, empty |
| `text_ignores_case_and_ties_keep_file_order` | rows (`b`,1), (`A`,2), (`a`,3), sorted by column 0 | rows 2, 3, 1 (1-based file order) |
| `header_stays_out` | `h\n2\n1\n`, `has_header` true, ascending | row indexes 2, 1 |
| `filter_matches_any_cell_without_case` | rows (`Ana`,`x`), (`Luis`,`ANA`), (`Eva`,`y`), `has_header` false, filter `ana` | rows 0, 1 |
| `no_header_keeps_row_zero` | `2\n1\n`, `has_header` false, ascending | row indexes 1, 0 |
| `cells_are_cut` | a cell of 2,001 `x` | 2,000 `x` plus `…` |
| `page_is_capped` | 600 rows, count 600 | 500 rows |
| `cancel_stops_the_view` | token set | `Err(Cancelled)` |

**Commit:** `feat(data): sort and filter table rows [step-06f/T3]`

### T4 - Parse JSON

**Files:** create `crates/data-views/src/json.rs`, `crates/data-views/tests/step06f_json_tests.rs`.

**Do this:**
1. `parse_json`: a serde `DeserializeSeed` and `Visitor` over `serde_json::Deserializer::from_str`, pushing into an arena: each node has its kind, optional key, optional array index, text (string value, or number or bool as text) and a child id range. Call the deserializer's `end()`, so trailing text is an error. A recursion-limit error is `TooDeep`; other errors are `Invalid` with `line()` and `column()`. More than `MAX_JSON_NODES` nodes stops with `TooLarge`.
2. Tell `TooDeep` from `Invalid` by the error's text containing `recursion limit exceeded`.
3. `children`: page of `JsonNodeInfo`. A string's `preview` is cut to `MAX_JSON_PREVIEW` characters with `preview_cut`. Containers have an empty preview and `child_count`.
4. `find_next`: compare against keys and scalar text, lower-casing both unless `case_sensitive`. Go through ids in document order from after `after`, wrapping to the start once. `backwards` goes the other way. Empty text gives `None`.
5. `copy_text`: as in the data table. Duplicate keys print as they appear.

**Tests:**

| Test | Input | Expected |
|---|---|---|
| `order_and_duplicates_stay` | `{"b":1,"a":2,"b":3}` | root children keys `b`, `a`, `b` |
| `kinds_and_previews` | `[1,"x",true,null,{},[]]` | kinds number, string, bool, null, object, array; previews `1`, `x`, `true`, `null`, empty, empty |
| `invalid_reports_the_place` | `{"a":1,}` | `Invalid` with line 1 and column 8 |
| `comments_are_invalid` | a line comment then `{}` | `Invalid` |
| `trailing_text_is_invalid` | `{} x` | `Invalid` |
| `too_deep_is_refused` | 200 `[` then 200 `]` | `TooDeep` |
| `pages_and_counts` | an array of 2,500 numbers, start 1,000, count 1,000 | 1,000 rows; first index 1,000; root `child_count` 2,500 |
| `long_strings_are_cut` | a 301-character string | 300 characters, `preview_cut` true |
| `find_walks_and_wraps` | `{"name":"Ana","list":["ana","x"]}`, text `ANA`, not case-sensitive, from nothing; then after that match; then after that | `name` value's id with ancestors [root]; the list's first item with ancestors [root, list]; the `name` value again |
| `find_can_require_case` | the same, text `ANA`, case-sensitive | `None` |
| `copy_is_bounded` | string of 1,048,577 bytes | `Err(TooLarge)` |
| `copy_prints_pretty_json` | `{"a":[1]}` root | text equal to `serde_json::to_string_pretty` of the same value |

**Trap:** check the "invalid" column by running it once and correcting this table in a `docs(plan)` commit if serde_json reports another column for the same text; never loosen it to "any".

**Commit:** `feat(data): parse JSON into a navigable tree [step-06f/T4]`

### T5 - Commands and sessions

**Files:** create `src-tauri/src/data_views.rs`, `src/services/tableView.ts`, `src/services/jsonView.ts`, `src/__tests__/dataServices.test.ts`; modify `src-tauri/src/main.rs`, `src-tauri/isolation/index.html`, `src-tauri/Cargo.toml`, `src/i18n/locales/en.json`, `es.json` (then `npm run i18n:pseudo`).

**Do this:**
1. `DataSessions` as described in Data shapes, `.manage`d in `main.rs`. Session ids come from the job's request id.
2. Jobs use `jobs.begin`, then `spawn_job`, as `archive_open_start` does. A job reads the file with a read limited to `max + 1` bytes; over the limit is `data.too_large`. It sets the token-aware parse going and stores the session only when finished. The first `TableViewInfo` for the default view (no sort, no filter, `has_header` from the summary) is built inside `table_open_start`, numbered view 1.
3. Errors from `DataError::code()`. `data.invalid` is returned as text `data.invalid:<line>:<column>`, and the service splits it, giving `Error("data.invalid")` with `line` and `column` properties. Never put file text in an error.
4. Add the `errors.data.*`, `errors.table.other`, `errors.json.other` keys.

**Tests:**
- Rust, in `data_views.rs`: `sessions_evict_the_oldest` (5 tables, the first gives `no_session`), `total_bytes_evict_too` (three tables of 100 MiB of declared bytes through a size parameter, the first goes), `old_view_is_refused`, `bad_ids_and_paths_are_refused`, each in the plain functions behind the commands.
- `dataServices.test.ts`: "table services use job prefixes" (`tblopen`), "invalid JSON splits line and column" (`data.invalid:3:9` gives message `data.invalid`, line 3, column 9), "close ignores errors".

**Commit:** `feat(data): table and JSON sessions and commands [step-06f/T5]`

### T6 - The table view

**Files:** create `src/handlers/table/index.ts`, `TableView.tsx`, `useTableSession.ts`, `src/styles/table-view.css`, `src/__tests__/tableView.test.tsx`; modify `src/handlers/index.ts`, `src/handlers/types.ts`, `src/views/FileTabView.tsx`, `src/App.tsx`, `src/main.tsx`, `src/__tests__/defaultApps.test.tsx`, translations.

**Do this:**
1. Handler `table`: `labelKey` `handlers.table`, icon `Table2`, accent `excel`, extensions `csv`, `tsv`, `mimeTypes` empty, `maxBytes` 134,217,728, `helpSlug` `viewing-tables`, `speedTier` `fast`, `supportsFind` true, `version` 1. Register before `textHandler`.
2. `onOpenAsText`: add the prop (D15). `FileTabView` takes and passes it. `App` passes a function calling `openFileWith(tab.path, "text")`. At most about 6 new lines in `App.tsx`.
3. `useTableSession` follows `useArchiveSession`: open once, keep `summary`, `view`, `rows`, a page cache of at most 20 pages of 200 rows, ignore answers for older views, close on unmount, reopen once on `no_session`.
4. Filter: `find.text`, 200 ms after typing stops, starts `table_view_start` and cancels the running one. `find.request` moves to the next matching row (scroll only, because all shown rows match).
5. Markup: `ViewerFrame` with a ribbon (View tab, group **Table**: `table.toggleHeader`; group **Open**: `table.openAsText`). Body `div.adp-table` with `role="grid"`, `aria-label` `table.label`, `aria-rowcount`, `aria-colcount`, `tabIndex` 0. A sticky header row `div.adp-table-head`, with a `button.adp-table-head-cell` per visible column (`role="columnheader"`, `aria-sort`, `aria-label` `table.sortColumn`, arrow icon when sorted). Rows `div.adp-table-row` (`role="row"`), cells `div.adp-table-cell` (`role="gridcell"`), plus a sticky left row-number column `div.adp-table-number`.
6. Two virtualizers from `@tanstack/react-virtual` (rows at 28 px, columns from a width list), overscan 8 rows and 3 columns. Column width: `clamp(longest of the header and first 200 rows' characters × 8 + 24, 80, 400)`, worked out once per view from the first page.
7. Clicking a header cycles ascending, descending, none. Up, Down, Page Up, Page Down, Home and End scroll when the grid has focus. Text stays selectable for Ctrl+C.
8. Status items: row count (`table.filtered` while filtering), column count, the delimiter key, encoding name, size.
9. States: a skeleton after 100 ms, `table.reading` after 1 s, with a cancel button using `common.cancel`; `table.sorting` during a view job after 1 s. `table.empty` for no rows, with **Open as text**. `table.noMatches`. A note bar `table.truncated` when `truncated`. On error: `.adp-viewer-message` with the translated code, **Open as text** and `fileTab.openInWindowsApp`.
10. Saved state: `has_header`, `sort_column`, `direction`.

**Styles** (`table-view.css`):

| Selector | Layout and size | Look |
|---|---|---|
| `.adp-table` | fills the frame, scrolls both ways | `--adp-color-surface-window`; focus outline 2 px accent, offset -2 px |
| `.adp-table-head` | sticky top; height 32 px | `--adp-color-surface-pane`, 1 px bottom `--adp-color-border-default` |
| `.adp-table-head-cell` | padding 0 `--adp-space-3`; text cut with an ellipsis | semibold; hover `--adp-color-surface-selected` |
| `.adp-table-number` | sticky left; width 64 px; right aligned | `--adp-color-text-tertiary`, `--adp-color-surface-pane` |
| `.adp-table-row` | height 28 px | 1 px bottom `--adp-color-border-subtle` |
| `.adp-table-cell` | padding 0 `--adp-space-3`; one line, ellipsis | `--adp-color-text-primary` |
| `.adp-table-note` | padding `--adp-space-3` `--adp-space-5` | `--adp-color-surface-pane` |

**Tests** (`tableView.test.tsx`, services mocked): "shows headers and rows"; "clicking a header sorts, then reverses, then clears" (three `tableView` calls with ascending, descending and null); "typing filters after a pause and cancels the older view"; "turning headers off asks for a new view"; "an old view's rows are ignored"; "an empty file offers Open as text"; "a truncated file says so"; "closes the session when the tab closes"; "Open as text calls the prop". In `defaultApps.test.tsx`, its groups come from handlers with extensions, so the expected `groupSelects` length goes from 5 to 6 in this task, 7 in T8 (`font`) and 8 in T9 (`json`). In `handlers.test.ts` add "ties go to the table and JSON viewers, and big files fall back to text": `a.csv` picks `table`; `a.csv` of 134,217,729 bytes picks `text`.

**Commit:** `feat(viewer): CSV and TSV tables with sort and filter [step-06f/T6]`

### T7 - Font helper

**Files:** create `src-tauri/src/font_helper.rs` (with its tests), `src-tauri/src/font_view.rs`, `src/services/fontView.ts`; modify `src-tauri/src/main.rs`, `src-tauri/isolation/index.html`, translations (`errors.font.*`).

**Do this:**
1. `font_helper.rs`: `HELPER_FLAG` `--font-helper`, `HELPER_MEMORY_LIMIT` 268,435,456, `MAX_FONT_FILE` 67,108,864. `run_helper` reads one JSON request line with the file path, reads at most `MAX_FONT_FILE + 1` bytes, writes one JSON line, and exits. Add it beside the other helper flags at the top of `main`.
2. Pure `read_font(bytes: &[u8]) -> Result<FontInfo, String>`: first bytes `wOFF` gives format `woff`, `wOF2` gives `woff2`, both with empty names and ranges. `ttcf` is `ttc` with `faces` from `fonts_in_collection`. Otherwise `Face::parse(bytes, 0)`, format `otf` when the first bytes are `OTTO`, otherwise `ttf`. A parse error is `font.unreadable`.
3. Names: from `face.names()`, wanting Unicode names. Prefer language `EnglishUnitedStates`, otherwise the first Unicode name. IDs: `TYPOGRAPHIC_FAMILY` or else `FAMILY`, `SUBFAMILY`, `FULL_NAME`, `VERSION`, `DESIGNER`, `COPYRIGHT_NOTICE`, `LICENSE`. Cut each to 2,000 characters.
4. `merge_code_points`: from all Unicode cmap subtables' `codepoints`, drop controls (0 to 31, 127 to 159), surrogates (0xD800 to 0xDFFF) and values above 0x10FFFF, sort, remove duplicates, join runs. Keep at most 20,000 ranges and set `ranges_cut`.
5. `font_view.rs`: `font_info_start` drives the helper with `HelperProcess::spawn` and `drive`, as `run_helper_job` does, mapping `helper.timeout` to `font.timeout`. `font_install`: `ensure_main`, `validate_absolute_path`, extension is one of `ttf`, `otf`, `ttc` (any case), `spawn_blocking`, then `ShellExecuteExW` following `shell_execute_default` with verb `install`. A cancelled prompt returns `false`; other failures give `font.install_failed`.

**Tests** (in `font_helper.rs`). A test builder `minimal_font(names, code_points)` writes a valid sfnt with the tables `head` (54 bytes, magic 0x5F0F3CF5, `unitsPerEm` 1000), `hhea` (36 bytes, `numberOfHMetrics` 1), `maxp` (6 bytes, version 0.5, 1 glyph), `hmtx`, `name` (format 0, platform 3, encoding 1, language 0x0409, UTF-16 BE) and `cmap` (format 12, platform 3, encoding 10):

| Test | Input | Expected |
|---|---|---|
| `merges_runs_and_drops_controls` | 160, 10, 65, 66, 67, 70, 0xD800 | `[65,67]`, `[70,70]`, `[160,160]`; `code_points` 5 |
| `reads_names_and_ranges` | family `Sample`, code points 65 to 67 | format `ttf`, family `Sample`, ranges `[65,67]`, `glyphs` 1 |
| `garbage_is_refused` | bytes 1, 2, 3, 4 | `font.unreadable` |
| `woff_gives_no_names` | `wOFF` then zeros | format `woff`, no family, no ranges |
| `old_helper_message_shape` | a `FontInfo` JSON round trip | equal |
| `install_refuses_other_types` | `C:\a.exe` | `font.bad_request` |

**Trap:** the helper never reads a path other than the request's. Never pass a path on a command line (R-SEC-7).

**Commit:** `feat(font): read font details in a helper process [step-06f/T7]`

### T8 - The font view

**Files:** create `src/handlers/font/index.ts`, `FontView.tsx`, `charMap.ts`, `src/styles/font-view.css`, `src/__tests__/fontCharMap.test.ts`, `src/__tests__/fontView.test.tsx`; modify `src/handlers/index.ts`, `src/main.tsx`, `src/__tests__/defaultApps.test.tsx`, translations.

**Do this:**
1. Handler `font`: icon `Type`, accent `explorer`, extensions `ttf`, `otf`, `ttc`, `woff`, `woff2`, `mimeTypes` `font/ttf`, `font/otf`, `font/collection`, `font/woff`, `font/woff2`, `maxBytes` 67,108,864, `helpSlug` `viewing-fonts`, `supportsFind` false, `version` 1.
2. Load: `fetch(url)`, then `new FontFace(uniqueName, buffer)`, `load()`, `document.fonts.add`. Remove it on unmount with `document.fonts.delete`. `uniqueName` is `adp-preview-` plus a counter. Guard for a missing `FontFace`, as in tests. A failed load shows `font.loadError` with `fileTab.openInWindowsApp`.
3. Details come from `fontInfo`. If that fails but `FontFace` loaded, the sample still shows, with the details hidden.
4. Markup: `div.adp-font`, `role="region"`, `aria-label` `font.label`. A `TextInput` (`font.sampleLabel`, at most 200 characters, default `font.sample`, kept in saved state). Sample lines `p.adp-font-sample` at 12, 16, 24, 36, 48 and 72 px, each with a small `font.sizeLabel` label. A details list `dl.adp-font-details`, rows only for values that exist. `font.faces` when `faces` is over 1. Long license text scrolls within at most 120 px.
5. Character map: `h3` `font.charMap`, then a virtual grid (cell 56 × 64 px, columns `max(1, floor(width / 56))`), each cell a `button.adp-font-cell` with `aria-label` `font.copyChar` and the character drawn in the font, with `formatCodePoint` under it. Enter or click copies with `navigator.clipboard.writeText` and shows `json.copied`, or `json.copyFailed` on failure. `font.noCharMap` for WOFF formats, `font.rangesCut` when cut.
6. Ribbon: group **Font**: `font.install`. Clicking opens a `Dialog` (`font.installTitle`, `font.installBody`, `font.installConfirm`, `common.cancel`). On success, the status says `font.installed`. A `false` result says nothing. Failures use `errorText(t, error, "font")`. While protected view is on, the button is disabled with the tooltip `font.protectedNote`.

**Tests:**

`fontCharMap.test.ts`:

| Test | Input | Expected |
|---|---|---|
| "codePointAt walks the ranges" | ranges `[65,67]`, `[70,70]`; indexes 0, 2, 3, 4 | 65, 67, 70, `null` |
| "formatCodePoint pads to four digits" | 65, 0x1F600 | `U+0041`, `U+1F600` |
| "charMapRows divides the cells" | 10 cells, 4 per row | 3 rows |

`fontView.test.tsx` (`FontFace` and services mocked): "draws the six sample sizes"; "shows names from the details"; "a WOFF font says there is no map"; "Install asks first, and Cancel does nothing"; "Install is disabled in protected view"; "removes the font on close"; "a bad font shows the error".

**Commit:** `feat(viewer): font preview, character map and install [step-06f/T8]`

### T9 - The JSON view

**Files:** create `src/handlers/json/index.ts`, `JsonView.tsx`, `tree.ts`, `src/styles/json-view.css`, `src/__tests__/jsonTree.test.ts`, `src/__tests__/jsonView.test.tsx`; modify `src/handlers/index.ts`, `src/main.tsx`, `src/__tests__/defaultApps.test.tsx`, translations.

**Do this:**
1. Handler `json`: icon `Braces`, accent `explorer`, extensions `json`, `geojson`, `webmanifest`, `mimeTypes` `application/json`, `maxBytes` 33,554,432, `helpSlug` `viewing-json`, `supportsFind` true, `version` 1. Register before `textHandler`.
2. `flattenTree(root, expanded, pages)`: rows in display order, each with `depth`, the node and, after the loaded children of a partly loaded container, one `more` row carrying what is left.
3. Markup: `role="tree"`, `aria-label` `json.label`, one virtual list at 26 px per row. Each row `div.adp-json-row` with `role="treeitem"`, `aria-level`, `aria-expanded` on containers, indented `depth × 18` px, with a chevron, key or index, `:`, and a value by kind. Containers show `json.items`.
4. Keyboard, on one roving row: Up, Down, Home, End, Page Up, Page Down. Right opens or moves to the first child. Left closes or moves to the parent. Enter toggles, or activates **Show more**. Ctrl+C runs `json.copyValue`. Double-click toggles a container.
5. Find: `find.request` above 0 calls `jsonFind` with the current row as `after`, `find.backwards`, and `find.options?.caseSensitive`. On a match, expand `ancestors`, loading pages until the node is present (a large array loads the page holding its index), select and scroll. No match gives `json.noMatches` in the status.
6. Errors: `data.invalid` shows `errors.data.invalid` and `json.invalidAt`, **Open as text** and `fileTab.openInWindowsApp`. Status: `json.nodeCount`, encoding, size. Saved state: none in this step.

**Styles:** row hover and selected use `--adp-color-surface-selected`; strings `--adp-syntax-string`, numbers `--adp-syntax-number`, keys `--adp-syntax-property`, bool and null `--adp-syntax-keyword`. Font as in `.adp-hex`.

**Tests:**

`jsonTree.test.ts`:

| Test | Input | Expected |
|---|---|---|
| "closed containers hide children" | root open, child array closed | rows: child only |
| "partly loaded containers get a more row" | array with `child_count` 2,500, 1,000 loaded | 1,000 rows and one `more` row with 1,500 left |
| "depth follows nesting" | root > a > b, all open | depths 0, 1 under the root's children, as listed |

`jsonView.test.tsx`: "root opens with its children"; "Right opens and Left closes"; "Show more loads the next page"; "find expands to the match"; "invalid JSON shows the place and Open as text"; "Ctrl+C copies the selected value"; "closes the session when the tab closes".

**Commit:** `feat(viewer): JSON tree with search and copy [step-06f/T9]`

### T10 - Hex search and Go to offset

**Files:** create `src/handlers/hex/search.ts`, `findInFile.ts`, `src/__tests__/hexSearch.test.ts`, `src/__tests__/hexFind.test.tsx`; modify `src/handlers/hex/index.ts`, `HexView.tsx`, `src/styles/hex.css`, `KNOWN_ISSUES.md`, translations.

**Do this:**
1. `hexHandler.supportsFind` becomes true. No other handler field changes. If an existing test expects no search box on a hex tab, give it the new expectation in this task.
2. `search.ts`, per the tables below. `hexCharRange(first, last)`, with `position(i) = 3 × i + (1 when i ≥ 8, else 0)`, returns `[position(first), position(last) + 2]`.
3. `findInFile`: forward, chunks of 1 MiB from `from`, each read through `min(size, start + 1 MiB + needle length - 1)`, advancing 1 MiB, then wrapping to read from 0 up to `from + needle length - 1`. Backwards is the mirror image, using the last match at or before the start. `onProgress` after each chunk. Check `signal` before each read and after each scan.
4. `HexView`: take `find` and `protectedView` from props. A saved `searchMode` (`text` default). On a `find.request` change above 0: cancel the running search; parse the pattern (empty: nothing; bad: status `hex.badPattern`). Start after the current match, or from the first byte of the current part, then call `findInFile`. Reads use one Range fetch per chunk. A match sets `match` (offset, length), moves `part` with `offsetLocation`, scrolls to the row and sets status `hex.foundAt`. `null` gives `hex.notFound`. A read failure gives `hex.searchFailed`, **without** setting `failed` (D14). Words `hex.searching` only after 1 s.
5. Cancel the search on `active` false, on text change and on unmount (R-SPEED rule 5).
6. Rendering: when a row overlaps the match, split its hex string with `hexCharRange` and its text column by index, wrapping the matching parts in `span.adp-hex-match`, and give the first matching row `aria-current="true"`.
7. Go to offset: command `hex.goToOffset` opens a `Dialog` with a `TextInput` (`hex.goToLabel`). Enter or `hex.goToConfirm` parses with `parseOffset`. Bad input shows `hex.goToBad` with `last` as hex, keeping the dialog open. Good input moves the part, scrolls and marks a 1-byte `match`.
8. Ribbon: group **Search**: `hex.searchText`, `hex.searchBytes`, `hex.goToOffset`.
9. `KNOWN_ISSUES.md`: move KI-032 to Fixed. Leave KI-080 as it is. Add the next free KI number, Minor, "JSON numbers beyond 64 bits show rounded" (D8), target: reviewed at the next milestone.

**Tests** (`hexSearch.test.ts`):

| Function | Input | Expected |
|---|---|---|
| `searchBytes` | [1,2,3,1,2], needle [1,2], from 0, forward | 0 |
| | same, from 1 | 3 |
| | same, from 4, backwards | 3 |
| | same, from 2, backwards | 0 |
| | same, needle [9] | -1 |
| | same, empty needle | -1 |
| `searchBytes` with fold | bytes of `aB`, needle of `Ab`, fold on; fold off | 0; -1 |
| `parseHexPattern` | `4D 5a`; `4d5a`; `4D 5`; `GG`; empty; 1,025 pairs | [77,90]; [77,90]; `null`; `null`; `null`; `null` |
| `encodeTextPattern` | `ñ`; a 1,025-byte text | [195,177]; `null` |
| `parseOffset` (size 64) | `1F`; `0x1F`; `#31`; `40`; empty; `-1`; `#abc`; `0x` | 31; 31; 31; `null`; `null`; `null`; `null`; `null` |
| `parseOffset` (huge size) | `FFFFFFFFFFFFFFFF` | `null` |
| `offsetLocation` | 1,048,592 | part 1, row 1 |
| `hexCharRange` | (0,0); (7,8); (15,15) | [0,2]; [21,27]; [46,48] |
| `findInFile` | size 3 MiB, 4-byte needle at 2,097,150, fake reader | 2,097,150 |
| | needle only at 10, from 2 MiB | 10 (wrapped) |
| | absent | `null` |
| | aborted before the first read | rejects `AbortError`, no read made |
| | backwards from 1 MiB, needle at 1,048,570 and at 10 | 1,048,570 |

`hexFind.test.tsx` (fetch mocked): "Enter finds and shows the offset"; "a match in a later part moves there"; "bad bytes say so without reading"; "a read failure doesn't show the view's error"; "Ctrl+G goes to the offset"; "a bad offset keeps the window open"; "going inactive cancels the search". In `handlers.test.ts`, check that "Open as hex" remains the only way to reach `hex` (no extensions, no types).

**Commit:** `feat(viewer): hex search and Go to offset [step-06f/T10]`

### T11 - Help pages

**Files:** create the pages in "Help pages"; modify `help/en/open-as-text-or-hex.md`, `help/es/open-as-text-or-hex.md`.

**Tests:** none new (`lint:i18n` checks both languages exist).

**Commit:** `docs(help): tables, JSON, fonts and hex search [step-06f/T11]`

### T12 - Measurements and screenshots

**Files:** modify `scripts/measure-ui.mjs`.

**Do this:**
1. In `writeTextSamples`, add `people.csv` (a header and 200 rows of name, age and city), `big-100k.csv` (100,000 rows in that shape), and `data.json` (an object with a `people` array of 200 objects). Sample fonts aren't generated. The font measurement and shot use `C:\Windows\Fonts\arial.ttf` copied into the demo folder when it exists, and are skipped with a log line otherwise.
2. Measurements in the full mode, after the last existing block, each in a `try` that logs and continues, closing its tab with Ctrl+W, waiting for the single-tab state and clicking the Explorer tab: `open a 100,000-row CSV (first view)`, `sort a 100,000-row CSV`, `open a JSON file (first view)`, `open a font (first view)`, `hex search through a 3 MB file`.
3. Screenshots after Step 06e's last action, without typing the open folder's path (KI-033): `52-table`, `53-table-sorted`, `54-json-tree`, `55-font`, `56-hex-search`.

**Commit:** `test(speed): tables, JSON, fonts and hex search measurements and screenshots [step-06f/T12]`

## Help pages

### New page `help/en/viewing-tables.md` (exact text)

```markdown
# Viewing tables

CSV and TSV files open as a table, however long they are. The table is for reading: the file never changes.

## How to use it

- Click a column's heading to sort by it. Click again to reverse the order, and once more to go back to the file's order.
- Press **Ctrl+F** and type to show only the rows that contain your text, in any column.
- **First row is headers** on the ribbon says whether the first row names the columns.
- **Open as text** opens the same file in the text editor, where you can change it.

## Good to know

- Numbers sort as numbers, and empty cells always go last.
- The separator (comma, semicolon, tab or vertical bar) is detected for you and shown in the status bar.
- Files up to 128 MB open as a table. Bigger files open in the text viewer. A table stops at 2 million rows and says so.

See also: "Viewing text and code" and "Opening files in tabs".
```

### New page `help/es/viewing-tables.md` (exact text)

```markdown
# Ver tablas

Los archivos CSV y TSV se abren como una tabla, por largos que sean. La tabla es para leer: el archivo nunca cambia.

## Cómo usarla

- Haz clic en el encabezado de una columna para ordenar por ella. Haz clic otra vez para invertir el orden, y una vez más para volver al orden del archivo.
- Presiona **Ctrl+F** y escribe para mostrar solo las filas que contienen tu texto, en cualquier columna.
- **La primera fila son encabezados**, en la cinta de opciones, indica si la primera fila da nombre a las columnas.
- **Abrir como texto** abre el mismo archivo en el editor de texto, donde puedes cambiarlo.

## Para tener en cuenta

- Los números se ordenan como números, y las celdas vacías siempre van al final.
- El separador (coma, punto y coma, tabulación o barra vertical) se detecta solo y se muestra en la barra de estado.
- Los archivos de hasta 128 MB se abren como tabla. Los más grandes se abren en el visor de texto. Una tabla se detiene en 2 millones de filas y lo indica.

Consulta también: «Ver texto y código» y «Abrir archivos en pestañas».
```

### New page `help/en/viewing-json.md` (exact text)

```markdown
# Viewing JSON

JSON files open as a tree you can fold, so you can find your way around big files. The file never changes.

## How to use it

- Click the arrow next to an object or a list to open or close it, or use the **Right** and **Left** arrow keys.
- Long lists show part of their items. Choose **Show more** for the next ones.
- Press **Ctrl+F** to search keys and values, and **Enter** or **F3** for the next match.
- Select a row and press **Ctrl+C** to copy its value.
- **Open as text** opens the same file in the text editor, where you can change it.

## Good to know

- Keys stay in the file's order.
- A file with an error, or with comments, doesn't open as a tree. The message says where the problem is, and **Open as text** still shows it.
- Files up to 32 MB open as a tree. Bigger files open in the text viewer.
- Very long numbers can show rounded in the tree. **Open as text** shows them exactly.

See also: "Viewing text and code" and "Opening files in tabs".
```

### New page `help/es/viewing-json.md` (exact text)

```markdown
# Ver JSON

Los archivos JSON se abren como un árbol que puedes contraer, para orientarte en archivos grandes. El archivo nunca cambia.

## Cómo usarlo

- Haz clic en la flecha junto a un objeto o una lista para abrirlo o cerrarlo, o usa las teclas de flecha **derecha** e **izquierda**.
- Las listas largas muestran parte de sus elementos. Elige **Mostrar más** para ver los siguientes.
- Presiona **Ctrl+F** para buscar en claves y valores, y **Enter** o **F3** para ir a la siguiente coincidencia.
- Selecciona una fila y presiona **Ctrl+C** para copiar su valor.
- **Abrir como texto** abre el mismo archivo en el editor de texto, donde puedes cambiarlo.

## Para tener en cuenta

- Las claves conservan el orden del archivo.
- Un archivo con un error, o con comentarios, no se abre como árbol. El mensaje indica dónde está el problema, y **Abrir como texto** lo sigue mostrando.
- Los archivos de hasta 32 MB se abren como árbol. Los más grandes se abren en el visor de texto.
- Los números muy largos pueden aparecer redondeados en el árbol. **Abrir como texto** los muestra exactos.

Consulta también: «Ver texto y código» y «Abrir archivos en pestañas».
```

### New page `help/en/viewing-fonts.md` (exact text)

```markdown
# Viewing fonts

Font files open as a sample sheet, so you can see a font before installing it.

## How to use it

- Type in **Sample text** to try your own words at every size.
- **Details** show the font's family, style, version, designer and license, when the file gives them.
- The **Character map** shows every character in the font. Select one to copy it.
- **Install** asks Windows to install the font. Windows may ask for permission.

## Good to know

- Previewing never installs anything or changes the file.
- This app can't undo an installation. To remove a font, use Fonts in Windows Settings.
- A file from the internet in protected view can't be installed until you turn protected view off.
- WOFF and WOFF2 web fonts show the sample sheet but no character map, and can't be installed.
- A collection file (TTC) shows its first font.

See also: "Protected view" and "Opening files in tabs".
```

### New page `help/es/viewing-fonts.md` (exact text)

```markdown
# Ver fuentes

Los archivos de fuente se abren como una hoja de muestra, para que veas la fuente antes de instalarla.

## Cómo usarlo

- Escribe en **Texto de muestra** para probar tus propias palabras en todos los tamaños.
- **Detalles** muestra la familia, el estilo, la versión, el diseñador y la licencia de la fuente, cuando el archivo los indica.
- El **Mapa de caracteres** muestra todos los caracteres de la fuente. Selecciona uno para copiarlo.
- **Instalar** le pide a Windows que instale la fuente. Windows puede pedir permiso.

## Para tener en cuenta

- La vista previa nunca instala nada ni cambia el archivo.
- Esta aplicación no puede deshacer una instalación. Para quitar una fuente, usa Fuentes en Configuración de Windows.
- Un archivo de internet en vista protegida no se puede instalar hasta que desactives la vista protegida.
- Las fuentes web WOFF y WOFF2 muestran la hoja de muestra, pero no el mapa de caracteres, y no se pueden instalar.
- Un archivo de colección (TTC) muestra su primera fuente.

Consulta también: «Vista protegida» y «Abrir archivos en pestañas».
```

### Changes to `help/en/open-as-text-or-hex.md`

After the bullet about parts, add: `- In the hex viewer, press **Ctrl+F** and type what to find, then **Enter** or **F3**. The ribbon chooses **Search as text** or **Search as bytes** (for example 4D 5A). The search covers the whole file, whatever part is showing.` and `- **Ctrl+G** goes to an offset. Type it in hexadecimal (1F or 0x1F), or in decimal with # (#31).`

### Changes to `help/es/open-as-text-or-hex.md`

After the bullet about parts, add: `- En el visor hexadecimal, presiona **Ctrl+F** y escribe lo que buscas; luego **Enter** o **F3**. La cinta de opciones permite elegir **Buscar como texto** o **Buscar como bytes** (por ejemplo, 4D 5A). La búsqueda abarca todo el archivo, sea cual sea la parte que se muestra.` and `- **Ctrl+G** va a un desplazamiento. Escríbelo en hexadecimal (1F o 0x1F) o en decimal con # (#31).`

Check the page titles used in "See also" against the real titles in `help/`, and correct this guide in a `docs(plan)` commit if one differs.

## Check by hand (the owner, in the packaged app)

Before telling the owner, create this folder and give the owner its path.

| Path (inside `%TEMP%\adp-06f`) | Content |
|---|---|
| `people.csv` | Header `name,age,city`, then Ana,31,Lima; Luis,9,Bogota; Eva,,Quito; Ñandú,100,"Cusco, Perú" |
| `semi.csv` | `a;b` then `1;2` |
| `empty.csv` | Empty file |
| `big.csv` | The header and 1,000,000 rows |
| `data.json` | `{"name":"Ana","list":[1,2,3],"nested":{"ok":true,"none":null}}` |
| `bad.json` | `{"a":1,}` |
| `long.json` | An array of 5,000 numbers |
| `sample.bin` | 3 MiB with the text `FINDME` starting at 2,097,150 |

1. Open `people.csv`: a table with the headers, and 4 rows. Click **age**: 9, 31, 100, then the empty cell last. Click again: 100, 31, 9, empty last. Click again: file order.
2. Press Ctrl+F, type `lima`: one row, and the status bar says 1 of 4. Clear it.
3. Toggle **First row is headers**: the first row joins the table, and the columns get numbers. Close and reopen the app: the choice is kept.
4. `semi.csv` shows two columns. `empty.csv` says it has no rows and offers **Open as text**.
5. `big.csv`: the first view is fast, with scrolling smooth to the end. Sort a column: words appear if it takes over a second, and the app stays usable.
6. **Open as text** opens `people.csv` in the editor. The table tab stays open.
7. `data.json`: a tree. Right and Left open and close. Ctrl+F `ok`, Enter: `nested` opens to it. Select `name`'s value, Ctrl+C, and paste elsewhere: `Ana`.
8. `bad.json`: says line 1 and the column, with **Open as text**. `long.json`: **Show more** adds the next 1,000.
9. Copy a font from `C:\Windows\Fonts` into the folder and open it: sample lines at six sizes, details, and a character map. Type your name in **Sample text**. Select a character and paste it elsewhere.
10. On the font, **Install** then **Cancel** does nothing. Don't install unless you want it.
11. Right-click `sample.bin` > **Open as** > **Open as hex**. Ctrl+F, type `FINDME`, Enter: it moves to part 3, highlights across the row and shows the offset. Shift+F3 wraps and finds it again.
12. Choose **Search as bytes**, type `46 49 4E`: found. Type `4`: the message about pairs.
13. Ctrl+G, type `0x10`: it goes there. Type `ZZ`: the message, and the window stays open.
14. Repeat 1, 7, 9 and 11 in Spanish and in the dark theme. Everything can be reached by keyboard, and focus is visible.

## Speed

| Interaction | Tier | How measured |
|---|---|---|
| Open a 100,000-row CSV | Fast (1 s) | `open a 100,000-row CSV (first view)` |
| Sort a 100,000-row CSV | Waiting with feedback (10 s) | `sort a 100,000-row CSV` |
| Scrolling a table | Smooth | by hand (check 5) |
| Open a JSON file | Fast (1 s) | `open a JSON file (first view)` |
| Open a font | Fast (1 s) | `open a font (first view)` |
| Hex search through 3 MB | Fast (1 s) | `hex search through a 3 MB file` |
| Every existing measurement | as before | not more than 20% slower than the previous recorded JSON |

## Screenshots

`52-table`, `53-table-sorted`, `54-json-tree`, `55-font`, `56-hex-search` (added in T12), in English light, Spanish dark and the pseudo-locale, in `docs/screenshots/step-06f/`.

## Done when

- [ ] T1 to T12 are committed. The coordinator's full gate passes (the owner's batch decision replaces the per-task gate).
- [ ] CSV, TSV, JSON and font files open in their viewers, and files over each limit fall back as described.
- [ ] Sort, filter, find, copy and Install follow the decisions, with stale answers ignored and every session closed with its tab (P-28).
- [ ] No file is ever changed by these views, and Install only runs after its dialog.
- [ ] Fonts are parsed only in the helper process; font failures can't take the app down.
- [ ] Every new command is validated, registered and allowlisted; every text and help page exists in both languages.
- [ ] KI-032 is closed. KI-080 is untouched and still open.
- [ ] The hand checks, speed and screenshots are recorded, or plainly listed as pending.
