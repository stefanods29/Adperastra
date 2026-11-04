//! Node-page bounds (Step 11c T2).
//!
//! A page holds at most 256 nodes and stays under 768 KiB on the wire even
//! when the folder holds very long Windows paths. The page is cut at a node
//! boundary; the caller receives the last node id as the next cursor, so a
//! short page is never presented as the complete folder.

use ::storage_scan::{StorageNode, MAX_PAGE_BYTES, MAX_PAGE_NODES};

/// An estimate of the UTF-8 JSON bytes of one node, including fixed field
/// names, UUIDs and the identity key.
pub fn node_wire_bytes(node: &StorageNode) -> usize {
    let identity = node.key.volume_id.len()
        + node.key.file_id.len()
        + node.key.path_key.len()
        + 64;
    node.path.len()
        + node.name.len()
        + identity
        + node.id.len()
        + node.parent_id.as_deref().map_or(0, str::len)
        + 320
}

/// Cut a loaded page at the byte budget. Returns the kept nodes and whether
/// the page was shortened.
pub fn bound_page(nodes: Vec<StorageNode>) -> (Vec<StorageNode>, bool) {
    let mut kept = Vec::new();
    let mut bytes = 0usize;
    let mut shortened = false;
    for node in nodes {
        let next = node_wire_bytes(&node);
        if kept.len() >= MAX_PAGE_NODES || (!kept.is_empty() && bytes + next > MAX_PAGE_BYTES)
        {
            shortened = true;
            break;
        }
        bytes += next;
        kept.push(node);
    }
    (kept, shortened)
}

#[cfg(test)]
mod tests {
    use super::{bound_page, node_wire_bytes};
    use fs_service::FileIdentityKey;
    use ::storage_scan::{Coverage, StorageNode, StorageNodeKind, MAX_PAGE_BYTES};

    fn node(index: usize, path_len: usize) -> StorageNode {
        StorageNode {
            id: format!("00000000-0000-4000-8000-{index:012}"),
            parent_id: None,
            key: FileIdentityKey {
                volume_id: "00000000".to_string(),
                file_id: "0000000000000000".to_string(),
                path_key: "c:\\".to_string(),
                stable: false,
            },
            path: format!("C:\\{}", "a".repeat(path_len)),
            name: "a".repeat(path_len),
            kind: StorageNodeKind::File,
            logical_bytes: 1,
            allocated_bytes: Some(1),
            item_count: 0,
            online_only: false,
            coverage: Coverage::Complete,
            children_count: 0,
        }
    }

    #[test]
    fn a_page_never_exceeds_256_nodes() {
        let nodes: Vec<_> = (0..300).map(|index| node(index, 4)).collect();
        let (kept, shortened) = bound_page(nodes);
        assert_eq!(kept.len(), 256);
        assert!(shortened);
    }

    #[test]
    fn long_paths_cut_the_page_at_a_node_boundary() {
        let nodes: Vec<_> = (0..40).map(|index| node(index, 30_000)).collect();
        let (kept, shortened) = bound_page(nodes);
        assert!(shortened);
        assert!(kept.len() < 40);
        let bytes: usize = kept.iter().map(node_wire_bytes).sum();
        assert!(bytes <= MAX_PAGE_BYTES);
    }
}
