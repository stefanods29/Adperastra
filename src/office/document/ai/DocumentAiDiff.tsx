import { useId } from "react";
import { useTranslation } from "react-i18next";

/** Displays escaped text from a native diff row; never claims clone completion.
 * A container must page the native preview with `officeProposalPage` and
 * review every page before Apply. */
export function DocumentAiDiff({ before, after }: { before: string; after: string }) {
  const { t } = useTranslation();
  const id = useId();
  return <div className="document-ai-diff">
    <section aria-labelledby={`${id}-source`}>
      <h3 id={`${id}-source`}>{t("documentAi.source")}</h3>
      <del>{before}</del>
    </section>
    <section aria-labelledby={`${id}-result`}>
      <h3 id={`${id}-result`}>{t("documentAi.suggestion")}</h3>
      <ins>{after}</ins>
    </section>
  </div>;
}
