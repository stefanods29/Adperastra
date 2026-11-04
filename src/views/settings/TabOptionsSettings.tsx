/** Settings > Tab options and Behavior (Step 10c T2).
 *
 * Both components edit plain preference data; the tab host applies the
 * values through the 09a/09b reducers. The permanent Explorer tab is never
 * affected by these choices.
 */
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import Switch from "../../components/Switch";
import type { AppSettings } from "../../services/settings";
import {
  CLOSE_ACTIVATIONS,
  CLOSE_BUTTON_MODES,
  CONFIRMATION_KEYS,
  HOVER_DELAY_MAX,
  HOVER_DELAY_MIN,
  NEW_TAB_POSITIONS,
  OPEN_CLICKS,
  TAB_OVERFLOWS,
  TAB_WIDTH_FIT_MAX,
  TAB_WIDTH_FIT_MIN,
  TAB_WIDTH_FIXED_MAX,
  TAB_WIDTH_FIXED_MIN,
  TAB_WIDTH_MODES,
  TITLE_LIMIT_MAX,
  TITLE_LIMIT_MIN,
  type BehaviorSettings as BehaviorSettingsValue,
  type CloseActivation,
  type CloseButtonMode,
  type NewTabPosition,
  type OpenClick,
  type TabOverflow,
  type TabWidthMode,
} from "../../services/tabOptions";

export interface TabOptionsSettingsProps {
  settings: AppSettings;
  onApply: (settings: AppSettings) => void;
  onOpenHelp: (slug: string) => void;
}

const WIDTH_KEYS: Record<TabWidthMode, string> = {
  compact: "tabOptions.valueCompact",
  fixed: "tabOptions.valueFixed",
  fit: "tabOptions.valueFit",
};

const CLOSE_KEYS: Record<CloseButtonMode, string> = {
  always: "tabOptions.valueAlways",
  hover: "tabOptions.valueOnHover",
};

const POSITION_KEYS: Record<NewTabPosition, string> = {
  end: "tabOptions.valueAtEnd",
  after_active: "tabOptions.valueAfterCurrent",
};

const ACTIVATION_KEYS: Record<CloseActivation, string> = {
  mru: "tabOptions.valuePreviousActive",
  right: "tabOptions.valueToTheRight",
};

const OVERFLOW_KEYS: Record<TabOverflow, string> = {
  scroll: "tabOptions.valueScroll",
  shrink: "tabOptions.valueShrink",
};

export default function TabOptionsSettings({ settings, onApply, onOpenHelp }: TabOptionsSettingsProps) {
  const { t } = useTranslation();
  const options = settings.tab_options;
  const update = (patch: Partial<AppSettings["tab_options"]>) =>
    onApply({ ...settings, tab_options: { ...options, ...patch } });
  const numberValue = (value: string, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  };

  return (
    <section className="adp-settings-section adp-preferences-section" aria-labelledby="adp-tab-options-title">
      <div className="adp-view-header">
        <h3 id="adp-tab-options-title" className="adp-heading">
          {t("tabOptions.title")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("tab-options")} />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-tab-width">
          {t("tabOptions.width")}
        </label>
        <select
          id="adp-tab-width"
          className="adp-defaultapps-select"
          value={options.width_mode}
          onChange={(event) => update({ width_mode: event.target.value as TabWidthMode })}
        >
          {TAB_WIDTH_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(WIDTH_KEYS[mode])}
            </option>
          ))}
        </select>
      </div>
      {options.width_mode === "fixed" ? (
        <div className="adp-setting-row">
          <label className="adp-setting-label" htmlFor="adp-tab-fixed-width">
            {t("tabOptions.fixedWidth")}
          </label>
          <input
            id="adp-tab-fixed-width"
            className="adp-input adp-input--number"
            type="number"
            min={TAB_WIDTH_FIXED_MIN}
            max={TAB_WIDTH_FIXED_MAX}
            value={options.fixed_width_px}
            onChange={(event) => update({ fixed_width_px: numberValue(event.target.value, 180) })}
          />
        </div>
      ) : null}
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-tab-close">
          {t("tabOptions.close")}
        </label>
        <select
          id="adp-tab-close"
          className="adp-defaultapps-select"
          value={options.close_button}
          onChange={(event) => update({ close_button: event.target.value as CloseButtonMode })}
        >
          {CLOSE_BUTTON_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(CLOSE_KEYS[mode])}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-tab-position">
          {t("tabOptions.newPosition")}
        </label>
        <select
          id="adp-tab-position"
          className="adp-defaultapps-select"
          value={options.new_position}
          onChange={(event) => update({ new_position: event.target.value as NewTabPosition })}
        >
          {NEW_TAB_POSITIONS.map((position) => (
            <option key={position} value={position}>
              {t(POSITION_KEYS[position])}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-tab-activation">
          {t("tabOptions.closeActivation")}
        </label>
        <select
          id="adp-tab-activation"
          className="adp-defaultapps-select"
          value={options.close_activation}
          onChange={(event) => update({ close_activation: event.target.value as CloseActivation })}
        >
          {CLOSE_ACTIVATIONS.map((activation) => (
            <option key={activation} value={activation}>
              {t(ACTIVATION_KEYS[activation])}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={options.hover_preview}
          label={t("tabOptions.preview")}
          onChange={(checked) => update({ hover_preview: checked })}
        />
      </div>
      {options.hover_preview ? (
        <div className="adp-setting-row">
          <label className="adp-setting-label" htmlFor="adp-tab-delay">
            {t("tabOptions.delay")}
          </label>
          <input
            id="adp-tab-delay"
            className="adp-input adp-input--number"
            type="number"
            min={HOVER_DELAY_MIN}
            max={HOVER_DELAY_MAX}
            step={100}
            value={options.hover_delay_ms}
            onChange={(event) => update({ hover_delay_ms: numberValue(event.target.value, 500) })}
          />
        </div>
      ) : null}
      <div className="adp-setting-row">
        <Switch
          checked={options.type_icons}
          label={t("tabOptions.icons")}
          onChange={(checked) => update({ type_icons: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={options.type_underline}
          label={t("tabOptions.underline")}
          onChange={(checked) => update({ type_underline: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-tab-title-limit">
          {t("tabOptions.titleLimit")}
        </label>
        <input
          id="adp-tab-title-limit"
          className="adp-input adp-input--number"
          type="number"
          min={TITLE_LIMIT_MIN}
          max={TITLE_LIMIT_MAX}
          value={options.title_limit}
          onChange={(event) => update({ title_limit: numberValue(event.target.value, 40) })}
        />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-tab-overflow">
          {t("tabOptions.overflow")}
        </label>
        <select
          id="adp-tab-overflow"
          className="adp-defaultapps-select"
          value={options.overflow}
          onChange={(event) => update({ overflow: event.target.value as TabOverflow })}
        >
          {TAB_OVERFLOWS.map((overflow) => (
            <option key={overflow} value={overflow}>
              {t(OVERFLOW_KEYS[overflow])}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={options.double_click_new}
          label={t("tabOptions.doubleClick")}
          onChange={(checked) => update({ double_click_new: checked })}
        />
      </div>
      <p className="adp-note">{t("tabOptions.notes")}</p>
      <p className="adp-note">
        {t("tabOptions.fitHint", { min: TAB_WIDTH_FIT_MIN, max: TAB_WIDTH_FIT_MAX })}
      </p>
    </section>
  );
}

const OPEN_CLICK_KEYS: Record<OpenClick, string> = {
  single: "behavior.valueSingle",
  double: "behavior.valueDouble",
};

const CONFIRMATION_KEYS_BY_NAME: Record<string, string> = {
  recycle: "behavior.confirmRecycle",
  move: "behavior.confirmMove",
  rename: "behavior.confirmRename",
  convert: "behavior.confirmConvert",
  clean: "behavior.confirmClean",
  save: "behavior.confirmSave",
};

export interface BehaviorSettingsProps {
  behavior: BehaviorSettingsValue;
  onChange: (behavior: BehaviorSettingsValue) => void;
  onOpenHelp: (slug: string) => void;
}

export function BehaviorSettings({ behavior, onChange, onOpenHelp }: BehaviorSettingsProps) {
  const { t } = useTranslation();
  const update = (patch: Partial<BehaviorSettingsValue>) => onChange({ ...behavior, ...patch });
  const setConfirmation = (key: (typeof CONFIRMATION_KEYS)[number], value: boolean) =>
    onChange({ ...behavior, confirmations: { ...behavior.confirmations, [key]: value } });

  return (
    <section className="adp-settings-section adp-preferences-section" aria-labelledby="adp-behavior-title">
      <div className="adp-view-header">
        <h3 id="adp-behavior-title" className="adp-heading">
          {t("behavior.title")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("opening-files")} />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-open-click">
          {t("behavior.openClick")}
        </label>
        <select
          id="adp-open-click"
          className="adp-defaultapps-select"
          value={behavior.open_click}
          onChange={(event) => update({ open_click: event.target.value as OpenClick })}
        >
          {OPEN_CLICKS.map((click) => (
            <option key={click} value={click}>
              {t(OPEN_CLICK_KEYS[click])}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={behavior.confirm_changes}
          label={t("behavior.confirm")}
          onChange={(checked) => update({ confirm_changes: checked })}
        />
      </div>
      {CONFIRMATION_KEYS.map((key) => (
        <div className="adp-setting-row" key={key}>
          <Switch
            checked={behavior.confirmations[key]}
            disabled={!behavior.confirm_changes}
            label={t(CONFIRMATION_KEYS_BY_NAME[key])}
            onChange={(checked) => setConfirmation(key, checked)}
          />
        </div>
      ))}
      <p className="adp-note">{t("behavior.mandatoryNote")}</p>
    </section>
  );
}
