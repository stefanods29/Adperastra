//! Office font inventory tests (Step 13 T6). No font binary is present in
//! the repository: these tests use manifest records only.

use super::*;

fn hash(character: char) -> String {
    std::iter::repeat_n(character, 64).collect()
}

fn file(family: &str, path: &str, license: &str) -> OfficeFontFile {
    OfficeFontFile {
        path: path.to_string(),
        family: family.to_string(),
        style: "Regular".to_string(),
        weight: 400,
        italic: false,
        byte_len: 12_345,
        sha256: hash('a'),
        license: license.to_string(),
        license_file: "fonts/OFL.txt".to_string(),
    }
}

fn manifest() -> OfficeFontManifest {
    OfficeFontManifest {
        schema_version: OFFICE_FONT_SCHEMA,
        revision: 1,
        files: vec![
            file("Carlito", "fonts/carlito/Carlito-Regular.ttf", "SIL-OFL-1.1"),
            file("Caladea", "fonts/caladea/Caladea-Regular.ttf", "SIL-OFL-1.1"),
            file("Liberation Sans", "fonts/liberation/LiberationSans-Regular.ttf", "SIL-OFL-1.1"),
            file("Liberation Serif", "fonts/liberation/LiberationSerif-Regular.ttf", "SIL-OFL-1.1"),
            file("Liberation Mono", "fonts/liberation/LiberationMono-Regular.ttf", "SIL-OFL-1.1"),
            file("Noto Sans", "fonts/noto/NotoSans-Regular.ttf", "SIL-OFL-1.1"),
        ],
    }
}

#[test]
fn font_hash_change_invalidates_cache() {
    let original = manifest();
    assert!(original.validate().is_ok());
    let first = original.cache_component();
    let mut changed = original.clone();
    changed.files[0].sha256 = hash('b');
    assert!(changed.validate().is_ok());
    assert_ne!(first, changed.cache_component());
    assert_ne!(original.inventory_hash(), changed.inventory_hash());
}

#[test]
fn unlicensed_font_not_activated() {
    let mut candidate = manifest();
    candidate.files[0].license = "GPL-3.0".to_string();
    assert_eq!(
        candidate.validate().unwrap_err(),
        "office.unsupported".to_string()
    );
    let mut missing = manifest();
    missing.files.retain(|file| file.family != "Liberation Mono");
    assert_eq!(
        missing.validate().unwrap_err(),
        "office.unsupported".to_string()
    );
}

#[test]
fn missing_font_warning_not_silent() {
    let mut candidate = manifest();
    candidate.files.retain(|file| file.family != "Carlito");
    let warning = substitution_for("Calibri", &candidate).expect("a substitution warning");
    assert_eq!(warning.requested, "Calibri");
    assert_eq!(warning.used, "Noto Sans");
    assert_eq!(warning.warning_key, "office.fontSubstitution");
    assert!(substitution_for("Carlito", &manifest()).is_none());
}

#[test]
fn font_paths_cannot_escape_pack() {
    assert!(valid_font_path("fonts/carlito/Carlito-Regular.ttf"));
    assert!(!valid_font_path("fonts/../outside.ttf"));
    assert!(!valid_font_path("../outside.ttf"));
    assert!(!valid_font_path("C:\\Windows\\Fonts\\arial.ttf"));
    assert!(!valid_font_path("fonts/carlito/Carlito-Regular.ttf:stream"));
    assert!(valid_license_file("fonts/OFL.txt"));
    assert!(!valid_license_file("fonts/../OFL.txt"));
}
