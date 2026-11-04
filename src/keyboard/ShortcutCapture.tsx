import { useState } from "react";
import { useTranslation } from "react-i18next";
import { strokeFromKeyboardEvent } from "./shortcutNormalization";
import type { ShortcutStroke, StrokeMode } from "./types";

export interface ShortcutCaptureProps {
  mode: StrokeMode;
  onCapture: (stroke: ShortcutStroke) => void;
  onCancel: () => void;
}

/** Keys that only change modifier state; they never form a shortcut. */
const MODIFIER_ONLY_KEYS = new Set([
  "Control",
  "Shift",
  "Alt",
  "AltGraph",
  "Meta",
  "OS",
  "CapsLock",
  "NumLock",
  "ScrollLock",
]);

/** Press-a-shortcut capture (Step 10b D5). Shows both the character and
 * the physical code so non-US layouts stay understandable. Escape cancels;
 * composition, dead keys and AltGraph produce nothing. */
export default function ShortcutCapture({ mode, onCapture, onCancel }: ShortcutCaptureProps) {
  const { t } = useTranslation();
  const [seen, setSeen] = useState<string>("");

  return (
    <button
      type="button"
      className="adp-shortcut-capture"
      aria-label={t("keyboard.capture")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
          return;
        }
        if (MODIFIER_ONLY_KEYS.has(event.key) || event.repeat) return;
        const stroke = strokeFromKeyboardEvent(event.nativeEvent, mode);
        if (!stroke) return;
        event.preventDefault();
        setSeen(`${event.key} / ${event.code}`);
        onCapture(stroke);
      }}
    >
      <span>{t("keyboard.capture")}</span>
      {seen ? <span className="adp-shortcut-capture-seen">{seen}</span> : null}
    </button>
  );
}
