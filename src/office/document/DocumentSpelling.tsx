import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import { officeSpelling } from "../../services/officeEdit";
import type { DocumentOperation, OfficeSpellingIssue, TextSpan } from "../types";

export function DocumentSpelling({ sessionId, span, enabled, onApply }: {
  sessionId: string; span: TextSpan; enabled: boolean; onApply: (operation: DocumentOperation) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [issues, setIssues] = useState<OfficeSpellingIssue[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [generation, setGeneration] = useState(0);
  const epoch = useRef(0);
  useEffect(() => {
    let disposed = false;
    const current = ++epoch.current;
    setIssues([]); setCursor(null); setError(false);
    if (!enabled) return;
    setBusy(true);
    void officeSpelling(sessionId, span).then((page) => {
      if (disposed || current !== epoch.current) return;
      if (page.revision !== span.revision) throw new Error("office_edit.changed");
      setIssues(page.items); setCursor(page.next_cursor);
    }).catch(() => { if (!disposed) setError(true); }).finally(() => { if (!disposed) setBusy(false); });
    return () => { disposed = true; ++epoch.current; };
  }, [sessionId, span, enabled, generation]);
  const loadMore = () => {
    // Replace the visible page instead of accumulating unbounded issue text.
    if (!cursor || busy) return;
    setBusy(true); setError(false);
    const expectedSpan = span;
    const current = epoch.current;
    void officeSpelling(sessionId, expectedSpan, cursor).then((page) => {
      if (current !== epoch.current) return;
      if (page.revision !== expectedSpan.revision) throw new Error("office_edit.changed");
      setIssues(page.items); setCursor(page.next_cursor);
    }).catch(() => { if (current === epoch.current) setError(true); })
      .finally(() => { if (current === epoch.current) setBusy(false); });
  };
  if (!enabled) return null;
  return <section aria-label={t("officeDoc.spelling")} aria-busy={busy}>
    {issues.map((issue) => <div key={issue.id}><span>{issue.word}</span>{issue.suggestions.map((suggestion) =>
      <Button key={suggestion} disabled={busy} onClick={() => {
        const current = epoch.current;
        setBusy(true);
        void onApply({ kind: "replace_match", span: issue.span, expected_text: issue.word, replacement: suggestion })
          .then(() => { if (current === epoch.current) setGeneration((value) => value + 1); })
          .catch(() => { if (current === epoch.current) setError(true); })
          .finally(() => { if (current === epoch.current) setBusy(false); });
      }}>{suggestion}</Button>)}</div>)}
    <Button disabled={busy || !cursor} onClick={loadMore}>{t("officeDoc.more")}</Button>
    {error ? <p role="alert">{t("errors.office_edit.changed")}</p> : null}
  </section>;
}
