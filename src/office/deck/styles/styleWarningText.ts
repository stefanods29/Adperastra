import type { TFunction } from "i18next";
import type { StyleWarning } from "./styleTypes";

/** One localized sentence per native warning; the panel never invents text. */
export function warningText(t: TFunction, warning: StyleWarning): string {
  switch (warning.kind) {
    case "font_missing":
      return t("deckStyle.missingFont");
    case "font_mapped":
      return t("deckStyle.fontMap", { from: warning.from_family, to: warning.to_asset_id });
    case "overflow":
      return t("deckStyle.overflow");
    case "manual_format_preserved":
      return t("deckStyle.manualKept");
    case "template_content_omitted":
      return t("deckStyle.omitted");
  }
}
