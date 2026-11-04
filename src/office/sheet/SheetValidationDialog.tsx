import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../../components/Dialog";
import type { SheetOperation } from "../types";

type Validation = Extract<SheetOperation, { kind: "set_validation" }>;

/** List entry is deliberately plain lines, with no reference/expression evaluation. */
export function listValidation(operation: Validation, text: string): Validation {
  const list = text.split(/\r?\n/);
  if (list.length > 1000 || list.some((item) => item.length === 0 || item.length > 32_767)) throw new Error("office_edit.invalid");
  return { ...operation, range: { ...operation.range }, rule: { ...operation.rule, kind: "list", values: [], list, error_style: "stop", formula: undefined } };
}

export default function SheetValidationDialog({ operation, onConfirm, onClose, onError }: {
  operation: Validation; onConfirm: (operation: Validation) => Promise<void>; onClose: () => void; onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(operation.rule.list.join("\n"));
  const [pending, setPending] = useState(false);
  return <Dialog title={t("officeSheet.validation")} onClose={() => { if (!pending) onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault(); if (pending) return; setPending(true);
      void Promise.resolve().then(() => onConfirm(listValidation(operation, text))).then(onClose).catch(onError).finally(() => setPending(false));
    }}>
      <label>{t("officeSheet.validationList")}<textarea value={text} disabled={pending} onChange={(event) => setText(event.target.value)} /></label>
      <button type="submit" disabled={pending || !text}>{t("officeSheet.apply")}</button>
    </form>
  </Dialog>;
}
