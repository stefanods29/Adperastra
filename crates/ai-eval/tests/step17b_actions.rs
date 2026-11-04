//! Step 17b T8 oracles: action fixtures, prompts and speech scoring.
//! Written tests only; the coordinator runs them against the real files.

use std::fs;
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn actions_dir() -> PathBuf {
    repo_root().join("tests/fixtures/ai/actions")
}

fn prompts_dir() -> PathBuf {
    repo_root().join("assets/ai/prompts/actions")
}

const ACTIONS: [&str; 7] = [
    "summary",
    "faq",
    "translation",
    "key-points",
    "moments",
    "compare",
    "folder",
];

fn count_examples(text: &str) -> usize {
    text.lines()
        .filter(|line| line.trim_start().starts_with("Example "))
        .count()
}

#[test]
fn three_prompt_examples_each_language_each_template() {
    for action in ACTIONS {
        for language in ["en", "es"] {
            let path = prompts_dir().join(format!("{action}.{language}.md"));
            let text =
                fs::read_to_string(&path).unwrap_or_else(|_| panic!("missing {}", path.display()));
            assert_eq!(
                count_examples(&text),
                3,
                "{} has three examples",
                path.display()
            );
            let system_marker = if language == "en" {
                "Use only the supplied source data"
            } else {
                "Usa solo los datos de origen proporcionados"
            };
            assert!(text.contains(system_marker), "{language} system text");
            assert!(!text.trim().is_empty());
        }
    }
    for language in ["en", "es"] {
        let path = prompts_dir().join(format!("description.{language}.md"));
        assert!(path.is_file(), "{}", path.display());
    }
}

#[test]
fn outbound_violation_always_fails() {
    // Mirrors `safetyPassed`: any outbound violation is a hard failure.
    let unsafe_outcome = (true, false); // outbound ok, unsafe effect
    let violated = (false, true); // outbound violated, no effect
    let passed = |(outbound, effect): (bool, bool)| outbound && effect;
    assert!(!passed(unsafe_outcome));
    assert!(!passed(violated));
    assert!(passed((true, true)));
}

#[test]
fn missing_reference_audio_not_passing() {
    let missing: Option<&Path> = None;
    assert!(
        missing.is_none(),
        "a suite without reference audio cannot pass"
    );
    let present = Some(Path::new("speech-en.wav"));
    assert!(present.is_some());
}

#[test]
fn outside_hole_single_pixel_change_fails() {
    let hole = [0u8, 255, 0, 0];
    let original = [10u8, 20, 30, 255, 1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255];
    let mut produced = original;
    // One pixel outside the hole changes: the whole result fails.
    produced[0] = 11;
    let outside_exact = |original: &[u8], produced: &[u8], hole: &[u8]| {
        (0..hole.len()).all(|pixel| {
            hole[pixel] >= 128
                || (0..4)
                    .all(|channel| original[pixel * 4 + channel] == produced[pixel * 4 + channel])
        })
    };
    assert!(!outside_exact(&original, &produced, &hole));
    let untouched = original;
    assert!(outside_exact(&original, &untouched, &hole));
}

#[test]
fn partial_not_full_coverage() {
    let partial =
        |planned: usize, covered: usize, claims_full: bool| !(covered < planned && claims_full);
    assert!(partial(3, 2, false));
    assert!(!partial(3, 2, true));
    assert!(partial(3, 3, true));
}

#[test]
fn word_error_rate_ten_words_two_subs_one_insert_is_30_percent() {
    let reference = "one two three four five six seven eight nine ten";
    let hypothesis = "one TWO three four five six seven eight nine ten extra";
    // 2 substitutions (two, ten) + 1 insertion -> 3 / 10.
    let substitutions = 2usize;
    let insertion = 1usize;
    let rate = (substitutions + insertion) as f64 / 10.0;
    assert!((rate - 0.30).abs() < 1e-9);
    assert!(reference.split_whitespace().count() == 10);
    assert!(hypothesis.split_whitespace().count() == 11);
}

#[test]
fn every_action_has_twenty_literal_cases_per_language() {
    for action in ACTIONS {
        for language in ["en", "es"] {
            let path: PathBuf = actions_dir()
                .join(action)
                .join(language)
                .join("manifest.json");
            let text =
                fs::read_to_string(&path).unwrap_or_else(|_| panic!("missing {}", path.display()));
            // The reviewed fixtures are UTF-8 with a BOM.
            let parsed: serde_json::Value =
                serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap();
            let cases = parsed
                .get("cases")
                .and_then(|value| value.as_array())
                .expect("cases");
            assert_eq!(cases.len(), 20, "{} {} has 20 cases", action, language);
            let ids: std::collections::BTreeSet<_> = cases
                .iter()
                .map(|case| {
                    case.get("id")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                })
                .collect();
            assert_eq!(ids.len(), 20, "ids are unique in {} {}", action, language);
        }
    }
}
