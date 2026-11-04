//! Initial Office model identity comes from the canonical 09a document open.
use crate::{
    file_grant_backing::GrantedBacking,
    office_edit_types::{AuthorizedOfficeInput, OfficeFormat, OfficeInputBacking},
};
use std::sync::Arc;
use uuid::Uuid;

pub fn authorized_input(
    document_id: Uuid,
    backing: Arc<GrantedBacking>,
    format: OfficeFormat,
) -> Arc<AuthorizedOfficeInput> {
    Arc::new(AuthorizedOfficeInput {
        document_id,
        initial_revision: 1,
        // DocumentRegistry uses initialDocumentState(opened.document_id).
        // A second random identity would correctly fail controller.attach.
        initial_content_id: document_id,
        sensitive: backing.is_sensitive(),
        backing: OfficeInputBacking::Original(backing),
        format,
        source: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn office_open_uses_the_registry_initial_identity_and_native_sensitivity() {
        let id = Uuid::new_v4();
        let backing = Arc::new(GrantedBacking::Memory {
            bytes: Arc::new(zeroize::Zeroizing::new(vec![1, 2, 3])),
            length: 3,
            sensitive: true,
        });
        let input = authorized_input(id, backing, OfficeFormat::Docx);
        assert_eq!(input.document_id, id);
        assert_eq!(input.initial_content_id, id);
        assert_eq!(input.initial_revision, 1);
        assert!(input.sensitive);
        assert!(input.is_valid());
    }
}
