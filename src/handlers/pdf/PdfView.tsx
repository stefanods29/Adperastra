import { Copy, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Skeleton from "../../components/Skeleton";
import TextInput from "../../components/TextInput";
import type { Command } from "../../commands/registry";
import Ribbon from "../../ribbon/Ribbon";
import type { RibbonDef, RibbonGroup } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import { errorText } from "../../services/errors";
import { formatSize } from "../../services/format";
import {
  pdfSourceKey,
  searchPdf,
  type PdfSearchMatch,
} from "../../services/pdf";
import type { HandlerViewProps } from "../types";
import { useOcr } from "../../ocr/useOcr";
import PdfPages from "./PdfPages";
import PdfPrintDialog from "./PdfPrintDialog";
import PdfSidebar from "./PdfSidebar";
import { PdfSearchController, type PdfSearchSnapshot } from "./pdfSearch";
import {
  clampPage,
  clampSidebarWidth,
  createPdfCommands,
  fitZoom,
  PDF_SIDEBAR_WIDTH,
  parsedPageBox,
  stepRotation,
  type PdfActions,
  type PdfCommandContext,
} from "./pdfState";
import { usePdfDocument } from "./usePdfDocument";

const HELP = "viewing-pdfs";
const EMPTY_SEARCH: PdfSearchSnapshot = { query: "", matches: [], complete: true, scanning: false, current: -1, error: null };

/** The PDF viewer (Step 07d): a paged, searchable, printable read-only view.
 *
 * Pages and text come from the isolated PDF helper; this component never
 * sees PDF bytes or HTML. The ribbon is the app's normal ribbon, so the PDF
 * toolbar docks with every other toolbar. */
export default function PdfView({ info, active, savedState, onStateChange, onStatus, find, previewOnly = false, ocrLanguage = "auto" }: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const doc = usePdfDocument(info.path, active, savedState, onStateChange, previewOnly);
  const [sidebarWidth, setSidebarWidth] = useState(PDF_SIDEBAR_WIDTH);
  const [pageBox, setPageBox] = useState("");
  const [password, setPassword] = useState("");
  const [printOpen, setPrintOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [search, setSearch] = useState<PdfSearchSnapshot>(EMPTY_SEARCH);
  const [scrollTarget, setScrollTarget] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<PdfSearchController | null>(null);
  const lastMatch = useRef(-1);
  const goToPageRef = useRef(doc.goToPage);
  goToPageRef.current = doc.goToPage;

  const session = doc.phase.kind === "ready" ? doc.phase.session : null;
  const count = session?.page_count ?? 0;
  const page = session ? clampPage(doc.state.page, count) : 1;
  const sourceKey = session ? pdfSourceKey(session.source) : "";

  // Search (E4): one controller per tab, stopped when the tab goes away.
  useEffect(() => {
    const controller = new PdfSearchController(
      { search: (sessionId, query, matchCase, cursor) => searchPdf(sessionId, query, matchCase, cursor) },
      setSearch,
    );
    controllerRef.current = controller;
    return () => {
      controller.cancel();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    setFindOpen(find.text !== "");
    controllerRef.current?.start(session.session_id, sourceKey, find.text, find.options?.caseSensitive === true);
  }, [session, sourceKey, find.text, find.options?.caseSensitive]);

  useEffect(() => {
    if (find.request === 0) return;
    if (find.backwards) controllerRef.current?.previous();
    else controllerRef.current?.next();
  }, [find.request, find.backwards]);

  // Escape closes the find results before anything else sees the key.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !findOpen) return;
      event.preventDefault();
      event.stopPropagation();
      setFindOpen(false);
      controllerRef.current?.cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, findOpen]);

  const currentMatch: PdfSearchMatch | null = search.current >= 0 ? search.matches[search.current] ?? null : null;

  // Show the page of the match the user asked for.
  useEffect(() => {
    if (!currentMatch) return;
    if (lastMatch.current === search.current) return;
    lastMatch.current = search.current;
    goToPageRef.current(currentMatch.page);
  }, [currentMatch, search.current]);

  const infoOf = useCallback((number: number) => doc.pageInfos.get(number), [doc.pageInfos]);

  const boxSize = useCallback(() => {
    const box = canvasRef.current?.getBoundingClientRect();
    return { width: Math.max(0, (box?.width ?? 0) - 48), height: Math.max(0, (box?.height ?? 0) - 48) };
  }, []);

  const fitWidth = useCallback(() => {
    const size = boxSize();
    const number = doc.state.page;
    doc.update({
      fit: "width",
      zoom: fitZoom("width", infoOf(number) ?? { width_pt: 595, height_pt: 842 }, size.width, size.height, doc.state.zoom),
    });
  }, [boxSize, doc, infoOf]);

  const fitPage = useCallback(() => {
    const size = boxSize();
    doc.update({
      fit: "page",
      zoom: fitZoom("page", infoOf(doc.state.page) ?? { width_pt: 595, height_pt: 842 }, size.width, size.height, doc.state.zoom),
    });
  }, [boxSize, doc, infoOf]);

  const actions = useMemo<PdfActions>(
    () => ({
      previous: () => doc.goToPage(page - 1),
      next: () => doc.goToPage(page + 1),
      setZoom: (zoom) => doc.update({ zoom, fit: "none" }),
      fitWidth,
      fitPage,
      rotateLeft: () => doc.update({ rotation: stepRotation(doc.state.rotation, -1) }),
      rotateRight: () => doc.update({ rotation: stepRotation(doc.state.rotation, 1) }),
      toggleThumbnails: () => doc.update({ thumbnails_open: !doc.state.thumbnails_open }),
      toggleOutline: () => doc.update({ outline_open: !doc.state.outline_open }),
      print: () => {
        if (previewOnly || !session?.permissions.can_print) return;
        setPrintOpen(true);
      },
    }),
    [doc, fitPage, fitWidth, page, previewOnly, session],
  );

  const ocr = useOcr({
    input: session ? { kind: "pdf", session_id: session.session_id, page } : null,
    language: ocrLanguage,
    rotation: doc.state.rotation as 0 | 90 | 180 | 270,
    active,
    clipboardAllowed: session?.permissions.can_copy ?? false,
    previewOnly,
  });
  const commands = useMemo<Command<PdfCommandContext>[]>(
    () => [
      ...createPdfCommands(actions),
      {
        id: "pdf.copyAllText",
        labelKey: "ocr.copyAll",
        icon: Copy,
        risk: "read-only",
        helpSlug: "copying-text-from-images",
        enabledWhen: () => session !== null && (session.permissions.can_copy ?? false),
        run: () => {
          void ocr.copyAll();
        },
      },
      {
        id: "pdf.searchImageText",
        labelKey: "ocr.search",
        icon: Search,
        risk: "read-only",
        helpSlug: "copying-text-from-images",
        enabledWhen: () => session !== null,
        run: () => {
          void ocr.recognize();
        },
      },
    ],
    [actions, ocr, session],
  );
  const ctx: PdfCommandContext = {
    ready: session !== null,
    page,
    pageCount: count,
    zoom: doc.state.zoom,
    fit: doc.state.fit,
    rotation: doc.state.rotation,
    thumbnailsOpen: doc.state.thumbnails_open,
    outlineOpen: doc.state.outline_open,
    canPrint: session?.permissions.can_print === true,
    previewOnly,
    printing: printOpen,
  };

  const groups: RibbonGroup[] = [
    {
      id: "navigate",
      labelKey: "pdf.navigation",
      controls: [
        { type: "button", command: "pdf.previous", keyTip: "P" },
        { type: "button", command: "pdf.next", keyTip: "N" },
        {
          type: "custom",
          id: "pageBox",
          render: () => (
            <label className="adp-ribbon-custom adp-pdf-pagebox">
              {t("pdf.pageNumber")}
              <input
                className="adp-pdf-pageinput"
                type="number"
                min={1}
                max={Math.max(1, count)}
                value={pageBox === "" ? String(page) : pageBox}
                aria-label={t("pdf.pageNumber")}
                onChange={(event) => setPageBox(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  const target = parsedPageBox(event.currentTarget.value, count);
                  if (target !== null) {
                    doc.goToPage(target);
                    setScrollTarget(target);
                  }
                  setPageBox("");
                }}
                onBlur={() => setPageBox("")}
              />
            </label>
          ),
        },
        {
          type: "custom",
          id: "pageCount",
          render: () => <span className="adp-pdf-count">{t("pdf.page", { page, count })}</span>,
        },
      ],
    },
    {
      id: "zoom",
      labelKey: "ribbon.zoom",
      controls: [
        { type: "button", command: "pdf.zoomOut", showLabel: false },
        { type: "button", command: "pdf.zoomIn", showLabel: false },
        { type: "toggle", command: "pdf.fitWidth", showLabel: false },
        { type: "toggle", command: "pdf.fitPage", showLabel: false },
      ],
    },
    {
      id: "rotate",
      labelKey: "ribbon.rotate",
      controls: [
        { type: "button", command: "pdf.rotateLeft", showLabel: false },
        { type: "button", command: "pdf.rotateRight", showLabel: false },
      ],
    },
    {
      id: "panels",
      labelKey: "ribbon.show",
      controls: [
        { type: "toggle", command: "pdf.thumbnails", showLabel: false },
        { type: "toggle", command: "pdf.outline", showLabel: false },
      ],
    },
    {
      id: "text",
      labelKey: "ocr.title",
      controls: [
        { type: "button", command: "pdf.copyAllText", showLabel: false },
        { type: "button", command: "pdf.searchImageText", showLabel: false },
      ],
    },
  ];
  if (!previewOnly) {
    groups.push({
      id: "print",
      labelKey: "pdf.print",
      controls: [{ type: "button", command: "pdf.print", showLabel: false }],
    });
  }
  const ribbon: RibbonDef = { tabs: [{ id: "view", labelKey: "ribbon.view", keyTip: "V", groups }] };

  // Status bar: the page, the zoom and the size.
  useEffect(() => {
    onStatus({
      items: session ? [t("pdf.page", { page, count }), formatSize(info.size, i18n.language)] : [],
      zoom: session
        ? {
            percent: doc.state.zoom,
            min: 10,
            max: 400,
            set: (percent: number) => doc.update({ zoom: percent, fit: "none" }),
            fit: fitWidth,
          }
        : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, page, count, doc.state.zoom, info.size, i18n.language, onStatus, t]);

  const highlights = findOpen ? search.matches.filter((match) => match.page === page).slice(0, 128) : [];

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="pdf" active={active} />}>
      <div className="adp-pdf">
        {doc.phase.kind === "loading" ? (
          <div className="adp-pdf-message" role="status">
            <Skeleton variant="tiles" count={1} />
            <p>{t("pdf.loading")}</p>
          </div>
        ) : null}

        {doc.phase.kind === "password" ? (
          <form
            className="adp-pdf-password"
            onSubmit={(event) => {
              event.preventDefault();
              doc.unlock(password);
            }}
          >
            <p>{t("errors.pdf.password_required")}</p>
            <TextInput
              value={password}
              onChange={setPassword}
              ariaLabel={t("pdf.password")}
              type="password"
              autoComplete="off"
              maxLength={1024}
            />
            {doc.phase.failed ? (
              <p className="adp-pdf-error" role="alert">
                {t("errors.pdf.bad_password")}
              </p>
            ) : null}
            <Button variant="primary" type="submit">
              {t("pdf.unlock")}
            </Button>
          </form>
        ) : null}

        {doc.phase.kind === "error" ? (
          <div className="adp-pdf-message" role="alert">
            <p>{errorText(t, doc.phase.code, "pdf")}</p>
            <Button onClick={doc.retry}>{t("fileTab.reload")}</Button>
          </div>
        ) : null}

        {doc.phase.kind === "ready" ? (
          <div className="adp-pdf-body">
            <PdfSidebar
              session={doc.phase.session}
              sourceKey={sourceKey}
              page={page}
              thumbnailsOpen={doc.state.thumbnails_open}
              outlineOpen={doc.state.outline_open}
              width={clampSidebarWidth(sidebarWidth)}
              active={active}
              images={doc.images}
              requestPage={doc.requestPage}
              onWidthChange={setSidebarWidth}
              onSelectPage={(number) => {
                doc.goToPage(number);
                setScrollTarget(number);
              }}
            />
            <div className="adp-pdf-canvas" ref={canvasRef}>
              <PdfPages
                session={doc.phase.session}
                page={page}
                zoom={doc.state.zoom}
                rotation={doc.state.rotation}
                pageInfos={doc.pageInfos}
                images={doc.images}
                texts={doc.texts}
                highlights={highlights}
                active={active}
                requestPage={doc.requestPage}
                requestText={doc.requestText}
                onVisiblePage={(number) => doc.goToPage(number)}
                scrollTo={scrollTarget}
                onScrolled={() => setScrollTarget(null)}
              />
              {findOpen ? (
                <div className="adp-pdf-find" role="status" aria-live="polite">
                  {search.scanning ? t("pdf.searching") : null}
                  {!search.scanning && search.matches.length === 0 ? t("pdf.noMatches") : null}
                  {!search.scanning && search.matches.length > 0 ? t("pdf.matchCount", { current: search.current + 1, total: search.matches.length }) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {printOpen && session ? (
          <PdfPrintDialog session={session} page={page} onClose={() => setPrintOpen(false)} />
        ) : null}
      </div>
    </ViewerFrame>
  );
}
