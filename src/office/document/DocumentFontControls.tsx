import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OfficeFont, OfficeValue, TextFormatPatch } from "../types";

export function nextDocumentToggle(value: OfficeValue<boolean>): boolean {
  if (value.kind === "unavailable") throw new Error("office_edit.unsupported");
  return value.kind === "mixed" || !value.value;
}

export function documentFontSize(size: number): TextFormatPatch {
  if (!Number.isFinite(size) || size < 1 || size > 400) throw new Error("office_edit.invalid");
  return { size_pt: size };
}

export function DocumentFontControls({ font, size, fonts, disabled, onPatch }: {
  font: OfficeValue<OfficeFont>; size: OfficeValue<number>; fonts: readonly OfficeFont[];
  disabled: boolean; onPatch: (patch: TextFormatPatch) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  const apply = (patch: TextFormatPatch) => { setError(false); void onPatch(patch).catch(() => setError(true)); };
  return <div className="adp-office-document-font">
    <select aria-label={t("officeDoc.font")} disabled={disabled || font.kind === "unavailable"}
      value={font.kind === "value" ? String(fonts.findIndex((item) => item.family === font.value.family && item.source === font.value.source)) : ""}
      onChange={(event) => {
        const chosen = fonts[Number(event.target.value)];
        if (event.target.value !== "" && chosen) apply({ font: chosen });
      }}>
      <option value="" />
      {font.kind === "value" && !fonts.some((item) => item.family === font.value.family && item.source === font.value.source)
        ? <option value="-1" disabled>{font.value.family}</option> : null}
      {fonts.map((item, index) => <option key={`${item.source}:${item.family}`} value={index}>{item.family}</option>)}
    </select>
    <input type="number" min={1} max={400} aria-label={t("officeDoc.fontSize")}
      disabled={disabled || size.kind === "unavailable"} value={size.kind === "value" ? size.value : ""}
      onChange={(event) => {
        if (event.target.value === "") return;
        try { apply(documentFontSize(Number(event.target.value))); } catch { setError(true); }
      }} />
    {error ? <p role="alert">{t("errors.office_edit.failed")}</p> : null}
  </div>;
}
