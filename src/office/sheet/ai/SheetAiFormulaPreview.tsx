import { useTranslation } from "react-i18next";
import type { OfficeProposalCalculation } from "../../types";

/** Non-owning view of an E21 calculation. Model explanation is never used as its result. */
export default function SheetAiFormulaPreview({ canonical, localized, calculation }: {
  canonical: string; localized: string | null; calculation: OfficeProposalCalculation | null;
}) {
  const { t } = useTranslation();
  const calculated = calculation !== null && calculation.canonical === canonical &&
    calculation.error_code === null && calculation.deterministic;
  return <section className="adp-sheet-ai-formula" aria-label={t("sheetAi.formula")}>
    <label>{t("sheetAi.canonical")}<textarea readOnly value={canonical} /></label>
    <label>{t("sheetAi.localized")}<textarea readOnly value={localized ?? ""} /></label>
    <label>{t("sheetAi.calculated")}<textarea readOnly value={calculated ? calculation.display : t("sheetAi.notCalculated")} /></label>
    {calculation?.error_code && <p role="alert">{t("errors.sheet_ai.calculation")}</p>}
  </section>;
}
