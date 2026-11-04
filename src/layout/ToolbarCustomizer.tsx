import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Switch from "../components/Switch";
import {
  CLASSIC_MENU_BAR_ID,
  DEFAULT_QUICK_ACCESS,
  QUICK_ACCESS_BAR_ID,
  validateToolbarCustomSettings,
  type CommandLayoutEntry,
  type ToolbarCustomSettings,
  type ToolbarDescriptor,
} from "../services/commandLayout";
import { errorText } from "../services/errors";
import {
  addEntry,
  addQuickAccess,
  entriesForBar,
  moveEntry,
  quickAccessEntries,
  removeEntry,
  setEntryVisible,
  withBarEntries,
} from "./toolbarCustomization";

export interface ToolbarCustomizerProps {
  descriptors: readonly ToolbarDescriptor[];
  value: ToolbarCustomSettings;
  /** Localized command labels by command id, from the live registry.
   * Unknown ids fall back to the id so they stay editable (D1). */
  labels?: Readonly<Record<string, string>>;
  onApply: (value: ToolbarCustomSettings) => Promise<void>;
  onCancel: () => void;
  onOpenHelp: () => void;
}

const entryKey = (entry: CommandLayoutEntry) => `${entry.kind}:${entry.id}`;

function cloneSettings(value: ToolbarCustomSettings): ToolbarCustomSettings {
  return {
    classic_menu: value.classic_menu,
    quick_access: [...value.quick_access],
    bars: value.bars.map((bar) => ({ bar_id: bar.bar_id, entries: bar.entries.map((entry) => ({ ...entry })) })),
  };
}

/** Settings > Customize toolbars (Step 10b E5, D4). Draft edits show in a
 * live preview that never runs a command; Apply is one history entry and
 * Cancel leaves the saved layout untouched. */
export default function ToolbarCustomizer({ descriptors, value, labels, onApply, onCancel, onOpenHelp }: ToolbarCustomizerProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ToolbarCustomSettings>(() => cloneSettings(value));
  const [barId, setBarId] = useState<string>(descriptors[0]?.id ?? "");
  const [selected, setSelected] = useState<string>("");
  const [availableSelected, setAvailableSelected] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const descriptor = descriptors.find((entry) => entry.id === barId) ?? descriptors[0];
  const isQuickAccess = descriptor?.id === QUICK_ACCESS_BAR_ID;
  const current = useMemo(() => {
    if (!descriptor) return [] as CommandLayoutEntry[];
    return isQuickAccess ? quickAccessEntries(draft) : entriesForBar(draft, descriptor);
  }, [descriptor, draft, isQuickAccess]);
  // A Quick Access descriptor may omit defaults (the registry supplies
  // them at startup); the settings default is the safe fallback.
  const availableSource = useMemo(() => {
    if (!descriptor) return [] as CommandLayoutEntry[];
    if (isQuickAccess && descriptor.default_entries.length === 0) {
      return DEFAULT_QUICK_ACCESS.map((id): CommandLayoutEntry => ({ kind: "command", id, visible: true }));
    }
    return descriptor.default_entries;
  }, [descriptor, isQuickAccess]);
  const available = useMemo(() => {
    if (!descriptor) return [] as CommandLayoutEntry[];
    const inCurrent = new Set(current.map(entryKey));
    return availableSource.filter((entry) => !inCurrent.has(entryKey(entry)));
  }, [descriptor, current, availableSource]);

  if (!descriptor) return null;

  const writeEntries = (entries: readonly CommandLayoutEntry[]) => {
    if (isQuickAccess) {
      setDraft({ ...draft, quick_access: entries.filter((e) => e.kind === "command").map((e) => e.id) });
    } else {
      setDraft(withBarEntries(draft, descriptor.id, entries));
    }
  };

  const onResetBar = () => {
    if (isQuickAccess) {
      setDraft({ ...draft, quick_access: [...DEFAULT_QUICK_ACCESS] });
      return;
    }
    // Removing the saved bar restores the registered defaults without
    // storing a duplicate of them.
    setDraft({ ...draft, bars: draft.bars.filter((bar) => bar.bar_id !== descriptor.id) });
  };

  const selectedEntry = current.find((entry) => entryKey(entry) === selected);
  const mandatory = selectedEntry ? descriptor.mandatory_ids.includes(selectedEntry.id) : false;

  const onAdd = () => {
    const entry = available.find((candidate) => entryKey(candidate) === availableSelected);
    if (!entry) return;
    if (isQuickAccess) {
      // Quick Access holds registered commands only, never a custom
      // control or a separator.
      if (entry.kind !== "command") return;
      const next = addQuickAccess(draft, entry.id);
      if (next) setDraft(next);
      return;
    }
    const next = addEntry(current, entry);
    if (next) writeEntries(next);
  };

  const onApplyClick = async () => {
    setSaving(true);
    setError("");
    try {
      validateToolbarCustomSettings(draft);
      await onApply(cloneSettings(draft));
    } catch (err) {
      // A failed save keeps the draft on screen (T5).
      setError(errorText(t, err, "toolbar"));
    } finally {
      setSaving(false);
    }
  };

  const labelFor = (entry: CommandLayoutEntry) =>
    entry.kind === "separator" ? "—" : (labels?.[entry.id] ?? entry.id);

  return (
    <section className="adp-toolbar-customizer" aria-label={t("toolbarCustom.title")}>
      <div className="adp-toolbar-customizer-head">
        <h2>{t("toolbarCustom.title")}</h2>
        <Button variant="subtle" onClick={onOpenHelp} aria-label={t("help.title")}>
          ?
        </Button>
      </div>
      <label className="adp-toolbar-customizer-bar">
        <span>{t("toolbarCustom.current")}</span>
        <select
          value={descriptor.id}
          onChange={(event) => {
            setBarId(event.target.value);
            setSelected("");
            setAvailableSelected("");
          }}
        >
          {descriptors.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id === QUICK_ACCESS_BAR_ID ? t("toolbarCustom.quick") : entry.id}
            </option>
          ))}
        </select>
      </label>
      <Switch
        checked={draft.classic_menu}
        onChange={(checked) => setDraft({ ...cloneSettings(draft), classic_menu: checked })}
        label={t("toolbarCustom.classic")}
      />
      <div className="adp-toolbar-customizer-lists">
        <div className="adp-toolbar-customizer-list">
          <h3>{t("toolbarCustom.available")}</h3>
          <ul>
            {available.map((entry) => (
              <li key={entryKey(entry)}>
                <button
                  type="button"
                  aria-pressed={availableSelected === entryKey(entry)}
                  onClick={() => setAvailableSelected(entryKey(entry))}
                >
                  {labelFor(entry)}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="adp-toolbar-customizer-actions">
          <Button onClick={onAdd} disabled={!availableSelected}>
            {t("toolbarCustom.add")}
          </Button>
          <Button
            onClick={() => selectedEntry && writeEntries(removeEntry(current, descriptor, selectedEntry.kind, selectedEntry.id))}
            disabled={!selectedEntry || mandatory}
          >
            {t("toolbarCustom.remove")}
          </Button>
          <Button
            onClick={() => selectedEntry && writeEntries(moveEntry(current, selectedEntry.kind, selectedEntry.id, -1))}
            disabled={!selectedEntry}
          >
            {t("toolbarCustom.up")}
          </Button>
          <Button
            onClick={() => selectedEntry && writeEntries(moveEntry(current, selectedEntry.kind, selectedEntry.id, 1))}
            disabled={!selectedEntry}
          >
            {t("toolbarCustom.down")}
          </Button>
          <Button onClick={onResetBar}>{t("toolbarCustom.reset")}</Button>
        </div>
        <div className="adp-toolbar-customizer-list">
          <h3>{t("toolbarCustom.current")}</h3>
          <ul>
            {current.map((entry) => (
              <li key={entryKey(entry)}>
                <button
                  type="button"
                  aria-pressed={selected === entryKey(entry)}
                  onClick={() => setSelected(entryKey(entry))}
                >
                  {labelFor(entry)}
                </button>
                {isQuickAccess ? null : (
                  <Switch
                    checked={entry.visible}
                    onChange={(checked) => writeEntries(setEntryVisible(current, entry.kind, entry.id, checked))}
                    label={labelFor(entry)}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="adp-toolbar-customizer-preview" aria-label={t("toolbarCustom.current")}>
        {current
          .filter((entry) => entry.visible)
          .map((entry) => (
            <span key={entryKey(entry)} className="adp-toolbar-customizer-preview-item">
              {labelFor(entry)}
            </span>
          ))}
      </div>
      {error ? (
        <p role="alert" className="adp-toolbar-customizer-error">
          {error}
        </p>
      ) : null}
      <div className="adp-toolbar-customizer-footer">
        <Button variant="primary" onClick={() => void onApplyClick()} disabled={saving}>
          {t("common.save")}
        </Button>
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
      </div>
    </section>
  );
}

export { CLASSIC_MENU_BAR_ID };
