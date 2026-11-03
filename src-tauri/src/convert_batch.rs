/// Run one whole conversion job. Setup errors abort before any output.
pub fn run_job(
    app: &AppHandle,
    mut request: ConversionRequest,
    context: &crate::jobs::JobContext,
) -> Result<convert::ConversionReport, String> {
    let registry = convert::builtin_registry();
    let spec = registry
        .get(request.converter_id.as_str())
        .ok_or_else(|| "convert.bad_request".to_string())?
        .spec();
    request
        .validate()
        .map_err(|error| error.code().to_string())?;
    if !convert::types::is_utc_date(&request.naming.date_utc) {
        request.naming.date_utc = convert::options::current_utc_date();
    }
    crate::validate_absolute_path(&request.dest_dir)
        .map_err(|_| "convert.bad_request".to_string())?;
    let dest = PathBuf::from(&request.dest_dir);
    if !dest.is_dir() || crate::operation_safety::protected_path(&dest) {
        return Err("convert.bad_request".to_string());
    }
    let snapshots = app.state::<Arc<ExportSnapshots>>();
    let concurrent_jobs = app
        .state::<crate::AppState>()
        .settings
        .lock()
        .map(|settings| usize::from(settings.conversion.concurrent_jobs))
        .unwrap_or(MAX_CONCURRENT_CONVERSIONS);
    let gate = app.state::<ConvertGate>();
    let _permit = gate.acquire_with(concurrent_jobs, context.token())?;
    let mut items = Vec::new();
    let mut outputs = Vec::new();
    let mut cancelled = false;
    let total = request.inputs.len() as u32;
    for (index, input) in request.inputs.iter().enumerate() {
        if context.token().load(Ordering::Relaxed) {
            cancelled = true;
            items.push(cancelled_row(index as u32, input.path().map(str::to_string)));
            for missing in (index + 1)..request.inputs.len() {
                items.push(cancelled_row(
                    missing as u32,
                    request.inputs[missing].path().map(str::to_string),
                ));
            }
            break;
        }
        let first_output = outputs.len() as u32;
        let outcome = run_one(
            &snapshots,
            &spec,
            &request,
            index as u32,
            input,
            first_output,
            context,
        );
        let was_cancelled = outcome.item.status == WorkItemStatus::Cancelled;
        outputs.extend(outcome.outputs);
        items.push(outcome.item);
        context.set_progress(&OpProgress {
            items_done: index + 1,
            items_total: total as usize,
            bytes_done: 0,
            bytes_total: 0,
            current: input.path().unwrap_or_default().to_string(),
        });
        if was_cancelled {
            cancelled = true;
            for missing in (index + 1)..request.inputs.len() {
                items.push(cancelled_row(
                    missing as u32,
                    request.inputs[missing].path().map(str::to_string),
                ));
            }
            break;
        }
    }
    let report = StoredReport::new(items, outputs, cancelled);
    app.state::<ConversionReports>().insert(report)
}

