/** Settings > Keyboard shortcuts (Step 10b E5, D5-D9). The editor edits the
 * active map; the bare-navigation switch is a plain setting outside it. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import Switch from "../../components/Switch";
import ShortcutEditor from "../../keyboard/ShortcutEditor";
import { keyboardPreset, type KeyboardPresetId } from "../../keyboard/presets";
import {
  isBuiltinMapId,
  type KeyboardCustomSettings,
  type KeyboardMap,
  type ShortcutBinding,
} from "../../keyboard/types";

export interface KeyboardSettingsProps {
  keyboard: KeyboardCustomSettings;
  /** Registered command defaults (Windows preset), so choosing a style
   * starts from real shortcuts instead of unsaved edits. */
  defaults: readonly ShortcutBinding[];
  labels?: Readonly<Record<string, string>>;
  onApplyMap: (map: KeyboardMap) => Promise<void>;
  onBareNavigationChange: (enabled: boolean) => void;
  onOpenHelp: (slug: string) => void;
}

const HELP_SLUG = "keyboard-styles";

/** The map the editor starts from: the saved custom map, or the builtin
 * preset rebuilt from the registered defaults. */
export function activeKeyboardMap(
  keyboard: KeyboardCustomSettings,
  defaults: readonly ShortcutBinding[],
): KeyboardMap {
  const custom = keyboard.custom_maps.find((map) => map.id === keyboard.active_map);
  if (custom) return custom;
  const builtin = isBuiltinMapId(keyboard.active_map) ? keyboard.active_map : "builtin:windows";
  const preset = builtin.slice("builtin:".length) as KeyboardPresetId;
  return keyboardPreset(preset, defaults);
}

export default function KeyboardSettings({
  keyboard,
  defaults,
  labels,
  onApplyMap,
  onBareNavigationChange,
  onOpenHelp,
}: KeyboardSettingsProps) {
  const { t } = useTranslation();
  const [revision, setRevision] = useState(0);
  const openHelp = () => onOpenHelp(HELP_SLUG);

  return (
    <section className="adp-settings-section" aria-labelledby="adp-keyboard-title">
      <div className="adp-settings-section-header">
        <h3 id="adp-keyboard-title">{t("keyboard.title")}</h3>
        <HelpButton onOpenHelp={openHelp} />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={keyboard.allow_bare_navigation}
          onChange={onBareNavigationChange}
          label={t("keyboard.bare")}
        />
      </div>
      <ShortcutEditor
        key={revision}
        map={activeKeyboardMap(keyboard, defaults)}
        defaults={defaults}
        labels={labels}
        onApply={onApplyMap}
        onCancel={() => setRevision((current) => current + 1)}
        onOpenHelp={openHelp}
      />
    </section>
  );
}
