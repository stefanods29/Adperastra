import { useTranslation } from "react-i18next";
import TextInput from "../components/TextInput";
import { pdfFormFieldEditable, pdfFormOptions, pdfFormUnsupportedReason } from "./forms";
import type {
  PdfEditCapabilities,
  PdfFormOption,
  PdfFormValue,
  PdfFormValueValue,
} from "./types";

/** Form fields panel (Step 14a D8, T5). Only supported AcroForm fields get
 * an input; rich-text, XFA, signature and unknown fields show the translated
 * read-only warning. Nothing here runs a calculation or a document script. */

export interface FormFieldsProps {
  values: readonly PdfFormValue[];
  options: readonly PdfFormOption[];
  capabilities: PdfEditCapabilities;
  disabled?: boolean;
  onChange: (fieldId: string, value: PdfFormValueValue) => void;
}

export default function FormFields({ values, options, capabilities, disabled = false, onChange }: FormFieldsProps) {
  const { t } = useTranslation();
  if (values.length === 0) return null;
  return (
    <div className="adp-pdf-edit-forms" role="group" aria-label={t("pdfTools.forms")}>
      {values.map((field) => {
        const editable = !disabled && pdfFormFieldEditable(field, capabilities);
        const reason = pdfFormUnsupportedReason(field, capabilities);
        const choices = pdfFormOptions(options, field.field_id);
        const multiple = field.kind === "choice" && Array.isArray(field.value) && field.value.length > 1;
        const selectedValue = multiple
          ? (field.value as string[])
          : Array.isArray(field.value)
            ? field.value[0] ?? ""
            : String(field.value);
        return (
          <div className="adp-pdf-edit-form-row" key={field.field_id}>
            <label className="adp-pdf-edit-form-label" htmlFor={`pdf-field-${field.field_id}`}>
              {field.field_id}
            </label>
            {field.kind === "text" ? (
              <TextInput
                inputId={`pdf-field-${field.field_id}`}
                value={typeof field.value === "string" ? field.value : ""}
                disabled={!editable}
                maxLength={32_767}
                onChange={(value) => onChange(field.field_id, value)}
              />
            ) : field.kind === "check" ? (
              <input
                id={`pdf-field-${field.field_id}`}
                className="adp-pdf-edit-check"
                type="checkbox"
                checked={field.value === true}
                disabled={!editable}
                onChange={(event) => onChange(field.field_id, event.currentTarget.checked)}
              />
            ) : (
              <select
                id={`pdf-field-${field.field_id}`}
                className="adp-input adp-pdf-edit-select"
                value={selectedValue}
                disabled={!editable}
                multiple={multiple}
                onChange={(event) => {
                  if (field.kind === "choice") {
                    const values = event.currentTarget.multiple
                      ? [...event.currentTarget.selectedOptions].map((option) => option.value)
                      : [event.currentTarget.value];
                    onChange(field.field_id, values);
                  } else {
                    onChange(field.field_id, event.currentTarget.value);
                  }
                }}
              >
                {choices.map((choice) => (
                  <option value={choice} key={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            )}
            {reason ? (
              <p className="adp-pdf-edit-note" role="note">
                {t("pdfTools.unsupportedForm")}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
