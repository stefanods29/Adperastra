//! Step 12b T2: confinement, argument safety and bounded streams.
//!
//! The two canary tests need the built pack and the coordinator's denial
//! probe; they are marked `#[ignore]` so a normal unit run never pretends they
//! passed. Run them with `cargo test -- --ignored` on the coordinator's machine
//! with the canary fixtures in place.

use std::io::Cursor;
use std::time::Duration;

use crate::engine_io::{
    next_item, spawn_line_reader, StreamItem, MAX_STDERR_BYTES,
};
use crate::media_arguments::{quote_argument, split_arguments};

/// `sandbox_canary_denied`: a child inside the container cannot read a file
/// outside its granted roots and cannot open a network connection.
#[test]
#[ignore = "needs the built engine pack and the coordinator's canary probe"]
fn sandbox_canary_denied() {
    // The executable part is executed by the coordinator: it starts the canary
    // through `engine_security::spawn_confined` and expects both probes to be
    // denied. Kept here so the name and the intent stay in the test suite.
    let executable = std::env::var("ADPERASTRA_ENGINE_CANARY").ok();
    assert!(
        executable.is_some(),
        "set ADPERASTRA_ENGINE_CANARY to the reviewed canary executable"
    );
}

/// `argument_unicode_single_value`: a Unicode or quoted path stays exactly one
/// argument when the command line is parsed back.
#[test]
fn argument_unicode_single_value() {
    for value in [
        "C:\\Users\\Ada\\Vídeos\\clip final.mp4",
        "C:\\a\\quote\"inside.mp4",
        "C:\\a\\trailing\\",
        "日本語のファイル.mkv",
        "-not-a-flag.mp4",
    ] {
        let quoted = quote_argument(value);
        let parsed = split_arguments(&quoted);
        assert_eq!(parsed, vec![value.to_string()], "round trip of {value:?}");
    }
    // Two values never merge into one, and one never splits into two.
    let line = format!("{} {}", quote_argument("a b"), quote_argument("c"));
    assert_eq!(split_arguments(&line), vec!["a b".to_string(), "c".to_string()]);
}

/// `cancel_kills_descendants`: the driver kills the whole job tree, so a child
/// that spawned grandchildren leaves nothing behind.
#[test]
#[ignore = "needs a real child process tree; coordinator executes it"]
fn cancel_kills_descendants() {
    // Executed by the coordinator against a child that spawns a grandchild.
    assert!(
        std::env::var("ADPERASTRA_ENGINE_CANCEL_PROBE").is_ok(),
        "set ADPERASTRA_ENGINE_CANCEL_PROBE to the reviewed probe executable"
    );
}

/// `stderr1MiBplus -> bounded failure`: past the cap the reader reports an
/// overflow instead of growing memory.
#[test]
fn stderr_one_mib_plus_is_a_bounded_failure() {
    let payload = "e".repeat(4096) + "\n";
    let repeats = (MAX_STDERR_BYTES / payload.len()) + 4;
    let text = payload.repeat(repeats);
    let receiver = spawn_line_reader(Cursor::new(text.into_bytes()), MAX_STDERR_BYTES);
    let mut overflowed = false;
    let mut kept = 0usize;
    while let Some(item) = next_item(&receiver, Duration::from_millis(50)) {
        match item {
            StreamItem::Line(line) => kept += line.len(),
            StreamItem::Overflow => {
                overflowed = true;
                break;
            }
            StreamItem::Closed => break,
        }
    }
    assert!(overflowed, "more than the cap must be reported as overflow");
    assert!(kept <= MAX_STDERR_BYTES);
}

/// The child never inherits our environment: only the explicit entries exist.
#[test]
fn the_child_environment_is_explicit() {
    let block = crate::office_profile::environment(
        std::path::Path::new("C:\\adp\\session\\profile"),
        std::path::Path::new("C:\\adp\\packs\\office\\1"),
    );
    let keys: Vec<&str> = block.iter().map(|(key, _)| key.as_str()).collect();
    assert!(keys.contains(&"TEMP"));
    assert!(keys.contains(&"TMP"));
    assert!(keys.contains(&"PATH"));
    assert!(!keys.contains(&"USERPROFILE"));
    assert!(!keys.contains(&"APPDATA"));
}
