use super::{
    decide, BackgroundReason, BackgroundSettings, CacheSettings, PolicyInputs, IDLE_AFTER_MS,
};

fn inputs() -> PolicyInputs {
    PolicyInputs {
        enabled: true,
        only_idle: false,
        only_ac: false,
        paused: false,
        task_enabled: true,
    }
}

#[test]
fn idle_starts_exactly_at_thirty_seconds() {
    let idle = PolicyInputs {
        only_idle: true,
        ..inputs()
    };
    assert_eq!(
        decide(idle, IDLE_AFTER_MS - 1, Some(true)),
        BackgroundReason::Idle
    );
    assert_eq!(
        decide(idle, IDLE_AFTER_MS, Some(true)),
        BackgroundReason::None
    );
}

#[test]
fn only_ac_with_unknown_power_is_ineligible() {
    let ac = PolicyInputs {
        only_ac: true,
        ..inputs()
    };
    assert_eq!(decide(ac, 60_000, None), BackgroundReason::Ac);
    assert_eq!(decide(ac, 60_000, Some(false)), BackgroundReason::Ac);
    assert_eq!(decide(ac, 60_000, Some(true)), BackgroundReason::None);
}

#[test]
fn paused_always_wins() {
    let paused = PolicyInputs {
        paused: true,
        ..inputs()
    };
    assert_eq!(decide(paused, 60_000, Some(true)), BackgroundReason::Paused);
    assert_ne!(decide(paused, 60_000, Some(true)), BackgroundReason::None);
}

#[test]
fn settings_defaults_and_validation() {
    let settings = BackgroundSettings::default();
    assert!(settings.enabled);
    assert!(settings.task_enabled(super::BackgroundTaskKind::Thumbnails));
    assert!(!settings.task_enabled(super::BackgroundTaskKind::FolderSizes));
    assert!(settings.validate().is_ok());
    let mut bad = settings;
    bad.tasks.insert("not_a_task".to_string(), true);
    assert!(bad.validate().is_err());
    assert_eq!(CacheSettings::default().max_mb, 512);
    assert!(CacheSettings { max_mb: 300 }.validate().is_err());
    assert!(CacheSettings { max_mb: 2048 }.validate().is_ok());
}
