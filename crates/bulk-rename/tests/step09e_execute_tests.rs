//! Injected object store tests. Real Windows handle/race tests remain a coordinator
//! dependency gate; these tests do not pretend to establish Windows behavior.
use bulk_rename::{executor::*, journal::*, types::*};
use fs_service::SourceStamp;
use std::{cell::RefCell, collections::BTreeMap, rc::Rc};
use uuid::Uuid;

#[derive(Default)]
struct Disk {
    objects: BTreeMap<usize, String>,
    calls: usize,
    fail_call: Option<usize>,
    foreign: Vec<String>,
    swap: bool,
}
struct Fs(Rc<RefCell<Disk>>);
struct Guards(Rc<RefCell<Disk>>);
impl RenameFilesystem for Fs {
    type Guards = Guards;
    fn guard_all(&mut self, effects: &[RenameEffect]) -> Result<Guards, String> {
        let disk = self.0.borrow();
        if disk.swap
            || effects
                .iter()
                .enumerate()
                .any(|(i, e)| disk.objects.get(&i) != Some(&e.original_path))
        {
            return Err("rename.changed".into());
        }
        Ok(Guards(self.0.clone()))
    }
}
impl GuardedRename for Guards {
    fn current_path(&self, i: usize) -> Result<String, String> {
        self.0
            .borrow()
            .objects
            .get(&i)
            .cloned()
            .ok_or("rename.changed".into())
    }
    fn rename_no_replace(&mut self, i: usize, target: &str) -> Result<(), String> {
        let mut disk = self.0.borrow_mut();
        disk.calls += 1;
        if disk.fail_call == Some(disk.calls) {
            return Err("rename.failed".into());
        }
        if disk.foreign.iter().any(|p| p == target) || disk.objects.values().any(|p| p == target) {
            return Err("rename.conflict".into());
        }
        disk.objects.insert(i, target.into());
        Ok(())
    }
}
#[derive(Default)]
struct Store {
    writes: usize,
    fail_write: Option<usize>,
    last: Option<RenameJournal>,
}
impl JournalStore for Store {
    fn reserve(&mut self, _: Uuid, bytes: usize) -> Result<(), String> {
        assert_eq!(bytes, MAX_PLAN_BYTES);
        Ok(())
    }
    fn save(&mut self, journal: &RenameJournal, _: &[u8]) -> Result<(), String> {
        self.writes += 1;
        if self.fail_write == Some(self.writes) {
            return Err("rename.journal_failed".into());
        }
        self.last = Some(journal.clone());
        Ok(())
    }
}
fn effect(index: usize, from: &str, to: &str) -> RenameEffect {
    RenameEffect {
        source: SourceStamp {
            path_key: from.into(),
            volume_id: "00000001".into(),
            file_id: format!("{index:016x}"),
            modified_ticks: "133000000000000001".into(),
            size_bytes: 1,
        },
        original_path: from.into(),
        current_path: from.into(),
        target_path: to.into(),
        status: RenameEffectStatus::Renamed,
        reason: None,
    }
}
fn setup() -> (Fs, Store, Vec<RenameEffect>) {
    let effects = vec![
        effect(0, r"C:\fixture\a.txt", r"C:\fixture\b.txt"),
        effect(1, r"C:\fixture\b.txt", r"C:\fixture\a.txt"),
    ];
    let objects = effects
        .iter()
        .enumerate()
        .map(|(i, e)| (i, e.original_path.clone()))
        .collect();
    (
        Fs(Rc::new(RefCell::new(Disk {
            objects,
            ..Default::default()
        }))),
        Store::default(),
        effects,
    )
}
#[test]
fn a_b_contents_remain_attached_to_same_objects() {
    let (mut fs, mut store, effects) = setup();
    let report = execute(Uuid::new_v4(), effects, 0, &mut fs, &mut store, || false).unwrap();
    assert_eq!(fs.0.borrow().objects[&0], r"C:\fixture\b.txt");
    assert_eq!(fs.0.borrow().objects[&1], r"C:\fixture\a.txt");
    assert_eq!(report.done, 2);
    assert!(store
        .last
        .unwrap()
        .intents
        .iter()
        .all(|i| i.state == IntentState::Completed));
}
#[test]
fn case_only_name_works() {
    let (mut fs, mut store, mut effects) = setup();
    effects[0].target_path = r"C:\fixture\A.txt".into();
    effects.truncate(1);
    let report = execute(Uuid::new_v4(), effects, 0, &mut fs, &mut store, || false).unwrap();
    assert_eq!(report.effects[0].current_path, r"C:\fixture\A.txt");
}
#[test]
fn source_identity_swap_before_guard_changes_nothing() {
    let (mut fs, mut store, effects) = setup();
    fs.0.borrow_mut().swap = true;
    assert_eq!(
        execute(Uuid::new_v4(), effects, 0, &mut fs, &mut store, || false).unwrap_err(),
        "rename.changed"
    );
    assert_eq!(fs.0.borrow().calls, 0);
    assert_eq!(store.writes, 0);
}
#[test]
fn journal_failure_before_mutation() {
    let (mut fs, mut store, effects) = setup();
    store.fail_write = Some(1);
    assert_eq!(
        execute(Uuid::new_v4(), effects, 0, &mut fs, &mut store, || false).unwrap_err(),
        "rename.journal_failed"
    );
    assert_eq!(fs.0.borrow().calls, 0);
}
#[test]
fn journal_growth_is_reserved_before_mutation() {
    let (mut fs, mut store, _) = setup();
    let long_parent = format!("C:\\fixture\\{}", vec!["a".repeat(250); 10].join("\\"));
    let effects: Vec<_> = (0..400)
        .map(|index| {
            effect(
                index,
                &format!("{long_parent}\\{index}.txt"),
                &format!("{long_parent}\\new-{index}.txt"),
            )
        })
        .collect();
    fs.0.borrow_mut().objects = effects
        .iter()
        .enumerate()
        .map(|(i, e)| (i, e.original_path.clone()))
        .collect();
    let result = execute(Uuid::new_v4(), effects, 0, &mut fs, &mut store, || false);
    assert_eq!(result.unwrap_err(), "rename.journal_failed");
    assert_eq!(fs.0.borrow().calls, 0);
    assert_eq!(store.writes, 0);
}
#[test]
fn new_foreign_original_on_rollback_kept() {
    let (mut fs, mut store, effects) = setup();
    let disk = fs.0.clone();
    let report = execute(Uuid::new_v4(), effects, 0, &mut fs, &mut store, || {
        let mut d = disk.borrow_mut();
        if d.calls == 2 {
            d.foreign.push(r"C:\fixture\a.txt".into());
            return true;
        }
        false
    })
    .unwrap();
    assert!(report.recovery_required);
    assert!(disk
        .borrow()
        .foreign
        .contains(&r"C:\fixture\a.txt".to_owned()));
    assert!(disk.borrow().objects[&0].contains("~adp-rename-"));
    for (index, effect) in report.effects.iter().enumerate() {
        assert_eq!(effect.current_path, disk.borrow().objects[&index]);
    }
}
#[test]
fn cancel_never_deletes_user_intermediate() {
    let (mut fs, mut store, effects) = setup();
    let disk = fs.0.clone();
    let report = execute(Uuid::new_v4(), effects, 0, &mut fs, &mut store, || {
        disk.borrow().calls == 1
    })
    .unwrap();
    assert!(report.cancelled);
    assert_eq!(disk.borrow().objects.len(), 2);
    assert_eq!(disk.borrow().objects[&0], r"C:\fixture\a.txt");
}
#[test]
fn completion_write_failure_retains_actual_location_and_intent() {
    let (mut fs, mut store, effects) = setup();
    store.fail_write = Some(3);
    let report = execute(Uuid::new_v4(), effects, 0, &mut fs, &mut store, || false).unwrap();
    assert!(report.recovery_required);
    assert_eq!(fs.0.borrow().calls, 1);
    assert_eq!(report.effects[0].current_path, fs.0.borrow().objects[&0]);
}
fn candidate(after_syscall: bool, completed: bool) {
    let intent = RenameIntent {
        sequence: 0,
        input_index: 0,
        old_path: "old".into(),
        new_path: "new".into(),
        volume_id: "00000001".into(),
        file_id: "0000000000000001".into(),
        state: if completed {
            IntentState::Completed
        } else {
            IntentState::Intent
        },
    };
    let actual = if after_syscall { "new" } else { "old" };
    let recovered = recover_candidate(&intent, |path| {
        let mut stamp = effect(1, path, path).source;
        if path != actual {
            stamp.file_id = "0000000000000099".into();
        }
        Ok(Some(stamp))
    })
    .unwrap();
    assert_eq!(recovered, actual);
}
#[test]
fn crash_after_intent() {
    candidate(false, false);
}
#[test]
fn crash_after_syscall() {
    candidate(true, false);
}
#[test]
fn crash_before_completion() {
    candidate(true, false);
}
#[test]
fn crash_before_intent() {
    let (mut fs, mut store, effects) = setup();
    store.fail_write = Some(2);
    let report = execute(Uuid::new_v4(), effects, 0, &mut fs, &mut store, || false).unwrap();
    assert_eq!(fs.0.borrow().calls, 0);
    assert_eq!(report.effects[0].current_path, r"C:\fixture\a.txt");
}
