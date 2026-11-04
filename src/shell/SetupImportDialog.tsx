/** Setup import preview (Step 10e T5, E7).
 *
 * The dialog shows exactly what the archive contains; nothing has been
 * applied. All parts start selected, the personal-path acknowledgment starts
 * unchecked, and Apply is disabled until the selection and acknowledgment are
 * valid (D9).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import { errorText } from "../services/errors";
import {
  isSetupPart,
  setupPartLabelKey,
  type SetupApplyRequest,
  type SetupApplyResult,
  type SetupPreview,
  type SetupPart,
} from "../services/setups";

/** Preview warning codes that already have a translated sentence. A code
 * without one is shown as its stable native value instead of guessing text. */
const WARNING_KEYS: Readonly<Record<string, string>> = {
  personal_paths: "setups.warningPersonalPaths",
};

const UNSUPPORTED_PREFIX = "setup.unsupported.";

export interface SetupImportDialogProps {
  preview: SetupPreview;
  onApply: (request: SetupApplyRequest) => Promise<void>;
  /** Successful Apply result; the host keeps the dialog open when it carries
   * warnings or unsupported parts. */
  result?: SetupApplyResult | null;
  onClose: () => void;
  onOpenHelp: (slug?: string) => void;
}

export default function SetupImportDialog(props: SetupImportDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<SetupPart>>(
    () =>
      new Set(
        props.preview.parts
          .filter((part) => !part.warning_codes.includes("personal_paths"))
          .map((part) => part.id),
      ),
  );
  const [personalAccepted, setPersonalAccepted] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const containsPersonal = props.preview.manifest.contains_personal_paths;
  const personalSelected = props.preview.parts.some(
    (part) => selected.has(part.id) && part.warning_codes.includes("personal_paths"),
  );
  const needsAcknowledgement = containsPersonal && personalSelected && !personalAccepted;
  const canApply = selected.size > 0 && !applying && !applied && !props.result && !needsAcknowledgement;
  /** After a successful Apply the preview belongs to a released quarantine;
   * its checkboxes are read-only until the owner closes the dialog. */
  const locked = applying || applied || Boolean(props.result);

  // Apply reports one warning list for the whole import. Keep the dialog
  // open for any warning or part this build could not apply; otherwise the
  // host closes it as before.
  const notices = new Set<string>();
  if (props.result) {
    const unsupported = new Set<SetupPart>();
    for (const code of props.result.warning_codes) {
      const id = code.startsWith(UNSUPPORTED_PREFIX) ? code.slice(UNSUPPORTED_PREFIX.length) : null;
      if (id !== null && isSetupPart(id)) {
        unsupported.add(id);
      } else {
        notices.add(WARNING_KEYS[code] ? t(WARNING_KEYS[code]) : code);
      }
    }
    for (const part of selected) {
      if (!props.result.applied_parts.includes(part)) unsupported.add(part);
    }
    for (const part of unsupported) {
      notices.add(`${t(setupPartLabelKey(part))}: ${t("errors.setup.unsupported")}`);
    }
    if (props.result.pending_recovery) notices.add(t("errors.setup.recovery_required"));
  }

  const toggle = (part: SetupPart) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(part)) next.delete(part);
      else next.add(part);
      return next;
    });
  };

  const close = () => {
    // Escape, the overlay and the header button must not race a running
    // Apply: the host releases the preview quarantine when the dialog closes.
    if (!applying) props.onClose();
  };

  const apply = async () => {
    if (!canApply) return;
    setApplying(true);
    setError(null);
    try {
      await props.onApply({
        preview_id: props.preview.preview_id,
        parts: [...selected],
        accept_personal_paths: containsPersonal && personalSelected && personalAccepted,
      });
      setApplied(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog title={t("setups.import")} onClose={close} className="adp-setup-import">
      <div className="adp-view-header">
        <h3 className="adp-heading">{t("setups.contents")}</h3>
        <HelpButton onOpenHelp={() => props.onOpenHelp("shareable-setups")} />
      </div>
      {applied || props.result ? null : <p className="adp-note">{t("setups.noChanges")}</p>}

      <ul className="adp-setup-import__parts">
        {props.preview.parts.map((part) => (
          <li key={part.id} className="adp-setup-import__part">
            <label className="adp-setup-import__check">
              <input
                type="checkbox"
                checked={selected.has(part.id)}
                onChange={() => toggle(part.id)}
                disabled={locked}
              />
              <span>{t(setupPartLabelKey(part.id))}</span>
            </label>
            <span className="adp-setup-import__count" aria-label={t("setups.contents")}>
              {part.item_count}
            </span>
            {part.warning_codes.length > 0 ? (
              <span className="adp-setup-import__warnings">
                {part.warning_codes.map((code) => (
                  <span key={code} className="adp-setup-import__warning">
                    {WARNING_KEYS[code] ? t(WARNING_KEYS[code]) : code}
                  </span>
                ))}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {containsPersonal ? (
        <div className="adp-setup-import__personal">
          <p className="adp-note">{t("setups.personalWarning")}</p>
          <label className="adp-setup-import__check">
            <input
              type="checkbox"
              checked={personalAccepted}
              onChange={(event) => setPersonalAccepted(event.target.checked)}
              disabled={locked}
            />
            <span>{t("setups.personal")}</span>
          </label>
        </div>
      ) : null}

      {notices.size > 0 ? (
        <div className="adp-setup-import__result" role="status">
          <ul className="adp-setup-import__notices">
            {[...notices].map((notice) => (
              <li key={notice} className="adp-setup-import__warning">
                {notice}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="adp-setup-import__error">{errorText(t, error, "setup")}</p> : null}

      <div className="adp-dialog-actions">
        <Button variant="primary" disabled={!canApply} onClick={() => void apply()}>
          {t("setups.apply")}
        </Button>
        <Button autoFocus disabled={applying} onClick={close}>
          {applied || props.result ? t("common.close") : t("common.cancel")}
        </Button>
      </div>
    </Dialog>
  );
}
