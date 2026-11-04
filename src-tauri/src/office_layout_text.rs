//! Bounded geometry for editing a live Office snapshot on its rendered page.
use crate::office_view_types::OfficeLayoutText;
use fs_service::CancellationToken;
use tauri::AppHandle;
use uuid::Uuid;

pub fn read(
    app: &AppHandle,
    cancel: &CancellationToken,
    session: Uuid,
    page: u32,
    width: f64,
    height: f64,
) -> Result<OfficeLayoutText, String> {
    let mut result = OfficeLayoutText {
        runs: Vec::new(),
        complete: false,
    };
    let mut cursor = None;
    let mut bytes = 0;
    for _ in 0..8 {
        let chunk = crate::pdf_jobs::read_text(app, cancel, session, page, cursor)?;
        for run in chunk.runs {
            if ![run.x, run.y, run.width, run.height, run.font_size]
                .iter()
                .all(|v| v.is_finite())
                || run.x < 0.0
                || run.y < 0.0
                || run.width <= 0.0
                || run.height <= 0.0
                || run.x > width
                || run.y > height
                || run.width > width * 2.0
                || run.height > height * 2.0
                || run.font_size <= 0.0
                || run.font_size > 1000.0
                || run.text.len() > 16_384
            {
                return Ok(result);
            }
            bytes += serde_json::to_vec(&run)
                .map_err(|_| "office.engine_failed")?
                .len()
                + 1;
            if result.runs.len() >= 2000 || bytes > 380 * 1024 {
                return Ok(result);
            }
            result.runs.push(run);
        }
        if chunk.complete {
            result.complete = true;
            return Ok(result);
        }
        let next = chunk.next_run.ok_or("office.engine_failed")?;
        if cursor.is_some_and(|current| next <= current) {
            return Err("office.engine_failed".into());
        }
        cursor = Some(next);
    }
    Ok(result)
}
