//! Display-only worker DTOs. Parent converts values to the frozen Office types.
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SheetMeta {
    pub index: usize,
    pub name: String,
    pub hidden: bool,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sheets {
    pub items: Vec<SheetMeta>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WindowInfo {
    pub window_id: Uuid,
    pub cell_count: usize,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cell {
    pub row: u32,
    pub column: u32,
    pub address: String,
    pub display: String,
    pub input: Value,
    pub format: Value,
    pub target_id: Option<Uuid>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cells {
    pub window_id: Uuid,
    pub start: usize,
    pub items: Vec<Cell>,
    pub next_start: Option<usize>,
}

impl Sheets {
    pub fn valid(&self) -> bool {
        !self.items.is_empty()
            && self.items.len() <= 256
            && self.items.iter().enumerate().all(|(i, s)| {
                s.index == i
                    && !s.name.is_empty()
                    && s.name.chars().count() <= 31
                    && !s.name.chars().any(char::is_control)
            })
    }
}
impl Cells {
    pub fn valid(&self, id: Uuid, start: usize) -> bool {
        self.window_id == id
            && self.start == start
            && !self.items.is_empty()
            && self.items.len() <= 8
            && self.items.iter().all(|cell| {
                cell.row < 1_048_576
                    && cell.column < 16_384
                    && cell.address.len() <= 10
                    && cell.display.len() <= 4096
                    && cell.input.is_object()
                    && cell.format.is_object()
                    && cell.format.to_string().len() <= 4096
                    && cell.target_id.is_none_or(|id| !id.is_nil())
            })
            && self
                .next_start
                .is_none_or(|next| next == start + self.items.len())
    }
}
