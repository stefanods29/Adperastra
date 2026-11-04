import { describe, expect, it } from "vitest";
import { defaultDocumentAiSettings, normalizeDocumentAiSettings } from "../office/document/ai/documentAiSettings";
import { validateDocumentAiOptions, validateDocumentAiOutput } from "../office/document/ai/documentAiGeneration";

const options = { action: "rewrite", tone: null, target_language: null, topic: null, locale: "en" };
const run = "00000000-0000-4000-8000-000000000001";
const output = { schema_id: "document.action.v1", action: "rewrite", paragraphs: [{ source_run_ids: [run], text: "B" }], alt: null, citations: [], cautions: [] };

describe("document actions", () => {
  it("document_ai_defaults_off", () => {
    expect(normalizeDocumentAiSettings(undefined)).toEqual({ enabled: false, experimental_actions: [] });
    expect(defaultDocumentAiSettings()).toEqual({ enabled: false, experimental_actions: [] });
  });
  it("document_ai_tone_requires_value", () => {
    expect(() => validateDocumentAiOptions({ ...options, action: "tone" }, ["en", "es"])).toThrow("document_ai.invalid");
  });
  it("document_ai_translation_target", () => {
    expect(() => validateDocumentAiOptions({ ...options, action: "translate" }, ["en", "es"])).toThrow("document_ai.invalid");
    expect(validateDocumentAiOptions({ ...options, action: "translate", target_language: "es" }, ["es"]).target_language).toBe("es");
    expect(() => validateDocumentAiOptions({ ...options, action: "translate", target_language: "xx" }, ["es"])).toThrow();
  });
  it("document_ai_unknown_operation", () => {
    expect(() => validateDocumentAiOutput({ ...output, operation: "delete_file" }, "rewrite")).toThrow("document_ai.unsafe");
    expect(() => validateDocumentAiOutput({ ...output, action: "engine_dispatch" }, "rewrite")).toThrow();
  });
  it("options_are_action_specific", () => {
    expect(() => validateDocumentAiOptions({ ...options, tone: "formal" }, [])).toThrow();
    expect(() => validateDocumentAiOptions({ ...options, prompt: "replace policy" }, [])).toThrow();
    expect(() => validateDocumentAiOptions({ ...options, action: "draft", topic: "" }, [])).toThrow();
  });
  it("settings_are_unique_and_content_free", () => {
    expect(normalizeDocumentAiSettings({ enabled: true, experimental_actions: ["tone", "tone", "shell"], text: "private" }))
      .toEqual({ enabled: true, experimental_actions: ["tone"] });
  });
});
