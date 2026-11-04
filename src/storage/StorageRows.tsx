import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import { formatSize } from "../services/format";
import type { StorageCategory, StorageReport } from "../services/packTypes";

/** Stored-data rows for Settings > App storage (Step 12a). */
export interface StorageRowsProps {
  reports: StorageReport[];
  busyCategory: StorageCategory | null;
  onClear: (category: StorageCategory) => void;
  onSetLimit: (category: StorageCategory, bytes: number) => void;
}

const BYTES_PER_MB = 1_048_576;
const LIMIT_OPTIONS_MB = [128, 256, 512, 1024, 2048] as const;

export default function StorageRows({
  reports,
  busyCategory,
  onClear,
  onSetLimit,
}: StorageRowsProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className="adp-appstorage-table" role="table" aria-label={t("storage.storedData")}>
      <div className="adp-appstorage-row adp-appstorage-row--header" role="row">
        <span role="columnheader">{t("storage.name")}</span>
        <span role="columnheader">{t("storage.physical")}</span>
        <span role="columnheader">{t("storage.limit")}</span>
        <span role="columnheader">{t("storage.status")}</span>
        <span role="columnheader">{t("storage.action")}</span>
      </div>
      {reports.map((report) => {
        const busy = busyCategory === report.category;
        const limitMb = Math.round(report.limit_bytes / BYTES_PER_MB);
        const options = LIMIT_OPTIONS_MB.includes(limitMb as (typeof LIMIT_OPTIONS_MB)[number])
          ? LIMIT_OPTIONS_MB
          : [...LIMIT_OPTIONS_MB, limitMb].sort((left, right) => left - right);
        return (
          <div
            key={report.category}
            className="adp-appstorage-row"
            role="row"
            data-storage-category={report.category}
          >
            <span role="cell" className="adp-appstorage-name">
              {t(`storage.category.${report.category}`)}
            </span>
            <span role="cell">
              {formatSize(report.disk_bytes, i18n.language)}
              {report.pending_delete_bytes > 0 ? (
                <span className="adp-appstorage-pending">
                  {" "}
                  {t("storage.pendingBytes", {
                    size: formatSize(report.pending_delete_bytes, i18n.language),
                  })}
                </span>
              ) : null}
            </span>
            <span role="cell">
              {report.limit_bytes > 0 ? (
                <select
                  className="adp-defaultapps-select"
                  aria-label={t("storage.limitFor", {
                    category: t(`storage.category.${report.category}`),
                  })}
                  value={limitMb}
                  disabled={busy}
                  onChange={(event) =>
                    onSetLimit(report.category, Number(event.target.value) * BYTES_PER_MB)
                  }
                >
                  {options.map((mb) => (
                    <option key={mb} value={mb}>
                      {formatSize(mb * BYTES_PER_MB, i18n.language)}
                    </option>
                  ))}
                </select>
              ) : (
                "—"
              )}
            </span>
            <span role="cell" aria-live="polite">
              {report.pending_delete_bytes > 0
                ? t("storage.pending")
                : report.busy || busy
                  ? t("storage.busy")
                  : t("common.ready")}
            </span>
            <span role="cell">
              <Button
                disabled={!report.clearable || busy}
                data-storage-clear={report.category}
                onClick={() => onClear(report.category)}
              >
                {t("storage.clear")}
              </Button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
