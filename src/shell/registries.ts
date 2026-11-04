/** Runtime provider registries and the built-in shell defaults (Step 10e).
 *
 * Registries are trusted, static app code: registering a provider is a code
 * change, never something an imported setup file can do. The default layout
 * values below keep the Figma order of Home, the existing navigation pane and
 * the Explorer status bar (D4-D6).
 */
import type {
  HomeCustomization,
  HomeSectionProvider,
  MenuCustomization,
  NavigationCustomization,
  NavigationItem,
  ShellCustomization,
  StatusCustomization,
  StatusFieldProvider,
  StatusKind,
  StatusValue,
} from "./types";
import { STATUS_KINDS, isRecord } from "./types";
import {
  validateHomeCustomization,
  validateMenuCustomizations,
  validateNavigationCustomization,
  validateShellCustomization,
  validateStatusCustomization,
  validateStatusValue,
} from "./validation";

// ---------------------------------------------------------------------------
// Home sections
// ---------------------------------------------------------------------------

export class HomeSectionRegistry {
  private providers = new Map<string, HomeSectionProvider>();

  /** Register once; a duplicate id is a programming error, not user data. */
  register(provider: HomeSectionProvider): () => void {
    if (this.providers.has(provider.id)) throw new Error(`duplicate home section id: ${provider.id}`);
    this.providers.set(provider.id, provider);
    return () => {
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id);
    };
  }

  list(): readonly HomeSectionProvider[] {
    return [...this.providers.values()];
  }

  get(id: string): HomeSectionProvider | null {
    return this.providers.get(id) ?? null;
  }
}

export const homeSections = new HomeSectionRegistry();

/** IDs the first Home editor knows; later steps register more (11b). */
export const HOME_SECTION_IDS = [
  "quick_access",
  "recent",
  "favorites",
  "saved_groups",
  "storage_summary",
  "pinned_searches",
  "recent_conversions",
] as const;

export const HOME_SECTION_LABEL_KEYS: Readonly<Record<string, string>> = {
  quick_access: "shellCustom.quickAccess",
  recent: "shellCustom.recent",
  favorites: "shellCustom.favorites",
  saved_groups: "shellCustom.savedGroups",
  storage_summary: "shellCustom.storage",
  pinned_searches: "shellCustom.searches",
  recent_conversions: "shellCustom.conversions",
};

/** Quick access, Recent, Favorites: the visible order of the design. */
export function defaultHomeCustomization(): HomeCustomization {
  return {
    sections: ["quick_access", "recent", "favorites"].map((id) => ({
      id,
      visible: true,
      collapsed: false,
      size: "small" as const,
      limit: 12,
    })),
  };
}

// ---------------------------------------------------------------------------
// Navigation sections
// ---------------------------------------------------------------------------

export interface NavigationSectionSource {
  readonly labelKey: string;
  load(signal: AbortSignal): Promise<readonly NavigationItem[]>;
}

export class NavigationRegistry {
  private sections = new Map<string, NavigationSectionSource>();

  registerSection(id: string, labelKey: string, load: NavigationSectionSource["load"]): () => void {
    if (this.sections.has(id)) throw new Error(`duplicate navigation section id: ${id}`);
    const source: NavigationSectionSource = { labelKey, load };
    this.sections.set(id, source);
    return () => {
      if (this.sections.get(id) === source) this.sections.delete(id);
    };
  }

  list(): readonly { id: string; labelKey: string }[] {
    return [...this.sections.entries()].map(([id, source]) => ({ id, labelKey: source.labelKey }));
  }

  get(id: string): NavigationSectionSource | null {
    return this.sections.get(id) ?? null;
  }

  /** An unknown section loads nothing; it stays a disabled placeholder. */
  async load(id: string, signal: AbortSignal): Promise<readonly NavigationItem[]> {
    const source = this.sections.get(id);
    if (!source) return [];
    const items = await source.load(signal);
    return Array.isArray(items) ? items : [];
  }
}

export const navigationSections = new NavigationRegistry();

export const NAV_SECTION_LABEL_KEYS: Readonly<Record<string, string>> = {
  home: "explorer.nav.home",
  gallery: "explorer.nav.gallery",
  pinned: "explorer.pinnedFolders",
  this_pc: "explorer.nav.thisPc",
  network: "explorer.nav.network",
  saved_groups: "groups.saved",
};

function builtinItem(section: string, target: string): NavigationItem {
  return {
    id: `builtin:${section}`,
    kind: "builtin",
    target_id: target,
    visible: true,
    section_id: section,
  };
}

export function defaultNavigationCustomization(): NavigationCustomization {
  return {
    sections: [
      { id: "home", visible: true, items: [builtinItem("home", "home")] },
      { id: "gallery", visible: true, items: [builtinItem("gallery", "gallery")] },
      { id: "pinned", visible: true, items: [] },
      { id: "this_pc", visible: true, items: [builtinItem("this_pc", "this_pc")] },
      { id: "network", visible: true, items: [builtinItem("network", "network")] },
      { id: "saved_groups", visible: true, items: [builtinItem("saved_groups", "saved_groups")] },
    ],
    row_height_px: 32,
    icon_size_px: 20,
    width_px: 240,
    auto_collapse: false,
  };
}

// ---------------------------------------------------------------------------
// Status fields
// ---------------------------------------------------------------------------

export interface StatusFieldInfo {
  id: string;
  label_key: string;
}

export class StatusFieldRegistry {
  private owners = new Map<string, Map<string, StatusFieldProvider>>();

  /** One owner (a view instance) registers its exact live getters. */
  register(ownerId: string, provider: StatusFieldProvider): () => void {
    let fields = this.owners.get(ownerId);
    if (!fields) {
      fields = new Map();
      this.owners.set(ownerId, fields);
    }
    if (fields.has(provider.id)) throw new Error(`duplicate status field id: ${provider.id}`);
    fields.set(provider.id, provider);
    return () => {
      const current = this.owners.get(ownerId);
      if (current?.get(provider.id) === provider) current.delete(provider.id);
    };
  }

  /** The fields of one owner, for its editor; no getter is called. */
  fields(ownerId: string): readonly StatusFieldInfo[] {
    const fields = this.owners.get(ownerId);
    return fields ? [...fields.values()].map(({ id, label_key }) => ({ id, label_key })) : [];
  }

  /** Only the requested ids are read, in order; a throwing getter is skipped. */
  read(ownerId: string, orderedIds: readonly string[]): readonly { id: string; label_key: string; value: StatusValue }[] {
    const fields = this.owners.get(ownerId);
    if (!fields) return [];
    const result: { id: string; label_key: string; value: StatusValue }[] = [];
    for (const id of orderedIds) {
      const provider = fields.get(id);
      if (!provider) continue;
      let value: StatusValue | null = null;
      try {
        value = validateStatusValue(provider.read());
      } catch {
        value = null;
      }
      if (value) result.push({ id, label_key: provider.label_key, value });
    }
    return result;
  }

  disposeOwner(ownerId: string): void {
    this.owners.delete(ownerId);
  }
}

export const statusFields = new StatusFieldRegistry();

export const EXPLORER_STATUS_DEFAULTS: readonly { id: string; visible: boolean }[] = [
  { id: "item_count", visible: true },
  { id: "selection_count", visible: true },
  { id: "selection_size", visible: true },
  { id: "free_space", visible: true },
  { id: "view_buttons", visible: true },
];

export const STATUS_FIELD_LABEL_KEYS: Readonly<Record<string, string>> = {
  item_count: "statusFields.itemCount",
  selection_count: "statusFields.selectionCount",
  selection_size: "statusFields.selectionSize",
  free_space: "statusFields.freeSpace",
  view_buttons: "statusFields.viewButtons",
};

export function defaultStatusCustomization(): StatusCustomization {
  const orders = {} as StatusCustomization["orders"];
  for (const kind of STATUS_KINDS) {
    orders[kind] = kind === "explorer" ? EXPLORER_STATUS_DEFAULTS.map((entry) => ({ ...entry })) : [];
  }
  return { visible: true, orders };
}

// ---------------------------------------------------------------------------
// Defaults together
// ---------------------------------------------------------------------------

export function defaultShellCustomization(): ShellCustomization {
  const menus: MenuCustomization[] = [];
  return {
    menus,
    home: defaultHomeCustomization(),
    navigation: defaultNavigationCustomization(),
    status: defaultStatusCustomization(),
  };
}

/** Lenient settings repair: an invalid section alone falls back to its
 * default, so one damaged record never discards every shell preference. */
export function normalizeShellCustomization(value: unknown): ShellCustomization {
  const defaults = defaultShellCustomization();
  if (!isRecord(value)) return defaults;
  const candidate: ShellCustomization = {
    menus: validateMenuCustomizations(value.menus) ?? [],
    home: validateHomeCustomization(value.home) ?? defaults.home,
    navigation: validateNavigationCustomization(value.navigation) ?? defaults.navigation,
    status: validateStatusCustomization(value.status) ?? defaults.status,
  };
  // The same 1 MiB/record and 4 MiB total bounds as the native save gate.
  return validateShellCustomization(candidate) ?? defaults;
}

/** Kinds in display order, shared by the status editor and its host. */
export { STATUS_KINDS };
export type { StatusKind };
