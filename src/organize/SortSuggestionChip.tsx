import { FolderInput, HelpCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AiSortSuggestion } from "../services/aiSearchTypes";

export interface SortSuggestionChipProps {
  suggestion: AiSortSuggestion;
  /** Additive display label; the suggestion itself carries only the ID. */
  destinationLabel?: string;
  onMove: () => Promise<void>;
  onNotNow: () => void;
  onNever: () => Promise<void>;
  onOpenHelp: (slug: string) => void;
}

/**
 * Inline, non-modal destination suggestion. No effect on mount, no timer and
 * no focus call: completing a watched folder never moves anything.
 */
export default function SortSuggestionChip({
  suggestion,
  destinationLabel,
  onMove,
  onNotNow,
  onNever,
  onOpenHelp,
}: SortSuggestionChipProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<"move" | "never" | null>(null);
  const [error, setError] = useState("");

  const move = async () => {
    if (busy) return;
    setBusy("move");
    setError("");
    try {
      await onMove();
    } catch {
      setError(t("errors.ai_search.changed"));
    } finally {
      setBusy(null);
    }
  };

  const never = async () => {
    if (busy) return;
    setBusy("never");
    try {
      await onNever();
    } catch {
      setError(t("errors.ai_search.failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ai-sort-chip" role="group" aria-label={t("aiSearch.sort")}>
      <span className="ai-sort-chip__text">
        <FolderInput size={16} aria-hidden="true" />
        {t("aiSearch.suggested", {
          folder: destinationLabel ?? suggestion.destination_id,
        })}
      </span>
      <button
        type="button"
        className="adp-btn adp-btn--primary"
        disabled={busy !== null}
        onClick={() => void move()}
      >
        {t("aiSearch.move")}
      </button>
      <button type="button" className="adp-btn" disabled={busy !== null} onClick={onNotNow}>
        {t("aiSearch.notNow")}
      </button>
      <button type="button" className="adp-btn" disabled={busy !== null} onClick={() => void never()}>
        {t("aiSearch.never")}
      </button>
      <button
        type="button"
        className="adp-icon-btn"
        aria-label={t("search.help")}
        title={t("search.help")}
        onClick={() => onOpenHelp("sort-suggestions")}
      >
        <HelpCircle size={16} aria-hidden="true" />
      </button>
      {error ? (
        <p className="ai-sort-chip__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
