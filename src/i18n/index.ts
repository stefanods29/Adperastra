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

export function applyLanguage(lang: string): Promise<unknown> {
  const next = (supportedLanguages as readonly string[]).includes(lang) ? lang : "en";
  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
  }
  return i18n.changeLanguage(next);
}

export default i18n;