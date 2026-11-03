import { useVirtualizer } from "@tanstack/react-virtual";
import { FileText, Play, Pause } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Skeleton from "../../components/Skeleton";
import type { Command } from "../../commands/registry";
import { useRowSizes } from "../../appearance/density";
import { errorText } from "../../services/errors";
import type { LogRecord } from "../../services/extraViews";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { useExtraView } from "../extraView/useExtraView";

interface LogCtx {
  ready: boolean;
  tail: boolean;
  more: boolean;
  canOpenAsText: boolean;
}

const MAX_LINES = 100_000;

/** Every level is also a text label, never color alone. */
export function levelKey(level: LogRecord["level"]): string {
  return `log.level_${level}`;
}

export default function LogView({
  info,
  active,
  onStatus,
  onOpenInWindowsApp,
  onOpenAsText,
  find,
  previewOnly,
}: HandlerViewProps) {
  const { t } = useTranslation();
  const size = useRowSizes();
  const view = useExtraView(info.path, "log", active);
  const [lines, setLines] = useState<LogRecord[]>([]);
  const [tail, setTail] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [showReading, setShowReading] = useState(false);
  const [matches, setMatches] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastFind = useRef({ request: 0, text: "" });
  const lastFetchedCursor = useRef<string | null>(null);
  const tailRef = useRef(false);
  tailRef.current = tail;
  const pageCursor = view.page?.next_cursor ?? null;

  useEffect(() => {
    setLines([]);
    setSelected(null);
    lastFetchedCursor.current = null;
  }, [view.session?.session_id]);

  useEffect(() => {
    const payload = view.page?.payload;
    if (!payload || payload.kind !== "log") return;
    const incoming = payload.lines;
    setLines((current) => {
      if (incoming.length === 0) return current;
      const byLine = new Map(current.map((line) => [line.line, line]));
      for (const line of incoming) byLine.set(line.line, line);
      const merged = [...byLine.values()].sort((left, right) => {
        const a = BigInt(left.line);
        const b = BigInt(right.line);
        return a < b ? -1 : a > b ? 1 : 0;
      });
      return merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
    });
  }, [view.page]);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => size.row,
    overscan: 20,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const lastRow = virtualRows.length > 0 ? virtualRows[virtualRows.length - 1].index : 0;

  const fetchNext = useCallback(
    (cursor: string) => {
      if (lastFetchedCursor.current === cursor) return;
      lastFetchedCursor.current = cursor;
      void view.request({ cursor });
    },
    [view],
  );

  // The next page arrives when the viewport reaches the loaded end.
  useEffect(() => {
    if (!pageCursor || view.loadingPage) return;
    if (view.page?.complete) return;
    if (lastRow + 20 >= lines.length) fetchNext(pageCursor);
  }, [lastRow, lines.length, pageCursor, view.page?.complete, view.loadingPage, fetchNext]);

  // Follow new lines: one bounded request per second, only while enabled.
  useEffect(() => {
    if (!tail || !pageCursor) return;
    const timer = window.setInterval(() => {
      if (!tailRef.current || view.loadingPage) return;
      void view.request({ cursor: pageCursor });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [tail, pageCursor, view]);

  useEffect(() => {
    if (view.phase !== "loading") {
      setShowReading(false);
      return;
    }
    const timer = window.setTimeout(() => setShowReading(true), 1000);
    return () => window.clearTimeout(timer);
  }, [view.phase]);

  useEffect(() => {
    if (find.request === lastFind.current.request && find.text === lastFind.current.text) return;
    lastFind.current = { request: find.request, text: find.text };
    if (find.text === "") {
      setMatches(0);
      return;
    }
    let count = 0;
    for (let index = 0; index < lines.length && count < 10_000; index += 1) {
      const found = lines[index].text.indexOf(find.text);
      if (found >= 0) {
        count += 1;
        virtualizer.scrollToIndex(index);
      }
    }
    setMatches(count);
  }, [find.request, find.text, lines, virtualizer]);

  useEffect(() => {
    const items: string[] = [];
    if (lines.length > 0) items.push(t("log.lineCount", { count: lines.length }));
    if (tail) items.push(t("extra_view.tail"));
    if (find.text !== "") items.push(t("viewer.matches", { count: matches }));
    onStatus({ items });
  }, [lines.length, tail, find.text, matches, onStatus, t]);

  const ctx: LogCtx = {
    ready: lines.length > 0,
    tail,
    more: Boolean(pageCursor) && !view.page?.complete,
    canOpenAsText: Boolean(onOpenAsText),
  };
  const commands = useMemo<Command<LogCtx>[]>(
    () => [
      {
        id: "log.tail",
        labelKey: "extra_view.tail",
        icon: tail ? Pause : Play,
        risk: "read-only",
        helpSlug: "viewing-logs",
        checkKind: "toggle",
        checkedWhen: (current) => current.tail,
        enabledWhen: () => true,
        run: () => setTail((value) => !value),
      },
      {
        id: "log.openAsText",
        labelKey: "viewer.openAsText",
        icon: FileText,
        risk: "read-only",
        helpSlug: "viewing-text",
        visibleWhen: (current) => current.canOpenAsText,
        enabledWhen: (current) => current.canOpenAsText,
        run: () => onOpenAsText?.(),
      },
    ],
    [tail, onOpenAsText],
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
            id: "log",
            labelKey: "handlers.log",
            controls: [{ type: "toggle", command: "log.tail", keyTip: "F" }],
          },
          {
            id: "open",
            labelKey: "commands.open",
            controls: [{ type: "button", command: "log.openAsText", keyTip: "T" }],
          },
        ],
      },
    ],
  };

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (lines.length === 0) return;
    const current = selected ?? 0;
    let target: number | null = null;
    if (event.key === "ArrowDown") target = current + 1;
    else if (event.key === "ArrowUp") target = current - 1;
    else if (event.key === "PageDown") target = current + 20;
    else if (event.key === "PageUp") target = current - 20;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = lines.length - 1;
    if (target === null) return;
    event.preventDefault();
    const bounded = Math.max(0, Math.min(target, lines.length - 1));
    setSelected(bounded);
    virtualizer.scrollToIndex(bounded);
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      <div className="adp-log">
        {view.phase === "loading" ? (
          <div className="adp-viewer-message" role="status">
            <Skeleton variant="rows" count={10} />
            {showReading ? (
              <>
                <p>{t("components.loading")}</p>
                <Button onClick={view.cancelOpen}>{t("common.cancel")}</Button>
              </>
            ) : null}
          </div>
        ) : null}
        {view.phase === "error" ? (
          <div className="adp-viewer-message" role="alert">
            <p>{errorText(t, view.error, "extra_view")}</p>
            <div className="adp-dialog-actions">
              <Button onClick={view.reload}>{t("common.retry")}</Button>
              <Button variant="primary" onClick={onOpenInWindowsApp}>
                {t("fileTab.openInWindowsApp")}
              </Button>
            </div>
          </div>
        ) : null}
        {lines.length > 0 ? (
          <div
            ref={scrollRef}
            className="adp-log-grid"
            role="grid"
            aria-label={t("log.label", { name: info.name })}
            aria-rowcount={lines.length}
            tabIndex={0}
            onKeyDown={onGridKey}
          >
            <div className="adp-log-body" style={{ height: virtualizer.getTotalSize() }}>
              {virtualRows.map((item) => {
                const line = lines[item.index];
                return (
                  <div
                    key={item.key}
                    className={`adp-log-row${item.index === selected ? " adp-log-row--selected" : ""}`}
                    role="row"
                    aria-selected={item.index === selected}
                    style={{ transform: `translateY(${item.start}px)`, height: size.row }}
                    onClick={() => setSelected(item.index)}
                  >
                    <span className="adp-log-number" role="rowheader">{line?.line ?? ""}</span>
                    <span className={`adp-log-level adp-log-level--${line?.level ?? "none"}`} role="gridcell">
                      {t(levelKey(line?.level ?? "none"))}
                    </span>
                    <span className="adp-log-text" role="gridcell">{line?.text ?? ""}</span>
                    {line?.truncated ? (
                      <span className="adp-log-cut" role="note">{t("extra_view.partial")}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {view.page && !view.page.complete && pageCursor ? (
          <Button onClick={() => fetchNext(pageCursor)}>{t("commands.more")}</Button>
        ) : null}
        {view.page?.partial ? <p className="adp-viewer-note" role="note">{t("extra_view.partial")}</p> : null}
        {previewOnly ? <p className="adp-viewer-note" role="note">{t("preview.readOnly")}</p> : null}
      </div>
    </ViewerFrame>
  );
}
