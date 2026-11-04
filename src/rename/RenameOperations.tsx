import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import type { RenameOperation } from "../services/bulkRename";

const defaults: RenameOperation[] = [
  { kind: "replace", find: "", replacement: "", regex: false, match_case: true },
  { kind: "prefix", text: "" }, { kind: "suffix", text: "" },
  { kind: "number", start: 1, step: 1, padding: 3, position: "prefix", separator: "-" },
  { kind: "case", mode: "lower" }, { kind: "template", pattern: "{stem}" }, { kind: "remove", characters: "" },
];
const labels = { replace: "rename.find", prefix: "rename.prefix", suffix: "rename.suffix", number: "rename.number", case: "rename.case", template: "rename.template", remove: "rename.removeChars", explicit_names: "rename.new" };
export default function RenameOperations({ value, onChange, disabled }: {
  value: readonly RenameOperation[]; onChange: (value: RenameOperation[]) => void; disabled: boolean;
}) {
  const { t } = useTranslation();
  const set = (index: number, op: RenameOperation) => onChange(value.map((old, i) => i === index ? op : old));
  const move = (index: number, delta: number) => {
    const next = [...value];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  };
  return <fieldset className="adp-rename-operations" disabled={disabled}>
    {value.map((op, index) => <fieldset key={index}>
      <legend>{t(labels[op.kind])}</legend>
      {op.kind === "replace" && <>
        <label>{t("rename.find")}<input value={op.find} maxLength={4096} onChange={e => set(index, { ...op, find: e.target.value })} /></label>
        <label>{t("rename.replace")}<input value={op.replacement} maxLength={4096} onChange={e => set(index, { ...op, replacement: e.target.value })} /></label>
        <label><input type="checkbox" checked={op.regex} onChange={e => set(index, { ...op, regex: e.target.checked })} />{t("rename.regex")}</label>
        <label><input type="checkbox" checked={op.match_case} onChange={e => set(index, { ...op, match_case: e.target.checked })} />{t("rename.matchCase")}</label>
      </>}
      {(op.kind === "prefix" || op.kind === "suffix") && <label>{t(labels[op.kind])}<input value={op.text} maxLength={4096} onChange={e => set(index, { ...op, text: e.target.value })} /></label>}
      {op.kind === "number" && <>
        {(["start", "step", "padding"] as const).map(key => <label key={key}>{t(`rename.${key}`)}<input type="number" min={key === "start" ? 0 : 1} max={key === "padding" ? 12 : 1000000} value={op[key]} onChange={e => set(index, { ...op, [key]: e.target.valueAsNumber })} /></label>)}
        <label>{t("rename.position")}<select value={op.position} onChange={e => set(index, { ...op, position: e.target.value as "prefix" | "suffix" })}><option value="prefix">{t("rename.prefix")}</option><option value="suffix">{t("rename.suffix")}</option></select></label>
        <label>{t("rename.separator")}<input maxLength={16} value={op.separator} onChange={e => set(index, { ...op, separator: e.target.value })} /></label>
      </>}
      {op.kind === "case" && <label>{t("rename.case")}<select value={op.mode} onChange={e => set(index, { ...op, mode: e.target.value as "lower" | "upper" | "title" })}><option value="lower">{t("rename.lower")}</option><option value="upper">{t("rename.upper")}</option><option value="title">{t("rename.titleCase")}</option></select></label>}
      {op.kind === "template" && <label>{t("rename.template")}<input maxLength={512} value={op.pattern} onChange={e => set(index, { ...op, pattern: e.target.value })} /></label>}
      {op.kind === "remove" && <label>{t("rename.removeChars")}<input maxLength={256} value={op.characters} onChange={e => set(index, { ...op, characters: e.target.value })} /></label>}
      <div>
        <Button disabled={index === 0} onClick={() => move(index, -1)}>{t("columns.moveUp")}</Button>
        <Button disabled={index === value.length - 1} onClick={() => move(index, 1)}>{t("columns.moveDown")}</Button>
        <Button disabled={value.length === 1} onClick={() => onChange(value.filter((_, i) => i !== index))}>{t("rename.removeOperation")}</Button>
      </div>
    </fieldset>)}
    {defaults.map(op => <Button key={op.kind} disabled={value.length >= 32 || value.some(op => op.kind === "explicit_names")} onClick={() => onChange([...value, { ...op }])}>{t("rename.addOperation", { operation: t(labels[op.kind]) })}</Button>)}
  </fieldset>;
}
