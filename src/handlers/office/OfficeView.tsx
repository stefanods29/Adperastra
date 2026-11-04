import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JobHandle } from "../../services/jobs";
import { useTranslation } from "react-i18next";

import type { ConversionInput } from "../../convert/types";
import type { VirtualViewProps } from "../../documents/types";
import { releaseCacheLease } from "../../services/cache";
import { errorCode, errorText } from "../../services/errors";
import { formatSize } from "../../services/format";
import {
  closeOfficeView,
  officeViewCells,
  officeViewComments,
  officeViewPage,
  officeViewSections,
  openOfficeView,
} from "../../services/officeView";
import {
  OFFICE_MAX_CELL_COLUMNS,
  OFFICE_MAX_CELL_ROWS,
  OFFICE_MAX_CELL_START,
  OFFICE_MAX_SHEET_COLUMNS,
  OFFICE_MAX_ZOOM,
  OFFICE_MIN_ZOOM,
  normalizeOfficeViewState,
  validSectionId,
  type OfficeCellPage,
  type OfficeCommentPage,
  type OfficePage,
  type OfficeSection,
  type OfficeSession,
  type OfficeViewState,
} from "../../services/officeViewTypes";
import type { FileTabStatus, HandlerViewProps } from "../types";
import OfficePresenter from "./OfficePresenter";
export interface OfficeDiskViewProps extends HandlerViewProps {
  onOpenHelp?: (slug: string) => void;
  previewOnly?: boolean;
}
const HELP_SLUG = "viewing-office";
const EMPTY_STATUS: FileTabStatus = { items: [] };
const OFFICE_CELL_INITIAL_ROWS = 40;
const OFFICE_CELL_INITIAL_COLUMNS = 16;
const OFFICE_CELL_PAGE_CACHE = 6;

function cellPageKey(page: OfficeCellPage): string {
  return `${page.row_start}:${page.column_start}:${page.column_count}`;
}

function sortedCellPages(pages: Map<string, OfficeCellPage>): OfficeCellPage[] {
  return [...pages.values()].sort(
    (left, right) =>
      left.row_start - right.row_start ||
      left.column_start - right.column_start ||
      left.column_count - right.column_count,
  );
}

/** A disk Office view; it never registers Save or a mutation command. */
export default function OfficeView(props: OfficeDiskViewProps) {
  const input = useMemo<ConversionInput>(() => ({ kind: "file", path: props.info.path }), [props.info.path]);
  return (
    <OfficeDocumentView
      input={input}
      active={props.active}
      savedState={props.savedState}
      onStateChange={props.onStateChange}
      onStatus={props.onStatus}
      onOpenHelp={props.onOpenHelp}
      onOpenChosenApp={props.onOpenInWindowsApp}
      protectedView={props.protectedView}
      previewOnly={props.previewOnly ?? false}
      fileSize={props.info.size}
    />
  );
}

/** Source-aware Office view. Only ordinary disk documents use a disk path. */
export function VirtualOfficeView({
  document,
  active,
  savedState,
  onStateChange,
  onStatus,
  onOpenHelp,
  previewOnly,
  onOpenInWindowsApp,
}: VirtualViewProps) {
  const { t, i18n } = useTranslation();
  const diskPath = document.source.kind === "disk" && !document.info.sensitive
    ? document.source.path
    : null;
  const diskInput = useMemo<ConversionInput | null>(
    () => diskPath ? { kind: "file", path: diskPath } : null,
    [diskPath],
  );
  const [snapshotInput, setSnapshotInput] = useState<ConversionInput | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  useEffect(() => {
    if (diskInput) return;
    let cancelled = false;
    setSnapshotInput(null);
    setCaptureError(null);
    void document
      .captureSnapshot()
      .then((snapshot) => {
        if (cancelled) return;
        setSnapshotInput({
          kind: "snapshot",
          snapshot_id: snapshot.snapshot_id,
          document_id: snapshot.document_id,
          revision: snapshot.revision,
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) setCaptureError(errorCode(error) || "office.unsupported");
      });
    return () => {
      cancelled = true;
    };
  }, [diskInput, document]);

  const input = diskInput ?? snapshotInput;
  if (!input) {
    return (
      <div className="adp-office-preview" role="status">
        {captureError ? <p className="adp-office-error">{errorText(t, captureError, "office")}</p> : <p>{t("preview.loading")}</p>}
      </div>
    );
  }
  return (
    <OfficeDocumentView
      input={input}
      active={active}
      savedState={savedState}
      onStateChange={(state) => onStateChange(state as unknown as import("../../documents/types").SerializableViewState)}
      onStatus={onStatus}
      onOpenHelp={onOpenHelp}
      onOpenChosenApp={onOpenInWindowsApp ?? (() => undefined)}
      protectedView={document.info.from_internet}
      previewOnly={previewOnly}
      fileSize={document.info.size}
    />
  );
}

interface OfficeDocumentViewProps {
  input: ConversionInput;
  active: boolean;
  savedState: unknown;
  onStateChange: (state: unknown) => void;
  onStatus: (status: FileTabStatus) => void;
  onOpenHelp?: (slug: string) => void;
  onOpenChosenApp: () => void;
  protectedView: boolean;
  previewOnly: boolean;
  fileSize: number;
}

function OfficeDocumentView({
  input,
  active,
  savedState,
  onStateChange,
  onStatus,
  onOpenHelp,
  onOpenChosenApp,
  protectedView,
  previewOnly,
  fileSize,
}: OfficeDocumentViewProps) {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState<OfficeSession | null>(null);
  const [sections, setSections] = useState<OfficeSection[]>([]);
  const [selectedSection, setSelectedSection] = useState("document");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(() => normalizeOfficeViewState(savedState).zoom);
  const [pageImage, setPageImage] = useState<OfficePage | null>(null);
  const [cellPages, setCellPages] = useState<OfficeCellPage[]>([]);
  const [comments, setComments] = useState<OfficeCommentPage | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cellsLoading, setCellsLoading] = useState(false);
  const [error, setError] = useState<{ code: string; text: string } | null>(null);
  const [reload, setReload] = useState(0);
  const pageRef = useRef<OfficePage | null>(null);
  const cellsGenerationRef = useRef(0);
  const cellsSectionRef = useRef<string | null>(null);
  const cellPagesRef = useRef<Map<string, OfficeCellPage>>(new Map());
  const cellsPendingKeysRef = useRef<Set<string>>(new Set());
  const cellsPendingRef = useRef(0);
  const lastStateRef = useRef("");
  pageRef.current = pageImage;
  const saved = useMemo(() => normalizeOfficeViewState(savedState), [savedState]);

  useEffect(() => {
    let cancelled = false;
    let closeSession: string | null = null;
    let job: JobHandle<OfficeSession> | null = null;
    setLoading(true);
    setError(null);
    setSession(null);
    setSections([]);
    cellsGenerationRef.current += 1;
    cellsSectionRef.current = null;
    cellPagesRef.current.clear();
    cellsPendingKeysRef.current.clear();
    cellsPendingRef.current = 0;
    setCellPages([]);
    setCellsLoading(false);
    setPageImage(null);
    void (async () => {
      try {
        job = await openOfficeView(input);
        const opened = await job.completion;
        if (cancelled) {
          await closeOfficeView(opened.session_id);
          return;
        }
        closeSession = opened.session_id;
        const all: OfficeSection[] = [];
        let cursor: string | undefined;
        for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
          const sectionPage = await officeViewSections(opened.session_id, cursor);
          all.push(...sectionPage.items);
          if (sectionPage.complete || !sectionPage.next_cursor || all.length >= opened.section_count) break;
          cursor = sectionPage.next_cursor;
        }
        if (cancelled) return;
        setSession(opened);
        setSections(all);
        const startSection = all.find((section) => section.id === saved.section_id) ?? all[0] ?? null;
        const start = startSection?.id ?? "document";
        setSelectedSection(start);
        setPage(Math.min(Math.max(1, saved.page), Math.max(1, startSection?.page_count ?? 1)));
      } catch (caught) {
        if (!cancelled) {
          setError({ code: errorCode(caught), text: errorText(t, caught, "office") });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (job) void job.cancel().catch(() => undefined);
      if (closeSession) void closeOfficeView(closeSession);
    };
  }, [input, reload, t]);

  useEffect(() => () => {
    if (pageRef.current) void releaseCacheLease(pageRef.current.image.lease_id).catch(() => undefined);
    cellsGenerationRef.current += 1;
  }, []);

  const section = sections.find((entry) => entry.id === selectedSection) ?? sections[0] ?? null;
  const continuous = !previewOnly && section?.kind === "document";

  useEffect(() => {
    if (!session || !section || !active || continuous) return;
    let cancelled = false;
    if (pageRef.current && pageRef.current.image.lease_id) {
      void releaseCacheLease(pageRef.current.image.lease_id).catch(() => undefined);
    }
    setPageImage(null);
    setError(null);
    if (section.kind === "sheet" && cellsSectionRef.current === section.id && cellPagesRef.current.size > 0) {
      return () => {
        cancelled = true;
      };
    }
    cellsGenerationRef.current += 1;
    const cellsGeneration = cellsGenerationRef.current;
    cellsSectionRef.current = section.kind === "sheet" ? section.id : null;
    cellPagesRef.current.clear();
    cellsPendingKeysRef.current.clear();
    cellsPendingRef.current = 0;
    setCellPages([]);
    if (section.kind === "sheet") {
      setCellsLoading(true);
      void officeViewCells(
        session.session_id,
        section.id,
        0,
        Math.min(OFFICE_MAX_CELL_ROWS, OFFICE_CELL_INITIAL_ROWS),
        0,
        OFFICE_CELL_INITIAL_COLUMNS,
      )
        .then((next) => {
          if (cancelled || cellsGenerationRef.current !== cellsGeneration) return;
          if (next.rows.length > 0) {
            cellPagesRef.current.set(cellPageKey(next), next);
            setCellPages(sortedCellPages(cellPagesRef.current));
          }
        })
        .catch((caught: unknown) => {
          if (!cancelled && cellsGenerationRef.current === cellsGeneration) {
            setError({ code: errorCode(caught), text: errorText(t, caught, "office") });
          }
        })
        .finally(() => {
          if (!cancelled && cellsGenerationRef.current === cellsGeneration) setCellsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    setCellsLoading(false);
    setLoading(true);
    let job: JobHandle<OfficePage> | null = null;
    void (async () => {
      try {
        const handle = await officeViewPage(session.session_id, section.id, page, saved.zoom / 100);
        job = handle;
        if (cancelled) {
          await handle.cancel().catch(() => undefined);
          await handle.completion.catch(() => undefined);
          return;
        }
        const image = await handle.completion;
        if (cancelled) {
          // A page that arrives after the user moved on still owns a cache
          // lease; release it instead of leaving the token behind.
          await releaseCacheLease(image.image.lease_id).catch(() => undefined);
          return;
        }
        setPageImage(image);
      } catch (caught) {
        if (!cancelled) {
          setError({ code: errorCode(caught), text: errorText(t, caught, "office") });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (job) void job.cancel().catch(() => undefined);
    };
  }, [active, continuous, page, saved.zoom, section, session, t]);

  useEffect(() => {
    if (!session || !selectedSection) return;
    const state: OfficeViewState = normalizeOfficeViewState({
      section_id: selectedSection,
      page,
      zoom,
      scroll_top: saved.scroll_top,
      mode: session.quality === "quick" ? "quick" : "pages",
    });
    const serialized = JSON.stringify(state);
    if (lastStateRef.current === serialized) return;
    lastStateRef.current = serialized;
    onStateChange(state);
  }, [onStateChange, page, saved.scroll_top, selectedSection, session, zoom]);

  useEffect(() => {
    if (!session || !section) {
      onStatus(EMPTY_STATUS);
      return;
    }
    onStatus({
      items: [
        t("office.readOnly"),
        formatSize(fileSize, i18n.language),
        t("office.pageOf", { page, count: Math.max(1, section.page_count) }),
      ],
    });
  }, [fileSize, onStatus, page, section, session, t]);

  useEffect(() => {
    if (!session || !commentsOpen || !section) return;
    let cancelled = false;
    void officeViewComments(session.session_id, section.id, undefined)
      .then((next) => {
        if (!cancelled) setComments(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError({ code: errorCode(caught), text: errorText(t, caught, "office") });
      });
    return () => {
      cancelled = true;
    };
  }, [commentsOpen, section, session, t]);

  const selectSection = useCallback((id: string) => {
    if (!validSectionId(id)) return;
    setSelectedSection(id);
    setPage(1);
  }, []);

  const requestRows = useCallback(
    (rowStart: number, rowCount: number, columnStart: number, columnCount: number) => {
      if (!session || !section || section.kind !== "sheet") return;
      const start = Math.max(0, Math.floor(rowStart));
      const count = Math.min(OFFICE_MAX_CELL_ROWS, Math.max(1, Math.floor(rowCount)));
      const colStart = Math.max(0, Math.floor(columnStart));
      const colCount = Math.min(OFFICE_MAX_CELL_COLUMNS, Math.max(1, Math.floor(columnCount)));
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(count) ||
        !Number.isSafeInteger(colStart) ||
        !Number.isSafeInteger(colCount) ||
        start > OFFICE_MAX_CELL_START ||
        colStart > OFFICE_MAX_SHEET_COLUMNS
      ) {
        return;
      }
      const requestKey = `${start}:${count}:${colStart}:${colCount}`;
      if (cellsPendingKeysRef.current.has(requestKey)) return;
      const generation = cellsGenerationRef.current;
      cellsPendingKeysRef.current.add(requestKey);
      cellsPendingRef.current += 1;
      setCellsLoading(true);
      void officeViewCells(session.session_id, section.id, start, count, colStart, colCount)
        .then((next) => {
          if (generation !== cellsGenerationRef.current) return;
          if (next.rows.length === 0) return;
          const cache = cellPagesRef.current;
          cache.set(cellPageKey(next), next);
          if (cache.size > OFFICE_CELL_PAGE_CACHE) {
            const keep = [...cache.values()]
              .sort(
                (left, right) =>
                  Math.abs(left.row_start - start) - Math.abs(right.row_start - start) ||
                  Math.abs(left.column_start - colStart) - Math.abs(right.column_start - colStart),
              )
              .slice(0, OFFICE_CELL_PAGE_CACHE)
              .map(cellPageKey);
            for (const key of [...cache.keys()]) {
              if (!keep.includes(key)) cache.delete(key);
            }
          }
          setCellPages(sortedCellPages(cache));
        })
        .catch((caught: unknown) => {
          if (generation === cellsGenerationRef.current) {
            setError({ code: errorCode(caught), text: errorText(t, caught, "office") });
          }
        })
        .finally(() => {
          if (generation !== cellsGenerationRef.current) return;
          cellsPendingKeysRef.current.delete(requestKey);
          cellsPendingRef.current = Math.max(0, cellsPendingRef.current - 1);
          if (cellsPendingRef.current === 0) setCellsLoading(false);
        });
    },
    [section, session, t],
  );

  // The read-only preview owns no Office editing controller and no native deck
  // slide UUIDs, so it cannot start a presentation: `office_presentation_start`
  // is main-window, editing-session and registered-engine based. The live
  // audience window is opened only by the native presentation worker behind the
  // deck editor's display chooser (`DeckPresentDialog`), never from here.
  if (!session && loading) {
    return <div className="adp-office-preview"><div className="adp-office-loading">{t("preview.loading")}</div></div>;
  }
  if (!session) {
    return (
      <div className="adp-office-preview">
        <div className="adp-office-error" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <p>{error?.text ?? t("errors.office.failed")}</p>
          <button type="button" className="adp-btn" onClick={onOpenChosenApp}>
            {t("office.openChosen")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={continuous ? "adp-office-host adp-office-host--continuous" : "adp-office-host"}>
      <OfficePresenter
        session={session}
        sections={sections}
        selectedSection={selectedSection}
        page={page}
        pageImage={pageImage}
        cells={cellPages}
        comments={comments}
        commentsOpen={commentsOpen}
        commentsAvailable={session.capabilities.comments}
        loading={loading}
        cellsLoading={cellsLoading}
        errorCode={error?.code ?? null}
        errorText={error?.text ?? null}
        protectedView={protectedView}
        previewOnly={previewOnly}
        continuousDocument={continuous ? {
          active,
          zoom,
          onZoom: (next) => setZoom(Math.min(OFFICE_MAX_ZOOM, Math.max(OFFICE_MIN_ZOOM, next))),
        } : undefined}
        onSelectSection={selectSection}
        onPage={setPage}
        onToggleComments={() => setCommentsOpen((open) => !open)}
        onOpenChosenApp={onOpenChosenApp}
        onOpenHelp={(slug) => onOpenHelp?.(slug || HELP_SLUG)}
        onRequestRows={requestRows}
        onRetry={() => setReload((value) => value + 1)}
      />
    </div>
  );
}
