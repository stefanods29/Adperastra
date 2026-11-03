use super::*;
use std::path::PathBuf;
use std::sync::Arc;

struct FakeProvider {
    id: &'static str,
    supports: bool,
}

impl MetadataProvider for FakeProvider {
    fn id(&self) -> &'static str {
        self.id
    }

    fn supports(&self, _source: &PreviewSource) -> bool {
        self.supports
    }

    fn read(&self, _source: &PreviewSource, _context: &JobContext) -> Result<MetadataInfo, String> {
        Err("metadata.failed".to_string())
    }
}

fn source() -> (tempfile::TempDir, PreviewSource) {
    let dir = tempfile::tempdir().expect("a temporary folder");
    let path = dir.path().join("picture.jpg");
    std::fs::write(&path, b"picture").expect("the fixture is written");
    let stamp = fs_service::capture_source_stamp(&path).expect("the fixture has a stamp");
    let identity =
        fs_service::owned_io::SourceIdentity::capture(&path).expect("the fixture has an identity");
    let pinned = Arc::new(
        fs_service::owned_io::PinnedSource::open(&path, &identity).expect("the fixture is pinned"),
    );
    (
        dir,
        PreviewSource {
            path: PathBuf::from(&path),
            stamp,
            mime: "image/jpeg".to_string(),
            extension: "jpg".to_string(),
            pinned,
        },
    )
}

#[test]
fn duplicate_and_unknown_ids_are_refused() {
    let mut registry = MetadataProviderRegistry::new();
    registry
        .register(Arc::new(FakeProvider {
            id: "special_psd",
            supports: true,
        }))
        .expect("the first registration is allowed");
    assert!(registry
        .register(Arc::new(FakeProvider {
            id: "special_psd",
            supports: true,
        }))
        .is_err());
    assert!(registry
        .register(Arc::new(FakeProvider {
            id: "totally_new",
            supports: true,
        }))
        .is_err());
    assert_eq!(registry.ids(), vec!["special_psd"]);
}

#[test]
fn the_fixed_priority_decides_between_claiming_providers() {
    let (_dir, source) = source();
    let mut registry = MetadataProviderRegistry::new();
    registry
        .register(Arc::new(WindowsPropertiesProvider))
        .expect("windows properties register");
    registry
        .register(Arc::new(FakeProvider {
            id: "special_raw",
            supports: true,
        }))
        .expect("raw registers");
    let provider = registry.resolve(&source).expect("a provider is chosen");
    assert_eq!(provider.id(), "special_raw");
}

#[test]
fn a_provider_that_does_not_claim_the_source_is_skipped() {
    let (_dir, source) = source();
    let mut registry = MetadataProviderRegistry::new();
    registry
        .register(Arc::new(FakeProvider {
            id: "special_psd",
            supports: false,
        }))
        .expect("psd registers");
    registry
        .register(Arc::new(WindowsPropertiesProvider))
        .expect("windows properties register");
    let provider = registry.resolve(&source).expect("a provider is chosen");
    assert_eq!(provider.id(), "windows_properties");
}

#[test]
fn the_default_registry_carries_only_the_windows_provider() {
    let registry = default_registry();
    assert_eq!(registry.ids(), vec!["windows_properties"]);
}
