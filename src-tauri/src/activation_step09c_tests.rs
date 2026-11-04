//! Step 09c T5 oracles. Every test here is pure: no pipe, window or
//! filesystem is touched, and all of them must run on the coordinator's
//! Windows host with `cargo test`.

use super::*;
use crate::activation::{
    initial_activation_request, is_absolute_activation_path, parse_activation_args,
    MAX_ACTIVATION_PATHS, MAX_PATH_UTF16, MAX_SAFE_INTEGER,
};
use crate::activation_security::{client_allowed, mutex_name, pipe_name, sid_matches};
use crate::windows_integration_types::ActivationIntent;

fn uuid(number: u8) -> String {
    format!("00000000-0000-4000-8000-{number:012}")
}

fn request(id: &str) -> ActivationRequest {
    ActivationRequest {
        version: ACTIVATION_VERSION,
        request_id: id.to_string(),
        paths: vec![r"C:\Users\Public\alpha.txt".to_string()],
        sent_unix: 1_800_000_000,
        intent: None,
    }
}

fn bytes(request: &ActivationRequest) -> Vec<u8> {
    serde_json::to_vec(request).expect("request json")
}

#[test]
fn wrong_sid_and_remote_clients_are_denied() {
    assert!(client_allowed("S-1-5-21-1", Some("S-1-5-21-1")));
    assert!(client_allowed("s-1-5-21-1", Some("S-1-5-21-1")));
    assert!(!client_allowed("S-1-5-21-1", Some("S-1-5-21-2")));
    // `None` is a remote client or a process whose token cannot be read.
    assert!(!client_allowed("S-1-5-21-1", None));
    assert!(!sid_matches("", ""));
    assert!(!client_allowed("", Some("")));
}

#[test]
fn pipe_and_mutex_names_are_scoped_to_the_user_sid() {
    assert_eq!(
        pipe_name("S-1-5-21-1"),
        r"\\.\pipe\adperastra.activation.S-1-5-21-1"
    );
    assert_eq!(
        mutex_name("S-1-5-21-1"),
        r"Local\adperastra.activation.S-1-5-21-1"
    );
}

#[test]
fn oversized_request_is_rejected() {
    let mut payload = bytes(&request(&uuid(1)));
    payload.resize(MAX_ACTIVATION_BYTES + 1, b' ');
    assert_eq!(
        validate_activation(&payload),
        Err(ERR_INVALID.to_string())
    );
    assert_eq!(
        validate_activation(&[]),
        Err(ERR_INVALID.to_string())
    );
}

#[test]
fn seventeenth_queued_request_is_busy() {
    let queue = ActivationQueue::new();
    for number in 1..=16u8 {
        let ack = process_activation(request(&uuid(number)), &queue).expect("queue accepts");
        assert!(ack.accepted, "request {number} should be queued");
    }
    let ack = process_activation(request(&uuid(17)), &queue).expect("queue answers");
    assert!(!ack.accepted);
    assert_eq!(ack.error.as_deref(), Some(ERR_BUSY));
    // The full queue still holds exactly the first sixteen requests.
    let drained = queue.mark_ready_and_drain().expect("drain");
    assert_eq!(drained.len(), 16);
    assert_eq!(drained[15].request_id, uuid(16));
}

#[test]
fn helper_flag_argument_is_rejected() {
    let helper = vec!["--font-helper".to_string(), r"C:\alpha.txt".to_string()];
    assert_eq!(
        parse_activation_args(&helper),
        Err(ERR_INVALID.to_string())
    );
    for flag in [
        "--archive-helper",
        "--clipboard-image-helper",
        "--classic-menu-helper",
        "-x",
    ] {
        let args = vec![r"C:\alpha.txt".to_string(), flag.to_string()];
        assert_eq!(
            parse_activation_args(&args),
            Err(ERR_INVALID.to_string())
        );
    }
    // One literal end-of-options delimiter is allowed; switches after it
    // are still paths and therefore still refused.
    let allowed = vec![
        "--".to_string(),
        r"C:\alpha.txt".to_string(),
        r"\\server\share\beta.txt".to_string(),
    ];
    assert_eq!(
        parse_activation_args(&allowed),
        Ok((
            ActivationIntent::Open,
            vec![
                r"C:\alpha.txt".to_string(),
                r"\\server\share\beta.txt".to_string()
            ]
        ))
    );
    let twice = vec![
        "--".to_string(),
        r"C:\alpha.txt".to_string(),
        "--".to_string(),
    ];
    assert_eq!(
        parse_activation_args(&twice),
        Err(ERR_INVALID.to_string())
    );
    let empty = vec!["--".to_string()];
    assert_eq!(
        parse_activation_args(&empty),
        Err(ERR_INVALID.to_string())
    );
}

#[test]
fn fixed_open_and_convert_flags_select_the_intent() {
    let path = r"C:\alpha.txt".to_string();
    assert_eq!(
        parse_activation_args(&["--open".to_string(), path.clone()]),
        Ok((ActivationIntent::Open, vec![path.clone()]))
    );
    assert_eq!(
        parse_activation_args(&["--convert".to_string(), path.clone()]),
        Ok((ActivationIntent::Convert, vec![path.clone()]))
    );
    // No flag keeps the old behavior: open.
    assert_eq!(
        parse_activation_args(std::slice::from_ref(&path)),
        Ok((ActivationIntent::Open, vec![path.clone()]))
    );
    // Unknown switches, conflicting intents and a repeated intent are all
    // refused rather than guessed.
    for args in [
        vec!["--shell".to_string(), path.clone()],
        vec![
            "--open".to_string(),
            "--convert".to_string(),
            path.clone(),
        ],
        vec!["--open".to_string(), "--open".to_string(), path.clone()],
        // After `--`, a flag is a literal path and is not absolute.
        vec!["--".to_string(), "--convert".to_string()],
    ] {
        assert_eq!(
            parse_activation_args(&args),
            Err(ERR_INVALID.to_string())
        );
    }
}

#[test]
fn activation_paths_must_be_absolute() {
    assert!(is_absolute_activation_path(r"C:\alpha.txt"));
    assert!(is_absolute_activation_path("C:/alpha.txt"));
    assert!(is_absolute_activation_path(r"\\server\share\alpha.txt"));
    assert!(is_absolute_activation_path(r"\\?\C:\alpha.txt"));
    assert!(!is_absolute_activation_path("//server/share/alpha.txt"));
    assert!(!is_absolute_activation_path(r"C:alpha.txt"));
    assert!(!is_absolute_activation_path(r"\alpha.txt"));
    assert!(!is_absolute_activation_path("alpha.txt"));
    assert!(!is_absolute_activation_path(""));
    assert!(!is_absolute_activation_path("C:\\a\0.txt"));
    assert!(!is_absolute_activation_path(r"C:\alpha\..\beta.txt"));
    assert!(!is_absolute_activation_path(r"\\server\share\..\beta.txt"));
    assert!(!is_absolute_activation_path(r"\\server"));
    assert!(!is_absolute_activation_path(r"\\"));
}

#[test]
fn paths_over_the_utf16_limit_are_rejected() {
    let longest = format!(r"C:\{}", "a".repeat(MAX_PATH_UTF16 - 3));
    assert_eq!(longest.encode_utf16().count(), MAX_PATH_UTF16);
    assert!(parse_activation_args(&[longest]).is_ok());
    let too_long = format!(r"C:\{}", "a".repeat(MAX_PATH_UTF16 - 2));
    assert_eq!(
        parse_activation_args(&[too_long]),
        Err(ERR_INVALID.to_string())
    );
}

#[test]
fn same_uuid_is_handled_once() {
    let queue = ActivationQueue::new();
    let first = process_activation(request(&uuid(1)), &queue).expect("accepted");
    assert!(first.accepted);
    let drained = queue.mark_ready_and_drain().expect("drain");
    assert_eq!(drained.len(), 1);
    // The same id in another textual form is the same request.
    let again = process_activation(request(&uuid(1).to_uppercase()), &queue).expect("idempotent");
    assert!(again.accepted);
    assert!(queue.drain_for_event().is_empty());
    assert!(queue.mark_ready_and_drain().expect("second drain").is_empty());
}

#[test]
fn initial_request_before_ui_ready_is_retained() {
    let queue = ActivationQueue::new();
    let ack = process_activation(request(&uuid(1)), &queue).expect("accepted");
    assert!(ack.accepted);
    // Nothing is published before the frontend installs its listener.
    assert!(queue.drain_for_event().is_empty());
    let drained = queue.mark_ready_and_drain().expect("drain");
    assert_eq!(drained.len(), 1);
    assert_eq!(drained[0].request_id, uuid(1));
    // Exactly once: a later event drain has nothing left.
    assert!(queue.drain_for_event().is_empty());
}

#[test]
fn malformed_requests_are_rejected() {
    let mut wrong_version = request(&uuid(1));
    wrong_version.version = 2;
    assert_eq!(
        validate_activation(&bytes(&wrong_version)),
        Err(ERR_INVALID.to_string())
    );

    let mut unsafe_time = request(&uuid(1));
    unsafe_time.sent_unix = MAX_SAFE_INTEGER + 1;
    assert_eq!(
        validate_activation(&bytes(&unsafe_time)),
        Err(ERR_INVALID.to_string())
    );

    let mut no_paths = request(&uuid(1));
    no_paths.paths.clear();
    assert_eq!(
        validate_activation(&bytes(&no_paths)),
        Err(ERR_INVALID.to_string())
    );

    let mut too_many = request(&uuid(1));
    too_many.paths = vec![r"C:\alpha.txt".to_string(); MAX_ACTIVATION_PATHS + 1];
    assert_eq!(
        validate_activation(&bytes(&too_many)),
        Err(ERR_INVALID.to_string())
    );

    let mut relative = request(&uuid(1));
    relative.paths = vec!["alpha.txt".to_string()];
    assert_eq!(
        validate_activation(&bytes(&relative)),
        Err(ERR_INVALID.to_string())
    );

    let mut bad_id = request("not-a-uuid");
    bad_id.request_id = "not-a-uuid".to_string();
    assert_eq!(
        validate_activation(&bytes(&bad_id)),
        Err(ERR_INVALID.to_string())
    );

    // `working_directory` (or any other command field) is refused by the
    // exact request shape, so the pipe cannot carry arbitrary commands.
    let extra = serde_json::json!({
        "version": ACTIVATION_VERSION,
        "request_id": uuid(1),
        "paths": [r"C:\alpha.txt"],
        "sent_unix": 1_800_000_000,
        "working_directory": r"C:\Windows",
    });
    assert_eq!(
        validate_activation(&serde_json::to_vec(&extra).expect("json")),
        Err(ERR_INVALID.to_string())
    );

    // The fixed intent is bounded to the two contract spellings; an
    // arbitrary verb is refused instead of being interpreted later.
    let mut convert = request(&uuid(2));
    convert.intent = Some(ActivationIntent::Convert);
    let parsed = validate_activation(&bytes(&convert)).expect("convert is valid");
    assert_eq!(parsed.intent, Some(ActivationIntent::Convert));
    let unknown = serde_json::json!({
        "version": ACTIVATION_VERSION,
        "request_id": uuid(1),
        "paths": [r"C:\alpha.txt"],
        "sent_unix": 1_800_000_000,
        "intent": "convert_all",
    });
    assert_eq!(
        validate_activation(&serde_json::to_vec(&unknown).expect("json")),
        Err(ERR_INVALID.to_string())
    );
}

#[test]
fn acks_use_only_contract_error_keys() {
    let accepted = ActivationAck {
        request_id: uuid(1),
        accepted: true,
        error: None,
    };
    let json = serde_json::to_value(&accepted).expect("json");
    assert_eq!(json["accepted"], true);
    assert!(json.get("error").is_none());

    let refused = ActivationAck {
        request_id: uuid(1),
        accepted: false,
        error: Some(ERR_BUSY.to_string()),
    };
    assert_eq!(refused.error.as_deref(), Some(ERR_BUSY));
}

#[test]
fn same_uuid_compares_textual_forms() {
    assert!(same_uuid(&uuid(1), &uuid(1).to_uppercase()));
    assert!(!same_uuid(&uuid(1), &uuid(2)));
    assert!(!same_uuid("not-a-uuid", "not-a-uuid"));
}

fn startup_switch(argument: &str) -> bool {
    matches!(argument, "--background" | "--font-helper")
}

#[test]
fn primary_startup_request_is_queued_until_ready() {
    let queue = ActivationQueue::new();
    let args = vec![
        "--background".to_string(),
        "--font-helper".to_string(),
        r"C:\Users\Public\alpha.txt".to_string(),
    ];
    let request = initial_activation_request(&args, startup_switch).expect("one request");
    assert_eq!(request.version, ACTIVATION_VERSION);
    assert_eq!(request.paths, vec![r"C:\Users\Public\alpha.txt".to_string()]);
    assert_eq!(request.intent, Some(ActivationIntent::Open));
    assert!(uuid::Uuid::parse_str(&request.request_id).is_ok());
    // Enqueued exactly like the pipe path: nothing is published before the
    // frontend installs its listener, and the first ready drains it once.
    let ack = process_activation(request.clone(), &queue).expect("queued");
    assert!(ack.accepted);
    assert!(queue.drain_for_event().is_empty());
    let drained = queue.mark_ready_and_drain().expect("drain");
    assert_eq!(drained, vec![request]);
    assert!(queue.drain_for_event().is_empty());
}

#[test]
fn primary_startup_switches_never_become_paths() {
    let path = r"C:\Users\Public\alpha.txt".to_string();
    // Every request gets a fresh id, even for the same launch arguments.
    let first = initial_activation_request(std::slice::from_ref(&path), startup_switch)
        .expect("one path");
    let second = initial_activation_request(std::slice::from_ref(&path), startup_switch)
        .expect("one path");
    assert_ne!(first.request_id, second.request_id);

    // A fixed intent on the primary launch is carried as data, like a
    // second instance would forward it.
    let convert =
        initial_activation_request(&["--convert".to_string(), path.clone()], startup_switch)
            .expect("convert request");
    assert_eq!(convert.intent, Some(ActivationIntent::Convert));

    // Startup and helper switches alone are not a launch.
    for args in [
        vec!["--background".to_string()],
        vec!["--font-helper".to_string()],
        vec!["--background".to_string(), "--font-helper".to_string()],
    ] {
        assert!(initial_activation_request(&args, startup_switch).is_none());
    }
    // A helper switch beside a real path is dropped, never opened.
    let mixed = vec![path.clone(), "--font-helper".to_string()];
    let request = initial_activation_request(&mixed, startup_switch).expect("path remains");
    assert_eq!(request.paths, vec![path.clone()]);
    // Unknown switches are refused by the shared parser, not guessed.
    assert!(
        initial_activation_request(&["--shell".to_string(), path.clone()], startup_switch)
            .is_none()
    );
    // After the literal delimiter a switch is a path; it is not absolute,
    // so the whole request stays invalid instead of opening a fake path.
    assert!(initial_activation_request(
        &["--".to_string(), "--background".to_string()],
        startup_switch
    )
    .is_none());
    assert!(
        initial_activation_request(&["--".to_string(), path.clone()], startup_switch).is_some()
    );
}
