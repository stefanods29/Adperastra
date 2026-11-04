use super::*;
impl MetadataService {
    pub(super) fn render_request(
        &self,
        key: &CacheKey,
        path: &str,
        expected: &SourceStamp,
        cancel: &CancellationToken,
        context: Option<&JobContext>,
    ) -> Result<MetadataInfo, String> {
        if cancel.load(Ordering::Relaxed) {
            return Err("background.cancelled".into());
        }
        let (idle, ac) = self.policy.samples();
        if !self.policy.eligible(BackgroundTaskKind::Metadata, idle, ac) {
            return Err("background.paused".into());
        }
        let prepared =
            crate::metadata_source::PreparedMetadataSource::open(Path::new(path), expected)?;
        if let Some(info) = crate::metadata_cache::cached(&self.cache, key) {
            prepared.verify(expected)?;
            return Ok(info);
        }
        let context = context.ok_or("metadata.failed")?;
        let provider = self
            .registry
            .lock()
            .map_err(|_| "metadata.failed")?
            .resolve(&prepared.source)
            .ok_or("metadata.failed")?;
        let info = provider.read(&prepared.source, context)?.validated()?;
        prepared.verify(expected)?;
        if info.source != *expected {
            return Err("metadata.changed".into());
        }
        if cancel.load(Ordering::Relaxed) {
            return Err("background.cancelled".into());
        }
        // A full/unavailable cache never hides freshly read valid metadata.
        let _ = crate::metadata_cache::publish(&self.cache, key, &info);
        Ok(info)
    }
}
