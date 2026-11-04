//! Step 16 T1 tests: the owned registration ledger. Included by
//! `registry_ledger.rs`; the in-memory backend never touches the user's real
//! registry.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use super::{
    identity, BackendCounters, RegistryBackend, RegistryLedger, StoredValue,
};
use crate::windows_integration::{
    apply, build_plan, restore_with_backend, status, write_owned_value,
};
use crate::windows_integration_types::{
    is_owned_key, IntegrationRequest, RegistryOwnedValue, RegistryValueType,
};

#[derive(Clone, Default)]
struct MemoryRegistry {
    values: Arc<Mutex<BTreeMap<String, StoredValue>>>,
    counters: Arc<BackendCounters>,
}

impl MemoryRegistry {
    /// A value another program wrote; the test seeds it directly.
    fn seed(&self, key: &str, name: &str, value: StoredValue) {
        self.values
            .lock()
            .expect("memory registry lock")
            .insert(identity(key, name), value);
    }

    fn get(&self, key: &str, name: &str) -> Option<StoredValue> {
        self.values
            .lock()
            .expect("memory registry lock")
            .get(&identity(key, name))
            .cloned()
    }

    fn counters(&self) -> &BackendCounters {
        self.counters.as_ref()
    }
}

impl RegistryBackend for MemoryRegistry {
    fn read(&self, key: &str, name: &str) -> Result<Option<StoredValue>, String> {
        self.counters.record_read();
        Ok(self.get(key, name))
    }

    fn write(&self, key: &str, name: &str, value: &StoredValue) -> Result<(), String> {
        self.counters.record_write();
        self.values
            .lock()
            .expect("memory registry lock")
            .insert(identity(key, name), value.clone());
        Ok(())
    }

    fn delete(&self, key: &str, name: &str) -> Result<(), String> {
        self.counters.record_delete();
        self.values
            .lock()
            .expect("memory registry lock")
            .remove(&identity(key, name));
        Ok(())
    }
}

fn exe() -> PathBuf {
    PathBuf::from(r"C:\Program Files\Adperastra\Adperastra.exe")
}

fn request(classic: bool, extensions: &[&str], start: bool) -> IntegrationRequest {
    IntegrationRequest {
        classic_enabled: classic,
        extensions: extensions
            .iter()
            .map(|extension| (*extension).to_string())
            .collect(),
        start_with_windows: start,
        modern_requested: false,
    }
}

const VERSION: &str = "0.4.0";

#[test]
fn userchoice_untouched() {
    let backend = MemoryRegistry::default();
    let user_choice_key =
        "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.txt\\UserChoice";
    backend.seed(
        user_choice_key,
        "ProgId",
        StoredValue::string("AppX1234567890"),
    );

    let ledger = apply(
        &backend,
        RegistryLedger::default(),
        &request(false, &["txt"], false),
        &exe(),
        VERSION,
    )
    .expect("the association request succeeds");

    assert_eq!(
        backend.get(user_choice_key, "ProgId"),
        Some(StoredValue::string("AppX1234567890")),
        "UserChoice is never read as ours or rewritten"
    );
    assert!(!is_owned_key(user_choice_key));
    assert!(ledger
        .values
        .iter()
        .all(|value| !value.key.eq_ignore_ascii_case(user_choice_key)));

    let refused = write_owned_value(
        &backend,
        user_choice_key,
        "ProgId",
        &StoredValue::string("Hijacked.App"),
    );
    assert_eq!(
        refused,
        Err("windows_integration.bad_request".to_string())
    );
    assert_eq!(
        backend.get(user_choice_key, "ProgId"),
        Some(StoredValue::string("AppX1234567890"))
    );
}

#[test]
fn foreign_changed_key_preserved() {
    let backend = MemoryRegistry::default();
    let ledger = apply(
        &backend,
        RegistryLedger::default(),
        &request(false, &["txt"], false),
        &exe(),
        VERSION,
    )
    .expect("the association request succeeds");

    let open_with = "Software\\Classes\\.txt\\OpenWithProgids";
    let value_name = "Adperastra.File.txt";
    // Another program replaced our value after it was installed.
    backend.seed(open_with, value_name, StoredValue::string("Other.App.txt"));

    let (restored_ledger, restored_status) =
        restore_with_backend(&backend, &ledger).expect("restore succeeds");

    assert_eq!(
        backend.get(open_with, value_name),
        Some(StoredValue::string("Other.App.txt")),
        "a foreign replacement is preserved"
    );
    assert!(restored_status.associations.is_empty());
    assert!(restored_ledger.is_empty());
    // Our own ProgID key is removed because it still matched.
    assert_eq!(
        backend.get("Software\\Classes\\Adperastra.File.txt", ""),
        None
    );
}

#[test]
fn disable_restores_exactpreviousvalue() {
    let backend = MemoryRegistry::default();
    let open_with = "Software\\Classes\\.txt\\OpenWithProgids";
    let value_name = "Adperastra.File.txt";
    let run_key = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    let previous_run = StoredValue::string(r#""C:\Old\Adperastra.exe" --background"#);
    // A previous install used a different Windows type for the same name.
    backend.seed(
        open_with,
        value_name,
        StoredValue::expand_string("Old.Handler"),
    );
    backend.seed(run_key, "Adperastra", previous_run.clone());

    let ledger = apply(
        &backend,
        RegistryLedger::default(),
        &request(true, &["txt"], true),
        &exe(),
        VERSION,
    )
    .expect("the full request succeeds");
    assert_eq!(
        backend.get(open_with, value_name),
        Some(StoredValue::none())
    );
    assert!(ledger
        .values
        .iter()
        .any(|value| value.key.eq_ignore_ascii_case(open_with)
            && value.previous_value_type == Some(RegistryValueType::ExpandString)));

    let disabled = apply(
        &backend,
        ledger,
        &request(false, &[], false),
        &exe(),
        VERSION,
    )
    .expect("disable succeeds");

    assert_eq!(
        backend.get(open_with, value_name),
        Some(StoredValue::expand_string("Old.Handler")),
        "the exact previous bytes and type come back"
    );
    assert_eq!(
        backend.get(run_key, "Adperastra"),
        Some(previous_run),
        "the previous start-with-Windows value comes back"
    );
    assert_eq!(
        backend.get("Software\\Classes\\Adperastra.File.txt", ""),
        None,
        "a value that did not exist before is removed"
    );
    assert!(disabled.is_empty());
}

#[test]
fn selection257_refused() {
    let backend = MemoryRegistry::default();
    let extensions = vec!["txt".to_string(); 257];
    let oversized = IntegrationRequest {
        classic_enabled: false,
        extensions,
        start_with_windows: false,
        modern_requested: false,
    };
    let error = apply(
        &backend,
        RegistryLedger::default(),
        &oversized,
        &exe(),
        VERSION,
    )
    .expect_err("257 selections are refused");
    assert_eq!(error, "windows_integration.bad_request");
    assert_eq!(backend.counters().reads(), 0, "no registry read happens");
    assert_eq!(backend.counters().writes(), 0);
    assert_eq!(backend.counters().deletes(), 0);
}

#[test]
fn plan_never_contains_user_choice_or_fileexts() {
    let plan = build_plan(
        &exe(),
        VERSION,
        &request(true, &["txt", "md"], true),
    )
    .expect("the plan builds");
    for planned in &plan {
        let key = planned.key.to_ascii_lowercase();
        assert!(!key.contains("userchoice"));
        assert!(!key.contains("fileexts"));
        assert!(!planned.name.eq_ignore_ascii_case("UserChoice"));
    }
    assert!(plan
        .iter()
        .any(|planned| planned.key.ends_with("\\OpenWithProgids")
            && planned.name == "Adperastra.File.txt"));
}

#[test]
fn status_does_not_claim_a_foreign_value() {
    let backend = MemoryRegistry::default();
    let ledger = apply(
        &backend,
        RegistryLedger::default(),
        &request(false, &["txt"], false),
        &exe(),
        VERSION,
    )
    .expect("the association request succeeds");
    let open_with = "Software\\Classes\\.txt\\OpenWithProgids";
    backend.seed(
        open_with,
        "Adperastra.File.txt",
        StoredValue::string("Other.App.txt"),
    );
    let current = status(&backend, &ledger);
    assert!(current.associations.is_empty());
    assert_eq!(
        current.reason_code.as_deref(),
        Some("windows_integration.changed")
    );
    // The ledger row is still owned by us, but it is not reported enabled.
    assert!(ledger.values.iter().any(|value: &RegistryOwnedValue| {
        value.key.eq_ignore_ascii_case(open_with)
    }));
}
