import { HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DriveInfo, DriveItem } from "../../services/explorer";
import { formatSize } from "../../services/format";

export type DriveLoadState =
  | { status: "loading" }
  | { status: "not-available" }
  | { status: "ready"; info: DriveInfo };

export interface DriveListProps {
  drives: DriveItem[];
  states: Record<string, DriveLoadState>;
  onOpenDrive: (root: string) => void;
}

export default function DriveList(props: DriveListProps) {
  const { t, i18n } = useTranslation();
  return (
    <div className="adp-drives">
      <h2 className="adp-heading">{t("explorer.drivesTitle")}</h2>
      <div className="adp-drive-grid">
        {props.drives.map((drive) => {
          const state = props.states[drive.root] ?? { status: "loading" as const };
          const label = state.status === "ready" && state.info.label ? state.info.label : drive.root;
          return (
            <button key={drive.root} type="button" className="adp-drive-card" aria-label={t("explorer.openDrive", { name: label })} onClick={() => props.onOpenDrive(drive.root)}>
              <HardDrive size={22} aria-hidden="true" />
              <span className="adp-drive-text">
                <span className="adp-drive-name">{label} ({drive.root.replace(/\\$/, "")})</span>
                {state.status === "loading" ? <span className="adp-note">{t("explorer.driveStillLoading")}</span> : null}
                {state.status === "not-available" ? <span className="adp-note">{t("explorer.driveNotAvailable")}</span> : null}
                {state.status === "ready" && state.info.total_bytes !== null && state.info.free_bytes !== null ? (
                  <>
                    <span className="adp-drive-bar"><span className="adp-drive-bar-used" style={{ width: `${Math.max(0, Math.min(100, ((state.info.total_bytes - state.info.free_bytes) / Math.max(1, state.info.total_bytes)) * 100))}%` }} /></span>
                    <span className="adp-note">{t("explorer.driveSpace", { free: formatSize(state.info.free_bytes, i18n.language), total: formatSize(state.info.total_bytes, i18n.language) })}</span>
                  </>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}