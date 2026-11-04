// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn validate_converter(app: &AppHandle, request: &ConversionRequest) -> Result<(), String> {
    let registry = crate::convert::conversion_registry(app);
    let spec = registry
        .get(request.converter_id.as_str())
        .ok_or_else(|| "convert.bad_request".to_string())?;
    let spec = spec.spec();
    if !spec.available {
        return Err(crate::convert::unavailable_converter_code(&spec).to_string());
    }
    // The typed options family must be the one this adapter executes. Media
    // and Office have no wired path yet, so they fail closed.
    crate::convert::route_for(spec.id.as_str(), &request.options)
        .ok_or_else(|| "convert.bad_request".to_string())?;
    if spec.input_mode == "combine"
        && request.inputs.len() > crate::conversion_pdf::MAX_COMBINE_IMAGES
    {
        return Err("convert.too_large".to_string());
    }
    for input in &request.inputs {
        if let ConversionInput::File { path, .. } = input {
            crate::validate_absolute_path(path)
                .map_err(|_| "convert.bad_request".to_string())?;
            let extension = Path::new(path)
                .extension()
                .map(|value| value.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            let Some(format) = FormatId::from_extension(&extension) else {
                return Err("convert.unsupported".to_string());
            };
            if !spec.inputs.contains(&format) {
                return Err("convert.unsupported".to_string());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn convert_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, crate::jobs::Jobs>,
    request_id: String,
    request: ConversionRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    request
        .validate()
        .map_err(|error| error.code().to_string())?;
    crate::validate_absolute_path(&request.dest_dir)
        .map_err(|_| "convert.bad_request".to_string())?;
    let dest = Path::new(&request.dest_dir);
    if !dest.is_dir() || crate::operation_safety::protected_path(dest) {
        return Err("convert.bad_request".to_string());
    }
    validate_converter(&app, &request)?;
    let token = jobs.begin(&request_id, request.inputs.len())?;
    let app_for_job = app.clone();
    crate::jobs::spawn_job(app, request_id, token, move |context| {
        let report = run_job(&app_for_job, request, context)?;
        serde_json::to_value(report).map_err(|_| "convert.io".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn convert_preview_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, crate::jobs::Jobs>,
    request_id: String,
    request: ConversionPreviewRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    request
        .validate()
        .map_err(|error| error.code().to_string())?;
    let token = jobs.begin(&request_id, 1)?;
    let app_for_job = app.clone();
    crate::jobs::spawn_job(app, request_id, token, move |context| {
        let preview = run_preview_job(&app_for_job, request, context)?;
        serde_json::to_value(preview).map_err(|_| "convert.io".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn convert_report_page(
    window: WebviewWindow,
    reports: State<'_, ConversionReports>,
    cursor: String,
) -> Result<convert::ConversionReport, String> {
    crate::ensure_main(window.label())?;
    reports.page(&cursor)
}


