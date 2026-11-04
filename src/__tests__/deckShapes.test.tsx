import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentHandle } from "../documents/types";
import type { OfficeController } from "../office/OfficeController";
import {
  buildImageShape, buildTableShape, buildTextShape, exceedsGroupDepth, newShapeId,
  normalizeShapeRect, validateGroupDepth, validateShapeRect,
} from "../office/deck/DeckShapeTools";
import { deckTransferTarget } from "../office/deck/deckTransfer";
import type { ExportSnapshot } from "../services/exportSnapshots";
import type { TransferEnvelope } from "../transfer/types";
import type { OfficeSessionState } from "../office/types";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("../services/contentTransfer", () => ({ getTransfer: lookup }));
vi.mock("../office/OfficeController", () => ({ acquireOfficeController: vi.fn(), registerOfficeControllerFactory: vi.fn() }));
vi.mock("../office/officeCompatibility", () => ({
  canOfficeCommand: (state: OfficeSessionState, capability: string) => ({
    enabled: state.mode === "editing" && state.capabilities.includes(capability as never),
    reason_key: null,
  }),
}));

const slide = "00000000-0000-4000-8000-000000000002";
const shape = "00000000-0000-4000-8000-000000000003";
const documentId = "00000000-0000-4000-8000-0000000000aa";

function handle(sensitive = false): DocumentHandle {
  return {
    id: documentId,
    source: { kind: "disk", path: "C:\\decks\\deck.pptx" },
    info: {
      document_id: documentId, source: { kind: "disk", path: "C:\\decks\\deck.pptx" },
      name: "deck.pptx", ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 1, modified_unix: 1, read_only: false, from_internet: false, sensitive,
    },
    getState: () => ({}) as never,
    subscribe: () => () => undefined,
    readRange: async () => new Uint8Array(),
    captureSnapshot: async () => ({}) as never,
    save: vi.fn(async () => true), saveCopy: vi.fn(async () => true),
    discard: vi.fn(async () => undefined), release: vi.fn(),
  };
}

function fixture(payload: TransferEnvelope["payload"], textSpan: OfficeSessionState["selection"] = null) {
  const state = {
    session_id: "00000000-0000-4000-8000-000000000001",
    document_id: documentId, family: "deck", format: "pptx", revision: 4, saved_revision: 1,
    content_id: "00000000-0000-4000-8000-0000000000cc", saved_content_id: "00000000-0000-4000-8000-0000000000dd",
    ready: true, mode: "editing", dirty: true, can_undo: true, can_redo: false,
    capabilities: ["deck_shapes", "deck_slides"],
    selection: textSpan ?? { kind: "deck", slide_ids: [slide], shape_ids: [], text_span: null },
    compatibility: { format: "pptx", entries: [], next_cursor: null, can_preserve_unknown: true, blocks_save: false },
    page_count: 0, sheet_count: 0, slide_count: 3, busy: false, status_key: null,
  } as OfficeSessionState;
  const transact = vi.fn(async (transaction: { transaction_id: string; operations: unknown[] }) => ({
    transaction_id: transaction.transaction_id,
    state: { ...state, revision: 5, document_id: documentId },
    changed: true, affected_ids: [shape], warnings: [],
  }));
  const doc = handle();
  const controller = {
    session_id: state.session_id,
    document: doc,
    getState: () => state,
    transact,
  } as unknown as OfficeController;
  const envelope = {
    transfer_id: "native", sensitive: false, payload,
  } as TransferEnvelope;
  lookup.mockResolvedValue(envelope);
  return { state, transact, doc, envelope, target: deckTransferTarget(controller) };
}

beforeEach(() => vi.clearAllMocks());

describe("deck shapes", () => {
  it("the first shape id is owned by the editor", () => {
    const id = newShapeId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(buildTextShape(id, "Hello").id).toBe(id);
  });

  it("an image keeps the exact immutable snapshot", () => {
    const snapshot = {
      snapshot_id: "00000000-0000-4000-8000-000000000010", document_id: documentId,
      revision: 2, content_id: "00000000-0000-4000-8000-000000000011",
      mime: "image/png", byte_len: 10, storage_policy: "ordinary", expires_unix: 1,
    } as ExportSnapshot;
    const shape = buildImageShape(newShapeId(), snapshot, "alt");
    expect(shape.kind).toBe("image");
    if (shape.kind === "image") expect(shape.image).toBe(snapshot);
  });

  it("table cells are typed strings and formula-like text stays inert", () => {
    const shape = buildTableShape(newShapeId(), [["=1+1", "0001"]]);
    expect(shape.kind).toBe("table");
    if (shape.kind === "table") {
      expect(shape.cells).toEqual([["=1+1", "0001"]]);
      expect(typeof shape.cells[0][0]).toBe("string");
    }
  });

  it("one paste creates one transaction", async () => {
    const f = fixture({ kind: "text", text: "alpha" });
    const receipt = await f.target.accept(f.envelope, "insert_text");
    expect(f.transact).toHaveBeenCalledTimes(1);
    expect(f.transact.mock.calls[0][0].operations).toHaveLength(1);
    expect(receipt).toMatchObject({ inserted_count: 5, complete: true, revision: 5 });
  });

  it("text at the live text box uses insert_text instead of a new shape", async () => {
    const span = {
      kind: "deck" as const, slide_ids: [slide], shape_ids: [shape],
      text_span: {
        anchor: { block_id: shape, offset_utf16: 0 }, focus: { block_id: shape, offset_utf16: 0 }, revision: 4,
      },
    };
    const f = fixture({ kind: "text", text: "beta" }, span);
    await f.target.accept(f.envelope, "insert_text");
    expect(f.transact.mock.calls[0][0].operations[0]).toMatchObject({
      family: "deck", operation: { kind: "insert_text", slide_id: slide, shape_id: shape, text: "beta" },
    });
  });

  it("group depth 17 is refused", () => {
    expect(validateGroupDepth(16)).toBe(true);
    expect(validateGroupDepth(17)).toBe(false);
    expect(exceedsGroupDepth(16)).toBe(true);
    expect(exceedsGroupDepth(15)).toBe(false);
  });

  it("resize with NaN or beyond the caps fails", () => {
    const base = { x_pt: 0, y_pt: 0, width_pt: 10, height_pt: 10, rotation_deg: 0 };
    expect(validateShapeRect({ ...base, width_pt: Number.NaN })).toBe(false);
    expect(validateShapeRect({ ...base, width_pt: 28_801 })).toBe(false);
    expect(validateShapeRect({ ...base, x_pt: 14_401 })).toBe(false);
    expect(normalizeShapeRect({ ...base, height_pt: Number.POSITIVE_INFINITY })).toBeNull();
    expect(validateShapeRect(base)).toBe(true);
  });

  it("copying never discards or saves the original edits", async () => {
    const f = fixture({ kind: "cells", rows: [[{ kind: "text", text: "0001" }]], row_count: 1, column_count: 1 });
    await f.target.accept(f.envelope, "insert_cells");
    expect(f.doc.discard).not.toHaveBeenCalled();
    expect(f.doc.save).not.toHaveBeenCalled();
    expect(f.doc.saveCopy).not.toHaveBeenCalled();
  });

  it("a sensitive payload is not offered to an ordinary target", () => {
    const f = fixture({ kind: "text", text: "secret" });
    expect(f.target.describe({ ...f.envelope, sensitive: true })).toEqual([]);
  });

  it("PDF pages are not faked as images without rendered snapshots", () => {
    const f = fixture({
      kind: "pdf_pages",
      snapshot: { snapshot_id: "00000000-0000-4000-8000-000000000010", document_id: documentId, revision: 1, content_id: "00000000-0000-4000-8000-000000000011", mime: "application/pdf", byte_len: 1, storage_policy: "ordinary", expires_unix: 1 },
      pages: [1],
    });
    expect(f.target.describe(f.envelope)).toEqual([]);
  });
});
