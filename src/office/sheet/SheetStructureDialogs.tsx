import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../../components/Dialog";

export function validSheetName(name: string, names: readonly string[], previous?: string): boolean {
  const length = Array.from(name).length;
  return length >= 1 && length <= 31 && !/[:/\\?*\[\]]/.test(name) &&
    !names.some((other) => other !== previous && other.toLowerCase() === name.toLowerCase());
}

export function nextSheetName(names: readonly string[], localize: (index: number) => string): string {
  for (let index = 1; index <= names.length + 1; index += 1) {
    const name = localize(index);
    if (validSheetName(name, names)) return name;
  }
  throw new Error("office_edit.invalid");
}

/** The caller sends rename_sheet only after this explicit confirmation. */
export default function SheetStructureDialogs({ name, names, onConfirm, onClose, onError }: {
  name: string; names: readonly string[]; onConfirm: (name: string) => Promise<void>; onClose: () => void; onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(name);
  const [pending, setPending] = useState(false);
  return <Dialog title={t("officeSheet.sheetNameDialog")} onClose={() => { if (!pending) onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault(); if (pending || !validSheetName(value, names, name)) return;
      setPending(true);
      void onConfirm(value).then(onClose).catch(onError).finally(() => setPending(false));
    }}>
      <label>{t("officeSheet.sheetNameDialog")}<input value={value} disabled={pending} onChange={(event) => setValue(event.target.value)} /></label>
      <button type="submit" disabled={pending || !validSheetName(value, names, name)}>{t("officeSheet.apply")}</button>
    </form>
  </Dialog>;
}
