#![allow(dead_code)] // Public producer API; consumed from later steps.
//! OCR service and commands (Step 07e, export E4).
//!
//! `recognize_page` is the only path to Windows OCR: it validates the
//! request, resolves the language, checks the source (never opening an
//! online-only file), uses the isolated helper, revalidates the source
//! revision and only then publishes an ordinary-disk cache entry.
//!
//! Images are decoded by the helper from a guarded file handle. PDF pages
//! come from the 07d adapter: native text when the page has it, otherwise a
//! rendered page lease that is released on every path (success, failure or
//! cancellation). Snapshots and sensitive sessions never touch the disk
//! cache or the clipboard.

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::cache::CacheService;
use crate::jobs::{spawn_job, JobContext, Jobs};
use crate::ocr_cache;
use crate::ocr_helper::OcrHelperRequest;
use crate::ocr_jobs::{
    complete_recognition, read_lease_bytes, run_helper, BusyGuard, LeaseRelease, RetainedPages,
};
use crate::ocr_languages::{normalize_languages, select_language, OcrLanguagesReply};
use crate::ocr_pdf::{
    ensure_identity_unchanged, is_sensitive, may_cache, native_text_page, should_use_native_text,
    stamp_of, OcrPdfAdapters, OcrPdfPageSource,
};
use crate::ocr_types::{
    page_chunk, validate_ocr_request, OcrInput, OcrLanguage, OcrPage, OcrRequest, ERR_BAD_REQUEST,
    ERR_CHANGED, ERR_FAILED, ERR_ONLINE_ONLY, OCR_HELPER_TIMEOUT_SECONDS, OCR_MAX_EDGE,
    OCR_PDF_RENDER_EDGE,
};
use crate::pdf_types::{PdfRasterSpec, PdfRenderRequest, PdfRotation, PdfSourceIdentity};

/// How long an installed-language answer is reused.
const LANGUAGE_CACHE_SECONDS: u64 = 60;

/// The cache service reports source stamp failures in its own area; keep
/// the OCR area's translated code.
fn map_stamp_error(code: String) -> String {
    if code == "cache.changed" {
        ERR_CHANGED.to_string()
    } else {
        ERR_FAILED.to_string()
    }
}

/// Keep the OCR area's translated errors when the 07d adapter reports a
/// session/source failure. A closed session is a changed source here.
fn map_pdf_error(code: String) -> String {
    match code.as_str() {
        "pdf.changed" | "pdf.snapshot_unavailable" | "pdf.unavailable" => ERR_CHANGED.to_string(),
        "pdf.too_large" => crate::ocr_types::ERR_TOO_LARGE.to_string(),
        _ => ERR_FAILED.to_string(),
    }
}

/// The app's OCR state (managed by main).
pub struct OcrService {
    retained: RetainedPages,
    languages: Mutex<Option<(Instant, OcrLanguagesReply)>>,
    busy: AtomicBool,
    pub pdf: OcrPdfAdapters,
}

impl Default for OcrService {
    fn default() -> Self {
        Self::new()
    }
}

impl OcrService {
    pub fn new() -> Self {
        Self {
            retained: RetainedPages::default(),
            languages: Mutex::new(None),
            busy: AtomicBool::new(false),
            pdf: OcrPdfAdapters::default(),
        }
    }

    /// Register the 07d adapter once (coordinator wiring).
    pub fn register_pdf(&self, source: Arc<dyn OcrPdfPageSource>) -> Result<(), String> {
        self.pdf.register(source)
    }

    /// Installed languages, cached briefly; a missing language list is an
    /// ordinary failure, never an invented list.
    pub fn languages(&self) -> Result<OcrLanguagesReply, String> {
        if let Ok(cache) = self.languages.lock() {
            if let Some((at, reply)) = cache.as_ref() {
                if at.elapsed() < Duration::from_secs(LANGUAGE_CACHE_SECONDS) {
                    return Ok(reply.clone());
                }
            }
        }
        let token = fs_service::new_cancellation_token();
        let reply = run_helper(
            &OcrHelperRequest::Languages,
            None,
            &token,
            Duration::from_secs(5),
        )?;
        if reply.status != "languages" {
            return Err(ERR_FAILED.to_string());
        }
        let value = OcrLanguagesReply {
            languages: normalize_languages(reply.languages),
            user_profile: reply.user_profile,
        };
        if let Ok(mut cache) = self.languages.lock() {
            *cache = Some((Instant::now(), value.clone()));
        }
        Ok(value)
    }

    fn resolve_language(&self, preference: &str, app_language: &str) -> Result<String, String> {
        let installed = self.languages()?;
        select_language(
            preference,
            app_language,
            &installed.languages,
            installed.user_profile.as_deref(),
        )
        .map_err(|error| error.code().to_string())
    }

    fn retain_and_chunk(&self, consumer_id: &str, page: OcrPage) -> Result<OcrPage, String> {
        let chunk = page_chunk(&page, None)?;
        self.retained.insert(consumer_id, page)?;
        Ok(chunk)
    }

    /// E4: recognise one page for a validated request. Never called from the
    /// UI thread; `ctx` supplies cancellation and the app handle.
    pub fn recognize_page(
        &self,
        request: &OcrRequest,
        ctx: &JobContext,
    ) -> Result<OcrPage, String> {
        validate_ocr_request(request)?;
        let _busy = BusyGuard::enter(&self.busy)?;
        let app = ctx.app();
        let cache_state = app.state::<Arc<CacheService>>();
        let cache: &CacheService = cache_state.inner();
        let app_language = app
            .state::<crate::AppState>()
            .settings
            .lock()
            .map(|settings| settings.language.clone())
            .map_err(|_| ERR_FAILED.to_string())?;
        let language = self.resolve_language(&request.language, &app_language)?;
        match &request.input {
            OcrInput::Image { path } => self.recognize_image(request, path, &language, cache, ctx),
            OcrInput::Pdf { session_id, page } => {
                self.recognize_pdf(request, session_id, *page, &language, cache, ctx)
            }
        }
    }

    fn recognize_image(
        &self,
        request: &OcrRequest,
        path: &str,
        language: &str,
        cache: &CacheService,
        ctx: &JobContext,
    ) -> Result<OcrPage, String> {
        let item = fs_service::stat_path(Path::new(path)).map_err(|_| ERR_CHANGED.to_string())?;
        if item.attrs.online_only {
            return Err(ERR_ONLINE_ONLY.to_string());
        }
        if item.kind != fs_service::ItemKind::File {
            return Err(ERR_BAD_REQUEST.to_string());
        }
        let stamp = cache
            .source_stamp(Path::new(path))
            .map_err(map_stamp_error)?;
        let source = PdfSourceIdentity::Disk {
            stamp: stamp.clone(),
        };
        let key = ocr_cache::cache_key(
            &stamp,
            language,
            request.rotation,
            1,
            OCR_MAX_EDGE,
            "raster",
        );
        if let Some(mut hit) = ocr_cache::lookup(cache, &key) {
            let unchanged = cache
                .source_stamp(Path::new(path))
                .map(|current| current == stamp)
                .unwrap_or(false);
            if unchanged && hit.source == source && hit.language.eq_ignore_ascii_case(language) {
                hit.rotation = request.rotation;
                return self.retain_and_chunk(&request.consumer_id, hit);
            }
        }

        let helper_request = OcrHelperRequest::File {
            path: path.to_string(),
            expected: stamp.clone(),
            language: language.to_string(),
        };
        let reply = run_helper(
            &helper_request,
            None,
            ctx.token(),
            Duration::from_secs(OCR_HELPER_TIMEOUT_SECONDS),
        )?;
        let payload = reply.page.ok_or_else(|| ERR_FAILED.to_string())?;
        let page = payload.into_page(source, 1, request.rotation);
        let page = complete_recognition(
            Ok(page),
            || {
                let current = cache
                    .source_stamp(Path::new(path))
                    .map_err(map_stamp_error)?;
                if current == stamp {
                    Ok(())
                } else {
                    Err(ERR_CHANGED.to_string())
                }
            },
            |page| {
                let _ = ocr_cache::publish(cache, &key, page);
                Ok(())
            },
        )?;
        self.retain_and_chunk(&request.consumer_id, page)
    }

    fn recognize_pdf(
        &self,
        request: &OcrRequest,
        session_id: &str,
        page_number: u32,
        language: &str,
        cache: &CacheService,
        ctx: &JobContext,
    ) -> Result<OcrPage, String> {
        let source = self.pdf.source().ok_or_else(|| ERR_FAILED.to_string())?;
        let identity = source.identity(session_id).map_err(map_pdf_error)?;
        let sensitive = is_sensitive(&identity);

        // 1. Native text always wins over recognition (plan D3).
        if let Some(native) = source
            .native_text(session_id, page_number)
            .map_err(map_pdf_error)?
        {
            if native.page != page_number {
                return Err(ERR_CHANGED.to_string());
            }
            let first_text = native
                .text
                .runs
                .iter()
                .find(|run| !run.text.trim().is_empty())
                .map(|run| run.text.as_str());
            if should_use_native_text(first_text) {
                let key = stamp_of(&identity).map(|stamp| {
                    ocr_cache::cache_key(
                        stamp,
                        language,
                        request.rotation,
                        page_number,
                        u32::from(OCR_PDF_RENDER_EDGE),
                        "native",
                    )
                });
                if let Some(key) = &key {
                    if let Some(hit) = ocr_cache::lookup(cache, key) {
                        let current = source.identity(session_id).map_err(map_pdf_error)?;
                        if current == identity
                            && hit.source == identity
                            && hit.language.eq_ignore_ascii_case(language)
                        {
                            return self.retain_and_chunk(&request.consumer_id, hit);
                        }
                    }
                }
                let page = native_text_page(&native, language)?;
                let page = complete_recognition(
                    Ok(page),
                    || {
                        let current = source.identity(session_id).map_err(map_pdf_error)?;
                        ensure_identity_unchanged(&identity, &current)
                    },
                    |page| {
                        if sensitive || !may_cache(&identity) {
                            return Ok(());
                        }
                        if let Some(key) = &key {
                            let _ = ocr_cache::publish(cache, key, page);
                        }
                        Ok(())
                    },
                )?;
                return self.retain_and_chunk(&request.consumer_id, page);
            }
        }

        // 2. Image-only page. A cached ordinary-disk result is returned
        // before any render, so a hit costs no page lease.
        let key = stamp_of(&identity).map(|stamp| {
            ocr_cache::cache_key(
                stamp,
                language,
                request.rotation,
                page_number,
                u32::from(OCR_PDF_RENDER_EDGE),
                "raster",
            )
        });
        if let Some(key) = &key {
            if let Some(hit) = ocr_cache::lookup(cache, key) {
                let current = source.identity(session_id).map_err(map_pdf_error)?;
                if current == identity
                    && hit.source == identity
                    && hit.language.eq_ignore_ascii_case(language)
                {
                    return self.retain_and_chunk(&request.consumer_id, hit);
                }
            }
        }

        let session = uuid::Uuid::try_parse(session_id).map_err(|_| ERR_BAD_REQUEST.to_string())?;
        let rotation =
            PdfRotation::from_value(request.rotation).ok_or_else(|| ERR_BAD_REQUEST.to_string())?;
        // 07d requires a positive render revision; 0 means "first" here.
        let revision = request.request_revision.max(1);
        let render_request = PdfRenderRequest {
            session_id: session,
            page: page_number,
            raster: PdfRasterSpec::Bucket {
                edge: OCR_PDF_RENDER_EDGE,
            },
            rotation,
            request_revision: revision,
        };
        let image = source
            .render(&render_request, ctx.token())
            .map_err(map_pdf_error)?;
        // The rendered page lease belongs to this request from now on.
        let mut lease = LeaseRelease::new(image.image.lease_id.clone(), |lease_id| {
            let _ = cache.release(lease_id);
        });
        if image.info.page != page_number || image.request_revision != revision {
            return Err(ERR_CHANGED.to_string());
        }
        if image.render_width == 0
            || image.render_height == 0
            || !image.resolved_scale.is_finite()
            || image.resolved_scale <= 0.0
        {
            return Err(ERR_FAILED.to_string());
        }

        let grants = ctx.app().state::<Arc<crate::files::FileGrants>>();
        let bytes = read_lease_bytes(grants.inner(), &image.image)?;
        let helper_request = OcrHelperRequest::Memory {
            language: language.to_string(),
            format: "png".to_string(),
            byte_len: bytes.len() as u64,
        };
        let reply = run_helper(
            &helper_request,
            Some(bytes.as_slice()),
            ctx.token(),
            Duration::from_secs(OCR_HELPER_TIMEOUT_SECONDS),
        )?;
        lease.release_now();
        let payload = reply.page.ok_or_else(|| ERR_FAILED.to_string())?;
        if payload.original_width != image.render_width
            || payload.original_height != image.render_height
        {
            return Err(ERR_CHANGED.to_string());
        }
        let page = payload.into_page(
            identity.clone(),
            page_number,
            image.rendered_rotation.value(),
        );
        let page = complete_recognition(
            Ok(page),
            || {
                let current = source.identity(session_id).map_err(map_pdf_error)?;
                ensure_identity_unchanged(&identity, &current)
            },
            |page| {
                if sensitive || !may_cache(&identity) {
                    return Ok(());
                }
                if let Some(key) = &key {
                    let _ = ocr_cache::publish(cache, key, page);
                }
                Ok(())
            },
        )?;
        self.retain_and_chunk(&request.consumer_id, page)
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// `ocr_languages()`: installed Windows recogniser languages, bounded.
#[tauri::command]
pub async fn ocr_languages(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Vec<OcrLanguage>, String> {
    crate::ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<OcrService>()
            .languages()
            .map(|reply| reply.languages)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// `ocr_start(request_id, request)`: start one cancellable recognition.
#[tauri::command]
pub fn ocr_start(
    window: WebviewWindow,
    app: AppHandle,
    request_id: String,
    request: OcrRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    validate_ocr_request(&request)?;
    let token = {
        let jobs = app.state::<Jobs>();
        jobs.begin(&request_id, 1).map_err(|error| {
            if error == "jobs.duplicate" || error == "jobs.too_many" {
                error
            } else {
                ERR_BAD_REQUEST.to_string()
            }
        })?
    };
    spawn_job(app, request_id, token, move |ctx| {
        let page = ctx
            .app()
            .state::<OcrService>()
            .recognize_page(&request, ctx)?;
        serde_json::to_value(page).map_err(|_| ERR_FAILED.to_string())
    });
    Ok(())
}

/// `ocr_page(consumer_id, after_word)`: one bounded chunk.
#[tauri::command]
pub fn ocr_page(
    window: WebviewWindow,
    service: State<'_, OcrService>,
    consumer_id: String,
    after_word: Option<u32>,
) -> Result<OcrPage, String> {
    crate::ensure_main(window.label())?;
    if uuid::Uuid::try_parse(&consumer_id).is_err() {
        return Err(ERR_BAD_REQUEST.to_string());
    }
    service.retained.page(&consumer_id, after_word)
}

/// `ocr_release(consumer_id)`: idempotent; unknown valid IDs are fine.
#[tauri::command]
pub fn ocr_release(
    window: WebviewWindow,
    service: State<'_, OcrService>,
    consumer_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    if uuid::Uuid::try_parse(&consumer_id).is_err() {
        return Err(ERR_BAD_REQUEST.to_string());
    }
    service.retained.release(&consumer_id);
    Ok(())
}
