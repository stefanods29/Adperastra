import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import SafeMarkupFrame from "../../components/SafeMarkupFrame";
import Skeleton from "../../components/Skeleton";
import type { Command } from "../../commands/registry";
import { errorText } from "../../services/errors";
import {
  type ExtraViewPage,
  type NotebookCell,
} from "../../services/extraViews";
import { fileUrl } from "../../services/files";
import { formatSize } from "../../services/format";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { useExtraView } from "../extraView/useExtraView";

interface NotebookCtx {
  ready: boolean;
  expanded: boolean;
  more: boolean;
  canOpenAsText: boolean;
}

function outputText(cell: NotebookCell): string {
  let text = cell.source;
  for (const output of cell.outputs) {
    if (output.text) text += `\n${output.text}`;
  }
  return text;
}

export default function NotebookView({
  info,
  active,
  onStatus,
  onOpenInWindowsApp,
  onOpenAsText,
  find,
  previewOnly,
}: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const view = useExtraView(info.path, "notebook", active);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [loaded, setLoaded] = useState<NotebookCell[]>([]);
  const [matches, setMatches] = useState(0);
  const [showReading, setShowReading] = useState(false);
  const lastFind = useRef({ request: 0, text: "" });

  useEffect(() => {
    setLoaded([]);
    setExpanded(new Set());
    setAllExpanded(false);
  }, [view.session?.session_id]);

  useEffect(() => {
    const payload = view.page?.payload;
    if (!payload || payload.kind !== "notebook") return;
    const incoming = payload.cells;
    setLoaded((current) => {
      const byIndex = new Map(current.map((cell) => [cell.index, cell]));
      for (const cell of incoming) byIndex.set(cell.index, cell);
      return [...byIndex.values()].sort((left, right) => left.index - right.index);
    });
  }, [view.page]);

  const cells = loaded;
  const partial = view.page?.partial ?? false;

  const toggle = useCallback((index: number) => {
    setAllExpanded(false);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const setEvery = useCallback(
    (value: boolean) => {
      setAllExpanded(value);
      setExpanded(value ? new Set(cells.map((cell) => cell.index)) : new Set());
    },
    [cells],
  );

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
    for (const cell of cells) {
      const text = outputText(cell);
      let at = 0;
      while (count < 10_000) {
        const found = text.indexOf(find.text, at);
        if (found < 0) break;
        count += 1;
        at = found + Math.max(1, find.text.length);
      }
    }
    setMatches(count);
  }, [find.request, find.text, cells]);

  useEffect(() => {
    const items: string[] = [];
    if (cells.length > 0) items.push(t("notebook.cells", { count: cells.length }));
    if (find.text !== "") items.push(t("viewer.matches", { count: matches }));
    if (partial) items.push(t("extra_view.partial"));
    items.push(formatSize(info.size, i18n.language));
    onStatus({ items });
  }, [cells.length, find.text, matches, partial, info.size, i18n.language, onStatus, t]);

  const ctx: NotebookCtx = {
    ready: cells.length > 0,
    expanded: allExpanded,
    more: Boolean(view.page?.next_cursor),
    canOpenAsText: Boolean(onOpenAsText),
  };
  const commands = useMemo<Command<NotebookCtx>[]>(
    () => [
      {
        id: "notebook.expandAll",
        labelKey: "notebook.expandAll",
        icon: ChevronDown,
        risk: "read-only",
        helpSlug: "viewing-notebooks",
        enabledWhen: (current) => current.ready,
        run: () => setEvery(true),
      },
      {
        id: "notebook.collapseAll",
        labelKey: "notebook.collapseAll",
        icon: ChevronRight,
        risk: "read-only",
        helpSlug: "viewing-notebooks",
        enabledWhen: (current) => current.ready,
        run: () => setEvery(false),
      },
      {
        id: "notebook.loadMore",
        labelKey: "notebook.loadMore",
        icon: FileText,
        risk: "read-only",
        helpSlug: "viewing-notebooks",
        enabledWhen: (current) => current.more,
        run: () => {
          if (view.page?.next_cursor) {
            void view.request({ cursor: view.page.next_cursor });
          }
        },
      },
      {
        id: "notebook.openAsText",
        labelKey: "viewer.openAsText",
        icon: FileText,
        risk: "read-only",
        helpSlug: "viewing-text",
        visibleWhen: (current) => current.canOpenAsText,
        enabledWhen: (current) => current.canOpenAsText,
        run: () => onOpenAsText?.(),
      },
    ],
    // `view.request` reads the current page from this closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEvery, onOpenAsText, view.page?.next_cursor],
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
            id: "outputs",
            labelKey: "extra_view.output",
            controls: [
              { type: "button", command: "notebook.expandAll", keyTip: "E" },
              { type: "button", command: "notebook.collapseAll", keyTip: "C" },
            ],
          },
          {
            id: "open",
            labelKey: "commands.open",
            controls: [{ type: "button", command: "notebook.openAsText", keyTip: "T" }],
          },
        ],
      },
    ],
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      <div className="adp-notebook">
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
        {cells.length > 0 ? (
          <div className="adp-notebook-cells" role="list">
            {cells.map((cell) => (
              <article key={cell.index} className="adp-notebook-cell" role="listitem">
                <header>
                  <span className="adp-notebook-index">[{cell.index + 1}]</span>
                  <span className="adp-notebook-kind">{t(`notebook.kind_${cell.kind}`)}</span>
                  {cell.language !== "" ? <span className="adp-notebook-language">{cell.language}</span> : null}
                </header>
                <pre className="adp-notebook-source" aria-label={t("extra_view.source")}>{cell.source}</pre>
                {cell.next_source_offset !== null ? (
                  <p className="adp-viewer-note" role="note">{t("notebook.sourceCut")}</p>
                ) : null}
                {cell.outputs.length === 0 ? null : (
                  <div className="adp-notebook-outputs">
                    <button
                      type="button"
                      className="adp-notebook-toggle"
                      aria-expanded={expanded.has(cell.index) || allExpanded}
                      onClick={() => toggle(cell.index)}
                    >
                      {expanded.has(cell.index) || allExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                      {t("extra_view.output")}
                    </button>
                    {expanded.has(cell.index) || allExpanded ? (
                      <div className="adp-notebook-output-list">
                        {cell.outputs.map((output, index) => (
                          <div key={index} className="adp-notebook-output">
                            {output.kind === "image" && output.image ? (
                              <img
                                src={fileUrl(output.image.token, output.image.name)}
                                alt={t("notebook.imageOutput", { index: index + 1 })}
                              />
                            ) : null}
                            {output.kind === "html" && output.html ? (
                              <SafeMarkupFrame
                                className="adp-notebook-html"
                                html={output.html}
                                resources={[]}
                                title={t("extra_view.output")}
                              />
                            ) : null}
                            {output.kind === "error" ? (
                              <p className="adp-notebook-error" role="alert">
                                {output.text ?? t("extra_view.unsupportedOutput")}
                              </p>
                            ) : null}
                            {output.kind === "text" && output.text ? (
                              <pre className="adp-notebook-text">{output.text}</pre>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </article>
            ))}
            {view.page?.next_cursor ? (
              <Button onClick={() => void view.request({ cursor: view.page?.next_cursor ?? null })}>
                {t("notebook.loadMore")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {partial ? <p className="adp-viewer-note" role="note">{t("extra_view.partial")}</p> : null}
        {previewOnly ? <p className="adp-viewer-note" role="note">{t("preview.readOnly")}</p> : null}
      </div>
    </ViewerFrame>
  );
}

/** Test helper: the page is data only, never a function or a kernel call. */
export function notebookPageIsInert(page: ExtraViewPage): boolean {
  return page.kind === "notebook";
}
