import { ListChecks, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "../components/Skeleton";
import type { JobHandle } from "../services/jobs";
import { errorText } from "../services/errors";
import type { RenamePlanPage, RenameReport } from "../services/bulkRename";
import { executeRename, releaseRenamePlan } from "../services/bulkRename";
import type { AiNameSuggestion, AiNamingPattern } from "../services/aiSearchTypes";
import {
  normalizeProposedStem,
  previewSuggestedNames,
  resolveNameSources,
  splitName,
  type ResolvedNameSource,
} from "./aiNameAdapter";

export interface AiNameReviewProps {
  suggestions: readonly AiNameSuggestion[];
  pattern: AiNamingPattern;
  onClose: () => void;
  onCompleted: (report: RenameReport) => void;
  onOpenHelp: (slug: string) => void;
  /** The host keeps this false until native receipt replay exists. */
  executeAvailable?: boolean;
}

/** Bulk-rename extension: old/proposed/editable stem/reason, no auto-run. */
export default function AiNameReview({
  suggestions,
  pattern,
  onClose,
  onCompleted,
  onOpenHelp,
  executeAvailable = true,
}: AiNameReviewProps) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<ResolvedNameSource[] | null>(null);
  const [stems, setStems] = useState<string[]>(() => suggestions.map((item) => item.proposed_stem));
  const [included, setIncluded] = useState<boolean[]>(() => suggestions.map(() => true));
  const [plan, setPlan] = useState<RenamePlanPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const previewJob = useRef<JobHandle<RenamePlanPage> | null>(null);
  const slowTimer = useRef<number | null>(null);

  useEffect(() => {
    try {
      setSources(resolveNameSources(suggestions));
    } catch {
      setError(t("errors.ai_search.changed"));
      setSources([]);
    }
    return () => {
      previewJob.current?.cancel();
      if (slowTimer.current !== null) window.clearTimeout(slowTimer.current);
    };
  }, [suggestions, t]);

  const planRows = useMemo(() => {
    const map = new Map<number, RenamePlanPage["rows"][number]>();
    plan?.rows.forEach((row) => map.set(row.input_index, row));
    return map;
  }, [plan]);

  const startWait = () => {
    setBusy(true);
    setSlow(false);
    slowTimer.current = window.setTimeout(() => setSlow(true), 1000);
  };
  const endWait = () => {
    setBusy(false);
    setSlow(false);
    if (slowTimer.current !== null) window.clearTimeout(slowTimer.current);
    slowTimer.current = null;
  };

  const preview = async () => {
    if (!sources) return;
    const nextRevision = revision + 1;
    setRevision(nextRevision);
    startWait();
    setError("");
    try {
      // An unchecked row is passed as an empty stem so the canonical builder
      // excludes it; accepted rows keep their original extension.
      const effective = stems.map((stem, index) => (included[index] ? stem : ""));
      const job = previewSuggestedNames(suggestions, effective, nextRevision);
      previewJob.current = await job;
      const result = await previewJob.current.completion;
      setPlan(result);
    } catch (caught) {
      setError(errorText(t, caught, "ai_search"));
    } finally {
      endWait();
    }
  };

  const execute = async () => {
    if (!executeAvailable || !plan || !plan.all_rows_valid) return;
    startWait();
    setError("");
    try {
      const handle = await executeRename(plan.plan_id, plan.request_revision);
      const report = await handle.completion;
      onCompleted(report);
    } catch (caught) {
      setError(errorText(t, caught, "ai_search"));
    } finally {
      endWait();
    }
  };

  const close = () => {
    if (plan) void releaseRenamePlan(plan.plan_id);
    onClose();
  };

  const accepted = included.filter(Boolean).length;

  return (
    <div className="ai-name-review" role="dialog" aria-modal="true" aria-label={t("aiSearch.suggestName")}>
      <header className="ai-name-review__header">
        <h2>{t("aiSearch.suggestName")}</h2>
        <button type="button" className="adp-icon-btn" aria-label={t("common.close")} onClick={close}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <p className="ai-name-review__pattern">{t("aiSearch.pattern")}: {pattern.pattern}</p>
      {!sources && !error ? <Skeleton variant="rows" count={4} /> : null}
      <div className="ai-name-review__rows" role="table" aria-label={t("aiSearch.suggestName")}>
        <div className="ai-name-review__row ai-name-review__row--head" role="row">
          <span role="columnheader">{t("aiSearch.oldName")}</span>
          <span role="columnheader">{t("aiSearch.newName")}</span>
          <span role="columnheader">{t("rename.exclude")}</span>
          <span role="columnheader">{t("aiSearch.reason")}</span>
        </div>
        {suggestions.map((suggestion, index) => {
          const source = sources?.[index];
          const extension = source ? splitName(source.name).extension : "";
          const normalized = normalizeProposedStem(stems[index] ?? "");
          const row = planRows.get(index);
          return (
            <div className="ai-name-review__row" role="row" key={suggestion.source.id}>
              <span role="cell" className="ai-name-review__old">
                {source?.name ?? "—"}
              </span>
              <span role="cell" className="ai-name-review__new">
                <input
                  className="adp-input"
                  aria-label={t("aiSearch.newName")}
                  value={normalized.stem}
                  disabled={!included[index]}
                  onChange={(event) => {
                    const next = [...stems];
                    next[index] = event.target.value;
                    setStems(next);
                    setPlan(null);
                  }}
                />
                <span className="ai-name-review__extension">{extension}</span>
                {!normalized.valid ? (
                  <span className="ai-name-review__invalid">{t("errors.rename.invalid_name")}</span>
                ) : null}
                {row ? (
                  <span className={`ai-name-review__status ai-name-review__status--${row.status}`}>
                    {row.status === "conflict"
                      ? t("rename.conflict")
                      : row.status === "invalid"
                        ? t("errors.rename.invalid_name")
                        : row.status === "unchanged"
                          ? t("rename.unchanged")
                          : row.status === "excluded"
                            ? t("rename.exclude")
                            : t("common.ready")}
                  </span>
                ) : null}
              </span>
              <span role="cell">
                <input
                  type="checkbox"
                  aria-label={t("rename.exclude")}
                  checked={included[index]}
                  onChange={(event) => {
                    const next = [...included];
                    next[index] = event.target.checked;
                    setIncluded(next);
                    setPlan(null);
                  }}
                />
              </span>
              <span role="cell" className="ai-name-review__reason">
                {suggestion.reason}
              </span>
            </div>
          );
        })}
      </div>
      {slow ? (
        <p className="ai-name-review__status" role="status">
          {t("aiSearch.progress")}
        </p>
      ) : null}
      {error ? (
        <p className="ai-name-review__error" role="alert">
          {error}
        </p>
      ) : null}
      <footer className="ai-name-review__footer">
        <button type="button" className="adp-btn" onClick={() => onOpenHelp("rename-suggestions")}>
          {t("search.help")}
        </button>
        <button type="button" className="adp-btn" disabled={busy} onClick={() => void preview()}>
          <ListChecks size={16} aria-hidden="true" />
          {t("aiSearch.preview")}
        </button>
        <button
          type="button"
          className="adp-btn adp-btn--primary"
          disabled={busy || !executeAvailable || !plan || !plan.all_rows_valid || accepted === 0}
          onClick={() => void execute()}
        >
          {t("rename.action")}
        </button>
        <button type="button" className="adp-btn" onClick={close}>
          {t("aiSearch.cancel")}
        </button>
      </footer>
    </div>
  );
}
