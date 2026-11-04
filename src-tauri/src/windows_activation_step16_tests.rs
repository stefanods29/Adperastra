//! Step 16 T2 tests: Explorer activation and association choices. Included
//! by `integration_commands.rs`.

use std::path::PathBuf;

use super::{
    activation_arguments, classify_arguments, command_for_intent, dispatch_plan, plan_activation,
    plan_from_request, quoted_executable, ActivationSink,
};
use crate::windows_integration::build_plan;
use crate::windows_integration_types::{ActivationIntent, IntegrationRequest};

fn exe() -> PathBuf {
    PathBuf::from(r"C:\Program Files\Adperastra\Adperastra.exe")
}

fn sample_path() -> String {
    r"C:\Users\Ana & José\My Files\O'Brien report (final).txt".to_string()
}

#[derive(Default)]
struct RecordingSink {
    opened: Vec<Vec<String>>,
    reviewed: Vec<Vec<String>>,
}

impl ActivationSink for RecordingSink {
    fn open_paths(&mut self, paths: &[String]) -> Result<(), String> {
        self.opened.push(paths.to_vec());
        Ok(())
    }

    fn open_convert_review(&mut self, paths: &[String]) -> Result<(), String> {
        self.reviewed.push(paths.to_vec());
        Ok(())
    }
}

#[test]
fn convert_intent_opens_review_noautooutput() {
    let plan = plan_activation(Some(ActivationIntent::Convert), &[sample_path()])
        .expect("the conversion plan is valid");
    assert!(plan.review_required);
    assert!(
        !plan.auto_convert,
        "a file received from Windows is never converted automatically"
    );
    let mut sink = RecordingSink::default();
    dispatch_plan(&plan, &mut sink).expect("the review opens");
    assert_eq!(sink.reviewed.len(), 1);
    assert!(sink.opened.is_empty(), "nothing is opened as a plain file");
}

#[test]
fn paths_quotes_singleargument() {
    let path = sample_path();
    let plan = plan_activation(Some(ActivationIntent::Open), std::slice::from_ref(&path))
        .expect("the path is valid");
    assert_eq!(plan.paths, vec![path.clone()], "one path stays one argument");

    let (intent, paths) = classify_arguments(&[
        "--open".to_string(),
        path.clone(),
    ])
    .expect("the fixed flag and one literal path parse");
    assert_eq!(intent, ActivationIntent::Open);
    assert_eq!(paths, vec![path.clone()]);

    // Shell-looking characters in a name stay one value: the parser never
    // re-splits or re-quotes the argument the OS already passed.
    let tricky = r"C:\A B\100% $HOME [draft] (v2).txt".to_string();
    let (_, paths) = classify_arguments(std::slice::from_ref(&tricky)).expect("one literal argument");
    assert_eq!(paths, vec![tricky]);

    let command = command_for_intent(&exe(), ActivationIntent::Open).expect("command");
    assert_eq!(
        command,
        r#""C:\Program Files\Adperastra\Adperastra.exe" --open "%1""#
    );
    assert_eq!(command.matches('"').count(), 4, "exe and %1 each quoted once");
    assert_eq!(activation_arguments(ActivationIntent::Convert), ["--convert", "%1"]);

    // A quote inside the executable path is refused rather than escaped into
    // an ambiguous command line.
    assert!(quoted_executable(&PathBuf::from("C:\\Bad\"Quote\\Adperastra.exe")).is_err());
    assert!(command_for_intent(&exe(), ActivationIntent::Open)
        .expect("command")
        .contains(" --open "));
}

#[test]
fn defaults_notforced() {
    let request = IntegrationRequest {
        classic_enabled: true,
        extensions: vec!["txt".to_string()],
        start_with_windows: false,
        modern_requested: false,
    };
    let plan = build_plan(&exe(), "0.4.0", &request).expect("plan");
    assert!(!plan.is_empty());
    for planned in &plan {
        let key = planned.key.to_ascii_lowercase();
        assert!(!key.contains("userchoice"), "no default-handler hash is written");
        assert!(!key.contains("fileexts"), "Windows' choice key is untouched");
    }
    // The association is offered, never made the default.
    assert!(plan.iter().any(|planned| {
        planned.key.eq_ignore_ascii_case("Software\\Classes\\.txt\\OpenWithProgids")
            && planned.name == "Adperastra.File.txt"
    }));
    assert!(!plan.iter().any(|planned| {
        planned.key.eq_ignore_ascii_case("Software\\Classes\\.txt")
    }));
}

#[test]
fn oldactivation_defaultsopen() {
    let path = sample_path();
    let plan = plan_activation(None, std::slice::from_ref(&path)).expect("old request");
    assert_eq!(plan.intent, ActivationIntent::Open);
    assert!(!plan.review_required);
    let mut sink = RecordingSink::default();
    dispatch_plan(&plan, &mut sink).expect("open");
    assert_eq!(sink.opened, vec![vec![path]]);
    assert!(sink.reviewed.is_empty());
}

#[test]
fn unknown_switches_and_conflicting_flags_are_refused() {
    assert!(classify_arguments(&["--shell".to_string(), sample_path()]).is_err());
    assert!(classify_arguments(&[
        "--open".to_string(),
        "--convert".to_string(),
        sample_path()
    ])
    .is_err());
    // A repeated intent is still more than one intent and is refused.
    assert!(classify_arguments(&[
        "--convert".to_string(),
        "--convert".to_string(),
        sample_path()
    ])
    .is_err());
    // The end-of-options marker makes a leading-dash literal a path.
    let literal = "C:\\Dash\\-name.txt".to_string();
    let (intent, paths) =
        classify_arguments(&["--".to_string(), literal.clone()]).expect("literal path");
    assert_eq!(intent, ActivationIntent::Open);
    assert_eq!(paths, vec![literal]);
}

#[test]
fn request_intent_is_planned_without_auto_conversion() {
    let request = crate::activation::ActivationRequest {
        version: crate::activation::ACTIVATION_VERSION,
        request_id: "b50a4a4e-5a5f-4a6e-9a0a-0b1c2d3e4f50".to_string(),
        paths: vec![sample_path()],
        sent_unix: 1_800_000_000,
        intent: Some(ActivationIntent::Convert),
    };
    let plan = plan_from_request(&request).expect("the request plans");
    assert_eq!(plan.intent, ActivationIntent::Convert);
    assert!(plan.review_required);
    assert!(!plan.auto_convert, "nothing converts before the review");
}
