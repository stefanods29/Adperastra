//! Templates for the New menu (Step 06c): built-in files shipped with the
//! app and the user's own folder.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::{ensure_main, validate_absolute_path, AppState};

#[path = "template_copy.rs"]
mod template_copy;
#[cfg(test)]
use template_copy::copy_template;
pub(crate) use template_copy::copy_template_with_progress;

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
    #[serde(default)]
    pub user_error: Option<String>,
    #[serde(default)]
    pub user_skipped: usize,
}

/// Where the shipped templates may live, like `help_roots`.
pub(crate) fn template_roots(app: &AppHandle) -> Vec<PathBuf> {
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
#[cfg(test)]
pub fn is_inside(root: &Path, path: &Path) -> bool {
    let (Ok(root), Ok(path)) = (fs::canonicalize(root), fs::canonicalize(path)) else {
        return false;
    };
    path != root && path.starts_with(&root)
}

/// The files directly inside the user's folder, in natural name order. A
/// missing folder is `templates.not_found`.
#[cfg(test)]
pub fn list_user_templates(folder: &Path) -> Result<Vec<UserTemplate>, String> {
    list_user_templates_with_issues(folder).map(|(templates, _)| templates)
}

fn list_user_templates_with_issues(folder: &Path) -> Result<(Vec<UserTemplate>, usize), String> {
    let listing =
        fs_service::list_dir_std(folder, fs_service::SortSpec::default()).map_err(|error| {
            match error {
                fs_service::FsError::Io(error) => template_copy::copy_error(&error),
                _ => "templates.other".to_string(),
            }
        })?;
    Ok(user_templates_from_listing(listing))
}

fn user_templates_from_listing(listing: fs_service::Listing) -> (Vec<UserTemplate>, usize) {
    let skipped = listing.skipped.len();
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
    (templates, skipped)
}

/// The folders a template may be copied from: each shipped root's
/// `builtin` and `blank` folders, and the chosen My templates folder.
pub(crate) fn template_sources(roots: &[PathBuf], user_folder: &str) -> Vec<PathBuf> {
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
    let (user, user_folder_missing, user_error, user_skipped) = user_template_state(user_folder);
    TemplateList {
        builtin,
        blank,
        user,
        user_folder: user_folder.to_string(),
        user_folder_missing,
        user_error,
        user_skipped,
    }
}

fn user_template_state(user_folder: &str) -> (Vec<UserTemplate>, bool, Option<String>, usize) {
    if user_folder.is_empty() {
        return (Vec::new(), false, None, 0);
    }
    let folder = Path::new(user_folder);
    match fs::metadata(folder) {
        Ok(metadata) if !metadata.is_dir() => return (Vec::new(), true, None, 0),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return (Vec::new(), true, None, 0);
        }
        Err(error) => {
            return (
                Vec::new(),
                false,
                Some(template_copy::copy_error(&error)),
                0,
            );
        }
        _ => {}
    }
    match list_user_templates_with_issues(folder) {
        Ok((user, skipped)) => (user, false, None, skipped),
        Err(code) if code == "templates.not_found" => (Vec::new(), true, None, 0),
        Err(code) => (Vec::new(), false, Some(code), 0),
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
        let target = copy_template_with_progress(
            &template,
            Path::new(&dest_dir),
            &name,
            &sources,
            &fs_service::new_cancellation_token(),
            |_| {},
        )?;
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
#[path = "templates_tests.rs"]
mod tests;
