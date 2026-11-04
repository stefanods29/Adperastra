import { Circle, Flag, Star, Tag as TagIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import TextInput from "../components/TextInput";
import { errorText } from "../services/errors";
import {
  deleteTag,
  mergeTags,
  saveTag,
  subscribeTagCatalog,
  TAG_ICON_IDS,
  DEFAULT_TAG_COLORS,
  type Tag,
  type TagCatalog,
} from "../services/tags";

export interface TagManagerProps {
  catalog: TagCatalog;
  /** The catalog answer of a write; the caller keeps it. */
  onCatalogChange: (catalog: TagCatalog) => void;
  onImport: () => void;
  onExport: () => void;
  onClose: () => void;
  onOpenHelp: () => void;
}

const TAG_ICONS = {
  tag: TagIcon,
  dot: Circle,
  star: Star,
  flag: Flag,
} as const;

const MAX_NAME = 60;

function newTagId(): string {
  return globalThis.crypto.randomUUID();
}

/** The tag catalog window (Step 11b E7): create, rename, recolor, merge and
 * delete. Every write returns the new catalog; Undo lives in the shared
 * history, so this window never keeps a second stack. */
export default function TagManager({
  catalog,
  onCatalogChange,
  onImport,
  onExport,
  onClose,
  onOpenHelp,
}: TagManagerProps) {
  const { t } = useTranslation();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_TAG_COLORS[0]);
  const [iconId, setIconId] = useState<string>("tag");
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeTo, setMergeTo] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => catalog.tags.find((tag) => tag.id === selectedId) ?? null,
    [catalog.tags, selectedId],
  );

  useEffect(() => {
    if (selectedId && catalog.tags.some((tag) => tag.id === selectedId)) return;
    const first = catalog.tags[0]?.id ?? null;
    setSelectedId(first);
    if (first) selectForEdit(catalog.tags[0]);
    else startCreating();
    // The selection only resets when it stops existing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.tags, selectedId]);

  useEffect(() => {
    if (mergeFrom && !catalog.tags.some((tag) => tag.id === mergeFrom)) setMergeFrom("");
    if (mergeTo && !catalog.tags.some((tag) => tag.id === mergeTo)) setMergeTo("");
  }, [catalog.tags, mergeFrom, mergeTo]);

  useEffect(
    () => subscribeTagCatalog(onCatalogChange),
    [onCatalogChange],
  );

  // Keyboard first: focus the name field, keep Tab inside the dialog, and put
  // focus back where Manage tags was invoked when the window closes.
  useEffect(() => {
    const origin =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nameRef.current?.focus();
    const dialog = nameRef.current?.closest<HTMLElement>("[role=dialog]");
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex='0']",
      )].filter((element) => !element.hidden);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      if (origin?.isConnected) origin.focus();
    };
  }, []);

  useEffect(() => {
    if (creating) nameRef.current?.focus();
  }, [creating]);

  function selectForEdit(tag: Tag) {
    setCreating(false);
    setSelectedId(tag.id);
    setName(tag.name);
    setColor(tag.color);
    setIconId(tag.icon_id);
    setConfirmDelete(false);
  }

  function startCreating() {
    setCreating(true);
    setSelectedId(null);
    setName("");
    setColor(DEFAULT_TAG_COLORS[0]);
    setIconId("tag");
    setConfirmDelete(false);
    setError(null);
  }

  const save = async () => {
    if (!name.trim()) {
      setError(t("tags.invalidName"));
      return;
    }
    const base = creating
      ? {
          id: newTagId(),
          created_unix: 0,
          modified_unix: 0,
          revision: 0,
        }
      : selected;
    if (!base) return;
    setBusy(true);
    setError(null);
    try {
      const next = await saveTag(
        {
          id: base.id,
          name: name.trim(),
          color,
          icon_id: TAG_ICON_IDS.includes(iconId as (typeof TAG_ICON_IDS)[number])
            ? iconId
            : "tag",
          created_unix: base.created_unix,
          modified_unix: base.modified_unix,
          revision: base.revision,
        },
        catalog.revision,
      );
      onCatalogChange(next);
      setCreating(false);
      setSelectedId(base.id);
    } catch (cause) {
      setError(errorText(t, cause, "tags"));
    } finally {
      setBusy(false);
    }
  };

  const merge = async () => {
    if (!mergeFrom || !mergeTo || mergeFrom === mergeTo) return;
    setBusy(true);
    setError(null);
    try {
      const next = await mergeTags(mergeFrom, mergeTo, catalog.revision);
      onCatalogChange(next);
      setMergeFrom("");
      setMergeTo("");
      setSelectedId(mergeTo);
    } catch (cause) {
      setError(errorText(t, cause, "tags"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const next = await deleteTag(selected.id, catalog.revision);
      onCatalogChange(next);
      setConfirmDelete(false);
    } catch (cause) {
      setError(errorText(t, cause, "tags"));
    } finally {
      setBusy(false);
    }
  };

  const Icon = TAG_ICONS[iconId as keyof typeof TAG_ICONS] ?? TagIcon;

  return (
    <Dialog title={t("tags.manage")} onClose={onClose} className="adp-tag-manager">
      <div className="adp-tag-manager-body">
        <div className="adp-tag-manager-list">
          <ul className="adp-tag-list" aria-label={t("tags.manage")}>
            {catalog.tags.map((tag) => {
              const RowIcon =
                TAG_ICONS[tag.icon_id as keyof typeof TAG_ICONS] ?? TagIcon;
              return (
                <li
                  key={tag.id}
                  className={
                    tag.id === selectedId && !creating
                      ? "adp-tag-row adp-tag-row--selected"
                      : "adp-tag-row"
                  }
                >
                  <button
                    type="button"
                    className="adp-tag-row-select"
                    onClick={() => selectForEdit(tag)}
                    aria-pressed={tag.id === selectedId && !creating}
                  >
                    <span
                      className="adp-tag-swatch"
                      style={{ backgroundColor: tag.color }}
                      aria-hidden="true"
                    />
                    <RowIcon size={16} aria-hidden="true" className="adp-tag-icon" />
                    <span className="adp-tag-name">{tag.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Button onClick={startCreating} disabled={busy}>{t("tags.new")}</Button>
        </div>
        <div className="adp-tag-manager-form">
          <label className="adp-field">
            <span className="adp-field-label">{t("tags.name")}</span>
            <TextInput
              value={name}
              onChange={setName}
              maxLength={MAX_NAME}
              disabled={busy}
              inputRef={nameRef}
            />
          </label>
          <div className="adp-field">
            <span className="adp-field-label">{t("tags.color")}</span>
            <div className="adp-tag-colors">
              {DEFAULT_TAG_COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  className={
                    color.toLowerCase() === swatch.toLowerCase()
                      ? "adp-tag-color adp-tag-color--current"
                      : "adp-tag-color"
                  }
                  style={{ backgroundColor: swatch }}
                  aria-label={`${t("tags.color")} ${swatch}`}
                  aria-pressed={color.toLowerCase() === swatch.toLowerCase()}
                  onClick={() => setColor(swatch)}
                  disabled={busy}
                />
              ))}
              <input
                type="color"
                className="adp-tag-color-input"
                value={color.toLowerCase()}
                aria-label={t("tags.color")}
                onChange={(event) => setColor(event.target.value.toUpperCase())}
                disabled={busy}
              />
            </div>
          </div>
          <div className="adp-field">
            <span className="adp-field-label">{t("tags.icon")}</span>
            <div className="adp-tag-icons" role="radiogroup" aria-label={t("tags.icon")}>
              {TAG_ICON_IDS.map((id) => {
                const OptionIcon = TAG_ICONS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className={
                      iconId === id
                        ? "adp-tag-icon-choice adp-tag-icon-choice--current"
                        : "adp-tag-icon-choice"
                    }
                    role="radio"
                    aria-checked={iconId === id}
                    aria-label={t(`tags.icon_${id}`)}
                    onClick={() => setIconId(id)}
                    disabled={busy}
                  >
                    <OptionIcon size={18} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="adp-tag-preview">
            <span
              className="adp-tag-swatch"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            <Icon size={16} aria-hidden="true" />
            <span>{name || t("tags.preview")}</span>
          </div>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {creating ? t("tags.new") : t("common.save")}
          </Button>
          {selected && !creating ? (
            confirmDelete ? (
              <div className="adp-tag-confirm" role="alertdialog" aria-label={t("tags.delete")}>
                <p>{t("tags.deleteConfirm", { name: selected.name })}</p>
                <div className="adp-tag-confirm-actions">
                  <Button onClick={() => setConfirmDelete(false)} disabled={busy}>
                    {t("common.cancel")}
                  </Button>
                  <Button variant="primary" onClick={() => void remove()} disabled={busy}>
                    {t("tags.delete")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => setConfirmDelete(true)} disabled={busy}>
                {t("tags.delete")}
              </Button>
            )
          ) : null}
        </div>
      </div>
      <div className="adp-tag-manager-merge">
        <span className="adp-field-label">{t("tags.merge")}</span>
        <select
          className="adp-select"
          value={mergeFrom}
          aria-label={t("tags.mergeSource")}
          onChange={(event) => setMergeFrom(event.target.value)}
          disabled={busy}
        >
          <option value="">{t("tags.mergeSource")}</option>
          {catalog.tags.map((tag) => (
            <option key={tag.id} value={tag.id}>{tag.name}</option>
          ))}
        </select>
        <select
          className="adp-select"
          value={mergeTo}
          aria-label={t("tags.mergeTarget")}
          onChange={(event) => setMergeTo(event.target.value)}
          disabled={busy}
        >
          <option value="">{t("tags.mergeTarget")}</option>
          {catalog.tags.map((tag) => (
            <option key={tag.id} value={tag.id}>{tag.name}</option>
          ))}
        </select>
        <Button
          onClick={() => void merge()}
          disabled={busy || !mergeFrom || !mergeTo || mergeFrom === mergeTo}
        >
          {t("tags.merge")}
        </Button>
      </div>
      {error ? (
        <p className="adp-tag-error" role="alert">{error}</p>
      ) : null}
      <div className="adp-dialog-actions">
        <HelpButton onOpenHelp={onOpenHelp} />
        <Button onClick={onImport} disabled={busy}>{t("tags.import")}</Button>
        <Button onClick={onExport} disabled={busy}>{t("tags.export")}</Button>
        <span className="adp-dialog-actions-spacer" />
        <Button onClick={onClose} disabled={busy}>{t("common.close")}</Button>
      </div>
    </Dialog>
  );
}
