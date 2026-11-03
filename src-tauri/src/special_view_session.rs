//! Live special-view sessions (Step 07g E1-E5).
//!
//! A session owns one source stamp, at most one preview lease, one geometry
//! lease, at most 32 texture leases and (for PSD) one persistent helper.
//! Closing is idempotent and releases exactly what the session owns.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use fs_service::SourceStamp;

use crate::special_view_types::{
    PsdLayerInfo, SceneInfo, SceneUnit, SpecialKind, SpecialSession, MAX_SPECIAL_SESSIONS,
};
use crate::webview_helper::WebviewHelperSession;
use cache_store::CacheLease;

pub struct SpecialSessionState {
    pub session_id: String,
    pub busy: bool,
    pub closed: bool,
    pub cancel: fs_service::CancellationToken,
    pub source: SourceStamp,
    pub kind: SpecialKind,
    pub preview: Option<CacheLease>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codec_required: bool,
    pub partial: bool,
    pub scene: Option<SceneInfo>,
    pub unit: SceneUnit,
    pub psd_layer_count: u32,
    pub psd_composite: bool,
    pub psd_helper: Option<WebviewHelperSession>,
    /// Cursor UUID -> layer offset. Cursors are source-bound because they
    /// only exist inside this session.
    pub layer_cursors: HashMap<String, u32>,
}

impl SpecialSessionState {
    pub fn new(session_id: String, source: SourceStamp, kind: SpecialKind) -> Self {
        Self {
            session_id,
            busy: false,
            closed: false,
            cancel: fs_service::new_cancellation_token(),
            source,
            kind,
            preview: None,
            width: None,
            height: None,
            codec_required: false,
            partial: false,
            scene: None,
            unit: SceneUnit::None,
            psd_layer_count: 0,
            psd_composite: false,
            psd_helper: None,
            layer_cursors: HashMap::new(),
        }
    }

    pub fn take_work(
        &mut self,
        token: Option<fs_service::CancellationToken>,
    ) -> Result<Self, String> {
        if self.closed || self.busy {
            return Err("special_view.unavailable".into());
        }
        if let Some(token) = token {
            self.cancel = token;
        }
        self.busy = true;
        let mut work = Self::new(self.session_id.clone(), self.source.clone(), self.kind);
        work.cancel = self.cancel.clone();
        work.preview = self.preview.clone();
        work.width = self.width;
        work.height = self.height;
        work.codec_required = self.codec_required;
        work.partial = self.partial;
        work.scene = self.scene.clone();
        work.unit = self.unit;
        work.psd_layer_count = self.psd_layer_count;
        work.psd_composite = self.psd_composite;
        work.layer_cursors = self.layer_cursors.clone();
        work.psd_helper = self.psd_helper.take();
        Ok(work)
    }

    pub fn wire(&self) -> SpecialSession {
        SpecialSession {
            session_id: self.session_id.clone(),
            source: self.source.clone(),
            kind: self.kind,
            preview: self.preview.clone(),
            width: self.width,
            height: self.height,
            codec_required: self.codec_required,
            partial: self.partial,
        }
    }

    /// Leases that closing the session must release.
    pub fn leases(&self) -> Vec<String> {
        let mut leases = Vec::new();
        if let Some(preview) = &self.preview {
            leases.push(preview.lease_id.clone());
        }
        if let Some(scene) = &self.scene {
            leases.push(scene.geometry.lease_id.clone());
            leases.extend(
                scene
                    .textures
                    .iter()
                    .map(|texture| texture.lease_id.clone()),
            );
        }
        leases
    }

    /// Attach one helper page to this session. The next cursor points at the
    /// first layer after this page and exists only inside this session.
    pub fn page_layers(
        &mut self,
        layers: Vec<PsdLayerInfo>,
        page_start: u32,
        complete: bool,
    ) -> crate::special_view_types::PsdInfo {
        let next_cursor = if complete || layers.is_empty() {
            None
        } else {
            let cursor = uuid::Uuid::new_v4().to_string();
            self.layer_cursors
                .insert(cursor.clone(), page_start + layers.len() as u32);
            Some(cursor)
        };
        crate::special_view_types::PsdInfo {
            session: self.wire(),
            layers,
            complete: complete || next_cursor.is_none(),
            next_cursor,
        }
    }

    pub fn offset_for_cursor(&self, cursor: &str) -> Result<u32, String> {
        self.layer_cursors
            .get(cursor)
            .copied()
            .ok_or_else(|| "special_view.bad_request".to_string())
    }
}

/// All live sessions. The map lock is never held across helper work.
type SessionMap = HashMap<String, Arc<Mutex<SpecialSessionState>>>;

#[derive(Default)]
pub struct SpecialViews {
    sessions: Mutex<SessionMap>,
}

impl SpecialViews {
    fn lock(&self) -> Result<MutexGuard<'_, SessionMap>, String> {
        self.sessions
            .lock()
            .map_err(|_| "special view lock poisoned".to_string())
    }

    pub fn insert(&self, state: SpecialSessionState) -> Result<(), String> {
        let mut sessions = self.lock()?;
        if sessions.len() >= MAX_SPECIAL_SESSIONS {
            return Err("special_view.too_large".to_string());
        }
        let id = state.session_id.clone();
        sessions.insert(id, Arc::new(Mutex::new(state)));
        Ok(())
    }

    pub fn get(&self, session_id: &str) -> Result<Arc<Mutex<SpecialSessionState>>, String> {
        self.lock()?
            .get(session_id)
            .cloned()
            .ok_or_else(|| "special_view.bad_request".to_string())
    }

    pub fn remove(&self, session_id: &str) -> Option<Arc<Mutex<SpecialSessionState>>> {
        self.lock().ok()?.remove(session_id)
    }
}
