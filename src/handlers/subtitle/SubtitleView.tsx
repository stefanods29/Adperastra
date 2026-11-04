import { useVirtualizer } from "@tanstack/react-virtual";
import { FileText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Skeleton from "../../components/Skeleton";
import type { Command } from "../../commands/registry";
import { useRowSizes } from "../../appearance/density";
import { errorText } from "../../services/errors";
import type { SubtitleCue } from "../../services/extraViews";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { useExtraView } from "../extraView/useExtraView";

interface SubtitleCtx {
  ready: boolean;
  canOpenAsText: boolean;
}

/** Exact SRT-style clock text; a technical value, not a translated phrase. */
export function formatCueTime(milliseconds: number): string {
  const value = Math.max(0, Math.floor(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  const millis = value % 1_000;
  const pad = (number: number, size = 2) => String(number).padStart(size, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

/** Literal, case-insensitive cue search. Returns cue indices in display order. */
export function findCues(cues: readonly SubtitleCue[], needle: string): number[] {
  if (needle === "") return [];
  const wanted = needle.toLocaleLowerCase();
  const output: number[] = [];
  for (const cue of cues) {
    if (cue.text.toLocaleLowerCase().includes(wanted)) output.push(cue.index);
    if (output.length >= 10_000) break;
  }
  return output;
}

export default function SubtitleView({
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
  const view = useExtraView(info.path, "subtitle", active);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [showReading, setShowReading] = useState(false);
  const [matches, setMatches] = useState<number[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const matchCursor = useRef(0);
  const lastFind = useRef({ request: 0, text: "" });
  const lastFetchedCursor = useRef<string | null>(null);

  useEffect(() => {
    setCues([]);
    setSelected(null);
    setMatches([]);
    matchCursor.current = 0;
    lastFetchedCursor.current = null;
  }, [view.session?.session_id]);

  useEffect(() => {
    const payload = view.page?.payload;
    if (!payload || payload.kind !== "subtitle") return;
    const incoming = payload.cues;
    setCues((current) => {
      const byIndex = new Map(current.map((cue) => [cue.index, cue]));
      for (const cue of incoming) byIndex.set(cue.index, cue);
      return [...byIndex.values()].sort(
        (left, right) => left.start_ms - right.start_ms || left.index - right.index,
      );
    });
  }, [view.page]);

  const total = Math.max(view.session?.item_count ?? 0, cues.length);
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => size.row,
    overscan: 16,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const lastRow = virtualRows.length > 0 ? virtualRows[virtualRows.length - 1].index : 0;

  // Fetch the next server page when the visible window reaches the loaded
  // cues; at most one request is in flight.
  useEffect(() => {
    const cursor = view.page?.next_cursor ?? null;
    if (!cursor || view.loadingPage) return;
    if (lastRow + 24 >= cues.length && total > cues.length) {
      if (lastFetchedCursor.current === cursor) return;
      lastFetchedCursor.current = cursor;
      void view.request({ cursor });
    }
  }, [lastRow, cues.length, total, view]);

  useEffect(() => {
    if (view.phase !== "loading") {
      setShowReading(false);
      return;
    }
    const timer = window.setTimeout(() => setShowReading(true), 1000);
    return () => window.clearTimeout(timer);
  }, [view.phase]);

  const runFind = useCallback(
    (request: number, text: string) => {
      if (request === lastFind.current.request && text === lastFind.current.text) return;
      lastFind.current = { request, text };
      const found = findCues(cues, text);
      setMatches(found);
      if (found.length === 0) return;
      const target = found[matchCursor.current % found.length];
      matchCursor.current += 1;
      const position = cues.findIndex((cue) => cue.index === target);
      if (position >= 0) virtualizer.scrollToIndex(position);
    },
    [cues, virtualizer],
  );

  useEffect(() => {
    runFind(find.request, find.text);
    // The request number is the trigger; `runFind` reads the cues it has.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find.request, find.text]);

  useEffect(() => {
    const items: string[] = [];
    if (cues.length > 0) items.push(t("subtitle.cueCount", { count: total }));
    if (view.page?.partial) items.push(t("extra_view.partial"));
    if (find.text !== "") items.push(t("viewer.matches", { count: matches.length }));
    onStatus({ items });
  }, [cues.length, total, view.page?.partial, find.text, matches.length, onStatus, t]);

  const ctx: SubtitleCtx = {
    ready: cues.length > 0,
    canOpenAsText: Boolean(onOpenAsText),
  };
  const commands = useMemo<Command<SubtitleCtx>[]>(
    () => [
      {
        id: "subtitle.openAsText",
        labelKey: "viewer.openAsText",
        icon: FileText,
        risk: "read-only",
        helpSlug: "viewing-text",
        visibleWhen: (current) => current.canOpenAsText,
        enabledWhen: (current) => current.canOpenAsText,
        run: () => onOpenAsText?.(),
      },
    ],
    [onOpenAsText],
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
            id: "subtitle",
            labelKey: "handlers.subtitle",
            controls: [{ type: "button", command: "subtitle.openAsText", keyTip: "T" }],
          },
        ],
      },
    ],
  };

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (cues.length === 0) return;
    const current = selected === null ? 0 : Math.max(0, cues.findIndex((cue) => cue.index === selected));
    let target: number | null = null;
    if (event.key === "ArrowDown") target = current + 1;
    else if (event.key === "ArrowUp") target = current - 1;
    else if (event.key === "PageDown") target = current + 20;
    else if (event.key === "PageUp") target = current - 20;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = cues.length - 1;
    if (target === null) return;
    event.preventDefault();
    const bounded = Math.max(0, Math.min(target, cues.length - 1));
    setSelected(cues[bounded]?.index ?? null);
    virtualizer.scrollToIndex(bounded);
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      <div className="adp-subtitles">
        {view.phase === "loading" ? (
          <div className="adp-viewer-message" role="status">
            <Skeleton variant="rows" count={8} />
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
        {cues.length > 0 ? (
          <div
            ref={scrollRef}
            className="adp-subtitles-grid"
            role="grid"
            aria-label={t("subtitle.label", { name: info.name })}
            aria-rowcount={total}
            tabIndex={0}
            onKeyDown={onGridKey}
          >
            <div className="adp-subtitles-head" role="row">
              <span role="columnheader">{t("extra_view.start")}</span>
              <span role="columnheader">{t("extra_view.end")}</span>
              <span role="columnheader">{t("subtitle.text")}</span>
            </div>
            <div className="adp-subtitles-body" style={{ height: virtualizer.getTotalSize() }}>
              {virtualRows.map((item) => {
                const cue = cues[item.index];
                return (
                  <div
                    key={item.key}
                    className={`adp-subtitles-row${cue && cue.index === selected ? " adp-subtitles-row--selected" : ""}`}
                    role="row"
                    aria-selected={cue ? cue.index === selected : false}
                    style={{ transform: `translateY(${item.start}px)`, height: size.row }}
                    onClick={() => cue && setSelected(cue.index)}
                  >
                    <span role="gridcell">{cue ? formatCueTime(cue.start_ms) : ""}</span>
                    <span role="gridcell">{cue ? formatCueTime(cue.end_ms) : ""}</span>
                    <span role="gridcell" className="adp-subtitles-text">{cue ? cue.text : ""}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {view.page?.partial ? <p className="adp-viewer-note" role="note">{t("extra_view.partial")}</p> : null}
        {previewOnly ? <p className="adp-viewer-note" role="note">{t("preview.readOnly")}</p> : null}
      </div>
    </ViewerFrame>
  );
}
