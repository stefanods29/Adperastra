/** Settings > Clipboard history (Step 09j). Windows-wide capture and
 * encrypted persistence are separate opt-ins; both stay off until the
 * user turns them on. */
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import Switch from "../../components/Switch";
import type { ClipboardHistorySettings as ClipboardHistorySettingsValue } from "../../services/clipboardHistory";

export interface ClipboardHistorySettingsProps {
  value: ClipboardHistorySettingsValue;
  onChange: (value: ClipboardHistorySettingsValue) => void;
  onOpenHelp: (slug: string) => void;
}

export default function ClipboardHistorySettings({
  value,
  onChange,
  onOpenHelp,
}: ClipboardHistorySettingsProps) {
  const { t } = useTranslation();

  return (
    <section className="adp-settings-section" aria-labelledby="adp-clipboard-history-title">
      <div className="adp-view-header">
        <h3 id="adp-clipboard-history-title" className="adp-heading">
          {t("clipboardHistory.title")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("clipboard-history")} />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={value.capture_windows}
          label={t("clipboardHistory.windows")}
          onChange={(capture_windows) => onChange({ ...value, capture_windows })}
        />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={value.persist}
          label={t("clipboardHistory.persist")}
          onChange={(persist) => onChange({ ...value, persist })}
        />
        {value.persist ? <p className="adp-note">{t("clipboardHistory.persistWarning")}</p> : null}
      </div>
    </section>
  );
}
