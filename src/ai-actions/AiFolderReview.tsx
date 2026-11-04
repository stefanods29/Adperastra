import { useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../components/HelpButton";
import { buildFolderPlan, canGenerate, needsContentScope, type FolderReviewItem, type FolderReviewPlan } from "./folderActions";

/**
 * Folder review before generation (D11).
 *
 * The exact file names and full accessible paths are shown first. Subfolders
 * and file contents are separate, default-off choices; Generate becomes
 * enabled only after the displayed list is explicitly accepted.
 */

export interface AiFolderReviewProps {
  items: readonly FolderReviewItem[];
  onGenerate: (plan: FolderReviewPlan) => void;
  onOpenHelp: (slug: string) => void;
}

export function AiFolderReview({ items, onGenerate, onOpenHelp }: AiFolderReviewProps) {
  const { t } = useTranslation();
  const [recursive, setRecursive] = useState(false);
  const [includeContents, setIncludeContents] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const plan = buildFolderPlan(items, { recursive, includeContents });

  return (
    <section className="adp-ai-folder-review" aria-label={t("aiActions.summarize_folder")}>
      <header className="adp-ai-folder-header">
        <h2>{t("aiActions.summarize_folder")}</h2>
        <HelpButton onOpenHelp={() => onOpenHelp("ai-actions-multiple")} />
      </header>

      <ul className="adp-ai-folder-list">
        {items.map((item) => (
          <li key={item.input_id} className={item.denied ? "is-denied" : undefined}>
            <span className="adp-ai-folder-name">{item.label}</span>
            {item.denied ? <span role="status">{t("errors.ai_actions.no_sources")}</span> : null}
          </li>
        ))}
      </ul>

      <div className="adp-ai-folder-options">
        <label>
          <input type="checkbox" checked={recursive} onChange={(event) => setRecursive(event.target.checked)} />
          <span>{t("aiActions.subfolders")}</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={includeContents}
            onChange={(event) => setIncludeContents(event.target.checked)}
          />
          <span>{t("aiActions.includeContents")}</span>
        </label>
        <label>
          <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
          <span>{t("aiActions.selectedFiles", { count: plan.included.length })}</span>
        </label>
      </div>

      {needsContentScope(plan) ? <p role="status">{t("assistant.sendContent")}</p> : <p role="status">{t("aiActions.namesOnly")}</p>}
      {plan.partial ? <p role="status">{t("aiActions.partial")}</p> : null}

      <footer className="adp-ai-folder-footer">
        <button type="button" disabled={!canGenerate(plan, accepted)} onClick={() => onGenerate(plan)}>
          {t("aiActions.summarize")}
        </button>
        <span role="status">{t("aiActions.selectedFiles", { count: plan.included.length })}</span>
      </footer>
    </section>
  );
}
