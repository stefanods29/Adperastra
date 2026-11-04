import { isAbsolutePath } from "../documents/types";
import type { TabState } from "../services/tabs";
import { activeSplitLeaf, isSplitTab, viewIdentityOf } from "../services/splitViews";
import type { SplitSide } from "../services/splitViews";
import { validateTransferActions } from "./TransferRegistry";
import type { TransferAction, TransferEnvelope, TransferTarget } from "./types";

/** Where a drop onto a split tab goes (Step 09i T5, Decisions 4 and 8).
 *
 * A split is one tab, so a drop on the tab bar or on the split surface has
 * exactly one meaning: the *active* leaf receives it. The other side is
 * untouched. A content drop is offered only when that leaf's editor
 * registered a 09c transfer target; nothing here assumes an editable
 * target exists, and a placeholder leaf (missing file or unknown handler)
 * refuses content instead of accepting it silently. */

export type SplitDrop =
  | { kind: "files"; paths: readonly string[] }
  | { kind: "content"; envelope: TransferEnvelope };

export interface SplitDropHost {
  /** The target this leaf's editor registered with the 09c registry, or
   * `null` when it has not registered one. */
  targetFor(viewId: string): TransferTarget | null;
  /** The 03b/09c file-drop pipeline for exactly one leaf. */
  dropFiles(viewId: string, paths: readonly string[]): Promise<void>;
}

export interface SplitDropRoute {
  tab_id: string;
  /** The receiving view: the active leaf of a split, or the tab's own view
   * identity for a normal tab. */
  view_id: string;
  side: SplitSide;
}

export type SplitDropOutcome =
  | { accepted: true; route: SplitDropRoute; target: TransferTarget | null; actions: readonly TransferAction[] }
  | { accepted: false; code: string; route: SplitDropRoute | null };

/** The route a drop on this tab would take. */
export function dropRouteOf(tab: TabState): SplitDropRoute {
  if (isSplitTab(tab)) {
    const side = tab.split.active_side;
    const leaf = side === "first" ? tab.split.first : tab.split.second;
    return { tab_id: tab.id, view_id: leaf.view_id, side };
  }
  return { tab_id: tab.id, view_id: viewIdentityOf(tab), side: "first" };
}

/** Basic path shape only: the receiving 03b/09c pipeline owns the open,
 * copy and move limits for its destination. */
function validPaths(paths: readonly string[]): boolean {
  if (paths.length === 0) return false;
  return paths.every((path) => isAbsolutePath(path));
}

/** Route one drop to the active leaf.
 *
 * Files always go to the normal file-drop pipeline (preview, conflict,
 * queue); they are never turned into an editor insertion here. Content is
 * resolved against the active leaf only: no target, or a target that
 * offers no action for this envelope, means no drop — the caller shows the
 * translated reason instead of guessing. The returned actions are the 09c
 * negotiation result; accepting one stays with the existing transfer
 * pipeline (one transaction, one revision). */
export async function dropIntoActiveLeaf(
  tab: TabState,
  drop: SplitDrop,
  host: SplitDropHost,
): Promise<SplitDropOutcome> {
  const route = dropRouteOf(tab);
  if (drop.kind === "files") {
    if (!validPaths(drop.paths)) return { accepted: false, code: "transfer.invalid", route };
    await host.dropFiles(route.view_id, drop.paths);
    return { accepted: true, route, target: null, actions: [] };
  }
  const leaf = activeSplitLeaf(tab);
  const missing = leaf ? leaf.missing : tab.missing;
  if (missing) return { accepted: false, code: "transfer.unsupported", route };
  const target = host.targetFor(route.view_id);
  if (!target) return { accepted: false, code: "transfer.unsupported", route };
  // A target is authority only for the kinds it registered. The actions
  // are re-validated with the 09c registry rules, exactly like a registry
  // describe call, so a stale or malformed offer is never shown.
  if (!target.accepted_kinds.includes(drop.envelope.payload.kind)) {
    return { accepted: false, code: "transfer.unsupported", route };
  }
  let described: readonly TransferAction[];
  try {
    described = target.describe(drop.envelope);
  } catch {
    return { accepted: false, code: "transfer.invalid", route };
  }
  const actions = validateTransferActions(described);
  if (!actions) return { accepted: false, code: "transfer.invalid", route };
  if (actions.length === 0) return { accepted: false, code: "transfer.unsupported", route };
  return { accepted: true, route, target, actions };
}
