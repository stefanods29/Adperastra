import { useTranslation } from "react-i18next";
import type { AssistantMessage } from "./types";
import { assistantErrorKey } from "./types";
import { AssistantCitations } from "./AssistantCitations";
import type { AiCitation } from "../services/localAiTypes";

export interface AssistantMessagesProps {
  messages: readonly AssistantMessage[];
  streaming: boolean;
  onSeek(citation: AiCitation): void;
}

/**
 * Role log. While tokens stream the live region stays off; the panel's
 * AnnouncementQueue (10f) speaks only finished sentences. At most 40 message
 * nodes are mounted for a 200-message chat.
 */
export function AssistantMessages({ messages, streaming, onSeek }: AssistantMessagesProps) {
  const { t } = useTranslation();
  const visible = messages.slice(-40);
  return (
    <div
      className="adp-assistant-messages"
      role="log"
      aria-live={streaming ? "off" : "polite"}
      aria-label={t("assistant.title")}
    >
      {visible.length === 0 ? (
        <p className="adp-assistant-empty">{t("assistant.thinking")}</p>
      ) : (
        visible.map((message) => (
          <article
            key={message.id}
            className={`adp-assistant-message adp-assistant-message--${message.role}`}
            aria-label={message.role === "user" ? t("assistant.send") : t("assistant.title")}
          >
            <p className="adp-assistant-text">{message.plain_text}</p>
            <AssistantCitations citations={message.citations} onSeek={onSeek} />
            {message.status === "failed" && message.error_code ? (
              <p className="adp-assistant-error" role="alert">
                {t(assistantErrorKey(message.error_code))}
              </p>
            ) : null}
          </article>
        ))
      )}
    </div>
  );
}
