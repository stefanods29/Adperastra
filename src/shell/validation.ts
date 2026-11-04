/** Strict validators for the shell customization types (Step 10e T1).
 * Persisted values are data: an unknown callback, URL or argument makes the
 * value invalid rather than being silently kept. */
import {
  ABSOLUTE_PATH_RE,
  FORBIDDEN_KEYS,
  HOME_SECTION_SIZES,
  MAX_COMMAND_ID_CHARS,
  MAX_HOME_LIMIT,
  MAX_HOME_SECTIONS,
  MAX_MENU_COUNT,
  MAX_MENU_DEPTH,
  MAX_MENU_NODES,
  MAX_NAV_SECTIONS,
  MAX_NAV_WIDTH,
  MAX_NAV_ROW_HEIGHT,
  MAX_SHELL_RECORD_BYTES,
  MAX_SHELL_TOTAL_BYTES,
  MAX_STATUS_FIELDS_PER_KIND,
  MAX_STATUS_ID_CHARS,
  MAX_STATUS_TEXT_CHARS,
  MAX_SUBMENU_CHILDREN,
  MAX_SUBMENU_LABEL_CHARS,
  MAX_TOTAL_MENU_NODES,
  MAX_CUSTOM_NAV_ITEMS,
  MAX_CUSTOM_NAV_SECTIONS,
  MAX_NAV_LABEL_CHARS,
  MIN_NAV_ROW_HEIGHT,
  MIN_NAV_WIDTH,
  MENU_TARGETS,
  NAV_DEFAULTS,
  NAV_ICON_SIZES,
  NAV_SECTION_IDS,
  STATUS_KINDS,
  charCount,
  isCanonicalUuid,
  isRecord,
  isRegisteredSectionId,
  type HomeCustomization,
  type HomeSectionLayout,
  type HomeSectionSize,
  type MenuCustomization,
  type MenuNode,
  type MenuPlacement,
  type MenuTarget,
  type NavigationCustomization,
  type NavigationItem,
  type NavigationSectionLayout,
  type ShellCustomization,
  type StatusCustomization,
  type StatusFieldOrderEntry,
  type StatusKind,
  type StatusValue,
} from "./types";
/** 1-60 visible characters, no surrounding whitespace and no control codes. */
export function isSafeLabel(value: unknown, max = MAX_SUBMENU_LABEL_CHARS): value is string {
  if (typeof value !== "string") return false;
  if (value.trim() !== value || value.length === 0) return false;
  const characters = Array.from(value);
  if (characters.length > max) return false;
  return characters.every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f;
  });
}

function safeText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const characters = Array.from(value);
  if (characters.length > max) return null;
  return characters.every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f;
  })
    ? value
    : null;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const set = new Set(allowed);
  return Object.keys(value).every((key) => !FORBIDDEN_KEYS.has(key) && set.has(key));
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

const COMMAND_KEYS = ["kind", "id", "command_id", "visible", "placement"];
const SEPARATOR_KEYS = ["kind", "id"];
const SUBMENU_KEYS = ["kind", "id", "label", "children", "visible", "placement"];

function readPlacement(value: unknown): MenuPlacement | null {
  return value === undefined || value === "direct" ? "direct" : value === "more" ? "more" : null;
}

/** Strict: any extra field, cycle, duplicate id or depth 4 makes it null. */
export function validateMenuNode(value: unknown, depth = 1): MenuNode | null {
  if (!isRecord(value) || depth > MAX_MENU_DEPTH) return null;
  if (!isCanonicalUuid(value.id)) return null;
  if (value.kind === "command") {
    if (!onlyKeys(value, COMMAND_KEYS)) return null;
    const commandId = typeof value.command_id === "string" ? safeText(value.command_id, MAX_COMMAND_ID_CHARS) : null;
    const placement = readPlacement(value.placement);
    if (commandId === null || commandId.length === 0 || placement === null) return null;
    return {
      kind: "command",
      id: value.id as string,
      command_id: commandId,
      visible: readBool(value.visible, true),
      placement,
    };
  }
  if (value.kind === "separator") {
    if (!onlyKeys(value, SEPARATOR_KEYS)) return null;
    return { kind: "separator", id: value.id };
  }
  if (value.kind === "submenu") {
    if (!onlyKeys(value, SUBMENU_KEYS) || !isSafeLabel(value.label)) return null;
    const placement = readPlacement(value.placement);
    if (placement === null || !Array.isArray(value.children)) return null;
    if (value.children.length > MAX_SUBMENU_CHILDREN) return null;
    const children: MenuNode[] = [];
    for (const child of value.children) {
      const validated = validateMenuNode(child, depth + 1);
      if (!validated) return null;
      children.push(validated);
    }
    return { kind: "submenu", id: value.id, label: value.label, children, visible: readBool(value.visible, true), placement };
  }
  return null;
}

function walkNodes(nodes: readonly MenuNode[], visit: (node: MenuNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.kind === "submenu") walkNodes(node.children, visit);
  }
}

export function menuNodeCount(nodes: readonly MenuNode[]): number {
  let count = 0;
  walkNodes(nodes, () => (count += 1));
  return count;
}

/** One menu or null. Node ids must be unique inside the menu. */
export function validateMenuCustomization(value: unknown): MenuCustomization | null {
  if (!isRecord(value) || !onlyKeys(value, ["target", "nodes"])) return null;
  if (typeof value.target !== "string" || !(MENU_TARGETS as readonly string[]).includes(value.target)) return null;
  if (!Array.isArray(value.nodes) || value.nodes.length > MAX_MENU_NODES) return null;
  const nodes: MenuNode[] = [];
  const ids = new Set<string>();
  for (const entry of value.nodes) {
    const node = validateMenuNode(entry);
    if (!node) return null;
    let duplicate = false;
    walkNodes([node], (item) => {
      if (ids.has(item.id)) duplicate = true;
      ids.add(item.id);
    });
    if (duplicate) return null;
    nodes.push(node);
  }
  if (menuNodeCount(nodes) > MAX_MENU_NODES) return null;
  return { target: value.target as MenuTarget, nodes };
}
/** Every target at most once; at most 500 nodes in total. */
export function validateMenuCustomizations(value: unknown): MenuCustomization[] | null {
  if (!Array.isArray(value) || value.length > MAX_MENU_COUNT) return null;
  const result: MenuCustomization[] = [];
  const targets = new Set<MenuTarget>();
  const ids = new Set<string>();
  let total = 0;
  for (const entry of value) {
    const menu = validateMenuCustomization(entry);
    if (!menu || targets.has(menu.target)) return null;
    let duplicate = false;
    let count = 0;
    walkNodes(menu.nodes, (node) => {
      if (ids.has(node.id)) duplicate = true;
      ids.add(node.id);
      count += 1;
    });
    if (duplicate) return null;
    total += count;
    if (total > MAX_TOTAL_MENU_NODES) return null;
    targets.add(menu.target);
    result.push(menu);
  }
  return result;
}

/** Strict home layout list with unique registered ids. */
export function validateHomeCustomization(value: unknown): HomeCustomization | null {
  if (!isRecord(value) || !onlyKeys(value, ["sections"])) return null;
  if (!Array.isArray(value.sections) || value.sections.length > MAX_HOME_SECTIONS) return null;
  const sections: HomeSectionLayout[] = [];
  const ids = new Set<string>();
  for (const entry of value.sections) {
    if (!isRecord(entry) || !onlyKeys(entry, ["id", "visible", "collapsed", "size", "limit"])) return null;
    if (!isRegisteredSectionId(entry.id) || ids.has(entry.id)) return null;
    if (typeof entry.visible !== "boolean" || typeof entry.collapsed !== "boolean") return null;
    if (typeof entry.size !== "string" || !(HOME_SECTION_SIZES as readonly string[]).includes(entry.size)) return null;
    if (typeof entry.limit !== "number" || !Number.isInteger(entry.limit) || entry.limit < 1 || entry.limit > MAX_HOME_LIMIT) {
      return null;
    }
    ids.add(entry.id);
    sections.push({
      id: entry.id,
      visible: entry.visible,
      collapsed: entry.collapsed,
      size: entry.size as HomeSectionSize,
      limit: entry.limit,
    });
  }
  return { sections };
}

function validateNavigationItem(value: unknown, sectionId: string): NavigationItem | null {
  if (!isRecord(value) || !onlyKeys(value, ["id", "kind", "target_id", "display_label", "visible", "section_id"])) {
    return null;
  }
  if (value.section_id !== sectionId) return null;
  if (value.kind !== "builtin" && value.kind !== "folder") return null;
  const builtin = value.kind === "builtin";
  if (builtin ? typeof value.id !== "string" || !value.id.startsWith("builtin:") : !isCanonicalUuid(value.id)) {
    return null;
  }
  if (typeof value.target_id !== "string") return null;
  const target = safeText(value.target_id, 32768);
  if (target === null || target.length === 0) return null;
  if (!builtin && !ABSOLUTE_PATH_RE.test(target)) return null;
  let displayLabel: string | undefined;
  if (value.display_label !== undefined && value.display_label !== null) {
    if (!isSafeLabel(value.display_label)) return null;
    displayLabel = value.display_label;
  }
  if (typeof value.visible !== "boolean") return null;
  return {
    id: value.id as string,
    kind: value.kind,
    target_id: target,
    ...(displayLabel === undefined ? {} : { display_label: displayLabel }),
    visible: value.visible,
    section_id: sectionId,
  };
}

export function validateNavigationCustomization(value: unknown): NavigationCustomization | null {
  if (
    !isRecord(value) ||
    !onlyKeys(value, ["sections", "row_height_px", "icon_size_px", "width_px", "auto_collapse"])
  ) {
    return null;
  }
  if (!Array.isArray(value.sections) || value.sections.length > MAX_NAV_SECTIONS) return null;
  const sections: NavigationSectionLayout[] = [];
  const sectionIds = new Set<string>();
  const itemIds = new Set<string>();
  let customSections = 0;
  let customItems = 0;
  for (const entry of value.sections) {
    if (!isRecord(entry) || !onlyKeys(entry, ["id", "label", "visible", "items"])) return null;
    if (!isRegisteredSectionId(entry.id) || sectionIds.has(entry.id)) return null;
    if (typeof entry.visible !== "boolean") return null;
    let label: string | undefined;
    if (entry.label !== undefined && entry.label !== null) {
      if (!isSafeLabel(entry.label)) return null;
      label = entry.label;
    }
    if (!Array.isArray(entry.items)) return null;
    if (!NAV_SECTION_IDS.includes(entry.id)) {
      customSections += 1;
      if (customSections > MAX_CUSTOM_NAV_SECTIONS) return null;
    }
    const items: NavigationItem[] = [];
    for (const raw of entry.items) {
      const item = validateNavigationItem(raw, entry.id);
      if (!item || itemIds.has(item.id)) return null;
      itemIds.add(item.id);
      if (item.kind === "folder") {
        customItems += 1;
        if (customItems > MAX_CUSTOM_NAV_ITEMS) return null;
      }
      items.push(item);
    }
    sectionIds.add(entry.id);
    sections.push({ id: entry.id, ...(label === undefined ? {} : { label }), visible: entry.visible, items });
  }
  return {
    sections,
    row_height_px: readInt(value.row_height_px, MIN_NAV_ROW_HEIGHT, MAX_NAV_ROW_HEIGHT, NAV_DEFAULTS.row_height_px),
    icon_size_px:
      typeof value.icon_size_px === "number" && NAV_ICON_SIZES.includes(value.icon_size_px)
        ? value.icon_size_px
        : NAV_DEFAULTS.icon_size_px,
    width_px: readInt(value.width_px, MIN_NAV_WIDTH, MAX_NAV_WIDTH, NAV_DEFAULTS.width_px),
    auto_collapse: readBool(value.auto_collapse, NAV_DEFAULTS.auto_collapse),
  };
}

/** A live status value; bad numbers become null instead of "NaN" on screen. */
export function validateStatusValue(value: unknown): StatusValue | null {
  if (!isRecord(value)) return null;
  if (value.kind === "text") {
    const text = safeText(value.text, MAX_STATUS_TEXT_CHARS);
    return text === null ? null : { kind: "text", text };
  }
  if (value.kind === "number") {
    return typeof value.value === "number" && Number.isFinite(value.value) ? { kind: "number", value: value.value } : null;
  }
  if (value.kind === "size") {
    return typeof value.bytes === "number" && Number.isSafeInteger(value.bytes) && value.bytes >= 0
      ? { kind: "size", bytes: value.bytes }
      : null;
  }
  if (value.kind === "position") {
    const { line, column } = value;
    return typeof line === "number" &&
      Number.isInteger(line) &&
      line > 0 &&
      typeof column === "number" &&
      Number.isInteger(column) &&
      column > 0
      ? { kind: "position", line, column }
      : null;
  }
  if (value.kind === "zoom") {
    const { percent, min, max } = value;
    if (
      typeof percent !== "number" ||
      typeof min !== "number" ||
      typeof max !== "number" ||
      !Number.isFinite(percent) ||
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      min > max
    ) {
      return null;
    }
    return { kind: "zoom", percent, min, max };
  }
  return null;
}

function validateStatusOrder(value: unknown): StatusFieldOrderEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_STATUS_FIELDS_PER_KIND) return null;
  const result: StatusFieldOrderEntry[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || !onlyKeys(entry, ["id", "visible"])) return null;
    if (typeof entry.id !== "string" || entry.id.length === 0 || charCount(entry.id) > MAX_STATUS_ID_CHARS) return null;
    if (ids.has(entry.id) || typeof entry.visible !== "boolean") return null;
    ids.add(entry.id);
    result.push({ id: entry.id, visible: entry.visible });
  }
  return result;
}

export function validateStatusCustomization(value: unknown): StatusCustomization | null {
  if (!isRecord(value) || !onlyKeys(value, ["visible", "orders"])) return null;
  if (typeof value.visible !== "boolean" || !isRecord(value.orders)) return null;
  for (const key of Object.keys(value.orders)) {
    if (!(STATUS_KINDS as readonly string[]).includes(key)) return null;
  }
  const orders = {} as Record<StatusKind, StatusFieldOrderEntry[]>;
  for (const kind of STATUS_KINDS) {
    const raw = value.orders[kind];
    const order = raw === undefined ? [] : validateStatusOrder(raw);
    if (!order) return null;
    orders[kind] = order;
  }
  return { visible: value.visible, orders };
}

export function validateShellCustomization(value: unknown): ShellCustomization | null {
  if (!isRecord(value) || !onlyKeys(value, ["menus", "home", "navigation", "status"])) return null;
  const menus = validateMenuCustomizations(value.menus);
  const home = validateHomeCustomization(value.home);
  const navigation = validateNavigationCustomization(value.navigation);
  const status = validateStatusCustomization(value.status);
  if (!menus || !home || !navigation || !status) return null;
  const result = { menus, home, navigation, status };
  const bytes = (part: unknown) => new TextEncoder().encode(JSON.stringify(part) ?? "").length;
  if (
    bytes(result.menus) > MAX_SHELL_RECORD_BYTES ||
    bytes(result.home) > MAX_SHELL_RECORD_BYTES ||
    bytes(result.navigation) > MAX_SHELL_RECORD_BYTES ||
    bytes(result.status) > MAX_SHELL_RECORD_BYTES ||
    bytes(result) > MAX_SHELL_TOTAL_BYTES
  ) {
    return null;
  }
  return result;
}
