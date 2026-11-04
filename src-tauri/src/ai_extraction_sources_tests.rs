//! Native source-binding tests for Step 17d T2 (decisions D1/D2).

use std::collections::HashMap;

use uuid::Uuid;

use super::{revalidate_sources, resolve_sources, ExtractionSourceResolver, SourceCandidate};
use crate::ai_extraction_requests::ExtractionRequest;
use crate::ai_extraction_types::{ExtractionKind, ExtractionLocale};
use crate::local_ai_types::{AiInputKind, AiInputRef};
use crate::pdf_types::PdfSourceIdentity;
use fs_service::SourceStamp;

fn stamp(ticks: &str) -> SourceStamp {
    SourceStamp {
        path_key: "c:\\scans\\letter.pdf".to_string(),
        volume_id: "1a2b3c4d".to_string(),
        file_id: "0011223344556677".to_string(),
        modified_ticks: ticks.to_string(),
        size_bytes: 2048,
    }
}

struct FakeResolver {
    candidates: HashMap<Uuid, SourceCandidate>,
    current: HashMap<Uuid, PdfSourceIdentity>,
}

impl ExtractionSourceResolver for FakeResolver {
    fn resolve(&self, input: &AiInputRef) -> Result<SourceCandidate, String> {
        self.candidates
            .get(&input.id)
            .cloned()
            .ok_or_else(|| "ai_extract.unsupported".to_string())
    }

    fn current_identity(&self, source_id: &Uuid) -> Result<PdfSourceIdentity, String> {
        self.current
            .get(source_id)
            .cloned()
            .ok_or_else(|| "ai_extract.changed".to_string())
    }
}

fn input(id: Uuid) -> AiInputRef {
    AiInputRef {
        kind: AiInputKind::Document,
        id,
        expected_revision: 1,
    }
}

fn request(inputs: Vec<AiInputRef>) -> ExtractionRequest {
    ExtractionRequest {
        inputs,
        kind: ExtractionKind::Document,
        locale: ExtractionLocale::En,
        ocr_language: "auto".to_string(),
        request_revision: 1,
    }
}

fn candidate(input: AiInputRef, pages: u32) -> SourceCandidate {
    SourceCandidate {
        id: Uuid::new_v4(),
        input,
        identity: PdfSourceIdentity::Disk { stamp: stamp("100") },
        display_name: "letter.pdf".to_string(),
        page_count: pages,
        sensitive: false,
        online_only: false,
        byte_len: 2048,
    }
}

#[test]
fn source_changed_aborts() {
    let input = input(Uuid::new_v4());
    let candidate = candidate(input.clone(), 1);
    let id = candidate.id;
    let resolver = FakeResolver {
        candidates: HashMap::from([(input.id, candidate.clone())]),
        current: HashMap::from([
            (id, PdfSourceIdentity::Disk { stamp: stamp("100") }),
            (
                Uuid::new_v4(),
                PdfSourceIdentity::Disk { stamp: stamp("101") },
            ),
        ]),
    };
    let resolved = resolve_sources(&request(vec![input]), &resolver).unwrap();
    assert_eq!(resolved.pages, 1);
    assert!(revalidate_sources(&resolved.sources, &resolver).is_ok());

    // The same source now has a different stamp: zero sources continue.
    let changed = FakeResolver {
        candidates: resolver.candidates,
        current: HashMap::from([(id, PdfSourceIdentity::Disk { stamp: stamp("101") })]),
    };
    assert_eq!(
        revalidate_sources(&resolved.sources, &changed)
            .err()
            .as_deref(),
        Some("ai_extract.changed")
    );
}

#[test]
fn online_only_refused() {
    let input = input(Uuid::new_v4());
    let mut candidate = candidate(input.clone(), 1);
    candidate.online_only = true;
    let resolver = FakeResolver {
        candidates: HashMap::from([(input.id, candidate)]),
        current: HashMap::new(),
    };
    assert_eq!(
        resolve_sources(&request(vec![input]), &resolver)
            .err()
            .as_deref(),
        Some("ai_extract.unsupported")
    );
}

#[test]
fn batch_page_and_byte_limits() {
    let first = input(Uuid::new_v4());
    let second = input(Uuid::new_v4());
    let one = candidate(first.clone(), 150);
    let two = candidate(second.clone(), 60);
    let resolver = FakeResolver {
        candidates: HashMap::from([(first.id, one), (second.id, two)]),
        current: HashMap::new(),
    };
    assert_eq!(
        resolve_sources(&request(vec![first, second]), &resolver)
            .err()
            .as_deref(),
        Some("ai_extract.too_large")
    );
}

#[test]
fn sensitive_snapshot_cannot_downgrade() {
    let input = input(Uuid::new_v4());
    let mut candidate = candidate(input.clone(), 1);
    candidate.identity = PdfSourceIdentity::Snapshot {
        document_id: "locked-doc".to_string(),
        revision: 2,
        content_id: Uuid::new_v4(),
        sensitive: true,
    };
    candidate.sensitive = false;
    let resolver = FakeResolver {
        candidates: HashMap::from([(input.id, candidate)]),
        current: HashMap::new(),
    };
    assert_eq!(
        resolve_sources(&request(vec![input]), &resolver)
            .err()
            .as_deref(),
        Some("ai_extract.unsupported")
    );
}
