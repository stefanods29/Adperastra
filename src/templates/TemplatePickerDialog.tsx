import { useCallback, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../components/Dialog";
import Skeleton from "../components/Skeleton";
import { displayPath } from "../services/explorer";
import { emptyTemplateList, templatesList, templatesPickFolder, type TemplateList } from "../services/templates";
import { fileTile } from "../views/explorer/fileTile";
import { BUILTIN_TEMPLATES, templateFileName } from "./catalog";

/** The template window (Step 06c): built-in templates in the app's
 * language plus the files of the user's own templates folder. */

export interface TemplatePickerDialogProps {
  /** The app language: `en` and `es` have their own template files. */
  lang: string;
  /** Create the chosen template under this file name. */
  onCreate: (templatePath: string, name: string) => void;
  onFolderChange: (folder: string) => void;
  onOpenFolder: (folder: string) => void;
  onClose: () => void;
}

interface TemplateOption {
  path: string;
  /** The new file's name, already translated for the built-in ones. */
  name: string;
  /** The file the tile comes from. */
  file: string;
  /** The built-in templates' one-line description. */
  descriptionKey: string | null;
}

function TemplateTile({ name }: { name: string }) {
  const { icon: Icon, tone } = fileTile(name, "file");
  return (
    <span className={`adp-templates-tile adp-templates-tile--${tone}`}>
      <Icon size={16} aria-hidden="true" />
    </span>
  );
}

export default function TemplatePickerDialog({
  lang,
  onCreate,
  onFolderChange,
  onOpenFolder,
  onClose,
}: TemplatePickerDialogProps) {
  const { t } = useTranslation();
  const [list, setList] = useState<TemplateList | null>(null);
  const [slow, setSlow] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setList(await templatesList(lang));
    } catch {
      setList(emptyTemplateList());
    }
  }, [lang]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Anything not ready within 0.1 s shows a skeleton (R-UI-2).
  useEffect(() => {
    if (list !== null) return;
    const timer = window.setTimeout(() => setSlow(true), 100);
    return () => window.clearTimeout(timer);
  }, [list]);

  const builtinOptions = useMemo<TemplateOption[]>(() => {
    if (list === null) return [];
    return BUILTIN_TEMPLATES.flatMap((template) => {
      const file = list.builtin.find((entry) => entry.id === template.id);
      if (!file) return [];
      return [
        {
          path: file.path,
          name: templateFileName(t(template.nameKey), template.file),
          file: template.file,
          descriptionKey: template.descriptionKey,
        },
      ];
    });
  }, [list, t]);

  const userOptions = useMemo<TemplateOption[]>(
    () =>
      (list?.user ?? []).map((entry) => ({
        path: entry.path,
        name: entry.name,
        file: entry.name,
        descriptionKey: null,
      })),
    [list],
  );

  // One selection across both lists; the first built-in starts selected.
  const effective =
    [...builtinOptions, ...userOptions].find((option) => option.path === selectedPath) ??
    builtinOptions[0] ??
    userOptions[0] ??
    null;

  const create = (option: TemplateOption | null = effective) => {
    if (!option) return;
    onCreate(option.path, option.name);
    onClose();
  };

  const onListKey = (event: ReactKeyboardEvent<HTMLUListElement>, options: TemplateOption[]) => {
    if (event.key === "Enter") {
      event.preventDefault();
      create();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (options.length === 0) return;
    const current = options.findIndex((option) => option.path === effective?.path);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const index = Math.max(0, Math.min(options.length - 1, current + delta));
    setSelectedPath(options[index].path);
    const listElement = event.currentTarget;
    window.setTimeout(() => {
      listElement.querySelectorAll<HTMLElement>('[role="option"]')[index]?.focus();
    }, 0);
  };

  const chooseFolder = async () => {
    const picked = await templatesPickFolder(t("templates.folderTitle")).catch(() => null);
    if (!picked) return;
    onFolderChange(picked);
    await refresh();
  };

  const folder = list?.user_folder ?? "";
  const folderMissing = list?.user_folder_missing ?? false;

  const notes = list === null ? null : folder === "" ? (
    <p className="adp-dialog-note">{t("templates.mineEmpty")}</p>
  ) : folderMissing ? (
    <p className="adp-dialog-note">{t("templates.mineMissing", { folder: displayPath(folder) })}</p>
  ) : userOptions.length === 0 ? (
    <p className="adp-dialog-note">{t("templates.mineNone", { folder: displayPath(folder) })}</p>
  ) : null;

  return (
    <Dialog title={t("templates.title")} onClose={onClose} className="adp-templates-dialog">
      {list === null ? (
        slow ? <Skeleton variant="rows" count={3} /> : null
      ) : (
        <>
          <div className="adp-templates-section">
            <h3 className="adp-heading">{t("templates.builtin")}</h3>
            <ul
              className="adp-templates-list"
              role="listbox"
              aria-label={t("templates.builtin")}
              onKeyDown={(event) => onListKey(event, builtinOptions)}
            >
              {builtinOptions.map((option) => (
                <li
                  key={option.path}
                  className="adp-templates-row"
                  role="option"
                  tabIndex={0}
                  aria-selected={effective?.path === option.path}
                  onClick={() => setSelectedPath(option.path)}
                  onDoubleClick={() => create(option)}
                >
                  <TemplateTile name={option.file} />
                  <span className="adp-templates-text">
                    <span className="adp-templates-name">{option.name}</span>
                    {option.descriptionKey ? (
                      <span className="adp-templates-description">{t(option.descriptionKey)}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="adp-templates-section">
            <h3 className="adp-heading">{t("templates.mine")}</h3>
            {userOptions.length > 0 ? (
              <ul
                className="adp-templates-list"
                role="listbox"
                aria-label={t("templates.mine")}
                onKeyDown={(event) => onListKey(event, userOptions)}
              >
                {userOptions.map((option) => (
                  <li
                    key={option.path}
                    className="adp-templates-row"
                    role="option"
                    tabIndex={0}
                    aria-selected={effective?.path === option.path}
                    onClick={() => setSelectedPath(option.path)}
                    onDoubleClick={() => create(option)}
                  >
                    <TemplateTile name={option.file} />
                    <span className="adp-templates-text">
                      <span className="adp-templates-name">{option.name}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              notes
            )}
          </div>
        </>
      )}
      <div className="adp-dialog-actions">
        <button type="button" className="adp-btn" onClick={() => void chooseFolder()}>
          {folder === "" ? t("templates.chooseFolder") : t("templates.changeFolder")}
        </button>
        {folder !== "" && !folderMissing ? (
          <button type="button" className="adp-btn" onClick={() => onOpenFolder(folder)}>
            {t("templates.openFolder")}
          </button>
        ) : null}
        <span className="adp-cmd-spacer" />
        <button type="button" className="adp-btn" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" className="adp-btn adp-btn--primary" disabled={effective === null} onClick={() => create()}>
          {t("templates.create")}
        </button>
      </div>
    </Dialog>
  );
}
