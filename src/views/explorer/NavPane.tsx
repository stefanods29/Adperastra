import { Folder, HardDrive, Home, Image, Monitor, Network, PinOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import NavItem from "../../components/NavItem";
import type { DriveItem, KnownFolder } from "../../services/explorer";
import type { ExplorerLocation } from "../../services/navigation";
import { samePath } from "../../services/explorer";

export interface NavPaneProps {
  knownFolders: KnownFolder[];
  pinnedFolders: string[];
  drives: DriveItem[];
  location: ExplorerLocation;
  onHome: () => void;
  onGallery: () => void;
  onDrives: () => void;
  onNetwork: () => void;
  onOpenFolder: (path: string) => void;
  onUnpin: (path: string) => void;
}

function folderNameFromPath(path: string): string {
  const parts = path.replace(/\\+$/, "").split("\\");
  return parts[parts.length - 1] || path;
}

export default function NavPane(props: NavPaneProps) {
  const { t } = useTranslation();
  const knownPaths = new Set(props.knownFolders.map((f) => f.path.toLowerCase()));
  const customPins = props.pinnedFolders.filter((p) => !knownPaths.has(p.toLowerCase()));
  const isActive = (path: string) => props.location.type === "folder" && samePath(props.location.path, path);

  return (
    <aside className="adp-explorer-nav" aria-label={t("components.breadcrumb")}>
      <NavItem icon={Home} label={t("explorer.nav.home")} active={props.location.type === "home"} onClick={props.onHome} />
      <NavItem icon={Image} label={t("explorer.nav.gallery")} active={props.location.type === "gallery"} onClick={props.onGallery} />
      <div className="adp-nav-spacer" />
      {props.knownFolders
        .filter((folder) => folder.id !== "home")
        .map((folder) => (
          <NavItem key={folder.id} icon={Folder} label={folder.name} pinned active={isActive(folder.path)} onClick={() => props.onOpenFolder(folder.path)} />
        ))}
      {customPins.length > 0 ? (
        <>
          <div className="adp-nav-section">{t("explorer.pinnedFolders")}</div>
          {customPins.map((path) => (
            <div key={path} className="adp-nav-pin-row">
              <NavItem icon={Folder} label={folderNameFromPath(path)} pinned active={isActive(path)} onClick={() => props.onOpenFolder(path)} />
              <button type="button" className="adp-icon-btn adp-nav-unpin" aria-label={t("commands.unpinFolder")} title={t("commands.unpinFolder")} onClick={() => props.onUnpin(path)}>
                <PinOff size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
        </>
      ) : null}
      <div className="adp-nav-spacer" />
      <NavItem icon={Monitor} label={t("explorer.nav.thisPc")} active={props.location.type === "drives"} onClick={props.onDrives} />
      {props.drives.map((drive) => (
        <button key={drive.root} type="button" className={`adp-nav-drive${props.location.type === "folder" && samePath(props.location.path, drive.root) ? " adp-nav-item--active" : ""}`} onClick={() => props.onOpenFolder(drive.root)}>
          <HardDrive size={14} aria-hidden="true" />
          <span>{drive.root}</span>
        </button>
      ))}
      <NavItem icon={Network} label={t("explorer.nav.network")} active={props.location.type === "network"} onClick={props.onNetwork} />
    </aside>
  );
}