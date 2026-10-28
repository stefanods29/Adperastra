import { useTranslation } from "react-i18next";

export interface SkeletonProps {
  variant?: "rows" | "tiles";
  count?: number;
}

export default function Skeleton({ variant = "rows", count = 3 }: SkeletonProps) {
  const { t } = useTranslation();
  const items = Array.from({ length: count }, (_, index) => index);
  if (variant === "tiles") {
    return (
      <div className="adp-skeleton-tiles" role="status" aria-label={t("components.loading")}>
        {items.map((item) => (
          <div key={item} className="adp-skeleton-tile" />
        ))}
      </div>
    );
  }
  return (
    <div className="adp-skeleton-rows" role="status" aria-label={t("components.loading")}>
      {items.map((item) => (
        <div key={item} className="adp-skeleton-row" />
      ))}
    </div>
  );
}
