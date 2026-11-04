import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import TextInput from "../components/TextInput";
import { errorText } from "../services/errors";
import type {
  TagImportChoice,
  TagImportConflict,
  TagImportPreview,
} from "../services/tags";

export interface TagImportDialogProps {
  /** The parsed file; nothing has been written yet. */
  preview: TagImportPreview;
  /** Send the explicit choices; the caller binds `preview.preview_id`. */
  onApply: (
    choices: readonly TagImportChoice[],
    allowPaths: boolean,
  ) => Promise<void>;
  onClose: () => void;
  onOpenHelp: () => void;
}

type ConflictDecision = { action: "merge" | "rename"; name: string };

/** Import preview (Step 11b decision 4). A duplicate name without an
 * explicit merge/rename choice keeps the Import button disabled. */
export default function TagImportDialog({
  preview,
  onApply,
  onClose,
  onOpenHelp,
}: TagImportDialogProps) {
  const { t } = useTranslation();
  const [decisions, setDecisions] = useState<
    Record<string, ConflictDecision | undefined>
  >({});
  const [allowPaths, setAllowPaths] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conflicts = preview.conflicts;
  const ready = useMemo(
    () =>
      conflicts.every((conflict) => {
        const decision = decisions[conflict.incoming_id];
        if (!decision) return false;
        return decision.action === "merge" || decision.name.trim() !== "";
      }),
    [conflicts, decisions],
  );

  const choose = (conflict: TagImportConflict, action: "" | "merge" | "rename") => {
    setDecisions((current) => ({
      ...current,
      [conflict.incoming_id]:
        action === ""
          ? undefined
          : {
              action,
              name:
                action === "rename"
                  ? (current[conflict.incoming_id]?.name ??
                    `${conflict.name} (2)`)
                  : conflict.name,
            },
    }));
  };

  const rename = (conflict: TagImportConflict, name: string) => {
    setDecisions((current) => ({
      ...current,
      [conflict.incoming_id]: { action: "rename", name },
    }));
  };

  const apply = async () => {
    if (!ready) return;
    const choices: TagImportChoice[] = conflicts.map((conflict) => {
      const decision = decisions[conflict.incoming_id]!;
      return decision.action === "merge"
        ? { incoming_id: conflict.incoming_id, action: "merge" }
        : {
            incoming_id: conflict.incoming_id,
            action: "rename",
            name: decision.name.trim(),
          };
    });
    setBusy(true);
    setError(null);
    try {
      await onApply(choices, allowPaths);
      onClose();
    } catch (cause) {
      setError(errorText(t, cause, "tags"));
      setBusy(false);
    }
  };

  return (
    <Dialog title={t("tags.import")} onClose={onClose} className="adp-tag-import">
      <div className="adp-tag-import-body">
        {conflicts.length > 0 ? (
          <section className="adp-tag-conflicts">
            <h3 className="adp-tag-conflicts-title">
              {t("tags.importConflicts")}
            </h3>
            <ul className="adp-tag-conflict-list">
              {conflicts.map((conflict) => {
                const decision = decisions[conflict.incoming_id];
                return (
                  <li key={conflict.incoming_id} className="adp-tag-conflict">
                    <span className="adp-tag-conflict-name">
                      {conflict.name}
                    </span>
                    <select
                      className="adp-select"
                      value={decision?.action ?? ""}
                      aria-label={conflict.name}
                      onChange={(event) =>
                        choose(
                          conflict,
                          event.target.value as "" | "merge" | "rename",
                        )
                      }
                    >
                      <option value="" disabled>
                        {t("tags.importChoose")}
                      </option>
                      <option value="merge">{t("tags.importMerge")}</option>
                      <option value="rename">{t("tags.importKeep")}</option>
                    </select>
                    {decision?.action === "rename" ? (
                      <TextInput
                        value={decision.name}
                        onChange={(value) => rename(conflict, value)}
                        placeholder={t("tags.importNewName")}
                        ariaLabel={t("tags.importNewName")}
                        maxLength={60}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {preview.contains_paths ? (
          <div className="adp-tag-import-paths">
            <label className="adp-tag-import-check">
              <input
                type="checkbox"
                checked={allowPaths}
                onChange={(event) => setAllowPaths(event.target.checked)}
              />
              <span>{t("tags.personal")}</span>
            </label>
            <p className="adp-tag-hint">{t("tags.personalWarning")}</p>
          </div>
        ) : null}
        {error ? (
          <p className="adp-tag-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="adp-dialog-actions">
        <HelpButton onOpenHelp={onOpenHelp} />
        <span className="adp-dialog-actions-spacer" />
        <Button onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="primary"
          onClick={() => void apply()}
          disabled={busy || !ready}
        >
          {t("tags.importAction")}
        </Button>
      </div>
    </Dialog>
  );
}
