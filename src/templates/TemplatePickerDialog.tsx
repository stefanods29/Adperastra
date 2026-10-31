import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../components/Dialog";
import ProgressBar from "../components/ProgressBar";
import Skeleton from "../components/Skeleton";
import { errorText } from "../services/errors";
import { displayPath } from "../services/explorer";
import type { OpProgress } from "../services/fileops";
import { formatSize } from "../services/format";
import { templatesList, templatesPickFolder, type TemplateCreateOptions, type TemplateList } from "../services/templates";
import { fileTile } from "../views/explorer/fileTile";
import { BUILTIN_TEMPLATES, templateFileName } from "./catalog";

/** The template window (Step 06c): built-in templates in the app's
 * language plus the files of the user's own templates folder. */

export interface TemplatePickerDialogProps {
  /** The app language: `en` and `es` have their own template files. */
  lang: string;
  /** Create the chosen template under this file name. */
  onCreate: (templatePath: string, name: string, options?: TemplateCreateOptions) => void | Promise<void>;
  onFolderChange: (folder: string) => void | Promise<void>;
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
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [creatingName, setCreatingName] = useState<string | null>(null);
  const [progress, setProgress] = useState<OpProgress | null>(null);
  const mounted = useRef(true);
  const refreshRequest = useRef(0);
  const folderPending = useRef(false);
  const creation = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      refreshRequest.current += 1;
      creation.current?.abort();
    };
  }, []);

  const refresh = useCallback(async () => {
    const request = ++refreshRequest.current;
    setLoading(true);
    setSlow(false);
    setError("");
    setList(null);
    try {
      const next = await templatesList(lang);
      if (mounted.current && request === refreshRequest.current) setList(next);
    } catch (failure) {
      if (mounted.current && request === refreshRequest.current) setError(errorText(t, failure, "templates"));
    } finally {
      if (mounted.current && request === refreshRequest.current) setLoading(false);
    }
  }, [lang, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Anything not ready within 0.1 s shows a skeleton (R-UI-2).
  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setSlow(true), 100);
    return () => window.clearTimeout(timer);
  }, [loading]);

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

  const busy = creatingName !== null;
  const create = async (option: TemplateOption | null = effective) => {
    if (!option || creation.current || folderPending.current || loading) return;
    const controller = new AbortController();
    creation.current = controller;
    setCreatingName(option.name);
    setProgress(null);
    setError("");
    try {
      await onCreate(option.path, option.name, {
        signal: controller.signal,
        onProgress: (next) => {
          if (mounted.current && creation.current === controller) setProgress(next);
        },
      });
      if (mounted.current) onClose();
    } catch (failure) {
      if (mounted.current) setError(errorText(t, failure, "templates"));
    } finally {
      creation.current = null;
      if (mounted.current) {
        setCreatingName(null);
        setProgress(null);
      }
    }
  };

  const onListKey = (event: ReactKeyboardEvent<HTMLUListElement>, options: TemplateOption[]) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void create();
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
    listElement.querySelectorAll<HTMLElement>('[role="option"]')[index]?.focus();
  };

  const chooseFolder = async () => {
    if (folderPending.current || creation.current) return;
    folderPending.current = true;
    setChoosingFolder(true);
    setError("");
    try {
      const picked = await templatesPickFolder(t("templates.folderTitle"));
      if (!picked || !mounted.current) return;
      await onFolderChange(picked);
      if (mounted.current) await refresh();
    } catch (failure) {
      if (mounted.current) setError(errorText(t, failure, "templates"));
    } finally {
      folderPending.current = false;
      if (mounted.current) setChoosingFolder(false);
    }
  };

  const close = () => {
    if (creation.current) creation.current.abort();
    else onClose();
  };

  const folder = list?.user_folder ?? "";
  const folderMissing = list?.user_folder_missing ?? false;
  const userError = list?.user_error ?? null;
  const userSkipped = list?.user_skipped ?? 0;

  const notes = list === null ? null : folder === "" ? (
    <p className="adp-dialog-note">{t("templates.mineEmpty")}</p>
  ) : folderMissing ? (
    <p className="adp-dialog-note">{t("templates.mineMissing", { folder: displayPath(folder) })}</p>
  ) : userOptions.length === 0 && !userError && userSkipped === 0 ? (
    <p className="adp-dialog-note">{t("templates.mineNone", { folder: displayPath(folder) })}</p>
  ) : null;

  return (
    <Dialog title={t("templates.title")} onClose={close} className="adp-templates-dialog">
      {error ? <p className="adp-dialog-note" role="alert">{error}</p> : null}
      {list === null ? (
        loading && slow ? <Skeleton variant="rows" count={3} /> : null
      ) : (
        <>
          <div className="adp-templates-section">
            <h3 className="adp-heading">{t("templates.builtin")}</h3>
            <ul
              className="adp-templates-list"
              role="listbox"
              aria-label={t("templates.builtin")}
              aria-disabled={busy}
              onKeyDown={(event) => onListKey(event, builtinOptions)}
            >
              {builtinOptions.map((option) => (
                <li
                  key={option.path}
                  className="adp-templates-row"
                  role="option"
                  tabIndex={busy ? -1 : 0}
                  aria-selected={effective?.path === option.path}
                  onFocus={() => { if (!busy) setSelectedPath(option.path); }}
                  onClick={() => { if (!busy) setSelectedPath(option.path); }}
                  onDoubleClick={() => void create(option)}
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
            {userError ? <p className="adp-dialog-note" role="alert">{errorText(t, userError, "templates")}</p> : null}
            {userSkipped > 0 ? <p className="adp-dialog-note" role="status">{t("templates.someUnreadable", { count: userSkipped })}</p> : null}
            {userOptions.length > 0 ? (
              <ul
                className="adp-templates-list"
                role="listbox"
                aria-label={t("templates.mine")}
                aria-disabled={busy}
                onKeyDown={(event) => onListKey(event, userOptions)}
              >
                {userOptions.map((option) => (
                  <li
                    key={option.path}
                    className="adp-templates-row"
                    role="option"
                    tabIndex={busy ? -1 : 0}
                    aria-selected={effective?.path === option.path}
                    onFocus={() => { if (!busy) setSelectedPath(option.path); }}
                    onClick={() => { if (!busy) setSelectedPath(option.path); }}
                    onDoubleClick={() => void create(option)}
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
      {creatingName !== null ? (
        <div role="status" aria-live="polite">
          <p className="adp-dialog-note">{t("templates.creating", { name: creatingName })}</p>
          <ProgressBar
            value={progress && progress.bytes_total > 0 ? (100 * progress.bytes_done) / progress.bytes_total : undefined}
            label={t("templates.creating", { name: creatingName })}
          />
          {progress ? <p className="adp-dialog-note">{t("templates.copyProgress", {
            done: formatSize(progress.bytes_done, lang),
            total: formatSize(progress.bytes_total, lang),
          })}</p> : null}
        </div>
      ) : null}
      <div className="adp-dialog-actions">
        <button type="button" className="adp-btn" disabled={busy || choosingFolder} onClick={() => void chooseFolder()}>
          {folder === "" ? t("templates.chooseFolder") : t("templates.changeFolder")}
        </button>
        {folder !== "" && !folderMissing ? (
          <button type="button" className="adp-btn" disabled={busy || choosingFolder} onClick={() => onOpenFolder(folder)}>
            {t("templates.openFolder")}
          </button>
        ) : null}
        <span className="adp-cmd-spacer" />
        <button type="button" className="adp-btn" onClick={close}>
          {t("common.cancel")}
        </button>
        <button type="button" className="adp-btn adp-btn--primary" disabled={effective === null || busy || choosingFolder || loading} onClick={() => void create()}>
          {t("templates.create")}
        </button>
      </div>
    </Dialog>
  );
}
