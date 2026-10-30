import { ChevronRight, Cloud, Link2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ExplorerItem } from "../../../services/explorer";
import { displayName } from "../../../services/names";
import { fileTile } from "../fileTile";
import { isFolderLike } from "./columnTrail";

export interface ColumnRowContentProps {
  item: ExplorerItem;
  showExtensions: boolean;
  /** The check box, in the open folder's column only. */
  check?: ReactNode;
  /** The rename box, in the open folder's column only. */
  renaming?: ReactNode;
}

/** What is inside one row of a column (Step 05b): the type tile, the name
 * and the badges, like the Details rows. */
export function ColumnRowContent({ item, showExtensions, check, renaming }: ColumnRowContentProps) {
  const { t } = useTranslation();
  const tile = fileTile(item.name, item.kind);
  const Icon = tile.icon;
  const shownName = displayName(item.name, item.kind, showExtensions);
  return (
    <>
      {check}
      <span className={`adp-file-tile adp-file-tile--${tile.tone}`} aria-hidden="true">
        <Icon size={13} aria-hidden="true" />
      </span>
      {renaming !== undefined ? (
        renaming
      ) : (
        <span className="adp-file-name" title={shownName}>
          {shownName}
        </span>
      )}
      {item.online_only ? (
        <span className="adp-file-badge" title={t("explorer.onlineOnly")} aria-label={t("explorer.onlineOnly")}>
          <Cloud size={12} aria-hidden="true" />
        </span>
      ) : null}
      {item.is_link ? (
        <span className="adp-file-badge" title={t("explorer.isLink")} aria-label={t("explorer.isLink")}>
          <Link2 size={11} aria-hidden="true" />
        </span>
      ) : null}
      {isFolderLike(item) ? (
        <span className="adp-colview-chevron" aria-hidden="true">
          <ChevronRight size={14} />
        </span>
      ) : null}
    </>
  );
}
