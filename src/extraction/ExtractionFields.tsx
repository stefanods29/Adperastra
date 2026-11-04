import { AlertTriangle, Check, MinusCircle, OctagonAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ExtractionValue, ExtractionValueStatus } from "../services/aiExtractionTypes";

/** One editable extracted field (Step 17d T4).
 *
 * Status is never color alone: uncertain, missing, inconsistent and corrected
 * each show an icon and translated text, and the group is described by that
 * text for a screen reader. Editing writes a typed correction; it never
 * touches the source.
 */

const STATUS_KEYS: Record<Exclude<ExtractionValueStatus, "certain">, string> = {
  uncertain: "aiExtract.uncertain",
  corrected: "aiExtract.corrected",
  missing: "aiExtract.missing",
  inconsistent: "aiExtract.inconsistent",
};

const STATUS_ICONS = {
  uncertain: AlertTriangle,
  corrected: Check,
  missing: MinusCircle,
  inconsistent: OctagonAlert,
} as const;

export interface ExtractionFieldProps {
  labelKey: string;
  value: ExtractionValue;
  /** The field is the selected one (its anchor is shown). */
  selected?: boolean;
  onFocusValue?: (value: ExtractionValue) => void;
  onCommit?: (expected: string, next: string) => void;
}

export default function ExtractionField({
  labelKey,
  value,
  selected = false,
  onFocusValue,
  onCommit,
}: ExtractionFieldProps) {
  const { t } = useTranslation();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value.value);

  useEffect(() => {
    if (!editing) setDraft(value.value);
  }, [editing, value.value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const status = value.status;
  const label = t(labelKey);
  const statusKey = status === "certain" ? null : STATUS_KEYS[status];
  const Icon = status === "certain" ? null : STATUS_ICONS[status];

  const startEditing = () => {
    setDraft(value.value);
    setEditing(true);
    onFocusValue?.(value);
  };

  const commit = () => {
    setEditing(false);
    if (draft !== value.value) onCommit?.(value.value, draft);
  };

  return (
    <div
      className={`adp-extraction-field${selected ? " adp-extraction-field--selected" : ""}`}
      data-field={labelKey}
      data-status={status}
      role="group"
      aria-label={statusKey ? `${label}: ${t(statusKey)}` : label}
      aria-describedby={statusKey ? statusId : undefined}
      tabIndex={0}
      onFocus={() => onFocusValue?.(value)}
      onClick={() => onFocusValue?.(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !editing) {
          event.preventDefault();
          startEditing();
        } else if (event.key === "Escape" && editing) {
          event.stopPropagation();
          setEditing(false);
          setDraft(value.value);
        }
      }}
    >
      <span className="adp-extraction-field-label">{label}</span>
      {editing ? (
        <input
          ref={inputRef}
          className="adp-input adp-extraction-field-input"
          aria-label={label}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setEditing(false);
              setDraft(value.value);
            }
          }}
        />
      ) : (
        <span className="adp-extraction-field-value" onClick={startEditing}>
          {value.value === "" ? "\u2014" : value.value}
        </span>
      )}
      {statusKey && Icon ? (
        <>
          <span className="adp-extraction-field-status" data-status-icon={status}>
            <Icon size={14} aria-hidden="true" />
            <span>{t(statusKey)}</span>
          </span>
          <span id={statusId} className="adp-visually-hidden">
            {t(statusKey)}
          </span>
        </>
      ) : null}
    </div>
  );
}

/** The receipt fields of one record, in the order a person checks them. */
export const RECEIPT_FIELD_KEYS = [
  ["vendor", "aiExtract.vendor"],
  ["date", "aiExtract.date"],
  ["tax_id", "aiExtract.taxId"],
  ["currency", "aiExtract.currency"],
  ["subtotal", "aiExtract.subtotal"],
  ["tax", "aiExtract.tax"],
  ["total", "aiExtract.total"],
] as const;
