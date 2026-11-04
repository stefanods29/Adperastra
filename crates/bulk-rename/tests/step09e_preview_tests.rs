use bulk_rename::{
    collisions::mark_collisions,
    operations::TemplateValues,
    preview::{compute_rows, plan_page, PreviewInput},
    types::*,
};
use fs_service::SourceStamp;
use uuid::Uuid;

fn inputs() -> Vec<PreviewInput> {
    ["a.txt", "b.txt"]
        .iter()
        .enumerate()
        .map(|(i, name)| PreviewInput {
            source: SourceStamp {
                path_key: format!(r"C:\fixture\{name}"),
                volume_id: "00000001".into(),
                file_id: format!("{i:016x}"),
                modified_ticks: "133000000000000001".into(),
                size_bytes: 1,
            },
            old_name: (*name).into(),
            is_directory: false,
            templates: TemplateValues::default(),
        })
        .collect()
}
fn request(names: &[&str]) -> RenameRequest {
    RenameRequest {
        paths: vec![r"C:\fixture\a.txt".into(), r"C:\fixture\b.txt".into()],
        operations: vec![RenameOperation::ExplicitNames {
            names: names
                .iter()
                .enumerate()
                .map(|(i, name)| ExplicitRenameName {
                    input_index: i as u32,
                    new_name: (*name).into(),
                })
                .collect(),
        }],
        include_extension: false,
        excluded_indices: vec![],
        date_zone: DateZone::Utc,
        request_revision: 4,
    }
}
fn rows(names: &[&str]) -> Vec<RenamePreviewRow> {
    let mut rows = compute_rows(&request(names), &inputs(), || false).unwrap();
    mark_collisions(
        &mut rows,
        &["parent".into(), "parent".into()],
        &[
            ("parent".into(), "a.txt".into()),
            ("parent".into(), "b.txt".into()),
        ],
        |a, b| Ok(a.eq_ignore_ascii_case(b)),
    )
    .unwrap();
    rows
}
#[test]
fn a_b_swap_ready() {
    assert!(rows(&["b.txt", "a.txt"])
        .iter()
        .all(|r| r.status == RenameStatus::Ready));
}
#[test]
fn duplicate_final_name_conflict() {
    assert!(rows(&["same.txt", "SAME.txt"])
        .iter()
        .all(|r| r.status == RenameStatus::Conflict));
}
#[test]
fn nul_invalid() {
    let rows = rows(&["NUL", "c.txt"]);
    assert_eq!(rows[0].status, RenameStatus::Invalid);
    assert_eq!(rows[0].new_name, "NUL");
}
#[test]
fn missing_date_taken_invalid() {
    let mut r = request(&["x", "y"]);
    r.operations = vec![RenameOperation::Template {
        pattern: "{date_taken}".into(),
    }];
    let rows = compute_rows(&r, &inputs(), || false).unwrap();
    assert_eq!(rows[0].reason.as_deref(), Some("rename.metadata_missing"));
}
#[test]
fn excluded_row_not_numbered() {
    let mut r = request(&["x", "y"]);
    r.excluded_indices = vec![0];
    r.operations = vec![RenameOperation::Number {
        start: 1,
        step: 1,
        padding: 3,
        position: NumberPosition::Prefix,
        separator: "".into(),
    }];
    let rows = compute_rows(&r, &inputs(), || false).unwrap();
    assert_eq!(rows[0].status, RenameStatus::Excluded);
    assert_eq!(rows[1].new_name, "001b.txt");
}
#[test]
fn excluded_source_is_not_vacated() {
    let mut r = request(&["b.txt", "a.txt"]);
    r.excluded_indices = vec![1];
    r.operations = vec![RenameOperation::ExplicitNames {
        names: vec![ExplicitRenameName {
            input_index: 0,
            new_name: "b.txt".into(),
        }],
    }];
    let mut rows = compute_rows(&r, &inputs(), || false).unwrap();
    mark_collisions(
        &mut rows,
        &["p".into(), "p".into()],
        &[("p".into(), "b.txt".into())],
        |a, b| Ok(a == b),
    )
    .unwrap();
    assert_eq!(rows[0].status, RenameStatus::Conflict);
}
#[test]
fn page_counts_cover_full_plan() {
    let rows = rows(&["x.txt", "y.txt"]);
    let page = plan_page(Uuid::new_v4(), 4, &rows, 1, 300, Uuid::new_v4()).unwrap();
    assert_eq!((page.total, page.ready, page.rows.len()), (2, 2, 1));
    assert!(page.next_cursor.is_none());
}
#[test]
fn cancelled_preview_returns_no_partial_plan() {
    assert_eq!(
        compute_rows(&request(&["x", "y"]), &inputs(), || true)
            .err()
            .as_deref(),
        Some("rename.cancelled")
    );
}
