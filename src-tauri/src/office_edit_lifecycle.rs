//! Profile switch and idempotent Office session close (Step 20a T2/D9).
//!
//! Closing always drops the local session, its cached receipts and every
//! binary lease, even if the engine reports a failure. A profile switch keeps
//! no session, receipt or lease from the previous profile alive.
#![allow(dead_code)]


use std::sync::Arc;

use uuid::Uuid;

use crate::office_edit_leases::close_office_session as close_office_leases;
use crate::office_edit_sessions::{OfficeEditSession, OfficeEditState};
use crate::office_edit_types::OfficeEditError;
use crate::office_edit_validation::valid_profile_id;

impl OfficeEditState {
    /// Remove one session after an identity change; profile is ignored on
    /// purpose so a switch race cannot retain an obsolete engine session.
    pub(crate) fn discard_session(&self, session_id: Uuid) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(&session_id);
        }
        if let Ok(engine) = self.engine() {
            let _ = engine.close(session_id);
        }
        close_office_leases(session_id);
    }

    /// Never leave another profile's session or lease alive.
    pub fn switch_profile(&self, profile_id: &str) -> Result<(), OfficeEditError> {
        if !valid_profile_id(profile_id) {
            return Err(OfficeEditError::Invalid);
        }
        {
            let mut current = self.profile.lock().map_err(|_| OfficeEditError::Failed)?;
            if current.as_deref() == Some(profile_id) {
                return Ok(());
            }
            *current = Some(profile_id.to_string());
        }
        let sessions: Vec<Arc<OfficeEditSession>> = {
            let mut sessions = self.sessions.lock().map_err(|_| OfficeEditError::Failed)?;
            sessions.drain().map(|(_, session)| session).collect()
        };
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
        let engine = self.engine().ok();
        for session in sessions {
            let Ok(state) = session.snapshot() else {
                continue;
            };
            if let Some(engine) = &engine {
                let _ = engine.close(state.session_id);
            }
            close_office_leases(state.session_id);
        }
        Ok(())
    }

    /// Close is idempotent for an unknown id and always drops local state and
    /// leases, even when the engine close reports a failure.
    pub fn close_session(&self, session_id: Uuid) -> Result<(), OfficeEditError> {
        let profile = self.current_profile()?;
        let session = {
            let sessions = self.sessions.lock().map_err(|_| OfficeEditError::Failed)?;
            match sessions.get(&session_id) {
                Some(session) if session.profile_id == profile => Arc::clone(session),
                Some(_) => return Err(OfficeEditError::Invalid),
                None => return Ok(()),
            }
        };
        let _guard = session.lock_mutation()?;
        {
            let mut sessions = self.sessions.lock().map_err(|_| OfficeEditError::Failed)?;
            sessions.remove(&session_id);
        }
        let outcome = match self.engine() {
            Ok(engine) => engine.close(session_id),
            Err(OfficeEditError::EngineMissing) => Ok(()),
            Err(error) => Err(error),
        };
        close_office_leases(session_id);
        outcome
    }
}
