/** The editable menu tree (Step 10e T2). Every operation has a keyboard
 * equivalent; no row runs a command. Separators are drawn as a line and
 * remain selectable so they can be moved or removed. */
import { Eye, EyeOff, Minus, MoreHorizontal, MoveDown, MoveUp, PlusSquare, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MenuNode } from "./types";
import type { MenuCommandRegistry } from "./menuCustomization";

export interface MenuTreeProps {
  nodes: readonly MenuNode[];
  registry: MenuCommandRegistry;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onToggleVisible: (id: string) => void;
  onRemove: (id: string) => void;
  onMoveToMore: (id: string) => void;
  onCreateSubmenu: (parentId: string | null) => void;
  onAddSeparator: (afterId: string | null) => void;
}

interface Row {
  node: MenuNode;
  depth: number;
  parentId: string | null;
}

function flatten(nodes: readonly MenuNode[], depth = 0, parentId: string | null = null): Row[] {
  const rows: Row[] = [];
  for (const node of nodes) {
    rows.push({ node, depth, parentId });
    if (node.kind === "submenu") rows.push(...flatten(node.children, depth + 1, node.id));
  }
  return rows;
}

export default function MenuTree(props: MenuTreeProps) {
  const { t } = useTranslation();
  const rows = flatten(props.nodes);

  return (
    <div className="adp-menu-tree" role="tree" aria-label={t("shellCustom.menus")}>
      {rows.map(({ node, depth, parentId }) => {
        const selected = props.selectedId === node.id;
        const label =
          node.kind === "command"
            ? props.registry.get(node.command_id)
              ? t(props.registry.get(node.command_id)!.labelKey)
              : t("toolbarCustom.missing")
            : node.kind === "submenu"
              ? node.label
              : t("shellCustom.separatorLabel");
        const visible = node.kind === "separator" ? true : node.visible;
        const missing = node.kind === "command" && !props.registry.get(node.command_id);
        return (
          <div
            key={node.id}
            role="treeitem"
            aria-selected={selected}
            aria-level={depth + 1}
            className={`adp-menu-tree__row${selected ? " adp-menu-tree__row--selected" : ""}${
              node.kind === "separator" ? " adp-menu-tree__row--separator" : ""
            }`}
            style={{ paddingInlineStart: `${12 + depth * 16}px` }}
          >
            <button
              type="button"
              className="adp-menu-tree__select"
              data-node-id={node.id}
              aria-label={label}
              onClick={() => props.onSelect(node.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  props.onMove(node.id, -1);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  props.onMove(node.id, 1);
                } else if (event.key === "Delete") {
                  event.preventDefault();
                  props.onRemove(node.id);
                }
              }}
            >
              {node.kind === "separator" ? (
                <span className="adp-menu-tree__line" aria-hidden="true" />
              ) : (
                <span className={missing ? "adp-menu-tree__label adp-menu-tree__label--missing" : "adp-menu-tree__label"}>
                  {label}
                </span>
              )}
              {missing ? <span className="adp-menu-tree__badge">{t("toolbarCustom.missing")}</span> : null}
            </button>
            {selected ? (
              <span className="adp-menu-tree__actions">
                {node.kind !== "separator" ? (
                  <button
                    type="button"
                    className="adp-icon-btn"
                    aria-label={visible ? t("shellCustom.hide") : t("shellCustom.show")}
                    title={visible ? t("shellCustom.hide") : t("shellCustom.show")}
                    onClick={() => props.onToggleVisible(node.id)}
                  >
                    {visible ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="adp-icon-btn"
                  aria-label={t("shellCustom.up")}
                  title={t("shellCustom.up")}
                  onClick={() => props.onMove(node.id, -1)}
                >
                  <MoveUp size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="adp-icon-btn"
                  aria-label={t("shellCustom.down")}
                  title={t("shellCustom.down")}
                  onClick={() => props.onMove(node.id, 1)}
                >
                  <MoveDown size={16} aria-hidden="true" />
                </button>
                {node.kind !== "separator" ? (
                  <>
                    <button
                      type="button"
                      className="adp-icon-btn"
                      aria-label={t("shellCustom.more")}
                      title={t("shellCustom.more")}
                      onClick={() => props.onMoveToMore(node.id)}
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </button>
                    {depth < 2 ? (
                      <button
                        type="button"
                        className="adp-icon-btn"
                        aria-label={t("shellCustom.submenu")}
                        title={t("shellCustom.submenu")}
                        onClick={() => props.onCreateSubmenu(node.kind === "submenu" ? node.id : parentId)}
                      >
                        <PlusSquare size={16} aria-hidden="true" />
                      </button>
                    ) : null}
                  </>
                ) : null}
                <button
                  type="button"
                  className="adp-icon-btn"
                  aria-label={t("shellCustom.separator")}
                  title={t("shellCustom.separator")}
                  onClick={() => props.onAddSeparator(node.id)}
                >
                  <Minus size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="adp-icon-btn"
                  aria-label={t("shellCustom.remove")}
                  title={t("shellCustom.remove")}
                  onClick={() => props.onRemove(node.id)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </span>
            ) : null}
          </div>
        );
      })}
      <div className="adp-menu-tree__footer">
        <button type="button" className="adp-btn" onClick={() => props.onCreateSubmenu(null)}>
          <PlusSquare size={16} aria-hidden="true" /> {t("shellCustom.submenu")}
        </button>
        <button type="button" className="adp-btn" onClick={() => props.onAddSeparator(null)}>
          <Minus size={16} aria-hidden="true" /> {t("shellCustom.separator")}
        </button>
      </div>
    </div>
  );
}
