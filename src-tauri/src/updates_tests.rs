use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

struct FakeTransport {
    body: Vec<u8>,
    calls: AtomicUsize,
}

impl FakeTransport {
    fn new(body: Vec<u8>) -> Self {
        Self {
            body,
            calls: AtomicUsize::new(0),
        }
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl ReleaseTransport for FakeTransport {
    fn fetch_latest(&self) -> Result<Vec<u8>, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self.body.clone())
    }
}

fn payload(tag: &str, url: &str, draft: bool, prerelease: bool) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "tag_name": tag,
        "html_url": url,
        "draft": draft,
        "prerelease": prerelease,
    }))
    .unwrap()
}

fn release_url() -> &'static str {
    "https://github.com/stefanods29/Adperastra/releases/tag/v0.1.0"
}

#[test]
fn default_settings_contact_nothing() {
    let transport = FakeTransport::new(payload("v0.1.0", release_url(), false, false));
    assert_eq!(
        check_with_transport(
            &transport,
            "0.1.0",
            &UpdateSettings::default(),
            false,
            1_000,
        ),
        Err("updates.disabled".to_string())
    );
    assert_eq!(transport.calls(), 0);
}

#[test]
fn automatic_checks_are_limited_to_once_a_day() {
    let transport = FakeTransport::new(payload("v0.1.0", release_url(), false, false));
    let settings = UpdateSettings {
        enabled: true,
        last_seen_version: String::new(),
        last_check_unix: 10_000,
    };
    assert_eq!(
        check_with_transport(&transport, "0.1.0", &settings, false, 10_000 + 86_399),
        Err("updates.rate_limited".to_string())
    );
    assert_eq!(transport.calls(), 0);
    assert!(check_with_transport(
        &transport,
        "0.1.0",
        &settings,
        false,
        10_000 + 86_400,
    )
    .is_ok());
    assert_eq!(transport.calls(), 1);
}

#[test]
fn manual_check_is_explicit_and_does_not_enable_updates() {
    let transport = FakeTransport::new(payload("v0.1.0", release_url(), false, false));
    let settings = UpdateSettings::default();
    let info = check_with_transport(&transport, "0.1.0", &settings, true, 1_000).unwrap();
    assert!(!settings.enabled);
    assert!(!info.available);
    assert_eq!(transport.calls(), 1);
}

#[test]
fn version_1_10_is_newer_than_1_9() {
    let transport = FakeTransport::new(payload("v1.10.0", release_url(), false, false));
    let info =
        check_with_transport(&transport, "1.9.0", &UpdateSettings::default(), true, 1_000)
            .unwrap();
    assert!(info.available);
    assert_eq!(info.latest_version.as_deref(), Some("1.10.0"));
    assert_eq!(info.current_version, "1.9.0");
    assert_eq!(info.checked_unix, 1_000);
}

#[test]
fn foreign_release_pages_are_refused() {
    for url in [
        "https://evil.example/stefanods29/Adperastra/releases",
        "http://github.com/stefanods29/Adperastra/releases",
        "https://github.com/stefanods29/Adperastra/releases@evil",
        "https://github.com/stefanods29/Adperastra/releases/../evil",
        "https://github.com/stefanods29/Adperastra/releases?x=1",
        "https://github.com/stefanods29/Adperastra/releases#x",
        "https://github.com:443/stefanods29/Adperastra/releases",
    ] {
        assert!(
            validate_release_url(url).is_err(),
            "{url} must be refused"
        );
    }
    assert!(validate_release_url(release_url()).is_ok());
    assert!(validate_release_url(
        "https://github.com/stefanods29/Adperastra/releases"
    )
    .is_ok());
}

#[test]
fn foreign_html_url_in_a_response_is_refused() {
    let transport = FakeTransport::new(payload(
        "v0.2.0",
        "https://evil.example/releases/tag/v0.2.0",
        false,
        false,
    ));
    assert_eq!(
        check_with_transport(&transport, "0.1.0", &UpdateSettings::default(), true, 1_000),
        Err("updates.invalid_response".to_string())
    );
}

#[test]
fn response_over_256_kib_is_refused() {
    let mut exact = std::io::Cursor::new(vec![b'a'; MAX_RESPONSE_BYTES as usize]);
    assert!(read_bounded(&mut exact, MAX_RESPONSE_BYTES).is_ok());
    let mut over = std::io::Cursor::new(vec![b'a'; MAX_RESPONSE_BYTES as usize + 1]);
    assert_eq!(
        read_bounded(&mut over, MAX_RESPONSE_BYTES),
        Err("updates.invalid_response".to_string())
    );
}

#[test]
fn draft_and_prerelease_releases_are_ignored() {
    let transport = FakeTransport::new(payload("v0.2.0", release_url(), true, false));
    let info =
        check_with_transport(&transport, "0.1.0", &UpdateSettings::default(), true, 1_000)
            .unwrap();
    assert!(!info.available);
    assert!(info.latest_version.is_none());
    assert!(info.release_url.is_none());

    let transport = FakeTransport::new(payload("v0.2.0", release_url(), false, true));
    let info =
        check_with_transport(&transport, "0.1.0", &UpdateSettings::default(), true, 1_000)
            .unwrap();
    assert!(!info.available);
}

#[test]
fn update_info_has_no_installer_or_download_field() {
    let transport = FakeTransport::new(payload("v0.2.0", release_url(), false, false));
    let info =
        check_with_transport(&transport, "0.1.0", &UpdateSettings::default(), true, 1_000)
            .unwrap();
    let value = serde_json::to_value(&info).unwrap();
    let object = value.as_object().unwrap();
    assert!(!object.contains_key("installer_url"));
    assert!(!object.contains_key("download_url"));
    assert!(!object.contains_key("action"));
    assert_eq!(object.len(), 5);
}

#[test]
fn update_settings_are_bounded() {
    let valid = UpdateSettings {
        enabled: false,
        last_seen_version: "0.1.0".to_string(),
        last_check_unix: 0,
    };
    assert!(valid.validate().is_ok());
    let invalid_version = UpdateSettings {
        last_seen_version: "not a version".to_string(),
        ..valid.clone()
    };
    assert_eq!(
        invalid_version.validate(),
        Err("updates.invalid_settings".to_string())
    );
    let invalid_time = UpdateSettings {
        last_check_unix: MAX_SAFE_INTEGER + 1,
        ..valid
    };
    assert_eq!(
        invalid_time.validate(),
        Err("updates.invalid_settings".to_string())
    );
}

#[test]
fn whats_new_version_is_bounded() {
    assert!(validate_whats_new_version(env!("CARGO_PKG_VERSION")).is_ok());
    assert_eq!(
        validate_whats_new_version("not a version"),
        Err("updates.invalid_settings".to_string())
    );
    assert!(validate_whats_new_version(&"1".repeat(129)).is_err());
}

#[test]
fn timeout_is_ten_seconds_and_checks_run_off_the_ui_thread() {
    assert_eq!(TIMEOUT_SECS, 10);
    assert_eq!(MAX_RESPONSE_BYTES, 262_144);
    // The network call is inside spawn_blocking; this shape check keeps
    // a later edit from moving it onto the UI thread.
    assert!(include_str!("updates.rs").contains("tauri::async_runtime::spawn_blocking"));
}
