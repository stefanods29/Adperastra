import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { archivePickFolder } from "../services/archive";
import type {
  ArchiveCreateRequest,
  CreateEncryptionId,
  CreateFormatId,
} from "../services/archiveCreate";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import TextInput from "../components/TextInput";
import PasswordFields from "./PasswordFields";
import PasswordMeter from "./PasswordMeter";
import { passwordProblem } from "./passwordStrength";
import {
  defaultCreateName,
  FORMAT_EXTENSION,
  nameProblem,
  withFormatExtension,
} from "./compressNames";

/** The Compress to… window (Step 06e T11). It never reads a source; the job
 * starts only through `onCreate`, and a start error keeps the window open. */
export interface CompressDialogProps {
  sources: string[];
  initialFolder: string;
  onCreate: (request: ArchiveCreateRequest) => Promise<void>;
  onClose: () => void;
  onOpenHelp?: () => void;
}

export default function CompressDialog({
  sources,
  initialFolder,
  onCreate,
  onClose,
  onOpenHelp,
}: CompressDialogProps) {
  const { t } = useTranslation();
  const [destDir, setDestDir] = useState(initialFolder);
  const [format, setFormat] = useState<CreateFormatId>("zip");
  const [name, setName] = useState(() => defaultCreateName(sources, "zip", t("files.newArchiveName")));
  const [customized, setCustomized] = useState(false);
  const [encryption, setEncryption] = useState<CreateEncryptionId>("none");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [encryptNames, setEncryptNames] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);

  const nameIssue = useMemo(() => nameProblem(name, format), [name, format]);
  const secretIssue =
    encryption === "none" ? null : passwordProblem(password, confirmation);
  const canCreate = !submitting && destDir !== "" && nameIssue === null && secretIssue === null;

  const changeFormat = (next: CreateFormatId) => {
    if (next === format) return;
    if (!customized) setName((current) => withFormatExtension(current, format, next));
    setFormat(next);
    if (encryption === "zip_crypto" && next === "seven_z") {
      // ZipCrypto exists only for ZIP: an explicit AES choice, never silent.
      setEncryption("aes256");
      setEncryptNames(true);
    }
    if (encryption === "none") setEncryptNames(false);
  };

  const changeEncryption = (next: CreateEncryptionId) => {
    setEncryption(next);
    if (next === "none") {
      setPassword("");
      setConfirmation("");
      setEncryptNames(false);
    } else if (next === "aes256" && format === "seven_z") {
      setEncryptNames(true);
    }
    setFailure(null);
  };

  const chooseFolder = async () => {
    try {
      const chosen = await archivePickFolder(t("archive.chooseDestinationTitle"));
      if (chosen) setDestDir(chosen);
    } catch {
      // The picker's own failure leaves the confirmed destination unchanged.
    }
  };

  const submit = async () => {
    // A second click in the same frame must not start a second job.
    if (!canCreate || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setFailure(null);
    try {
      await onCreate({
        sources,
        dest_dir: destDir,
        file_name: name,
        format,
        encryption,
        password: encryption === "none" ? null : password,
        encrypt_names: format === "seven_z" && encryption !== "none" && encryptNames,
      });
      onClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : typeof error === "string" ? error : "archive.other";
      setFailure(t(`errors.archive.${message.startsWith("archive.") ? message.slice(8) : "other"}`, {
        defaultValue: t("errors.archive.other"),
      }));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog title={t("archive.createTitle")} onClose={onClose} className="adp-archive-create-dialog">
      <div className="adp-dialog-scroll">
        <p className="adp-dialog-note">
          {t("archive.createSelection", { count: sources.length })}
        </p>

        <span className="adp-field-label">{t("archive.destination")}</span>
        <div className="adp-field-row">
          <span className="adp-path-text" title={destDir}>
            {destDir}
          </span>
          <Button onClick={() => void chooseFolder()} disabled={submitting}>
            {t("archive.chooseDestination")}
          </Button>
        </div>

        <label className="adp-field-label" htmlFor="adp-create-name">
          {t("archive.fileName")}
        </label>
        <TextInput
          inputId="adp-create-name"
          value={name}
          onChange={(next) => {
            setCustomized(true);
            setName(next);
          }}
          ariaLabel={t("archive.fileName")}
          autoComplete="off"
          disabled={submitting}
          invalid={nameIssue !== null}
        />

        <label className="adp-field-label" htmlFor="adp-create-format">
          {t("archive.createFormat")}
        </label>
        <select
          id="adp-create-format"
          className="adp-input"
          value={format}
          disabled={submitting}
          onChange={(event) => changeFormat(event.target.value as CreateFormatId)}
        >
          <option value="zip">{t("archive.format.zip")}</option>
          <option value="seven_z">{t("archive.format.seven_z")}</option>
        </select>

        <label className="adp-field-label" htmlFor="adp-create-encryption">
          {t("archive.encryption")}
        </label>
        <select
          id="adp-create-encryption"
          className="adp-input"
          value={encryption}
          disabled={submitting}
          onChange={(event) => changeEncryption(event.target.value as CreateEncryptionId)}
        >
          <option value="none">{t("archive.encryptionNone")}</option>
          <option value="aes256">{t("archive.encryptionAes")}</option>
          {format === "zip" ? (
            <option value="zip_crypto">{t("archive.encryptionZipCrypto")}</option>
          ) : null}
        </select>

        {encryption === "zip_crypto" ? (
          <p className="adp-field-warning" role="note">
            {t("archive.zipCryptoWarning")}
          </p>
        ) : null}

        {encryption !== "none" ? (
          <>
            <PasswordFields
              value={password}
              onValueChange={setPassword}
              confirmation={confirmation}
              onConfirmationChange={setConfirmation}
              show={show}
              onShowChange={setShow}
              disabled={submitting}
            />
            <PasswordMeter value={password} />
            {secretIssue === "mismatch" ? (
              <p className="adp-field-error" role="alert">
                {t("errors.archive.password_mismatch")}
              </p>
            ) : null}
            {secretIssue === "invalid" && password ? (
              <p className="adp-field-error" role="alert">
                {t("errors.archive.invalid_password")}
              </p>
            ) : null}
          </>
        ) : null}

        {format === "zip" && encryption !== "none" ? (
          <p className="adp-field-hint">{t("archive.zipNamesVisible")}</p>
        ) : null}

        {format === "seven_z" && encryption === "aes256" ? (
          <label className="adp-check-row">
            <input
              type="checkbox"
              checked={encryptNames}
              disabled={submitting}
              onChange={(event) => setEncryptNames(event.target.checked)}
            />
            <span>{t("archive.encryptNames")}</span>
          </label>
        ) : null}

        <p className="adp-field-hint">{t("archive.keepBothNote")}</p>

        {nameIssue === "extension" ? (
          <p className="adp-field-error" role="alert">
            {t("archive.extensionRequired", { extension: `.${FORMAT_EXTENSION[format]}` })}
          </p>
        ) : null}
        {nameIssue === "invalid" || nameIssue === "empty" ? (
          <p className="adp-field-error" role="alert">
            {t("errors.archive.bad_request")}
          </p>
        ) : null}
        {failure ? (
          <p className="adp-field-error" role="alert">
            {failure}
          </p>
        ) : null}
      </div>
      <div className="adp-dialog-footer">
        {onOpenHelp ? <Button onClick={onOpenHelp}>{t("help.title")}</Button> : null}
        <Button onClick={onClose} disabled={submitting}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => void submit()} disabled={!canCreate}>
          {t("archive.create")}
        </Button>
      </div>
    </Dialog>
  );
}
