import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import HelpButton from "../../components/HelpButton";
import Skeleton from "../../components/Skeleton";
import { errorText } from "../../services/errors";
import {
  modernMenuPresentation,
  WINDOWS_ASSOCIATION_EXTENSIONS,
  type IntegrationRequest,
  type IntegrationStatus,
} from "../../services/windowsIntegration";

export interface WindowsIntegrationSettingsProps {
  status: IntegrationStatus | null;
  /** A rejected apply; shown with `errors.windows_integration.*`. */
  error: unknown;
  /** The parent is loading or applying something else. */
  pending: boolean;
  onApply: (request: IntegrationRequest) => Promise<void>;
  onChooseDefaults: () => Promise<void>;
  onOpenHelp: (slug: string) => void;
}

/** Settings > Windows integration. Nothing is selected by default. */
export default function WindowsIntegrationSettings({
  status,
  error,
  pending,
  onApply,
  onChooseDefaults,
  onOpenHelp,
}: WindowsIntegrationSettingsProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const disabled = pending || busy;

  const virtualizer = useVirtualizer({
    count: WINDOWS_ASSOCIATION_EXTENSIONS.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 28,
    overscan: 8,
  });

  const apply = async (next: IntegrationRequest) => {
    if (disabled) return;
    setBusy(true);
    try {
      await onApply(next);
    } catch {
      // The parent owns the translated error; keep the current status.
    } finally {
      setBusy(false);
    }
  };

  const requestFrom = (overrides: Partial<IntegrationRequest>): IntegrationRequest => ({
    classic_enabled: status?.classic_enabled ?? false,
    extensions: status?.associations ?? [],
    start_with_windows: status?.startup_enabled ?? false,
    modern_requested: false,
    ...overrides,
  });

  const toggleAssociation = (extension: string, checked: boolean) => {
    if (!status) return;
    const extensions = checked
      ? [...status.associations, extension]
      : status.associations.filter((current) => current !== extension);
    void apply(requestFrom({ extensions }));
  };

  const modern = modernMenuPresentation(status?.modern ?? "unavailable");

  return (
    <section
      className="adp-settings-section adp-integration-section"
      aria-labelledby="adp-windows-integration-title"
    >
      <div className="adp-view-header">
        <h3 id="adp-windows-integration-title" className="adp-heading">
          {t("windowsIntegration.title")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("windows-integration")} />
      </div>

      {status === null ? (
        <Skeleton variant="rows" count={4} />
      ) : (
        <>
          <label className="adp-integration-check">
            <input
              type="checkbox"
              checked={status.classic_enabled}
              disabled={disabled}
              onChange={() =>
                void apply(
                  requestFrom({ classic_enabled: !status.classic_enabled }),
                )
              }
            />
            <span>{t("windowsIntegration.classic")}</span>
          </label>

          <div className="adp-integration-status">
            <span className="adp-setting-label">{t("windowsIntegration.modern")}</span>
            {modern.state === "enabled" ? (
              <p className="adp-note">{t("windowsIntegration.modernEnabled")}</p>
            ) : modern.state === "unavailable" ? (
              <p className="adp-note">{t("windowsIntegration.modernUnavailable")}</p>
            ) : modern.messageKey ? (
              <p className="adp-note">{t(modern.messageKey)}</p>
            ) : null}
            <Button variant="subtle" onClick={() => onOpenHelp("windows-integration")}>
              {t("windowsIntegration.learnMore")}
            </Button>
          </div>

          <div className="adp-setting-row">
            <span id="adp-integration-associations" className="adp-setting-label">
              {t("windowsIntegration.associations")}
            </span>
            <p className="adp-note">{t("windowsIntegration.associationsNote")}</p>
            <div
              ref={listRef}
              className="adp-integration-list"
              role="group"
              aria-labelledby="adp-integration-associations"
            >
              <div
                className="adp-integration-list-inner"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((row) => {
                  const extension = WINDOWS_ASSOCIATION_EXTENSIONS[row.index];
                  const checked = status.associations.includes(extension);
                  return (
                    <label
                      key={extension}
                      className="adp-integration-row"
                      style={{ transform: `translateY(${row.start}px)` }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleAssociation(extension, !checked)}
                      />
                      <span>.{extension}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="adp-setting-row">
            <Button
              onClick={() => {
                void onChooseDefaults().catch(() => undefined);
              }}
              disabled={disabled}
            >
              {t("windowsIntegration.defaults")}
            </Button>
            <p className="adp-note">{t("windowsIntegration.defaultsNote")}</p>
          </div>
        </>
      )}

      {error ? (
        <p className="adp-note" role="alert">
          {errorText(t, error, "windows_integration")}
        </p>
      ) : status !== null && status.reason_code ? (
        <p className="adp-note" role="alert">
          {errorText(t, status.reason_code, "windows_integration")}
        </p>
      ) : null}
    </section>
  );
}
