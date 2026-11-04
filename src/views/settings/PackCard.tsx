import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import ProgressBar from "../../components/ProgressBar";
import { errorText } from "../../services/errors";
import { formatSize } from "../../services/format";
import type { PackId, PackState } from "../../services/packTypes";

/** One optional pack row (Step 12a): purpose, version, license and actions. */
export interface PackCardProps {
  pack: PackState;
  busy: boolean;
  onInstall: (id: PackId) => void;
  onUpdate: (id: PackId) => void;
  onRemove: (id: PackId) => void;
  onPause: (id: PackId) => void;
  onResume: (id: PackId) => void;
}

export default function PackCard({
  pack,
  busy,
  onInstall,
  onUpdate,
  onRemove,
  onPause,
  onResume,
}: PackCardProps) {
  const { t, i18n } = useTranslation();
  const name = t(`packs.${pack.id}.name`);
  const description = t(`packs.${pack.id}.description`);
  const license = t(`packs.${pack.id}.license`);
  const installed = pack.state === "installed" || pack.state === "pending_remove";
  const updateAvailable =
    installed &&
    pack.state !== "pending_remove" &&
    pack.available_version !== null &&
    pack.available_version !== pack.installed_version;

  const status = () => {
    if (pack.state === "pending_remove") return t("packs.inUse");
    if (pack.state === "downloading") {
      return `${t("packs.downloading")} ${formatSize(pack.bytes_received, i18n.language)}`;
    }
    if (pack.state === "paused") {
      return `${t("packs.paused")} ${formatSize(pack.bytes_received, i18n.language)}`;
    }
    if (pack.state === "verifying") return t("packs.verifying");
    if (pack.state === "installing") return t("packs.installing");
    if (pack.state === "installed") {
      return t("packs.installedVersion", { version: pack.installed_version ?? "" });
    }
    if (pack.state === "failed") return errorText(t, pack.error_code, "packs");
    return t("packs.statusAbsent");
  };

  return (
    <article className="adp-pack-card" aria-busy={busy} data-pack={pack.id}>
      <div className="adp-pack-card-main">
        <h4 className="adp-pack-card-title">{name}</h4>
        <p className="adp-pack-card-description">{description}</p>
        <p className="adp-pack-card-meta">
          <span>
            {t("packs.versionLabel")} {pack.available_version ?? pack.installed_version ?? "—"}
          </span>
          <span>{license}</span>
        </p>
        <p className="adp-pack-card-status" role="status">
          {status()}
        </p>
        {pack.state === "downloading" ? (
          <ProgressBar label={t("packs.downloading")} />
        ) : null}
      </div>
      <div className="adp-pack-card-actions">
        {pack.state === "absent" || pack.state === "failed" ? (
          <Button
            variant="primary"
            disabled={busy || pack.available_version === null}
            onClick={() => onInstall(pack.id)}
          >
            {t("packs.install")}
          </Button>
        ) : null}
        {updateAvailable ? (
          <Button disabled={busy} onClick={() => onUpdate(pack.id)}>
            {t("packs.update")}
          </Button>
        ) : null}
        {pack.state === "downloading" ? (
          <Button disabled={busy} onClick={() => onPause(pack.id)}>
            {t("packs.pause")}
          </Button>
        ) : null}
        {pack.state === "paused" ? (
          <Button disabled={busy} onClick={() => onResume(pack.id)}>
            {t("packs.resume")}
          </Button>
        ) : null}
        {installed && pack.state !== "pending_remove" ? (
          <Button disabled={busy} onClick={() => onRemove(pack.id)}>
            {t("packs.remove")}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

