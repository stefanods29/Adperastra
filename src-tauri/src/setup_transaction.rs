//! Transactional setup application (Step 10e T6, D9).
//!
//! The canonical order is theme, layout, keyboard, toolbars, menus,
//! navigation, home, status. Every part is validated before the first write;
//! a durable journal records old/new hashes; a failure rolls back the written
//! prefix in reverse order with an expected-hash check, so externally changed
//! configuration is retained and reported instead of overwritten.

use std::path::Path;

use crate::setup_archive::sha256_hex;
use crate::setup_journal::{self, JournalPart, JournalState, SetupJournal};
use crate::setup_types::{is_canonical_uuid, SetupPart, MAX_SETUP_PART_BYTES};

pub const SETUP_APPLY_ORDER: [SetupPart; 8] = [
    SetupPart::Theme,
    SetupPart::Layout,
    SetupPart::Keyboard,
    SetupPart::Toolbars,
    SetupPart::Menus,
    SetupPart::Navigation,
    SetupPart::Home,
    SetupPart::Status,
];

pub struct SetupPlanPart {
    pub part: SetupPart,
    pub bytes: Vec<u8>,
}

#[derive(Debug)]
pub struct SetupTransactionResult {
    pub applied_parts: Vec<SetupPart>,
    pub journal_id: String,
    pub pending_recovery: bool,
    pub warning_codes: Vec<String>,
}

/// One canonical part writer. The coordinator wires the settings, shell and
/// theme stores; this module only orders, journals and rolls back.
pub trait SetupPartAdapter {
    fn part(&self) -> SetupPart;
    fn read(&self) -> Result<Vec<u8>, String>;
    fn validate(&self, bytes: &[u8]) -> Result<(), String>;
    fn stage(&mut self, transaction_id: &str, bytes: &[u8]) -> Result<(), String>;
    fn commit(&mut self, transaction_id: &str) -> Result<(), String>;
    /// Restore the old bytes only if the current bytes still equal `new`.
    fn rollback(&mut self, transaction_id: &str) -> Result<(), String>;
}

fn adapter_index(adapters: &[Box<dyn SetupPartAdapter>], part: SetupPart) -> Option<usize> {
    adapters.iter().position(|adapter| adapter.part() == part)
}

fn ordered(plan: Vec<SetupPlanPart>) -> Result<Vec<SetupPlanPart>, String> {
    if plan.is_empty() || plan.len() > SETUP_APPLY_ORDER.len() {
        return Err("setup.invalid".to_string());
    }
    let mut seen = Vec::new();
    let mut slots: Vec<Option<SetupPlanPart>> = SETUP_APPLY_ORDER.iter().map(|_| None).collect();
    for data in plan {
        if seen.contains(&data.part) || data.bytes.len() as u64 > MAX_SETUP_PART_BYTES {
            return Err("setup.invalid".to_string());
        }
        let index = SETUP_APPLY_ORDER
            .iter()
            .position(|part| *part == data.part)
            .ok_or_else(|| "setup.invalid".to_string())?;
        seen.push(data.part);
        slots[index] = Some(data);
    }
    Ok(slots.into_iter().flatten().collect())
}

fn restore(
    adapters: &mut [Box<dyn SetupPartAdapter>],
    attempted: &[SetupPart],
    transaction_id: &str,
) -> bool {
    for part in attempted.iter().rev() {
        if let Some(index) = adapter_index(adapters, *part) {
            if adapters[index].rollback(transaction_id).is_err() {
                return false;
            }
        }
    }
    true
}

pub fn run_setup_transaction(
    journal_directory: &Path,
    adapters: &mut [Box<dyn SetupPartAdapter>],
    plan: Vec<SetupPlanPart>,
    created_unix: u64,
) -> Result<SetupTransactionResult, String> {
    let plan = ordered(plan)?;
    // Validate everything before the first journal write or stage.
    for data in &plan {
        let index = adapter_index(adapters, data.part).ok_or_else(|| "setup.invalid".to_string())?;
        adapters[index].validate(&data.bytes)?;
    }

    let mut old_hashes: Vec<Option<String>> = Vec::new();
    for data in &plan {
        let index = adapter_index(adapters, data.part).ok_or_else(|| "setup.invalid".to_string())?;
        let old = adapters[index].read()?;
        old_hashes.push(Some(sha256_hex(&old)));
    }

    let transaction_id = uuid::Uuid::new_v4().to_string();
    if !is_canonical_uuid(&transaction_id) {
        return Err("setup.invalid".to_string());
    }
    let journal_parts: Vec<JournalPart> = plan
        .iter()
        .enumerate()
        .map(|(index, data)| JournalPart {
            part: data.part,
            old_sha256: old_hashes[index].clone(),
            new_sha256: sha256_hex(&data.bytes),
            backup_name: format!("{}.bak", data.part.id()),
        })
        .collect();
    let mut journal = SetupJournal {
        id: transaction_id.clone(),
        state: JournalState::Prepared,
        next_index: 0,
        parts: journal_parts,
        created_unix,
        restart_required: false,
    };
    setup_journal::write(journal_directory, &journal)?;

    let mut attempted: Vec<SetupPart> = Vec::new();
    for (index, data) in plan.iter().enumerate() {
        journal.state = JournalState::Applying;
        journal.next_index = index;
        setup_journal::write(journal_directory, &journal)?;
        let Some(adapter_index) = adapter_index(adapters, data.part) else {
            return Err("setup.invalid".to_string());
        };
        attempted.push(data.part);
        let staged = adapters[adapter_index].stage(&transaction_id, &data.bytes);
        let outcome = staged.and_then(|()| adapters[adapter_index].commit(&transaction_id));
        if let Err(failure) = outcome {
            if restore(adapters, &attempted, &transaction_id) {
                let _ = setup_journal::remove(journal_directory, &transaction_id);
                return Err(failure);
            }
            return Err("setup.recovery_required".to_string());
        }
        // Record the committed prefix before the next part starts, so a crash
        // here never loses the last committed part.
        journal.next_index = index + 1;
        if let Err(failure) = setup_journal::write(journal_directory, &journal) {
            if restore(adapters, &attempted, &transaction_id) {
                let _ = setup_journal::remove(journal_directory, &transaction_id);
                return Err(failure);
            }
            return Err("setup.recovery_required".to_string());
        }
    }

    journal.state = JournalState::Committed;
    journal.next_index = plan.len();
    setup_journal::write(journal_directory, &journal)?;
    let _ = setup_journal::remove(journal_directory, &transaction_id);
    Ok(SetupTransactionResult {
        applied_parts: plan.iter().map(|data| data.part).collect(),
        journal_id: transaction_id,
        pending_recovery: false,
        warning_codes: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;
    use tempfile::tempdir;

    struct FakeAdapter {
        part: SetupPart,
        current: Vec<u8>,
        pending: Option<Vec<u8>>,
        new_bytes: Option<Vec<u8>>,
        previous: Vec<u8>,
        fail_stage: bool,
        fail_commit: bool,
        external_after_commit: bool,
        log: Rc<RefCell<Vec<String>>>,
        path: std::path::PathBuf,
    }

    impl FakeAdapter {
        fn new(part: SetupPart, current: &str, log: Rc<RefCell<Vec<String>>>, dir: &Path) -> Self {
            let path = dir.join(format!("{}.txt", part.id()));
            std::fs::write(&path, current).unwrap();
            Self {
                part,
                current: current.as_bytes().to_vec(),
                pending: None,
                new_bytes: None,
                previous: current.as_bytes().to_vec(),
                fail_stage: false,
                fail_commit: false,
                external_after_commit: false,
                log,
                path,
            }
        }
    }

    impl SetupPartAdapter for FakeAdapter {
        fn part(&self) -> SetupPart {
            self.part
        }

        fn read(&self) -> Result<Vec<u8>, String> {
            Ok(self.current.clone())
        }

        fn validate(&self, bytes: &[u8]) -> Result<(), String> {
            if bytes.is_empty() {
                return Err("setup.invalid".to_string());
            }
            Ok(())
        }

        fn stage(&mut self, _transaction_id: &str, bytes: &[u8]) -> Result<(), String> {
            self.log.borrow_mut().push(format!("stage:{}", self.part.id()));
            if self.fail_stage {
                return Err("setup.io".to_string());
            }
            self.pending = Some(bytes.to_vec());
            Ok(())
        }

        fn commit(&mut self, _transaction_id: &str) -> Result<(), String> {
            self.log.borrow_mut().push(format!("commit:{}", self.part.id()));
            if self.fail_commit {
                return Err("setup.io".to_string());
            }
            let bytes = self.pending.take().ok_or_else(|| "setup.invalid".to_string())?;
            self.previous = self.current.clone();
            self.new_bytes = Some(bytes.clone());
            self.current = if self.external_after_commit {
                b"external".to_vec()
            } else {
                bytes
            };
            std::fs::write(&self.path, &self.current).unwrap();
            Ok(())
        }

        fn rollback(&mut self, _transaction_id: &str) -> Result<(), String> {
            self.log.borrow_mut().push(format!("rollback:{}", self.part.id()));
            if self.external_after_commit {
                return Err("setup.changed".to_string());
            }
            if let Some(new) = &self.new_bytes {
                if self.current != *new {
                    return Err("setup.changed".to_string());
                }
            }
            self.current = self.previous.clone();
            self.pending = None;
            self.new_bytes = None;
            std::fs::write(&self.path, &self.current).unwrap();
            Ok(())
        }
    }

    fn plan(parts: &[SetupPart]) -> Vec<SetupPlanPart> {
        parts
            .iter()
            .map(|part| SetupPlanPart {
                part: *part,
                bytes: format!("new-{}", part.id()).into_bytes(),
            })
            .collect()
    }

    #[test]
    fn failure_after_each_part_rolls_back_reverse() {
        let dir = tempdir().unwrap();
        let journal_dir = dir.path().join("journal");
        for fail_at in 0..3 {
            let log = Rc::new(RefCell::new(Vec::new()));
            let parts = [SetupPart::Theme, SetupPart::Layout, SetupPart::Keyboard];
            let mut adapters: Vec<Box<dyn SetupPartAdapter>> = parts
                .iter()
                .map(|part| {
                    let mut adapter = FakeAdapter::new(*part, "old", log.clone(), dir.path());
                    adapter.fail_commit = *part == parts[fail_at];
                    Box::new(adapter) as Box<dyn SetupPartAdapter>
                })
                .collect();
            let result = run_setup_transaction(&journal_dir, &mut adapters, plan(&parts), 1);
            assert!(result.is_err());
            let messages = log.borrow();
            let rollbacks: Vec<&String> = messages.iter().filter(|line| line.starts_with("rollback:")).collect();
            let expected: Vec<String> = parts[..=fail_at]
                .iter()
                .rev()
                .map(|part| format!("rollback:{}", part.id()))
                .collect();
            assert_eq!(rollbacks, expected.iter().collect::<Vec<&String>>());
            for part in parts {
                assert_eq!(std::fs::read(dir.path().join(format!("{}.txt", part.id()))).unwrap(), b"old");
            }
            assert!(crate::setup_journal::list_pending(&journal_dir).is_empty());
        }
    }

    #[test]
    fn externally_changed_config_retained_with_recovery() {
        let dir = tempdir().unwrap();
        let journal_dir = dir.path().join("journal");
        let log = Rc::new(RefCell::new(Vec::new()));
        let mut first = FakeAdapter::new(SetupPart::Theme, "old", log.clone(), dir.path());
        first.external_after_commit = true;
        let mut second = FakeAdapter::new(SetupPart::Layout, "old", log.clone(), dir.path());
        second.fail_commit = true;
        let mut adapters: Vec<Box<dyn SetupPartAdapter>> = vec![Box::new(first), Box::new(second)];
        let result = run_setup_transaction(
            &journal_dir,
            &mut adapters,
            plan(&[SetupPart::Theme, SetupPart::Layout]),
            1,
        );
        assert_eq!(result.unwrap_err(), "setup.recovery_required");
        assert_eq!(std::fs::read(dir.path().join("theme.txt")).unwrap(), b"external");
        assert_eq!(crate::setup_journal::list_pending(&journal_dir).len(), 1);
    }

    #[test]
    fn commit_order_is_fixed() {
        let dir = tempdir().unwrap();
        let log = Rc::new(RefCell::new(Vec::new()));
        let parts = [SetupPart::Layout, SetupPart::Theme, SetupPart::Keyboard];
        let mut adapters: Vec<Box<dyn SetupPartAdapter>> = parts
            .iter()
            .map(|part| Box::new(FakeAdapter::new(*part, "old", log.clone(), dir.path())) as Box<dyn SetupPartAdapter>)
            .collect();
        let result = run_setup_transaction(
            &dir.path().join("journal"),
            &mut adapters,
            plan(&[SetupPart::Keyboard, SetupPart::Theme, SetupPart::Layout]),
            1,
        )
        .unwrap();
        assert_eq!(result.applied_parts, vec![SetupPart::Theme, SetupPart::Layout, SetupPart::Keyboard]);
        let commits: Vec<String> = log
            .borrow()
            .iter()
            .filter(|line| line.starts_with("commit:"))
            .cloned()
            .collect();
        assert_eq!(commits, vec!["commit:theme", "commit:layout", "commit:keyboard"]);
    }
}
