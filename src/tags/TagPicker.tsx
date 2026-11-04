import { Circle, Flag, Star, Tag as TagIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import TextInput from "../components/TextInput";
import { errorText } from "../services/errors";
import type { Tag, TagCatalog } from "../services/tags";

export interface TagPickerProps {
  catalog: TagCatalog;
  /** The tag ids the selection carries now. */
  value: readonly string[];
  /** Add and remove the differences; the caller writes one batch. */
  onApply: (add: string[], remove: string[]) => Promise<void>;
  onClose: () => void;
  onOpenHelp: () => void;
}

const TAG_ICONS = {
  tag: TagIcon,
  dot: Circle,
  star: Star,
  flag: Flag,
} as const;

/** Pick tags for the current selection (Step 11b E7). 480 px wide, 36 px
 * rows, every color accompanied by its name and an icon shape. */
export default function TagPicker({
  catalog,
  value,
  onApply,
  onClose,
  onOpenHelp,
}: TagPickerProps) {
  const { t } = useTranslation();
  const filterRef = useRef<HTMLInputElement | null>(null);
  const initial = useMemo(() => new Set(value), [value]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(value));
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keyboard first: focus the filter, keep Tab inside the dialog, and put
  // focus back where the command was invoked when the picker closes.
  useEffect(() => {
    const origin =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    filterRef.current?.focus();
    const dialog = filterRef.current?.closest<HTMLElement>("[role=dialog]");
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

  const needle = filter.trim().toLowerCase();
  const tags = useMemo(
    () =>
      catalog.tags.filter(
        (tag) => !needle || tag.name.toLowerCase().includes(needle),
      ),
    [catalog.tags, needle],
  );

  const toggle = (id: string) => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const apply = async () => {
    const add = catalog.tags
      .filter((tag) => checked.has(tag.id) && !initial.has(tag.id))
      .map((tag) => tag.id);
    const remove = catalog.tags
      .filter((tag) => !checked.has(tag.id) && initial.has(tag.id))
      .map((tag) => tag.id);
    if (add.length === 0 && remove.length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onApply(add, remove);
      onClose();
    } catch (cause) {
      setError(errorText(t, cause, "tags"));
      setBusy(false);
    }
  };

  return (
    <Dialog title={t("tags.title")} onClose={onClose} className="adp-tag-picker">
      <div className="adp-tag-picker-body">
        <TextInput
          value={filter}
          onChange={setFilter}
          placeholder={t("tags.filter")}
          ariaLabel={t("tags.filter")}
          inputRef={filterRef}
        />
        {tags.length === 0 ? (
          <p className="adp-tag-empty">{t("tags.empty")}</p>
        ) : (
          <ul className="adp-tag-list" aria-label={t("tags.title")}>
            {tags.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                checked={checked.has(tag.id)}
                onToggle={() => toggle(tag.id)}
              />
            ))}
          </ul>
        )}
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
        <Button variant="primary" onClick={() => void apply()} disabled={busy}>
          {t("tags.apply")}
        </Button>
      </div>
    </Dialog>
  );
}

function TagRow({
  tag,
  checked,
  onToggle,
}: {
  tag: Tag;
  checked: boolean;
  onToggle: () => void;
}) {
  const Icon = TAG_ICONS[tag.icon_id as keyof typeof TAG_ICONS] ?? TagIcon;
  return (
    <li className="adp-tag-row">
      <label className="adp-tag-row-label">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span
          className="adp-tag-swatch"
          style={{ backgroundColor: tag.color }}
          aria-hidden="true"
        />
        <Icon size={16} aria-hidden="true" className="adp-tag-icon" />
        <span className="adp-tag-name">{tag.name}</span>
      </label>
    </li>
  );
}
