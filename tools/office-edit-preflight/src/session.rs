use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};
use uuid::Uuid;

use crate::{rewrite, Replacement, Result, MAX_ARCHIVE};

// Full snapshots keep the experiment's undo exact. Cap retained history.
const HISTORY: usize = 3;
const MAX_SELECTIONS: usize = 256;

struct Selection {
    part: String,
    target: String,
}

#[derive(serde::Serialize)]
pub struct ListedSelection {
    pub ordinal: usize,
    pub id: Uuid,
    pub text: String,
    pub address: Option<String>,
}

pub struct Session<'a> {
    kind: &'a str,
    revision: u64,
    selections: HashMap<Uuid, Selection>,
    current: Arc<[u8]>,
    undo: Vec<Arc<[u8]>>,
    redo: Vec<Arc<[u8]>>,
}

impl<'a> Session<'a> {
    pub fn sheet_targets(
        &mut self,
        expected: u64,
        index: usize,
        addresses: &[String],
    ) -> Result<HashMap<String, Uuid>> {
        self.check(expected)?;
        if self.kind != "xlsx" || addresses.len() > 2000 {
            return Err("selection limit".into());
        }
        let part = crate::parts::resolve_part(self.kind, &self.current, index)?;
        let mut selections = HashMap::new();
        let mut ids = HashMap::new();
        for address in addresses {
            if crate::sheet_view::point(address).is_none() || ids.contains_key(address) {
                return Err("invalid cell selection".into());
            }
            let id = Uuid::new_v4();
            selections.insert(
                id,
                Selection {
                    part: part.clone(),
                    target: address.clone(),
                },
            );
            ids.insert(address.clone(), id);
        }
        self.selections = selections;
        Ok(ids)
    }
    pub fn kind(&self) -> &str {
        self.kind
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn new(kind: &'a str, input: Vec<u8>) -> Result<Self> {
        if input.len() > MAX_ARCHIVE {
            return Err("archive too large".into());
        }
        Ok(Self {
            kind,
            revision: 1,
            selections: HashMap::new(),
            current: input.into(),
            undo: Vec::new(),
            redo: Vec::new(),
        })
    }

    fn check(&self, expected: u64) -> Result<()> {
        if expected != self.revision {
            return Err("stale revision".into());
        }
        Ok(())
    }

    fn next(&self, expected: u64) -> Result<u64> {
        self.check(expected)?;
        self.revision
            .checked_add(1)
            .ok_or_else(|| "revision limit".into())
    }

    fn push_undo(&mut self, bytes: Arc<[u8]>) {
        if self.undo.len() == HISTORY {
            self.undo.remove(0);
        }
        self.undo.push(bytes);
    }

    pub fn capture(&self, expected: u64) -> Result<Arc<[u8]>> {
        self.check(expected)?;
        Ok(self.current.clone())
    }

    pub fn list(
        &mut self,
        expected: u64,
        index: usize,
        start: usize,
    ) -> Result<Vec<ListedSelection>> {
        self.list_page(expected, index, start, MAX_SELECTIONS)
    }

    pub fn list_page(
        &mut self,
        expected: u64,
        index: usize,
        start: usize,
        limit: usize,
    ) -> Result<Vec<ListedSelection>> {
        self.check(expected)?;
        if !(1..=MAX_SELECTIONS).contains(&limit) {
            return Err("invalid page size".into());
        }
        let part = crate::parts::resolve_part(self.kind, &self.current, index)?;
        let mut targets = crate::targets::list(self.kind, &self.current, &part, start)?;
        targets.truncate(limit);
        let new_targets = targets
            .iter()
            .filter(|target| {
                !self
                    .selections
                    .values()
                    .any(|selection| selection.part == part && selection.target == target.key)
            })
            .count();
        if self.selections.len() + new_targets > MAX_SELECTIONS {
            return Err("selection limit".into());
        }
        let mut listed = Vec::with_capacity(targets.len());
        for target in targets {
            let id = self
                .selections
                .iter()
                .find_map(|(id, selection)| {
                    (selection.part == part && selection.target == target.key).then_some(*id)
                })
                .unwrap_or_else(Uuid::new_v4);
            let address = (self.kind == "xlsx").then(|| target.key.clone());
            self.selections.insert(
                id,
                Selection {
                    part: part.clone(),
                    target: target.key,
                },
            );
            listed.push(ListedSelection {
                ordinal: target.ordinal,
                id,
                text: target.text,
                address,
            });
        }
        Ok(listed)
    }

    pub fn select(&mut self, expected: u64, index: usize, target: &str) -> Result<Uuid> {
        self.check(expected)?;
        if target.is_empty() || target.len() > 64 || self.selections.len() >= MAX_SELECTIONS {
            return Err("invalid selection or selection limit".into());
        }
        let part = crate::parts::resolve_part(self.kind, &self.current, index)?;
        let id = Uuid::new_v4();
        self.selections.insert(
            id,
            Selection {
                part,
                target: target.to_owned(),
            },
        );
        Ok(id)
    }

    pub fn edit(&mut self, expected: u64, selection: Uuid, value: Replacement<'_>) -> Result<()> {
        self.edit_many(expected, &[(selection, value)], || false)
    }

    pub fn edit_many(
        &mut self,
        expected: u64,
        operations: &[(Uuid, Replacement<'_>)],
        cancelled: impl Fn() -> bool,
    ) -> Result<()> {
        let next = self.next(expected)?;
        if operations.is_empty() || operations.len() > 16 {
            return Err("unsupported transaction size".into());
        }
        let mut candidate: Option<Vec<u8>> = None;
        let mut touched = HashSet::new();
        for &(id, value) in operations {
            if cancelled() {
                return Err("cancelled".into());
            }
            let selection = self
                .selections
                .get(&id)
                .ok_or("selection does not belong to this revision")?;
            let key = if self.kind == "xlsx" {
                selection.target.clone()
            } else {
                selection
                    .target
                    .split(':')
                    .next()
                    .ok_or("invalid target")?
                    .parse::<usize>()?
                    .to_string()
            };
            if !touched.insert((&selection.part, key)) {
                return Err("overlapping targets must be coalesced".into());
            }
            let previous = candidate.as_deref().unwrap_or(self.current.as_ref());
            candidate = Some(rewrite(
                self.kind,
                previous,
                &selection.part,
                &selection.target,
                value,
            )?);
        }
        if cancelled() {
            return Err("cancelled".into());
        }
        let candidate = candidate.ok_or("empty transaction")?;
        let previous = std::mem::replace(&mut self.current, candidate.into());
        self.push_undo(previous);
        self.redo.clear();
        self.selections.clear();
        self.revision = next;
        Ok(())
    }

    pub fn undo(&mut self, expected: u64) -> Result<()> {
        let next = self.next(expected)?;
        let previous = self.undo.pop().ok_or("no undo")?;
        self.redo
            .push(std::mem::replace(&mut self.current, previous));
        self.selections.clear();
        self.revision = next;
        Ok(())
    }

    pub fn redo(&mut self, expected: u64) -> Result<()> {
        let next = self.next(expected)?;
        let later = self.redo.pop().ok_or("no redo")?;
        let previous = std::mem::replace(&mut self.current, later);
        self.push_undo(previous);
        self.selections.clear();
        self.revision = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::{write::SimpleFileOptions, ZipWriter};

    #[test]
    fn pagination_retains_revision_bound_selection_identity() {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file("word/document.xml", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(format!("<w:document xmlns:w=\"{}\"><w:body><w:p><w:r><w:t>alpha</w:t></w:r><w:r><w:t>beta</w:t></w:r></w:p></w:body></w:document>", crate::WORD).as_bytes()).unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let mut session = Session::new("docx", bytes).unwrap();
        let first = session.list_page(1, 0, 0, 1).unwrap();
        let id = first[0].id;
        assert_eq!(session.list_page(1, 0, 1, 1).unwrap()[0].text, "beta");
        assert!(session.selections.contains_key(&id));
        assert_eq!(session.list_page(1, 0, 0, 1).unwrap()[0].id, id);
        assert!(session.list_page(2, 0, 0, 1).is_err());
    }
}
