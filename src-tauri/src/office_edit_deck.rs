//! Typed presentation operations (Step 20a E1, office-edit-1).
//!
//! The TypeScript mirror is `src/office/deckOperations.ts`. Every operation is
//! inert data; no script, HTML, external media or engine command is accepted.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::office_edit_presentation::{
    DeckAnimation, DeckShape, DeckShapePatch, DeckTheme, DeckTransition,
};
use crate::office_edit_types::OfficeEditError;
use crate::office_edit_values::{
    OfficeSelection, ParagraphFormatPatch, TextFormatPatch, TextPosition, TextSpan,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeckArrangeAction {
    Front,
    Back,
    Forward,
    Backward,
    AlignLeft,
    AlignCenter,
    AlignRight,
    AlignTop,
    AlignMiddle,
    AlignBottom,
    DistributeHorizontal,
    DistributeVertical,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DeckOperation {
    InsertText {
        slide_id: Uuid,
        shape_id: Uuid,
        position: TextPosition,
        text: String,
    },
    DeleteText {
        slide_id: Uuid,
        shape_id: Uuid,
        span: TextSpan,
    },
    FormatText {
        slide_id: Uuid,
        shape_id: Uuid,
        span: TextSpan,
        patch: TextFormatPatch,
    },
    FormatParagraph {
        slide_id: Uuid,
        shape_id: Uuid,
        block_ids: Vec<Uuid>,
        patch: ParagraphFormatPatch,
    },
    AddSlide {
        after_id: Option<Uuid>,
        layout_id: Uuid,
    },
    /// Additive office-ai-proposal-1 variant: a fresh id later operations in
    /// the same atomic proposal may reference. Ordinary 22a add_slide is not
    /// changed.
    AddSlideWithId {
        slide_id: Uuid,
        after_id: Option<Uuid>,
        layout_id: Uuid,
    },
    DuplicateSlide {
        slide_id: Uuid,
    },
    DeleteSlides {
        slide_ids: Vec<Uuid>,
    },
    MoveSlides {
        slide_ids: Vec<Uuid>,
        before_id: Option<Uuid>,
    },
    HideSlides {
        slide_ids: Vec<Uuid>,
        hidden: bool,
    },
    SetNotes {
        slide_id: Uuid,
        text: String,
    },
    AddShape {
        slide_id: Uuid,
        shape: DeckShape,
    },
    PatchShapes {
        slide_id: Uuid,
        patches: Vec<DeckShapePatch>,
    },
    DeleteShapes {
        slide_id: Uuid,
        shape_ids: Vec<Uuid>,
    },
    ArrangeShapes {
        slide_id: Uuid,
        shape_ids: Vec<Uuid>,
        action: DeckArrangeAction,
    },
    GroupShapes {
        slide_id: Uuid,
        shape_ids: Vec<Uuid>,
    },
    UngroupShapes {
        slide_id: Uuid,
        group_id: Uuid,
    },
    ApplyLayout {
        slide_ids: Vec<Uuid>,
        layout_id: Uuid,
        preserve_content: bool,
    },
    UpsertMaster {
        theme: DeckTheme,
    },
    ApplyTheme {
        theme: DeckTheme,
        slide_ids: Option<Vec<Uuid>>,
        preserve_manual_formatting: bool,
    },
    SetTransition {
        slide_ids: Vec<Uuid>,
        transition: DeckTransition,
    },
    SetAnimation {
        slide_id: Uuid,
        shape_id: Uuid,
        animation_id: Uuid,
        animation: DeckAnimation,
    },
    RemoveAnimation {
        slide_id: Uuid,
        animation_id: Uuid,
    },
    CommentAdd {
        anchor: OfficeSelection,
        text: String,
        author: String,
    },
    CommentReply {
        comment_id: Uuid,
        text: String,
        author: String,
    },
    CommentResolve {
        comment_id: Uuid,
        resolved: bool,
    },
    CommentDelete {
        comment_id: Uuid,
    },
}

impl DeckOperation {
    pub fn validate(&self, current_revision: u64) -> Result<(), OfficeEditError> {
        match self {
            Self::InsertText {
                slide_id,
                shape_id,
                position,
                text,
            } => {
                require_slide_shape(*slide_id, *shape_id)?;
                if !position.is_valid() || text.encode_utf16().count() > 1_048_576 {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::DeleteText {
                slide_id,
                shape_id,
                span,
            } => {
                require_slide_shape(*slide_id, *shape_id)?;
                require_span(span, current_revision)?;
            }
            Self::FormatText {
                slide_id,
                shape_id,
                span,
                patch,
            } => {
                require_slide_shape(*slide_id, *shape_id)?;
                require_span(span, current_revision)?;
                if !patch.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::FormatParagraph {
                slide_id,
                shape_id,
                block_ids,
                patch,
            } => {
                require_slide_shape(*slide_id, *shape_id)?;
                require_ids(block_ids)?;
                if !patch.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::AddSlide { layout_id, .. } => {
                if layout_id.is_nil() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::AddSlideWithId {
                slide_id,
                layout_id,
                ..
            } => {
                if slide_id.is_nil() || layout_id.is_nil() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::DuplicateSlide { slide_id } => require_id(*slide_id)?,
            Self::DeleteSlides { slide_ids } | Self::HideSlides { slide_ids, .. } => {
                require_ids(slide_ids)?;
            }
            Self::MoveSlides { slide_ids, .. } => {
                require_ids(slide_ids)?;
            }
            Self::SetNotes { slide_id, text } => {
                require_id(*slide_id)?;
                if text.encode_utf16().count() > 1_048_576 {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::AddShape { slide_id, shape } => {
                require_id(*slide_id)?;
                if !shape.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::PatchShapes { slide_id, patches } => {
                require_id(*slide_id)?;
                if patches.is_empty() || patches.len() > 1_000 {
                    return Err(OfficeEditError::Invalid);
                }
                if !patches.iter().all(DeckShapePatch::is_valid) {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::DeleteShapes { slide_id, shape_ids } => {
                require_id(*slide_id)?;
                require_ids(shape_ids)?;
            }
            Self::ArrangeShapes {
                slide_id,
                shape_ids,
                ..
            } => {
                require_id(*slide_id)?;
                require_ids(shape_ids)?;
            }
            Self::GroupShapes {
                slide_id,
                shape_ids,
            } => {
                require_id(*slide_id)?;
                require_ids(shape_ids)?;
                if shape_ids.len() < 2 {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::UngroupShapes { slide_id, group_id } => {
                require_id(*slide_id)?;
                require_id(*group_id)?;
            }
            Self::ApplyLayout {
                slide_ids,
                layout_id,
                preserve_content,
            } => {
                require_ids(slide_ids)?;
                if layout_id.is_nil() || !preserve_content {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::UpsertMaster { theme } => {
                if !theme.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::ApplyTheme {
                theme,
                slide_ids,
                preserve_manual_formatting,
            } => {
                if !theme.is_valid() || !preserve_manual_formatting {
                    return Err(OfficeEditError::Invalid);
                }
                if let Some(slide_ids) = slide_ids {
                    require_ids(slide_ids)?;
                }
            }
            Self::SetTransition {
                slide_ids,
                transition,
            } => {
                require_ids(slide_ids)?;
                if !transition.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::SetAnimation {
                slide_id,
                shape_id,
                animation_id,
                animation,
            } => {
                require_slide_shape(*slide_id, *shape_id)?;
                require_id(*animation_id)?;
                if !animation.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::RemoveAnimation {
                slide_id,
                animation_id,
            } => {
                require_id(*slide_id)?;
                require_id(*animation_id)?;
            }
            Self::CommentAdd { anchor, text, author } => {
                if !matches!(anchor, OfficeSelection::Deck { .. })
                    || !anchor.is_valid()
                    || text.encode_utf16().count() > 16_384
                {
                    return Err(OfficeEditError::Invalid);
                }
                require_author(author)?;
            }
            Self::CommentReply {
                comment_id,
                text,
                author,
            } => {
                require_id(*comment_id)?;
                if text.encode_utf16().count() > 16_384 {
                    return Err(OfficeEditError::Invalid);
                }
                require_author(author)?;
            }
            Self::CommentResolve { comment_id, .. } | Self::CommentDelete { comment_id } => {
                require_id(*comment_id)?;
            }
        }
        Ok(())
    }
}

fn require_id(id: Uuid) -> Result<(), OfficeEditError> {
    if id.is_nil() {
        Err(OfficeEditError::Invalid)
    } else {
        Ok(())
    }
}

fn require_slide_shape(slide_id: Uuid, shape_id: Uuid) -> Result<(), OfficeEditError> {
    require_id(slide_id)?;
    require_id(shape_id)
}

fn require_ids(ids: &[Uuid]) -> Result<(), OfficeEditError> {
    if !ids.is_empty() && ids.len() <= 1_000 && ids.iter().all(|id| !id.is_nil()) {
        Ok(())
    } else {
        Err(OfficeEditError::Invalid)
    }
}

fn require_span(span: &TextSpan, revision: u64) -> Result<(), OfficeEditError> {
    if span.is_current(revision) {
        Ok(())
    } else {
        Err(OfficeEditError::Changed)
    }
}

fn require_author(author: &str) -> Result<(), OfficeEditError> {
    if !author.is_empty() && author.chars().count() <= 128 && !author.chars().any(char::is_control)
    {
        Ok(())
    } else {
        Err(OfficeEditError::Invalid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comment_anchor_must_be_deck_selection() {
        let slide = Uuid::new_v4();
        let operation = DeckOperation::CommentAdd {
            anchor: OfficeSelection::Deck {
                slide_ids: vec![slide],
                shape_ids: Vec::new(),
                text_span: None,
            },
            text: "note".to_string(),
            author: "Local".to_string(),
        };
        assert!(operation.validate(1).is_ok());
    }
}
