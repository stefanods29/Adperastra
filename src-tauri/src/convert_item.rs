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

fn run_one(
    snapshots: &ExportSnapshots,
    spec: &ConverterSpec,
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
    let helper_request = HelperRequest {
        mode: "convert".to_string(),
        converter_id: spec.id.as_str().to_string(),
        options: request.options.clone(),
        accepted_losses: request.accepted_losses.clone(),
        accepted_warning_codes: request.accepted_warning_codes.clone(),
        max_output_bytes: spec.max_output_bytes,
        input_index: index,
        source: source.clone(),
    };
    let outcome = match run_helper(&helper_request, snapshot_bytes.as_ref(), &mut sink, context) {
        Ok(outcome) => outcome,
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
    if let (ConversionInput::File { path, .. }, Some(expected)) = (input, source.stamp.as_ref()) {
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
    let prepared: PreparedOutput = match serde_json::from_value(outcome.final_json) {
        Ok(prepared) => prepared,
        Err(_) => {
            return failed_item(index, source.path.clone(), "io", false, sink.published(), first_output)
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

