use crate::Result;
use std::sync::Arc;
use uuid::Uuid;

pub const CHUNK: usize = 8 * 1024;

#[derive(Default)]
pub struct SnapshotStore(Option<(Uuid, Arc<[u8]>)>);

impl SnapshotStore {
    pub fn begin(&mut self, bytes: Arc<[u8]>) -> (Uuid, usize) {
        let id = Uuid::new_v4();
        let size = bytes.len();
        self.0 = Some((id, bytes));
        (id, size)
    }

    pub fn read(&self, id: Uuid, offset: usize) -> Result<&[u8]> {
        let (_, bytes) = self
            .0
            .as_ref()
            .filter(|(known, _)| *known == id)
            .ok_or("unknown snapshot")?;
        if offset >= bytes.len() {
            return Err("invalid snapshot offset".into());
        }
        Ok(&bytes[offset..offset.saturating_add(CHUNK).min(bytes.len())])
    }

    pub fn release(&mut self, id: Uuid) -> Result<()> {
        if self.0.as_ref().is_none_or(|(known, _)| *known != id) {
            return Err("unknown snapshot".into());
        }
        self.0 = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_is_frozen_bounded_and_releasable() {
        let mut store = SnapshotStore::default();
        let bytes: Arc<[u8]> = vec![7; CHUNK + 1].into();
        let (id, size) = store.begin(bytes.clone());
        assert_eq!(size, CHUNK + 1);
        assert_eq!(store.read(id, 0).unwrap().len(), CHUNK);
        assert_eq!(store.read(id, CHUNK).unwrap(), &[7]);
        assert!(store.read(Uuid::new_v4(), 0).is_err());
        assert!(store.read(id, size).is_err());
        store.release(id).unwrap();
        assert!(store.read(id, 0).is_err());
        assert_eq!(bytes.len(), CHUNK + 1);
    }
}
