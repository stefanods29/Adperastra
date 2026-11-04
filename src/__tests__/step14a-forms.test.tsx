import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import "../i18n";
import FormFields from "../pdf-edit/FormFields";
import { applyPdfFormValues, inspectPdfFormFields } from "../pdf-write-helper/formWriter";
import { makeCapabilities, makeForm } from "./pdfEditFixtures";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function formPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 400]);
  const form = pdf.getForm();
  const name = form.createTextField("name");
  name.addToPage(page, { x: 20, y: 320, width: 180, height: 24 });
  const agree = form.createCheckBox("agree");
  agree.addToPage(page, { x: 20, y: 280, width: 14, height: 14 });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  return { pdf, name, agree, font };
}

describe("safe supported form filling", () => {
  it("checkbox_checked_reopens", async () => {
    const { pdf, font } = await formPdf();
    const values = [
      makeForm({ field_id: "name", kind: "text", value: "Ada" }),
      makeForm({ field_id: "agree", kind: "check", value: true }),
    ];
    const result = await applyPdfFormValues(pdf, values, font);
    expect(result.applied).toBe(2);
    const reloaded = await PDFDocument.load(await pdf.save());
    const form = reloaded.getForm();
    expect(form.getTextField("name").getText()).toBe("Ada");
    expect(form.getCheckBox("agree").isChecked()).toBe(true);
    const inspection = inspectPdfFormFields(reloaded);
    expect(inspection.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field_id: "name", value: "Ada" }),
        expect.objectContaining({ field_id: "agree", value: true }),
      ]),
    );
  });

  it("richtext_refused", async () => {
    const { pdf, name, font } = await formPdf();
    name.enableRichFormatting();
    await expect(
      applyPdfFormValues(pdf, [makeForm({ field_id: "name", kind: "text", value: "changed" })], font),
    ).rejects.toThrow("pdf_edit.unsupported");
    expect(name.isRichFormatted()).toBe(true);
    expect(pdf.getForm().getTextField("name").isRichFormatted()).toBe(true);
  });

  it("XFA_preserved_or_no_save", async () => {
    const { pdf, name, font } = await formPdf();
    pdf.getForm().acroForm.dict.set(PDFName.of("XFA"), PDFString.of("<xfa/>"));
    await expect(
      applyPdfFormValues(pdf, [makeForm({ field_id: "name", kind: "text", value: "changed" })], font),
    ).rejects.toThrow("pdf_edit.unsupported");
    // `pdf.getForm()` deletes XFA by design, so inspect the raw AcroForm.
    const acro = pdf.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
    expect(acro?.get(PDFName.of("XFA"))).toBeTruthy();
    expect(name.getText() ?? "").toBe("");
  });

  it("script_action_never_executed", async () => {
    const { pdf, name, font } = await formPdf();
    const action = pdf.context.obj({
      S: "JavaScript",
      JS: PDFString.of("globalThis.__adpPdfScriptRan = true;"),
    });
    name.acroField.dict.set(PDFName.of("AA"), pdf.context.obj({ K: action }));
    await applyPdfFormValues(pdf, [makeForm({ field_id: "name", kind: "text", value: "safe" })], font);
    const reloaded = await PDFDocument.load(await pdf.save());
    expect((globalThis as { __adpPdfScriptRan?: boolean }).__adpPdfScriptRan).toBeUndefined();
    const field = reloaded.getForm().getTextField("name");
    expect(field.getText()).toBe("safe");
    expect(field.acroField.dict.get(PDFName.of("AA"))).toBeTruthy();
  });

  it("shows unsupported fields read-only with the translated warning", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <FormFields
          values={[
            makeForm({ field_id: "name", kind: "text", value: "Ada" }),
            makeForm({ field_id: "rich", kind: "text", value: "kept", readonly: true }),
          ]}
          options={[]}
          capabilities={makeCapabilities({ rich_text_fields: ["rich"] })}
          onChange={() => undefined}
        />,
      );
    });
    const name = container.querySelector<HTMLInputElement>("#pdf-field-name");
    const rich = container.querySelector<HTMLInputElement>("#pdf-field-rich");
    expect(name?.disabled).toBe(false);
    expect(rich?.disabled).toBe(true);
    expect(container.querySelector("[role='note']")).not.toBeNull();
  });
});
