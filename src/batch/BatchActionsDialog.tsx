import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import QuickConvertDialog from "../convert/QuickConvertDialog";
import type { ConversionInput, ConversionReport } from "../convert/types";
import PrivacyDialog from "../privacy/PrivacyDialog";
import {
  BUILTIN_CONVERSION_PRESETS,
  listConversionPresets,
  presetLabelKey,
  presetsForDisplay,
  type ConversionPreset,
} from "../services/conversionPresets";
import { errorText } from "../services/errors";

export interface BatchActionsDialogProps {
  inputs: readonly ConversionInput[];
  onClose: () => void;
  onCompleted: (report: ConversionReport) => void;
  onOpenHelp: (slug: string) => void;
}

/** Step 09e batch host. It never runs a converter or cleaner itself: the
 * existing Quick Convert and Privacy dialogs keep their loss and category
 * acknowledgements, cancellation and per-file results. */
export default function BatchActionsDialog({ inputs, onClose, onCompleted, onOpenHelp }: BatchActionsDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"choose" | "convert" | "privacy">("choose");
  const [presets, setPresets] = useState<readonly ConversionPreset[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    void listConversionPresets()
      .then((catalog) => { if (alive) setPresets(presetsForDisplay(catalog)); })
      .catch((reason) => {
        if (!alive) return;
        // Built-ins stay usable when the catalog command is unavailable;
        // the error explains why saved presets are missing.
        setError(reason);
        setPresets([...BUILTIN_CONVERSION_PRESETS]);
      });
    return () => { alive = false; };
  }, []);

  const chosen = presets.find((preset) => preset.id === selected) ?? null;
  if (mode === "convert" && chosen) {
    return <QuickConvertDialog key={chosen.id} inputs={inputs} initialPreset={chosen} onClose={onClose} onCompleted={onCompleted} onOpenHelp={onOpenHelp} />;
  }
  if (mode === "privacy") {
    return <PrivacyDialog inputs={inputs} onClose={onClose} onCompleted={(result) => onCompleted(result.report)} onOpenHelp={onOpenHelp} />;
  }

  const label = (preset: ConversionPreset) => {
    const key = presetLabelKey(preset);
    return key ? t(key) : preset.name;
  };
  return <Dialog title={t("batch.title")} onClose={onClose} className="adp-batch-dialog">
    <p>{t("batch.summary")}</p>
    {error !== null && <p role="alert">{errorText(t, error, "convert")}</p>}
    <label>{t("convert.preset")}<select autoFocus value={selected} onChange={(event) => setSelected(event.target.value)}>
      <option value="">{t("convert.preset")}</option>
      {presets.map((preset) => <option key={preset.id} value={preset.id}>{label(preset)}</option>)}
    </select></label>
    <div className="adp-dialog-actions">
      <HelpButton onOpenHelp={() => onOpenHelp("batch-actions")} />
      <Button onClick={onClose}>{t("common.cancel")}</Button>
      <Button onClick={() => setMode("privacy")}>{t("privacy.title")}</Button>
      <Button variant="primary" disabled={!chosen} onClick={() => setMode("convert")}>{t("batch.run")}</Button>
    </div>
  </Dialog>;
}
