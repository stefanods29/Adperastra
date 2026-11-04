//! Step 05b: Column view is the ninth view mode.

use fs_service::{is_view_mode, FolderViews, VIEW_MODES};

#[test]
fn columns_is_the_ninth_view_mode() {
    assert_eq!(VIEW_MODES.len(), 9);
    assert_eq!(VIEW_MODES[8], "columns");
    assert!(is_view_mode("columns"));
    assert!(!is_view_mode("Columns"));
    let mut views = FolderViews::default();
    assert!(views.set(r"C:\A", "columns", 1));
    assert_eq!(views.get(r"c:\a\"), Some("columns"));
}
