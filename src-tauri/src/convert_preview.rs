/// Run one preview. The PNG becomes a leased memory result, never a disk
/// cache entry for a sensitive snapshot.
pub fn run_preview_job(
    app: &AppHandle,
    request: ConversionPreviewRequest,
    context: &crate::jobs::JobContext,
) -> Result<ConversionPreview, String> {
    let registry = crate::convert::conversion_registry(app);
    let spec = registry
        .get(request.converter_id.as_str())
        .ok_or_else(|| "convert.bad_request".to_string())?
        .spec();
    if !spec.available {
        return Err(crate::convert::unavailable_converter_code(&spec).to_string());
    }
    // A combine adapter has no single-source preview in this round, and a
    // media conversion preview is the separate `media_preview_start` sample
    // (E2). Fail closed before starting a helper that could not answer.
    if matches!(
        crate::convert::route_for(spec.id.as_str(), &request.options),
        Some(crate::convert::ConvertRoute::NativeImagesPdf)
            | Some(crate::convert::ConvertRoute::EngineMedia)
    ) {
        return Err("convert.unsupported".to_string());
    }
    request
        .validate()
        .map_err(|error| error.code().to_string())?;
    let input = request
        .inputs
        .first()
        .ok_or_else(|| "convert.bad_request".to_string())?;
    let snapshots = app.state::<Arc<ExportSnapshots>>();
    let mut source_guard = None;
    let (source, snapshot_bytes, sensitive) = match input {
        ConversionInput::File { path, expected } => {
            let resolved = resolve_file_policy(Path::new(path), expected.as_ref(), true)?;
            source_guard = Some(resolved._guard);
            (
                HelperSource {
                    kind: "file".to_string(),
                    path: Some(path.clone()),
                    stamp: Some(resolved.stamp.clone()),
                    name: resolved.name,
                    mime: resolved.mime,
                    byte_len: resolved.stamp.size_bytes,
                },
                None,
                false,
            )
        }
        ConversionInput::Snapshot {
            snapshot_id,
            document_id,
            revision,
        } => {
            let (name, mime, stamp, bytes, sensitive) =
                resolve_snapshot(&snapshots, snapshot_id, document_id, *revision)?;
            let byte_len = bytes.len() as u64;
            (
                HelperSource {
                    kind: "snapshot".to_string(),
                    path: None,
                    stamp,
                    name,
                    mime,
                    byte_len,
                },
                Some(bytes),
                sensitive,
            )
        }
    };
    let helper_request = HelperRequest {
        mode: "preview".to_string(),
        converter_id: spec.id.as_str().to_string(),
        options: request.options,
        accepted_losses: Vec::new(),
        accepted_warning_codes: Vec::new(),
        max_output_bytes: convert::types::MAX_PREVIEW_BYTES as u64,
        input_index: 0,
        source,
        // Previews never extract archives; no intermediate root is passed.
        work_root: None,
    };
    // A preview writes nothing; the unfinalized sink drops anything a
    // misbehaving helper might try to begin.
    let directory = PinnedDirectory::open(snapshots.root())
        .map_err(|_| "convert.io".to_string())?;
    let mut sink = PublishSink::new(directory, "preview".to_string(), spec.output);
    let outcome = run_helper(&helper_request, snapshot_bytes.as_ref(), &mut sink, context)?;
    drop(source_guard);
    let meta: HelperPreviewMeta = serde_json::from_value(outcome.final_json)
        .map_err(|_| "convert.io".to_string())?;
    let png = outcome.preview_png.ok_or_else(|| "convert.io".to_string())?;
    let dimensions = crate::thumbnail_helper::png_size_bytes(&png)
        .ok_or_else(|| "convert.io".to_string())?;
    if dimensions != (meta.width, meta.height) || meta.width == 0 || meta.height == 0
        || meta.width > 512 || meta.height > 512 || meta.warnings.len() > 64 || meta.metadata_lost.len() > 64 {
        return Err("convert.too_large".into());
    }
    let cache = app.state::<Arc<crate::cache::CacheService>>();
    let lease = cache
        .lease_memory(
            Arc::new(Zeroizing::new(png)),
            "preview.png",
            "image/png",
            Some(meta.width),
            Some(meta.height),
            sensitive,
        )
        .map_err(|_| "convert.io".to_string())?;
    Ok(ConversionPreview {
        image: lease,
        input_revision: request.request_revision,
        width: meta.width,
        height: meta.height,
        estimated_bytes: meta.estimated_bytes,
        estimated_ms: meta.estimated_ms,
        warnings: meta.warnings,
        metadata_lost: meta.metadata_lost,
    })
}

