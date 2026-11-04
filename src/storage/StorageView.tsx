import { ArrowUp, FolderOpen, HardDrive, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import Skeleton from "../components/Skeleton";
import { errorText } from "../services/errors";
import type { SortDirection } from "../services/explorer";
import { formatSize } from "../services/format";
import type {
  StorageNode,
  StoragePage,
  StorageScanRequest,
  TypeBreakdown,
} from "../services/storage";
import {
  releaseStorageScan,
  startStorageScan,
  storageDisplayPath,
  storagePage,
} from "../services/storage";
import type { FileAction } from "../services/undo";
import { watchSubscribe, watchUnsubscribe } from "../services/watcherMultiplexer";
import LargestItems, { type LargestSortKey } from "./LargestItems";
import {
  hitTest,
  layoutTreemap,
} from "./treemapLayout";

export interface StorageViewProps {
  request: StorageScanRequest;
  active: boolean;
  onOpenFolder: (path: string) => Promise<void>;
  onOpenFile: (path: string) => Promise<void>;
  onMutation: (action: FileAction) => Promise<void>;
  onOpenHelp: (slug: string) => void;
  /** Set by the Explorer host so the view can return to the folder list. */
  onClose?: () => void;
}

interface DrillParent {
  id: string;
  name: string;
}

const RESCAN_DEBOUNCE_MS = 500;
const TREEMAP_MIN_HEIGHT = 240;

function eventInvalidates(kind: string): boolean {
  return ["create", "change", "remove", "rename", "overflow", "error"].includes(kind);
}

function truncateLabel(text: string, width: number): string {
  const budget = Math.max(0, Math.floor(width / 7));
  return text.length <= budget ? text : `${text.slice(0, Math.max(0, budget - 3))}...`;
}

/** Accessible storage view (Step 11c T3/E6): summary cards, an app-owned
 * canvas treemap and a parallel keyboard list. The canvas is never the sole
 * interface: every tile can be selected, opened or drilled from the list. */
export default function StorageView(props: StorageViewProps) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState<StoragePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [parents, setParents] = useState<DrillParent[]>([]);
  const [sortKey, setSortKey] = useState<LargestSortKey>("logical");
  const [sortDirection, setSortDirection] = useState<SortDirection>("descending");
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: TREEMAP_MIN_HEIGHT });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanIdRef = useRef<string | null>(null);
  const jobRef = useRef<{ cancel: () => Promise<void> } | null>(null);
  const rescanTimer = useRef<number | null>(null);
  const requestRef = useRef(props.request);
  requestRef.current = props.request;
  const requestKey = [
    props.request.root,
    props.request.allow_network ? "1" : "0",
    props.request.include_hidden ? "1" : "0",
    props.request.max_entries,
  ].join("|");

  const currentParent = parents.length > 0 ? parents[parents.length - 1].id : null;
  const nodes = page?.nodes ?? [];
  const summary = page?.summary ?? null;

  const clearSelection = useCallback(() => setSelected(new Set<string>()), []);

  const loadPage = useCallback(
    async (id: string | null, cursor: string | null = null, append = false) => {
      const activeScan = scanIdRef.current;
      if (!activeScan) return;
      const next = await storagePage(activeScan, id, cursor);
      setPage((current) => {
        if (!append || !current) return next;
        return { ...next, nodes: [...current.nodes, ...next.nodes] };
      });
      clearSelection();
    },
    [clearSelection],
  );

  // Start one scan for this request and keep its pages bounded.
  useEffect(() => {
    if (!props.active) return;
    let cancelled = false;
    let job: { cancel: () => Promise<void> } | null = null;
    let subscriptionId: string | null = null;
    setLoading(true);
    setError(null);
    setParents([]);
    clearSelection();

    const start = async () => {
      try {
        const handle = await startStorageScan(requestRef.current);
        job = handle;
        jobRef.current = handle;
        if (cancelled) {
          await handle.cancel();
          return;
        }
        scanIdRef.current = handle.scanId;
        // A cached page may be shown immediately while the refresh runs.
        try {
          const cached = await storagePage(handle.scanId, null, null);
          if (!cancelled) setPage(cached);
        } catch {
          // No cached result yet; the skeleton stays until the job ends.
        }
        const first = await handle.completion;
        if (!cancelled) {
          setPage(first);
          setLoading(false);
        }
        const subscription = await watchSubscribe(
          requestRef.current.root,
          (event) => {
            if (!eventInvalidates(event.kind)) return;
            if (rescanTimer.current !== null) window.clearTimeout(rescanTimer.current);
            rescanTimer.current = window.setTimeout(() => {
              rescanTimer.current = null;
              void rescan();
            }, RESCAN_DEBOUNCE_MS);
          },
          { recursive: true },
        );
        if (cancelled) {
          void watchUnsubscribe(subscription.subscription_id);
        } else {
          subscriptionId = subscription.subscription_id;
        }
      } catch (failure) {
        if (!cancelled) {
          setError(failure);
          setLoading(false);
        }
      }
    };

    const rescan = async () => {
      if (cancelled) return;
      try {
        const handle = await startStorageScan(requestRef.current);
        job = handle;
        jobRef.current = handle;
        const first = await handle.completion;
        if (cancelled) return;
        const previous = scanIdRef.current;
        scanIdRef.current = handle.scanId;
        setPage(first);
        setParents([]);
        clearSelection();
        if (previous && previous !== handle.scanId) {
          void releaseStorageScan(previous).catch(() => undefined);
        }
      } catch (failure) {
        if (!cancelled) setError(failure);
      }
    };

    void start();
    return () => {
      cancelled = true;
      if (rescanTimer.current !== null) {
        window.clearTimeout(rescanTimer.current);
        rescanTimer.current = null;
      }
      if (subscriptionId) void watchUnsubscribe(subscriptionId);
      if (job) void job.cancel();
      jobRef.current = null;
      const finished = scanIdRef.current;
      scanIdRef.current = null;
      if (finished) void releaseStorageScan(finished).catch(() => undefined);
    };
  }, [props.active, requestKey, clearSelection]);

  // Measure the canvas without assuming ResizeObserver exists in tests.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width > 0 ? rect.width : 600;
      const height = rect.height > 0 ? rect.height : TREEMAP_MIN_HEIGHT;
      setCanvasSize({ width, height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [page]);

  const rects = useMemo(
    () =>
      layoutTreemap(
        { x: 0, y: 0, width: canvasSize.width, height: canvasSize.height },
        nodes,
      ),
    [nodes, canvasSize],
  );

  // Paint the treemap from tokens; labels make it understandable without
  // color alone and the list is the complete keyboard interface.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(canvasSize.width * ratio));
    canvas.height = Math.max(1, Math.round(canvasSize.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, canvasSize.width, canvasSize.height);
    const styles = getComputedStyle(canvas);
    const accent = styles.getPropertyValue("--adp-accent-explorer").trim() || "transparent";
    const text = styles.getPropertyValue("--adp-color-text-primary").trim() || "transparent";
    const border = styles.getPropertyValue("--adp-color-border-default").trim() || "transparent";
    const font = styles.getPropertyValue("--adp-font-family").trim() || "sans-serif";
    for (const rect of rects) {
      context.globalAlpha = rect.kind === "folder" ? 0.32 : 0.18;
      context.fillStyle = accent;
      context.fillRect(rect.draw_x, rect.draw_y, rect.draw_width, rect.draw_height);
      context.globalAlpha = 1;
      context.strokeStyle = border;
      context.strokeRect(
        rect.draw_x + 0.5,
        rect.draw_y + 0.5,
        Math.max(0, rect.draw_width - 1),
        Math.max(0, rect.draw_height - 1),
      );
      if (rect.draw_width > 80 && rect.draw_height > 26) {
        context.fillStyle = text;
        context.font = `12px ${font}`;
        context.fillText(
          truncateLabel(rect.other_count ? t("storage.other") : rect.name, rect.draw_width - 8),
          rect.draw_x + 4,
          rect.draw_y + 16,
        );
      }
    }
  }, [rects, canvasSize, t]);

  const openNode = async (node: StorageNode) => {
    if (node.kind === "folder") await props.onOpenFolder(node.path);
    else await props.onOpenFile(node.path);
  };

  const drill = async (node: StorageNode) => {
    if (node.kind !== "folder") return;
    setParents((current) => [...current, { id: node.id, name: node.name }]);
    try {
      await loadPage(node.id);
    } catch (failure) {
      setParents((current) => current.slice(0, -1));
      setError(failure);
    }
  };

  const goToParent = async () => {
    const next = parents.slice(0, -1);
    const target = next.length > 0 ? next[next.length - 1].id : null;
    setParents(next);
    try {
      await loadPage(target);
    } catch (failure) {
      setError(failure);
    }
  };

  const loadMore = async () => {
    if (!page?.next_cursor) return;
    try {
      await loadPage(currentParent, page.next_cursor, true);
    } catch (failure) {
      setError(failure);
    }
  };

  const canvasClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const hit = hitTest(rects, event.clientX - rect.left, event.clientY - rect.top);
    if (!hit) return;
    setSelected(new Set([hit.path]));
  };

  const allocatedLabel = summary
    ? typeof summary.allocated_unique_bytes === "number"
      ? formatSize(summary.allocated_unique_bytes, i18n.language)
      : t("storage.unknownValue")
    : "";
  const onlineOnly = nodes.some((node) => node.online_only);
  const breakdown: TypeBreakdown[] = page?.typed_breakdown ?? [];

  return (
    <div className="adp-storage-view">
      <header className="adp-storage-header">
        <div className="adp-storage-title">
          <HardDrive size={18} aria-hidden="true" />
          <div>
            <h1>{t("storage.title")}</h1>
            <span className="adp-storage-root" title={storageDisplayPath(props.request.root)}>
              {storageDisplayPath(props.request.root)}
            </span>
          </div>
        </div>
        <div className="adp-storage-header-actions">
          {loading ? (
            <Button
              variant="subtle"
              onClick={() => void jobRef.current?.cancel()}
            >
              {t("common.cancel")}
            </Button>
          ) : null}
          <Button
            variant="subtle"
            disabled={parents.length === 0}
            onClick={() => void goToParent()}
          >
            <ArrowUp size={14} aria-hidden="true" />
            {t("storage.parent")}
          </Button>
          <Button
            variant="subtle"
            disabled={selected.size === 0}
            onClick={() => {
              if (selected.size === 0) return;
              void props
                .onMutation({ type: "recycle", paths: [...selected] })
                .then(() => clearSelection())
                .catch((failure) => setError(failure));
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            {t("commands.delete")}
          </Button>
          <HelpButton onOpenHelp={() => props.onOpenHelp("storage-view")} />
          {props.onClose ? (
            <button
              type="button"
              className="adp-icon-btn"
              aria-label={t("common.close")}
              title={t("common.close")}
              onClick={props.onClose}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p className="adp-storage-error" role="alert">
          {errorText(t, error, "storage")}
        </p>
      ) : null}
      {summary?.stale ? <p className="adp-storage-note">{t("storage.stale")}</p> : null}
      {summary?.coverage === "partial" || summary?.cancelled ? (
        <p className="adp-storage-note">{t("storage.partial")}</p>
      ) : null}
      {onlineOnly ? <p className="adp-storage-note">{t("storage.cloud")}</p> : null}
      {summary && summary.unknown_allocated_count > 0 ? (
        <p className="adp-storage-note">{t("storage.unknown")}</p>
      ) : null}

      {loading && !summary ? (
        <div className="adp-storage-loading" role="status" aria-label={t("storage.scan")}>
          <p>{t("storage.scan")}</p>
          <Skeleton variant="rows" count={4} />
        </div>
      ) : null}

      {summary ? (
        <div className="adp-storage-summary" aria-label={t("storage.title")}>
          <div className="adp-storage-card">
            <span>{t("storage.logical")}</span>
            <strong>{formatSize(summary.logical_bytes, i18n.language)}</strong>
          </div>
          <div className="adp-storage-card">
            <span>{t("storage.allocated")}</span>
            <strong>{allocatedLabel}</strong>
          </div>
          <div className="adp-storage-card">
            <span>{t("storage.largest")}</span>
            <strong>{summary.files_count + summary.folders_count}</strong>
          </div>
          <div className="adp-storage-card">
            <span>{t("storage.types")}</span>
            <strong>{breakdown.length}</strong>
          </div>
        </div>
      ) : null}

      {summary && nodes.length === 0 && page?.complete ? (
        <p className="adp-storage-empty">{t("storage.empty")}</p>
      ) : null}

      <div className="adp-storage-layout">
        <section className="adp-storage-treemap" aria-label={t("storage.title")}>
          <div className="adp-storage-section-header">
            <h2 className="adp-storage-heading">{t("storage.title")}</h2>
            {loading ? <span className="adp-storage-status">{t("storage.scan")}</span> : null}
          </div>
          <canvas
            ref={canvasRef}
            className="adp-storage-canvas"
            aria-hidden="true"
            onClick={canvasClick}
          />
          <ul className="adp-storage-tile-list" aria-label={t("storage.largest")}>
            {nodes.map((node) => {
              const isSelected = selected.has(node.path);
              return (
                <li key={node.id} className="adp-storage-tile-row">
                  <button
                    type="button"
                    className={`adp-storage-tile-action${isSelected ? " adp-storage-tile-action--selected" : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => setSelected(new Set([node.path]))}
                    onDoubleClick={() => void openNode(node)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void openNode(node);
                    }}
                  >
                    <span title={storageDisplayPath(node.path)}>{node.name}</span>
                    <span>{formatSize(node.logical_bytes, i18n.language)}</span>
                  </button>
                  <button
                    type="button"
                    className="adp-icon-btn"
                    aria-label={t("common.open")}
                    title={t("common.open")}
                    onClick={() => void openNode(node)}
                  >
                    <FolderOpen size={13} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <LargestItems
          nodes={nodes}
          totalCount={summary ? summary.files_count + summary.folders_count : 0}
          label={t("storage.largest")}
          nextCursor={page?.next_cursor}
          loading={loading}
          selected={selected}
          onSelect={(node) => setSelected(new Set([node.path]))}
          onOpen={(node) => void openNode(node)}
          onDrill={(node) => void drill(node)}
          onLoadMore={() => void loadMore()}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={(key) => {
            if (key === sortKey) {
              setSortDirection((current) =>
                current === "ascending" ? "descending" : "ascending",
              );
            } else {
              setSortKey(key);
              setSortDirection("descending");
            }
          }}
        />
      </div>

      {breakdown.length > 0 ? (
        <section className="adp-storage-types" aria-label={t("storage.types")}>
          <h2 className="adp-storage-heading">{t("storage.types")}</h2>
          <ul>
            {breakdown.map((group) => (
              <li key={group.kind}>
                <span>
                  {t(`storage.type.${group.kind}`, {
                    defaultValue: t("storage.type.other"),
                  })}
                </span>
                <span>{group.count}</span>
                <span>{formatSize(group.logical_bytes, i18n.language)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}


