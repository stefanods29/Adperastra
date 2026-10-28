use crate::item::{Item, ItemKind};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortKey {
    Name,
    Modified,
    Size,
    Kind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Ascending,
    Descending,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SortSpec {
    pub key: SortKey,
    pub direction: SortDirection,
}

impl Default for SortSpec {
    fn default() -> Self {
        Self {
            key: SortKey::Name,
            direction: SortDirection::Ascending,
        }
    }
}

/// Natural, case-insensitive name comparison: runs of digits compare by
/// numeric value (`file2 < file10`), letters ignore case. Leading zeros do
/// not affect the result (`a01 == a1`), matching Windows Explorer ordering.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let (mut i, mut j) = (0usize, 0usize);
    while i < a.len() && j < b.len() {
        if a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let start_a = i;
            while i < a.len() && a[i].is_ascii_digit() {
                i += 1;
            }
            let start_b = j;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            let num_a: String = a[start_a..i]
                .iter()
                .collect::<String>()
                .trim_start_matches('0')
                .to_string();
            let num_b: String = b[start_b..j]
                .iter()
                .collect::<String>()
                .trim_start_matches('0')
                .to_string();
            let ord = num_a
                .len()
                .cmp(&num_b.len())
                .then_with(|| num_a.cmp(&num_b));
            if ord != Ordering::Equal {
                return ord;
            }
        } else {
            let ord = a[i].to_lowercase().cmp(b[j].to_lowercase());
            if ord != Ordering::Equal {
                return ord;
            }
            i += 1;
            j += 1;
        }
    }
    (a.len() - i).cmp(&(b.len() - j))
}

/// Sort in place: folders always group first (Windows Explorer behaviour,
/// in both directions), then by the requested key; natural name breaks ties.
pub fn sort_items(items: &mut [Item], spec: SortSpec) {
    items.sort_by(|x, y| {
        let group = |it: &Item| if it.kind == ItemKind::Folder { 0 } else { 1 };
        let ord = group(x).cmp(&group(y));
        if ord != Ordering::Equal {
            return ord;
        }
        let key_ord = match spec.key {
            SortKey::Name => natural_cmp(&x.name, &y.name),
            SortKey::Modified => x.modified_unix.cmp(&y.modified_unix),
            SortKey::Size => x.size.cmp(&y.size),
            SortKey::Kind => format!("{:?}", x.kind).cmp(&format!("{:?}", y.kind)),
        };
        let directed = match spec.direction {
            SortDirection::Ascending => key_ord,
            SortDirection::Descending => key_ord.reverse(),
        };
        directed.then_with(|| natural_cmp(&x.name, &y.name))
    });
}
