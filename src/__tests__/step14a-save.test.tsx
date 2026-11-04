import { afterEach, describe, expect, it } from "vitest";
import {
  pdfEditRegistry,
  registerPdfEditSourceLoader,
  resetPdfEditSourceLoaderForTests,
} from "../pdf-edit/PdfEditRegistry";
import {
  assertPdfEditSaveMode,
  pdfEditSaveModeError,
  registerPdfEditSerializeHost,
  resetPdfEditSerializeHostForTests,
  serializePdfEdit,
  type PdfEditHostSerializeRequest,
} from "../pdf-edit/serialize";
import { makeCapabilities, makeContext, makeDocument, makeInspection, makeModel, makePage, makeSnapshot, makeAnnotation } from "./pdfEditFixtures";

function outcomeFor(request: PdfEditHostSerializeRequest) {
  return {
    snapshot: makeSnapshot({ revision: request.revision, content_id: request.content_id, byte_len: 4096 }),
    inspection: {
      page_count: request.model.pages.length,
      annotation_count: request.model.annotations.length,
      forms: request.model.forms,
      unknown_annotations_preserved: true,
      dropped_structures: [],
    },
  };
}

async function setup() {
  registerPdfEditSourceLoader(async () => makeInspection({ pages: [makePage()] }));
  const doc = makeDocument();
  const context = makeContext(doc);
  const controller = await pdfEditRegistry.acquirePdfEditor(doc, context);
  await controller.apply({ kind: "add_annotation", annotation: makeAnnotation() });
  return { doc, context, controller };
}

afterEach(() => {
  resetPdfEditSourceLoaderForTests();
  resetPdfEditSerializeHostForTests();
  pdfEditRegistry.resetForTests();
});

describe("revision-safe capture and save controls", () => {
  it("savecopy_does_not_clean_original", async () => {
    const { doc, controller } = await setup();
    registerPdfEditSerializeHost({ serialize: async (request) => outcomeFor(request) });
    const state = doc.getState();
    const snapshot = await controller.capture(state.revision, state.content_id);
    expect(snapshot.revision).toBe(state.revision);
    expect(snapshot.content_id).toBe(state.content_id);
    expect(doc.getState().saved_revision).toBe(1);
    expect(doc.getState().dirty).toBe(true);
    expect(controller.getModel().content_id).toBe(state.content_id);
    controller.release();
  });

  it("signature_change_requires_copy", () => {
    const capabilities = makeCapabilities({ signature_present: true });
    expect(pdfEditSaveModeError(capabilities, false, "save")).toBe("pdf_edit.signature_change");
    expect(pdfEditSaveModeError(capabilities, true, "save")).toBe("pdf_edit.signature_change");
    expect(pdfEditSaveModeError(capabilities, false, "copy")).toBeNull();
    expect(() => assertPdfEditSaveMode(capabilities, false, "save")).toThrow("pdf_edit.signature_change");
    expect(() => assertPdfEditSaveMode(capabilities, false, "copy")).not.toThrow();
  });

  it("failed_save_keeps_model", async () => {
    const { doc, controller } = await setup();
    registerPdfEditSerializeHost({
      serialize: async () => {
        throw new Error("pdf_edit.failed");
      },
    });
    const before = controller.getModel();
    await expect(controller.capture(doc.getState().revision, doc.getState().content_id)).rejects.toThrow(
      "pdf_edit.failed",
    );
    expect(controller.getModel()).toBe(before);
    expect(doc.getState().dirty).toBe(true);
    controller.release();
  });

  it("unsupported_structure_not_silently_dropped", async () => {
    const { doc, controller } = await setup();
    registerPdfEditSerializeHost({
      serialize: async (request) => ({
        ...outcomeFor(request),
        inspection: { ...outcomeFor(request).inspection, dropped_structures: ["outline"] },
      }),
    });
    await expect(controller.capture(doc.getState().revision, doc.getState().content_id)).rejects.toThrow(
      "pdf_edit.unsupported",
    );
    expect(controller.getModel().annotations).toHaveLength(1);
    controller.release();
  });

  it("revoked_provider_cannot_capture", async () => {
    const { doc, controller } = await setup();
    registerPdfEditSerializeHost({ serialize: async (request) => outcomeFor(request) });
    doc.setState({ ...doc.getState(), status_code: "documents.provider_missing" });
    await expect(controller.capture(doc.getState().revision, doc.getState().content_id)).rejects.toThrow(
      "pdf_edit.changed",
    );
    controller.release();
  });

  it("source_mime_does_not_reject_valid_pdf_capture", async () => {
    registerPdfEditSerializeHost({ serialize: async (request) => outcomeFor(request) });
    const model = makeModel({ source_snapshot: makeSnapshot({ mime: "application/octet-stream" }) });
    const snapshot = await serializePdfEdit(model, 1, model.content_id);
    expect(snapshot.mime).toBe("application/pdf");
    expect(snapshot.byte_len).toBe(4096);
  });

  it("capture_tuple_frozen_before_encode", async () => {
    const { doc, controller } = await setup();
    let requestSeen: PdfEditHostSerializeRequest | null = null;
    let resolveHost!: () => void;
    registerPdfEditSerializeHost({
      serialize: (request) => {
        requestSeen = request;
        return new Promise((resolve) => {
          resolveHost = () => resolve(outcomeFor(request));
        });
      },
    });
    const revision = doc.getState().revision;
    const contentId = doc.getState().content_id;
    const capturing = controller.capture(revision, contentId);
    await controller.apply({
      kind: "add_annotation",
      annotation: makeAnnotation({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", kind: "ink", quads: undefined, strokes: [[{ x: 5, y: 5 }, { x: 25, y: 30 }]], rect: { x: 5, y: 5, width: 20, height: 25 } }),
    });
    resolveHost?.();
    const snapshot = await capturing;
    expect((requestSeen as PdfEditHostSerializeRequest | null)?.revision).toBe(revision);
    expect((requestSeen as PdfEditHostSerializeRequest | null)?.content_id).toBe(contentId);
    expect((requestSeen as PdfEditHostSerializeRequest | null)?.model.content_id).toBe(contentId);
    expect(snapshot.revision).toBe(revision);
    expect(snapshot.content_id).toBe(contentId);
    expect(controller.getModel().content_id).not.toBe(contentId);
    controller.release();
  });
});
