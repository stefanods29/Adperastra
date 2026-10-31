import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";

/** The question before unsaved changes are lost (Step 06a): one file or
 * several. Escape means Cancel. */
export interface UnsavedDialogProps {
  /** The names of the files with unsaved changes. */
  names: string[];
  onSave: () => void;
  onDontSave: () => void;
  onCancel: () => void;
}

export default function UnsavedDialog({ names, onSave, onDontSave, onCancel }: UnsavedDialogProps) {
  const { t } = useTranslation();
  const many = names.length > 1;
  return (
    <Dialog
      title={many ? t("editor.unsavedManyTitle") : t("editor.unsavedTitle", { name: names[0] ?? "" })}
      onClose={onCancel}
    >
      {many ? (
        <>
          <p className="adp-dialog-text">{t("editor.unsavedManyBody", { count: names.length })}</p>
          <ul>
            {names.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="adp-dialog-text">{t("editor.unsavedBody")}</p>
      )}
      <div className="adp-dialog-actions">
        <Button variant="primary" onClick={onSave}>
          {many ? t("editor.saveAll") : t("editor.save")}
        </Button>
        <Button onClick={onDontSave}>{t("editor.dontSave")}</Button>
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
      </div>
    </Dialog>
  );
}
