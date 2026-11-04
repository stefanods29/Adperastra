//! Shared bounded XMP manipulation through the trusted WebView host
//! (Step 08c E5). Raw XML never crosses UI `invoke` JSON.
#![allow(dead_code)]


use std::sync::Arc;

use convert::MetadataCategory;
use privacy::PrivacyField;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::jobs::JobContext;
use crate::webview_helper::run_webview_helper;
use crate::webview_helper_types::{
    HelperAction, HelperInputGrant, HelperInputSource, HelperOutput,
    HelperOutputSpec, HelperOutputStorage, WebviewHelperConfig, WebviewHelperKind,
    WebviewHelperRequest,
};

pub const MAX_XMP_BYTES: usize = 1024 * 1024;
pub const MAX_XMP_KEYWORDS: usize = 1_000;
pub const MAX_XMP_KEYWORD_CHARS: usize = 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum XmpEdit {
    RemoveCategories { categories: Vec<MetadataCategory> },
    SetKeywords { keywords: Vec<String> },
}

const XMP_PRIVACY_CATEGORIES: &[MetadataCategory] = &[
    MetadataCategory::Exif,
    MetadataCategory::Gps,
    MetadataCategory::Camera,
    MetadataCategory::Date,
    MetadataCategory::Xmp,
    MetadataCategory::Iptc,
    MetadataCategory::Author,
    MetadataCategory::Comments,
];

fn validate_edit(edit: &XmpEdit) -> Result<(), String> {
    match edit {
        XmpEdit::RemoveCategories { categories } => {
            privacy::validate_requested_categories(categories)
                .map_err(|error| error.code().to_string())?;
            for category in categories {
                if !XMP_PRIVACY_CATEGORIES.contains(category) {
                    return Err("privacy.bad_request".to_string());
                }
            }
        }
        XmpEdit::SetKeywords { keywords } => {
            if keywords.len() > MAX_XMP_KEYWORDS {
                return Err("privacy.too_large".to_string());
            }
            for keyword in keywords {
                let count = keyword.chars().count();
                if count == 0 || count > MAX_XMP_KEYWORD_CHARS {
                    return Err("privacy.bad_request".to_string());
                }
            }
        }
    }
    Ok(())
}

fn config(context: &JobContext) -> Result<WebviewHelperConfig, String> {
    let app = context.app();
    use tauri::Manager;
    let data_dir = app
        .state::<crate::AppState>()
        .data_dir()
        .join("webview-helpers");
    Ok(WebviewHelperConfig {
        kind: WebviewHelperKind::PdfWrite,
        entry: "pdf-write-helper.html",
        max_body_bytes: MAX_XMP_BYTES + 65_536,
        max_output_bytes: MAX_XMP_BYTES as u64,
        data_dir,
        placement: crate::webview_helper_types::HelperWindowPlacement::Hidden,
    })
}

fn input(source: &[u8]) -> HelperInputGrant {
    HelperInputGrant {
        grant_id: uuid::Uuid::new_v4(),
        name: "privacy.xmp".to_string(),
        mime: "application/xml".to_string(),
        source: HelperInputSource::Memory {
            data: Arc::new(Zeroizing::new(source.to_vec())),
            document_id: "privacy-xmp".to_string(),
            revision: 1,
            content_id: uuid::Uuid::new_v4(),
            // Personal metadata is sensitive: force the helper's private
            // profile and memory-only result path; no disk cache/profile.
            sensitive: true,
        },
    }
}

fn output_bytes(output: HelperOutput) -> Result<Vec<u8>, String> {
    match output.storage {
        HelperOutputStorage::Memory(bytes) => Ok(bytes.to_vec()),
        HelperOutputStorage::OwnedFile(_) => Err("privacy.unverified".into()),
    }
}

fn validate_input(source: &[u8]) -> Result<(), String> {
    if source.is_empty() || source.len() > MAX_XMP_BYTES {
        return Err("privacy.too_large".to_string());
    }
    privacy::xmp_rules::strip_xpacket(source)
        .map(|_| ())
        .map_err(|error| error.code().to_string())
}

fn run(
    source: &[u8],
    payload: serde_json::Value,
    context: &JobContext,
) -> Result<(serde_json::Value, Vec<u8>), String> {
    validate_input(source)?;
    let config = config(context)?;
    let request_id = uuid::Uuid::new_v4();
    let inspect = payload.get("kind").and_then(serde_json::Value::as_str) == Some("inspect");
    let built = WebviewHelperRequest {
        request_id,
        action: HelperAction::PrivacyXmp,
        payload,
        output_specs: if inspect {
            Vec::new()
        } else {
            vec![HelperOutputSpec {
                mime: "application/xml".to_string(),
                max_bytes: MAX_XMP_BYTES as u64,
            }]
        },
    };
    let result = run_webview_helper(
        config,
        vec![input(source)],
        built,
        context.token().clone(),
    )?;
    let output = result
        .outputs
        .into_iter()
        .next()
        .map(output_bytes)
        .transpose()?
        .unwrap_or_default();
    if output.len() > MAX_XMP_BYTES {
        return Err("privacy.too_large".to_string());
    }
    Ok((result.reply, output))
}

/// Rewrite one XMP packet in the isolated trusted host.
pub fn rewrite_xmp(source: &[u8], edit: &XmpEdit, context: &JobContext) -> Result<Vec<u8>, String> {
    validate_edit(edit)?;
    let payload = serde_json::to_value(edit).map_err(|_| "privacy.serialize".to_string())?;
    let (_, output) = run(source, payload, context)?;
    // An empty result means the whole packet is removed; the caller owns
    // the container/stream deletion and never writes an empty XML document.
    if !output.is_empty() {
        validate_input(&output)?;
    }
    Ok(output)
}

/// Inspect one XMP packet in the isolated trusted host.
pub fn inspect_xmp(source: &[u8], context: &JobContext) -> Result<Vec<PrivacyField>, String> {
    let (reply, _) = run(source, serde_json::json!({ "kind": "inspect" }), context)?;
    let payload = reply
        .get("payload")
        .and_then(|value| value.get("fields"))
        .cloned()
        .ok_or_else(|| "privacy.failed".to_string())?;
    let fields: Vec<PrivacyField> =
        serde_json::from_value(payload).map_err(|_| "privacy.failed".to_string())?;
    if fields.len() > privacy::inspect::MAX_INSPECTION_FIELDS {
        return Err("privacy.too_large".to_string());
    }
    for field in &fields {
        field
            .validate()
            .map_err(|error| error.code().to_string())?;
    }
    Ok(fields)
}
