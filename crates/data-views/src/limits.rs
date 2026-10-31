//! Limits for the data viewers (Step 06f D3, D8). Every number here is a
//! hard stop: reaching one stops the work and says so, it never hides data.

/// The largest file the table viewer opens, in bytes.
pub const MAX_TABLE_FILE: u64 = 134_217_728;
/// The most rows a table keeps.
pub const MAX_TABLE_ROWS: usize = 2_000_000;
/// The most columns a table keeps.
pub const MAX_TABLE_COLUMNS: usize = 2_000;
/// The most cells a table keeps.
pub const MAX_TABLE_CELLS: usize = 20_000_000;
/// The most rows one page answer carries (P-10).
pub const MAX_PAGE_ROWS: usize = 500;
/// The most characters one cell answer carries.
pub const MAX_CELL_CHARS: usize = 2_000;
/// The largest file the JSON tree opens, in bytes.
pub const MAX_JSON_FILE: u64 = 33_554_432;
/// The most JSON nodes the tree keeps.
pub const MAX_JSON_NODES: usize = 5_000_000;
/// The most children one JSON page carries.
pub const MAX_JSON_PAGE: usize = 1_000;
/// The most characters a string preview carries.
pub const MAX_JSON_PREVIEW: usize = 300;
/// The most characters one copied JSON value carries.
pub const MAX_JSON_COPY: usize = 1_048_576;
/// The longest search text the commands accept.
pub const MAX_SEARCH_CHARS: usize = 200;
