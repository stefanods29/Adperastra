import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, Copy, FileText, ListCollapse } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Skeleton from "../../components/Skeleton";
import type { Command } from "../../commands/registry";
import { errorCode, errorText } from "../../services/errors";
import { formatSize } from "../../services/format";
import {
  jsonChildren,
  jsonClose,
  jsonCopy,
  jsonFind,
  jsonOpen,
  type JsonInvalidError,
  type JsonMatch,
  type JsonNodeInfo,
  type JsonSummary,
} from "../../services/jsonView";
import type { TextEncodingId } from "../../services/tableView";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { flattenTree, type JsonPages, type JsonRow } from "./tree";

const ROW_HEIGHT = 26;
const OVERSCAN = 10;
/** Children one page asks Rust for. */
const PAGE_ROWS = 1000;
/** Each level indents this far. */
const INDENT = 18;

const ENCODING_NAMES: Record<TextEncodingId, string> = {
  utf8: "UTF-8",
  utf16_le: "UTF-16 LE",
  utf16_be: "UTF-16 BE",
  windows1252: "Windows-1252",
};

interface JsonCtx {
  canCollapse: boolean;
  canCopy: boolean;
  canOpenAsText: boolean;
}

/** JSON files as a tree you can fold (Step 06f): pages load on demand,
 * Ctrl+F finds keys and values, and Ctrl+C copies the selected value. */
export default function JsonView({
  info,
  active,
  savedState: _savedState,
  onStateChange: _onStateChange,
  onStatus,
  onOpenInWindowsApp,
  find,
  onOpenAsText,
}: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const [summary, setSummary] = useState<JsonSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cancelled, setCancelled] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [pages, setPages] = useState<JsonPages>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const sessionRef = useRef<string | null>(null);
  const expandedRef = useRef<Set<number>>(new Set());
  const pagesRef = useRef<JsonPages>(new Map());
  const selectedRef = useRef<string | null>(null);
  const nodesRef = useRef(new Map<number, JsonNodeInfo>());
  const pending = useRef(new Map<string, Promise<JsonNodeInfo[]>>());
  const openJob = useRef<{ cancel: () => Promise<void> } | null>(null);
  const reopened = useRef(false);

  const root = summary?.root ?? null;
  const rows = useMemo(() => flattenTree(root, expanded, pages), [root, expanded, pages]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const applyExpanded = useCallback((next: Set<number>) => {
    expandedRef.current = next;
    setExpanded(next);
  }, []);

  const applySelected = useCallback((key: string | null) => {
    selectedRef.current = key;
    setSelected(key);
  }, []);

  const loadPage = useCallback(async (container: number, page: number): Promise<JsonNodeInfo[]> => {
    const cached = pagesRef.current.get(container)?.get(page);
    if (cached) return [...cached];
    const id = `${container}:${page}`;
    const running = pending.current.get(id);
    if (running) return running;
    const session = sessionRef.current;
    if (!session) return [];
    const work = (async () => {
      try {
        const found = await jsonChildren(session, container, page * PAGE_ROWS, PAGE_ROWS);
        const next = new Map(pagesRef.current);
        const containerPages = new Map(next.get(container) ?? []);
        containerPages.set(page, found);
        next.set(container, containerPages);
        pagesRef.current = next;
        setPages(next);
        for (const node of found) nodesRef.current.set(node.id, node);
        return found;
      } catch (failure) {
        if (errorCode(failure) === "json.no_session" && !reopened.current) {
          reopened.current = true;
          setError(failure);
        }
        return [];
      } finally {
        pending.current.delete(id);
      }
    })();
    pending.current.set(id, work);
    return work;
  }, []);

  // Read the file once and open the root.
  useEffect(() => {
    let cancelledRun = false;
    const previous = sessionRef.current;
    sessionRef.current = null;
    setSummary(null);
    setError(null);
    setCancelled(false);
    setPages(new Map());
    pagesRef.current = new Map();
    nodesRef.current = new Map();
    pending.current.clear();
    applyExpanded(new Set());
    applySelected(null);
    setNotice(null);
    reopened.current = false;
    if (previous) void jsonClose(previous);
    void (async () => {
      try {
        const job = await jsonOpen(info.path);
        openJob.current = job;
        if (cancelledRun) {
          void job.cancel();
          return;
        }
        const opened = await job.completion;
        openJob.current = null;
        if (cancelledRun) return;
        sessionRef.current = opened.session;
        nodesRef.current.set(opened.root.id, opened.root);
        setSummary(opened);
        applyExpanded(new Set([opened.root.id]));
        applySelected(`n${opened.root.id}`);
        void loadPage(opened.root.id, 0);
      } catch (failure) {
        openJob.current = null;
        if (cancelledRun) return;
        if (errorCode(failure) === "data.cancelled") setCancelled(true);
        else setError(failure);
      }
    })();
    return () => {
      cancelledRun = true;
      void openJob.current?.cancel();
    };
  }, [info.path, applyExpanded, applySelected, loadPage]);

  // Closing the tab closes the session.
  useEffect(
    () => () => {
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void jsonClose(session);
    },
    [],
  );

  // Selecting a row focuses it and keeps it on screen.
  useEffect(() => {
    if (!selected) return;
    const element = rowRefs.current.get(selected);
    element?.focus({ preventScroll: true });
  }, [selected, rows.length]);

  useEffect(() => {
    if (scrollTo === null) return;
    const index = rows.findIndex((row) => row.kind === "node" && row.node?.id === scrollTo);
    if (index >= 0) virtualizer.scrollToIndex(index);
    setScrollTo(null);
    // The row list and the virtualizer are read when the request arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo]);

  // Status bar.
  useEffect(() => {
    const items: string[] = [];
    if (summary) {
      items.push(t("json.nodeCount", { count: summary.nodes }));
      items.push(ENCODING_NAMES[summary.encoding]);
    }
    items.push(formatSize(info.size, i18n.language));
    if (notice) items.push(notice);
    onStatus({ items });
  }, [summary, info.size, i18n.language, notice, onStatus, t]);

  const toggle = useCallback(
    (container: JsonNodeInfo) => {
      const open = expandedRef.current.has(container.id);
      const next = new Set(expandedRef.current);
      if (open) next.delete(container.id);
      else {
        next.add(container.id);
        if (container.child_count > 0 && !pagesRef.current.get(container.id)?.has(0)) {
          void loadPage(container.id, 0);
        }
      }
      applyExpanded(next);
    },
    [applyExpanded, loadPage],
  );

  const loadNext = useCallback(
    (containerId: number) => {
      const containerPages = pagesRef.current.get(containerId);
      let page = 0;
      while (containerPages?.has(page)) page += 1;
      void loadPage(containerId, page);
    },
    [loadPage],
  );

  const copySelected = useCallback(async () => {
    const row = rows.find((entry) => entry.key === selectedRef.current);
    const session = sessionRef.current;
    if (!row?.node || !session) return;
    try {
      const text = await jsonCopy(session, row.node.id);
      await navigator.clipboard.writeText(text);
      setNotice(t("json.copied"));
    } catch {
      setNotice(t("json.copyFailed"));
    }
  }, [rows, t]);

  // Find: open the containers around the match, then select and scroll to it.
  const runFind = useCallback(
    async (match: JsonMatch) => {
      const chain = [...match.ancestors, match.id];
      for (let index = 0; index < chain.length - 1; index += 1) {
        const parent = chain[index];
        const child = chain[index + 1];
        if (!expandedRef.current.has(parent)) {
          applyExpanded(new Set(expandedRef.current).add(parent));
        }
        const container = nodesRef.current.get(parent);
        const count = container?.child_count ?? 0;
        for (let page = 0; page < Math.ceil(count / PAGE_ROWS); page += 1) {
          const found = await loadPage(parent, page);
          if (found.some((node) => node.id === child) || found.length === 0) break;
        }
      }
      applySelected(`n${match.id}`);
      setScrollTo(match.id);
    },
    [applyExpanded, applySelected, loadPage],
  );

  useEffect(() => {
    if (find.request === 0 || !summary || find.text === "") return;
    let cancelledFind = false;
    const selectedRow = rows.find((row) => row.key === selectedRef.current);
    const after = selectedRow?.node?.id ?? null;
    void (async () => {
      try {
        const match = await jsonFind(
          summary.session,
          find.text,
          find.options?.caseSensitive ?? false,
          after,
          find.backwards,
        );
        if (cancelledFind) return;
        if (!match) {
          setNotice(t("json.noMatches"));
          return;
        }
        setNotice(null);
        await runFind(match);
      } catch {
        if (!cancelledFind) setNotice(t("json.noMatches"));
      }
    })();
    return () => {
      cancelledFind = true;
    };
    // The request number is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find.request]);

  const selectedRow = rows.find((row) => row.key === selected);
  const canCopy = selectedRow?.kind === "node";

  const moveTo = useCallback(
    (index: number) => {
      const row = rows[index];
      if (row) applySelected(row.key);
    },
    [applySelected, rows],
  );

  const onRowKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, row: JsonRow) => {
      const index = rows.findIndex((entry) => entry.key === row.key);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveTo(Math.min(rows.length - 1, index + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveTo(Math.max(0, index - 1));
      } else if (event.key === "Home") {
        event.preventDefault();
        moveTo(0);
      } else if (event.key === "End") {
        event.preventDefault();
        moveTo(rows.length - 1);
      } else if (event.key === "PageDown") {
        event.preventDefault();
        moveTo(Math.min(rows.length - 1, index + 20));
      } else if (event.key === "PageUp") {
        event.preventDefault();
        moveTo(Math.max(0, index - 20));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (row.kind === "more" && row.parentId !== null) {
          loadNext(row.parentId);
          return;
        }
        if (!row.node) return;
        if (row.node.kind === "object" || row.node.kind === "array") {
          if (!expandedRef.current.has(row.node.id)) toggle(row.node);
          else moveTo(Math.min(rows.length - 1, index + 1));
        }
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (!row.node) return;
        if (expandedRef.current.has(row.node.id)) toggle(row.node);
        else {
          let parent = -1;
          for (let above = index - 1; above >= 0; above -= 1) {
            if (rows[above].depth === row.depth - 1) {
              parent = above;
              break;
            }
          }
          if (parent >= 0) moveTo(parent);
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (row.kind === "more" && row.parentId !== null) loadNext(row.parentId);
        else if (row.node && (row.node.kind === "object" || row.node.kind === "array")) toggle(row.node);
      }
    },
    [applySelected, loadNext, moveTo, rows, toggle],
  );

  const ctx: JsonCtx = {
    canCollapse: expanded.size > (root ? 1 : 0),
    canCopy: canCopy && focused,
    canOpenAsText: Boolean(onOpenAsText),
  };
  const commands = useMemo<Command<JsonCtx>[]>(
    () => [
      {
        id: "json.collapseAll",
        labelKey: "json.collapseAll",
        icon: ListCollapse,
        risk: "read-only",
        helpSlug: "viewing-json",
        enabledWhen: (current) => current.canCollapse,
        run: () => {
          if (root) applyExpanded(new Set([root.id]));
        },
      },
      {
        id: "json.copyValue",
        labelKey: "json.copyValue",
        icon: Copy,
        shortcut: "Ctrl+C",
        risk: "read-only",
        helpSlug: "viewing-json",
        enabledWhen: (current) => current.canCopy,
        run: () => void copySelected(),
      },
      {
        id: "json.openAsText",
        labelKey: "viewer.openAsText",
        icon: FileText,
        risk: "read-only",
        helpSlug: "viewing-json",
        visibleWhen: (current) => current.canOpenAsText,
        enabledWhen: (current) => current.canOpenAsText,
        run: () => onOpenAsText?.(),
      },
    ],
    [root, applyExpanded, copySelected, onOpenAsText],
  );
  useCommandShortcuts(commands, ctx, active);

  const ribbon: RibbonDef = {
    tabs: [
      {
        id: "view",
        labelKey: "ribbon.view",
        keyTip: "V",
        groups: [
          {
            id: "tree",
            labelKey: "handlers.json",
            controls: [
              { type: "button", command: "json.collapseAll", showLabel: false, keyTip: "C" },
              { type: "button", command: "json.copyValue", keyTip: "Y" },
            ],
          },
          {
            id: "open",
            labelKey: "commands.open",
            controls: [{ type: "button", command: "json.openAsText", keyTip: "O" }],
          },
        ],
      },
    ],
  };

  const invalid = error && typeof error === "object" && "line" in error ? (error as JsonInvalidError) : null;
  const openAsTextButton = onOpenAsText ? (
    <Button onClick={onOpenAsText}>{t("viewer.openAsText")}</Button>
  ) : null;

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      {error ? (
        <div className="adp-viewer-message" role="alert">
          <p>{errorText(t, error, "data")}</p>
          {invalid ? (
            <p className="adp-viewer-detail">
              {t("json.invalidAt", { line: invalid.line, column: invalid.column })}
            </p>
          ) : null}
          <div className="adp-dialog-actions">
            {openAsTextButton}
            <Button onClick={onOpenInWindowsApp}>{t("fileTab.openInWindowsApp")}</Button>
          </div>
        </div>
      ) : null}
      {cancelled ? (
        <div className="adp-viewer-message" role="status">
          <p>{t("json.reading")}</p>
        </div>
      ) : null}
      {!summary && !error && !cancelled ? (
        <div className="adp-viewer-message" role="status">
          <Skeleton variant="rows" count={8} />
          <p>{t("json.reading")}</p>
        </div>
      ) : null}
      {summary ? (
        <div
          ref={scrollRef}
          className="adp-json"
          role="tree"
          aria-label={t("json.label", { name: info.name })}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{ ["--adp-json-size" as string]: `${ROW_HEIGHT}px` }}
        >
          <div className="adp-json-rows" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              if (row.kind === "more") {
                return (
                  <div
                    key={row.key}
                    className="adp-json-row adp-json-more"
                    role="treeitem"
                    aria-level={row.depth + 1}
                    tabIndex={selected === row.key ? 0 : -1}
                    style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT, paddingLeft: row.depth * INDENT }}
                    onClick={() => {
                      applySelected(row.key);
                      if (row.parentId !== null) loadNext(row.parentId);
                    }}
                    onKeyDown={(event) => onRowKey(event, row)}
                    ref={(element) => {
                      if (element) rowRefs.current.set(row.key, element);
                      else rowRefs.current.delete(row.key);
                    }}
                  >
                    {t("json.showMore", { count: row.remaining })}
                  </div>
                );
              }
              const node = row.node;
              if (!node) return null;
              const container = node.kind === "object" || node.kind === "array";
              const open = expanded.has(node.id);
              const label =
                node.key !== null ? node.key : node.index !== null ? String(node.index) : "";
              const value = container
                ? t("json.items", { count: node.child_count })
                : node.kind === "string"
                  ? `"${node.preview}${node.preview_cut ? "…" : ""}"`
                  : node.preview;
              return (
                <div
                  key={row.key}
                  className={
                    selected === row.key ? "adp-json-row adp-json-row--selected" : "adp-json-row"
                  }
                  role="treeitem"
                  aria-level={row.depth + 1}
                  aria-expanded={container ? open : undefined}
                  aria-selected={selected === row.key}
                  tabIndex={selected === row.key ? 0 : -1}
                  style={{
                    transform: `translateY(${item.start}px)`,
                    height: ROW_HEIGHT,
                    paddingLeft: row.depth * INDENT,
                  }}
                  onClick={() => applySelected(row.key)}
                  onDoubleClick={() => {
                    if (container) toggle(node);
                  }}
                  onKeyDown={(event) => onRowKey(event, row)}
                  ref={(element) => {
                    if (element) rowRefs.current.set(row.key, element);
                    else rowRefs.current.delete(row.key);
                  }}
                >
                  <span className={open ? "adp-json-chevron adp-json-chevron--open" : "adp-json-chevron"}>
                    {container ? <ChevronRight size={14} aria-hidden="true" /> : null}
                  </span>
                  {label !== "" ? <span className="adp-json-key">{label}</span> : null}
                  {label !== "" ? <span className="adp-json-colon">:</span> : null}
                  <span className={`adp-json-value adp-json-${node.kind}`}>{value}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </ViewerFrame>
  );
}
