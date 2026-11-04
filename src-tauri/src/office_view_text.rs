//! Read bounded page text geometry from an authorized Office snapshot view.
use crate::{
    jobs::{spawn_job, Jobs},
    office_view_sessions::OfficeViewSessions,
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

#[tauri::command]
pub fn office_view_text_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    session_id: String,
    section_id: String,
    page: u32,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id).map_err(|_| "office.bad_request")?;
    let id = Uuid::parse_str(&session_id).map_err(|_| "office.bad_request")?;
    crate::office_view_types::validate_page_request(page, 1.0)?;
    if section_id.len() > 64 {
        return Err("office.bad_request".into());
    }
    let token = jobs
        .begin(&request_id, 1)
        .map_err(|_| "office.bad_request")?;
    let owner = app.clone();
    spawn_job(app, request_id, token, move |context| {
        let sessions = owner.state::<OfficeViewSessions>();
        let entry = sessions.get(id)?;
        let work = crate::office_pool::JobContextWork(context);
        let text = entry.text(&section_id, page, &work)?;
        serde_json::to_value(text).map_err(|_| "office.engine_failed".into())
    });
    Ok(())
}
