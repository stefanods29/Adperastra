import type { HomeSectionProvider, ShellItem } from "../shell/types";
import type { HomeSectionRegistry } from "../shell/registries";
import { listActivity, type ActivityEvent } from "../services/smartViews";

/** Home registration for Recent activity (Step 11b U5, decision 8). The
 * provider only reads the bounded local list; it never records anything. */

export interface ActivityProviderDeps {
  openPath(path: string): Promise<void>;
  load?(): Promise<readonly ActivityEvent[]>;
}

function displayName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

function activityItem(event: ActivityEvent): ShellItem {
  const target = event.dest_path ?? event.path;
  return {
    id: `activity:${event.id}`,
    kind: "file",
    label: displayName(target),
    detail: target,
    target_id: target,
    icon_id: "file",
  };
}

export function registerActivityHome(
  registry: HomeSectionRegistry,
  deps: ActivityProviderDeps,
): () => void {
  const provider: HomeSectionProvider = {
    id: "recent_activity",
    label_key: "views.activity",
    load: async (limit, signal) => {
      const events = deps.load
        ? await deps.load()
        : (await listActivity(null)).events;
      if (signal.aborted) return [];
      return events
        .slice(0, Math.max(1, Math.min(limit, 100)))
        .map(activityItem);
    },
    activate: async (item) => {
      await deps.openPath(item.target_id);
    },
  };
  return registry.register(provider);
}
