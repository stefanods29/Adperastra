import { afterEach, describe, expect, it, vi } from "vitest";
import { stateAfterSave } from "../documents/types";
import {
  pdfEditRegistry,
  registerPdfEditSourceLoader,
  resetPdfEditSourceLoaderForTests,
} from "../pdf-edit/PdfEditRegistry";
import { renderPixelToPdfPoint } from "../pdf-edit/model";
import {
  buildPdfInputForModel,
  registerPdfEditSerializeHost,
  resetPdfEditSerializeHostForTests,
  type PdfEditHostSerializeRequest,
} from "../pdf-edit/serialize";
import { pdfEditError } from "../pdf-edit/types";
import {
  ANNOTATION_ID,
  CONTENT_ID,
  DOCUMENT_ID,
  PAGE_ID,
  SECOND_PAGE_ID,
  makeAnnotation,
  makeContext,
  makeDocument,
  makeInspection,
  makePage,
  makeSecondPage,
  makeSnapshot,
} from "./pdfEditFixtures";

function serializeOutcome(request: PdfEditHostSerializeRequest) {
  return {
    snapshot: makeSnapshot({
      revision: request.revision,
      content_id: request.content_id,
      byte_len: 2048,
    }),
    inspection: {
      page_count: request.model.pages.length,
      annotation_count: request.model.annotations.length,
      forms: request.model.forms,
      unknown_annotations_preserved: true,
      dropped_structures: [],
    },
  };
}

afterEach(() => {
  resetPdfEditSourceLoaderForTests();
  resetPdfEditSerializeHostForTests();
  pdfEditRegistry.resetForTests();
});

describe("shared immutable PDF edit model", () => {
  it("two_views_share_one_model", async () => {
    registerPdfEditSourceLoader(async () => makeInspection({ pages: [makePage()] }));
    const doc = makeDocument();
    const context = makeContext(doc);
    const first = await pdfEditRegistry.acquirePdfEditor(doc, context);
    const second = await pdfEditRegistry.acquirePdfEditor(doc, context);
    expect(second).toBe(first);
    const listener = vi.fn();
    second.subscribe(listener);
    await first.apply({ kind: "add_annotation", annotation: makeAnnotation() });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(second.getModel().annotations).toHaveLength(1);
    first.release();
    expect(second.getModel().annotations).toHaveLength(1);
    expect(() => second.getCapabilities()).not.toThrow();
    second.release();
  });

  it("protected_apply_refused", async () => {
    registerPdfEditSourceLoader(async () => makeInspection({ pages: [makePage()] }));
    const doc = makeDocument();
    const context = makeContext(doc);
    const controller = await pdfEditRegistry.acquirePdfEditor(doc, context);
    doc.setState({ ...doc.getState(), editing_enabled: false });
    const before = controller.getModel();
    await expect(controller.apply({ kind: "add_annotation", annotation: makeAnnotation() })).rejects.toMatchObject({
      message: "pdf_edit.read_only",
    });
    expect(controller.getModel()).toBe(before);
    expect(controller.getModel().annotations).toHaveLength(0);
    controller.release();
  });

  it("undo_to_saved_clears_dirty", async () => {
    registerPdfEditSourceLoader(async () => makeInspection({ pages: [makePage()] }));
    const doc = makeDocument();
    const context = makeContext(doc);
    const controller = await pdfEditRegistry.acquirePdfEditor(doc, context);
    await controller.apply({ kind: "add_annotation", annotation: makeAnnotation() });
    expect(doc.getState().dirty).toBe(true);
    await controller.undo();
    expect(doc.getState().content_id).toBe(CONTENT_ID);
    expect(doc.getState().saved_content_id).toBe(CONTENT_ID);
    expect(doc.getState().dirty).toBe(false);
    expect(doc.getState().revision).toBe(3);
    controller.release();
  });

  it("captureR_editRplus1_keeps_newer_dirty", async () => {
    registerPdfEditSourceLoader(async () => makeInspection({ pages: [makePage()] }));
    const doc = makeDocument();
    const context = makeContext(doc);
    const controller = await pdfEditRegistry.acquirePdfEditor(doc, context);
    await controller.apply({ kind: "add_annotation", annotation: makeAnnotation() });
    const capturedRevision = doc.getState().revision;
    const capturedContent = doc.getState().content_id;

    let resolveHost!: () => void;
    registerPdfEditSerializeHost({
      serialize: (request) => new Promise((resolve) => {
        resolveHost = () => resolve(serializeOutcome(request));
      }),
    });
    const capture = controller.capture(capturedRevision, capturedContent);
    await controller.apply({
      kind: "add_annotation",
      annotation: makeAnnotation({ id: "88888888-8888-4888-8888-888888888888", kind: "ink", quads: undefined, strokes: [[{ x: 5, y: 5 }, { x: 25, y: 30 }]], rect: { x: 5, y: 5, width: 20, height: 25 } }),
    });
    resolveHost?.();
    const snapshot = await capture;
    expect(snapshot.revision).toBe(capturedRevision);
    expect(snapshot.content_id).toBe(capturedContent);
    expect(controller.getModel().content_id).not.toBe(capturedContent);
    doc.setState(stateAfterSave(doc.getState(), capturedRevision, capturedContent));
    expect(doc.getState().dirty).toBe(true);
    controller.release();
  });

  it("virtual_pdf_uses_snapshot_identity", async () => {
    registerPdfEditSourceLoader(async () => makeInspection({ pages: [makePage()] }));
    const doc = makeDocument();
    const controller = await pdfEditRegistry.acquirePdfEditor(doc, makeContext(doc));
    const input = buildPdfInputForModel(controller.getModel());
    expect(input.kind).toBe("snapshot");
    if (input.kind !== "snapshot") throw new Error("unreachable");
    expect(input.reference.snapshot_id).toBe(makeSnapshot().snapshot_id);
    expect(input.reference.document_id).toBe(DOCUMENT_ID);
    expect(input.reference.revision).toBe(1);
    expect(input.reference.content_id).toBe(CONTENT_ID);
    expect("path" in input.reference).toBe(false);
    controller.release();
  });

  it("stale_pdf_session_response_ignored", async () => {
    registerPdfEditSourceLoader(async () => makeInspection({ pages: [makePage()] }));
    const doc = makeDocument();
    const controller = await pdfEditRegistry.acquirePdfEditor(doc, makeContext(doc));
    const pending: Array<() => void> = [];
    registerPdfEditSerializeHost({
      serialize: (request) => new Promise((resolve) => {
        pending.push(() => resolve(serializeOutcome(request)));
      }),
    });
    const first = controller.capture(1, CONTENT_ID);
    const second = controller.capture(1, CONTENT_ID);
    pending[1]();
    await expect(second).resolves.toBeTruthy();
    pending[0]();
    await expect(first).rejects.toMatchObject({ message: "pdf_edit.changed" });
    controller.release();
  });

  it("render_rotation_uses_resolved_scale", () => {
    const point = renderPixelToPdfPoint(
      {
        info: { page: 1, width_pt: 100, height_pt: 200, rotation: 0 },
        resolved_scale: 2,
        rendered_rotation: 90,
      },
      { crop: { x: 0, y: 0, width: 100, height: 200 } },
      40,
      20,
    );
    expect(point.x).toBeCloseTo(10, 6);
    expect(point.y).toBeCloseTo(20, 6);
  });

  it("reports a stable error for an invalid operation", async () => {
    registerPdfEditSourceLoader(async () => makeInspection({ pages: [makePage(), makeSecondPage()] }));
    const doc = makeDocument();
    const controller = await pdfEditRegistry.acquirePdfEditor(doc, makeContext(doc));
    await expect(controller.apply({ kind: "reorder_pages", ids: [PAGE_ID, PAGE_ID] })).rejects.toThrow(
      "pdf_edit.bad_request",
    );
    controller.release();
  });

  it("annotation identity is unique across the model", async () => {
    registerPdfEditSourceLoader(async () => makeInspection({ pages: [makePage()] }));
    const doc = makeDocument();
    const controller = await pdfEditRegistry.acquirePdfEditor(doc, makeContext(doc));
    await controller.apply({ kind: "add_annotation", annotation: makeAnnotation() });
    await expect(
      controller.apply({ kind: "add_annotation", annotation: makeAnnotation() }),
    ).rejects.toMatchObject({ message: "pdf_edit.bad_request" });
    expect(controller.getModel().annotations.map((entry) => entry.id)).toEqual([ANNOTATION_ID]);
    controller.release();
  });

  it("delete undo restores stable page ids and annotations", async () => {
    const annotation = makeAnnotation({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", page_id: SECOND_PAGE_ID });
    registerPdfEditSourceLoader(async () =>
      makeInspection({
        pages: [makePage(), { ...makeSecondPage(), annotation_ids: [annotation.id] }],
        annotations: [annotation],
        owned_annotation_ids: [annotation.id],
      }),
    );
    const doc = makeDocument();
    const controller = await pdfEditRegistry.acquirePdfEditor(doc, makeContext(doc));
    await controller.apply({ kind: "delete_pages", ids: [SECOND_PAGE_ID] });
    expect(controller.getModel().pages.map((page) => page.id)).toEqual([PAGE_ID]);
    await controller.undo();
    expect(controller.getModel().pages.map((page) => page.id)).toEqual([PAGE_ID, SECOND_PAGE_ID]);
    expect(controller.getModel().annotations.map((entry) => entry.id)).toEqual([annotation.id]);
    expect(controller.getModel().pages[1].annotation_ids).toEqual([annotation.id]);
    controller.release();
  });

  it("keeps the second page after a valid full permutation", async () => {
    registerPdfEditSourceLoader(async () => makeInspection({ pages: [makePage(), makeSecondPage()] }));
    const doc = makeDocument();
    const controller = await pdfEditRegistry.acquirePdfEditor(doc, makeContext(doc));
    await controller.apply({ kind: "reorder_pages", ids: [SECOND_PAGE_ID, PAGE_ID] });
    expect(controller.getModel().pages.map((page) => page.id)).toEqual([SECOND_PAGE_ID, PAGE_ID]);
    controller.release();
    expect(controller.getCapabilities().sensitive_memory_only).toBe(false);
    expect(pdfEditError("pdf_edit.failed").message).toBe("pdf_edit.failed");
  });
});
