/** The current display context for every UI formatter (Step 10c T3).
 *
 * One hook resolves the locale, keeps the injected `now` fresh at minute
 * boundaries while the window is visible, and returns the three display
 * helpers. Components never build their own date or size strings.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  displayFileName,
  formatDateWithOptions,
  formatSizeWithOptions,
  isValidFormatLocale,
  resolveFormatLocale,
  type DisplayFileName,
  type FormatOptions,
} from "./displayFormats";

export interface DisplayFormats {
  /** The resolved locale (never "system"). */
  locale: string;
  /** The injected Unix time used by relative dates. */
  nowUnix: number;
  size: (bytes: number) => string;
  date: (unixSeconds: number) => string;
  fileName: (name: string, extension: string) => DisplayFileName;
}

function currentUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function useDisplayFormats(format: FormatOptions, showExtensions: boolean): DisplayFormats {
  const { i18n } = useTranslation();
  const [nowUnix, setNowUnix] = useState(currentUnix);
  const locale = isValidFormatLocale(format.locale)
    ? resolveFormatLocale(format.locale, i18n.language ?? "en")
    : resolveFormatLocale("system", i18n.language ?? "en");

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    let timer: number | null = null;

    const clear = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      clear();
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      const toNextMinute = 60_000 - (now % 60_000);
      timer = window.setTimeout(() => {
        setNowUnix(currentUnix());
        schedule();
      }, toNextMinute + 20);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        clear();
      } else {
        setNowUnix(currentUnix());
        schedule();
      }
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return useMemo(
    () => ({
      locale,
      nowUnix,
      size: (bytes: number) => formatSizeWithOptions(bytes, locale, format),
      date: (unixSeconds: number) => formatDateWithOptions(unixSeconds, locale, format, nowUnix),
      fileName: (name: string, extension: string) =>
        displayFileName(name, extension, showExtensions, format),
    }),
    [format, locale, nowUnix, showExtensions],
  );
}
