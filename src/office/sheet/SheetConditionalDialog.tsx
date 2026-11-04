import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../../components/Dialog";
import type { SheetOperation } from "../types";

type Conditional = Extract<SheetOperation, { kind: "set_conditional_rule" }>;
export function numericConditional(operation: Conditional, threshold: number): Conditional {
  if (!Number.isFinite(threshold)) throw new Error("office_edit.invalid");
  return { ...operation, rule: { ...operation.rule, kind: "compare", operator: "greater", values: [{ kind: "number", value: threshold }], text: undefined, formula: undefined, colors: [] } };
}

export default function SheetConditionalDialog({ operation, onConfirm, onClose, onError }: {
  operation: Conditional; onConfirm: (operation: Conditional) => Promise<void>; onClose: () => void; onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const initial = operation.rule.values[0];
  const [threshold, setThreshold] = useState(initial?.kind === "number" ? String(initial.value) : "5");
  const [pending, setPending] = useState(false);
  return <Dialog title={t("officeSheet.conditional")} onClose={() => { if (!pending) onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault(); if (pending || threshold.trim() === "") return; setPending(true);
      void Promise.resolve().then(() => onConfirm(numericConditional(operation, Number(threshold)))).then(onClose).catch(onError).finally(() => setPending(false));
    }}>
      <label>{t("officeSheet.greaterThan")}<input type="number" step="any" value={threshold} disabled={pending} onChange={(event) => setThreshold(event.target.value)} /></label>
      <button type="submit" disabled={pending || threshold.trim() === "" || !Number.isFinite(Number(threshold))}>{t("officeSheet.apply")}</button>
    </form>
  </Dialog>;
}
