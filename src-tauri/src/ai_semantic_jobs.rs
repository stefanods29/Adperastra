//! Opted-in background embedding and the shared AI-search policy (T3).
//!
//! Indexing reads only rows already produced by 11a's bounded indexer, checks
//! eligibility and online-only state before every source lease, and persists
//! completion per file identity. The embedder and image authorizer are the
//! integration seams to 14c/09a; no test double is a production fallback.
#![allow(dead_code)]


use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use fs_service::owned_io::{PinnedSource, SourceIdentity};
use fs_service::source_stamp::{attributes_are_online_only, capture_source_stamp, FileIdentityKey};
use fs_service::{CancellationToken, OpProgress};
use search_index::content_extractors::default_registry;
use search_index::types::{ExtractorRequest, IndexRoot};

use crate::ai_search_types::{
    eligible_roots_for_mode, AiSearchError, AiSearchResult, AiSearchSettings, AiSemanticRoot,
    SemanticQuery, SemanticQueryKind, SemanticStatus, SemanticVectorKind, SemanticVectorRecord,
    MAX_AI_NAME_INPUTS, MAX_AI_SEARCH_ROOTS,
};
use crate::ai_semantic_store::{SemanticLimits, SemanticStore, UnindexedFile};
use crate::ai_semantic_vectors::{split_text, validate_embedding};
use crate::jobs::JobContext;
use crate::local_ai_types::AiInputRef;

pub const EXTRACTOR_REVISION: u32 = 1;
pub const INDEX_BATCH_SIZE: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbeddingModel {
    MultilingualE5Small,
    Siglip2Base,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub enum EmbeddingInput {
    Text {
        text: String,
        model: EmbeddingModel,
        query: bool,
    },
    DocumentText {
        input: AiInputRef,
        query: bool,
    },
    DocumentImage {
        input: AiInputRef,
    },
}

#[derive(Debug, Clone)]
pub struct EmbeddingReply {
    pub model_id: String,
    pub model_revision: String,
    pub dimensions: u16,
    pub vector: Vec<f32>,
}

/// Implemented by the coordinator over 14c's `startAiTask`/native runtime.
pub trait SemanticEmbedder: Send + Sync {
    fn model_identity(&self, kind: SemanticVectorKind) -> Result<(String, String), String>;
    fn embed(&self, input: EmbeddingInput, cancel: &CancellationToken) -> Result<EmbeddingReply, String>;
}

/// Implemented by the coordinator over 09a/14c native input authorization.
pub trait SemanticSourceAuthorizer: Send + Sync {
    fn authorize_image(&self, path: &Path) -> Result<AiInputRef, String>;
    /// The current full stamp of an already-authorized input. No new path or
    /// content permission is created by asking for it.
    fn stamp_for(&self, input: &AiInputRef) -> Result<fs_service::source_stamp::SourceStamp, String>;
}

/// The 17a E7 selected-backend gateway, injected so this module never talks
/// to a provider directly. `prepared_id`/`consent` are native references, not
/// secrets. Local mode ignores the consent id and performs no network call.
pub trait AiSearchGateway: Send + Sync {
    fn complete(
        &self,
        schema_id: &str,
        user_json: &str,
        prepared_id: &str,
        outbound_consent_id: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<String, String>;
}

#[derive(Debug, Clone)]
pub struct SemanticPolicy {
    pub settings: AiSearchSettings,
    pub index_roots: Vec<IndexRoot>,
    pub sensitive_root_ids: Vec<String>,
    pub content_max_chars: u32,
    pub paused: bool,
    pub reason_code: Option<String>,
}

impl Default for SemanticPolicy {
    fn default() -> Self {
        Self {
            settings: AiSearchSettings::default(),
            index_roots: Vec::new(),
            sensitive_root_ids: Vec::new(),
            content_max_chars: 100_000,
            paused: false,
            reason_code: Some("ai_search.unavailable".to_string()),
        }
    }
}

#[derive(Clone)]
pub struct AiSemanticState {
    profile_dir: PathBuf,
    embedder: Arc<dyn SemanticEmbedder>,
    authorizer: Arc<dyn SemanticSourceAuthorizer>,
    gateway: Arc<dyn AiSearchGateway>,
    policy: Arc<Mutex<SemanticPolicy>>,
    policy_generation: Arc<AtomicU64>,
    consents: SensitiveConsents,
}

impl AiSemanticState {
    pub fn new(
        profile_dir: PathBuf,
        embedder: Arc<dyn SemanticEmbedder>,
        authorizer: Arc<dyn SemanticSourceAuthorizer>,
        gateway: Arc<dyn AiSearchGateway>,
    ) -> Self {
        Self {
            profile_dir,
            embedder,
            authorizer,
            gateway,
            policy: Arc::new(Mutex::new(SemanticPolicy::default())),
            policy_generation: Arc::new(AtomicU64::new(1)),
            consents: SensitiveConsents::default(),
        }
    }

    pub fn consents(&self) -> SensitiveConsents {
        self.consents.clone()
    }

    pub fn profile_dir(&self) -> &Path {
        &self.profile_dir
    }

    pub fn policy(&self) -> SemanticPolicy {
        self.policy
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default()
    }

    pub fn policy_generation(&self) -> u64 {
        self.policy_generation.load(Ordering::Relaxed)
    }

    /// Called by the settings/background coordinator after a validated save.
    /// Root removal is applied to the store immediately; work is cancelled by
    /// the caller through the shared jobs/background token.
    pub fn update_policy(&self, policy: SemanticPolicy) -> Result<(), String> {
        policy
            .settings
            .validate(&policy.index_roots, &policy.sensitive_root_ids)
            .map_err(|error| error.code().to_string())?;
        let mut guard = self
            .policy
            .lock()
            .map_err(|_| "ai_search.unavailable".to_string())?;
        *guard = policy.clone();
        drop(guard);
        self.policy_generation.fetch_add(1, Ordering::Relaxed);
        let mut store = self.open_store()?;
        store
            .set_roots(&policy.settings.roots)
            .map_err(|error| error.code().to_string())
    }

    pub fn open_store(&self) -> Result<SemanticStore, String> {
        SemanticStore::open_at(
            &self.profile_dir.join("search").join("index.sqlite3"),
            SemanticLimits::default(),
        )
        .map_err(|error| error.code().to_string())
    }

    pub fn embedder(&self) -> Arc<dyn SemanticEmbedder> {
        Arc::clone(&self.embedder)
    }

    pub fn authorizer(&self) -> Arc<dyn SemanticSourceAuthorizer> {
        Arc::clone(&self.authorizer)
    }

    pub fn gateway(&self) -> Arc<dyn AiSearchGateway> {
        Arc::clone(&self.gateway)
    }

    pub fn enabled_roots(&self, policy: &SemanticPolicy, mode: &str) -> Vec<String> {
        eligible_roots_for_mode(&policy.settings, &policy.index_roots, &policy.sensitive_root_ids, mode)
            .into_iter()
            .map(|root: &AiSemanticRoot| root.root_id.clone())
            .collect()
    }

    pub fn query_embedding(
        &self,
        query: &SemanticQuery,
        cancel: &CancellationToken,
    ) -> Result<(EmbeddingReply, SemanticVectorKind), String> {
        let kind = query.kind.vector_kind();
        let input = match query.kind {
            SemanticQueryKind::Text => EmbeddingInput::Text {
                text: query.text.clone().ok_or_else(|| "ai_search.invalid".to_string())?,
                model: EmbeddingModel::MultilingualE5Small,
                query: true,
            },
            SemanticQueryKind::Photo => EmbeddingInput::Text {
                text: query.text.clone().ok_or_else(|| "ai_search.invalid".to_string())?,
                model: EmbeddingModel::Siglip2Base,
                query: true,
            },
            SemanticQueryKind::SimilarText => EmbeddingInput::DocumentText {
                input: query.input.clone().ok_or_else(|| "ai_search.invalid".to_string())?,
                query: true,
            },
            SemanticQueryKind::SimilarImage => EmbeddingInput::DocumentImage {
                input: query.input.clone().ok_or_else(|| "ai_search.invalid".to_string())?,
            },
        };
        let reply = self
            .embedder
            .embed(input, cancel)
            .map_err(|_| "ai_search.unavailable".to_string())?;
        validate_embedding_identity(&reply, kind).map_err(|error| error.code().to_string())?;
        Ok((reply, kind))
    }
}

fn validate_embedding_identity(reply: &EmbeddingReply, kind: SemanticVectorKind) -> AiSearchResult<()> {
    if reply.model_id.is_empty()
        || reply.model_id.len() > 96
        || reply.model_revision.is_empty()
        || reply.model_revision.len() > 64
    {
        return Err(AiSearchError::Invalid);
    }
    validate_embedding(kind == SemanticVectorKind::Text, reply.dimensions, &reply.vector)
}

/// One bounded indexing batch. Returns (indexed files, skipped files).
#[allow(clippy::too_many_arguments)]
pub fn run_index_batch(
    store: &mut SemanticStore,
    embedder: &dyn SemanticEmbedder,
    authorizer: &dyn SemanticSourceAuthorizer,
    files: &[UnindexedFile],
    roots: &[String],
    kind: SemanticVectorKind,
    content_max_chars: u32,
    cancel: &CancellationToken,
    progress: &mut dyn FnMut(OpProgress),
) -> Result<(u32, u32), String> {
    let (model_id, model_revision) = embedder.model_identity(kind)?;
    let mut indexed = 0u32;
    let mut skipped = 0u32;
    for (position, file) in files.iter().enumerate() {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("ai_search.changed".to_string());
        }
        if file.online_only || is_online_only(Path::new(&file.path)) {
            skipped = skipped.saturating_add(1);
            continue;
        }
        if kind == SemanticVectorKind::Text
            && !matches!(file.content_state.as_str(), "indexed" | "partial")
        {
            skipped = skipped.saturating_add(1);
            continue;
        }
        let path = Path::new(&file.path);
        let stamp = match capture_source_stamp(path) {
            Ok(stamp) => stamp,
            Err(_) => {
                skipped = skipped.saturating_add(1);
                continue;
            }
        };
        if stamp.modified_ticks != file.modified_ticks || stamp.size_bytes != file.size_bytes {
            skipped = skipped.saturating_add(1);
            continue;
        }
        let identity = FileIdentityKey {
            volume_id: file.volume_id.clone(),
            file_id: file.file_id.clone(),
            path_key: file.path_key.clone(),
            stable: file.file_id_stable,
        };
        let outcome = match kind {
            SemanticVectorKind::Text => index_text(
                &mut *store,
                embedder,
                &identity,
                &stamp,
                path,
                roots,
                &model_id,
                &model_revision,
                content_max_chars,
                cancel,
            ),
            SemanticVectorKind::Image => index_image(
                &mut *store,
                embedder,
                authorizer,
                &identity,
                &stamp,
                path,
                roots,
                &model_id,
                &model_revision,
                cancel,
            ),
        };
        let inserted = match outcome {
            Ok(inserted) => inserted,
            Err(error) => {
                // Never leave a half-written chunk set that looks complete;
                // the next pass retries this file from identity.
                let _ = store.clear_file_vectors(&identity, kind);
                return Err(error);
            }
        };
        if inserted {
            indexed = indexed.saturating_add(1);
        } else {
            skipped = skipped.saturating_add(1);
        }
        progress(OpProgress {
            items_done: position + 1,
            items_total: files.len(),
            bytes_done: 0,
            bytes_total: 0,
            current: String::new(),
        });
    }
    Ok((indexed, skipped))
}

#[allow(clippy::too_many_arguments)]
fn index_text(
    store: &mut SemanticStore,
    embedder: &dyn SemanticEmbedder,
    identity: &FileIdentityKey,
    stamp: &fs_service::source_stamp::SourceStamp,
    path: &Path,
    roots: &[String],
    model_id: &str,
    model_revision: &str,
    content_max_chars: u32,
    cancel: &CancellationToken,
) -> Result<bool, String> {
    let source_identity = SourceIdentity::capture(path).map_err(|_| "ai_search.changed".to_string())?;
    let pinned = PinnedSource::open(path, &source_identity).map_err(|_| "ai_search.changed".to_string())?;
    let registry = default_registry();
    let extractor = match registry.resolve(path) {
        Some(extractor) => extractor,
        None => return Ok(false),
    };
    let request = ExtractorRequest {
        path: path.to_path_buf(),
        stamp: stamp.clone(),
        max_chars: content_max_chars,
        deadline: Instant::now() + Duration::from_secs(30),
        pinned: Arc::new(pinned),
    };
    let extracted = extractor
        .extract(&request, cancel)
        .map_err(|_| "ai_search.failed".to_string())?;
    let split = split_text(&extracted.text);
    if split.chunks.is_empty() {
        return Ok(false);
    }
    store
        .clear_file_vectors(identity, SemanticVectorKind::Text)
        .map_err(|error| error.code().to_string())?;
    let partial = split.partial || extracted.truncated;
    for chunk in split.chunks {
        let reply = embedder.embed(
            EmbeddingInput::Text {
                text: chunk.text,
                model: EmbeddingModel::MultilingualE5Small,
                query: false,
            },
            cancel,
        )?;
        if reply.model_id != model_id || reply.model_revision != model_revision {
            return Err("ai_search.changed".to_string());
        }
        validate_embedding(true, reply.dimensions, &reply.vector)
            .map_err(|error| error.code().to_string())?;
        let record = SemanticVectorRecord {
            identity: identity.clone(),
            source: stamp.clone(),
            root_ids: roots.to_vec(),
            model_id: model_id.to_string(),
            model_revision: model_revision.to_string(),
            extractor_revision: EXTRACTOR_REVISION,
            kind: SemanticVectorKind::Text,
            chunk_index: chunk.index,
            start: Some(chunk.start),
            end: Some(chunk.end),
            dimensions: reply.dimensions,
            vector: reply.vector,
            partial,
        };
        store
            .insert_vector(&record)
            .map_err(|error| error.code().to_string())?;
    }
    Ok(true)
}

#[allow(clippy::too_many_arguments)]
fn index_image(
    store: &mut SemanticStore,
    embedder: &dyn SemanticEmbedder,
    authorizer: &dyn SemanticSourceAuthorizer,
    identity: &FileIdentityKey,
    stamp: &fs_service::source_stamp::SourceStamp,
    path: &Path,
    roots: &[String],
    model_id: &str,
    model_revision: &str,
    cancel: &CancellationToken,
) -> Result<bool, String> {
    let input = authorizer.authorize_image(path)?;
    let reply = embedder.embed(EmbeddingInput::DocumentImage { input }, cancel)?;
    if reply.model_id != model_id || reply.model_revision != model_revision {
        return Err("ai_search.changed".to_string());
    }
    validate_embedding(false, reply.dimensions, &reply.vector)
        .map_err(|error| error.code().to_string())?;
    store
        .clear_file_vectors(identity, SemanticVectorKind::Image)
        .map_err(|error| error.code().to_string())?;
    let record = SemanticVectorRecord {
        identity: identity.clone(),
        source: stamp.clone(),
        root_ids: roots.to_vec(),
        model_id: model_id.to_string(),
        model_revision: model_revision.to_string(),
        extractor_revision: EXTRACTOR_REVISION,
        kind: SemanticVectorKind::Image,
        chunk_index: 0,
        start: None,
        end: None,
        dimensions: reply.dimensions,
        vector: reply.vector,
        partial: false,
    };
    store
        .insert_vector(&record)
        .map_err(|error| error.code().to_string())?;
    Ok(true)
}

pub fn run_rebuild(state: &AiSemanticState, requested: &[String], context: &JobContext) -> Result<SemanticStatus, String> {
    let policy = state.policy();
    let generation = state.policy_generation();
    let mut store = state.open_store()?;
    store
        .set_roots(&policy.settings.roots)
        .map_err(|error| error.code().to_string())?;
    if policy.paused {
        store
            .set_paused(true, policy.reason_code.as_deref())
            .map_err(|error| error.code().to_string())?;
        return store.status().map_err(|error| error.code().to_string());
    }
    store
        .set_paused(false, None)
        .map_err(|error| error.code().to_string())?;
    for kind in [SemanticVectorKind::Text, SemanticVectorKind::Image] {
        let mode = if kind == SemanticVectorKind::Text { "text" } else { "photos" };
        let enabled = state.enabled_roots(&policy, mode);
        let roots = if requested.is_empty() {
            enabled
        } else {
            requested
                .iter()
                .filter(|root| enabled.iter().any(|candidate| candidate == *root))
                .cloned()
                .collect()
        };
        if roots.is_empty() {
            continue;
        }
        let (model_id, model_revision) = state.embedder().model_identity(kind)?;
        store
            .promote_model(kind, &model_id, &model_revision)
            .map_err(|error| error.code().to_string())?;
        loop {
            if state.policy_generation() != generation {
                return Err("ai_search.changed".to_string());
            }
            if context.token().load(Ordering::Relaxed) {
                return Err("ai_search.changed".to_string());
            }
            let files = store
                .unindexed_batch(&roots, kind, &model_id, &model_revision, EXTRACTOR_REVISION, INDEX_BATCH_SIZE)
                .map_err(|error| error.code().to_string())?;
            if files.is_empty() {
                break;
            }
            let mut progress = |_progress: OpProgress| {};
            let (indexed, skipped) = match run_index_batch(
                &mut store,
                state.embedder().as_ref(),
                state.authorizer().as_ref(),
                &files,
                &roots,
                kind,
                policy.content_max_chars,
                context.token(),
                &mut progress,
            ) {
                Ok(result) => result,
                Err(error) if error == "ai_search.too_large" => {
                    // The quota pauses indexing; existing vectors stay valid.
                    let _ = store.set_paused(true, Some("ai_search.too_large"));
                    return store.status().map_err(|error| error.code().to_string());
                }
                Err(error) => return Err(error),
            };
            store
                .add_skipped(skipped)
                .map_err(|error| error.code().to_string())?;
            if indexed == 0 {
                break;
            }
        }
    }
    store.status().map_err(|error| error.code().to_string())
}

/// One-use native consent registry for the sensitive memory-only comparison.
/// A browser command never issues or inspects a grant.
#[derive(Clone, Default)]
pub struct SensitiveConsents {
    grants: Arc<Mutex<HashMap<String, AiInputRef>>>,
}

impl SensitiveConsents {
    pub fn issue(&self, consent_id: String, input: AiInputRef) -> Result<(), String> {
        if !crate::ai_search_types::is_canonical_uuid(&consent_id) {
            return Err("ai_search.invalid".to_string());
        }
        let mut guard = self
            .grants
            .lock()
            .map_err(|_| "ai_search.unavailable".to_string())?;
        guard.insert(consent_id, input);
        Ok(())
    }

    pub fn consume(&self, consent_id: &str) -> Result<AiInputRef, String> {
        let mut guard = self
            .grants
            .lock()
            .map_err(|_| "ai_search.unavailable".to_string())?;
        guard
            .remove(consent_id)
            .ok_or_else(|| "ai_search.sensitive".to_string())
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.grants.lock() {
            guard.clear();
        }
    }
}

/// Memory-only sensitive state. Closing or locking drops the input, zeroes
/// the vector and returns no candidate.
pub struct SensitiveOneShot {
    input: Option<AiInputRef>,
    vector: Vec<f32>,
    active: bool,
}

impl SensitiveOneShot {
    pub fn new(input: AiInputRef) -> Self {
        Self {
            input: Some(input),
            vector: Vec::new(),
            active: true,
        }
    }

    pub fn active(&self) -> bool {
        self.active
    }

    pub fn input_ref(&self) -> Option<AiInputRef> {
        self.input.clone()
    }

    pub fn set_vector(&mut self, dimensions: u16, vector: Vec<f32>) -> AiSearchResult<()> {
        if !self.active {
            return Err(AiSearchError::Sensitive);
        }
        validate_embedding(dimensions == crate::ai_search_types::TEXT_EMBEDDING_DIMENSIONS, dimensions, &vector)?;
        self.vector = vector;
        Ok(())
    }

    /// Compare the in-memory query with ordinary opted-in indexed roots.
    /// Nothing is inserted, logged or added to history.
    pub fn compare(
        &self,
        store: &SemanticStore,
        query: &SemanticQuery,
        cancel: &CancellationToken,
    ) -> AiSearchResult<crate::ai_search_types::SemanticPage> {
        if !self.active || self.input.is_none() || self.vector.is_empty() {
            // A locked or never-embedded lease must not look like a complete
            // empty search.
            return Err(AiSearchError::Sensitive);
        }
        store.search(query, &self.vector, cancel)
    }

    pub fn lock(&mut self) {
        self.vector.fill(0.0);
        self.vector.clear();
        self.input = None;
        self.active = false;
    }
}

#[cfg(windows)]
fn is_online_only(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    std::fs::metadata(path)
        .map(|meta| attributes_are_online_only(meta.file_attributes()))
        .unwrap_or(true)
}

#[cfg(not(windows))]
fn is_online_only(_path: &Path) -> bool {
    false
}

/// The coordinator passes the validated settings snapshot after each save.
pub fn policy_for(
    settings: AiSearchSettings,
    index_roots: Vec<IndexRoot>,
    sensitive_root_ids: Vec<String>,
    content_max_chars: u32,
    paused: bool,
    reason_code: Option<String>,
) -> SemanticPolicy {
    SemanticPolicy {
        settings,
        index_roots,
        sensitive_root_ids,
        content_max_chars,
        paused,
        reason_code,
    }
}

pub fn validate_policy_roots(policy: &SemanticPolicy, requested: &[String]) -> Result<Vec<String>, String> {
    if requested.len() > MAX_AI_SEARCH_ROOTS {
        return Err("ai_search.too_large".to_string());
    }
    let mut allowed: HashSet<String> = HashSet::new();
    for mode in ["text", "photos"] {
        for root in eligible_roots_for_mode(
            &policy.settings,
            &policy.index_roots,
            &policy.sensitive_root_ids,
            mode,
        ) {
            allowed.insert(root.root_id.clone());
        }
    }
    for root in requested {
        if !crate::ai_search_types::is_canonical_uuid(root) || !allowed.contains(root) {
            return Err("ai_search.denied".to_string());
        }
    }
    Ok(requested.to_vec())
}

pub fn validate_semantic_input_count(inputs: &[AiInputRef]) -> Result<(), String> {
    if inputs.len() > MAX_AI_NAME_INPUTS {
        return Err("ai_search.too_large".to_string());
    }
    Ok(())
}
