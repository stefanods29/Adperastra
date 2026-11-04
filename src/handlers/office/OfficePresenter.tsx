import { FileSpreadsheet, FileText, MessageSquare, Minus, Plus, Presentation } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import HelpButton from "../../components/HelpButton";
import Skeleton from "../../components/Skeleton";
import { fileUrl } from "../../services/files";
import { OFFICE_MAX_ZOOM, OFFICE_MIN_ZOOM } from "../../services/officeViewTypes";
import type {
  OfficeCellPage,
  OfficeCommentPage,
  OfficeFormat,
  OfficePage,
  OfficeSection,
  OfficeSession,
} from "../../services/officeViewTypes";
import OfficeComments from "./OfficeComments";
import OfficeDocumentPages from "./OfficeDocumentPages";
import OfficeGrid from "./OfficeGrid";
import OfficeNavigation from "./OfficeNavigation";

export interface OfficePresenterProps {
  session: OfficeSession;
  sections: readonly OfficeSection[];
  selectedSection: string;
  page: number;
  pageImage: OfficePage | null;
  cells: OfficeCellPage | OfficeCellPage[] | null;
  comments: OfficeCommentPage | null;
  commentsOpen: boolean;
  commentsAvailable: boolean;
  loading: boolean;
  cellsLoading?: boolean;
  errorCode?: string | null;
  errorText?: string | null;
  protectedView?: boolean;
  previewOnly?: boolean;
  continuousDocument?: { active: boolean; zoom: number; onZoom: (zoom: number) => void };
  onSelectSection: (sectionId: string) => void;
  onPage: (page: number) => void;
  onToggleComments: () => void;
  onOpenChosenApp: () => void;
  onOpenHelp: (slug: string) => void;
  onRequestRows?: (
    rowStart: number,
    rowCount: number,
    columnStart: number,
    columnCount: number,
  ) => void;
  onRetry?: () => void;
}

function cellPageList(cells: OfficeCellPage | OfficeCellPage[] | null): readonly OfficeCellPage[] {
  if (!cells) return [];
  return Array.isArray(cells) ? cells : [cells];
}

function familyKey(format: OfficeFormat): string {
  if (format === "xlsx" || format === "ods" || format === "xls") return "office.sheet";
  if (format === "pptx" || format === "odp" || format === "ppt") return "office.slide";
  return "office.word";
}

function familyIcon(format: OfficeFormat) {
  if (format === "xlsx" || format === "ods" || format === "xls") return FileSpreadsheet;
  if (format === "pptx" || format === "odp" || format === "ppt") return Presentation;
  return FileText;
}

/** Shared presentation surface for the disk and virtual Office adapters.
 *
 * This component has no mutation command, save callback or editable DOM.
 * Document content is either escaped cell text or a token-backed image; no
 * markup from the file is inserted into the app DOM. */
export default function OfficePresenter({
  session,
  sections,
  selectedSection,
  page,
  pageImage,
  cells,
  comments,
  commentsOpen,
  commentsAvailable,
  loading,
  cellsLoading = false,
  errorCode = null,
  errorText = null,
  protectedView = false,
  previewOnly = false,
  continuousDocument,
  onSelectSection,
  onPage,
  onToggleComments,
  onOpenChosenApp,
  onOpenHelp,
  onRequestRows,
  onRetry,
}: OfficePresenterProps) {
  const { t } = useTranslation();
  const surfaceRef = useRef<HTMLElement>(null);
  const section = sections.find((candidate) => candidate.id === selectedSection) ?? sections[0] ?? null;
  const pageCount = section?.page_count ?? 1;
  const Icon = familyIcon(session.format);
  const packMissing = errorCode === "office.pack_missing";
  const pageStatus = t("office.pageOf", { page, count: pageCount });

  return (
    <div className="adp-office-preview" data-quality={session.quality} data-readonly="true">
      <header className="adp-office-header">
        <Icon size={16} aria-hidden="true" className="adp-office-family-icon" />
        <h1 className="adp-office-title">{t(familyKey(session.format))}</h1>
        <span className="adp-office-badge">{t(session.quality === "accurate" ? "office.accurate" : "office.quick")}</span>
        <span className="adp-office-badge adp-office-badge--readonly">{t("office.readOnly")}</span>
        {protectedView ? <span className="adp-office-badge">{t("settings.protectedView")}</span> : null}
        <span className="adp-office-header-spacer" />
        {continuousDocument ? (
          <div className="adp-office-zoom" role="group" aria-label={t("viewer.zoom")}>
            <Button variant="subtle" aria-label={t("viewer.zoomOut")}
              disabled={continuousDocument.zoom <= OFFICE_MIN_ZOOM}
              onClick={() => continuousDocument.onZoom(continuousDocument.zoom - 25)}><Minus size={16} /></Button>
            <Button variant="subtle" aria-label={t("viewer.zoomReset")}
              onClick={() => continuousDocument.onZoom(100)}>
              {new Intl.NumberFormat(undefined, { style: "percent" }).format(continuousDocument.zoom / 100)}
            </Button>
            <Button variant="subtle" aria-label={t("viewer.zoomIn")}
              disabled={continuousDocument.zoom >= OFFICE_MAX_ZOOM}
              onClick={() => continuousDocument.onZoom(continuousDocument.zoom + 25)}><Plus size={16} /></Button>
          </div>
        ) : null}
        {!previewOnly ? (
          <Button variant="subtle" onClick={onOpenChosenApp}>
            {t("office.openChosen")}
          </Button>
        ) : null}
        <HelpButton onOpenHelp={() => onOpenHelp("viewing-office")} />
      </header>
      {session.quality === "quick" && !packMissing ? (
        <p className="adp-office-layout-note">{t("office.quickLayout")}</p>
      ) : null}
      <div className={commentsOpen && commentsAvailable ? "adp-office-preview-grid adp-office-preview-grid--comments" : "adp-office-preview-grid"}>
        <OfficeNavigation
          documentLabel={t(familyKey(session.format))}
          sections={sections}
          selectedSection={selectedSection}
          onSelectSection={onSelectSection}
          commentsOpen={commentsOpen}
          commentsAvailable={commentsAvailable}
          onToggleComments={onToggleComments}
          pageStatus={pageStatus}
        />
        <main
          ref={surfaceRef}
          id="office-document-surface"
          className="adp-office-surface"
          role="tabpanel"
          aria-labelledby={`office-section-${selectedSection.replace(":", "-")}`}
          tabIndex={0}
          aria-keyshortcuts={continuousDocument ? "ArrowLeft ArrowRight PageUp PageDown" : undefined}
        >
          {packMissing ? (
            <div className="adp-office-missing" role="status">
              <p>{t("office.noPreview")}</p>
              <Button onClick={onOpenChosenApp}>{t("office.openChosen")}</Button>
            </div>
          ) : loading ? (
            <>
              <p className="sr-only">
                {session.quality === "accurate" ? t("office.loading") : t("preview.loading")}
              </p>
              <Skeleton variant="rows" count={8} />
            </>
          ) : errorText ? (
            <div className="adp-office-error" role="alert">
              <p>{errorText}</p>
              {onRetry ? <Button onClick={onRetry}>{t("office.retry")}</Button> : null}
            </div>
          ) : section?.kind === "sheet" ? (
            <OfficeGrid
              pages={cellPageList(cells)}
              loading={cellsLoading}
              errorText={null}
              onRequestRows={onRequestRows ?? (() => undefined)}
              onOpenChosenApp={onOpenChosenApp}
            />
          ) : continuousDocument ? (
            continuousDocument.active && section ? <OfficeDocumentPages
              key={`${session.session_id}:${section.id}`}
              sessionId={session.session_id} sectionId={section.id} scale={1} zoom={continuousDocument.zoom}
              scrollRef={surfaceRef} pageCount={pageCount} page={page} onPage={onPage}
            /> : null
          ) : pageImage ? (
            <figure className="adp-office-page">
              <img
                src={fileUrl(pageImage.image.token, pageImage.image.name)}
                alt={t("office.pageOf", { page: pageImage.page, count: pageCount })}
                width={pageImage.image.width}
                height={pageImage.image.height}
              />
              <figcaption className="adp-office-page-caption">
                {t("office.pageOf", { page: pageImage.page, count: pageCount })}
              </figcaption>
            </figure>
          ) : (
            <p className="adp-office-empty">{t("office.loading")}</p>
          )}
          {!previewOnly && !continuousDocument && section && pageCount > 1 ? (
            <div className="adp-office-page-controls">
              <Button variant="subtle" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}>
                {t("pdf.previous")}
              </Button>
              <Button variant="subtle" onClick={() => onPage(Math.min(pageCount, page + 1))} disabled={page >= pageCount}>
                {t("pdf.next")}
              </Button>
            </div>
          ) : null}
        </main>
        {commentsOpen && commentsAvailable ? (
          <OfficeComments page={comments} />
        ) : null}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {pageStatus}
      </p>
      {commentsOpen ? (
        <span className="sr-only" aria-hidden="true">
          <MessageSquare size={0} />
        </span>
      ) : null}
    </div>
  );
}
