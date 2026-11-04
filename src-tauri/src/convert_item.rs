fn outputs_from(
    published: &[crate::convert_publish::PublishedOutput],
    index: u32,
    first_output: u32,
) -> Vec<ConversionOutput> {
    published
        .iter()
        .map(|row| ConversionOutput {
            output_id: Uuid::new_v4().to_string(),
            input_indices: vec![index],
            output_index: first_output + row.output_index,
            path: row.path.to_string_lossy().into_owned(),
            byte_len: row.byte_len,
        })
        .collect()
}

fn failed_item(
    index: u32,
    path: Option<String>,
    reason: &str,
    cancelled: bool,
    published: &[crate::convert_publish::PublishedOutput],
    first_output: u32,
) -> ItemOutcome {
    let outputs = outputs_from(published, index, first_output);
    ItemOutcome {
        item: WorkItemResult {
            input_index: index,
            source_path: path,
            output_count: outputs.len() as u32,
            status: if cancelled {
                WorkItemStatus::Cancelled
            } else {
                WorkItemStatus::Failed
            },
            reason: Some(reason.to_string()),
            metadata_lost: Vec::new(),
            bytes_written: outputs.iter().map(|row| row.byte_len).sum(),
        },
        outputs,
    }
}

fn failed_plain(index: u32, path: Option<String>, reason: &str) -> ItemOutcome {
    failed_item(index, path, reason, false, &[], 0)
}

fn reason_suffix(code: &str) -> String {
    code.strip_prefix("convert.")
        .unwrap_or("io")
        .to_string()
}

#[allow(clippy::too_many_arguments)]
fn run_one(
    snapshots: &ExportSnapshots,
    spec: &ConverterSpec,
    route: crate::convert::ConvertRoute,
    request: &ConversionRequest,
    index: u32,
    input: &ConversionInput,
    first_output: u32,
    context: &crate::jobs::JobContext,
) -> ItemOutcome {
    let dest = Path::new(&request.dest_dir);
    // The guard stays alive until this input has finished, so no other
    // program can write, rename or delete the source while it is read.
    let mut _guard: Option<PinnedSource> = None;
    let (source, snapshot_bytes) = match input {
        ConversionInput::File { path, expected } => {
            let resolved = match resolve_file(Path::new(path), expected.as_ref()) {
                Ok(resolved) => resolved,
                Err(code) => {
                    return failed_plain(index, Some(path.clone()), &reason_suffix(&code));
                }
            };
            let source = HelperSource {
                kind: "file".to_string(),
                path: Some(path.clone()),
                stamp: Some(resolved.stamp.clone()),
                name: resolved.name,
                mime: resolved.mime,
                byte_len: resolved.stamp.size_bytes,
            };
            _guard = Some(resolved._guard);
            (source, None)
        }
        ConversionInput::Snapshot {
            snapshot_id,
            document_id,
            revision,
        } => {
            let (name, mime, stamp, bytes, _sensitive) =
                match resolve_snapshot(snapshots, snapshot_id, document_id, *revision) {
                    Ok(value) => value,
                    Err(code) => {
                        return failed_plain(index, None, &reason_suffix(&code));
                    }
                };
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
            )
        }
    };
    let format = FormatId::from_extension(
        &source
            .name
            .rsplit_once('.')
            .map(|(_, extension)| extension.to_string())
            .unwrap_or_default(),
    )
    .or_else(|| FormatId::from_mime(&source.mime));
    if !format.is_some_and(|format| spec.inputs.contains(&format)) {
        return failed_plain(index, source.path.clone(), "unsupported");
    }
    let stem = convert::options::output_stem(&source.name);
    let directory = match PinnedDirectory::open(dest) {
        Ok(directory) => directory,
        Err(_) => return failed_plain(index, source.path.clone(), "bad_request"),
    };
    let mut sink = PublishSink::new(directory, stem, spec.output);
    if sink.ensure_free_space(0).is_err() {
        return failed_plain(index, source.path.clone(), "no_space");
    }
    // Both native helper routes own the source guard through the supplied
    // `ConversionInput`; the helper route receives the same one bounded
    // source and the native-owned intermediate root.
    let converted: Result<PreparedOutput, String> = match route {
        crate::convert::ConvertRoute::NativePdf => crate::conversion_pdf::convert_pdf_pages(
            input,
            &request.options,
            &mut sink,
            context,
            spec.max_output_bytes,
        ),
        crate::convert::ConvertRoute::NativeDocument => crate::conversion_documents::convert_document(
            input,
            spec.id.as_str(),
            &request.options,
            &mut sink,
            context,
            spec.max_output_bytes,
        ),
        // Combine routes are handled once for the whole selection before any
        // per-input work; reaching here means the job wiring is wrong.
        crate::convert::ConvertRoute::NativeImagesPdf => Err("convert.bad_request".to_string()),
        // Media runs in the confined engine host and streams through this
        // same `PublishSink`; no second queue or publication path exists.
        crate::convert::ConvertRoute::EngineMedia => {
            let app = context.app();
            let Some(host) = app.try_state::<Arc<crate::engine_process::EngineHost>>() else {
                return failed_plain(index, source.path.clone(), "unsupported");
            };
            let cache = app.state::<Arc<crate::cache::CacheService>>();
            let engine_input = match crate::engine_types::EngineInput::resolve(
                index,
                input.clone(),
                cache.inner().as_ref(),
                snapshots,
            ) {
                Ok(engine_input) => engine_input,
                Err(code) => {
                    let mapped = crate::engine_conversion::map_engine_error(code).code();
                    return failed_plain(index, source.path.clone(), &reason_suffix(mapped));
                }
            };
            match crate::engine_conversion::run_engine_conversion(
                host.inner().as_ref(),
                request,
                vec![engine_input],
                &mut sink,
                context,
            ) {
                Ok(prepared) => {
                    if let (ConversionInput::File { path, .. }, Some(expected)) =
                        (input, source.stamp.as_ref())
                    {
                        let unchanged = fs_service::capture_source_stamp(Path::new(path))
                            .map(|after| &after == expected)
                            .unwrap_or(false);
                        if !unchanged {
                            return failed_item(
                                index,
                                source.path.clone(),
                                "changed",
                                false,
                                sink.published(),
                                first_output,
                            );
                        }
                    }
                    Ok(prepared)
                }
                Err(error) => Err(error.code().to_string()),
            }
        }
        crate::convert::ConvertRoute::Helper => {
            let helper_request = HelperRequest {
                mode: "convert".to_string(),
                converter_id: spec.id.as_str().to_string(),
                options: request.options.clone(),
                accepted_losses: request.accepted_losses.clone(),
                accepted_warning_codes: request.accepted_warning_codes.clone(),
                max_output_bytes: spec.max_output_bytes,
                input_index: index,
                source: source.clone(),
                work_root: Some(
                    crate::convert::conversion_work_root(context.app())
                        .to_string_lossy()
                        .into_owned(),
                ),
            };
            match run_helper(&helper_request, snapshot_bytes.as_ref(), &mut sink, context) {
                Ok(outcome) => {
                    if let (ConversionInput::File { path, .. }, Some(expected)) =
                        (input, source.stamp.as_ref())
                    {
                        let unchanged = fs_service::capture_source_stamp(Path::new(path))
                            .map(|after| &after == expected)
                            .unwrap_or(false);
                        if !unchanged {
                            return failed_item(
                                index,
                                source.path.clone(),
                                "changed",
                                false,
                                sink.published(),
                                first_output,
                            );
                        }
                    }
                    serde_json::from_value(outcome.final_json)
                        .map_err(|_| "convert.io".to_string())
                }
                Err(code) => Err(code),
            }
        }
    };
    let prepared: PreparedOutput = match converted {
        Ok(prepared) => prepared,
        Err(code) => {
            let cancelled = code == "convert.cancelled";
            return failed_item(
                index,
                source.path.clone(),
                &reason_suffix(&code),
                cancelled,
                sink.published(),
                first_output,
            );
        }
    };
    if prepared.outputs_count as usize != sink.published().len() {
        return failed_item(index, source.path.clone(), "io", false, sink.published(), first_output);
    }
    let outputs = outputs_from(sink.published(), index, first_output);
    ItemOutcome {
        item: WorkItemResult {
            input_index: index,
            source_path: source.path.clone(),
            output_count: outputs.len() as u32,
            status: WorkItemStatus::Done,
            reason: None,
            metadata_lost: prepared.metadata_lost,
            bytes_written: outputs.iter().map(|row| row.byte_len).sum(),
        },
        outputs,
    }
}

fn combine_failure(
    request: &ConversionRequest,
    reason: &str,
    cancelled: bool,
) -> CombineOutcome {
    let items = request
        .inputs
        .iter()
        .enumerate()
        .map(|(index, input)| WorkItemResult {
            input_index: index as u32,
            source_path: input.path().map(str::to_string),
            output_count: 0,
            status: if cancelled {
                WorkItemStatus::Cancelled
            } else {
                WorkItemStatus::Failed
            },
            reason: Some(reason.to_string()),
            metadata_lost: Vec::new(),
            bytes_written: 0,
        })
        .collect();
    CombineOutcome {
        items,
        outputs: Vec::new(),
        cancelled,
    }
}

/// The first source's stem names the one combined output (08a naming).
fn combine_stem(snapshots: &ExportSnapshots, input: &ConversionInput) -> Result<String, String> {
    let name = match input {
        ConversionInput::File { path, expected } => {
            resolve_file(Path::new(path), expected.as_ref())?.name
        }
        ConversionInput::Snapshot {
            snapshot_id,
            document_id,
            revision,
        } => {
            let _lease = snapshots.resolve(snapshot_id, document_id, *revision)?;
            let document = Uuid::parse_str(document_id).map_err(|_| "convert.bad_request")?;
            snapshots
                .authorities()
                .get(document)
                .map_err(|_| "convert.changed")?
                .authority
                .name
        }
    };
    Ok(convert::options::output_stem(&name))
}

/// Run one `combine` adapter over the whole selection. Validation, decoding
/// and orientation happen before the first output can begin, so a bad member
/// publishes nothing. The single PDF is staged and published by the shared
/// `PublishSink`, exactly like every `each` adapter's output.
fn run_combine(
    snapshots: &ExportSnapshots,
    spec: &ConverterSpec,
    request: &ConversionRequest,
    context: &crate::jobs::JobContext,
) -> CombineOutcome {
    if request.inputs.is_empty() {
        return combine_failure(request, "bad_request", false);
    }
    if request.inputs.len() > crate::conversion_pdf::MAX_COMBINE_IMAGES {
        return combine_failure(request, "too_large", false);
    }
    let stem = match combine_stem(snapshots, &request.inputs[0]) {
        Ok(stem) => stem,
        Err(code) => return combine_failure(request, &reason_suffix(&code), false),
    };
    let destination = match PinnedDirectory::open(Path::new(&request.dest_dir)) {
        Ok(directory) => directory,
        Err(_) => return combine_failure(request, "bad_request", false),
    };
    let mut sink = PublishSink::new(destination, stem, spec.output);
    if sink.ensure_free_space(0).is_err() {
        return combine_failure(request, "no_space", false);
    }
    let prepared = match crate::conversion_pdf::convert_images_to_pdf(
        &request.inputs,
        &request.options,
        &request.accepted_warning_codes,
        &mut sink,
        context,
        spec.max_output_bytes,
    ) {
        Ok(prepared) => prepared,
        Err(code) => {
            let cancelled = code == "convert.cancelled";
            return combine_failure(request, &reason_suffix(&code), cancelled);
        }
    };
    let published = sink.published();
    if prepared.outputs_count != 1 || published.len() != 1 {
        return combine_failure(request, "io", false);
    }
    let output = &published[0];
    let output_row = ConversionOutput {
        output_id: Uuid::new_v4().to_string(),
        input_indices: (0..request.inputs.len() as u32).collect(),
        output_index: output.output_index,
        path: output.path.to_string_lossy().into_owned(),
        byte_len: output.byte_len,
    };
    let items = request
        .inputs
        .iter()
        .enumerate()
        .map(|(index, input)| WorkItemResult {
            input_index: index as u32,
            source_path: input.path().map(str::to_string),
            // The one file carries the first input's stem; every input is
            // done because its required page in that file finished.
            output_count: if index == 0 { 1 } else { 0 },
            status: WorkItemStatus::Done,
            reason: None,
            metadata_lost: prepared.metadata_lost.clone(),
            bytes_written: if index == 0 { output.byte_len } else { 0 },
        })
        .collect();
    context.set_progress(&OpProgress {
        items_done: request.inputs.len(),
        items_total: request.inputs.len(),
        bytes_done: output.byte_len,
        bytes_total: output.byte_len,
        current: String::new(),
    });
    CombineOutcome {
        items,
        outputs: vec![output_row],
        cancelled: false,
    }
}

fn cancelled_row(index: u32, path: Option<String>) -> WorkItemResult {
    WorkItemResult {
        input_index: index,
        source_path: path,
        output_count: 0,
        status: WorkItemStatus::Cancelled,
        reason: Some("cancelled".to_string()),
        metadata_lost: Vec::new(),
        bytes_written: 0,
    }
}

