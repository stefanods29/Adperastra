import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fileUrl } from "../../services/files";
import type { OfficePage } from "../../services/officeViewTypes";

export interface OfficePresentationSlide {
  section_id: string;
  title?: string;
  text?: string;
  image?: OfficePage | null;
  /** Presenter-only data. It is deliberately not copied into the audience
   * model below, so notes/comments can never be rendered on the audience
   * screen. */
  notes?: string;
  comments?: readonly string[];
}

export interface OfficeAudienceSlide {
  section_id: string;
  title: string;
  text: string;
  image: OfficePage | null;
}

/** Copy only the fields the audience may see. Notes and comments are removed
 * here rather than hidden with CSS after reaching the audience window. */
export function audienceSlides(slides: readonly OfficePresentationSlide[]): OfficeAudienceSlide[] {
  return slides.map((slide) => ({
    section_id: slide.section_id,
    title: slide.title ?? "",
    text: slide.text ?? "",
    image: slide.image ?? null,
  }));
}

export interface OfficePresentationProps {
  slides: readonly OfficePresentationSlide[];
  initialIndex?: number;
  onClose: () => void;
  onIndexChange?: (index: number) => void;
  /** The presenter supplies these; the audience window never gets notes. */
  onPrevious?: () => void;
  onNext?: () => void;
}

/** Full-screen audience surface for already-rendered slides. It receives
 * rendered slides only; the presenter's notes/comments never arrive here (see
 * `audienceSlides`).
 *
 * The live audience window is owned by the native presentation worker
 * (Step 22a: `office_presentation_start` and `presentation-helper.html`). This
 * component is deliberately not a window opener: the old Step 13
 * `office-presentation.html` entry does not exist, and no document URL or
 * window label may come from this module. */
export default function OfficePresentation({
  slides,
  initialIndex = 0,
  onClose,
  onIndexChange,
  onPrevious,
  onNext,
}: OfficePresentationProps) {
  const { t } = useTranslation();
  const audience = audienceSlides(slides);
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), Math.max(0, audience.length - 1)),
  );
  const slide = audience[index] ?? null;

  useEffect(() => {
    setIndex(Math.min(Math.max(0, initialIndex), Math.max(0, audience.length - 1)));
  }, [audience.length, initialIndex]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        if (index > 0) {
          setIndex(index - 1);
          onIndexChange?.(index - 1);
        }
        onPrevious?.();
      } else if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        if (index < audience.length - 1) {
          setIndex(index + 1);
          onIndexChange?.(index + 1);
        }
        onNext?.();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [audience.length, index, onClose, onIndexChange, onNext, onPrevious]);

  return (
    <div className="adp-office-audience" role="dialog" aria-modal="true" aria-label={t("office.present")}>
      {slide ? (
        <section className="adp-office-audience-slide" data-section-id={slide.section_id}>
          {slide.image ? (
            <img
              className="adp-office-audience-image"
              src={fileUrl(slide.image.image.token, slide.image.image.name)}
              alt={slide.title || t("office.present")}
              width={slide.image.image.width}
              height={slide.image.image.height}
            />
          ) : (
            <div className="adp-office-audience-text">
              {slide.title ? <h1>{slide.title}</h1> : null}
              {slide.text ? <p>{slide.text}</p> : null}
            </div>
          )}
        </section>
      ) : (
        <p className="adp-office-empty">{t("office.noPreview")}</p>
      )}
      <p className="adp-office-audience-status" role="status" aria-live="polite">
        {t("office.pageOf", { page: index + 1, count: Math.max(1, audience.length) })}
      </p>
    </div>
  );
}
