import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import type { DeckAiWarning } from "./deckAiTypes";

/** Warning list: icon plus translated label, never color alone. Overflow and
 * unsupported layout are not acknowledgeable. */

export interface DeckAiWarningsProps {
  warnings: readonly DeckAiWarning[];
}

export function deckAiWarningLabel(
  t: (key: string, args?: Record<string, unknown>) => string,
  warning: DeckAiWarning,
): string {
  switch (warning.kind) {
    case "density":
      return t("deckAi.density");
    case "overflow":
      return t("deckAi.overflow");
    case "unverified_fact":
      return t("deckAi.unverified");
    case "protected_fact":
      return t("deckAi.protected", { before: warning.argument, after: "" });
    case "image_unavailable":
      return t("deckAi.imageSuggestion");
    case "layout_unsupported":
      return t("deckAi.overflow");
  }
}

export function DeckAiWarnings({ warnings }: DeckAiWarningsProps) {
  const { t } = useTranslation();
  if (warnings.length === 0) return null;
  return (
    <ul className="deck-ai-warnings" aria-label={t("deckAi.unverified")}>
      {warnings.map((warning) => (
        <li key={warning.id} data-kind={warning.kind}>
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{deckAiWarningLabel(t, warning)}</span>
        </li>
      ))}
    </ul>
  );
}
