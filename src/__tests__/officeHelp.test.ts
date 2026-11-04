import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canOfficeCommand } from "../office/officeCompatibility";
import type { OfficeSessionState } from "../office/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const state: OfficeSessionState = {
  session_id: "11111111-1111-4111-8111-111111111111",
  document_id: "22222222-2222-4222-8222-222222222222",
  family: "document", format: "docx", revision: 1, saved_revision: 1,
  content_id: "33333333-3333-4333-8333-333333333333",
  saved_content_id: "33333333-3333-4333-8333-333333333333",
  ready: true, mode: "editing", dirty: false, can_undo: false, can_redo: false,
  capabilities: ["document_text", "document_review", "document_format", "print"],
  selection: null,
  compatibility: { format: "docx", entries: [], next_cursor: null, can_preserve_unknown: true, blocks_save: false },
  page_count: 1, sheet_count: 0, slide_count: 0, busy: false, status_key: null,
};

function valueAt(object: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (typeof value !== "object" || value === null) return undefined;
    return Object.getOwnPropertyDescriptor(value, part)?.value;
  }, object);
}

describe("Office command gating", () => {
  it("missing_capability_is_disabled", () => {
    expect(canOfficeCommand({ ...state, capabilities: [] }, "document_text", true)).toEqual({ enabled: false, reason_key: "office.unsupported" });
  });
  it("not_ready_and_busy_are_disabled", () => {
    expect(canOfficeCommand({ ...state, ready: false }, "document_text", true).enabled).toBe(false);
    expect(canOfficeCommand({ ...state, busy: true }, "document_text", true).enabled).toBe(false);
  });
  it("viewing_requires_explicit_enable_for_mutation", () => {
    expect(canOfficeCommand({ ...state, mode: "viewing" }, "document_text", true)).toEqual({ enabled: false, reason_key: "office.enableEditing" });
    expect(canOfficeCommand({ ...state, mode: "viewing" }, "print", false).enabled).toBe(true);
  });
  it("reviewing_limits_mutation_to_document_text_and_review", () => {
    const reviewing = { ...state, mode: "reviewing" as const };
    expect(canOfficeCommand(reviewing, "document_review", true).enabled).toBe(true);
    expect(canOfficeCommand(reviewing, "document_text", true).enabled).toBe(true);
    expect(canOfficeCommand(reviewing, "document_format", true).enabled).toBe(false);
    expect(canOfficeCommand({ ...reviewing, family: "sheet" }, "document_text", true).enabled).toBe(false);
  });
  it("enabled_command_has_no_disabled_reason", () => {
    expect(canOfficeCommand(state, "document_text", true)).toEqual({ enabled: true, reason_key: null });
  });
});

describe("Office help and error catalog", () => {
  const errors = [
    "invalid", "engine_missing", "unsupported", "read_only", "changed", "too_large",
    "busy", "cancelled", "timeout", "failed", "preservation_failed", "sensitive_unsupported", "other",
  ];
  const officeKeys = [
    "blankSheetName", "autosave", "saved", "unsaved", "saving", "mode", "editing", "reviewing", "viewing",
    "enableEditing", "unsupported", "compatibility", "openChosen", "engineNeeded", "preservedOnly", "comments",
    "share", "saveCopy", "exportPdf", "ready", "cancel", "localOnly", "transaction", "undo", "redo",
  ];
  it("all_error_and_common_keys_exist_in_both_languages", () => {
    for (const language of ["en", "es"]) {
      const catalog: unknown = JSON.parse(readFileSync(join(root, "src/i18n/locales", `${language}.json`), "utf8"));
      for (const key of [...errors.map((key) => `errors.office_edit.${key}`), ...officeKeys.map((key) => `office.${key}`), "officeEdit.loading"]) {
        expect(valueAt(catalog, key), `${language}: ${key}`).toEqual(expect.any(String));
      }
      expect(valueAt(catalog, "office.blankSheetName")).toContain("{index}");
    }
  });
  it("full_help_is_bilingual_and_explains_safe_fallback", () => {
    for (const language of ["en", "es"]) {
      for (const slug of ["how-office-editing-works", "office-compatibility-and-limits"]) {
        const text = readFileSync(join(root, "help", language, `${slug}.md`), "utf8");
        expect(text).toMatch(/^# .+/);
        expect(text).toContain(language === "en" ? "## Good to know" : "## Para tener en cuenta");
        expect(text).toContain(language === "en" ? "See also:" : "Consulta también:");
        expect(text).toMatch(language === "en" ? /preserv/ : /conserv/);
      }
      const editing = readFileSync(join(root, "help", language, "how-office-editing-works.md"), "utf8");
      expect(editing).toContain(language === "en" ? "Macros and external data connections do not run." : "No se ejecutan macros ni conexiones de datos externas.");
      expect(editing).toContain(language === "en" ? "chosen app" : "aplicación elegida");
    }
  });
});
