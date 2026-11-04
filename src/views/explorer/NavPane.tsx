import { Folder, HardDrive, Home, Image, Layers, Monitor, Network, PinOff } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import NavItem from "../../components/NavItem";
import type { DriveItem, KnownFolder } from "../../services/explorer";
import type { ExplorerLocation } from "../../services/navigation";
import { samePath } from "../../services/explorer";
import { NAV_SECTION_LABEL_KEYS } from "../../shell/registries";
import type { NavigationCustomization } from "../../shell/types";

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
  /** Open the saved-groups catalog (Step 09b). */
  onSavedGroups?: () => void;
  /** Saved navigation customization (Step 10e); absent keeps the legacy pane. */
  navigation?: NavigationCustomization;
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

  const navigation = props.navigation;
  if (navigation) {
    const builtin = (target: string) => {
      if (target === "home") return { icon: Home, label: t("explorer.nav.home"), onClick: props.onHome };
      if (target === "gallery") return { icon: Image, label: t("explorer.nav.gallery"), onClick: props.onGallery };
      if (target === "this_pc") return { icon: Monitor, label: t("explorer.nav.thisPc"), onClick: props.onDrives };
      if (target === "network") return { icon: Network, label: t("explorer.nav.network"), onClick: props.onNetwork };
      if (target === "saved_groups" && props.onSavedGroups)
        return { icon: Layers, label: t("groups.saved"), onClick: props.onSavedGroups };
      return null;
    };
    const navFolderTargets = new Set(
      navigation.sections.flatMap((section) =>
        section.items
          .filter((item) => item.kind === "folder" && item.visible)
          .map((item) => item.target_id.toLowerCase()),
      ),
    );
    const fallbackKnown = props.knownFolders.filter(
      (folder) => folder.id !== "home" && !navFolderTargets.has(folder.path.toLowerCase()),
    );
    const fallbackCustom = customPins.filter((path) => !navFolderTargets.has(path.toLowerCase()));
    const style = {
      "--adp-nav-width": `${navigation.width_px}px`,
      "--adp-nav-row-height": `${navigation.row_height_px}px`,
      "--adp-nav-icon-size": `${navigation.icon_size_px}px`,
      width: `${navigation.width_px}px`,
    } as CSSProperties;
    return (
      <aside className="adp-explorer-nav" aria-label={t("components.breadcrumb")} style={style} data-nav-custom="true">
        {navigation.sections
          .filter((section) => section.visible)
          .map((section) => (
            <div key={section.id} className="adp-nav-custom-section">
              <div className="adp-nav-section">
                {section.label ??
                  (NAV_SECTION_LABEL_KEYS[section.id] ? t(NAV_SECTION_LABEL_KEYS[section.id]) : section.id)}
              </div>
              {section.items
                .filter((item) => item.visible)
                .map((item) => {
                  if (item.kind === "builtin") {
                    const target = builtin(item.target_id);
                    if (!target) return null;
                    const Icon = target.icon;
                    return <NavItem key={item.id} icon={Icon} label={target.label} onClick={target.onClick} />;
                  }
                  const label = item.display_label ?? folderNameFromPath(item.target_id);
                  return (
                    <NavItem
                      key={item.id}
                      icon={Folder}
                      label={label}
                      pinned
                      active={isActive(item.target_id)}
                      onClick={() => props.onOpenFolder(item.target_id)}
                      dropPath={item.target_id}
                      dropName={label}
                    />
                  );
                })}
              {section.id === "pinned" ? (
                <>
                  {fallbackKnown.map((folder) => (
                    <NavItem
                      key={`fallback-${folder.id}`}
                      icon={Folder}
                      label={folder.name}
                      pinned
                      active={isActive(folder.path)}
                      onClick={() => props.onOpenFolder(folder.path)}
                      dropPath={folder.path}
                      dropName={folder.name}
                    />
                  ))}
                  {fallbackCustom.map((path) => (
                    <div key={`fallback-${path}`} className="adp-nav-pin-row">
                      <NavItem
                        icon={Folder}
                        label={folderNameFromPath(path)}
                        pinned
                        active={isActive(path)}
                        onClick={() => props.onOpenFolder(path)}
                        dropPath={path}
                        dropName={folderNameFromPath(path)}
                      />
                      <button
                        type="button"
                        className="adp-icon-btn adp-nav-unpin"
                        aria-label={t("commands.unpinFolder")}
                        title={t("commands.unpinFolder")}
                        onClick={() => props.onUnpin(path)}
                      >
                        <PinOff size={12} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          ))}
        <div className="adp-nav-spacer" />
        {props.drives.map((drive) => (
          <button
            key={drive.root}
            type="button"
            className={`adp-nav-drive${props.location.type === "folder" && samePath(props.location.path, drive.root) ? " adp-nav-item--active" : ""}`}
            onClick={() => props.onOpenFolder(drive.root)}
            data-drop-folder={drive.root}
            data-drop-name={drive.root}
          >
            <HardDrive size={14} aria-hidden="true" />
            <span>{drive.root}</span>
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="adp-explorer-nav" aria-label={t("components.breadcrumb")}>
      <NavItem icon={Home} label={t("explorer.nav.home")} active={props.location.type === "home"} onClick={props.onHome} />
      <NavItem icon={Image} label={t("explorer.nav.gallery")} active={props.location.type === "gallery"} onClick={props.onGallery} />
      {props.onSavedGroups ? (
        <NavItem icon={Layers} label={t("groups.saved")} onClick={props.onSavedGroups} />
      ) : null}
      <div className="adp-nav-spacer" />
      {props.knownFolders
        .filter((folder) => folder.id !== "home")
        .map((folder) => (
          <NavItem key={folder.id} icon={Folder} label={folder.name} pinned active={isActive(folder.path)} onClick={() => props.onOpenFolder(folder.path)} dropPath={folder.path} dropName={folder.name} />
        ))}
      {customPins.length > 0 ? (
        <>
          <div className="adp-nav-section">{t("explorer.pinnedFolders")}</div>
          {customPins.map((path) => (
            <div key={path} className="adp-nav-pin-row">
              <NavItem icon={Folder} label={folderNameFromPath(path)} pinned active={isActive(path)} onClick={() => props.onOpenFolder(path)} dropPath={path} dropName={folderNameFromPath(path)} />
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
        <button key={drive.root} type="button" className={`adp-nav-drive${props.location.type === "folder" && samePath(props.location.path, drive.root) ? " adp-nav-item--active" : ""}`} onClick={() => props.onOpenFolder(drive.root)} data-drop-folder={drive.root} data-drop-name={drive.root}>
          <HardDrive size={14} aria-hidden="true" />
          <span>{drive.root}</span>
        </button>
      ))}
      <NavItem icon={Network} label={t("explorer.nav.network")} active={props.location.type === "network"} onClick={props.onNetwork} />
    </aside>
  );
}