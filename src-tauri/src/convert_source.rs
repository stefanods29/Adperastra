fn mime_of(path: &Path) -> String {
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    crate::files::mime_from_ext(&extension)
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .to_string()
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn resolve_file(path: &Path, expected: Option<&SourceStamp>) -> Result<ResolvedFile, String> {
    resolve_file_policy(path, expected, false)
}

fn resolve_file_policy(path: &Path, expected: Option<&SourceStamp>, background: bool) -> Result<ResolvedFile, String> {
    let text = path
        .to_str()
        .ok_or_else(|| "convert.bad_request".to_string())?;
    crate::validate_absolute_path(text).map_err(|_| "convert.bad_request".to_string())?;
    if !path.is_file() {
        return Err("convert.bad_request".to_string());
    }
    let stamp = fs_service::capture_source_stamp(path)
        .map_err(|_| "convert.bad_request".to_string())?;
    if let Some(expected) = expected {
        if expected != &stamp {
            return Err("convert.changed".to_string());
        }
    }
    let identity =
        SourceIdentity::capture(path).map_err(|_| "convert.changed".to_string())?;
    let guard = if background {
        PinnedSource::open_background(path, &identity)
    } else {
        PinnedSource::open(path, &identity)
    }.map_err(|_| "convert.changed".to_string())?;
    if fs_service::capture_source_stamp(path).map_err(|_| "convert.changed".to_string())? != stamp {
        return Err("convert.changed".into());
    }
    Ok(ResolvedFile {
        name: name_of(path),
        mime: mime_of(path),
        stamp,
        _guard: guard,
    })
}

fn read_backing(backing: &GrantedBacking, max: u64) -> Result<Zeroizing<Vec<u8>>, String> {
    match backing {
        GrantedBacking::Memory { bytes, length, .. } => {
            if *length > max {
                return Err("convert.too_large".to_string());
            }
            Ok(Zeroizing::new(bytes.as_slice().to_vec()))
        }
        GrantedBacking::Disk { length, .. } => {
            if *length > max {
                return Err("convert.too_large".to_string());
            }
            let mut raw = Vec::with_capacity(*length as usize);
            let mut offset = 0u64;
            while offset < *length {
                let take = (*length - offset).min(1024 * 1024) as usize;
                let chunk = backing.read_range(offset, take)
                    .map_err(|_| "convert.changed".to_string())?;
                if chunk.len() != take { return Err("convert.changed".to_string()); }
                raw.extend_from_slice(&chunk);
                offset += chunk.len() as u64;
            }
            Ok(Zeroizing::new(raw))
        }
    }
}

type ResolvedSnapshot = (String, String, Option<SourceStamp>, Zeroizing<Vec<u8>>, bool);

fn resolve_snapshot(
    snapshots: &ExportSnapshots,
    snapshot_id: &str,
    document_id: &str,
    revision: u64,
) -> Result<ResolvedSnapshot, String> {
    let lease = snapshots.resolve(snapshot_id, document_id, revision)?;
    let name = snapshots
        .authorities()
        .get(Uuid::parse_str(document_id).map_err(|_| "convert.bad_request".to_string())?)
        .map(|record| record.authority.name.clone())
        .unwrap_or_else(|_| "document".to_string());
    let sensitive = lease.snapshot.storage_policy
        == crate::export_snapshot_types::StoragePolicy::Sensitive;
    let bytes = read_backing(&lease.backing, crate::export_snapshot_types::MAX_SNAPSHOT_BYTES)?;
    Ok((
        name,
        lease.snapshot.mime.clone(),
        lease.snapshot.source.clone(),
        bytes,
        sensitive,
    ))
}

