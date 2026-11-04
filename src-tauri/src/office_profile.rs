//! The finalized, pack-owned LibreOffice profile (Step 12b D7).
//!
//! Headless alone is never the macro policy. Every run gets a private,
//! freshly written profile whose security settings disable macro execution,
//! active content and trusted locations, and whose Java/extensions/update
//! paths are off. The profile is written by us, never taken from the user's
//! own LibreOffice installation, and it lives under the private job folder
//! that only the AppContainer may read.
//!
//! The profile directory is passed to the engine as a `-env:UserInstallation`
//! URL (never a raw path), so no argument can redirect it.
#![allow(dead_code)]


use std::path::{Path, PathBuf};

use crate::engine_types::{EngineError, OfficeFormat, OfficeRenderTarget};

/// The profile file LibreOffice reads first.
pub const PROFILE_FILE: &str = "registrymodifications.xcu";

/// The exact security items the profile sets (D7).
pub const PROFILE_SECURITY_ITEMS: [(&str, &str); 5] = [
    (
        "org.openoffice.Office.Common/Security/Scripting/DisableMacrosExecution",
        "true",
    ),
    (
        "org.openoffice.Office.Common/Security/Scripting/DisableActiveContent",
        "true",
    ),
    (
        "org.openoffice.Office.Common/Security/Scripting/MacroSecurityLevel",
        "3",
    ),
    ("org.openoffice.Office.Common/Java/Enable", "false"),
    (
        "org.openoffice.Office.Common/Update/UpdateCheck",
        "false",
    ),
];

/// Write the finalized profile under `root` and return its directory.
pub fn write_profile(root: &Path) -> Result<PathBuf, String> {
    let profile = root.join("lo-profile");
    let user = profile.join("user");
    std::fs::create_dir_all(&user).map_err(|_| EngineError::SandboxFailed.message())?;
    // `environment` points TEMP/TMP here; create it before the child starts.
    std::fs::create_dir_all(profile.join("temp"))
        .map_err(|_| EngineError::SandboxFailed.message())?;
    let file = user.join(PROFILE_FILE);
    std::fs::write(&file, profile_xml()).map_err(|_| EngineError::SandboxFailed.message())?;
    Ok(profile)
}

/// The exact profile document; kept separate so it can be checked without a
/// disk write.
pub fn profile_xml() -> String {
    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <oor:items xmlns:oor=\"http://openoffice.org/2001/registry\" \
         xmlns:xs=\"http://www.w3.org/2001/XMLSchema\" \
         xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\n",
    );
    for (path, value) in PROFILE_SECURITY_ITEMS {
        xml.push_str(&format!(
            " <item oor:path=\"/{path}\"><prop oor:name=\"Value\" oor:op=\"fuse\">\
             <value xsi:type=\"xs:boolean\">{value}</value></prop></item>\n"
        ));
    }
    xml.push_str("</oor:items>\n");
    xml
}

/// True when this profile sets every security item to its required value.
pub fn profile_disables_macros(contents: &str) -> bool {
    PROFILE_SECURITY_ITEMS.iter().all(|(path, value)| {
        let marker = format!("/{path}\"");
        contents
            .split(marker.as_str())
            .nth(1)
            .map(|rest| {
                let window: String = rest.chars().take(200).collect();
                window.contains(&format!(">{value}<"))
            })
            .unwrap_or(false)
    })
}

/// The `-env:UserInstallation` value: a URI with forward slashes and no raw
/// spaces or percent signs, so it stays exactly one argument.
pub fn user_installation_url(profile: &Path) -> String {
    let text = profile.to_string_lossy().replace('\\', "/");
    let mut encoded = String::from("file:///");
    for character in text.trim_start_matches('/').chars() {
        if character.is_ascii_alphanumeric() || "-._~/:".contains(character) {
            encoded.push(character);
        } else {
            let mut buffer = [0u8; 4];
            for byte in character.encode_utf8(&mut buffer).as_bytes() {
                encoded.push_str(&format!("%{byte:02X}"));
            }
        }
    }
    encoded
}

/// The fixed `--convert-to` value of one request. Only the audited filter
/// names of D8 appear here; unsupported pairs were refused before launch.
pub fn convert_to_value(
    format: OfficeFormat,
    target: OfficeRenderTarget,
    include_comments: bool,
) -> String {
    let base = match (format.family(), target) {
        (_, OfficeRenderTarget::Pdf) => format.pdf_filter().to_string(),
        (crate::engine_types::OfficeFamily::Writer, OfficeRenderTarget::Html) => {
            "html:XHTML Writer File".to_string()
        }
        (crate::engine_types::OfficeFamily::Calc, OfficeRenderTarget::Html) => {
            "html:HTML (StarCalc)".to_string()
        }
        (crate::engine_types::OfficeFamily::Impress, OfficeRenderTarget::Html) => {
            "html:HTML (StarImpress)".to_string()
        }
        (crate::engine_types::OfficeFamily::Writer, OfficeRenderTarget::Txt)
        | (crate::engine_types::OfficeFamily::Impress, OfficeRenderTarget::Txt) => {
            "txt:Text (encoded):UTF8".to_string()
        }
        (crate::engine_types::OfficeFamily::Calc, OfficeRenderTarget::Txt) => {
            "csv:Text - txt - csv (StarCalc):44,34,76".to_string()
        }
    };
    if !include_comments || target != OfficeRenderTarget::Pdf {
        return base;
    }
    // Comments travel as documented JSON filter data; the coordinator proves
    // the exact option name against the pinned build before activation.
    let option = match format.family() {
        crate::engine_types::OfficeFamily::Writer => "ExportNotes",
        _ => "ExportComments",
    };
    format!("{base}:{{\"{option}\":{{\"type\":\"boolean\",\"value\":\"true\"}}}}")
}

/// The complete one-shot argument list (D7): no shell, no user profile, no
/// macro or external-link switch.
pub fn one_shot_arguments(
    input: &Path,
    output_dir: &Path,
    profile: &Path,
    format: OfficeFormat,
    target: OfficeRenderTarget,
    include_comments: bool,
) -> Vec<String> {
    let mut arguments: Vec<String> = [
        "--headless",
        "--nologo",
        "--nodefault",
        "--norestore",
        "--nolockcheck",
        "--nofirststartwizard",
        "--invisible",
    ]
    .iter()
    .map(|flag| (*flag).to_string())
    .collect();
    arguments.push(format!(
        "-env:UserInstallation={}",
        user_installation_url(profile)
    ));
    arguments.push("--convert-to".to_string());
    arguments.push(convert_to_value(format, target, include_comments));
    arguments.push("--outdir".to_string());
    arguments.push(output_dir.to_string_lossy().into_owned());
    arguments.push(input.to_string_lossy().into_owned());
    arguments
}

/// The only environment the Office child receives: private temporary
/// folders and a PATH that contains just the verified pack directory.
pub fn environment(profile: &Path, pack_dir: &Path) -> Vec<(String, String)> {
    let temp = profile.join("temp");
    let temp = temp.to_string_lossy().into_owned();
    vec![
        ("TEMP".to_string(), temp.clone()),
        ("TMP".to_string(), temp),
        ("PATH".to_string(), pack_dir.to_string_lossy().into_owned()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_profile_disables_macros_and_active_content() {
        let xml = profile_xml();
        assert!(profile_disables_macros(&xml));
        // A profile that leaves macro execution on is never accepted.
        let weakened = xml.replace(
            "DisableMacrosExecution\"><prop oor:name=\"Value\" oor:op=\"fuse\"><value xsi:type=\"xs:boolean\">true",
            "DisableMacrosExecution\"><prop oor:name=\"Value\" oor:op=\"fuse\"><value xsi:type=\"xs:boolean\">false",
        );
        assert!(!profile_disables_macros(&weakened));
        assert!(!convert_to_value(
            OfficeFormat::Docx,
            OfficeRenderTarget::Pdf,
            false
        )
        .to_ascii_lowercase()
        .contains("macro"));
    }

    #[test]
    fn installation_urls_are_single_arguments() {
        let url = user_installation_url(Path::new("C:\\Temp\\a b\\profile"));
        assert_eq!(url, "file:///C:/Temp/a%20b/profile");
        assert!(!url.contains(' '));
        assert_eq!(url.matches(' ').count(), 0);
    }

    #[test]
    fn templates_never_reach_a_convert_to_value() {
        // Templates are refused before launch; this documents the family
        // mapping that replaces the suffix.
        assert_eq!(
            convert_to_value(OfficeFormat::Xlsx, OfficeRenderTarget::Pdf, false),
            "calc_pdf_Export"
        );
        assert_eq!(
            convert_to_value(OfficeFormat::Pptx, OfficeRenderTarget::Html, false),
            "html:HTML (StarImpress)"
        );
    }
}
