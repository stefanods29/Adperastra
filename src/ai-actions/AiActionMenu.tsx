import { useTranslation } from "react-i18next";
import type { AiActionId } from "../services/aiActionTypes";
import { aiActionMenuEntries, type AiActionContext } from "./registry";

/**
 * The AI actions submenu for the Explorer context menu and compatible file
 * tabs (D1). Missing or untested capabilities keep an action visible but
 * disabled, with App storage as the only next step. Nothing starts merely by
 * opening the menu, and Copy text stays available without any AI pack.
 */

export interface AiActionMenuProps {
  context: AiActionContext;
  onRun: (action: AiActionId) => void;
  /** Absent in a host that has no route to Settings > App storage. */
  onOpenStorage?: () => void;
  onOpenHelp: (slug: string) => void;
}

export function AiActionMenu({ context, onRun, onOpenStorage, onOpenHelp }: AiActionMenuProps) {
  const { t } = useTranslation();
  const entries = aiActionMenuEntries(context);
  const needsStorage = entries.some((entry) => entry.show_storage_link);
  const helpSlug = entries[0]?.spec.help_slug ?? "ai-actions-images";

  if (entries.length === 0) {
    return (
      <div className="adp-ai-actions-menu" role="group" aria-label={t("aiActions.title")}>
        <p role="status">{t("aiActions.noResult")}</p>
      </div>
    );
  }

  return (
    <div className="adp-ai-actions-menu" role="group" aria-label={t("aiActions.title")}>
      {entries.map((entry) => (
        <button
          key={entry.spec.id}
          type="button"
          className="adp-ai-actions-item"
          disabled={entry.disabled_reason !== null}
          aria-disabled={entry.disabled_reason !== null}
          title={entry.disabled_reason ? t("aiActions.needsPack") : undefined}
          onClick={() => {
            if (entry.disabled_reason === null) onRun(entry.spec.id);
          }}
        >
          <span>{t(entry.spec.label_key)}</span>
          {entry.disabled_reason ? (
            <span className="adp-ai-actions-reason">{t("aiActions.needsPack")}</span>
          ) : null}
        </button>
      ))}
      {needsStorage && onOpenStorage ? (
        <button type="button" className="adp-ai-actions-footer" onClick={onOpenStorage}>
          {t("ai.storage")}
        </button>
      ) : null}
      <button type="button" className="adp-ai-actions-footer" onClick={() => onOpenHelp(helpSlug)}>
        {t("help.title")}
      </button>
    </div>
  );
}
