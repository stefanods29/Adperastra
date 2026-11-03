/// Talk to one helper until its final frame. Every frame is validated before
/// it can touch the sink.
fn run_helper(
    request: &HelperRequest,
    snapshot_bytes: Option<&Zeroizing<Vec<u8>>>,
    sink: &mut PublishSink,
    context: &crate::jobs::JobContext,
) -> Result<HelperOutcome, String> {
    let body = serde_json::to_vec(request).map_err(|_| "convert.bad_request".to_string())?;
    if body.len() > 64 * 1024 {
        return Err("convert.bad_request".to_string());
    }
    let mut helper = HelperProcess::spawn_framed(
        convert_helper::HELPER_FLAG,
        HELPER_MEMORY,
        HELPER_FRAME_BYTES,
    )?;
    helper.send_frame(FRAME_REQUEST, &body)?;
    if let Some(bytes) = snapshot_bytes {
        for chunk in bytes.chunks(1024 * 1024) {
            helper.send_frame(FRAME_SNAPSHOT_CHUNK, chunk)?;
        }
    }
    let deadline = Instant::now() + if request.mode == "preview" { Duration::from_secs(5) } else { FILE_TIMEOUT };
    let mut open: Option<u32> = None;
    let mut next_output = 0u32;
    let mut total_output_bytes = 0u64;
    let mut preview_png: Option<Vec<u8>> = None;
    loop {
        if context.token().load(Ordering::Relaxed) {
            helper.kill();
            return Err("convert.cancelled".to_string());
        }
        if Instant::now() >= deadline {
            helper.kill();
            return Err("convert.io".to_string());
        }
        match helper.recv_frame(Duration::from_millis(250)) {
            None => continue,
            Some(HelperFrameEvent::TooLarge) | Some(HelperFrameEvent::Malformed) => {
                helper.kill();
                return Err("convert.io".to_string());
            }
            Some(HelperFrameEvent::Closed) => {
                return Err("convert.io".to_string());
            }
            Some(HelperFrameEvent::Frame { kind, body }) => {
                if !frame_allowed(&request.mode, kind) {
                    helper.kill();
                    return Err("convert.io".into());
                }
                match kind {
                FRAME_PROGRESS => {
                    if body.len() > 64 * 1024 {
                        helper.kill();
                        return Err("convert.io".to_string());
                    }
                    if let Ok(progress) = serde_json::from_slice::<OpProgress>(&body) {
                        context.set_progress(&progress);
                    } else {
                        helper.kill();
                        return Err("convert.io".to_string());
                    }
                }
                FRAME_BEGIN => {
                    if open.is_some() || body.len() > 64 * 1024 {
                        helper.kill();
                        return Err("convert.io".to_string());
                    }
                    let draft = serde_json::from_slice(&body)
                        .map_err(|_| "convert.io".to_string())?;
                    let index = sink.begin(draft).map_err(|error| error.code().to_string())?;
                    if index != next_output {
                        helper.kill();
                        return Err("convert.io".to_string());
                    }
                    next_output += 1;
                    open = Some(index);
                }
                FRAME_OUTPUT => {
                    let Some(index) = open else {
                        helper.kill();
                        return Err("convert.io".to_string());
                    };
                    total_output_bytes = total_output_bytes.checked_add(body.len() as u64)
                        .ok_or_else(|| "convert.too_large".to_string())?;
                    if body.len() > 1024 * 1024 || total_output_bytes > request.max_output_bytes {
                        helper.kill();
                        return Err("convert.io".to_string());
                    }
                    sink.write(index, &body)
                        .map_err(|error| error.code().to_string())?;
                }
                FRAME_FINISH => {
                    if body.len() > 64 * 1024 { return Err("convert.io".into()); }
                    let Some(index) = open.take() else {
                        helper.kill();
                        return Err("convert.io".to_string());
                    };
                    let metadata = serde_json::from_slice(&body)
                        .map_err(|_| "convert.io".to_string())?;
                    sink.finish(index, metadata)
                        .map_err(|error| error.code().to_string())?;
                }
                FRAME_ABORT => {
                    if body.len() != 4 {
                        helper.kill();
                        return Err("convert.io".to_string());
                    }
                    let index = u32::from_le_bytes([body[0], body[1], body[2], body[3]]);
                    if open != Some(index) {
                        helper.kill();
                        return Err("convert.io".into());
                    }
                    sink.abort(index).map_err(|error| error.code().to_string())?;
                    open = None;
                }
                FRAME_PREVIEW_PNG => {
                    if body.len() > convert::types::MAX_PREVIEW_BYTES {
                        helper.kill();
                        return Err("convert.too_large".to_string());
                    }
                    let bytes = preview_png.get_or_insert_with(Vec::new);
                    if body.len() > 1024 * 1024 || bytes.len().checked_add(body.len()).is_none_or(|n| n > convert::types::MAX_PREVIEW_BYTES) {
                        helper.kill();
                        return Err("convert.too_large".into());
                    }
                    bytes.extend_from_slice(&body);
                }
                FRAME_FINAL => {
                    if open.is_some() || body.len() > 64 * 1024 {
                        helper.kill();
                        return Err("convert.io".to_string());
                    }
                    let final_json: Value = serde_json::from_slice(&body)
                        .map_err(|_| "convert.io".to_string())?;
                    helper.kill();
                    return Ok(HelperOutcome {
                        final_json,
                        preview_png,
                    });
                }
                FRAME_ERROR => {
                    if body.len() > 4096 { return Err("convert.io".into()); }
                    helper.kill();
                    let code = String::from_utf8_lossy(&body).into_owned();
                    return Err(if code.starts_with("convert.") {
                        code
                    } else {
                        "convert.io".to_string()
                    });
                }
                _ => {
                    helper.kill();
                    return Err("convert.io".to_string());
                }
                }
            },
        }
    }
}

fn frame_allowed(mode: &str, kind: u8) -> bool {
    match mode {
        "preview" => matches!(kind, FRAME_PROGRESS | FRAME_PREVIEW_PNG | FRAME_FINAL | FRAME_ERROR),
        "convert" => matches!(kind, FRAME_PROGRESS | FRAME_BEGIN | FRAME_OUTPUT | FRAME_FINISH | FRAME_ABORT | FRAME_FINAL | FRAME_ERROR),
        _ => false,
    }
}

#[cfg(test)]
mod mode_tests {
    use super::*;
    #[test]
    fn previews_cannot_create_or_publish_output_files() {
        for kind in [FRAME_BEGIN, FRAME_OUTPUT, FRAME_FINISH, FRAME_ABORT] {
            assert!(!frame_allowed("preview", kind));
        }
        assert!(frame_allowed("preview", FRAME_PREVIEW_PNG));
        assert!(!frame_allowed("convert", FRAME_PREVIEW_PNG));
        assert!(!frame_allowed("untrusted", FRAME_FINAL));
    }
}

struct ItemOutcome {
    item: WorkItemResult,
    outputs: Vec<ConversionOutput>,
}

