//! Templates for the New menu (Step 06c): built-in files shipped with the
//! app and the user's own folder.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::{ensure_main, validate_absolute_path, AppState};

/// The built-in templates: their id and their file name in
/// `templates/builtin/<lang>/`. Same ids as `src/templates/catalog.ts`.
pub const BUILTIN: [(&str, &str); 6] = [
    ("letter", "letter.docx"),
    ("report", "report.docx"),
    ("budget", "budget.xlsx"),
    ("invoice", "invoice.xlsx"),
    ("meetingNotes", "meeting-notes.md"),
    ("presentation", "presentation.pptx"),
];

/// The blank Office files in `templates/blank/`, by extension.
pub const BLANK: [(&str, &str); 3] = [
    ("docx", "blank.docx"),
    ("xlsx", "blank.xlsx"),
    ("pptx", "blank.pptx"),
];

/// The most files My templates lists.
pub const MAX_USER_TEMPLATES: usize = 200;

/// The longest title a folder-picker dialog accepts, in characters.
pub const MAX_DIALOG_TITLE: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuiltinTemplateFile {
    pub id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlankTemplateFile {
    pub ext: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserTemplate {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateList {
    pub builtin: Vec<BuiltinTemplateFile>,
    pub blank: Vec<BlankTemplateFile>,
    pub user: Vec<UserTemplate>,
    pub user_folder: String,
    pub user_folder_missing: bool,
}

/// Where the shipped templates may live, like `help_roots`.
fn template_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    let push = |roots: &mut Vec<PathBuf>, path: PathBuf| {
        if !roots.contains(&path) {
            roots.push(path);
        }
    };
    if let Ok(resource_dir) = app.path().resource_dir() {
        push(&mut roots, resource_dir.join("templates"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            push(&mut roots, dir.join("../templates"));
            push(&mut roots, dir.join("templates"));
        }
    }
    push(&mut roots, PathBuf::from("./templates"));
    push(&mut roots, PathBuf::from("templates"));
    roots
}

/// `es` and `en` have their own templates; the pseudo-locale and any other
/// language use the English files.
pub fn template_lang(lang: &str) -> &'static str {
    if lang == "es" {
        "es"
    } else {
        "en"
    }
}

/// True when `path` is a real file or folder inside `root` (never `root`
/// itself). Both sides are canonicalized, so `..` cannot escape.
pub fn is_inside(root: &Path, path: &Path) -> bool {
    let (Ok(root), Ok(path)) = (fs::canonicalize(root), fs::canonicalize(path)) else {
        return false;
    };
    path != root && path.starts_with(&root)
}

/// The files directly inside the user's folder, in natural name order. A
/// missing folder is `templates.not_found`.
pub fn list_user_templates(folder: &Path) -> Result<Vec<UserTemplate>, String> {
    if !folder.is_dir() {
        return Err("templates.not_found".to_string());
    }
    let listing = fs_service::list_dir_std(folder, fs_service::SortSpec::default())
        .map_err(|_| "templates.not_found".to_string())?;
    let mut templates: Vec<UserTemplate> = Vec::new();
    for item in listing.items {
        if item.kind != fs_service::ItemKind::File || item.attrs.hidden || item.attrs.system {
            continue;
        }
        if templates.len() >= MAX_USER_TEMPLATES {
            break;
        }
        let path = item.path.to_string_lossy().into_owned();
        templates.push(UserTemplate {
            name: item.name,
            path: crate::explorer::display_path(&path),
        });
    }
    templates.sort_by(|a, b| fs_service::natural_cmp(&a.name, &b.name));
    Ok(templates)
}

/// Copy a template into `dest_dir` under a unique name: the bytes go to
/// `~name.partial` first and are renamed into place (R-SAFE-3). The copy
/// never has the Read-only attribute.
pub fn copy_template(template: &Path, dest_dir: &Path, name: &str) -> Result<PathBuf, String> {
    if fs_service::validate_new_name(name).is_err() {
        return Err("templates.invalid_name".to_string());
    }
    if !dest_dir.is_dir() || !template.is_file() {
        return Err("templates.not_found".to_string());
    }
    let target = fs_service::unique_destination(dest_dir, name);
    let partial = fs_service::partial_path(&target);
    if let Err(error) = fs::copy(template, &partial) {
        let _ = fs::remove_file(&partial);
        return Err(copy_error(&error));
    }
    if let Ok(metadata) = fs::metadata(&partial) {
        let mut permissions = metadata.permissions();
        // Windows only, and only the copy next to the target.
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        let _ = fs::set_permissions(&partial, permissions);
    }
    if let Err(error) = fs::rename(&partial, &target) {
        let _ = fs::remove_file(&partial);
        return Err(copy_error(&error));
    }
    Ok(target)
}

fn copy_error(error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        "templates.access_denied".to_string()
    } else {
        "templates.other".to_string()
    }
}

/// The folders a template may be copied from: each shipped root's
/// `builtin` and `blank` folders, and the chosen My templates folder.
fn template_sources(roots: &[PathBuf], user_folder: &str) -> Vec<PathBuf> {
    let mut sources: Vec<PathBuf> = Vec::new();
    for root in roots {
        sources.push(root.join("builtin"));
        sources.push(root.join("blank"));
    }
    if !user_folder.is_empty() {
        sources.push(PathBuf::from(user_folder));
    }
    sources
}

/// The shipped folder for `lang` (else English) and its `blank` folder.
fn shipped_folders(roots: &[PathBuf], lang: &str) -> Option<(PathBuf, PathBuf)> {
    for lang in [lang, "en"] {
        for root in roots {
            let builtin = root.join("builtin").join(lang);
            if builtin.is_dir() {
                return Some((builtin, root.join("blank")));
            }
        }
    }
    None
}

fn list_templates(app: &AppHandle, lang: &str, user_folder: &str) -> TemplateList {
    let roots = template_roots(app);
    let mut builtin = Vec::new();
    let mut blank = Vec::new();
    if let Some((builtin_dir, blank_dir)) = shipped_folders(&roots, template_lang(lang)) {
        for (id, file) in BUILTIN {
            let path = builtin_dir.join(file);
            if path.is_file() {
                builtin.push(BuiltinTemplateFile {
                    id: id.to_string(),
                    path: crate::explorer::display_path(&path.to_string_lossy()),
                });
            }
        }
        for (ext, file) in BLANK {
            let path = blank_dir.join(file);
            if path.is_file() {
                blank.push(BlankTemplateFile {
                    ext: ext.to_string(),
                    path: crate::explorer::display_path(&path.to_string_lossy()),
                });
            }
        }
    }
    let folder = Path::new(user_folder);
    let (user, user_folder_missing) = if user_folder.is_empty() {
        (Vec::new(), false)
    } else if folder.is_dir() {
        (list_user_templates(folder).unwrap_or_default(), false)
    } else {
        (Vec::new(), true)
    };
    TemplateList {
        builtin,
        blank,
        user,
        user_folder: user_folder.to_string(),
        user_folder_missing,
    }
}

/// The built-in and blank files for the app language, plus My templates.
#[tauri::command]
pub async fn templates_list(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    lang: String,
) -> Result<TemplateList, String> {
    ensure_main(window.label())?;
    // The lock is released before any disk work (P-20).
    let user_folder = state
        .settings
        .lock()
        .map_err(|_| "templates.other".to_string())?
        .templates
        .my_folder
        .clone();
    tauri::async_runtime::spawn_blocking(move || list_templates(&app, &lang, &user_folder))
        .await
        .map_err(|error| error.to_string())
}

/// Copy a template into the open folder; returns the new file's path.
#[tauri::command]
pub async fn template_create(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    template_path: String,
    dest_dir: String,
    name: String,
) -> Result<String, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&template_path).map_err(|_| "templates.bad_request".to_string())?;
    validate_absolute_path(&dest_dir).map_err(|_| "templates.bad_request".to_string())?;
    if name.chars().count() > 255 {
        return Err("templates.bad_request".to_string());
    }
    let user_folder = state
        .settings
        .lock()
        .map_err(|_| "templates.other".to_string())?
        .templates
        .my_folder
        .clone();
    let sources = template_sources(&template_roots(&app), &user_folder);
    tauri::async_runtime::spawn_blocking(move || {
        let template = PathBuf::from(&template_path);
        if !sources.iter().any(|folder| is_inside(folder, &template)) {
            return Err("templates.not_allowed".to_string());
        }
        let target = copy_template(&template, Path::new(&dest_dir), &name)?;
        Ok(crate::explorer::display_path(&target.to_string_lossy()))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Windows' folder picker for My templates.
#[tauri::command]
pub async fn templates_pick_folder(
    window: WebviewWindow,
    title: String,
) -> Result<Option<String>, String> {
    ensure_main(window.label())?;
    let length = title.chars().count();
    if length == 0 || length > MAX_DIALOG_TITLE {
        return Err("templates.bad_request".to_string());
    }
    let owner = crate::window_handle(&window);
    tauri::async_runtime::spawn_blocking(move || {
        crate::file_dialogs::pick_folder_path(owner, &title).map_err(|code| {
            if code == "dialog.failed" {
                "templates.other".to_string()
            } else {
                code
            }
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lang_falls_back_to_english() {
        assert_eq!(template_lang("es"), "es");
        assert_eq!(template_lang("en"), "en");
        assert_eq!(template_lang("pseudo"), "en");
        assert_eq!(template_lang("fr"), "en");
    }

    #[test]
    fn is_inside_needs_a_real_child() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        let sibling = temp.path().join("sibling");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&sibling).unwrap();
        let child = root.join("a.txt");
        fs::write(&child, b"x").unwrap();
        assert!(is_inside(&root, &child));
        assert!(!is_inside(&root, &root));
        assert!(!is_inside(&root, &sibling));
        assert!(!is_inside(&root, &root.join("..").join("sibling")));
    }

    #[test]
    fn copy_template_never_overwrites() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("t.docx");
        fs::write(&source, b"template bytes").unwrap();
        let dest = temp.path().join("dest");
        fs::create_dir(&dest).unwrap();
        let first = copy_template(&source, &dest, "Letter.docx").unwrap();
        let second = copy_template(&source, &dest, "Letter.docx").unwrap();
        assert_eq!(first.file_name().unwrap(), "Letter.docx");
        assert_eq!(second.file_name().unwrap(), "Letter (1).docx");
        assert_eq!(fs::read(&first).unwrap(), b"template bytes");
        assert_eq!(fs::read(&second).unwrap(), b"template bytes");
        let partial_left = fs::read_dir(&dest)
            .unwrap()
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().ends_with(".partial"));
        assert!(!partial_left);
    }

    #[test]
    fn copy_template_clears_read_only() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("t.docx");
        fs::write(&source, b"template bytes").unwrap();
        let mut permissions = fs::metadata(&source).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&source, permissions).unwrap();
        let dest = temp.path().join("dest");
        fs::create_dir(&dest).unwrap();
        let copy = copy_template(&source, &dest, "Letter.docx").unwrap();
        assert!(!fs::metadata(&copy).unwrap().permissions().readonly());
        // The template itself stays as it was.
        assert!(fs::metadata(&source).unwrap().permissions().readonly());
    }

    #[test]
    fn user_templates_skip_hidden_files_and_folders() {
        use windows::Win32::Storage::FileSystem::{SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN};
        let temp = tempfile::tempdir().unwrap();
        let folder = temp.path().join("mine");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("a.txt"), b"a").unwrap();
        fs::write(folder.join("B.docx"), b"b").unwrap();
        fs::create_dir(folder.join("sub")).unwrap();
        let hidden = folder.join("h.txt");
        fs::write(&hidden, b"h").unwrap();
        let wide: Vec<u16> = hidden
            .as_os_str()
            .to_string_lossy()
            .encode_utf16()
            .chain(Some(0))
            .collect();
        // SAFETY: the test owns this path; wide is terminated and outlives the call.
        unsafe {
            SetFileAttributesW(windows::core::PCWSTR(wide.as_ptr()), FILE_ATTRIBUTE_HIDDEN).unwrap()
        };
        let listed = list_user_templates(&folder).unwrap();
        let names: Vec<&str> = listed.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, ["a.txt", "B.docx"]);
    }
}
