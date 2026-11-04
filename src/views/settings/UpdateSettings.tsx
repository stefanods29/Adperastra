/** Settings > General update controls (Step 08d T5).
 *
 * No network request happens when this component appears. Only Check now
 * contacts the release endpoint; the app's opt-in automatic check is a
 * separate startup decision. Updates are never downloaded or installed. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import HelpButton from "../../components/HelpButton";
import Switch from "../../components/Switch";
import { errorText } from "../../services/errors";
import { checkForUpdates, openUpdatePage, type UpdateInfo } from "../../services/updates";

export interface UpdateSettingsProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  /** Lets the settings object keep the native check timestamp in sync. */
  onChecked: (info: UpdateInfo) => void;
  onOpenHelp: (slug: string) => void;
}

type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "done"; info: UpdateInfo }
  | { state: "error"; message: string };

export default function UpdateSettings({
  enabled,
  onEnabledChange,
  onChecked,
  onOpenHelp,
}: UpdateSettingsProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });

  const check = async () => {
    setStatus({ state: "checking" });
    try {
      const info = await checkForUpdates(true);
      onChecked(info);
      setStatus({ state: "done", info });
    } catch (error) {
      setStatus({ state: "error", message: errorText(t, error, "updates") });
    }
  };

  const openPage = async () => {
    try {
      await openUpdatePage();
    } catch (error) {
      setStatus({ state: "error", message: errorText(t, error, "updates") });
    }
  };

  const done = status.state === "done" ? status.info : null;

  return (
    <div className="adp-setting-row" data-settings-updates="true">
      <Switch
        checked={enabled}
        label={t("updates.enable")}
        onChange={onEnabledChange}
      />
      <div className="adp-updates-status">
        <Button
          onClick={() => void check()}
          disabled={status.state === "checking"}
        >
          {t(status.state === "checking" ? "updates.checking" : "updates.checkNow")}
        </Button>
        {done !== null && done.available && done.latest_version ? (
          <>
            <span className="adp-note" role="status">
              {t("updates.available", { version: done.latest_version })}
            </span>
            <Button onClick={() => void openPage()}>{t("updates.openPage")}</Button>
          </>
        ) : null}
        {done && !done.available ? (
          <span className="adp-note" role="status">
            {t("updates.current")}
          </span>
        ) : null}
        {status.state === "error" ? (
          <span className="adp-note" role="status">
            {status.message}
          </span>
        ) : null}
        <HelpButton onOpenHelp={() => onOpenHelp("installing-and-updating")} />
        <Button variant="subtle" onClick={() => onOpenHelp("whats-new-0-1")}>
          {t("updates.whatsNew")}
        </Button>
      </div>
    </div>
  );
}
