//! One pinned source and parent chain, held throughout isolated parsing.
use crate::thumbnail_providers::PreviewSource;
use fs_service::{
    owned_io::{PinnedDirectory, PinnedSource, SourceIdentity},
    SourceStamp,
};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

pub struct PreparedMetadataSource {
    pub source: PreviewSource,
    _parent: PinnedDirectory,
}
impl PreparedMetadataSource {
    pub fn open(path: &Path, expected: &SourceStamp) -> Result<Self, String> {
        expected
            .validate()
            .map_err(|_| "metadata.bad_request".to_string())?;
        let identity = SourceIdentity::capture(path).map_err(|_| "metadata.failed".to_string())?;
        if fs_service::source_stamp::attributes_are_online_only(identity.attributes) {
            return Err("metadata.online_only".into());
        }
        let parent = path.parent().ok_or("metadata.bad_request")?;
        let parent = PinnedDirectory::open(parent).map_err(|_| "metadata.failed".to_string())?;
        // Address the verified resolved chain, never reopen a redirecting alias.
        let resolved = parent
            .path()
            .join(path.file_name().ok_or("metadata.bad_request")?);
        let original_key =
            fs_service::source_stamp::path_key_of(path).map_err(|_| "metadata.bad_request")?;
        let resolved_key =
            fs_service::source_stamp::path_key_of(&resolved).map_err(|_| "metadata.bad_request")?;
        if original_key != resolved_key {
            return Err("metadata.failed".into());
        }
        let pinned = Arc::new(
            PinnedSource::open_background(&resolved, &identity)
                .map_err(|_| "metadata.changed".to_string())?,
        );
        let extension = crate::files::extension_of(
            &path
                .file_name()
                .ok_or("metadata.bad_request")?
                .to_string_lossy(),
        );
        let mime = crate::files::mime_from_ext(&extension)
            .split(';')
            .next()
            .unwrap_or("application/octet-stream")
            .to_string();
        let prepared = Self {
            source: PreviewSource {
                path: PathBuf::from(path),
                stamp: expected.clone(),
                extension,
                mime,
                pinned,
            },
            _parent: parent,
        };
        prepared.verify(expected)?;
        Ok(prepared)
    }
    pub fn verify(&self, expected: &SourceStamp) -> Result<(), String> {
        self.source
            .pinned
            .verify_after_read()
            .map_err(|_| "metadata.changed".to_string())?;
        let handle = fs_service::source_stamp::stamp_for_open_file(self.source.pinned.file())
            .map_err(|_| "metadata.changed".to_string())?;
        if format!("{:08x}", handle.volume_id) != expected.volume_id
            || format!("{:016x}", handle.file_id) != expected.file_id
            || handle.modified_ticks.to_string() != expected.modified_ticks
            || handle.size_bytes != expected.size_bytes
        {
            return Err("metadata.changed".into());
        }
        let current = fs_service::capture_source_stamp(&self.source.path)
            .map_err(|_| "metadata.changed".to_string())?;
        if current != *expected {
            return Err("metadata.changed".into());
        }
        Ok(())
    }
}
