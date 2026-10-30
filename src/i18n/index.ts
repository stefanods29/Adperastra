import i18n from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";
import pseudo from "./locales/pseudo.json";

export const supportedLanguages = ["en", "es", "pseudo"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

void i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      pseudo: { translation: pseudo },
    },
    lng: "en",
    fallbackLng: "en",
    supportedLngs: [...supportedLanguages],
    interpolation: {
      escapeValue: false,
    },
  });

/** The page's `lang` attribute: a valid BCP 47 tag, so screen readers and
 * accessibility checks accept it. The pseudo-locale is English text in
 * disguise and uses the standard pseudo-locale tag en-XA. */
export function htmlLang(lang: SupportedLanguage): string {
  return lang === "pseudo" ? "en-XA" : lang;
}

export function applyLanguage(lang: string): Promise<unknown> {
  const next = (supportedLanguages as readonly string[]).includes(lang) ? (lang as SupportedLanguage) : "en";
  if (typeof document !== "undefined") {
    document.documentElement.lang = htmlLang(next);
  }
  return i18n.changeLanguage(next);
}

export default i18n;