import { File, FileText, Folder, Home, Image, LayoutGrid, Monitor, Music, Network, Star, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Breadcrumb from "../components/Breadcrumb";
import HelpButton from "../components/HelpButton";
import ListRow from "../components/ListRow";
import NavItem from "../components/NavItem";

interface SampleFile { id: string; name: string; meta: string; icon: LucideIcon; }
const SAMPLE_FOLDERS = [
  { id: "documents", name: "Documents", meta: "128 items" },
  { id: "pictures", name: "Pictures", meta: "342 items" },
  { id: "downloads", name: "Downloads", meta: "17 items" },
];
const SAMPLE_FILES: SampleFile[] = [
  { id: "report", name: "Quarterly report.docx", meta: "2.4 MB", icon: FileText },
  { id: "photo", name: "Team photo 2026.jpg", meta: "4.1 MB", icon: Image },
  { id: "notes", name: "Meeting notes.txt", meta: "12 KB", icon: File },
  { id: "song", name: "Demo track.mp3", meta: "8.7 MB", icon: Music },
];
const CRUMB_SEGMENTS = [
  { id: "home", label: "Home" },
  { id: "documents", label: "Documents" },
];

export interface ExplorerHomeProps {
  onStatsChange?: (total: number, selected: number) => void;
  onOpenHelp: () => void;
}

export default function ExplorerHome({ onStatsChange, onOpenHelp }: ExplorerHomeProps) {
  const { t } = useTranslation();
  const [activeNav, setActiveNav] = useState("home");
  const [tab, setTab] = useState("recent" as "recent" | "favorites");
  const [selected, setSelected] = useState(null as string | null);

  useEffect(() => {
    onStatsChange?.(SAMPLE_FILES.length, selected ? 1 : 0);
  }, [onStatsChange, selected]);

  const navItems = [
    { id: "home", label: t("explorer.nav.home"), icon: Home },
    { id: "gallery", label: t("explorer.nav.gallery"), icon: LayoutGrid },
    { id: "this-pc", label: t("explorer.nav.thisPc"), icon: Monitor },
    { id: "network", label: t("explorer.nav.network"), icon: Network },
  ];

  return (
    <div className="adp-explorer">
      <aside className="adp-explorer-nav">
        {navItems.map((item) => (
          <NavItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={activeNav === item.id}
            pinned={item.id === "home"}
            onClick={() => setActiveNav(item.id)}
          />
        ))}
      </aside>
      <section className="adp-explorer-content">
        <div className="adp-view-header">
          <h2 className="adp-heading">{t("explorer.quickAccess")}</h2>
          <HelpButton onOpenHelp={onOpenHelp} />
        </div>
        <Breadcrumb segments={CRUMB_SEGMENTS} onNavigate={() => undefined} />
        <div className="adp-cards">
          {SAMPLE_FOLDERS.map((folder) => (
            <button key={folder.id} type="button" className="adp-card" onClick={() => setSelected(folder.id)}>
              <Folder size={20} aria-hidden="true" />
              <span>{folder.name}</span>
              <span className="adp-card-meta">{folder.meta}</span>
            </button>
          ))}
        </div>
        <div className="adp-button-row">
          <div className="adp-segment" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "recent"}
              className={tab === "recent" ? "adp-segment-btn adp-segment-btn--active" : "adp-segment-btn"}
              onClick={() => setTab("recent")}
            >
              {t("explorer.recent")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "favorites"}
              className={tab === "favorites" ? "adp-segment-btn adp-segment-btn--active" : "adp-segment-btn"}
              onClick={() => setTab("favorites")}
            >
              {t("explorer.favorites")}
            </button>
          </div>
          <Star size={14} aria-hidden="true" />
        </div>
        <div>
          {SAMPLE_FILES.map((file) => (
            <ListRow
              key={file.id}
              icon={file.icon}
              name={file.name}
              meta={file.meta}
              selected={selected === file.id}
              onClick={() => setSelected(file.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
