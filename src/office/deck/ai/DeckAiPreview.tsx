import { useTranslation } from "react-i18next";
import type { OfficeProposalPreview, OfficeRenderPage } from "../../types";
import { fileUrl } from "../../../services/files";

/** Real clone preview: bounded Office render pages with accessible text.
 * Model HTML/SVG never enters this component. Notes are not shown here. */

export interface DeckAiPreviewProps {
  preview: OfficeProposalPreview | null;
}

function accessibleText(page: OfficeRenderPage): string {
  return page.accessibility.map((node) => node.name).filter(Boolean).join(" ");
}

export function DeckAiPreview({ preview }: DeckAiPreviewProps) {
  const { t } = useTranslation();
  if (!preview) {
    return <p className="deck-ai-preview-empty">{t("deckAi.preview")}</p>;
  }
  return (
    <div className="deck-ai-preview" aria-label={t("deckAi.preview")}>
      {preview.renders.slice(0, 4).map((page) => {
        const text = accessibleText(page);
        return (
          <figure key={page.page_id} className="deck-ai-preview-page">
            <img src={fileUrl(page.image.token, page.image.name)} alt={text} />
            <figcaption>{text}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}
