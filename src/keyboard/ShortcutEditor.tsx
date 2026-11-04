import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Switch from "../components/Switch";
import { validateKeyboardMap } from "../services/keyboardMaps";
import { errorText } from "../services/errors";
import { formatShortcut } from "../services/shortcuts";
import { findShortcutConflicts } from "./effectiveShortcuts";
import { keyboardPreset, KEYBOARD_PRESET_IDS, type KeyboardPresetId } from "./presets";
import ShortcutCapture from "./ShortcutCapture";
import { strokeToText } from "./shortcutNormalization";
import {
  SHORTCUT_SCOPES,
  deterministicBindingId,
  isBuiltinMapId,
  type KeyboardMap,
  type ShortcutBinding,
  type ShortcutConflict,
  type ShortcutScope,
  type StrokeMode,
} from "./types";

export interface ShortcutEditorProps {
  map: KeyboardMap;
  /** Registered command defaults (Windows preset), so choosing or resetting
   * a style does not build on top of unsaved edits. Optional for callers
   * that only have the active map. */
  defaults?: readonly ShortcutBinding[];
  /** Localized command labels by command id, from the live registry. */
  labels?: Readonly<Record<string, string>>;
  onApply: (map: KeyboardMap) => Promise<void>;
  onCancel: () => void;
  onOpenHelp: () => void;
}

const SCOPE_LABEL_KEYS: Readonly<Record<ShortcutScope, string>> = {
  global: "keyboard.scopeGlobal",
  explorer: "keyboard.scopeExplorer",
  search: "keyboard.scopeSearch",
  text: "keyboard.scopeText",
  image: "keyboard.scopeImage",
  pdf: "keyboard.scopePdf",
  media: "keyboard.scopeMedia",
  office: "keyboard.scopeOffice",
  dialog: "keyboard.scopeDialog",
};

const PRESET_LABEL_KEYS: Readonly<Record<KeyboardPresetId, string>> = {
  windows: "keyboard.windows",
  finder: "keyboard.finder",
  commander: "keyboard.commander",
  vim: "keyboard.vim",
};

function cloneMap(map: KeyboardMap): KeyboardMap {
  return {
    ...map,
    bindings: map.bindings.map(cloneBinding),
  };
}

function cloneBinding(binding: ShortcutBinding): ShortcutBinding {
  return { ...binding, strokes: binding.strokes.map((stroke) => ({ ...stroke })) };
}

function presetForMapId(mapId: string): KeyboardPresetId | null {
  const match = /^builtin:(windows|finder|commander|vim)$/.exec(mapId);
  return match ? (match[1] as KeyboardPresetId) : null;
}

function newCustomId(seed: string): string {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") return cryptoRef.randomUUID();
  return deterministicBindingId(seed);
}

/** Settings > Keyboard shortcuts (Step 10b E5, D7-D9). Editing a builtin
 * preset makes a custom copy; conflicts must be reassigned or cancelled,
 * never silently shadowed. */
export default function ShortcutEditor({ map, defaults, labels, onApply, onCancel, onOpenHelp }: ShortcutEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<KeyboardMap>(() => cloneMap(map));
  const [selectedId, setSelectedId] = useState<string>("");
  const [mode, setMode] = useState<StrokeMode>("key");
  const [secondStroke, setSecondStroke] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const baseBindings = defaults ?? map.bindings;

  const selected = draft.bindings.find((binding) => binding.id === selectedId) ?? null;
  const conflicts = useMemo(
    () => (selected ? findShortcutConflicts(selected, draft) : []),
    [selected, draft],
  );
  const conflict = conflicts[0] ?? null;
  // Apply stays blocked until every binding is conflict-free, not only the
  // selected one. Disabled bindings can still own a reserved chord.
  const unresolved = useMemo(() => {
    for (const binding of draft.bindings) {
      const first = findShortcutConflicts(binding, draft)[0];
      if (first) return { binding, conflict: first };
    }
    return null;
  }, [draft]);

  const mutate = (next: KeyboardMap) => {
    setDraft(isBuiltinMapId(next.id) ? { ...next, id: newCustomId(`custom:${next.id}:${next.bindings.length}`) } : next);
  };

  const updateBinding = (updated: ShortcutBinding) => {
    mutate({ ...draft, bindings: draft.bindings.map((b) => (b.id === updated.id ? updated : b)) });
  };

  const onPreset = (id: KeyboardPresetId) => {
    // Choosing a style while a builtin is active switches to that preset;
    // a custom map keeps its id and name and receives the preset bindings.
    const preset = keyboardPreset(id, baseBindings);
    setDraft(isBuiltinMapId(draft.id) ? preset : { ...preset, id: draft.id, name: draft.name });
    setSelectedId("");
    setSecondStroke(false);
  };

  const removeConflicting = (bindingId: string, found: ShortcutConflict) => {
    if (found.existing_binding_id === bindingId) return;
    mutate({
      ...draft,
      bindings: draft.bindings.filter((binding) => binding.id !== found.existing_binding_id),
    });
  };

  const onReassign = () => {
    if (!conflict || !selected) return;
    removeConflicting(selected.id, conflict);
  };

  const onReset = () => {
    // Reset restores the selected style's defaults and leaves every other
    // setting and map untouched (D9).
    const preset = keyboardPreset(presetForMapId(draft.id) ?? "windows", baseBindings);
    const bindings = isBuiltinMapId(draft.id) ? preset.bindings : baseBindings;
    setDraft({ ...draft, bindings: bindings.map(cloneBinding) });
    setSelectedId("");
    setSecondStroke(false);
  };

  const onApplyClick = async () => {
    setSaving(true);
    setError("");
    try {
      const validated = validateKeyboardMap(draft);
      await onApply(validated);
    } catch (err) {
      setError(errorText(t, err, "keyboard"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="adp-shortcut-editor" aria-label={t("keyboard.title")}>
      <div className="adp-shortcut-editor-head">
        <h2>{t("keyboard.title")}</h2>
        <Button variant="subtle" onClick={onOpenHelp} aria-label={t("help.title")}>
          ?
        </Button>
      </div>
      <div className="adp-shortcut-editor-presets" role="group" aria-label={t("keyboard.style")}>
        {KEYBOARD_PRESET_IDS.map((id) => (
          <Button key={id} onClick={() => onPreset(id)}>
            {t(PRESET_LABEL_KEYS[id])}
          </Button>
        ))}
      </div>
      <ul className="adp-shortcut-editor-list">
        {draft.bindings.map((binding) => (
          <li key={binding.id}>
            <button
              type="button"
              aria-pressed={selectedId === binding.id}
              onClick={() => setSelectedId(binding.id)}
            >
              <span>{labels?.[binding.command_id] ?? binding.command_id}</span>
              <span>
                {binding.strokes.map((stroke) => formatShortcut(strokeToText(stroke), t)).join(", ")}
              </span>
              <span>{t(SCOPE_LABEL_KEYS[binding.scope])}</span>
            </button>
            <Switch
              checked={binding.enabled}
              onChange={(checked) => updateBinding({ ...binding, enabled: checked })}
              label={labels?.[binding.command_id] ?? binding.command_id}
            />
          </li>
        ))}
      </ul>
      {selected ? (
        <div className="adp-shortcut-editor-detail">
          <label>
            <span>{t("keyboard.scope")}</span>
            <select
              value={selected.scope}
              onChange={(event) => updateBinding({ ...selected, scope: event.target.value as ShortcutScope })}
            >
              {SHORTCUT_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {t(SCOPE_LABEL_KEYS[scope])}
                </option>
              ))}
            </select>
          </label>
          <div role="group" aria-label={t("keyboard.capture")}>
            <Button aria-pressed={mode === "code"} onClick={() => setMode("code")}>
              {t("keyboard.physical")}
            </Button>
            <Button aria-pressed={mode === "key"} onClick={() => setMode("key")}>
              {t("keyboard.logical")}
            </Button>
          </div>
          <ShortcutCapture
            mode={mode}
            onCancel={() => setSecondStroke(false)}
            onCapture={(stroke) => {
              updateBinding({
                ...selected,
                strokes: secondStroke ? [selected.strokes[0], stroke] : [stroke],
              });
              setSecondStroke(false);
            }}
          />
          <Button onClick={() => setSecondStroke(true)} disabled={secondStroke}>
            {secondStroke ? t("keyboard.sequence") : t("keyboard.capture")}
          </Button>
          {conflict ? (
            <div className="adp-shortcut-conflict" role="alert">
              <span>{t("keyboard.conflict", { command: labels?.[conflict.command_id] ?? conflict.command_id })}</span>
              {conflict.kind === "reserved" ? <span>{t("keyboard.reserved")}</span> : null}
              {conflict.kind !== "reserved" ? <Button onClick={onReassign}>{t("keyboard.reassign")}</Button> : null}
            </div>
          ) : unresolved ? (
            <div className="adp-shortcut-conflict" role="alert">
              <span>{t("keyboard.conflict", { command: labels?.[unresolved.conflict.command_id] ?? unresolved.conflict.command_id })}</span>
              {unresolved.conflict.kind === "reserved" ? (
                <span>{t("keyboard.reserved")}</span>
              ) : (
                <Button onClick={() => removeConflicting(unresolved.binding.id, unresolved.conflict)}>
                  {t("keyboard.reassign")}
                </Button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="adp-shortcut-editor-error">
          {error}
        </p>
      ) : null}
      <div className="adp-shortcut-editor-footer">
        <Button onClick={onReset}>{t("shellCustom.reset")}</Button>
        <Button variant="primary" onClick={() => void onApplyClick()} disabled={saving || unresolved !== null}>
          {t("common.apply")}
        </Button>
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
      </div>
    </section>
  );
}
