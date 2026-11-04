import i18n from "../i18n";
import type { NavigationItem, ShellItem } from "../shell/types";
import type { HomeSectionProvider } from "../shell/types";
import type { HomeSectionRegistry, NavigationRegistry } from "../shell/registries";
import type { SearchQuery, SearchResult } from "../services/search";
import {
  INDEXED_VIEW_LABEL_KEYS,
  type EnabledViews,
  type IndexedView,
  type SmartFolder,
} from "../services/smartViews";
import type { TagCatalog } from "../services/tags";

/** Static Home and navigation registrations for Step 11b (U5). Providers are
 * trusted code; their data loads through the normal search service. */

export interface OpenActions {
  openPath(path: string): Promise<void>;
  openSmartFolder?(id: string): Promise<void>;
}

export interface TaggedFilesDeps extends OpenActions {
  getCatalog(): Promise<TagCatalog>;
  taggedFiles(tagIds: readonly string[], signal: AbortSignal): Promise<readonly SearchResult[]>;
}

export interface SmartFolderDeps extends OpenActions {
  listFolders(): Promise<SmartFolder[]>;
}

export interface TagCatalogDeps {
  getCatalog(): Promise<TagCatalog>;
}

/** The one query every tagged-files entry point uses: an OR over tag ids. */
export function taggedFilesQuery(tagIds: readonly string[]): SearchQuery {
  return {
    mode: "filters",
    text: "",
    roots: [],
    filter: { kind: "tags", tag_ids: [...tagIds], match: "any" },
    regex_scope: "name",
    match_case: false,
    sort: { key: "modified", direction: "descending" },
  };
}

function resultItem(result: SearchResult): ShellItem {
  const folder = result.item.kind === "folder";
  return {
    // ShellItem ids are capped at 128 characters; the stable identity is
    // enough and avoids putting a long display path into the id.
    id: `tagged:${result.key.volume_id}:${result.key.file_id}`,
    kind: folder ? "folder" : "file",
    label: result.item.name,
    detail: result.item.path,
    target_id: result.item.path,
    icon_id: folder ? "folder" : "file",
  };
}

export function registerTaggedFilesHome(
  registry: HomeSectionRegistry,
  deps: TaggedFilesDeps,
): () => void {
  const provider: HomeSectionProvider = {
    id: "tagged_files",
    label_key: "views.taggedHome",
    load: async (limit, signal) => {
      const catalog = await deps.getCatalog();
      if (signal.aborted) return [];
      const tagIds = catalog.tags.slice(0, 100).map((tag) => tag.id);
      if (tagIds.length === 0) return [];
      const results = await deps.taggedFiles(tagIds, signal);
      if (signal.aborted) return [];
      return results.slice(0, Math.max(1, Math.min(limit, 100))).map(resultItem);
    },
    activate: async (item) => {
      await deps.openPath(item.target_id);
    },
  };
  return registry.register(provider);
}

export function registerSmartFoldersHome(
  registry: HomeSectionRegistry,
  deps: SmartFolderDeps,
): () => void {
  const provider: HomeSectionProvider = {
    id: "smart_folders",
    label_key: "smartFolders.title",
    load: async (limit, signal) => {
      const folders = await deps.listFolders();
      if (signal.aborted) return [];
      return folders.slice(0, Math.max(1, Math.min(limit, 100))).map((folder) => ({
        id: `smartfolder:${folder.id}`,
        kind: "action" as const,
        label: folder.name,
        target_id: `smartfolder:${folder.id}`,
        icon_id: "search",
      }));
    },
    activate: async (item) => {
      const id = item.target_id.slice("smartfolder:".length);
      await deps.openSmartFolder?.(id);
    },
  };
  return registry.register(provider);
}

export function registerTagNavigation(
  registry: NavigationRegistry,
  deps: TagCatalogDeps,
): () => void {
  return registry.registerSection("tags", "tags.title", async (signal) => {
    const catalog = await deps.getCatalog();
    if (signal.aborted) return [];
    // The Step 10e navigation bound is 200 user-visible custom items per
    // section; the catalog itself stays complete in Manage tags.
    const items: NavigationItem[] = catalog.tags.slice(0, 200).map((tag) => ({
      // Step 10e requires the `builtin:` prefix for a builtin navigation
      // item; the target id remains the stable tag address.
      id: `builtin:tag:${tag.id}`,
      kind: "builtin",
      target_id: `tag:${tag.id}`,
      display_label: tag.name,
      visible: true,
      section_id: "tags",
    }));
    return items;
  });
}

export function registerViewsNavigation(
  registry: NavigationRegistry,
  enabled: EnabledViews,
): () => void {
  const definitions: readonly { view: IndexedView; key: keyof EnabledViews }[] = [
    { view: "timeline", key: "timeline" },
    { view: "calendar", key: "calendar" },
    { view: "by_kind", key: "by_kind" },
    { view: "recent_activity", key: "recent_activity" },
    { view: "map", key: "map" },
  ];
  return registry.registerSection("views", "views.title", async (signal) => {
    if (signal.aborted) return [];
    return definitions
      .filter((definition) => enabled[definition.key])
      .map((definition) => ({
        id: `builtin:view:${definition.view}`,
        kind: "builtin" as const,
        target_id: `view:${definition.view}`,
        display_label: i18n.t(INDEXED_VIEW_LABEL_KEYS[definition.view]),
        visible: true,
        section_id: "views",
      }));
  });
}
