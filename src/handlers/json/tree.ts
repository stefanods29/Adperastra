import type { JsonNodeInfo } from "../../services/jsonView";

/** The JSON tree's visible rows (Step 06f D9). Pure, unit-tested. */

/** One page of a container's children, by page number. */
export type ContainerPages = ReadonlyMap<number, readonly JsonNodeInfo[]>;
/** Every loaded container, by node id. */
export type JsonPages = ReadonlyMap<number, ContainerPages>;

export interface JsonRow {
  /** Unique row key: `n<id>` for a node, `m<id>` for a Show more row. */
  key: string;
  kind: "node" | "more";
  depth: number;
  node: JsonNodeInfo | null;
  /** The container a Show more row belongs to. */
  parentId: number | null;
  /** Children still to load after the loaded ones. */
  remaining: number;
}

function isContainer(node: JsonNodeInfo): boolean {
  return node.kind === "object" || node.kind === "array";
}

/** The loaded children of a container, in order (contiguous pages only). */
export function loadedChildren(pages: JsonPages, id: number): JsonNodeInfo[] {
  const container = pages.get(id);
  if (!container) return [];
  const rows: JsonNodeInfo[] = [];
  for (let page = 0; ; page += 1) {
    const found = container.get(page);
    if (!found) break;
    rows.push(...found);
  }
  return rows;
}

/** Rows in display order: open containers show their loaded children, and a
 * partly loaded container ends with a Show more row. The root is always
 * open. */
export function flattenTree(
  root: JsonNodeInfo | null,
  expanded: ReadonlySet<number>,
  pages: JsonPages,
): JsonRow[] {
  if (!root) return [];
  const rows: JsonRow[] = [];
  const visit = (node: JsonNodeInfo, depth: number) => {
    rows.push({ key: `n${node.id}`, kind: "node", depth, node, parentId: null, remaining: 0 });
    if (!isContainer(node)) return;
    if (depth > 0 && !expanded.has(node.id)) return;
    const children = loadedChildren(pages, node.id);
    for (const child of children) visit(child, depth + 1);
    if (node.child_count > children.length) {
      rows.push({
        key: `m${node.id}`,
        kind: "more",
        depth: depth + 1,
        node: null,
        parentId: node.id,
        remaining: node.child_count - children.length,
      });
    }
  };
  visit(root, 0);
  return rows;
}
