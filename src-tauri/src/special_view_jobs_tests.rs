use super::*;
use crate::special_view_types::{SceneMaterial, SceneNode, ScenePrimitive};

struct FakeBackend {
    fail: bool,
    calls: std::sync::atomic::AtomicUsize,
}

impl SpecialBackend for FakeBackend {
    fn open(
        &self,
        _source: &SourceStamp,
        _path: &Path,
        _kind: SpecialKind,
        _stamp_for: &dyn Fn(&Path) -> Result<SourceStamp, String>,
        _cancel: &CancellationToken,
    ) -> Result<OpenArtifact, String> {
        self.calls
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if self.fail {
            return Err("special_view.unavailable".to_string());
        }
        Ok(OpenArtifact {
            preview: None,
            scene: Some(SceneArtifact {
                bytes: vec![0u8; 44],
                summary: SafeSceneSummary {
                    object_count: 0,
                    vertex_count: 0,
                    triangle_count: 0,
                    bounds: [0.0; 6],
                    materials: Vec::<SceneMaterial>::new(),
                    primitives: Vec::<ScenePrimitive>::new(),
                    nodes: Vec::<SceneNode>::new(),
                    unit: SceneUnit::None,
                },
                textures: Vec::new(),
                unit: SceneUnit::None,
                partial: false,
            }),
            psd: None,
            helper: None,
            codec_required: false,
            partial: false,
        })
    }

    fn full_raw(
        &self,
        _source: &SourceStamp,
        _path: &Path,
        _edge: u32,
        _cancel: &CancellationToken,
    ) -> Result<PreparedImage, String> {
        Err("special_view.unavailable".to_string())
    }

    fn psd_layers(
        &self,
        _helper: &mut Option<WebviewHelperSession>,
        _offset: u32,
    ) -> Result<PsdPage, String> {
        Ok(PsdPage {
            layers: Vec::new(),
            complete: true,
        })
    }
}

fn stamp() -> SourceStamp {
    SourceStamp {
        path_key: "C:\\Models\\a.stl".to_string(),
        volume_id: "00000000".to_string(),
        file_id: "0000000000000000".to_string(),
        modified_ticks: "1".to_string(),
        size_bytes: 100,
    }
}

#[test]
fn helper_crash_returns_an_error_without_a_session() {
    let backend = FakeBackend {
        fail: true,
        calls: std::sync::atomic::AtomicUsize::new(0),
    };
    let token = fs_service::new_cancellation_token();
    let result = backend.open(
        &stamp(),
        Path::new("C:\\Models\\a.stl"),
        SpecialKind::Model,
        &|_| Ok(stamp()),
        &token,
    );
    assert_eq!(result.err().as_deref(), Some("special_view.unavailable"));
    assert_eq!(backend.calls.load(std::sync::atomic::Ordering::Relaxed), 1);
    let views = SpecialViews::default();
    assert_eq!(
        views.get("missing").err().as_deref(),
        Some("special_view.bad_request")
    );
}

#[test]
fn layer_cursors_are_session_bound_and_paged() {
    let mut state = crate::special_view_session::SpecialSessionState::new(
        "s".to_string(),
        stamp(),
        SpecialKind::Psd,
    );
    state.psd_layer_count = 300;
    let mut layers = Vec::new();
    for id in 0..256u32 {
        layers.push(PsdLayerInfo {
            id,
            parent: None,
            name: format!("layer-{id}"),
            visible: true,
            opacity: 1.0,
            children_count: 0,
        });
    }
    let first = state.page_layers(layers, 0, false);
    assert_eq!(first.layers.len(), 256);
    assert!(!first.complete);
    let cursor = first.next_cursor.expect("more layers");
    assert_eq!(state.offset_for_cursor(&cursor), Ok(256));
    let second = state.page_layers(Vec::new(), 256, true);
    assert!(second.complete);
    assert!(second.next_cursor.is_none());
}
