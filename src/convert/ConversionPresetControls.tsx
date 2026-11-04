import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import { errorText } from "../services/errors";
import {
  BUILTIN_PRESET_LABEL_KEYS, isBuiltinPreset, listConversionPresets,
  presetsForDisplay, removeConversionPreset, sanitizePresetOptions,
  saveConversionPreset, validateConversionPreset,
  type ConversionPreset, type PresetCatalog,
} from "../services/conversionPresets";
import type { ConverterId, ConvertOptions } from "./types";

export interface ConversionPresetControlsProps {
  converterId: ConverterId;
  options: ConvertOptions;
  pattern: string;
  compatible: (preset: ConversionPreset) => boolean;
  onApply: (preset: ConversionPreset) => void;
  onPatternChange: (pattern: string) => void;
  /** Parent pushes the previous catalog on the shared Undo stack. */
  onCatalogRemoved: (previous: PresetCatalog, next: PresetCatalog) => void;
  disabled?: boolean;
}

export default function ConversionPresetControls(props: ConversionPresetControlsProps) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<PresetCatalog>({ schema_version: 1, presets: [] });
  const [selected, setSelected] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    listConversionPresets().then(value => { if (alive) setCatalog(value); })
      .catch(reason => { if (alive) setError(errorText(t, reason, "convert")); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [t]);
  const presets = presetsForDisplay(catalog).filter(props.compatible);
  const chosen = presets.find(preset => preset.id === selected);
  const label = (preset: ConversionPreset) => BUILTIN_PRESET_LABEL_KEYS[preset.id]
    ? t(BUILTIN_PRESET_LABEL_KEYS[preset.id]) : preset.name;
  const save = async () => {
    const now = Math.floor(Date.now() / 1000);
    const preset: ConversionPreset = {
      id: crypto.randomUUID(), name: name.trim(), converter_id: props.converterId,
      options: sanitizePresetOptions(props.options), name_pattern: props.pattern,
      destination_mode: "source", version: 1, created_unix: now, modified_unix: now,
    };
    const invalid = validateConversionPreset(preset);
    if (invalid) { setError(errorText(t, invalid, "convert")); return; }
    setBusy(true); setError(null);
    try { setCatalog(await saveConversionPreset(preset)); setSelected(preset.id); setSaveOpen(false); }
    catch (reason) { setError(errorText(t, reason, "convert")); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!chosen || isBuiltinPreset(chosen.id)) return;
    setBusy(true); setError(null);
    try {
      const next = await removeConversionPreset(chosen.id);
      props.onCatalogRemoved(catalog, next); setCatalog(next); setSelected(""); setRemoveOpen(false);
    } catch (reason) { setError(errorText(t, reason, "convert")); }
    finally { setBusy(false); }
  };
  return <div className="adp-convert-presets" aria-busy={busy}>
    <label>{t("convert.preset")}
      <select value={chosen ? selected : ""} disabled={busy || props.disabled} onChange={event => {
        setSelected(event.target.value);
        const preset = presets.find(item => item.id === event.target.value);
        if (preset) props.onApply(preset);
      }}>
        <option value="">{t("convert.preset")}</option>
        {presets.map(preset => <option key={preset.id} value={preset.id}>{label(preset)}</option>)}
      </select>
    </label>
    <label>{t("convert.namePattern")}
      <input value={props.pattern} maxLength={128} disabled={busy || props.disabled}
        onChange={event => props.onPatternChange(event.target.value)} />
    </label>
    <p className="adp-note">{t("convert.patternHelp")}</p>
    <Button disabled={busy || props.disabled} onClick={() => { setName(""); setSaveOpen(true); }}>{t("convert.savePreset")}</Button>
    <Button disabled={busy || props.disabled || !chosen || isBuiltinPreset(chosen.id)} onClick={() => setRemoveOpen(true)}>{t("convert.removePreset")}</Button>
    {error && <p role="alert">{error}</p>}
    {saveOpen && <Dialog title={t("convert.savePreset")} className="adp-convert-preset-dialog" onClose={() => { if (!busy) setSaveOpen(false); }}>
      <label>{t("convert.presetName")}<input autoFocus value={name} maxLength={60} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <Button disabled={busy || !name.trim()} onClick={() => { void save(); }}>{t("convert.savePreset")}</Button>
    </Dialog>}
    {removeOpen && <Dialog title={t("convert.removePreset")} onClose={() => { if (!busy) setRemoveOpen(false); }}>
      <p>{chosen && label(chosen)}</p>
      <Button disabled={busy} onClick={() => { void remove(); }}>{t("convert.removePreset")}</Button>
    </Dialog>}
  </div>;
}
