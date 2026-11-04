import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { MetadataCategory } from "../convert/types";
import {
  IMAGE_PRIVACY_CATEGORIES,
  PDF_PRIVACY_CATEGORIES,
  type PrivacyMode,
  type PrivacySettings as PrivacySettingsValue,
} from "../services/privacy";

export interface PrivacySettingsProps {
  settings: PrivacySettingsValue;
  onChange: (next: PrivacySettingsValue) => void;
}

function toggle(
  categories: MetadataCategory[],
  category: MetadataCategory,
  selected: boolean,
): MetadataCategory[] {
  return selected
    ? categories.includes(category)
      ? categories
      : [...categories, category]
    : categories.filter((value) => value !== category);
}

function categoryList(
  t: TFunction,
  categories: readonly MetadataCategory[],
  selected: readonly MetadataCategory[],
  disabled: boolean,
  onToggle: (category: MetadataCategory, value: boolean) => void,
) {
  return categories.map((category) => (
    <label className="adp-privacy-setting-category" key={category}>
      <input
        type="checkbox"
        checked={selected.includes(category)}
        disabled={disabled}
        onChange={(event) => onToggle(category, event.target.checked)}
      />
      <span>{t(`privacy.${category}`)}</span>
    </label>
  ));
}

/** Settings > Privacy. Every removal option starts off; nothing here ever
 * authorizes a background edit. */
export default function PrivacySettings({ settings, onChange }: PrivacySettingsProps) {
  const { t } = useTranslation();
  const modes: PrivacyMode[] = ["keep", "ask", "remove"];
  const update = (patch: Partial<PrivacySettingsValue>) => onChange({ ...settings, ...patch });
  const modeSelect = (
    key: "image_mode" | "pdf_mode",
    label: string,
    categoriesKey: "image_categories" | "pdf_categories",
    supported: readonly MetadataCategory[],
  ) => {
    const enabled = settings[key] !== "keep";
    return (
      <div className="adp-privacy-setting-group">
        <label className="adp-privacy-setting-mode">
          <span>{label}</span>
          <select
            value={settings[key]}
            onChange={(event) => update({ [key]: event.target.value } as Partial<PrivacySettingsValue>)}
          >
            {modes.map((mode) => (
              <option value={mode} key={mode}>
                {t(`privacy.${mode}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="adp-privacy-setting-categories">
          {categoryList(
            t,
            supported,
            settings[categoriesKey],
            !enabled,
            (category, selected) =>
              update({
                [categoriesKey]: toggle(settings[categoriesKey], category, selected),
              } as Partial<PrivacySettingsValue>),
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="adp-privacy-settings" aria-label={t("settings.privacy")}>
      <h2>{t("settings.privacy")}</h2>
      {modeSelect(
        "image_mode",
        t("privacy.imageSettings"),
        "image_categories",
        IMAGE_PRIVACY_CATEGORIES,
      )}
      {modeSelect(
        "pdf_mode",
        t("privacy.pdfSettings"),
        "pdf_categories",
        PDF_PRIVACY_CATEGORIES,
      )}
      <label className="adp-privacy-setting-check">
        <input
          type="checkbox"
          checked={settings.location_warning}
          onChange={(event) => update({ location_warning: event.target.checked })}
        />
        <span>{t("privacy.locationWarning")}</span>
      </label>
      <label className="adp-privacy-setting-check">
        <input
          type="checkbox"
          checked={settings.sharing_prompt}
          onChange={(event) => update({ sharing_prompt: event.target.checked })}
        />
        <span>{t("privacy.sharingPrompt")}</span>
      </label>
    </section>
  );
}
