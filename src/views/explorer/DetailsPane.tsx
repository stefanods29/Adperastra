import { Copy, Files, Folder, FolderCog } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import MountedImageActions from "../../clipboard/MountedImageActions";
import Button from "../../components/Button";
import HelpButton from "../../components/HelpButton";
import FolderCustomizeDialog from "../../folders/FolderCustomizeDialog";
import { FolderGlyph } from "../../folders/FolderGlyph";
import { invalidateFolderDecorations, useFolderDecoration } from "../../folders/folderDecorationState";
import MetadataFacts from "../../metadata/MetadataFacts";
import { canMountDiskImage } from "../../services/diskImages";
import { customizeFolders, resetFoldersAtPaths, type FolderCustomizeRequest } from "../../services/folderCustomization";
import { itemDetails, parentPathOf, type ExplorerItem, type ItemDetails } from "../../services/explorer";
import { formatDate, formatSize } from "../../services/format";
import { displayName } from "../../services/names";
import { isTauriRuntime } from "../../services/settings";
import type { SelectionSummary } from "../../services/selection";
import { fileTile } from "./fileTile";

export interface DetailsPaneProps {
  /** Selected items in display order (data from the listing). */
  selected: ExplorerItem[];
  summary: SelectionSummary;
  /** The open folder, shown when nothing is selected; null on Home/This PC. */
  folder: { path: string; name: string; itemCount: number } | null;
  showExtensions: boolean;
  typeLabel: (item: ExplorerItem) => string;
  onCopyPath: (path: string) => void;
  onOpenHelp: (slug?: string) => void;
  /** Open the Version history of one file (Step 06b). */
  onShowHistory?: (path: string) => void;
  /** The normal open pipeline, for the pane preview (Step 07b). */
  onOpen?: (item: ExplorerItem) => void;
  /** Open a mounted image's drive through the normal folder route. */
  onOpenDrive?: (root: string) => void;
  /** Where the layout puts the pane (Step 05c). */
  placement?: "right" | "bottom";
  /** Settings > Views: offer manual column sets in Customize folder. */
  columnSetsEnabled?: boolean;
  /** Optional background folder size text (Step 11c T6). */
  folderSizeText?: (path: string) => string | null;
}

/** What still has to come from `item_details`: shown as a skeleton line
 * if it takes longer than 0.1 s (rules.md section 3). */
function useItemDetails(path: string | null): { details: ItemDetails | null; failed: boolean; slow: boolean } {
  const [state, setState] = useState<{ path: string | null; details: ItemDetails | null; failed: boolean }>({
    path: null,
    details: null,
    failed: false,
  });
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (path === null || !isTauriRuntime()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) setSlow(true);
    }, 100);
    itemDetails(path)
      .then((details) => {
        if (!cancelled) setState({ path, details, failed: false });
      })
      .catch(() => {
        // The skeleton must not stay forever: show a dash instead.
        if (!cancelled) setState({ path, details: null, failed: true });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [path]);
  const current = state.path === path;
  return { details: current ? state.details : null, failed: current && state.failed, slow };
}

/** The Details pane (Windows 11 style): one item, several items, or the
 * open folder when nothing is selected. Basic facts come from the
 * listing instantly; created/accessed dates and attributes follow. */
export default function DetailsPane(props: DetailsPaneProps) {
  const { t, i18n } = useTranslation();
  const placement = props.placement ?? "right";
  const single = props.selected.length === 1 ? props.selected[0] : null;
  const detailsPath = single ? single.path : props.selected.length === 0 && props.folder ? props.folder.path : null;
  const { details, failed, slow } = useItemDetails(detailsPath);
  const folderPath = single?.kind === "folder" ? single.path : props.selected.length === 0 && props.folder ? props.folder.path : null;
  const folderSize = folderPath ? props.folderSizeText?.(folderPath) ?? null : null;
  const folderDecoration = useFolderDecoration(folderPath);
  const [customizing, setCustomizing] = useState(false);
  // A different folder must never inherit the open draft.
  useEffect(() => { setCustomizing(false); }, [folderPath]);

  const finishCustomize = async (handle: Awaited<ReturnType<typeof customizeFolders>>) => {
    const result = await handle.completion;
    invalidateFolderDecorations();
    if (!result.complete || result.failures.length) {
      throw new Error(result.failures[0]?.code ?? "folder_custom.changed");
    }
    setCustomizing(false);
  };
  const applyCustomization = async (request: FolderCustomizeRequest) => finishCustomize(await customizeFolders(request));
  const resetCustomization = async () => {
    if (!folderPath) return;
    await finishCustomize(await resetFoldersAtPaths([folderPath]));
  };

  const date = (unix: number | undefined) => (unix ? formatDate(unix, i18n.language) : "");
  const pending = <span className="adp-details-skeleton" aria-label={t("explorer.details.loading")} />;
  const later = (value: string | undefined) => (details ? value || "—" : failed ? "—" : slow ? pending : "");
  const attributes = details
    ? details.attributes.length > 0
      ? details.attributes.map((id) => t(`explorer.details.attr.${id}`)).join(", ")
      : t("explorer.details.noAttributes")
    : undefined;

  let body;
  if (single) {
    const tile = fileTile(single.name, single.kind);
    const Icon = tile.icon;
    const location = parentPathOf(single.path) ?? single.path;
    body = (
      <>
        <div className="adp-details-hero">
          <span className={`adp-details-tile adp-file-tile--${tile.tone}`}>
            {single.kind === "folder" ? <FolderGlyph decoration={folderDecoration} size={24} /> : <Icon size={24} aria-hidden="true" />}
          </span>
          <div className="adp-details-title">
            <span className="adp-details-name">{displayName(single.name, single.kind, props.showExtensions)}</span>
            <span className="adp-details-sub">{props.typeLabel(single)}</span>
          </div>
        </div>
        <dl className="adp-details-grid">
          {single.kind !== "folder" ? (
            <>
              <dt>{t("explorer.details.size")}</dt>
              <dd>{formatSize(single.size, i18n.language)}</dd>
            </>
          ) : folderSize ? (
            <>
              <dt>{t("explorer.details.size")}</dt>
              <dd>{folderSize}</dd>
            </>
          ) : null}
          <dt>{t("explorer.details.location")}</dt>
          <dd className="adp-details-path">
            <span>{location}</span>
            <button type="button" className="adp-icon-btn adp-details-copy" aria-label={t("explorer.details.copyPath")} title={t("explorer.details.copyPath")} onClick={() => props.onCopyPath(single.path)}>
              <Copy size={13} aria-hidden="true" />
            </button>
          </dd>
          <dt>{t("explorer.details.modified")}</dt>
          <dd>{date(details?.modified_unix ?? single.modified_unix)}</dd>
          <dt>{t("explorer.details.created")}</dt>
          <dd>{later(date(details?.created_unix))}</dd>
          <dt>{t("explorer.details.accessed")}</dt>
          <dd>{later(date(details?.accessed_unix))}</dd>
          <dt>{t("explorer.details.attributes")}</dt>
          <dd>{later(attributes)}</dd>
        </dl>
        <MetadataFacts
          item={single}
          variant="details"
          onOpen={props.onOpen}
          onOpenHelp={(slug) => props.onOpenHelp(slug)}
        />
        {single.kind !== "folder" && props.onShowHistory ? (
          <Button variant="subtle" onClick={() => props.onShowHistory?.(single.path)}>
            {t("commands.versionHistory")}
          </Button>
        ) : null}
        {single.kind !== "folder" && canMountDiskImage(single.name) ? (
          <MountedImageActions
            path={single.path}
            name={single.name}
            onOpenDrive={props.onOpenDrive}
            openOnMount={false}
          />
        ) : null}
        {single.kind === "folder" ? (
          <Button variant="subtle" onClick={() => setCustomizing(true)}>
            <FolderCog size={14} aria-hidden="true" />
            {t("folderCustom.title")}
          </Button>
        ) : null}
      </>
    );
  } else if (props.selected.length > 1) {
    body = (
      <>
        <div className="adp-details-hero">
          <span className="adp-details-tile adp-details-tile--many">
            <Files size={24} aria-hidden="true" />
          </span>
          <div className="adp-details-title">
            <span className="adp-details-name">{t("explorer.details.itemsSelected", { count: props.summary.count })}</span>
            <span className="adp-details-sub">{t("explorer.details.filesAndFolders", { files: props.summary.files, folders: props.summary.folders })}</span>
          </div>
        </div>
        <dl className="adp-details-grid">
          <dt>{t("explorer.details.totalSize")}</dt>
          <dd>{formatSize(props.summary.bytes, i18n.language)}</dd>
        </dl>
        {props.summary.folders > 0 ? <p className="adp-details-note">{t("explorer.details.foldersNotCounted")}</p> : null}
      </>
    );
  } else if (props.folder) {
    body = (
      <>
        <div className="adp-details-hero">
          <span className="adp-details-tile adp-file-tile--folder">
            {folderDecoration ? <FolderGlyph decoration={folderDecoration} size={24} /> : <Folder size={24} aria-hidden="true" />}
          </span>
          <div className="adp-details-title">
            <span className="adp-details-name">{props.folder.name}</span>
            <span className="adp-details-sub">{t("explorer.details.folderItems", { count: props.folder.itemCount })}</span>
          </div>
        </div>
        <dl className="adp-details-grid">
          {folderSize ? (
            <>
              <dt>{t("explorer.details.size")}</dt>
              <dd>{folderSize}</dd>
            </>
          ) : null}
          <dt>{t("explorer.details.location")}</dt>
          <dd className="adp-details-path">
            <span>{parentPathOf(props.folder.path) ?? props.folder.path}</span>
          </dd>
          <dt>{t("explorer.details.modified")}</dt>
          <dd>{later(date(details?.modified_unix))}</dd>
          <dt>{t("explorer.details.created")}</dt>
          <dd>{later(date(details?.created_unix))}</dd>
        </dl>
        <Button variant="subtle" onClick={() => setCustomizing(true)}>
          <FolderCog size={14} aria-hidden="true" />
          {t("folderCustom.title")}
        </Button>
      </>
    );
  } else {
    body = <p className="adp-details-note">{t("explorer.details.selectHint")}</p>;
  }

  return (
    <>
      <aside
        className={`adp-details-pane${placement === "bottom" ? " adp-details-pane--bottom" : ""}`}
        aria-label={t("explorer.details.title")}
      >
        <div className="adp-details-header">
          <span>{t("explorer.details.title")}</span>
          <HelpButton onOpenHelp={props.onOpenHelp} />
        </div>
        {body}
      </aside>
      {customizing && folderPath ? (
        <FolderCustomizeDialog
          paths={[folderPath]}
          initial={folderDecoration ? [folderDecoration] : []}
          columnSetsEnabled={props.columnSetsEnabled === true}
          onApply={applyCustomization}
          onReset={resetCustomization}
          onClose={() => setCustomizing(false)}
          onOpenHelp={() => props.onOpenHelp("customizing-folders")}
        />
      ) : null}
    </>
  );
}
