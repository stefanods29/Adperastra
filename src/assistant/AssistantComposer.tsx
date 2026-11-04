import { Send, Square } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface AssistantComposerProps {
  value: string;
  busy: boolean;
  disabled?: boolean;
  onChange(value: string): void;
  onSend(): void;
  onStop(): void;
}

/**
 * Labelled composer. Enter sends, Shift+Enter adds a newline, and an IME
 * composition never sends. The Send button becomes Stop for the one active
 * turn.
 */
export function AssistantComposer({ value, busy, disabled, onChange, onSend, onStop }: AssistantComposerProps) {
  const { t } = useTranslation();
  const composing = useRef(false);
  const [focused, setFocused] = useState(false);

  return (
    <div className={`adp-assistant-composer${focused ? " is-focused" : ""}`}>
      <label className="adp-assistant-label" htmlFor="adp-assistant-input">
        {t("assistant.composer")}
      </label>
      <textarea
        id="adp-assistant-input"
        className="adp-assistant-input"
        aria-label={t("assistant.composer")}
        value={value}
        rows={2}
        maxLength={32_768}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && busy) {
            event.preventDefault();
            onStop();
            return;
          }
          if (event.key !== "Enter" || event.shiftKey || composing.current) return;
          event.preventDefault();
          if (!busy && value.trim()) onSend();
        }}
      />
      <div className="adp-assistant-composer-actions">
        <button
          type="button"
          className="adp-button adp-button--primary"
          aria-label={busy ? t("assistant.stop") : t("assistant.send")}
          onClick={busy ? onStop : onSend}
          disabled={!busy && (disabled || value.trim().length === 0)}
        >
          {busy ? <Square size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
          <span>{busy ? t("assistant.stop") : t("assistant.send")}</span>
        </button>
      </div>
    </div>
  );
}
