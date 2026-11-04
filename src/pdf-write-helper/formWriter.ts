import {
  PDFAcroForm,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFForm,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  type PDFFont,
} from "pdf-lib";
import {
  PDF_EDIT_MAX_FIELD_ID_CHARS,
  PDF_EDIT_MAX_FORM_TEXT_CHARS,
  PDF_EDIT_MAX_FORMS,
  type PdfFormOption,
  type PdfFormValue,
} from "../pdf-edit/types";
import { changedPdfFormFields } from "../pdf-edit/forms";

/** Safe AcroForm filling (Step 14a D8, T5).
 *
 * Supported fields use pdf-lib's verified setters. Rich-text, XFA, signature
 * and unknown fields stay read-only; a save that would need flattening or
 * dropping them is refused. Document calculations, validation scripts and
 * actions are never executed. `deleteXFA` and `flatten` are never called. */

export interface PdfFormInspection {
  values: PdfFormValue[];
  options: PdfFormOption[];
  xfa: boolean;
  rich_text_fields: string[];
  signature_present: boolean;
  unsupported_structures: string[];
}

function fieldKind(field: PDFField): PdfFormValue["kind"] | null {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "check";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return "choice";
  return null;
}

function fieldValue(field: PDFField): PdfFormValue["value"] {
  if (field instanceof PDFTextField) return (field.getText() ?? "").slice(0, PDF_EDIT_MAX_FORM_TEXT_CHARS);
  if (field instanceof PDFCheckBox) return field.isChecked();
  if (field instanceof PDFRadioGroup) return field.getSelected() ?? "";
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return field.getSelected();
  return "";
}

function fieldOptions(field: PDFField): string[] {
  if (field instanceof PDFRadioGroup) return field.getOptions();
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return field.getOptions();
  return [];
}

export function inspectPdfFormFields(pdf: PDFDocument): PdfFormInspection {
  const acro = pdf.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (!acro) {
    return {
      values: [],
      options: [],
      xfa: false,
      rich_text_fields: [],
      signature_present: false,
      unsupported_structures: [],
    };
  }
  const form = PDFForm.of(PDFAcroForm.fromDict(acro), pdf);
  const xfa = form.hasXFA();
  const fields = form.getFields();
  if (fields.length > PDF_EDIT_MAX_FORMS) throw new Error("pdf_edit.too_large");
  const values: PdfFormValue[] = [];
  const options: PdfFormOption[] = [];
  const richTextFields: string[] = [];
  const unsupported = new Set<string>();
  let signaturePresent = false;
  for (const field of fields) {
    const name = field.getName().slice(0, PDF_EDIT_MAX_FIELD_ID_CHARS);
    if (name.length === 0) continue;
    if (field instanceof PDFSignature) {
      signaturePresent = true;
      values.push({ field_id: name, kind: "text", value: "", readonly: true });
      continue;
    }
    if (field instanceof PDFTextField) {
      const rich = field.isRichFormatted();
      if (rich) richTextFields.push(name);
      values.push({
        field_id: name,
        kind: "text",
        value: rich ? "" : (field.getText() ?? "").slice(0, PDF_EDIT_MAX_FORM_TEXT_CHARS),
        readonly: field.isReadOnly() || rich,
      });
      continue;
    }
    const kind = fieldKind(field);
    if (!kind) {
      unsupported.add(field instanceof PDFButton ? "push_button" : "form_field");
      continue;
    }
    values.push({
      field_id: name,
      kind,
      value: fieldValue(field),
      readonly: field.isReadOnly(),
    });
    const choices = fieldOptions(field);
    if (choices.length > 0) options.push({ field_id: name, options: choices });
  }
  return {
    values,
    options,
    xfa,
    rich_text_fields: richTextFields,
    signature_present: signaturePresent,
    unsupported_structures: [...unsupported],
  };
}

export interface PdfFormApplyResult {
  applied: number;
  fields: string[];
}

/** Apply only the changed supported values, then refresh appearances with the
 * embedded export font. Unchanged fields and all unknown objects are left
 * alone. */
export async function applyPdfFormValues(
  pdf: PDFDocument,
  values: readonly PdfFormValue[],
  font: PDFFont,
): Promise<PdfFormApplyResult> {
  const before = inspectPdfFormFields(pdf);
  const changed = changedPdfFormFields(before.values, values);
  if (changed.length === 0) return { applied: 0, fields: [] };
  if (before.xfa) throw new Error("pdf_edit.unsupported");
  if (before.values.length === 0) throw new Error("pdf_edit.changed");
  const form = pdf.getForm();
  const previous = new Map(before.values.map((field) => [field.field_id, field]));
  const applied: string[] = [];
  for (const next of changed) {
    const old = previous.get(next.field_id);
    if (!old) throw new Error("pdf_edit.changed");
    if (old.kind === "text" && before.rich_text_fields.includes(old.field_id)) {
      throw new Error("pdf_edit.unsupported");
    }
    if (old.readonly) throw new Error("pdf_edit.read_only");
    const field = form.getFieldMaybe(next.field_id);
    if (!field) throw new Error("pdf_edit.changed");
    try {
      if (field instanceof PDFTextField) {
        field.setText(String(next.value));
      } else if (field instanceof PDFCheckBox) {
        if (typeof next.value !== "boolean") throw new Error("pdf_edit.bad_request");
        if (next.value) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (typeof next.value !== "string") throw new Error("pdf_edit.bad_request");
        field.select(next.value);
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        const selected = Array.isArray(next.value) ? next.value : [String(next.value)];
        field.select(selected);
      } else {
        throw new Error("pdf_edit.unsupported");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("pdf_edit.")) throw error;
      throw new Error("pdf_edit.bad_request");
    }
    applied.push(next.field_id);
  }
  try {
    form.updateFieldAppearances(font);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/glyph|encode|unicode/i.test(message)) throw new Error("pdf_edit.missing_glyph");
    throw new Error("pdf_edit.failed");
  }
  return { applied: applied.length, fields: applied };
}
