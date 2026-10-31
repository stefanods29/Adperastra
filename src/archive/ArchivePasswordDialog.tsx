import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import { errorText } from "../services/errors";
import type { ArchiveAuth } from "../services/archive";
import PasswordFields from "./PasswordFields";
import { passwordStrength, passwordStrengthValue } from "./passwordStrength";

/** One password prompt (Step 06e T10). Escape and Cancel resolve null; the
 * value is never shown in an error, stored or measured. */
export interface ArchivePasswordDialogProps {
  name: string;
  /** The code that caused the prompt (`password_required`, `bad_password`). */
  errorCode?: string | null;
  onSubmit: (auth: ArchiveAuth) => Promise<void>;
  onCancel: () => void;
}

export default function ArchivePasswordDialog({
  name,
  errorCode,
  onSubmit,
  onCancel,
}: ArchivePasswordDialogProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hintId = "adp-archive-password-hint";
  const errorId = "adp-archive-password-error";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const strength = passwordStrength(password);
  const value = passwordStrengthValue(password);

  const submit = async () => {
    if (!password || submitting) return;
    setSubmitting(true);
    setFailure(null);
    try {
      await onSubmit({ password, remember_session: remember });
    } catch (error) {
      setFailure(errorText(t, error, "archive"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog title={t("archive.passwordTitle", { name })} onClose={onCancel} className="adp-archive-password-dialog">
      <div
        className="adp-dialog-scroll"
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        {errorCode ? (
          <p className="adp-field-error" id={errorId} role="alert">
            {errorText(t, new Error(errorCode), "archive")}
          </p>
        ) : null}
        <PasswordFields
          value={password}
          onValueChange={(next) => {
            setPassword(next);
            setFailure(null);
          }}
          show={show}
          onShowChange={setShow}
          disabled={submitting}
          passwordRef={inputRef}
          hintId={hintId}
        />
        {password ? (
          <div className="adp-password-strength">
            <div
              className="adp-password-meter"
              role="meter"
              aria-label={t("archive.passwordStrength")}
              aria-valuemin={0}
              aria-valuemax={3}
              aria-valuenow={value}
            >
              <span className={`adp-password-meter-fill adp-password-meter-${strength}`} />
            </div>
            <span className="adp-password-strength-label">
              {t("archive.passwordStrength")}: {t(`archive.password${strength[0].toUpperCase()}${strength.slice(1)}`)}
            </span>
          </div>
        ) : null}
        <p className="adp-field-hint" id={hintId}>
          {t("archive.passwordHint")}
        </p>
        <label className="adp-check-row">
          <input
            type="checkbox"
            checked={remember}
            disabled={submitting}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span>{t("archive.rememberPassword")}</span>
        </label>
        {failure ? (
          <p className="adp-field-error" role="alert">
            {failure}
          </p>
        ) : null}
      </div>
      <div className="adp-dialog-footer">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button onClick={() => void submit()} disabled={!password || submitting}>
          {t("archive.passwordOpen")}
        </Button>
      </div>
    </Dialog>
  );
}
