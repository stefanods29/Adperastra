import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CellInput } from "../../types";
import type { SheetCleanDiff } from "./sheetAiTypes";

function cellText(input: CellInput, locale: string): string {
  switch (input.kind) {
    case "blank": return "";
    case "text": return input.text;
    case "formula": return input.canonical;
    case "date": return input.iso_date;
    case "number": return new Intl.NumberFormat(locale === "es" ? "es-419" : "en-US", { maximumSignificantDigits: 21 }).format(input.value);
    case "boolean": return input.value ? "TRUE" : "FALSE";
  }
}
const reasons = { trim_spaces: "sheetAi.trimSpaces", normalize_date: "sheetAi.NormalizeDate",
  parse_number: "sheetAi.ParseNumber", duplicate: "sheetAi.Duplicate" } as const;
const warnings = { ambiguous_date: "sheetAi.ambiguousDate", invalid_number: "sheetAi.InvalidNumber",
  identifier_preserved: "sheetAi.IdentifierKept", formula_preserved: "sheetAi.FormulaKept", duplicate_mark_only: "sheetAi.duplicatesKept" } as const;

export default function SheetAiCleaningGrid({ diffs }: { diffs: readonly SheetCleanDiff[] }) {
  const { t, i18n } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: diffs.length, getScrollElement: () => viewport.current,
    estimateSize: () => 32, overscan: 8 });
  return <div className="adp-sheet-ai-cleaning" role="table" aria-label={t("sheetAi.clean")} aria-rowcount={diffs.length + 1} aria-colcount={4}>
    <div role="row" className="adp-sheet-ai-cleaning-header">
      <span role="columnheader">{t("sheetAi.source")}</span><span role="columnheader">{t("sheetAi.before")}</span>
      <span role="columnheader">{t("sheetAi.after")}</span><span role="columnheader">{t("sheetAi.reason")}</span>
    </div>
    <div ref={viewport} className="adp-sheet-ai-cleaning-scroll" tabIndex={0} aria-label={t("sheetAi.clean")}>
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {virtual.getVirtualItems().map(row => {
          const diff = diffs[row.index];
          return <div role="row" aria-rowindex={row.index + 2} key={row.key} className="adp-sheet-ai-cleaning-row"
            style={{ transform: `translateY(${row.start}px)` }}>
            <span role="cell">R{diff.address.row + 1}C{diff.address.column + 1}</span>
            <span role="cell" title={cellText(diff.before, i18n.language)}>{cellText(diff.before, i18n.language)}</span>
            <span role="cell" title={cellText(diff.after, i18n.language)}>{cellText(diff.after, i18n.language)}</span>
            <span role="cell" title={diff.warning ? t(warnings[diff.warning]) : t(reasons[diff.reason])}>
              {diff.warning ? t(warnings[diff.warning]) : t(reasons[diff.reason])}
            </span>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
