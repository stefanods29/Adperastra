//! Step 12b T1: an engine build may only run when it is permissive and its
//! bytes are the reviewed ones (D1, R-LIC).
//!
//! The coordinator produces the real packs, their license inventory and their
//! frozen hashes; these tests fix the gate that runs before every launch.

use crate::engine_build::{audit_build, may_launch, BuildBinary, EngineBuildManifest, VerifiedBinary};
use crate::engine_types::{EngineError, EngineId};

fn media_manifest() -> EngineBuildManifest {
    EngineBuildManifest {
        engine: EngineId::Media,
        version: "9.0.2".to_string(),
        configuration: vec![
            "--disable-network".to_string(),
            "--disable-doc".to_string(),
            "--disable-debug".to_string(),
        ],
        licenses: vec!["LGPL-2.1-or-later".to_string(), "MIT".to_string()],
        binaries: vec![
            BuildBinary {
                relative_path: "bin/ffmpeg.exe".to_string(),
                sha256: "1".repeat(64),
                required: true,
            },
            BuildBinary {
                relative_path: "bin/ffprobe.exe".to_string(),
                sha256: "2".repeat(64),
                required: true,
            },
        ],
    }
}

fn verified_media() -> Vec<VerifiedBinary> {
    vec![
        VerifiedBinary {
            relative_path: "bin/ffmpeg.exe".to_string(),
            sha256: "1".repeat(64),
            byte_len: 4096,
        },
        VerifiedBinary {
            relative_path: "bin/ffprobe.exe".to_string(),
            sha256: "2".repeat(64),
            byte_len: 2048,
        },
    ]
}

/// `enable-gpl -> unsafe_build`: a build with a GPL switch is refused and the
/// host must not start it, even when every hash matches.
#[test]
fn reject_gpl_build() {
    for switch in [
        "--enable-gpl",
        "--enable-nonfree",
        "--enable-libx264",
        "--enable-libx265",
        "--enable-libfdk-aac",
    ] {
        let mut manifest = media_manifest();
        manifest.configuration.push(switch.to_string());
        assert_eq!(
            audit_build(&manifest, &verified_media()).err(),
            Some(EngineError::UnsafeBuild),
            "{switch} must make the build unusable"
        );
        assert!(!may_launch(&manifest, &verified_media()));
    }
    // A GPL license line is refused the same way.
    let mut gpl_license = media_manifest();
    gpl_license.licenses = vec!["GPL-3.0".to_string()];
    assert_eq!(
        audit_build(&gpl_license, &verified_media()).err(),
        Some(EngineError::UnsafeBuild)
    );
}

/// `unknown_binary_hash: mismatch -> no process`.
#[test]
fn unknown_binary_hash() {
    let mut manifest = media_manifest();
    // The reviewed hash is not the hash of the file on disk: no launch.
    manifest.binaries[0].sha256 = "9".repeat(64);
    assert_eq!(
        audit_build(&manifest, &verified_media()).err(),
        Some(EngineError::UnsafeBuild)
    );
    assert!(!may_launch(&manifest, &verified_media()));

    // A file the inventory never recorded is refused as well.
    let mut extra = verified_media();
    extra.push(VerifiedBinary {
        relative_path: "bin/extra.exe".to_string(),
        sha256: "3".repeat(64),
        byte_len: 1,
    });
    assert_eq!(
        audit_build(&media_manifest(), &extra).err(),
        Some(EngineError::UnsafeBuild)
    );
}

/// `missing_real_artifact: unavailable, no placeholder success`.
#[test]
fn missing_real_artifact() {
    // Nothing was found on disk: the engine is unavailable, not "ready with
    // a placeholder".
    assert_eq!(
        audit_build(&media_manifest(), &[]).err(),
        Some(EngineError::PackMissing)
    );
    assert!(!may_launch(&media_manifest(), &[]));

    // A required binary missing from the verified set is unavailable.
    let mut partial = verified_media();
    partial.remove(1);
    assert_eq!(
        audit_build(&media_manifest(), &partial).err(),
        Some(EngineError::PackMissing)
    );
}

/// An optional helper may be absent, but then it is never used.
#[test]
fn optional_helper_may_be_absent() {
    let mut manifest = media_manifest();
    manifest.binaries[1].required = false;
    let mut partial = verified_media();
    partial.remove(1);
    assert!(may_launch(&manifest, &partial));
}
