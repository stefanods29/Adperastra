import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import type { OfficeSection } from "../../services/officeViewTypes";

export interface OfficeNavigationProps {
  sections: readonly OfficeSection[];
  selectedSection: string;
  onSelectSection: (sectionId: string) => void;
  commentsOpen: boolean;
  commentsAvailable: boolean;
  onToggleComments: () => void;
  pageStatus?: string;
  documentLabel?: string;
}

/** Stable source sections and comments controls. The buttons use the source
 * section ID (never a translated label) as their identity. Presentation is
 * owned by the native deck editor (`DeckPresentDialog`), not this read-only
 * preview navigation. */
export default function OfficeNavigation({
  sections,
  selectedSection,
  onSelectSection,
  commentsOpen,
  commentsAvailable,
  onToggleComments,
  pageStatus = "",
  documentLabel,
}: OfficeNavigationProps) {
  const { t } = useTranslation();
  return (
    <aside className="adp-office-navigation" aria-label={t("office.navigation")}>
      <div className="adp-office-navigation-heading" id="office-sections-heading">
        {t("office.sections")}
      </div>
      <div
        className="adp-office-section-list"
        role="tablist"
        aria-labelledby="office-sections-heading"
        aria-orientation="vertical"
      >
        {sections.map((section) => {
          const active = section.id === selectedSection;
          const label =
            section.name.trim() ||
            (section.kind === "document" && documentLabel) ||
            t(section.kind === "sheet" ? "office.sheets" : section.kind === "slide" ? "office.slides" : "office.word");
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              id={`office-section-${section.id.replace(":", "-")}`}
              aria-selected={active}
              aria-controls="office-document-surface"
              tabIndex={active ? 0 : -1}
              className={active ? "adp-office-section adp-office-section--active" : "adp-office-section"}
              data-section-id={section.id}
              onClick={() => onSelectSection(section.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectSection(section.id);
                }
              }}
            >
              <span className="adp-office-section-name">{label}</span>
              {section.kind === "sheet" ? (
                <span className="adp-office-section-meta">
                  {t("office.pageOf", { page: 1, count: section.page_count })}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="adp-office-navigation-actions">
        <Button
          variant="subtle"
          onClick={onToggleComments}
          aria-pressed={commentsOpen}
          disabled={!commentsAvailable}
        >
          <MessageSquare size={16} aria-hidden="true" />
          {t("office.comments")}
        </Button>
      </div>
      <p className="adp-office-page-status" role="status" aria-live="polite">
        {pageStatus}
      </p>
    </aside>
  );
}
