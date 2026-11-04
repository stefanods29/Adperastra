//! Fixed conversion arguments for the separately packaged native Kit worker.

use std::path::{Component, Path, Prefix};

fn kit_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    // Kit turns its arguments into file URLs. Its encoder interprets the
    // Windows verbatim drive prefix as part of the URL authority.
    if matches!(
        path.components().next(),
        Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::VerbatimDisk(_))
    ) {
        return text[4..].to_owned();
    }
    text.into_owned()
}

/// Called only after EngineHost has acquired the signed Office entrypoint.
/// The program and every resource remain inside that verified pack tree.
pub fn is_kit_worker(program: &Path) -> bool {
    program
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("libreoffice-kit.exe"))
}

pub fn pdf_arguments(program: &Path, input: &Path, output: &Path, profile: &Path) -> Vec<String> {
    let parent = program.parent().unwrap_or(program);
    let root = if parent
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case("bin"))
    {
        parent.parent().unwrap_or(parent)
    } else {
        parent
    };
    let resources = root.join("program").join("program");
    let mut arguments: Vec<String> = [
        ("--program-directory", kit_path(&resources)),
        ("--input-path", kit_path(input)),
        ("--output-path", kit_path(output)),
        ("--profile-directory", kit_path(profile)),
        ("--max-output-bytes", "67108864".into()),
        ("--max-image-resolution", "144".into()),
        ("--format", "pdf".into()),
        ("--recalculate", "false".into()),
    ]
    .into_iter()
    .flat_map(|(flag, value)| [flag.into(), value])
    .collect();
    // The caller verifies the complete signed pack tree before building
    // these arguments. Keep font registration private to this child.
    if let Ok(entries) = std::fs::read_dir(root.join("fonts")) {
        let mut fonts: Vec<_> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "ttf"))
            .take(25)
            .collect();
        if fonts.len() <= 24 {
            fonts.sort_unstable();
            for font in fonts {
                arguments.extend(["--font-file".into(), kit_path(&font)]);
            }
        }
    }
    arguments
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn kit_pdf_uses_private_paths_and_disables_recalculation() {
        let args = pdf_arguments(
            Path::new("C:/verified pack/libreoffice-kit.exe"),
            Path::new("C:/private/input/document.docx"),
            Path::new("C:/private/output/document.pdf"),
            Path::new("C:/private/profile"),
        );
        let (pairs, remainder) = args.as_chunks::<2>();
        assert!(remainder.is_empty());
        let pairs: std::collections::BTreeMap<_, _> = pairs
            .iter()
            .map(|pair| (pair[0].as_str(), pair[1].as_str()))
            .collect();
        assert_eq!(
            Path::new(pairs["--program-directory"]),
            Path::new("C:/verified pack")
                .join("program")
                .join("program")
        );
        assert_eq!(pairs["--input-path"], "C:/private/input/document.docx");
        assert_eq!(pairs["--output-path"], "C:/private/output/document.pdf");
        assert_eq!(pairs["--profile-directory"], "C:/private/profile");
        assert_eq!(pairs["--format"], "pdf");
        assert_eq!(pairs["--recalculate"], "false");
        assert_eq!(pairs["--max-output-bytes"], "67108864");
        assert_eq!(pairs["--max-image-resolution"], "144");
    }

    #[test]
    fn kit_input_is_one_argument_even_with_spaces() {
        let source = Path::new("C:/private/input/a b & c.pptx");
        let args = pdf_arguments(
            Path::new("C:/pack/libreoffice-kit.exe"),
            source,
            Path::new("C:/private/output/document.pdf"),
            Path::new("C:/private/profile"),
        );
        assert_eq!(
            args.iter()
                .filter(|arg| *arg == "C:/private/input/a b & c.pptx")
                .count(),
            1
        );
        assert!(!args.iter().any(|arg| arg == "cmd" || arg == "/c"));
    }

    #[test]
    fn kit_upstream_bin_layout_resolves_only_pack_resources() {
        let args = pdf_arguments(
            Path::new("C:/pack/bin/libreoffice-kit.exe"),
            Path::new("C:/private/input.docx"),
            Path::new("C:/private/output.pdf"),
            Path::new("C:/private/profile"),
        );
        assert_eq!(
            Path::new(&args[1]),
            Path::new("C:/pack").join("program").join("program")
        );
    }

    #[cfg(windows)]
    #[test]
    fn kit_converts_pinned_drive_paths_to_file_url_compatible_paths() {
        let args = pdf_arguments(
            Path::new(r"\\?\C:\pack\bin\libreoffice-kit.exe"),
            Path::new(r"\\?\C:\private\input.docx"),
            Path::new(r"\\?\C:\private\output.pdf"),
            Path::new(r"\\?\C:\private\profile"),
        );
        assert_eq!(args[1], r"C:\pack\program\program");
        assert_eq!(args[3], r"C:\private\input.docx");
        assert_eq!(args[5], r"C:\private\output.pdf");
        assert_eq!(args[7], r"C:\private\profile");
    }
}
