import { useTranslation } from "react-i18next";
import type { CellRange, OfficeRenderPage } from "../../types";
import { fileUrl } from "../../../services/files";

/** Parent E21 preview owns the image lease and releases it through releaseOfficeProposal. */
export default function SheetAiChartPreview({ render, source, caption }: {
  render: OfficeRenderPage | null; source: CellRange; caption: string;
}) {
  const { t } = useTranslation();
  return <figure className="adp-sheet-ai-chart">
    {render ? <img src={fileUrl(render.image.token, render.image.name)} alt={caption} /> :
      <p role="status">{t("sheetAi.notCalculated")}</p>}
    <figcaption>{caption}</figcaption>
    <p>{t("sheetAi.source")}: <code>{source.sheet_id}:R{source.first_row + 1}C{source.first_column + 1}:R{source.last_row + 1}C{source.last_column + 1}</code></p>
  </figure>;
}
