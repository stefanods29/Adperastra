import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

export interface BreadcrumbSegment {
  id: string;
  label: string;
}

export interface BreadcrumbProps {
  segments: BreadcrumbSegment[];
  onNavigate: (id: string) => void;
}

export default function Breadcrumb({ segments, onNavigate }: BreadcrumbProps) {
  const { t } = useTranslation();
  return (
    <nav className="adp-breadcrumb" aria-label={t("components.breadcrumb")}>
      {segments.map((segment, index) => (
        <Fragment key={segment.id}>
          {index > 0 ? <ChevronRight size={12} aria-hidden="true" /> : null}
          <button
            type="button"
            className="adp-breadcrumb-item"
            aria-current={index === segments.length - 1 ? "page" : undefined}
            onClick={() => onNavigate(segment.id)}
          >
            {segment.label}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
