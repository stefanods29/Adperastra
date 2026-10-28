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
/// Allocation-free: sorting 100,000 names calls this per comparison.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut i, mut j) = (0usize, 0usize);
    while i < a.len() && j < b.len() {
        let ca = a[i..].chars().next().expect("i is a char boundary");
        let cb = b[j..].chars().next().expect("j is a char boundary");
        if ca.is_ascii_digit() && cb.is_ascii_digit() {
            let run_a = digit_run_end(a, i);
            let run_b = digit_run_end(b, j);
            let num_a = a[i..run_a].trim_start_matches('0');
            let num_b = b[j..run_b].trim_start_matches('0');
            let ord = num_a.len().cmp(&num_b.len()).then_with(|| num_a.cmp(num_b));
            if ord != Ordering::Equal {
                return ord;
            }
            i = run_a;
            j = run_b;
        } else {
            let lower_a = ca.to_lowercase().next().unwrap_or(ca);
            let lower_b = cb.to_lowercase().next().unwrap_or(cb);
            match lower_a.cmp(&lower_b) {
                Ordering::Equal => {
                    i += ca.len_utf8();
                    j += cb.len_utf8();
                }
                ord => return ord,
            }
        }
    }
    (a.len() - i).cmp(&(b.len() - j))
}

fn digit_run_end(text: &str, start: usize) -> usize {
    let mut end = start;
    for ch in text[start..].chars() {
        if !ch.is_ascii_digit() {
            break;
        }
        end += ch.len_utf8();
    }
    end
}
/// What the Type column groups by: the file extension, lowercased.
fn type_key(item: &Item) -> String {
    if item.kind == ItemKind::Folder {
        return String::new();
    }
    item.name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_lowercase())
        .unwrap_or_default()
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
            SortKey::Kind => type_key(x).cmp(&type_key(y)),
        };
        let directed = match spec.direction {
            SortDirection::Ascending => key_ord,
            SortDirection::Descending => key_ord.reverse(),
        };
        directed.then_with(|| natural_cmp(&x.name, &y.name))
    });
}
