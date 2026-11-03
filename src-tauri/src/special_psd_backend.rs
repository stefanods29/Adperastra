use super::*;

pub(super) fn open_psd(
    backend: &NativeSpecialBackend,
    source: &fs_service::SourceStamp,
    path: &Path,
    cancel: &fs_service::CancellationToken,
) -> Result<OpenArtifact, String> {
    let input = disk_grant(
        path,
        source,
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default()
            .as_str(),
        "image/vnd.adobe.photoshop",
    )?;
    let grant_id = input.grant_id.to_string();
    let config = WebviewHelperConfig {
        kind: WebviewHelperKind::Psd,
        entry: "psd-helper.html",
        max_body_bytes: 768 * 1024,
        max_output_bytes: 64 * 1024 * 1024,
        data_dir: backend.data_dir.clone(),
        placement: HelperWindowPlacement::Hidden,
    };
    let mut helper = start_webview_helper(config, vec![input], cancel.clone())?;
    let request = WebviewHelperRequest {
        request_id: Uuid::new_v4(),
        action: HelperAction::PsdOpen,
        payload: serde_json::json!({ "grant_id": grant_id }),
        output_specs: vec![HelperOutputSpec {
            mime: "image/png".to_string(),
            max_bytes: 64 * 1024 * 1024,
        }],
    };
    let result = helper.request(request, cancel.clone())?;
    let width = result
        .reply
        .get("width")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as u32;
    let height = result
        .reply
        .get("height")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as u32;
    let layer_count = result
        .reply
        .get("layer_count")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as u32;
    let composite = result
        .reply
        .get("has_composite")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if layer_count > crate::special_view_types::PSD_MAX_LAYERS {
        return Err("special_view.too_large".to_string());
    }
    let preview = result
        .outputs
        .into_iter()
        .next()
        .map(output_bytes)
        .transpose()?
        .map(|bytes| {
            let (image_width, image_height) = validate_png(&bytes)?;
            Ok::<PreparedImage, String>(PreparedImage {
                png: bytes,
                width: image_width,
                height: image_height,
                codec_required: false,
                partial: false,
            })
        })
        .transpose()?;
    Ok(OpenArtifact {
        preview,
        scene: None,
        psd: Some(PsdOpen {
            width,
            height,
            layer_count,
            composite,
        }),
        helper: Some(helper),
        codec_required: false,
        partial: false,
    })
}
