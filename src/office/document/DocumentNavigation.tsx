import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import { officeItems } from "../../services/officeEdit";
import type { OfficeItemPage, OfficeSelection, TextPosition } from "../types";

type HeadingPage = Extract<OfficeItemPage, { kind: "headings" }>;

export function DocumentNavigation({ sessionId, revision, active, onNavigate }: {
  sessionId: string; revision: number; active: boolean;
  onNavigate: (selection: OfficeSelection, position: TextPosition) => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState<HeadingPage | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const load = async (generation: number, cursor?: string) => {
    setBusy(true); setError(false);
    try {
      const result = await officeItems(sessionId, "headings", cursor);
      if (generation !== epoch.current) return;
      if (result.kind !== "headings" || result.revision !== revision) throw new Error("office_edit.changed");
      setPage(result);
    } catch { if (generation === epoch.current) setError(true); }
    finally { if (generation === epoch.current) setBusy(false); }
  };
  useEffect(() => {
    const generation = ++epoch.current;
    setPage(null);
    if (active) void load(generation);
    return () => { ++epoch.current; };
    // A new revision invalidates every cursor. No whole-document heading accumulation.
  }, [sessionId, revision, active]);
  if (!active) return null;
  return <nav aria-label={t("officeDoc.navigation")} aria-busy={busy}>
    {page?.items.map((heading) => <Button key={heading.id} onClick={() => onNavigate({
      kind: "document", page: heading.page,
      span: { anchor: heading.position, focus: heading.position, revision },
    }, heading.position)}>{heading.title}</Button>)}
    <Button disabled={busy || !page?.next_cursor} onClick={() => {
      if (page?.next_cursor) void load(epoch.current, page.next_cursor);
    }}>{t("officeDoc.more")}</Button>
    {error ? <p role="alert">{t("errors.office_edit.changed")}</p> : null}
  </nav>;
}
