import type { SheetCleanOperation } from "./sheetAiTypes";

type Options = Extract<SheetCleanOperation, { kind: "parse_number" }>;
export function cleaningNumber(text: string, options: Options): { value: number | null; identifier: boolean } {
  const decimal = options.decimal === "dot" ? "." : ",";
  const group = { none: "", dot: ".", comma: ",", space: " " }[options.thousands];
  if (decimal === group) throw new Error("sheet_ai.ambiguous");
  const unsigned = /^[+-]/.test(text) ? text.slice(1) : text;
  const parts = unsigned.split(decimal);
  if (parts.length > 2 || (parts.length === 2 && !/^\d+$/.test(parts[1]))) return { value: null, identifier: false };
  const chunks = group ? parts[0].split(group) : [parts[0]];
  if (!/^\d+$/.test(chunks[0]) || (chunks.length > 1 &&
      (chunks[0].length > 3 || chunks.slice(1).some(c => !/^\d{3}$/.test(c))))) return { value: null, identifier: false };
  const digits = chunks.join("");
  if (!options.allow_leading_zero && digits.length > 1 && digits.startsWith("0")) return { value: null, identifier: true };
  const value = Number(`${text.startsWith("-") ? "-" : ""}${digits}${parts.length === 2 ? `.${parts[1]}` : ""}`);
  return { value: Number.isFinite(value) ? value : null, identifier: false };
}
