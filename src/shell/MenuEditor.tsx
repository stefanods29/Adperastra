/** Visual, safe menu editor (Step 10e T2, E7 via the shared editor pattern).
 *
 * The left side edits a draft tree; the right side shows the resolved copy.
 * The preview is never interactive and never calls `Command.run`. Apply is
 * one atomic settings change; Cancel leaves the saved menus untouched (D3).
 */
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import TextInput from "../components/TextInput";
import type { MenuEntry } from "../commands/menus";
import { errorText } from "../services/errors";
import {
  customizationForTarget,
  findMenuNode,
  insertMenuNode,
  insertSeparator,
  menuTargetsInOrder,
  moveMenuNode,
  moveNodeToMore,
  removeMenuNode,
  resetMenuTarget,
  resolveCustomMenu,
  updateMenuNode,
  withMenuTarget,
  type MenuCommandRegistry,
} from "./menuCustomization";
import MenuTree from "./MenuTree";
import { createMenuNodeId, type MenuCustomization, type MenuNode, type MenuTarget } from "./types";
import { validateMenuCustomizations } from "./validation";

export interface MenuEditorProps {
  target: MenuTarget;
  value: readonly MenuCustomization[];
  defaults: readonly MenuEntry[];
  registry: MenuCommandRegistry;
  onApply: (value: readonly MenuCustomization[]) => Promise<void>;
  onCancel: () => void;
  onOpenHelp: (slug?: string) => void;
  /** Optional target switcher; the Settings page owns the real defaults. */
  targets?: readonly { target: MenuTarget; defaults: readonly MenuEntry[] }[];
  onTargetChange?: (target: MenuTarget) => void;
  labelFor?: (key: string) => string;
}

function previewLabel(entry: MenuEntry, labelFor: (key: string) => string): string {
  if (entry.type === "submenu") {
    const literal = (entry as unknown as { label?: string }).label;
    return literal ?? labelFor(entry.labelKey);
  }
  return "";
}

function PreviewEntries({
  entries,
  registry,
  labelFor,
}: {
  entries: readonly MenuEntry[];
  registry: MenuCommandRegistry;
  labelFor: (key: string) => string;
}) {
  return (
    <ul className="adp-menu-editor__preview-list" role="presentation">
      {entries.map((entry, index) => {
        if (entry.type === "separator") {
          return <li key={`separator-${index}`} role="separator" className="adp-menu-editor__preview-separator" />;
        }
        if (entry.type === "command") {
          const command = registry.get(entry.id);
          const Icon = command?.icon;
          return (
            <li key={`${entry.id}-${index}`} className="adp-menu-editor__preview-row" data-preview-command={entry.id}>
              {Icon ? <Icon size={16} aria-hidden="true" /> : null}
              <span>{command ? labelFor(command.labelKey) : entry.id}</span>
            </li>
          );
        }
        if (entry.type === "iconRow") {
          return (
            <li key={`row-${index}`} className="adp-menu-editor__preview-row">
              {entry.ids.map((id) => {
                const command = registry.get(id);
                if (!command) return null;
                const Icon = command.icon;
                return (
                  <span key={id} className="adp-menu-editor__preview-icon" aria-label={labelFor(command.labelKey)}>
                    <Icon size={16} aria-hidden="true" />
                  </span>
                );
              })}
            </li>
          );
        }
        if (entry.type === "submenu") {
          return (
            <li key={`${entry.id}-${index}`} className="adp-menu-editor__preview-group">
              <span className="adp-menu-editor__preview-submenu">{previewLabel(entry, labelFor)}</span>
              <PreviewEntries entries={entry.entries} registry={registry} labelFor={labelFor} />
            </li>
          );
        }
        return null;
      })}
    </ul>
  );
}

const TARGET_LABEL_KEYS: Readonly<Record<MenuTarget, string>> = {
  file: "shellCustom.targetFile",
  folder: "shellCustom.targetFolder",
  background: "shellCustom.targetBackground",
  tab: "shellCustom.targetTab",
  group: "shellCustom.targetGroup",
};

export default function MenuEditor(props: MenuEditorProps) {
  const { t } = useTranslation();
  const labelFor = props.labelFor ?? ((key: string) => t(key));
  const build = (target: MenuTarget, defaults: readonly MenuEntry[]) =>
    customizationForTarget(target, props.value, defaults, labelFor);
  const [draftTarget, setDraftTarget] = useState(props.target);
  const [draft, setDraft] = useState<MenuCustomization>(() => build(props.target, props.defaults));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reset, setReset] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (draftTarget !== props.target) {
    setDraftTarget(props.target);
    setDraft(build(props.target, props.defaults));
    setSelectedId(null);
    setReset(false);
  }

  const setNodes = (nodes: MenuNode[]) => {
    setDraft((current) => ({ ...current, nodes }));
    setReset(false);
  };

  const selected = selectedId ? findMenuNode(draft.nodes, selectedId) : null;
  const preview = resolveCustomMenu(props.target, reset ? [] : [draft], props.defaults, props.registry, {
    keepEmptySubmenus: true,
  });
  const targets = props.targets ?? [{ target: props.target, defaults: props.defaults }];

  const apply = async () => {
    const next = reset ? resetMenuTarget(props.value, props.target) : withMenuTarget(props.value, draft);
    const validated = validateMenuCustomizations(next);
    if (!validated) {
      setError(new Error("catalog.invalid"));
      return;
    }
    setApplying(true);
    setError(null);
    try {
      await props.onApply(validated);
    } catch (failure) {
      setError(failure);
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="adp-menu-editor" aria-label={t("shellCustom.menus")}>
      <div className="adp-view-header">
        <h3 className="adp-heading">{t("shellCustom.menus")}</h3>
        <div className="adp-button-row">
          {targets.length > 1 && props.onTargetChange ? (
            <select
              className="adp-defaultapps-select"
              aria-label={t("shellCustom.menus")}
              value={props.target}
              onChange={(event) => props.onTargetChange?.(event.target.value as MenuTarget)}
            >
              {menuTargetsInOrder()
                .filter((target) => targets.some((entry) => entry.target === target))
                .map((target) => (
                  <option key={target} value={target}>
                    {t(TARGET_LABEL_KEYS[target])}
                  </option>
                ))}
            </select>
          ) : null}
          <HelpButton onOpenHelp={() => props.onOpenHelp("editing-menus")} />
        </div>
      </div>

      <div className="adp-menu-editor__columns">
        <div className="adp-menu-editor__pane">
          <span className="adp-menu-editor__pane-title">{t("shellCustom.menus")}</span>
          <MenuTree
            nodes={draft.nodes}
            registry={props.registry}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={(id, direction) => setNodes(moveMenuNode(draft.nodes, id, direction))}
            onToggleVisible={(id) =>
              setNodes(updateMenuNode(draft.nodes, id, (node) => (node.kind === "separator" ? node : { ...node, visible: !node.visible })))
            }
            onRemove={(id) => {
              setNodes(removeMenuNode(draft.nodes, id));
              if (selectedId === id) setSelectedId(null);
            }}
            onMoveToMore={(id) => setNodes(moveNodeToMore(draft.nodes, id))}
            onCreateSubmenu={(parentId) => {
              const node: MenuNode = {
                kind: "submenu",
                id: createMenuNodeId(),
                label: t("shellCustom.submenu"),
                children: [],
                visible: true,
                placement: "direct",
              };
              setNodes(insertMenuNode(draft.nodes, parentId, node));
              setSelectedId(node.id);
            }}
            onAddSeparator={(afterId) => setNodes(insertSeparator(draft.nodes, afterId, createMenuNodeId()))}
          />
          {selected?.kind === "submenu" ? (
            <div className="adp-menu-editor__submenu-row">
              <span className="adp-setting-label">{t("shellCustom.displayName")}</span>
              <TextInput
                ariaLabel={t("shellCustom.displayName")}
                value={selected.label}
                maxLength={60}
                onChange={(label) =>
                  setNodes(updateMenuNode(draft.nodes, selected.id, (node) => (node.kind === "submenu" ? { ...node, label } : node)))
                }
              />
            </div>
          ) : null}
        </div>

        <div className="adp-menu-editor__pane" aria-live="polite">
          <span className="adp-menu-editor__pane-title">{t("shellCustom.preview")}</span>
          <div className="adp-menu-editor__preview">
            <PreviewEntries entries={preview} registry={props.registry} labelFor={labelFor} />
          </div>
        </div>
      </div>

      {error ? <p className="adp-menu-editor__error">{errorText(t, error, "catalog")}</p> : null}
      <div className="adp-menu-editor__actions">
        <Button disabled={applying} onClick={() => void apply()}>
          {t("common.apply")}
        </Button>
        <Button disabled={applying} onClick={props.onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          disabled={applying}
          onClick={() => {
            setReset(true);
            setDraft(build(props.target, props.defaults));
            setSelectedId(null);
          }}
        >
          <RotateCcw size={16} aria-hidden="true" /> {t("shellCustom.reset")}
        </Button>
      </div>
    </section>
  );
}
