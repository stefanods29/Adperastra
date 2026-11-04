/** Resolve safe menu customization data into the existing MenuEntry union
 * (Step 10e E5, shell-sections-1).
 *
 * The editable model keeps every node (including unknown command ids) so a
 * later app version can still edit and export it. The rendered copy keeps
 * only registered commands: an unknown id never reaches a command lookup and
 * can therefore never run. Separators are normalized in the rendered copy
 * only; the editable model is preserved (D2).
 */
import type { CommandContext, CommandRegistry } from "../commands/registry";
import {
  BACKGROUND_MENU,
  ITEM_MENU,
  type MenuEntry,
} from "../commands/menus";
import {
  createMenuNodeId,
  MAX_MENU_DEPTH,
  MAX_MENU_NODES,
  MAX_SUBMENU_CHILDREN,
  type MenuCustomization,
  type MenuNode,
  type MenuTarget,
  MENU_TARGETS,
} from "./types";
import { menuNodeCount } from "./validation";

export type MenuCommandRegistry = CommandRegistry<CommandContext>;

/** Existing menus by target. Tab and group menus arrive with their host
 * steps; an empty default is a valid, editable menu. */
export function defaultMenuForTarget(target: MenuTarget): readonly MenuEntry[] {
  if (target === "file" || target === "folder") return ITEM_MENU;
  if (target === "background") return BACKGROUND_MENU;
  return [];
}

/** A stable UUID-shaped id for converted defaults (not cryptographic). */
export function deterministicMenuId(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let round = 0; round < 4; round += 1) {
    for (let i = 0; i < seed.length; i += 1) {
      h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193);
      h2 = Math.imul(h2 ^ (seed.charCodeAt(i) + round * 31), 0x85ebca6b);
    }
    h1 = Math.imul(h1 ^ h2, 0xc2b2ae35);
    h2 = Math.imul(h2 ^ h1, 0x27d4eb2f);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const raw = `${hex(h1)}${hex(h2)}${hex(h1 ^ 0x9e3779b9)}${hex(h2 ^ 0x85ebca6b)}`.slice(0, 32);
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-a${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
}

function submenuEntry(id: string, labelKey: string, entries: MenuEntry[], label?: string): MenuEntry {
  // A custom submenu's text is user data, never an i18n key, so it must not
  // pass through t(); the renderer shows `label` as literal text.
  return {
    type: "submenu",
    id,
    labelKey,
    ...(label === undefined ? {} : { label }),
    entries,
  };
}

function convertEntries(
  entries: readonly MenuEntry[],
  target: MenuTarget,
  labelFor: (key: string) => string,
  path: string,
): MenuNode[] {
  const nodes: MenuNode[] = [];
  entries.forEach((entry, index) => {
    const seed = `${target}:${path}${index}`;
    if (entry.type === "command") {
      nodes.push({
        kind: "command",
        id: deterministicMenuId(seed),
        command_id: entry.id,
        visible: true,
        placement: "direct",
      });
    } else if (entry.type === "separator") {
      nodes.push({ kind: "separator", id: deterministicMenuId(seed) });
    } else if (entry.type === "iconRow") {
      entry.ids.forEach((id, rowIndex) => {
        nodes.push({
          kind: "command",
          id: deterministicMenuId(`${seed}:${rowIndex}`),
          command_id: id,
          visible: true,
          placement: "direct",
        });
      });
    } else {
      const label = labelFor(entry.labelKey);
      nodes.push({
        kind: "submenu",
        id: deterministicMenuId(seed),
        label,
        children: convertEntries(entry.entries, target, labelFor, `${path}${index}.`),
        visible: true,
        placement: "direct",
      });
    }
  });
  return nodes;
}

/** A fresh editable model from the current resolved defaults. */
export function menuCustomizationFromDefaults(
  target: MenuTarget,
  defaults: readonly MenuEntry[],
  labelFor: (key: string) => string,
): MenuCustomization {
  return { target, nodes: convertEntries(defaults, target, labelFor, "") };
}

/** The saved menu for one target, or a fresh model built from defaults. */
export function customizationForTarget(
  target: MenuTarget,
  custom: readonly MenuCustomization[],
  defaults: readonly MenuEntry[],
  labelFor: (key: string) => string,
): MenuCustomization {
  return custom.find((menu) => menu.target === target) ?? menuCustomizationFromDefaults(target, defaults, labelFor);
}

function normalizeSeparators(entries: readonly MenuEntry[]): MenuEntry[] {
  const kept: MenuEntry[] = [];
  for (const entry of entries) {
    if (entry.type === "separator") {
      if (kept.length === 0 || kept[kept.length - 1].type === "separator") continue;
    }
    kept.push(entry);
  }
  while (kept.length > 0 && kept[kept.length - 1].type === "separator") kept.pop();
  return kept;
}

function nodesToEntries(
  nodes: readonly MenuNode[],
  registry: MenuCommandRegistry,
  keepEmptySubmenus = false,
): { direct: MenuEntry[]; more: MenuEntry[] } {
  const direct: MenuEntry[] = [];
  const more: MenuEntry[] = [];
  for (const node of nodes) {
    if (node.kind === "separator") {
      direct.push({ type: "separator" });
      continue;
    }
    if (!node.visible) continue;
    const target = node.placement === "more" ? more : direct;
    if (node.kind === "command") {
      // Unknown command ids stay in the editable model but never render.
      if (!registry.get(node.command_id)) continue;
      target.push({ type: "command", id: node.command_id });
      continue;
    }
    const children = nodesToEntries(node.children, registry, keepEmptySubmenus);
    const entries = normalizeSeparators([
      ...children.direct,
      ...(children.more.length > 0
        ? [submenuEntry(`${node.id}:more`, "shellCustom.more", children.more)]
        : []),
    ]);
    // The editor preview shows a new submenu before it has children; the
    // live menu still never renders an empty group.
    if (entries.length === 0 && !(keepEmptySubmenus && node.label.trim() !== "")) continue;
    target.push(submenuEntry(node.id, "", entries, node.label));
  }
  return { direct, more };
}

/** E5: the rendered copy of one target. Enabled/visible rules stay for the
 * caller's normal resolveMenu pass; this function only applies safe data. */
export function resolveCustomMenu(
  target: MenuTarget,
  custom: readonly MenuCustomization[],
  defaults: readonly MenuEntry[],
  registry: MenuCommandRegistry,
  options: { keepEmptySubmenus?: boolean } = {},
): readonly MenuEntry[] {
  const saved = custom.find((menu) => menu.target === target);
  if (!saved) return defaults;
  const { direct, more } = nodesToEntries(saved.nodes, registry, options.keepEmptySubmenus === true);
  const entries = [...direct];
  if (more.length > 0) {
    entries.push(submenuEntry("more", "shellCustom.more", more));
  }
  return normalizeSeparators(entries);
}

/** Command ids stored in one target that the running app cannot execute. */
export function missingCommandIds(menu: MenuCustomization, registry: MenuCommandRegistry): readonly string[] {
  const missing: string[] = [];
  const visit = (nodes: readonly MenuNode[]) => {
    for (const node of nodes) {
      if (node.kind === "command") {
        if (!registry.get(node.command_id) && !missing.includes(node.command_id)) missing.push(node.command_id);
      } else if (node.kind === "submenu") {
        visit(node.children);
      }
    }
  };
  visit(menu.nodes);
  return missing;
}

/** Reset changes exactly one target; other saved menus stay byte-identical. */
export function resetMenuTarget(custom: readonly MenuCustomization[], target: MenuTarget): MenuCustomization[] {
  return custom.filter((menu) => menu.target !== target);
}

/** Replace one target's model without touching the others. */
export function withMenuTarget(custom: readonly MenuCustomization[], menu: MenuCustomization): MenuCustomization[] {
  const index = custom.findIndex((entry) => entry.target === menu.target);
  if (index < 0) return [...custom, menu];
  const result = [...custom];
  result[index] = menu;
  return result;
}

/** Targets in stable display order for the editor's selector. */
export function menuTargetsInOrder(): MenuTarget[] {
  return [...MENU_TARGETS];
}

// ---------------------------------------------------------------------------
// Draft-tree operations (pure; the editable model is never mutated)
// ---------------------------------------------------------------------------

export function findMenuNode(nodes: readonly MenuNode[], id: string): MenuNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.kind === "submenu") {
      const found = findMenuNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function updateMenuNode(
  nodes: readonly MenuNode[],
  id: string,
  update: (node: MenuNode) => MenuNode,
): MenuNode[] {
  return nodes.map((node) => {
    if (node.id === id) return update(node);
    if (node.kind === "submenu") return { ...node, children: updateMenuNode(node.children, id, update) };
    return node;
  });
}

export function removeMenuNode(nodes: readonly MenuNode[], id: string): MenuNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => (node.kind === "submenu" ? { ...node, children: removeMenuNode(node.children, id) } : node));
}

function moveInSiblings(nodes: readonly MenuNode[], id: string, direction: -1 | 1): { nodes: MenuNode[]; moved: boolean } {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) {
    const next = index + direction;
    if (next < 0 || next >= nodes.length) return { nodes: [...nodes], moved: false };
    const result = [...nodes];
    const [node] = result.splice(index, 1);
    result.splice(next, 0, node);
    return { nodes: result, moved: true };
  }
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.kind !== "submenu") continue;
    const inner = moveInSiblings(node.children, id, direction);
    if (inner.moved) {
      const result = [...nodes];
      result[i] = { ...node, children: inner.nodes };
      return { nodes: result, moved: true };
    }
  }
  return { nodes: [...nodes], moved: false };
}

export function moveMenuNode(nodes: readonly MenuNode[], id: string, direction: -1 | 1): MenuNode[] {
  return moveInSiblings(nodes, id, direction).nodes;
}

function nodeDepth(nodes: readonly MenuNode[], id: string, depth = 1): number | null {
  for (const node of nodes) {
    if (node.id === id) return depth;
    if (node.kind === "submenu") {
      const found = nodeDepth(node.children, id, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

export function insertMenuNode(nodes: readonly MenuNode[], parentId: string | null, node: MenuNode): MenuNode[] {
  if (menuNodeCount(nodes) >= MAX_MENU_NODES) return [...nodes];
  if (parentId === null) return [...nodes, node];
  const depth = nodeDepth(nodes, parentId);
  if (depth === null || depth >= MAX_MENU_DEPTH) return [...nodes];
  return updateMenuNode(nodes, parentId, (parent) => {
    if (parent.kind !== "submenu" || parent.children.length >= MAX_SUBMENU_CHILDREN) return parent;
    return { ...parent, children: [...parent.children, node] };
  });
}

/** Insert a separator after the selected node (or at the end). */
export function insertSeparator(nodes: readonly MenuNode[], afterId: string | null, id: string): MenuNode[] {
  if (menuNodeCount(nodes) >= MAX_MENU_NODES) return [...nodes];
  const separator: MenuNode = { kind: "separator", id };
  if (afterId === null) return [...nodes, separator];
  const insertAfter = (list: readonly MenuNode[], depth: number): MenuNode[] => {
    const index = list.findIndex((entry) => entry.id === afterId);
    if (index >= 0) {
      if (depth > 1 && list.length >= MAX_SUBMENU_CHILDREN) return [...list];
      const result = [...list];
      result.splice(index + 1, 0, separator);
      return result;
    }
    return list.map((entry) =>
      entry.kind === "submenu" ? { ...entry, children: insertAfter(entry.children, depth + 1) } : entry,
    );
  };
  return insertAfter(nodes, 1);
}

export function moveNodeToMore(nodes: readonly MenuNode[], id: string): MenuNode[] {
  return updateMenuNode(nodes, id, (node) => (node.kind === "separator" ? node : { ...node, placement: "more" }));
}

export { createMenuNodeId };
export { MAX_SUBMENU_CHILDREN } from "./types";
