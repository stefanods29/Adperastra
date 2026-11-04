import { Eye, EyeOff, FolderOpen, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import ProgressBar from "../components/ProgressBar";
import TextInput from "../components/TextInput";
import { errorCode, errorText } from "../services/errors";
import { createLockedCopy, type LockedCreateResult } from "../services/lockedFolders";
import type { JobHandle } from "../services/jobs";
import { pickSavePath } from "../services/textFiles";

export interface CreateLockedCopyDialogProps {
  sourceDir: string;
  onCreated: (result: LockedCreateResult) => void;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

function scalarLength(value: string): number {
  return [...value].length;
}

/** Create encrypted copy (Step 09k T7). The wording is deliberately
 * "copy": the original folder is not protected, moved or removed. */
export default function CreateLockedCopyDialog({
  sourceDir,
  onCreated,
  onClose,
  onOpenHelp,
}: CreateLockedCopyDialogProps) {
  const { t } = useTranslation();
  const [destination, setDestination] = useState("");
  const [recovery, setRecovery] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<JobHandle<LockedCreateResult> | null>(null);

  useEffect(() => () => {
    void jobRef.current?.cancel().catch(() => undefined);
  }, []);

  const passwordValid = scalarLength(password) >= 12 && password === confirm;
  const valid = destination.trim() !== "" && recovery.trim() !== "" && passwordValid && understood;

  async function browseDestination(): Promise<void> {
    const chosen = await pickSavePath(
      t("locked.create"),
      "locked-folder.adplock",
      t("locked.containerFilter"),
    );
    if (!chosen) return;
    setDestination(chosen);
    if (!recovery) {
      setRecovery(chosen.replace(/\.adplock$/i, "") + ".adprecovery");
    }
  }

  async function browseRecovery(): Promise<void> {
    const chosen = await pickSavePath(
      t("locked.saveRecovery"),
      "locked-folder.adprecovery",
      t("locked.recoveryFilter"),
    );
    if (chosen) setRecovery(chosen);
  }

  async function start(): Promise<void> {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const job = await createLockedCopy({
        source_dir: sourceDir,
        dest_path: destination,
        password,
        recovery_dest_path: recovery,
        keep_original: true,
        confirm_original_unprotected: true,
      });
      jobRef.current = job;
      const result = await job.completion;
      onCreated(result);
      onClose();
    } catch (failure) {
      const code = errorCode(failure);
      setError(
        code === "locked.invalid" && recovery
          ? t("locked.recoveryCollision")
          : errorText(t, failure, "locked"),
      );
    } finally {
      jobRef.current = null;
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t("locked.create")}
      onClose={onClose}
      className="adp-locked-create-dialog"
    >
      <form
        className="adp-locked-form"
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <div className="adp-locked-heading-row">
          <KeyRound size={16} aria-hidden="true" />
          <span>{t("locked.title")}</span>
          <HelpButton onOpenHelp={() => onOpenHelp("locked-folders")} />
        </div>
        <label className="adp-locked-field">
          <span>{t("locked.sourceFolder")}</span>
          <TextInput value={sourceDir} onChange={() => undefined} disabled ariaLabel={t("locked.sourceFolder")} />
        </label>
        <label className="adp-locked-field">
          <span>{t("locked.destination")}</span>
          <div className="adp-locked-path-row">
            <TextInput
              value={destination}
              onChange={setDestination}
              ariaLabel={t("locked.destination")}
              placeholder={t("locked.containerFilter")}
            />
            <Button type="button" variant="subtle" onClick={() => void browseDestination()}>
              <FolderOpen size={16} aria-hidden="true" />
              {t("locked.browse")}
            </Button>
          </div>
        </label>
        <div className="adp-locked-warning" role="note">
          {t("locked.originalKept")}
        </div>
        <label className="adp-locked-check">
          <input
            type="checkbox"
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
          />
          <span>{t("locked.understandOriginal")}</span>
        </label>
        <label className="adp-locked-field">
          <span>{t("locked.password")}</span>
          <div className="adp-locked-path-row">
            <TextInput
              value={password}
              onChange={setPassword}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              ariaLabel={t("locked.password")}
              maxLength={1024}
            />
            <button
              type="button"
              className="adp-icon-btn adp-locked-visibility"
              aria-label={showPassword ? t("locked.hidePassword") : t("locked.showPassword")}
              title={showPassword ? t("locked.hidePassword") : t("locked.showPassword")}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>
          <small>{t("locked.passwordHint")}</small>
        </label>
        <label className="adp-locked-field">
          <span>{t("locked.confirmPassword")}</span>
          <TextInput
            value={confirm}
            onChange={setConfirm}
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            ariaLabel={t("locked.confirmPassword")}
            maxLength={1024}
            invalid={confirm.length > 0 && password !== confirm}
          />
          {confirm.length > 0 && password !== confirm && (
            <small className="adp-locked-field-error">{t("locked.confirmMismatch")}</small>
          )}
        </label>
        <label className="adp-locked-field">
          <span>{t("locked.recoveryKey")}</span>
          <div className="adp-locked-path-row">
            <TextInput
              value={recovery}
              onChange={setRecovery}
              ariaLabel={t("locked.recoveryKey")}
              placeholder={t("locked.recoveryFilter")}
            />
            <Button type="button" variant="subtle" onClick={() => void browseRecovery()}>
              <FolderOpen size={16} aria-hidden="true" />
              {t("locked.browse")}
            </Button>
          </div>
          <small>{t("locked.recoverySecret")}</small>
        </label>
        <p className="adp-locked-note">{t("locked.passwordLost")}</p>
        <p className="adp-locked-note">{t("locked.limits")}</p>
        {busy && <ProgressBar label={t("locked.creating")} />}
        {error && (
          <div className="adp-locked-error" role="alert">
            {error}
          </div>
        )}
        <div className="adp-dialog-actions">
          <Button type="button" variant="subtle" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || busy}>
            {busy && <Loader2 size={16} aria-hidden="true" />}
            {t("locked.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
