/** Settings > Layout (Step 05c): where the toolbar, the tabs and the panes
 * go, and the layout presets. */
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import HelpButton from "../../components/HelpButton";
import Switch from "../../components/Switch";
import TextInput from "../../components/TextInput";
import {
  BUILT_IN_PRESETS,
  BUILT_IN_PRESET_IDS,
  PRESET_LABEL_KEYS,
  applyLayoutValues,
  matchingPreset,
  presetNameError,
  withSavedPreset,
  withoutSavedPreset,
  type BuiltInPresetId,
} from "../../layout/presets";
import {
  MAX_LAYOUT_NAME,
  MAX_SAVED_LAYOUTS,
  type DetailsPanePosition,
  type LayoutSettings as LayoutValues,
  type NavPanePosition,
  type TabBarPosition,
  type ToolbarMode,
  type ToolbarPosition,
} from "../../services/settings";

export interface LayoutSettingsProps {
  layout: LayoutValues;
  /** The Details pane is shown (its visibility stays a View toggle). */
  detailsPane: boolean;
  /** One call per change, so the layout and the pane go together. */
  onChange: (layout: LayoutValues, detailsPane: boolean) => void;
  onOpenHelp: (slug: string) => void;
}

const PLACES = [
  { value: "top", labelKey: "settings.placeTop" },
  { value: "bottom", labelKey: "settings.placeBottom" },
  { value: "left", labelKey: "settings.placeLeft" },
  { value: "right", labelKey: "settings.placeRight" },
] as const;

const MODES = [
  { value: "full", labelKey: "commands.toolbarFull" },
  { value: "compact", labelKey: "commands.toolbarCompact" },
  { value: "iconsOnly", labelKey: "commands.toolbarIconsOnly" },
  { value: "autoHide", labelKey: "commands.toolbarAutoHide" },
] as const;

export default function LayoutSettings({ layout, detailsPane, onChange, onOpenHelp }: LayoutSettingsProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  const match = matchingPreset(layout);
  const presetValue = match === null ? "custom" : match.kind === "builtIn" ? `builtin:${match.id}` : `saved:${match.index}`;
  const atLimit = layout.saved_presets.length >= MAX_SAVED_LAYOUTS;
  const nameError = name === "" ? null : presetNameError(name, layout);
  const sideTabBar = layout.tab_bar_position === "left" || layout.tab_bar_position === "right";

  const choosePreset = (value: string) => {
    if (value.startsWith("builtin:")) {
      const id = value.slice("builtin:".length) as BuiltInPresetId;
      if (BUILT_IN_PRESET_IDS.includes(id)) {
        onChange(applyLayoutValues(layout, BUILT_IN_PRESETS[id]), detailsPane);
      }
      return;
    }
    if (value.startsWith("saved:")) {
      const preset = layout.saved_presets[Number(value.slice("saved:".length))];
      if (preset) onChange(applyLayoutValues(layout, preset), detailsPane);
    }
  };

  const save = () => {
    if (presetNameError(name, layout) !== null) return;
    onChange(withSavedPreset(layout, name), detailsPane);
    setSaving(false);
    setName("");
  };

  return (
    <section className="adp-settings-section" aria-labelledby="adp-layout-title">
      <div className="adp-view-header">
        <h3 id="adp-layout-title" className="adp-heading">
          {t("settings.layout")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("moving-toolbars-and-panels")} />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("layout.preset")}</span>
        <div className="adp-button-row">
          <select
            className="adp-defaultapps-select"
            aria-label={t("layout.preset")}
            data-layout-field="preset"
            value={presetValue}
            onChange={(event) => choosePreset(event.target.value)}
          >
            {BUILT_IN_PRESET_IDS.map((id) => (
              <option key={id} value={`builtin:${id}`}>
                {t(PRESET_LABEL_KEYS[id])}
              </option>
            ))}
            {layout.saved_presets.map((preset, index) => (
              <option key={preset.name} value={`saved:${index}`}>
                {preset.name}
              </option>
            ))}
            {match === null ? (
              <option value="custom" disabled>
                {t("settings.layoutCustom")}
              </option>
            ) : null}
          </select>
          <HelpButton onOpenHelp={() => onOpenHelp("layout-presets")} />
        </div>
      </div>
      <div className="adp-setting-row">
        <Button disabled={atLimit} onClick={() => setSaving(true)}>
          {t("settings.layoutSave")}
        </Button>
        {atLimit ? <p className="adp-note">{t("settings.layoutFull", { max: MAX_SAVED_LAYOUTS })}</p> : null}
      </div>
      {layout.saved_presets.length > 0 ? (
        <div className="adp-setting-row">
          <span className="adp-setting-label">{t("settings.layoutSaved")}</span>
          <ul className="adp-layout-presets">
            {layout.saved_presets.map((preset, index) => (
              <li key={preset.name} className="adp-layout-preset">
                <span>{preset.name}</span>
                <button
                  type="button"
                  className="adp-icon-btn"
                  aria-label={t("settings.layoutDelete", { name: preset.name })}
                  title={t("settings.layoutDelete", { name: preset.name })}
                  onClick={() => onChange(withoutSavedPreset(layout, index), detailsPane)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("layout.toolbarPosition")}</span>
        <select
          className="adp-defaultapps-select"
          aria-label={t("layout.toolbarPosition")}
          data-layout-field="toolbar_position"
          value={layout.toolbar_position}
          onChange={(event) =>
            onChange({ ...layout, toolbar_position: event.target.value as ToolbarPosition }, detailsPane)
          }
        >
          {PLACES.map((place) => (
            <option key={place.value} value={place.value}>
              {t(place.labelKey)}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("layout.toolbarStyle")}</span>
        <select
          className="adp-defaultapps-select"
          aria-label={t("layout.toolbarStyle")}
          data-layout-field="toolbar_mode"
          value={layout.toolbar_mode}
          onChange={(event) => onChange({ ...layout, toolbar_mode: event.target.value as ToolbarMode }, detailsPane)}
        >
          {MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {t(mode.labelKey)}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.tabBarPosition")}</span>
        <select
          className="adp-defaultapps-select"
          aria-label={t("settings.tabBarPosition")}
          data-layout-field="tab_bar_position"
          value={layout.tab_bar_position}
          onChange={(event) =>
            onChange({ ...layout, tab_bar_position: event.target.value as TabBarPosition }, detailsPane)
          }
        >
          {PLACES.map((place) => (
            <option key={place.value} value={place.value}>
              {t(place.labelKey)}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <Switch
          label={t("settings.tabBarCollapsed")}
          checked={layout.tab_bar_collapsed}
          disabled={!sideTabBar}
          onChange={(checked) => onChange({ ...layout, tab_bar_collapsed: checked }, detailsPane)}
        />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.navPane")}</span>
        <select
          className="adp-defaultapps-select"
          aria-label={t("settings.navPane")}
          data-layout-field="nav_pane_position"
          value={layout.nav_pane_position}
          onChange={(event) =>
            onChange({ ...layout, nav_pane_position: event.target.value as NavPanePosition }, detailsPane)
          }
        >
          <option value="left">{t("settings.placeLeft")}</option>
          <option value="right">{t("settings.placeRight")}</option>
          <option value="hidden">{t("settings.placeHidden")}</option>
        </select>
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.detailsPanePlace")}</span>
        <select
          className="adp-defaultapps-select"
          aria-label={t("settings.detailsPanePlace")}
          data-layout-field="details_pane"
          value={detailsPane ? layout.details_pane_position : "hidden"}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "hidden") {
              onChange(layout, false);
              return;
            }
            onChange({ ...layout, details_pane_position: value as DetailsPanePosition }, true);
          }}
        >
          <option value="right">{t("settings.placeRight")}</option>
          <option value="bottom">{t("settings.placeBottom")}</option>
          <option value="hidden">{t("settings.placeHidden")}</option>
        </select>
      </div>
      {saving ? (
        <Dialog title={t("settings.layoutSaveTitle")} onClose={() => setSaving(false)}>
          <div
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
            }}
          >
            <TextInput value={name} onChange={setName} ariaLabel={t("settings.layoutPresetName")} />
            {nameError === "tooLong" ? (
              <p className="adp-note" role="alert">
                {t("settings.layoutNameTooLong", { max: MAX_LAYOUT_NAME })}
              </p>
            ) : null}
            {nameError === "duplicate" ? (
              <p className="adp-note" role="alert">
                {t("settings.layoutNameDuplicate")}
              </p>
            ) : null}
          </div>
          <div className="adp-dialog-actions">
            <Button variant="primary" disabled={presetNameError(name, layout) !== null} onClick={save}>
              {t("common.save")}
            </Button>
            <Button onClick={() => setSaving(false)}>{t("common.cancel")}</Button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
