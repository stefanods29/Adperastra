import { describe, expect, it } from "vitest";
import {
  defaultAiInlineSettings,
  normalizeAiInlineSettings,
} from "../editor/aiInlineTypes";
import type { ExtractionReview } from "../services/aiExtractionTypes";
import {
  extractionCaptureIdentity,
  extractionConfidence,
  normalizeSourceIdentity,
  statusForConfidence,
  validateExtractionRequest,
} from "../services/aiExtractionValidation";

const SNAPSHOT = {
  kind: "snapshot" as const,
  document_id: "33333333-3333-4333-8333-333333333333",
  revision: 4,
  content_id: "44444444-4444-4444-8444-444444444444",
  sensitive: false,
};

describe("extraction contracts", () => {
  it("extraction_identity_snapshot", () => {
    const identity = normalizeSourceIdentity(SNAPSHOT);
    expect(identity).toEqual(SNAPSHOT);
    expect(JSON.stringify(identity)).toContain(SNAPSHOT.content_id);
    expect(JSON.stringify(identity)).not.toContain("stamp");

    const review = {
      id: "66666666-6666-4666-8666-666666666666",
      revision: 4,
      content_id: SNAPSHOT.content_id,
      sources: [
        {
          id: "99999999-9999-4999-8999-999999999999",
          input: { kind: "snapshot", id: "88888888-8888-4888-8888-888888888888", expected_revision: 4 },
          identity: SNAPSHOT,
          display_name: "letter.pdf",
          page_count: 1,
          sensitive: false,
        },
      ],
    } as unknown as ExtractionReview;
    const capture = extractionCaptureIdentity(review);
    expect(capture.content_id).toBe(SNAPSHOT.content_id);
    expect(capture.identity_keys[0]).toContain(SNAPSHOT.content_id);
    expect(capture.identity_keys[0]).not.toContain("stamp");
  });

  it("extraction_confidence_no_model_claim", () => {
    const confidence = extractionConfidence({
      ocr_certainty: null,
      layout_alignment: 1,
      parser_agreement: 1,
      model_claim: 0.99,
    });
    expect(confidence).toBe(0.5);
    expect(statusForConfidence(confidence)).toBe("uncertain");
    expect(statusForConfidence(0.85)).toBe("certain");
    expect(extractionConfidence({ ocr_certainty: 0.9, layout_alignment: 0.8, parser_agreement: 1 })).toBe(0.8);
  });

  it("inline_defaults_off", () => {
    const defaults = defaultAiInlineSettings();
    expect(defaults.inline_enabled).toBe(false);
    expect(defaults.enabled_types).toEqual({ text: false, markdown: false, code: false });
    expect(normalizeAiInlineSettings({})).toEqual(defaults);
    expect(
      normalizeAiInlineSettings({
        inline_enabled: true,
        enabled_types: { text: true, markdown: true, code: true },
      }),
    ).toEqual({
      inline_enabled: true,
      enabled_types: { text: true, markdown: true, code: true },
    });
  });

  it("extraction_unknown_fields", () => {
    const request = {
      inputs: [
        {
          kind: "document",
          id: "88888888-8888-4888-8888-888888888888",
          expected_revision: 1,
        },
      ],
      kind: "document",
      locale: "en",
      ocr_language: "auto",
      request_revision: 1,
    };
    expect(() => validateExtractionRequest(request)).not.toThrow();
    expect(() => validateExtractionRequest({ ...request, script: "alert(1)" })).toThrow(
      "ai_extract.invalid",
    );
    expect(() =>
      validateExtractionRequest({
        ...request,
        inputs: [{ ...request.inputs[0], token: "secret" }],
      }),
    ).toThrow("ai_extract.invalid");
  });
});
