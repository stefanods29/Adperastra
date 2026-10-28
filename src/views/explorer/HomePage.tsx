import { ChevronDown, ChevronRight, Clock3, Folder, Star } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import type { KnownFolder } from "../../services/explorer";

export type HomeTab = "recent" | "favorites";

export interface HomePageProps {
  knownFolders: KnownFolder[];
  pinnedCards: { name: string; path: string; location: string }[];
  onOpenFolder: (path: string) => void;
  onOpenHelp?: () => void;
  tab: HomeTab;
  onTabChange: (tab: HomeTab) => void;
  /** The Recent or Favorites list (the shared file list). */
  children: ReactNode;
}

export default function HomePage(props: HomePageProps) {
  const { t } = useTranslation();
  const [quickOpen, setQuickOpen] = useState(true);
  const cards = props.pinnedCards;

  return (
    <div className="adp-home">
      <div className="adp-view-header">
        <button type="button" className="adp-section-heading" aria-expanded={quickOpen} onClick={() => setQuickOpen((value) => !value)}>
          {quickOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          <span>{t("explorer.quickAccess")}</span>
        </button>
        {props.onOpenHelp ? <HelpButton onOpenHelp={props.onOpenHelp} /> : null}
      </div>
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
        <button type="button" role="tab" aria-selected={props.tab === "recent"} className={`adp-segment-btn${props.tab === "recent" ? " adp-segment-btn--active" : ""}`} onClick={() => props.onTabChange("recent")}>
          <Clock3 size={13} aria-hidden="true" /> {t("explorer.recent")}
        </button>
        <button type="button" role="tab" aria-selected={props.tab === "favorites"} className={`adp-segment-btn${props.tab === "favorites" ? " adp-segment-btn--active" : ""}`} onClick={() => props.onTabChange("favorites")}>
          <Star size={13} aria-hidden="true" /> {t("explorer.favorites")}
        </button>
      </div>

      {props.children}
    </div>
  );
}
