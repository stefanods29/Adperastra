/** Settings > Date and size formats (Step 10c T3).
 *
 * These options only change how values are shown. File names, sort keys and
 * stored data are never rewritten.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import { handlers } from "../../handlers";
import type { AppSettings } from "../../services/settings";
import { isValidCustomDatePattern } from "../../services/customDatePattern";
import {
  FORMAT_DATE_STYLES,
  FORMAT_NAME_TRUNCATIONS,
  FORMAT_SIZE_BASES,
  FORMAT_TIME_CYCLES,
  FORMAT_WEEK_STARTS,
  formatDateWithOptions,
  formatSizeWithOptions,
  isValidFormatLocale,
  isValidLocaleTag,
  type FormatDateStyle,
  type FormatNameTruncation,
  type FormatSizeBase,
  type FormatTimeCycle,
  type FormatWeekStart,
} from "../../services/displayFormats";

export interface DateSizeSettingsProps {
  settings: AppSettings;
  onApply: (settings: AppSettings) => void;
  onOpenHelp: (slug: string) => void;
}

const DATE_KEYS: Record<FormatDateStyle, string> = {
  relative: "formats.valueRelative",
  short: "formats.valueShort",
  long: "formats.valueLong",
  custom: "formats.valueCustom",
};

const TIME_KEYS: Record<FormatTimeCycle, string> = {
  system: "formats.valueSystem",
  h12: "formats.valueH12",
  h23: "formats.valueH23",
};

const WEEK_KEYS: Record<FormatWeekStart, string> = {
  system: "formats.valueSystem",
  monday: "formats.valueMonday",
  sunday: "formats.valueSunday",
};

const SIZE_KEYS: Record<FormatSizeBase, string> = {
  legacy: "formats.valueLegacy",
  decimal: "formats.valueDecimal",
  binary: "formats.valueBinary",
};

const TRUNCATE_KEYS: Record<FormatNameTruncation, string> = {
  middle: "formats.valueMiddle",
  end: "formats.valueEnd",
};

const LOCALE_SUGGESTIONS = ["system", "en", "en-US", "es", "es-419"] as const;

/** Every extension a built-in handler knows, lower case without the dot. */
export function knownExtensions(): string[] {
  const seen = new Set<string>();
  for (const handler of handlers.list()) {
    for (const extension of handler.extensions) {
      const key = extension.replace(/^\./, "").toLowerCase();
      if (key !== "") seen.add(key);
      if (seen.size >= 256) return [...seen].sort();
    }
  }
  return [...seen].sort();
}

export default function DateSizeSettings({ settings, onApply, onOpenHelp }: DateSizeSettingsProps) {
  const { t } = useTranslation();
  const options = settings.format_options;
  const update = (patch: Partial<AppSettings["format_options"]>) =>
    onApply({ ...settings, format_options: { ...options, ...patch } });
  const extensions = useMemo(() => knownExtensions(), []);
  const customDateValid =
    options.date_style !== "custom" || isValidCustomDatePattern(options.custom_date);
  const localeValid = isValidFormatLocale(options.locale);
  const previewLocale =
    options.locale !== "system" && isValidLocaleTag(options.locale) ? options.locale : "en";
  const sampleUnix = 1_800_000_000;
  const sampleBytes = 1536;

  const setOverride = (extension: string, value: string) => {
    const next = { ...options.extension_overrides };
    if (value === "inherit") delete next[extension];
    else next[extension] = value === "show";
    update({ extension_overrides: next });
  };

  return (
    <section className="adp-settings-section adp-preferences-section" aria-labelledby="adp-formats-title">
      <div className="adp-view-header">
        <h3 id="adp-formats-title" className="adp-heading">
          {t("formats.title")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("date-and-size-formats")} />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-format-locale">
          {t("formats.locale")}
        </label>
        <input
          id="adp-format-locale"
          className="adp-input"
          list="adp-format-locale-list"
          aria-invalid={!localeValid}
          value={options.locale}
          onChange={(event) => update({ locale: event.target.value })}
        />
        <datalist id="adp-format-locale-list">
          {LOCALE_SUGGESTIONS.map((locale) => (
            <option key={locale} value={locale} />
          ))}
        </datalist>
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-format-date">
          {t("formats.dates")}
        </label>
        <select
          id="adp-format-date"
          className="adp-defaultapps-select"
          value={options.date_style}
          onChange={(event) => update({ date_style: event.target.value as FormatDateStyle })}
        >
          {FORMAT_DATE_STYLES.map((style) => (
            <option key={style} value={style}>
              {t(DATE_KEYS[style])}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-format-custom">
          {t("formats.custom")}
        </label>
        <input
          id="adp-format-custom"
          className="adp-input"
          dir="ltr"
          aria-invalid={!customDateValid}
          disabled={options.date_style !== "custom"}
          value={options.custom_date}
          onChange={(event) => update({ custom_date: event.target.value })}
        />
      </div>
      {!customDateValid ? (
        <p className="adp-note adp-note--error" role="alert">
          {t("errors.preferences.invalid_format")}
        </p>
      ) : null}
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-format-time">
          {t("formats.time")}
        </label>
        <select
          id="adp-format-time"
          className="adp-defaultapps-select"
          value={options.time_cycle}
          onChange={(event) => update({ time_cycle: event.target.value as FormatTimeCycle })}
        >
          {FORMAT_TIME_CYCLES.map((cycle) => (
            <option key={cycle} value={cycle}>
              {t(TIME_KEYS[cycle])}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-format-week">
          {t("formats.week")}
        </label>
        <select
          id="adp-format-week"
          className="adp-defaultapps-select"
          value={options.week_start}
          onChange={(event) => update({ week_start: event.target.value as FormatWeekStart })}
        >
          {FORMAT_WEEK_STARTS.map((start) => (
            <option key={start} value={start}>
              {t(WEEK_KEYS[start])}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-format-size">
          {t("formats.sizes")}
        </label>
        <select
          id="adp-format-size"
          className="adp-defaultapps-select"
          value={options.size_base}
          onChange={(event) => update({ size_base: event.target.value as FormatSizeBase })}
        >
          {FORMAT_SIZE_BASES.map((base) => (
            <option key={base} value={base}>
              {t(SIZE_KEYS[base])}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-format-decimals">
          {t("formats.decimals")}
        </label>
        <select
          id="adp-format-decimals"
          className="adp-defaultapps-select"
          value={options.decimals}
          onChange={(event) => update({ decimals: Number(event.target.value) })}
        >
          {[0, 1, 2, 3, 4].map((decimals) => (
            <option key={decimals} value={decimals}>
              {decimals}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-format-truncate">
          {t("formats.truncate")}
        </label>
        <select
          id="adp-format-truncate"
          className="adp-defaultapps-select"
          value={options.name_truncation}
          onChange={(event) => update({ name_truncation: event.target.value as FormatNameTruncation })}
        >
          {FORMAT_NAME_TRUNCATIONS.map((truncation) => (
            <option key={truncation} value={truncation}>
              {t(TRUNCATE_KEYS[truncation])}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("formats.preview")}</span>
        <span className="adp-note">
          {formatSizeWithOptions(sampleBytes, previewLocale, options)}
          {" · "}
          {options.date_style === "custom" && !customDateValid
            ? t("errors.preferences.invalid_format")
            : formatDateWithOptions(sampleUnix, previewLocale, options, sampleUnix)}
        </span>
      </div>
      <div className="adp-setting-row adp-setting-row--column">
        <span className="adp-setting-label">{t("formats.extensions")}</span>
        <p className="adp-note">{t("formats.extensionsNote")}</p>
        <div className="adp-format-extensions">
          {extensions.map((extension) => {
            const value = Object.prototype.hasOwnProperty.call(options.extension_overrides, extension)
              ? options.extension_overrides[extension]
                ? "show"
                : "hide"
              : "inherit";
            return (
              <label className="adp-format-extension" key={extension}>
                <span className="adp-format-extension-name">.{extension}</span>
                <select
                  className="adp-defaultapps-select"
                  aria-label={t("formats.extensionChoice", { extension })}
                  value={value}
                  onChange={(event) => setOverride(extension, event.target.value)}
                >
                  <option value="inherit">{t("formats.extensionsUseGlobal")}</option>
                  <option value="show">{t("formats.extensionsShow")}</option>
                  <option value="hide">{t("formats.extensionsHide")}</option>
                </select>
              </label>
            );
          })}
        </div>
      </div>
    </section>
  );
}
