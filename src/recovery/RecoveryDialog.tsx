import { ArchiveRestore, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import Skeleton from "../components/Skeleton";
import { errorText } from "../services/errors";
import { displayPath } from "../services/explorer";
import { formatDate, formatSize } from "../services/format";
import type { RecoveryCandidate } from "../services/recovery";

/**
 * E7: the startup recovery dialog. Every action is explicit; Escape and
 * clicking outside mean "Keep for later" and never discard anything.
 */

export interface RecoveryDialogProps {
  items: RecoveryCandidate[];
  loading: boolean;
  errorCode?: string;
  onOpen: (id: string) => Promise<void>;
  onDiscard: (ids: readonly string[]) => Promise<void>;
  onLater: () => void;
  onOpenHelp: (slug: string) => void;
  /** Additive: old Step 06a plaintext drafts found by name only. */
  legacyDrafts?: number;
  onImportLegacy?: () => Promise<void>;
  /** Additive: the new app-owned copy written by the last explicit Open. */
  copyPath?: string | null;
}

export default function RecoveryDialog({
  items,
  loading,
  errorCode,
  onOpen,
  onDiscard,
  onLater,
  onOpenHelp,
  legacyDrafts = 0,
  onImportLegacy,
  copyPath,
}: RecoveryDialogProps) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const selectedItem = items.find((item) => selected.has(item.record_id));
  // Opening is only possible for a record whose authenticated metadata says
  // it is available. Discarding a corrupt record stays possible because it
  // removes only that recovery record.
  const canOpen = selectedIds.length === 1 && selectedItem?.status === "available" && !busy;
  const canDiscard = selectedIds.length > 0 && !busy;

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmDiscard(false);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (error) {
      setFailure(errorText(t, error, "recovery"));
    } finally {
      setBusy(false);
    }
  };

  const open = () => {
    if (!canOpen) return;
    void run(async () => {
      await onOpen(selectedIds[0]);
      setSelected(new Set());
    });
  };

  const discard = () => {
    if (!canDiscard) return;
    void run(async () => {
      await onDiscard(selectedIds);
      setSelected(new Set());
      setConfirmDiscard(false);
    });
  };

  return (
    <Dialog
      title={t("recovery.title")}
      onClose={onLater}
      className="adp-recovery-dialog"
    >
      <div className="adp-recovery-toolbar">
        <p className="adp-recovery-lead">
          {items.length > 0 ? t("recovery.available") : t("recovery.title")}
        </p>
        <HelpButton onOpenHelp={() => onOpenHelp("recovering-after-a-crash")} />
      </div>
      {(errorCode || failure) && (
        <p className="adp-recovery-error" role="alert">
          {failure ?? errorText(t, errorCode ?? "recovery.io", "recovery")}
        </p>
      )}
      {copyPath ? (
        <p className="adp-recovery-lead" role="status">
          {t("recovery.copyLocation", { path: displayPath(copyPath) })}
        </p>
      ) : null}
      {legacyDrafts > 0 && onImportLegacy && (
        <div className="adp-recovery-legacy" role="note">
          <p>{t("recovery.legacyFound", { count: legacyDrafts })}</p>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await onImportLegacy();
              })
            }
          >
            {t("recovery.importLegacy")}
          </Button>
        </div>
      )}
      {loading ? (
        <Skeleton variant="rows" count={3} />
      ) : items.length === 0 ? (
        <p className="adp-recovery-empty">{t("recovery.unavailable")}</p>
      ) : (
        <ul className="adp-recovery-list" aria-label={t("recovery.title")}>
          {items.map((item) => {
            const checked = selected.has(item.record_id);
            const status =
              item.status === "available"
                ? t("recovery.available")
                : item.status === "unsupported"
                  ? t("recovery.unavailable")
                  : errorText(t, item.error_code ?? "recovery.corrupt", "recovery");
            return (
              <li key={item.record_id} className="adp-recovery-row">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(item.record_id)}
                  aria-label={t("recovery.open")}
                />
                <div className="adp-recovery-row-text">
                  <span className="adp-recovery-name">{item.name || item.record_id}</span>
                  <span className="adp-recovery-meta">
                    {formatDate(item.captured_unix, i18n.language)} · {formatSize(item.byte_len, i18n.language)}
                    {item.source_path ? ` · ${displayPath(item.source_path)}` : ""}
                  </span>
                  <span className="adp-recovery-status">{status}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {confirmDiscard ? (
        <div className="adp-recovery-confirm" role="alertdialog" aria-label={t("recovery.discardConfirm")}>
          <p>{t("recovery.discardConfirm")}</p>
          <div className="adp-recovery-confirm-actions">
            <Button variant="primary" disabled={busy} onClick={discard}>
              {t("recovery.discard")}
            </Button>
            <Button disabled={busy} onClick={() => setConfirmDiscard(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="adp-dialog-actions adp-recovery-actions">
          <Button variant="primary" disabled={!canOpen} onClick={open}>
            <ArchiveRestore size={16} aria-hidden="true" />
            {t("recovery.open")}
          </Button>
          <Button disabled={!canDiscard} onClick={() => setConfirmDiscard(true)}>
            <Trash2 size={16} aria-hidden="true" />
            {t("recovery.discard")}
          </Button>
          <Button disabled={busy} onClick={onLater}>
            {t("recovery.later")}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
