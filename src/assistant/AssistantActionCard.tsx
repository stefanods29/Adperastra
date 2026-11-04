import { useTranslation } from "react-i18next";
import type { AssistantDraft } from "./types";

export interface AssistantActionCardProps {
  draft: AssistantDraft;
  onApply(): void;
  onCancel(): void;
  busy?: boolean;
  /** 0 before the first recycle confirmation, 1 before the second. */
  recycleStage?: 0 | 1;
}

/**
 * Explicit review card. Rows are plain text (no HTML), the full source and
 * destination names are available without visual elision, and Apply only
 * fires from its own button.
 */
export function AssistantActionCard({
  draft,
  onApply,
  onCancel,
  busy,
  recycleStage = 0,
}: AssistantActionCardProps) {
  const { t } = useTranslation();
  const recycleCount =
    draft.operation.tool_id === "recycle_items"
      ? draft.operation.input_ids.length
      : draft.preview_rows.length;
  return (
    <section className="adp-assistant-action" aria-label={t("assistant.preview")}>
      <h3 className="adp-assistant-action-title">{t("assistant.preview")}</h3>
      {draft.risk === "recycle" ? (
        <p className="adp-assistant-notice" role="note">
          {recycleStage === 0
            ? t("assistant.recycleFirst")
            : t("assistant.recycleSecond", { count: recycleCount })}
        </p>
      ) : null}
      <div className="adp-assistant-action-rows" role="list">
        {draft.preview_rows.slice(0, 100).map((row, index) => (
          <div className="adp-assistant-action-row" role="listitem" key={`${row.operation_key}-${index}`}>
            <div className="adp-assistant-action-label">
              <span>{row.source_label ?? "—"}</span>
              {row.destination_label ? <span aria-hidden="true"> → </span> : null}
              <span>{row.destination_label ?? ""}</span>
            </div>
            {row.before_excerpt ? (
              <pre className="adp-assistant-excerpt">{row.before_excerpt}</pre>
            ) : null}
            {row.after_excerpt ? (
              <pre className="adp-assistant-excerpt">{row.after_excerpt}</pre>
            ) : null}
          </div>
        ))}
      </div>
      {draft.warnings.length > 0 ? (
        <ul className="adp-assistant-warnings">
          {draft.warnings.slice(0, 64).map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <div className="adp-assistant-action-buttons">
        <button
          type="button"
          className="adp-button adp-button--primary"
          onClick={onApply}
          disabled={busy}
        >
          {t("assistant.apply")}
        </button>
        <button type="button" className="adp-button" onClick={onCancel} disabled={busy}>
          {t("assistant.cancel")}
        </button>
      </div>
    </section>
  );
}
