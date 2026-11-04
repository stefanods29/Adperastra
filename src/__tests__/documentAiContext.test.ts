import { expect, it } from "vitest";
import { assertDocumentAiUtf16Boundary } from "../office/document/ai/documentAiContext";

it("ai_surrogate_boundary", () => {
  expect(() => assertDocumentAiUtf16Boundary("a😀b", 2)).toThrow("document_ai.invalid");
  expect(() => assertDocumentAiUtf16Boundary("a😀b", 1)).not.toThrow();
  expect(() => assertDocumentAiUtf16Boundary("a😀b", 3)).not.toThrow();
  expect(() => assertDocumentAiUtf16Boundary("a😀b", 5)).toThrow();
  expect(() => assertDocumentAiUtf16Boundary("a😀b", 1.5)).toThrow();
});
