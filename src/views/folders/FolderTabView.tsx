import QuickPreviewDialog from "../../preview/QuickPreviewDialog";
import type { FolderTabState } from "../../services/folderState";
import type { ViewsSettings } from "../../services/smartViews";
import type { SearchSettings } from "../../services/search";
import type { FolderSizeSettings } from "../../services/settings";
import type { ToolbarCustomSettings } from "../../services/commandLayout";
import ExplorerHome, { type ExplorerPaletteBridge } from "../ExplorerHome";
import { useFolderTabState } from "./useFolderTabState";

/** One folder tab (Step 09a E6). Every folder tab mounts its own
 * `ExplorerHome`, keyed by tab id, with its own listing, selection,
 * history, watcher and quick preview. Reordering tabs never remounts it,
 * so the component identity (and scroll position) survives. */
export interface FolderTabViewProps {
  tabId: string;
  state: FolderTabState;
  /** True while this leaf owns keyboard commands. */
  active: boolean;
  /** Split leaves pass `visible` for both sides so the inactive side stays
   * painted; a normal tab defaults to painting only while it is active. */
  visible?: boolean;
  onViewChange: (state: FolderTabState) => void;
  onOpenFile: (path: string, background: boolean) => Promise<void>;
  onOpenHelp: (slug: string) => void;
  /** Tag and indexed-view settings (schema 35). */
  views?: ViewsSettings;
  /** Step 09d: publish this tab's commands to the window palette. */
  onPaletteBridge?: (owner: string, bridge: ExplorerPaletteBridge | null) => void;
  onOpenCommandPalette?: () => void;
  /** Step 09h: the window's recovery list and diagnostic review. */
  onReportProblem?: () => void;
  onOpenRecovery?: () => void;
  /** Mounted disk-image drives open as normal folder tabs (Step 09j). */
  onOpenMountedDrive?: (root: string) => void;
  /** Step 09c T4: hover activation and drops onto a tab from this folder. */
  dragHoverMs?: number;
  onActivateTab?: (tabId: string) => void;
  onDropFilesOnTab?: (tabId: string, paths: readonly string[]) => Promise<unknown>;
  /** Step 11a: indexed search defaults and the indexing window. */
  searchSettings?: SearchSettings;
  onSearchSettingsChange?: (next: SearchSettings) => void;
  /** Step 11c: optional background folder sizes. */
  folderSizes?: FolderSizeSettings;
  onFolderSizesChange?: (next: FolderSizeSettings) => void;
  onOpenAppStorage?: () => void;
  /** Effective double-click delay and App-hosted commands (Step 10f T5). */
  doubleClickMs?: number;
  /** Click-pick lease and its normal operation choice (Step 10f E4). */
  pickActive?: boolean;
  onPickDropRequest?: () => void;
  featureActions?: import("../../commands/featureCommands").FeatureCommandActions;
  /** Saved toolbar customization and its Settings entry points (Step 10b). */
  toolbarCustom?: ToolbarCustomSettings;
  onCustomizeToolbar?: () => void;
  onCustomizeShortcuts?: () => void;
}

export default function FolderTabView({
  tabId,
  state,
  active,
  visible = active,
  onViewChange,
  onOpenFile,
  onOpenHelp,
  views,
  onPaletteBridge,
  onOpenCommandPalette,
  onReportProblem,
  onOpenRecovery,
  onOpenMountedDrive,
  dragHoverMs,
  onActivateTab,
  onDropFilesOnTab,
  searchSettings,
  onSearchSettingsChange,
  folderSizes,
  onFolderSizesChange,
  onOpenAppStorage,
  doubleClickMs,
  pickActive = false,
  onPickDropRequest,
  featureActions,
  toolbarCustom,
  onCustomizeToolbar,
  onCustomizeShortcuts,
}: FolderTabViewProps) {
  const folder = useFolderTabState(state, active, onViewChange);
  return (
    <div className="adp-folder-tab" hidden={!visible}>
      <ExplorerHome
        key={tabId}
        active={active}
        initialLocation={folder.state.path === "home" ? undefined : folder.state.path}
        initialFolderState={folder.state}
        rescanNonce={folder.rescanNonce}
        onFolderStateChange={folder.setState}
        onOpenHelp={(slug) => onOpenHelp(slug ?? "")}
        onOpenFile={onOpenFile}
        views={views}
        onPaletteBridge={onPaletteBridge}
        paletteOwnerId={tabId}
        onOpenCommandPalette={onOpenCommandPalette}
        onReportProblem={onReportProblem}
        onOpenRecovery={onOpenRecovery}
        onOpenMountedDrive={onOpenMountedDrive}
        dragHoverMs={dragHoverMs}
        onActivateTab={onActivateTab}
        onDropFilesOnTab={onDropFilesOnTab}
        searchSettings={searchSettings}
        onSearchSettingsChange={onSearchSettingsChange}
        folderSizes={folderSizes}
        onFolderSizesChange={onFolderSizesChange}
        onOpenAppStorage={onOpenAppStorage}
        doubleClickMs={doubleClickMs}
        pickActive={pickActive}
        onPickDropRequest={onPickDropRequest}
        featureActions={featureActions}
        toolbarCustom={toolbarCustom}
        onCustomizeToolbar={onCustomizeToolbar}
        onCustomizeShortcuts={onCustomizeShortcuts}
        onPreviewItem={folder.setPreviewItem}
        previewItem={folder.previewItem}
      />
      {folder.previewItem ? (
        <QuickPreviewDialog
          selection={{ items: [folder.previewItem], path: folder.previewItem.path, origin: null }}
          onClose={() => folder.setPreviewItem(null)}
          onOpen={async (path) => {
            folder.setPreviewItem(null);
            await onOpenFile(path, false);
          }}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
    </div>
  );
}
