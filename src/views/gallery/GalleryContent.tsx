/** The Gallery location inside the Explorer (Step 07c, export E2).
 *
 * Source controls live above a virtualized, date-grouped photo grid. The view
 * only calls the shared services: `useGallery` for scanning, 07a
 * `FileThumbnail` for pictures, 07b `QuickPreviewDialog`/metadata for preview
 * and details, and the Explorer's own `onOpenFile` for opening. */

import { FolderMinus, FolderPlus, Image as ImageIcon } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import Button from "../../components/Button";
import HelpButton from "../../components/HelpButton";
import IconButton from "../../components/IconButton";
import Skeleton from "../../components/Skeleton";
import Switch from "../../components/Switch";
import { displayPath } from "../../services/explorer";
import { errorCode, errorText } from "../../services/errors";
import { displayName } from "../../services/names";
import { formatDate } from "../../services/format";
import {
  MAX_GALLERY_SOURCES,
  type GallerySettings, type GalleryItem,
} from "../../services/gallery";
import { EMPTY_SELECTION, type SelectionState } from "../../services/selection";
import GalleryGrid from "./GalleryGrid";
import { galleryOrder, keepGallerySelection, singleGallerySelection } from "./gallerySelection";
import { useGallery } from "./useGallery";
import { useGalleryActions, usePictureDetails } from "./useGalleryActions";
import { useGallerySources } from "./useGallerySources";

const QuickPreviewDialog = lazy(() =>
  import("../../preview/QuickPreviewDialog").then((module) => ({
    default: module.QuickPreviewDialog,
  })),
);

/** Scan failures can come from the background policy or shared jobs. Those
 * areas have their own translated keys; everything else is a `gallery.*`
 * code. */
function scanErrorText(t: TFunction, error: unknown): string {
  const code = errorCode(error);
  return errorText(
    t,
    error,
    code.startsWith("background.") ? "background" : "gallery",
  );
}

export interface GalleryContentProps {
  settings: GallerySettings;
  active: boolean;
  showExtensions: boolean;
  onOpenFile: (path: string, background: boolean) => Promise<void>;
  onSettingsChange: (settings: GallerySettings) => Promise<void>;
  onOpenHelp: (slug: string) => void;
  /** Additive to the guide's props table: the Explorer view flags (D2/D4).
   * Hidden and system items follow the existing view settings. */
  showHidden?: boolean;
  showSystem?: boolean;
  /** Additive: a `gallery.addFolder`/`gallery.removeFolder` command request
   * from the Explorer command registry. A new nonce runs it once. */
  request?: { kind: "add" | "remove"; nonce: number } | null;
  /** Additive: tells the Explorer whether a source row is selected, so the
   * `gallery.removeFolder` command can be enabled exactly then. */
  onSourceSelected?: (selected: boolean) => void;
  /** Additive: the loaded picture count for the Explorer status bar. */
  onCountChange?: (count: number) => void;
}

export default function GalleryContent({
  settings,
  active,
  showExtensions,
  onOpenFile,
  onSettingsChange,
  onOpenHelp,
  showHidden = false,
  showSystem = false,
  request = null,
  onSourceSelected,
  onCountChange,
}: GalleryContentProps) {
  const { t, i18n } = useTranslation();
  const dateGroupName = useId();
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [visibleItems, setVisibleItems] = useState<readonly GalleryItem[]>([]);
  const [pointerInside, setPointerInside] = useState(false);
  const onVisibleItems = useCallback((next: readonly GalleryItem[]) => {
    setVisibleItems(previous => previous.length === next.length && previous.every((item, index) => item.item === next[index]?.item) ? previous : next);
  }, []);
  const controller = useGallery({ settings, active, showHidden, showSystem, visibleItems,
    freezeGrouping: pointerInside || selection.selected.size > 0 });
  const sources = useGallerySources({ settings, onSettingsChange, t });
  const order = useMemo(() => galleryOrder(controller.groups), [controller.groups]);
  const actions = useGalleryActions({ order, onOpenFile });
  const single = singleGallerySelection(order, selection);
  const facts = usePictureDetails(single, active);

  useEffect(() => {
    // While a scan is running its rows are still arriving; dropping a selected
    // path now could lose a picture that is on a later page. Prune once the
    // scan stopped, so only paths that are really gone disappear (D6).
    if (controller.loading || controller.hasMore) return;
    setSelection((current) =>
      current.selected.size === 0 && current.focus === null
        ? current
        : keepGallerySelection(current, order),
    );
  }, [controller.loading, controller.hasMore, order]);

  useEffect(() => {
    onSourceSelected?.(false);
  }, [onSourceSelected]);

  useEffect(() => {
    onCountChange?.(controller.items.length);
  }, [controller.items.length, onCountChange]);

  useEffect(() => {
    if (
      selectedSourceId !== null &&
      !settings.sources.some((source) => source.id === selectedSourceId)
    ) {
      setSelectedSourceId(null);
      onSourceSelected?.(false);
    }
  }, [onSourceSelected, selectedSourceId, settings.sources]);

  // A request that was already handled before this view unmounted must not
  // run again when the Explorer returns to the Gallery.
  const handledRequest = useRef<number | null>(request?.nonce ?? null);
  useEffect(() => {
    if (!request || handledRequest.current === request.nonce) return;
    handledRequest.current = request.nonce;
    if (request.kind === "add") void sources.addSource();
    else if (selectedSourceId) void sources.removeSource(selectedSourceId);
    // A nonce is the request identity; the handlers read the current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  const [showSkeleton, setShowSkeleton] = useState(false);
  const [showSlow, setShowSlow] = useState(false);
  const loadingEmpty = controller.loading && controller.items.length === 0;
  useEffect(() => {
    if (!loadingEmpty) {
      setShowSkeleton(false);
      setShowSlow(false);
      return;
    }
    const skeleton = window.setTimeout(() => setShowSkeleton(true), 100);
    const slow = window.setTimeout(() => setShowSlow(true), 1000);
    return () => {
      window.clearTimeout(skeleton);
      window.clearTimeout(slow);
    };
  }, [loadingEmpty]);

  const rootRef = useRef<HTMLElement>(null);
  const startedAt = useRef(performance.now());
  const onFirstPaint = useCallback(() => {
    const elapsed = performance.now() - startedAt.current;
    (window as unknown as Record<string, unknown>).__adperastraLastGalleryOpenMs = elapsed;
    rootRef.current?.setAttribute(
      "data-last-gallery-open-ms",
      String(Math.round(elapsed)),
    );
  }, []);

  const hasSources = settings.sources.length > 0;
  const scanError = controller.error ? scanErrorText(t, controller.error) : null;
  const sourceError = sources.error ? errorText(t, sources.error, "gallery") : null;

  const emptyPanel = (message: string) => (
    <div className="adp-gallery-empty">
      <ImageIcon size={48} aria-hidden="true" />
      <p>{message}</p>
      <Button
        variant="primary"
        onClick={() => void sources.addSource()}
        disabled={sources.busy || settings.sources.length >= MAX_GALLERY_SOURCES}
      >
        <FolderPlus size={16} aria-hidden="true" />
        {t("gallery.addFolder")}
      </Button>
    </div>
  );

  let content: ReactNode;
  if (!hasSources) {
    content = emptyPanel(t("gallery.empty"));
  } else if (controller.items.length === 0) {
    if (loadingEmpty) {
      content = (
        <div className="adp-gallery-loading" role="status">
          {showSkeleton ? <Skeleton variant="tiles" count={8} /> : null}
          {showSlow ? <p>{t("gallery.loading")}</p> : null}
        </div>
      );
    } else if (!scanError) {
      content = emptyPanel(t("gallery.noPictures"));
    } else {
      content = null;
    }
  } else {
    content = (
      <GalleryGrid
        groups={controller.groups}
        selection={selection}
        onSelectionChange={setSelection}
        onOpen={(item, background) => void actions.open(item, background ?? false)}
        onPreview={(item, origin) => actions.preview(item, origin)}
        showExtensions={showExtensions}
        active={active}
        label={t("gallery.title")}
        hasMore={controller.hasMore}
        loadingMore={controller.loadingMore}
        onLoadMore={controller.loadMore}
        onFirstPaint={onFirstPaint}
        onVisibleItems={onVisibleItems}
        onPointerActive={setPointerInside}
      />
    );
  }

  return (
    <section
      ref={rootRef}
      className="adp-gallery-content"
      aria-label={t("gallery.title")}
    >
      <header className="adp-gallery-head">
        <h2 className="adp-heading">{t("gallery.title")}</h2>
        <HelpButton onOpenHelp={() => onOpenHelp("the-gallery")} />
      </header>

      <div
        className="adp-gallery-sources"
        role="group"
        aria-label={t("gallery.sources")}
      >
        <div className="adp-gallery-source-actions">
          <Button
            variant="primary"
            onClick={() => void sources.addSource()}
            disabled={sources.busy || settings.sources.length >= MAX_GALLERY_SOURCES}
          >
            <FolderPlus size={16} aria-hidden="true" />
            {t("gallery.addFolder")}
          </Button>
          <span className="adp-gallery-date-label">{t("gallery.dateSource")}</span>
          <div
            className="adp-gallery-dates"
            role="radiogroup"
            aria-label={t("gallery.dateSource")}
          >
            {(["taken", "modified"] as const).map((value) => (
              <label key={value} className="adp-gallery-date">
                <input
                  type="radio"
                  name={`${dateGroupName}-date-source`}
                  value={value}
                  checked={settings.date_source === value}
                  disabled={sources.busy}
                  onChange={() => void sources.setDateSource(value)}
                />
                <span>{t(value === "taken" ? "gallery.taken" : "gallery.modified")}</span>
              </label>
            ))}
          </div>
        </div>

        {hasSources ? (
          <ul className="adp-gallery-source-list">
            {settings.sources.map((source) => (
              <li
                key={source.id}
                className={`adp-gallery-source${
                  source.id === selectedSourceId ? " adp-gallery-source--selected" : ""
                }`}
                onFocus={() => {
                  setSelectedSourceId(source.id);
                  onSourceSelected?.(true);
                }}
                onClick={() => {
                  setSelectedSourceId(source.id);
                  onSourceSelected?.(true);
                }}
              >
                <button type="button" className="adp-gallery-source-path" title={displayPath(source.path)} aria-pressed={source.id === selectedSourceId}>
                  {displayPath(source.path)}
                </button>
                <Switch
                  checked={source.recursive}
                  onChange={(value) => void sources.setRecursive(source.id, value)}
                  label={t("gallery.recursive")}
                  disabled={sources.busy}
                />
                <IconButton
                  icon={FolderMinus}
                  labelKey="gallery.removeFolder"
                  onClick={() => void sources.removeSource(source.id)}
                  disabled={sources.busy}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {sourceError ? (
          <p className="adp-gallery-error" role="alert">
            {sourceError}
          </p>
        ) : null}
      </div>

      {controller.partial && !scanError ? (
        <div className="adp-gallery-partial" role="status">
          <span>{t("gallery.partial")}</span>
          {controller.skippedCount > 0 ? (
            <span>{t("gallery.skipped", { count: controller.skippedCount })}</span>
          ) : null}
          <Button onClick={controller.refresh}>{t("commands.refresh")}</Button>
        </div>
      ) : null}

      {scanError ? (
        <div className="adp-gallery-error" role="alert">
          <span>{scanError}</span>
          <Button onClick={controller.refresh}>{t("commands.refresh")}</Button>
        </div>
      ) : null}

      {actions.openError ? (
        <div className="adp-gallery-error" role="alert">
          <span>{errorText(t, actions.openError, "files")}</span>
          <Button onClick={actions.clearOpenError}>{t("common.close")}</Button>
        </div>
      ) : null}

      <div className="adp-gallery-body">
        {content}
        {single ? (
          <aside className="adp-gallery-details" aria-label={t("commands.details")}>
            <h3 className="adp-gallery-details-title" title={single.item.name}>
              {displayName(single.item.name, single.item.kind, showExtensions)}
            </h3>
            {single.item.online_only ? (
              <p className="adp-gallery-details-note">{t("explorer.onlineOnly")}</p>
            ) : facts ? (
              <dl className="adp-gallery-facts">
                {facts.width !== null && facts.height !== null ? (
                  <>
                    <dt>{t("metadata.width")}</dt>
                    <dd>{t("metadata.pixels", { count: facts.width })}</dd>
                    <dt>{t("metadata.height")}</dt>
                    <dd>{t("metadata.pixels", { count: facts.height })}</dd>
                  </>
                ) : null}
                {facts.dateTaken && Number.isFinite(Date.parse(facts.dateTaken)) ? (
                  <>
                    <dt>{t("metadata.dateTaken")}</dt>
                    <dd>
                      {formatDate(
                        Math.floor(Date.parse(facts.dateTaken) / 1000),
                        i18n.language,
                      )}
                    </dd>
                  </>
                ) : null}
                {facts.cameraMake ? (
                  <>
                    <dt>{t("metadata.cameraMake")}</dt>
                    <dd>{facts.cameraMake}</dd>
                  </>
                ) : null}
                {facts.cameraModel ? (
                  <>
                    <dt>{t("metadata.cameraModel")}</dt>
                    <dd>{facts.cameraModel}</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
          </aside>
        ) : null}
      </div>

      {actions.previewSelection ? (
        <Suspense fallback={null}>
          <QuickPreviewDialog
            selection={actions.previewSelection}
            onClose={actions.closePreview}
            onOpen={actions.openFromPreview}
            onOpenHelp={onOpenHelp}
          />
        </Suspense>
      ) : null}
    </section>
  );
}

export { GalleryContent };
