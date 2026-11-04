/** Built-in Home section providers (Step 10e T3).
 *
 * Providers are static, trusted app code registered in `HomeSectionRegistry`.
 * A provider loads bounded runtime rows and routes activation through the
 * normal Explorer open pipeline; nothing here is persisted or imported (D4).
 */
import { isTauriRuntime } from "../services/settings";
import {
  displayPath,
  listFavoriteItems,
  listKnownFolders,
  listRecentItems,
  type RecentItem,
} from "../services/explorer";
import { listSavedGroups } from "../services/savedGroups";
import {
  HOME_SECTION_LABEL_KEYS,
  type HomeSectionRegistry,
} from "./registries";
import {
  DEFAULT_HOME_LIMIT,
  MAX_HOME_LIMIT,
  MAX_HOME_SECTIONS,
  type HomeCustomization,
  type HomeSectionLayout,
  type HomeSectionProvider,
  type ShellItem,
} from "./types";

export interface HomeProviderHost {
  openFolder(path: string): void | Promise<void>;
  openFile?(path: string): void | Promise<void>;
  openSavedGroup?(id: string): Promise<void>;
}

function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function stableItemId(kind: ShellItem["kind"], targetId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < targetId.length; index += 1) {
    hash = Math.imul(hash ^ targetId.charCodeAt(index), 0x01000193);
  }
  return `${kind}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function shellItem(
  kind: ShellItem["kind"],
  label: string,
  targetId: string,
  iconId: string,
  detail?: string,
): ShellItem {
  return {
    id: stableItemId(kind, targetId),
    kind,
    label: Array.from(label).slice(0, 512).join(""),
    ...(detail === undefined ? {} : { detail: Array.from(detail).slice(0, 512).join("") }),
    target_id: targetId,
    icon_id: iconId,
  };
}

function recentItem(item: RecentItem): ShellItem {
  const kind = item.kind === "folder" ? "folder" : "file";
  return shellItem(kind, item.name, item.path, kind === "folder" ? "folder" : "file");
}

function knownFoldersProvider(host: HomeProviderHost): HomeSectionProvider {
  return {
    id: "quick_access",
    label_key: "shellCustom.quickAccess",
    async load(limit, signal) {
      if (!isTauriRuntime() || aborted(signal)) return [];
      const folders = await listKnownFolders();
      if (aborted(signal)) return [];
      return folders
        .filter((folder) => folder.id !== "home")
        .slice(0, limit)
        .map((folder) => shellItem("folder", folder.name, folder.path, "folder", displayPath(folder.path)));
    },
    async activate(item) {
      await host.openFolder(item.target_id);
    },
  };
}

function recentProvider(host: HomeProviderHost): HomeSectionProvider {
  return {
    id: "recent",
    label_key: "shellCustom.recent",
    async load(limit, signal) {
      if (!isTauriRuntime() || aborted(signal)) return [];
      const items = await listRecentItems(limit);
      if (aborted(signal)) return [];
      return items.slice(0, limit).map(recentItem);
    },
    async activate(item) {
      if (item.kind === "folder") await host.openFolder(item.target_id);
      else await host.openFile?.(item.target_id);
    },
  };
}

function favoritesProvider(host: HomeProviderHost): HomeSectionProvider {
  return {
    id: "favorites",
    label_key: "shellCustom.favorites",
    async load(limit, signal) {
      if (!isTauriRuntime() || aborted(signal)) return [];
      const items = await listFavoriteItems();
      if (aborted(signal)) return [];
      return items.slice(0, limit).map(recentItem);
    },
    async activate(item) {
      if (item.kind === "folder") await host.openFolder(item.target_id);
      else await host.openFile?.(item.target_id);
    },
  };
}

function savedGroupsProvider(host: HomeProviderHost): HomeSectionProvider {
  return {
    id: "saved_groups",
    label_key: "shellCustom.savedGroups",
    async load(limit, signal) {
      if (!isTauriRuntime() || aborted(signal)) return [];
      const catalog = await listSavedGroups();
      if (aborted(signal)) return [];
      return catalog.groups.slice(0, limit).map((group) =>
        shellItem("action", group.name, group.id, "layers", String(group.tabs.length)),
      );
    },
    async activate(item) {
      await host.openSavedGroup?.(item.target_id);
    },
  };
}

/** The providers that have a real implementation today. Later steps register
 * `storage_summary`, `pinned_searches`, `recent_conversions`, tagged files and
 * similar through the same registry, without changing the Home root. */
export function createBuiltInHomeProviders(host: HomeProviderHost): HomeSectionProvider[] {
  return [knownFoldersProvider(host), recentProvider(host), favoritesProvider(host), savedGroupsProvider(host)];
}

export function registerBuiltInHomeProviders(registry: HomeSectionRegistry, host: HomeProviderHost): () => void {
  const unsubscribes = createBuiltInHomeProviders(host).map((provider) => registry.register(provider));
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

export function sectionLabelKey(id: string): string {
  return HOME_SECTION_LABEL_KEYS[id] ?? "toolbarCustom.missing";
}

/** Stored sections first; a newly registered provider becomes a hidden,
 * disabled default instead of requiring a Home root change. */
export function mergeHomeLayout(
  layout: HomeCustomization,
  providers: readonly HomeSectionProvider[],
): HomeCustomization {
  const known = new Set(layout.sections.map((section) => section.id));
  const room = Math.max(0, MAX_HOME_SECTIONS - layout.sections.length);
  const added: HomeSectionLayout[] = providers
    .filter((provider) => !known.has(provider.id))
    .slice(0, room)
    .map((provider) => ({
      id: provider.id,
      visible: false,
      collapsed: false,
      size: "medium",
      limit: DEFAULT_HOME_LIMIT,
    }));
  return { sections: [...layout.sections.map((section) => ({ ...section })), ...added] };
}

/** 1-100: a provider is never asked for an unbounded list (D4). */
export function safeHomeLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.min(MAX_HOME_LIMIT, Math.max(1, Math.round(limit))) : DEFAULT_HOME_LIMIT;
}
