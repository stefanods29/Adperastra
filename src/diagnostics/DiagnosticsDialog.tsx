import { Bug, Save } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import { errorText } from "../services/errors";
import { formatSize } from "../services/format";
import type { DiagnosticEdit, DiagnosticsFile, DiagnosticsSession } from "../services/diagnostics";

/**
 * E7: review the diagnostic session before saving. Nothing leaves the app
 * here; only the explicit issue button opens a prefilled page, and it never
 * carries file text, paths or a dump.
 */

export interface DiagnosticsDialogProps {
  session: DiagnosticsSession;
  onEdit: (edits: readonly DiagnosticEdit[]) => Promise<void>;
  onSave: () => Promise<void>;
  onOpenIssue: () => Promise<void>;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

interface LocalEdit {
  included: boolean;
  text: string;
}

export default function DiagnosticsDialog({
  session,
  onEdit,
  onSave,
  onOpenIssue,
  onClose,
  onOpenHelp,
}: DiagnosticsDialogProps) {
  const { t, i18n } = useTranslation();
  const [activeId, setActiveId] = useState(() => session.files[0]?.id ?? "");
  const [edits, setEdits] = useState<Record<string, LocalEdit>>(() => {
    const initial: Record<string, LocalEdit> = {};
    for (const file of session.files) {
      initial[file.id] = { included: file.included, text: file.preview ?? "" };
    }
    return initial;
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const active = session.files.find((file) => file.id === activeId) ?? session.files[0];
  const activeEdit = active ? edits[active.id] : undefined;
  const dumpIncluded = useMemo(
    () => session.files.some((file) => file.kind === "dump" && edits[file.id]?.included),
    [session.files, edits],
  );

  const change = (file: DiagnosticsFile, patch: Partial<LocalEdit>) => {
    setEdits((current) => ({
      ...current,
      [file.id]: { ...current[file.id], ...patch },
    }));
    setFailure(null);
  };

  const changedEdits = (): DiagnosticEdit[] =>
    session.files
      .map((file) => {
        const local = edits[file.id];
        if (!local) return null;
        const original = file.preview ?? "";
        const textChanged = file.kind === "text" && local.text !== original;
        if (local.included === file.included && !textChanged) return null;
        return {
          file_id: file.id,
          included: local.included,
          text: textChanged ? local.text : undefined,
        } satisfies DiagnosticEdit;
      })
      .filter((edit): edit is NonNullable<typeof edit> => edit !== null);

  const save = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const changes = changedEdits();
      if (changes.length > 0) await onEdit(changes);
      await onSave();
    } catch (error) {
      setFailure(errorText(t, error, "diagnostics"));
    } finally {
      setBusy(false);
    }
  };

  const openIssue = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await onOpenIssue();
    } catch (error) {
      setFailure(errorText(t, error, "diagnostics"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("diagnostics.title")}
      onClose={onClose}
      className="adp-diagnostics-dialog"
    >
      <div className="adp-diagnostics-toolbar">
        <p className="adp-diagnostics-review">{t("diagnostics.review")}</p>
        <label className="adp-diagnostics-redact">
          <input
            type="checkbox"
            checked={!session.include_paths}
            readOnly
            disabled
            aria-label={t("diagnostics.redact")}
          />
          <span>{t("diagnostics.redact")}</span>
        </label>
        <HelpButton onOpenHelp={() => onOpenHelp("reporting-a-problem")} />
      </div>
      {failure && (
        <p className="adp-diagnostics-error" role="alert">
          {failure}
        </p>
      )}
      <div className="adp-diagnostics-body">
        <ul className="adp-diagnostics-files" aria-label={t("diagnostics.title")}>
          {session.files.map((file) => {
            const local = edits[file.id];
            return (
              <li key={file.id} className="adp-diagnostics-file">
                <input
                  type="checkbox"
                  checked={local?.included ?? file.included}
                  onChange={(event) => change(file, { included: event.target.checked })}
                  aria-label={file.relative_name}
                />
                <button
                  type="button"
                  className="adp-diagnostics-file-select"
                  aria-pressed={file.id === active?.id}
                  onClick={() => setActiveId(file.id)}
                >
                  <span className="adp-diagnostics-file-name">{file.relative_name}</span>
                  <span className="adp-diagnostics-file-size">
                    {formatSize(file.bytes, i18n.language)}
                  </span>
                  {file.redacted && (
                    <span
                      className="adp-diagnostics-file-redacted"
                      title={t("diagnostics.redact")}
                      aria-label={t("diagnostics.redact")}
                    >
                      ●
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="adp-diagnostics-editor">
          {active && activeEdit ? (
            <>
              <div className="adp-diagnostics-editor-head">
                <span>{active.relative_name}</span>
                <label className="adp-diagnostics-dumps">
                  <input
                    type="checkbox"
                    checked={activeEdit.included}
                    onChange={(event) => change(active, { included: event.target.checked })}
                  />
                  <span>{active.kind === "dump" ? t("diagnostics.dumps") : t("diagnostics.title")}</span>
                </label>
              </div>
              {active.kind === "dump" ? (
                <p className="adp-diagnostics-dump-note">{t("diagnostics.dumpWarning")}</p>
              ) : (
                <textarea
                  className="adp-diagnostics-text"
                  value={activeEdit.text}
                  maxLength={1_048_576}
                  onChange={(event) => change(active, { text: event.target.value })}
                  aria-label={active.relative_name}
                />
              )}
            </>
          ) : (
            <p>{t("diagnostics.review")}</p>
          )}
        </div>
      </div>
      {dumpIncluded && <p className="adp-diagnostics-warning">{t("diagnostics.dumpWarning")}</p>}
      <div className="adp-dialog-actions adp-diagnostics-actions">
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          <Save size={16} aria-hidden="true" />
          {t("diagnostics.save")}
        </Button>
        <Button disabled={busy} onClick={() => void openIssue()}>
          <Bug size={16} aria-hidden="true" />
          {t("diagnostics.issue")}
        </Button>
        <Button disabled={busy} onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </Dialog>
  );
}
