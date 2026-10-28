import { ChevronDown, ChevronRight, Clock3, Folder, Star } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { KnownFolder, RecentItem } from "../../services/explorer";
import { formatDate } from "../../services/format";
import { fileTile } from "./fileTile";

export interface HomePageProps {
  knownFolders: KnownFolder[];
  pinnedCards: { name: string; path: string; location: string }[];
  recent: RecentItem[];
  onOpenFolder: (path: string) => void;
  onOpenRecent: (item: RecentItem) => void;
}

export default function HomePage(props: HomePageProps) {
  const { t, i18n } = useTranslation();
  const [quickOpen, setQuickOpen] = useState(true);
  const [tab, setTab] = useState<"recent" | "favorites">("recent");
  const cards = props.pinnedCards;

  let recentSection;
  if (tab === "favorites") {
    recentSection = <p className="adp-empty-note">{t("explorer.favoritesEmpty")}</p>;
  } else if (props.recent.length === 0) {
    recentSection = <p className="adp-empty-note">{t("explorer.recentEmpty")}</p>;
  } else {
    recentSection = (
      <div className="adp-recent-list">
        <div className="adp-filelist-header adp-recent-header">
          <span className="adp-col-name">{t("explorer.columnName")}</span>
          <span className="adp-col-date">{t("explorer.columnModified")}</span>
          <span className="adp-col-type">{t("explorer.columnType")}</span>
        </div>
        {props.recent.map((item) => {
          const tile = fileTile(item.name, item.kind);
          const Icon = tile.icon;
          return (
            <button key={item.path} type="button" className="adp-recent-row" onClick={() => props.onOpenRecent(item)}>
              <span className="adp-col-name adp-file-name-cell">
                <span className={`adp-file-tile adp-file-tile--${tile.tone}`}><Icon size={13} aria-hidden="true" /></span>
                <span className="adp-file-name">{item.name}</span>
              </span>
              <span className="adp-col-date">{formatDate(item.modified_unix, i18n.language)}</span>
              <span className="adp-col-type">{item.kind === "folder" ? t("explorer.folderType") : t("explorer.genericFile")}</span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="adp-home">
      <button type="button" className="adp-section-heading" aria-expanded={quickOpen} onClick={() => setQuickOpen((value) => !value)}>
        {quickOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        <span>{t("explorer.quickAccess")}</span>
      </button>
      {quickOpen ? (
        <div className="adp-quick-grid">
          {cards.map((card) => (
            <button key={card.path} type="button" className="adp-quick-card" onClick={() => props.onOpenFolder(card.path)}>
              <span className="adp-quick-icon"><Folder size={18} aria-hidden="true" /></span>
              <span className="adp-quick-text">
                <span className="adp-quick-name">{card.name}</span>
                <span className="adp-quick-location">{card.location}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="adp-segment" role="tablist" aria-label={t("explorer.recent")}>
        <button type="button" role="tab" aria-selected={tab === "recent"} className={`adp-segment-btn${tab === "recent" ? " adp-segment-btn--active" : ""}`} onClick={() => setTab("recent")}>
          <Clock3 size={13} aria-hidden="true" /> {t("explorer.recent")}
        </button>
        <button type="button" role="tab" aria-selected={tab === "favorites"} className={`adp-segment-btn${tab === "favorites" ? " adp-segment-btn--active" : ""}`} onClick={() => setTab("favorites")}>
          <Star size={13} aria-hidden="true" /> {t("explorer.favorites")}
        </button>
      </div>

      {recentSection}
    </div>
  );
}
