//! E8: verified PSD composite rasterization (Step 07g T5/T6).
//!
//! The only decoder is the isolated PSD helper. Native code validates the
//! PNG dimensions and returns a bounded file; it never pretends to decode a
//! PSD itself. 08a may reuse this only when the actual adapter is installed.

use std::io::{Read, Seek, SeekFrom};

use fs_service::{CancellationToken, SourceStamp};
use uuid::Uuid;

use crate::jobs::JobContext;
use crate::special_view_types::SPECIAL_MAX_PREVIEW_BYTES;
use crate::thumbnail_providers::PreparedThumbnail;
use crate::webview_helper::start_webview_helper;
use crate::webview_helper_types::{
    HelperAction, HelperInputGrant, HelperInputSource, HelperOutputSpec, HelperOutputStorage,
    HelperWindowPlacement, WebviewHelperConfig, WebviewHelperKind, WebviewHelperRequest,
};
use tauri::Manager;

const ALLOWED_EDGES: [u32; 4] = [64, 128, 256, 2048];

fn expected_stamp(input: &HelperInputGrant) -> Result<SourceStamp, String> {
    match &input.source {
        HelperInputSource::Disk { expected, .. } => Ok(expected.clone()),
        _ => Err("thumbnail.failed".to_string()),
    }
}

use crate::special_output as output;

/// `max_edge` is one of 64/128/256/2048. The helper gets one guarded input
/// and exactly one PNG output; linked files are never requested.
pub fn rasterize_psd(
    input: HelperInputGrant,
    max_edge: u32,
    context: &JobContext,
) -> Result<PreparedThumbnail, String> {
    if !ALLOWED_EDGES.contains(&max_edge) {
        return Err("thumbnail.bad_request".to_string());
    }
    if context.token().load(std::sync::atomic::Ordering::Relaxed) {
        return Err("thumbnail.failed".to_string());
    }
    let source = expected_stamp(&input)?;
    let grant_id = input.grant_id.to_string();
    let config = WebviewHelperConfig {
        kind: WebviewHelperKind::Psd,
        entry: "psd-helper.html",
        max_body_bytes: 768 * 1024,
        max_output_bytes: SPECIAL_MAX_PREVIEW_BYTES,
        data_dir: crate::resolve_data_dir(),
        placement: HelperWindowPlacement::Hidden,
    };
    let cancel: CancellationToken = context.token().clone();
    let mut helper = start_webview_helper(config, vec![input], cancel.clone())?;
    let request = WebviewHelperRequest {
        request_id: Uuid::new_v4(),
        action: HelperAction::PsdOpen,
        payload: serde_json::json!({ "grant_id": grant_id, "max_edge": max_edge }),
        output_specs: vec![HelperOutputSpec {
            mime: "image/png".to_string(),
            max_bytes: SPECIAL_MAX_PREVIEW_BYTES,
        }],
    };
    let result = helper.request(request, cancel)?;
    let _ = helper.close();
    let output = result
        .outputs
        .into_iter()
        .next()
        .ok_or_else(|| "thumbnail.unsupported".to_string())?;
    let bytes = match output.storage {
        HelperOutputStorage::Memory(bytes) => bytes.to_vec(),
        HelperOutputStorage::OwnedFile(mut owned) => {
            let file = owned.file_mut();
            file.seek(SeekFrom::Start(0))
                .map_err(|_| "thumbnail.failed".to_string())?;
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)
                .map_err(|_| "thumbnail.failed".to_string())?;
            bytes
        }
    };
    output::prepare(
        context
            .app()
            .state::<std::sync::Arc<crate::cache::CacheService>>()
            .inner(),
        &bytes,
        &source,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_four_edges_are_accepted() {
        assert_eq!(ALLOWED_EDGES, [64, 128, 256, 2048]);
    }
}
