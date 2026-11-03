use super::*;

pub(super) fn publish_textures(
    cache: &CacheService,
    source: &SourceStamp,
    images: &[PreparedImage],
    guard: &mut LeaseGuard<'_>,
) -> Result<Vec<CacheLease>, String> {
    let mut textures = Vec::new();
    for (index, image) in images.iter().take(SPECIAL_MAX_TEXTURES).enumerate() {
        let lease = publish_image(cache, source, &format!("special_texture-{index}"), image)?;
        guard.add(&lease);
        textures.push(lease);
    }
    Ok(textures)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn equal_size_textures_keep_distinct_bytes_and_original_slots() {
        let directory = tempfile::tempdir().unwrap();
        let grants = Arc::new(crate::files::FileGrants::default());
        let cache = CacheService::new(directory.path().to_path_buf(), Arc::clone(&grants));
        let source = SourceStamp {
            path_key: r"c:\model.glb".into(),
            volume_id: "00000001".into(),
            file_id: "0000000000000001".into(),
            modified_ticks: "1".into(),
            size_bytes: 1,
        };
        let images: Vec<_> = [17, 29]
            .into_iter()
            .map(|byte| PreparedImage {
                png: vec![byte; 64],
                width: 1,
                height: 1,
                codec_required: false,
                partial: false,
            })
            .collect();
        let mut guard = LeaseGuard::new(&cache);
        let leases = publish_textures(&cache, &source, &images, &mut guard).unwrap();
        assert_eq!(leases.len(), 2);
        let first = grants.path_for(&leases[0].token).unwrap();
        let second = grants.path_for(&leases[1].token).unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(first).unwrap(), images[0].png);
        assert_eq!(std::fs::read(second).unwrap(), images[1].png);
    }
}
