import { Cloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import Button from "../../../components/Button";
import type { ExplorerItem } from "../../../services/explorer";
import { formatDate, formatSize } from "../../../services/format";
import { displayName } from "../../../services/names";
import { fileTile } from "../fileTile";

export interface ColumnPreviewProps {
  item: ExplorerItem;
  width: number;
  showExtensions: boolean;
  typeLabel: (item: ExplorerItem) => string;
  onOpen: (item: ExplorerItem) => void;
}

/** The preview column of Column view (Step 05b D14): type, name, size and
 * date, then Open. It reads nothing from the file (R-FS-1). */
export default function ColumnPreview({ item, width, showExtensions, typeLabel, onOpen }: ColumnPreviewProps) {
  const { t, i18n } = useTranslation();
  const tile = fileTile(item.name, item.kind);
  const Icon = tile.icon;
  const shownName = displayName(item.name, item.kind, showExtensions);
  return (
    <aside className="adp-colview-preview" aria-label={t("explorer.columnPreview")} style={{ width }}>
      <span className={`adp-file-tile adp-file-tile--${tile.tone} adp-colview-preview-tile`} aria-hidden="true">
        <Icon size={48} aria-hidden="true" />
      </span>
      <span className="adp-colview-preview-name" title={shownName}>
        {shownName}
      </span>
      <span className="adp-colview-preview-type">{typeLabel(item)}</span>
      <dl className="adp-colview-preview-facts">
        <dt>{t("explorer.details.size")}</dt>
        <dd>{formatSize(item.size, i18n.language)}</dd>
        <dt>{t("explorer.details.modified")}</dt>
        <dd>{item.modified_unix > 0 ? formatDate(item.modified_unix, i18n.language) : ""}</dd>
      </dl>
      {item.online_only ? (
        <span className="adp-colview-preview-cloud">
          <Cloud size={12} aria-hidden="true" />
          {t("explorer.onlineOnly")}
        </span>
      ) : null}
      <Button onClick={() => onOpen(item)}>{t("commands.open")}</Button>
    </aside>
  );
}
