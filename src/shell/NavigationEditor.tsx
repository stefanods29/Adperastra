/** Navigation pane editor (Step 10e T4).
 *
 * Rows, icons, width and auto-collapse are bounded settings. A custom folder
 * item's display label changes only what the pane shows; `target_id` is the
 * real folder path and is never renamed or moved by the app. A missing folder
 * shows a warning and Locate, never an automatic delete (D5).
 */
import { FolderPlus, LocateFixed, MoveDown, MoveUp, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import Switch from "../components/Switch";
import TextInput from "../components/TextInput";
import { displayPath } from "../services/explorer";
import { errorText } from "../services/errors";
import { defaultNavigationCustomization, NAV_SECTION_LABEL_KEYS } from "./registries";
import { ABSOLUTE_PATH_RE, MAX_CUSTOM_NAV_ITEMS, MAX_CUSTOM_NAV_SECTIONS, MAX_NAV_ROW_HEIGHT, MAX_NAV_WIDTH, MIN_NAV_ROW_HEIGHT, MIN_NAV_WIDTH, NAV_ICON_SIZES, type NavigationCustomization } from "./types";
import { validateNavigationCustomization } from "./validation";

export interface NavigationEditorProps {
  value: NavigationCustomization;
  onApply: (value: NavigationCustomization) => Promise<void>;
  onCancel: () => void;
  onOpenHelp: (slug?: string) => void;
  /** "missing" shows the warning and Locate; "unknown" is not a warning. */
  pathStatus?: (path: string) => "ok" | "missing" | "unknown";
  onLocate?: (path: string) => void;
  descriptors?: readonly { id: string; labelKey: string }[]; // registered 11b sections
}

export default function NavigationEditor(props: NavigationEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<NavigationCustomization>(props.value);
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const labelKeys = { ...NAV_SECTION_LABEL_KEYS, ...Object.fromEntries((props.descriptors ?? []).map((entry) => [entry.id, entry.labelKey] as const)) };
  const update = (patch: Partial<NavigationCustomization>) => setDraft((current) => ({ ...current, ...patch }));
  const customItems = draft.sections.reduce((count, section) => count + section.items.filter((item) => item.kind === "folder").length, 0);
  const customSections = draft.sections.filter((section) => !Object.prototype.hasOwnProperty.call(labelKeys, section.id)).length;
  const moveSection = (id: string, direction: -1 | 1) => {
    setDraft((current) => {
      const index = current.sections.findIndex((section) => section.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= current.sections.length) return current;
      const sections = [...current.sections];
      const [section] = sections.splice(index, 1);
      sections.splice(next, 0, section);
      return { ...current, sections };
    });
  };

  const moveItem = (sectionId: string, itemId: string, direction: -1 | 1) => {
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== sectionId) return section;
        const index = section.items.findIndex((item) => item.id === itemId);
        const next = index + direction;
        if (index < 0 || next < 0 || next >= section.items.length) return section;
        const items = [...section.items];
        const [item] = items.splice(index, 1);
        items.splice(next, 0, item);
        return { ...section, items };
      }),
    }));
  };

  const addFolder = () => {
    if (!ABSOLUTE_PATH_RE.test(path.trim())) {
      setError(new Error("catalog.invalid"));
      return;
    }
    if (customItems >= MAX_CUSTOM_NAV_ITEMS) {
      setError(new Error("catalog.limit"));
      return;
    }
    const target = draft.sections.find((section) => section.id === "pinned") ?? draft.sections[0];
    if (!target) {
      setError(new Error("catalog.invalid"));
      return;
    }
    setError(null);
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id !== target.id
          ? section
          : {
              ...section,
              items: [
                ...section.items,
                {
                  id: createItemId(),
                  kind: "folder",
                  target_id: path.trim(),
                  ...(label.trim() === "" ? {} : { display_label: label.trim() }),
                  visible: true,
                  section_id: section.id,
                },
              ],
            },
      ),
    }));
    setPath("");
    setLabel("");
  };

  const addSection = () => {
    const text = sectionName.trim();
    if (text === "" || customSections >= MAX_CUSTOM_NAV_SECTIONS) {
      setError(new Error(customSections >= MAX_CUSTOM_NAV_SECTIONS ? "catalog.limit" : "catalog.invalid"));
      return;
    }
    setError(null);
    setDraft((current) => ({
      ...current,
      sections: [
        ...current.sections,
        { id: nextSectionId(current.sections), label: text, visible: true, items: [] },
      ],
    }));
    setSectionName("");
  };
  const apply = async () => {
    const validated = validateNavigationCustomization(draft);
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
    <section className="adp-navigation-editor adp-settings-section" aria-label={t("shellCustom.navigation")}>
      <div className="adp-view-header">
        <h3 className="adp-heading">{t("shellCustom.navigation")}</h3>
        <HelpButton onOpenHelp={() => props.onOpenHelp("customizing-home-navigation-status")} />
      </div>

      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("shellCustom.rowHeight")}</span>
        <TextInput
          type="number"
          ariaLabel={t("shellCustom.rowHeight")}
          value={String(draft.row_height_px)}
          onChange={(text) =>
            update({
              row_height_px: clamp(Number(text), MIN_NAV_ROW_HEIGHT, MAX_NAV_ROW_HEIGHT, draft.row_height_px),
            })
          }
        />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("shellCustom.iconSize")}</span>
        <select
          className="adp-defaultapps-select"
          aria-label={t("shellCustom.iconSize")}
          value={String(draft.icon_size_px)}
          onChange={(event) => update({ icon_size_px: Number(event.target.value) })}
        >
          {NAV_ICON_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}px
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("shellCustom.width")}</span>
        <TextInput
          type="number"
          ariaLabel={t("shellCustom.width")}
          value={String(draft.width_px)}
          onChange={(text) => update({ width_px: clamp(Number(text), MIN_NAV_WIDTH, MAX_NAV_WIDTH, draft.width_px) })}
        />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("shellCustom.autoCollapse")}</span>
        <Switch checked={draft.auto_collapse} onChange={(auto_collapse) => update({ auto_collapse })} />
      </div>

      <h4 className="adp-heading">{t("shellCustom.section")}</h4>
      {draft.sections.map((section, sectionIndex) => (
        <div key={section.id} className="adp-navigation-editor__section" data-nav-section={section.id}>
          <div className="adp-setting-row">
            <span className="adp-setting-label">
              {section.label ?? t(labelKeys[section.id] ?? "toolbarCustom.missing")}
            </span>
            <div className="adp-button-row">
              <Switch
                checked={section.visible}
                label={section.visible ? t("shellCustom.hide") : t("shellCustom.show")}
                onChange={(visible) =>
                  setDraft((current) => ({
                    ...current,
                    sections: current.sections.map((entry) => (entry.id === section.id ? { ...entry, visible } : entry)),
                  }))
                }
              />
              <button
                type="button"
                className="adp-icon-btn"
                aria-label={t("shellCustom.up")}
                title={t("shellCustom.up")}
                disabled={sectionIndex === 0}
                onClick={() => moveSection(section.id, -1)}
              >
                <MoveUp size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="adp-icon-btn"
                aria-label={t("shellCustom.down")}
                title={t("shellCustom.down")}
                disabled={sectionIndex === draft.sections.length - 1}
                onClick={() => moveSection(section.id, 1)}
              >
                <MoveDown size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          {section.items.map((item, itemIndex) => {
            const missing = item.kind === "folder" && props.pathStatus?.(item.target_id) === "missing";
            return (
              <div key={item.id} className="adp-navigation-editor__item" data-nav-item={item.id}>
                <div className="adp-navigation-editor__item-main">
                  <span className="adp-navigation-editor__path" title={displayPath(item.target_id)}>
                    {displayPath(item.target_id)}
                  </span>
                  {item.kind === "folder" ? (
                    <TextInput
                      ariaLabel={t("shellCustom.displayName")}
                      value={item.display_label ?? ""}
                      placeholder={t("shellCustom.displayName")}
                      maxLength={60}
                      onChange={(text) =>
                        setDraft((current) => ({
                          ...current,
                          sections: current.sections.map((entry) =>
                            entry.id !== section.id
                              ? entry
                              : {
                                  ...entry,
                                  items: entry.items.map((candidate) =>
                                    candidate.id === item.id
                                      ? {
                                          ...candidate,
                                          ...(text.trim() === "" ? { display_label: undefined } : { display_label: text }),
                                        }
                                      : candidate,
                                  ),
                                },
                          ),
                        }))
                      }
                    />
                  ) : null}
                  {missing ? (
                    <>
                      <span className="adp-navigation-editor__warning">{t("shellCustom.missingFolder")}</span>
                      <button
                        type="button"
                        className="adp-btn"
                        aria-label={t("shellCustom.locate")}
                        onClick={() => props.onLocate?.(item.target_id)}
                      >
                        <LocateFixed size={16} aria-hidden="true" /> {t("shellCustom.locate")}
                      </button>
                    </>
                  ) : null}
                </div>
                <div className="adp-button-row">
                  <Switch
                    checked={item.visible}
                    label={item.visible ? t("shellCustom.hide") : t("shellCustom.show")}
                    onChange={(visible) =>
                      setDraft((current) => ({
                        ...current,
                        sections: current.sections.map((entry) =>
                          entry.id !== section.id
                            ? entry
                            : {
                                ...entry,
                                items: entry.items.map((candidate) =>
                                  candidate.id === item.id ? { ...candidate, visible } : candidate,
                                ),
                              },
                        ),
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="adp-icon-btn"
                    aria-label={t("shellCustom.up")}
                    title={t("shellCustom.up")}
                    disabled={itemIndex === 0}
                    onClick={() => moveItem(section.id, item.id, -1)}
                  >
                    <MoveUp size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="adp-icon-btn"
                    aria-label={t("shellCustom.down")}
                    title={t("shellCustom.down")}
                    disabled={itemIndex === section.items.length - 1}
                    onClick={() => moveItem(section.id, item.id, 1)}
                  >
                    <MoveDown size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="adp-icon-btn"
                    aria-label={t("shellCustom.remove")}
                    title={t("shellCustom.remove")}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        sections: current.sections.map((entry) =>
                          entry.id !== section.id
                            ? entry
                            : { ...entry, items: entry.items.filter((candidate) => candidate.id !== item.id) },
                        ),
                      }))
                    }
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <div className="adp-navigation-editor__add">
        <TextInput ariaLabel={t("shellCustom.folderPath")} value={path} onChange={setPath} />
        <TextInput ariaLabel={t("shellCustom.displayName")} value={label} placeholder={t("shellCustom.displayName")} maxLength={60} onChange={setLabel} />
        <Button disabled={customItems >= MAX_CUSTOM_NAV_ITEMS} onClick={addFolder}>
          <FolderPlus size={16} aria-hidden="true" /> {t("shellCustom.addFolder")}
        </Button>
      </div>
      <div className="adp-navigation-editor__add">
        <TextInput ariaLabel={t("shellCustom.section")} value={sectionName} placeholder={t("shellCustom.section")} maxLength={60} onChange={setSectionName} />
        <Button disabled={customSections >= MAX_CUSTOM_NAV_SECTIONS} onClick={addSection}>
          {t("shellCustom.addSection")}
        </Button>
      </div>

      {error ? <p className="adp-menu-editor__error">{errorText(t, error, "catalog")}</p> : null}
      <div className="adp-button-row">
        <Button disabled={applying} onClick={() => void apply()}>
          {t("common.apply")}
        </Button>
        <Button disabled={applying} onClick={props.onCancel}>
          {t("common.cancel")}
        </Button>
        <Button disabled={applying} onClick={() => setDraft(defaultNavigationCustomization())}>
          <RotateCcw size={16} aria-hidden="true" /> {t("shellCustom.reset")}
        </Button>
      </div>
    </section>
  );
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** A new section id never collides with a saved custom section. */
function nextSectionId(sections: readonly { id: string }[]): string {
  let index = 0;
  while (sections.some((section) => section.id === `custom_${index}`)) index += 1;
  return `custom_${index}`;
}
let itemCounter = 0;

function createItemId(): string {
  const fromCrypto = globalThis.crypto?.randomUUID?.();
  if (fromCrypto) return fromCrypto;
  itemCounter += 1;
  return `00000000-0000-4000-a000-${String(Date.now() + itemCounter).slice(-12).padStart(12, "0")}`;
}
