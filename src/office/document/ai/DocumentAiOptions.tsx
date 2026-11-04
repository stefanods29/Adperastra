import { useId, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { DOCUMENT_AI_ACTIONS, DOCUMENT_AI_TONES, type DocumentAiAction, type DocumentAiOptions as Options } from "./documentAiTypes";

interface Props {
  value: Options;
  supportedLanguages: readonly string[];
  disabled: boolean;
  unavailableActions: readonly DocumentAiAction[];
  onChange(value: Options): void;
  actionRef?: Ref<HTMLSelectElement>;
}
const labelKey = (action: DocumentAiAction) => action === "alt_text" ? "documentAi.altText" : `documentAi.${action}`;

/** Pure controlled options: never starts a job, chooses a backend or mutates a
 * document. Parent supplies current, actually proved capability availability. */
export function DocumentAiOptions({ value, supportedLanguages, disabled, unavailableActions, onChange, actionRef }: Props) {
  const { t } = useTranslation();
  const id = useId();
  return <fieldset className="document-ai-options" disabled={disabled}>
    <legend>{t("documentAi.title")}</legend>
    <label htmlFor={`${id}-action`}>{t("documentAi.title")}</label>
    <select id={`${id}-action`} ref={actionRef} value={value.action} onChange={(event) => onChange({
      action: event.target.value as DocumentAiAction, tone: null, target_language: null,
      topic: event.target.value === "draft" ? "" : null, locale: value.locale,
    })}>
      {DOCUMENT_AI_ACTIONS.map((action) => <option key={action} value={action} disabled={unavailableActions.includes(action)}>{t(labelKey(action))}</option>)}
    </select>
    {value.action === "tone" && <div>
      <label htmlFor={`${id}-tone`}>{t("documentAi.tone")}</label>
      <select id={`${id}-tone`} value={value.tone ?? ""} required onChange={(event) => onChange({ ...value, tone: event.target.value as Options["tone"] })}>
        <option value="" disabled hidden />
        {DOCUMENT_AI_TONES.map((tone) => <option key={tone} value={tone}>{t(`documentAi.${tone}`)}</option>)}
      </select>
    </div>}
    {value.action === "translate" && <div>
      <label htmlFor={`${id}-language`}>{t("documentAi.targetLanguage")}</label>
      <select id={`${id}-language`} value={value.target_language ?? ""} required onChange={(event) => onChange({ ...value, target_language: event.target.value })}>
        <option value="" disabled hidden />
        {supportedLanguages.map((language) => <option key={language} value={language}>{language}</option>)}
      </select>
    </div>}
    {value.action === "draft" && <div>
      <label htmlFor={`${id}-topic`}>{t("documentAi.topic")}</label>
      <textarea id={`${id}-topic`} value={value.topic ?? ""} required onChange={(event) => onChange({ ...value, topic: event.target.value })} />
    </div>}
  </fieldset>;
}
