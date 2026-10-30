import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import Button from "../../components/Button";
import Slider from "../../components/Slider";
import Switch from "../../components/Switch";
import { VIEW_MODE_ICONS, VIEW_MODE_LABEL_KEYS } from "../../commands/explorerCommands";
import { errorText } from "../../services/errors";
import { clearFolderViews } from "../../services/folderViews";
import {
  COLUMN_WIDTH_MAX,
  COLUMN_WIDTH_MIN,
  clampColumnWidth,
  type ExplorerViewSettings,
  type ViewModeId,
} from "../../services/settings";
import { visibleViewModes } from "../explorer/views/viewModes";

/** Swaps a view with its neighbour in that direction (Step 05a). */
export function moveViewMode(order: readonly ViewModeId[], mode: ViewModeId, delta: -1 | 1): ViewModeId[] {
  const list = [...order];
  const index = list.indexOf(mode);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return list;
  [list[index], list[target]] = [list[target], list[index]];
  return list;
}

/** Hides or shows a view; hiding the default view resets it to Details. */
export function withViewModeHidden(
  explorer: ExplorerViewSettings,
  mode: ViewModeId,
  hidden: boolean,
): ExplorerViewSettings {
  if (mode === "details") return explorer;
  if (hidden) {
    return {
      ...explorer,
      hidden_view_modes: explorer.hidden_view_modes.includes(mode)
        ? explorer.hidden_view_modes
        : [...explorer.hidden_view_modes, mode],
      view_mode: explorer.view_mode === mode ? "details" : explorer.view_mode,
    };
  }
  return { ...explorer, hidden_view_modes: explorer.hidden_view_modes.filter((entry) => entry !== mode) };
}

export interface ViewsSettingsProps {
  explorer: ExplorerViewSettings;
  onChange: (explorer: ExplorerViewSettings) => void;
  onOpenHelp: (slug: string) => void;
}

/** Settings > Views (Step 05a D9). */
export default function ViewsSettings({ explorer, onChange, onOpenHelp }: ViewsSettingsProps) {
  const { t } = useTranslation();
  const [forgetting, setForgetting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const forget = async () => {
    setForgetting(true);
    setNote(null);
    try {
      await clearFolderViews();
      setNote(t("settings.viewsForgotten"));
    } catch (error) {
      setNote(errorText(t, error, "folderViews"));
    } finally {
      setForgetting(false);
    }
  };

  return (
    <section className="adp-settings-section" aria-labelledby="adp-views-title">
      <div className="adp-view-header">
        <h3 id="adp-views-title" className="adp-heading">
          {t("settings.views")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("view-modes")} />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.viewsDefault")}</span>
        <select
          className="adp-defaultapps-select"
          aria-label={t("settings.viewsDefault")}
          value={explorer.view_mode}
          onChange={(event) => onChange({ ...explorer, view_mode: event.target.value as ViewModeId })}
        >
          {visibleViewModes(explorer).map((mode) => (
            <option key={mode} value={mode}>
              {t(VIEW_MODE_LABEL_KEYS[mode])}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <Switch
          label={t("settings.viewsRemember")}
          checked={explorer.remember_view_per_folder}
          onChange={(checked) => onChange({ ...explorer, remember_view_per_folder: checked })}
        />
        <p className="adp-note">{t("settings.viewsRememberNote")}</p>
      </div>
      <div className="adp-setting-row">
        <Button disabled={forgetting} onClick={() => void forget()}>
          {t("settings.viewsForget")}
        </Button>
        {note ? (
          <p className="adp-note" role="status">
            {note}
          </p>
        ) : null}
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.viewsMenu")}</span>
        <p className="adp-note">{t("settings.viewsMenuNote")}</p>
        <ul className="adp-views-list">
          {explorer.view_mode_order.map((mode, index) => {
            const name = t(VIEW_MODE_LABEL_KEYS[mode]);
            const Icon = VIEW_MODE_ICONS[mode];
            return (
              <li key={mode} className="adp-views-item">
                <Icon size={16} aria-hidden="true" />
                <Switch
                  label={name}
                  checked={!explorer.hidden_view_modes.includes(mode)}
                  disabled={mode === "details"}
                  onChange={(checked) => onChange(withViewModeHidden(explorer, mode, !checked))}
                />
                <button
                  type="button"
                  className="adp-icon-btn"
                  aria-label={t("settings.viewsMoveUp", { name })}
                  title={t("settings.viewsMoveUp", { name })}
                  disabled={index === 0}
                  onClick={() => onChange({ ...explorer, view_mode_order: moveViewMode(explorer.view_mode_order, mode, -1) })}
                >
                  <ChevronUp size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="adp-icon-btn"
                  aria-label={t("settings.viewsMoveDown", { name })}
                  title={t("settings.viewsMoveDown", { name })}
                  disabled={index === explorer.view_mode_order.length - 1}
                  onClick={() => onChange({ ...explorer, view_mode_order: moveViewMode(explorer.view_mode_order, mode, 1) })}
                >
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <h4 className="adp-heading">{t("settings.viewsColumns")}</h4>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.columnWidth")}</span>
        <Slider
          value={explorer.column_width}
          min={COLUMN_WIDTH_MIN}
          max={COLUMN_WIDTH_MAX}
          label={t("settings.columnWidth")}
          onChange={(value) => onChange({ ...explorer, column_width: clampColumnWidth(value) })}
        />
        <p className="adp-note">{t("settings.columnWidthNote")}</p>
      </div>
      <div className="adp-setting-row">
        <Switch
          label={t("settings.columnPreview")}
          checked={explorer.column_preview}
          onChange={(checked) => onChange({ ...explorer, column_preview: checked })}
        />
      </div>
    </section>
  );
}
