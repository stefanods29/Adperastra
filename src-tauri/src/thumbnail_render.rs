use super::*;
impl ThumbnailService {
    /// The whole provider pipeline for one key. Item-level failures become
    /// fallback states, never one error toast per file (plan D7).
    pub(super) fn render_request(
        &self,
        key: &CacheKey,
        path: &str,
        expected: &SourceStamp,
        edge: u32,
        cancel: &CancellationToken,
        context: Option<&JobContext>,
    ) -> Result<RenderOutcome, String> {
        if cancel.load(Ordering::Relaxed)
            || context.is_some_and(|context| context.token().load(Ordering::Relaxed))
        {
            return Err("background.cancelled".to_string());
        }
        let (idle, ac) = self.policy.samples();
        if !self
            .policy
            .eligible(BackgroundTaskKind::Thumbnails, idle, ac)
        {
            return Ok(RenderOutcome::State(ThumbnailState::Paused));
        }
        let source_path = Path::new(path);
        match self.inspector.online_only(source_path) {
            Ok(true) => return Ok(RenderOutcome::State(ThumbnailState::OnlineOnly)),
            Ok(false) => {}
            Err(_) => return Ok(RenderOutcome::State(ThumbnailState::Unsupported)),
        }
        let current = match self.cache.source_stamp(source_path) {
            Ok(stamp) => stamp,
            Err(_) => return Ok(RenderOutcome::State(ThumbnailState::Unsupported)),
        };
        if current != *expected {
            return Ok(RenderOutcome::State(ThumbnailState::Unsupported));
        }
        match self.cache.lookup(key) {
            Ok(Some(record)) => return Ok(RenderOutcome::Ready(record)),
            Ok(None) => {}
            Err(_) => return Ok(RenderOutcome::State(ThumbnailState::Unsupported)),
        }
        let identity = match SourceIdentity::capture(source_path) {
            Ok(identity) => identity,
            Err(_) => return Ok(RenderOutcome::State(ThumbnailState::Unsupported)),
        };
        let pinned = match PinnedSource::open_background(source_path, &identity) {
            Ok(pinned) => Arc::new(pinned),
            Err(_) => return Ok(RenderOutcome::State(ThumbnailState::Unsupported)),
        };
        let extension = source_path
            .file_name()
            .map(|name| extension_of(&name.to_string_lossy()))
            .unwrap_or_default();
        let mime = crate::files::mime_from_ext(&extension)
            .split(';')
            .next()
            .unwrap_or("application/octet-stream")
            .to_string();
        let preview = PreviewSource {
            path: source_path.to_path_buf(),
            stamp: current.clone(),
            mime,
            extension,
            pinned,
        };
        let Some(provider) = self.registry.resolve(&preview) else {
            return Ok(RenderOutcome::State(ThumbnailState::Unsupported));
        };
        if provider.id().replace('_', "-") != key.handler_id
            || provider.version() != key.handler_version
            || preview.mime.is_empty()
            || preview.mime.len() > 128
        {
            return Ok(RenderOutcome::State(ThumbnailState::Unsupported));
        }
        let Some(job_context) = context else {
            return Ok(RenderOutcome::State(ThumbnailState::Unsupported));
        };
        let prepared = match provider.produce(&preview, edge, job_context) {
            Ok(prepared) => prepared,
            Err(code) if code == "background.cancelled" => {
                return Err("background.cancelled".to_string())
            }
            Err(code) if code == "thumbnail.online_only" => {
                return Ok(RenderOutcome::State(ThumbnailState::OnlineOnly))
            }
            Err(_) => return Ok(RenderOutcome::State(ThumbnailState::Unsupported)),
        };
        if cancel.load(Ordering::Relaxed)
            || context.is_some_and(|context| context.token().load(Ordering::Relaxed))
        {
            return Err("background.cancelled".to_string());
        }
        if preview.pinned.verify_after_read().is_err() {
            return Ok(RenderOutcome::State(ThumbnailState::Unsupported));
        }
        let after = match self.cache.source_stamp(source_path) {
            Ok(stamp) => stamp,
            Err(_) => return Ok(RenderOutcome::State(ThumbnailState::Unsupported)),
        };
        if after != *expected || prepared.source != *expected {
            return Ok(RenderOutcome::State(ThumbnailState::Unsupported));
        }
        match self.cache.publish(
            key,
            &prepared.file,
            &prepared.mime,
            Some(prepared.width),
            Some(prepared.height),
        ) {
            Ok(record) => Ok(RenderOutcome::Ready(record)),
            Err(code) if code == "thumbnail.bad_request" => Err(code),
            Err(_) => Ok(RenderOutcome::State(ThumbnailState::Unsupported)),
        }
    }
}
