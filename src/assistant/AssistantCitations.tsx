import { useTranslation } from "react-i18next";
import type { AiCitation } from "../services/localAiTypes";

export interface AssistantCitationsProps {
  citations: readonly AiCitation[];
  onSeek(citation: AiCitation): void;
}

function citationLabel(t: (key: string, args?: Record<string, unknown>) => string, citation: AiCitation): string {
  const location = citation.location;
  if (location.kind === "page") return t("assistant.page", { page: location.page });
  if (location.kind === "time") {
    const total = Math.floor(location.start_us / 1_000_000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return t("assistant.time", { time: `${minutes}:${String(seconds).padStart(2, "0")}` });
  }
  return t("assistant.source");
}

/** Citation buttons activate the existing viewer; no external URL opens. */
export function AssistantCitations({ citations, onSeek }: AssistantCitationsProps) {
  const { t } = useTranslation();
  if (citations.length === 0) return null;
  return (
    <div className="adp-assistant-citations" role="group" aria-label={t("assistant.source")}>
      {citations.slice(0, 256).map((citation, index) => (
        <button
          key={`${citation.input_id}-${citation.revision}-${index}`}
          type="button"
          className="adp-assistant-citation"
          onClick={() => onSeek(citation)}
          title={citation.quote}
        >
          {citationLabel(t, citation)}
        </button>
      ))}
    </div>
  );
}
