import { Eye, EyeOff, FolderOpen, KeyRound, Loader2, LockKeyhole } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import ProgressBar from "../components/ProgressBar";
import TextInput from "../components/TextInput";
import { errorText } from "../services/errors";
import type { JobHandle } from "../services/jobs";
import {
  pickLockedRecoveryPath,
  unlockLockedFolder,
  type LockedSession,
} from "../services/lockedFolders";

export interface UnlockDialogProps {
  path: string;
  onUnlocked: (session: LockedSession) => void;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

export default function UnlockDialog({
  path,
  onUnlocked,
  onClose,
  onOpenHelp,
}: UnlockDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"password" | "recovery">("password");
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<JobHandle<LockedSession> | null>(null);

  useEffect(() => () => {
    void jobRef.current?.cancel().catch(() => undefined);
  }, []);

  const valid = mode === "password" ? password.length > 0 : recovery.trim() !== "";

  async function browseRecovery(): Promise<void> {
    const chosen = await pickLockedRecoveryPath(t("locked.recoveryKey"), t("locked.recoveryFilter"));
    if (chosen) setRecovery(chosen);
  }

  async function unlock(): Promise<void> {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const request =
        mode === "password"
          ? { path, credential: { kind: "password" as const, value: password } }
          : { path, credential: { kind: "recovery" as const, recovery_path: recovery } };
      const job = await unlockLockedFolder(request);
      jobRef.current = job;
      const session = await job.completion;
      onUnlocked(session);
      onClose();
    } catch (failure) {
      setError(errorText(t, failure, "locked"));
    } finally {
      jobRef.current = null;
      setBusy(false);
    }
  }

  return (
    <Dialog title={t("locked.unlock")} onClose={onClose} className="adp-locked-unlock-dialog">
      <form
        className="adp-locked-form"
        onSubmit={(event) => {
          event.preventDefault();
          void unlock();
        }}
      >
        <div className="adp-locked-heading-row">
          <LockKeyhole size={16} aria-hidden="true" />
          <span>{t("locked.title")}</span>
          <HelpButton onOpenHelp={() => onOpenHelp("recovery-keys")} />
        </div>
        <p className="adp-locked-note">{t("locked.unlockedWarning")}</p>
        <div className="adp-locked-mode" role="radiogroup" aria-label={t("locked.recoveryKey")}>
          <label>
            <input
              type="radio"
              name="locked-credential"
              checked={mode === "password"}
              onChange={() => setMode("password")}
            />
            <KeyRound size={14} aria-hidden="true" />
            {t("locked.password")}
          </label>
          <label>
            <input
              type="radio"
              name="locked-credential"
              checked={mode === "recovery"}
              onChange={() => setMode("recovery")}
            />
            <FolderOpen size={14} aria-hidden="true" />
            {t("locked.recoveryKey")}
          </label>
        </div>
        {mode === "password" ? (
          <label className="adp-locked-field">
            <span>{t("locked.password")}</span>
            <div className="adp-locked-path-row">
              <TextInput
                value={password}
                onChange={setPassword}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                ariaLabel={t("locked.password")}
                maxLength={1024}
              />
              <button
                type="button"
                className="adp-icon-btn"
                aria-label={showPassword ? t("locked.hidePassword") : t("locked.showPassword")}
                title={showPassword ? t("locked.hidePassword") : t("locked.showPassword")}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </div>
          </label>
        ) : (
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
          </label>
        )}
        <p className="adp-locked-note">{t("locked.passwordLost")}</p>
        {busy && <ProgressBar label={t("locked.unlocking")} />}
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
            {t("locked.unlock")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
