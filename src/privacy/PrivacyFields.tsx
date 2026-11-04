import { useTranslation } from "react-i18next";
import type { MetadataCategory } from "../convert/types";
import type { PrivacyField } from "../services/privacy";

export interface PrivacyFieldsProps {
  fields: readonly PrivacyField[];
  selectedCategories: readonly MetadataCategory[];
  onToggle: (category: MetadataCategory, selected: boolean) => void;
  disabled?: boolean;
}

/** Category checkboxes and bounded field previews. The preview is plain text
 * from React, never markup or a link; removed/retained state is never shown
 * by color alone. */
export default function PrivacyFields({
  fields,
  selectedCategories,
  onToggle,
  disabled,
}: PrivacyFieldsProps) {
  const { t } = useTranslation();
  const categories: MetadataCategory[] = [];
  for (const field of fields) {
    if (!categories.includes(field.category)) categories.push(field.category);
  }
  if (fields.length === 0) {
    return <p className="adp-privacy-none">{t("privacy.none")}</p>;
  }
  return (
    <div className="adp-privacy-fields">
      {categories.map((category) => {
        const matching = fields.filter((field) => field.category === category);
        const unknown = matching.some((field) => field.coverage === "unknown");
        const broad = category === "exif" || category === "xmp" || category === "iptc";
        const count = matching.reduce((total, field) => total + field.count, 0);
        return (
          <section className="adp-privacy-category" key={category}>
            <label className="adp-privacy-category-head">
              <input
                type="checkbox"
                checked={selectedCategories.includes(category)}
                disabled={disabled || (unknown && !broad)}
                onChange={(event) => onToggle(category, event.target.checked)}
                aria-label={t(`privacy.${category}`)}
              />
              <span>{t(`privacy.${category}`)}</span>
              <span className="adp-privacy-count" aria-hidden="true">
                {count}
              </span>
            </label>
            {unknown && !broad ? (
              <p className="adp-privacy-note">{t("privacy.unverified")}</p>
            ) : null}
            <ul className="adp-privacy-values" aria-label={t(`privacy.${category}`)}>
              {matching.slice(0, 8).map((field, index) => (
                <li key={`${field.field_id}.${index}`}>
                  <span className="adp-privacy-label">
                    {t(field.label_key, { defaultValue: t(`privacy.${field.category}`) })}
                  </span>
                  {field.preview ? (
                    <span className="adp-privacy-preview">{field.preview}</span>
                  ) : null}
                </li>
              ))}
              {matching.length > 8 ? (
                <li className="adp-privacy-more">+{matching.length - 8}</li>
              ) : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
