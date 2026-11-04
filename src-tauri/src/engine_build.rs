//! Auditing an engine build before it may run (Step 12b T1, D1).
//!
//! A pack is only usable when its build is provably permissive and its bytes
//! are the reviewed ones. This module checks the recorded build facts and the
//! verified binary hashes; it never downloads, builds or trusts a file name.
//! When a fact is missing the engine is reported unavailable instead of being
//! started with a placeholder (no fake success).
//!
//! The coordinator produces the real pack artifacts, inventories their
//! licenses and freezes the final hashes in the signed 12a catalog; this audit
//! is the gate the native side runs before the first launch and on every
//! update.
#![allow(dead_code)]


use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::engine_types::{is_sha256_hex, EngineError, EngineId};

/// Build flags that may never appear in a bundled engine (R-LIC).
pub const FORBIDDEN_FLAGS: [&str; 6] = [
    "--enable-gpl",
    "--enable-nonfree",
    "--enable-libx264",
    "--enable-libx265",
    "--enable-libfdk-aac",
    "--enable-version3",
];

/// Build flags that must appear: a build without them still has a network
/// stack or GPL code paths that were not reviewed.
pub const REQUIRED_FLAGS: [&str; 1] = ["--disable-network"];

/// License identifiers that may never be bundled (R-LIC-3).
pub const FORBIDDEN_LICENSES: [&str; 5] = [
    "GPL-2.0",
    "GPL-3.0",
    "AGPL-3.0",
    "SSPL-1.0",
    "nonfree",
];

/// One binary of a pack, as the signed inventory records it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildBinary {
    /// Relative path inside the pack (`bin/ffmpeg.exe`).
    pub relative_path: String,
    /// Lowercase hex SHA-256 of the exact file.
    pub sha256: String,
    /// True when the engine cannot work without this binary.
    pub required: bool,
}

/// The reviewed build facts of one engine pack.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineBuildManifest {
    pub engine: EngineId,
    pub version: String,
    pub configuration: Vec<String>,
    pub licenses: Vec<String>,
    pub binaries: Vec<BuildBinary>,
}

/// The hash of one file that was actually found on disk and read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedBinary {
    pub relative_path: String,
    pub sha256: String,
    pub byte_len: u64,
}

/// Audit the recorded build and the verified files.
///
/// `Err(engines.unsafe_build)` means the build itself may not be used;
/// `Err(engines.pack_missing)` means a required file is absent. In both cases
/// nothing is launched.
pub fn audit_build(
    manifest: &EngineBuildManifest,
    verified: &[VerifiedBinary],
) -> Result<(), EngineError> {
    if manifest.version.is_empty() || manifest.version.len() > 64 {
        return Err(EngineError::BadRequest);
    }
    if manifest.binaries.is_empty() || manifest.binaries.len() > 64 {
        return Err(EngineError::BadRequest);
    }
    // A GPL or nonfree switch means the build cannot be bundled at all.
    for flag in &manifest.configuration {
        let lowered = flag.to_ascii_lowercase();
        if FORBIDDEN_FLAGS
            .iter()
            .any(|forbidden| lowered.starts_with(forbidden))
        {
            return Err(EngineError::UnsafeBuild);
        }
    }
    let configuration: Vec<String> = manifest
        .configuration
        .iter()
        .map(|flag| flag.to_ascii_lowercase())
        .collect();
    if !REQUIRED_FLAGS
        .iter()
        .all(|required| configuration.iter().any(|flag| flag == required))
    {
        return Err(EngineError::UnsafeBuild);
    }
    for license in &manifest.licenses {
        if FORBIDDEN_LICENSES
            .iter()
            .any(|forbidden| license.eq_ignore_ascii_case(forbidden))
        {
            return Err(EngineError::UnsafeBuild);
        }
    }
    // Every required binary must be present with the exact reviewed hash.
    let found: HashMap<&str, &VerifiedBinary> = verified
        .iter()
        .map(|binary| (binary.relative_path.as_str(), binary))
        .collect();
    for binary in &manifest.binaries {
        if !is_sha256_hex(&binary.sha256) {
            return Err(EngineError::BadRequest);
        }
        match found.get(binary.relative_path.as_str()) {
            Some(actual) if actual.sha256 == binary.sha256 && actual.byte_len > 0 => {}
            Some(_) => return Err(EngineError::UnsafeBuild),
            None if binary.required => return Err(EngineError::PackMissing),
            // An optional helper may be absent; it is never launched then.
            None => {}
        }
    }
    // A file nobody recorded in the inventory means the pack is not the one
    // that was reviewed.
    for actual in verified {
        if !manifest
            .binaries
            .iter()
            .any(|binary| binary.relative_path == actual.relative_path)
        {
            return Err(EngineError::UnsafeBuild);
        }
    }
    Ok(())
}

/// True only when the audit passed: the host must consult this before a spawn.
pub fn may_launch(manifest: &EngineBuildManifest, verified: &[VerifiedBinary]) -> bool {
    audit_build(manifest, verified).is_ok()
}

#[cfg(test)]
mod tests {
    use super::{audit_build, may_launch, BuildBinary, EngineBuildManifest, VerifiedBinary};
    use crate::engine_types::{EngineError, EngineId};

    fn manifest() -> EngineBuildManifest {
        EngineBuildManifest {
            engine: EngineId::Media,
            version: "9.0.2".to_string(),
            configuration: vec![
                "--disable-network".to_string(),
                "--disable-doc".to_string(),
            ],
            licenses: vec!["LGPL-2.1".to_string()],
            binaries: vec![BuildBinary {
                relative_path: "bin/ffmpeg.exe".to_string(),
                sha256: "a".repeat(64),
                required: true,
            }],
        }
    }

    fn verified() -> Vec<VerifiedBinary> {
        vec![VerifiedBinary {
            relative_path: "bin/ffmpeg.exe".to_string(),
            sha256: "a".repeat(64),
            byte_len: 1024,
        }]
    }

    #[test]
    fn a_clean_build_passes() {
        assert!(may_launch(&manifest(), &verified()));
    }

    #[test]
    fn gpl_switches_invalidate_the_build() {
        let mut gpl = manifest();
        gpl.configuration.push("--enable-gpl".to_string());
        assert_eq!(
            audit_build(&gpl, &verified()).err(),
            Some(EngineError::UnsafeBuild)
        );
        assert!(!may_launch(&gpl, &verified()));
    }

    #[test]
    fn an_unreviewed_hash_stops_the_launch() {
        let mut different = verified();
        different[0].sha256 = "b".repeat(64);
        assert_eq!(
            audit_build(&manifest(), &different).err(),
            Some(EngineError::UnsafeBuild)
        );
        assert!(!may_launch(&manifest(), &different));
    }

    #[test]
    fn a_missing_artifact_is_unavailable_not_a_placeholder() {
        assert_eq!(
            audit_build(&manifest(), &[]).err(),
            Some(EngineError::PackMissing)
        );
        assert!(!may_launch(&manifest(), &[]));
    }
}
