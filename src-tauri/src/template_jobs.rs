//! Cancellable template copies use the shared start/poll/cancel job table.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, WebviewWindow};

use crate::jobs::{spawn_job, Jobs};
use crate::templates::{copy_template_with_progress, template_roots, template_sources};
use crate::{ensure_main, validate_absolute_path, AppState};

/// The copy inputs, shared with `src/services/templates.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateCreateRequest {
    pub template_path: String,
    pub dest_dir: String,
    pub name: String,
}

fn validate_create_request(
    request_id: &str,
    template_path: &str,
    dest_dir: &str,
    name: &str,
) -> Result<(), String> {
    crate::valid_request_id(request_id).map_err(|_| "templates.bad_request".to_string())?;
    validate_absolute_path(template_path).map_err(|_| "templates.bad_request".to_string())?;
    validate_absolute_path(dest_dir).map_err(|_| "templates.bad_request".to_string())?;
    if name.chars().count() > 255 {
        return Err("templates.bad_request".to_string());
    }
    fs_service::validate_new_name(name).map_err(|_| "templates.invalid_name".to_string())?;
    Ok(())
}

/// Start copying one allowed template; the job result is the new file's path.
#[tauri::command]
pub fn template_create_start(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    jobs: State<'_, Jobs>,
    request_id: String,
    request: TemplateCreateRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    validate_create_request(
        &request_id,
        &request.template_path,
        &request.dest_dir,
        &request.name,
    )?;
    // Copy the setting out: the worker never keeps the settings lock.
    let user_folder = state
        .settings
        .lock()
        .map_err(|_| "templates.other".to_string())?
        .templates
        .my_folder
        .clone();
    let sources = template_sources(&template_roots(&app), &user_folder);
    let token = jobs.begin(&request_id, 1)?;
    spawn_job(app, request_id, token, move |context| {
        let target = copy_template_with_progress(
            Path::new(&request.template_path),
            Path::new(&request.dest_dir),
            &request.name,
            &sources,
            context.token(),
            |progress| context.set_progress(progress),
        )?;
        Ok(serde_json::json!(crate::explorer::display_path(
            &target.to_string_lossy()
        )))
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_create_request;

    #[test]
    fn validates_paths_before_starting_a_copy() {
        for (source, destination) in [
            ("relative.txt", "C:\\Output"),
            ("C:\\Templates\\a.txt", "relative"),
            ("C:\\Templates\\..\\a.txt", "C:\\Output"),
        ] {
            assert_eq!(
                validate_create_request("template-1", source, destination, "a.txt")
                    .err()
                    .as_deref(),
                Some("templates.bad_request")
            );
        }
    }

    #[test]
    fn validates_request_id_before_starting_a_copy() {
        for request_id in ["", "bad id", &"a".repeat(65)] {
            assert_eq!(
                validate_create_request(request_id, "C:\\Templates\\a.txt", "C:\\Output", "a.txt")
                    .err()
                    .as_deref(),
                Some("templates.bad_request")
            );
        }
    }

    #[test]
    fn validates_name_before_starting_a_copy() {
        for name in ["", "..", "folder/a.txt", "CON.txt"] {
            assert_eq!(
                validate_create_request("template-1", "C:\\Templates\\a.txt", "C:\\Output", name)
                    .err()
                    .as_deref(),
                Some("templates.invalid_name")
            );
        }
        assert_eq!(
            validate_create_request(
                "template-1",
                "C:\\Templates\\a.txt",
                "C:\\Output",
                &"a".repeat(256)
            )
            .err()
            .as_deref(),
            Some("templates.bad_request")
        );
        assert!(validate_create_request(
            "template-1",
            "C:\\Templates\\a.txt",
            "C:\\Output",
            "New note.txt"
        )
        .is_ok());
    }
}
