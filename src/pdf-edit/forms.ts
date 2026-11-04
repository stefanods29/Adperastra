import {
  PDF_EDIT_MAX_FIELD_ID_CHARS,
  PDF_EDIT_MAX_FORM_TEXT_CHARS,
  pdfEditError,
  type PdfEditCapabilities,
  type PdfFormOption,
  type PdfFormValue,
  type PdfFormValueValue,
} from "./types";

/** Supported AcroForm rules (Step 14a D8, T5).
 *
 * Only text, check, radio and choice fields are writable. Rich-text, XFA,
 * signature and unknown fields stay read-only. Calculations, validation
 * scripts and document actions never run: Adperastra writes values and
 * appearance streams, it does not execute the document. */

export const PDF_FORM_KINDS = ["text", "check", "radio", "choice"] as const;

export function pdfFormValueMatchesKind(kind: PdfFormValue["kind"], value: unknown): value is PdfFormValueValue {
  if (kind === "check") return typeof value === "boolean";
  if (kind === "text" || kind === "radio") {
    return typeof value === "string" && value.length <= PDF_EDIT_MAX_FORM_TEXT_CHARS;
  }
  if (kind === "choice") {
    return (
      Array.isArray(value) &&
      value.length <= 1_000 &&
      value.every((entry) => typeof entry === "string" && entry.length <= PDF_EDIT_MAX_FORM_TEXT_CHARS)
    );
  }
  return false;
}

export function pdfFormValueError(form: PdfFormValue, value: unknown): "pdf_edit.bad_request" | "pdf_edit.read_only" | null {
  if (form.field_id.length === 0 || form.field_id.length > PDF_EDIT_MAX_FIELD_ID_CHARS) return "pdf_edit.bad_request";
  if (form.readonly) return "pdf_edit.read_only";
  return pdfFormValueMatchesKind(form.kind, value) ? null : "pdf_edit.bad_request";
}

export function setPdfFormValue(form: PdfFormValue, value: unknown): PdfFormValue {
  const error = pdfFormValueError(form, value);
  if (error) throw pdfEditError(error);
  return { ...form, value: value as PdfFormValueValue };
}

export function pdfFormFieldEditable(form: PdfFormValue, capabilities: PdfEditCapabilities): boolean {
  if (form.readonly) return false;
  if (capabilities.xfa_present) return false;
  if (capabilities.rich_text_fields.includes(form.field_id)) return false;
  return form.kind === "text" || form.kind === "check" || form.kind === "radio" || form.kind === "choice";
}

/** Why a field is read-only, for the translated warning. `null` means the
 * field is supported and editable. `signature_present` is a save warning
 * about the document, never a reason to disable another field. */
export function pdfFormUnsupportedReason(form: PdfFormValue, capabilities: PdfEditCapabilities): string | null {
  if (form.kind === "text" && capabilities.rich_text_fields.includes(form.field_id)) return "rich_text";
  if (form.readonly) return "read_only";
  if (capabilities.xfa_present) return "xfa";
  if (form.kind === "text" || form.kind === "check" || form.kind === "radio" || form.kind === "choice") return null;
  return "unsupported";
}

export function pdfFormOptions(options: readonly PdfFormOption[], fieldId: string): string[] {
  return options.find((entry) => entry.field_id === fieldId)?.options ?? [];
}

export function pdfFormTextValue(value: PdfFormValueValue): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}

/** The exact fields whose values differ; a save never needs to rewrite an
 * unchanged field. */
export function changedPdfFormFields(before: readonly PdfFormValue[], after: readonly PdfFormValue[]): PdfFormValue[] {
  const previous = new Map(before.map((field) => [field.field_id, field]));
  const changed: PdfFormValue[] = [];
  for (const field of after) {
    const old = previous.get(field.field_id);
    if (!old || old.kind !== field.kind || JSON.stringify(old.value) !== JSON.stringify(field.value)) changed.push(field);
  }
  return changed;
}

export function pdfFormFieldName(fieldId: string): string {
  return fieldId.slice(0, PDF_EDIT_MAX_FIELD_ID_CHARS);
}
