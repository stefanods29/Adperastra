import { describe, expect, it } from "vitest";
import {
  validateExportSnapshot,
  validateTransferEnvelope,
  validateTransferPayload,
} from "../transfer/transferValidation";
import {
  validateTransferAction,
  validateTransferActions,
  validateTransferReceipt,
} from "../transfer/TransferRegistry";

const DOCUMENT = "11111111-1111-4111-8111-111111111111";
const OTHER_DOCUMENT = "99999999-9999-4999-8999-999999999999";
const SNAPSHOT = "22222222-2222-4222-8222-222222222222";
const CONTENT = "33333333-3333-4333-8333-333333333333";
const TRANSFER = "44444444-4444-4444-8444-444444444444";
const TRANSACTION = "55555555-5555-4555-8555-555555555555";

function snapshot(overrides: Record<string, unknown> = {}): any {
  return {
    snapshot_id: SNAPSHOT,
    document_id: DOCUMENT,
    revision: 7,
    content_id: CONTENT,
    mime: "image/png",
    byte_len: 100,
    storage_policy: "ordinary",
    expires_unix: 2_000_000_000,
    ...overrides,
  };
}

function imageEnvelope(overrides: Record<string, unknown> = {}): any {
  return {
    transfer_id: TRANSFER,
    source_document_id: DOCUMENT,
    source_revision: 7,
    sensitive: false,
    payload: { kind: "image", snapshot: snapshot(), width: 2, height: 2 },
    expires_unix: 2_000_000_000,
    ...overrides,
  };
}

describe("content transfer validation", () => {
  it("refuses_html_and_unknown_action", () => {
    expect(validateTransferPayload({ kind: "rich_text", html: "<b>x</b>" })).toBeNull();
    expect(
      validateTransferPayload({
        kind: "rich_text",
        blocks: [{ kind: "paragraph", runs: [{ text: "x", marks: [] }], depth: 0 }],
        html: "<b>x</b>",
      }),
    ).toBeNull();
    expect(
      validateTransferPayload({
        kind: "rich_text",
        blocks: [{ kind: "html", runs: [], depth: 0 }],
      }),
    ).toBeNull();
    expect(
      validateTransferPayload({
        kind: "rich_text",
        blocks: [
          {
            kind: "paragraph",
            runs: [{ text: "x", marks: [{ kind: "link", href: "https://example.invalid" }] }],
            depth: 0,
          },
        ],
      }),
    ).toBeNull();
    expect(
      validateTransferAction({
        id: "run_command",
        label_key: "transfer.insertText",
        losses: [],
        mutates: true,
      }),
    ).toBeNull();
    expect(
      validateTransferAction({
        id: "insert_text",
        label_key: "transfer.insertText",
        losses: [],
        mutates: true,
        command: "cmd.exe",
      }),
    ).toBeNull();
    const accepted = validateTransferAction({
      id: "insert_rich_text",
      label_key: "transfer.insertRich",
      losses: ["transfer.lossFormatting"],
      mutates: true,
    });
    expect(accepted?.id).toBe("insert_rich_text");
    expect(validateTransferActions([accepted])).toHaveLength(1);
  });

  it("rejects_nonfinite_cells", () => {
    for (const number of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(
        validateTransferPayload({
          kind: "cells",
          rows: [[{ kind: "number", number }]],
          row_count: 1,
          column_count: 1,
        }),
      ).toBeNull();
    }
    expect(
      validateTransferPayload({
        kind: "cells",
        rows: [[{ kind: "number", text: "1.5" }]],
        row_count: 1,
        column_count: 1,
      }),
    ).toBeNull();
    expect(
      validateTransferPayload({
        kind: "cells",
        rows: [[{ kind: "text", number: 1 }]],
        row_count: 1,
        column_count: 1,
      }),
    ).toBeNull();
    expect(
      validateTransferPayload({
        kind: "cells",
        rows: [[{ kind: "text", text: "=1+1", formula: "=1+1" }]],
        row_count: 1,
        column_count: 1,
      }),
    ).toBeNull();
    expect(
      validateTransferPayload({
        kind: "cells",
        rows: [[{ kind: "number", number: 1 }], [{ kind: "number", number: 2 }]],
        row_count: 2,
        column_count: 1,
      }),
    ).not.toBeNull();
    expect(
      validateTransferPayload({
        kind: "cells",
        rows: [[{ kind: "number", number: 1 }]],
        row_count: 1,
        column_count: 2,
      }),
    ).toBeNull();
    const fixture = validateTransferPayload({
      kind: "cells",
      rows: [
        [
          { kind: "text", text: "text0001" },
          { kind: "number", number: 1.5 },
          { kind: "blank" },
          { kind: "boolean", boolean: true },
        ],
        [{ kind: "text", text: "=1+1" }, { kind: "blank" }, { kind: "blank" }, { kind: "blank" }],
      ],
      row_count: 2,
      column_count: 4,
    });
    expect(fixture?.kind).toBe("cells");
    if (fixture?.kind === "cells") {
      expect(fixture.rows[0][1]).toEqual({ kind: "number", number: 1.5 });
      expect(fixture.rows[1][0]).toEqual({ kind: "text", text: "=1+1" });
    }
  });

  it("snapshot_revision_is_immutable", () => {
    const source = imageEnvelope();
    const validated = validateTransferEnvelope(source);
    expect(validated?.payload.kind).toBe("image");
    if (validated?.payload.kind !== "image") return;
    expect(validated.payload.snapshot.revision).toBe(7);
    expect(Object.isFrozen(validated.payload.snapshot)).toBe(true);

    source.payload.snapshot.revision = 8;
    expect(validated.payload.snapshot.revision).toBe(7);
    expect(validateTransferEnvelope(imageEnvelope({ source_revision: 8 }))).toBeNull();
    expect(validateTransferEnvelope(imageEnvelope({ source_document_id: OTHER_DOCUMENT }))).toBeNull();
    expect(validateExportSnapshot(snapshot({ revision: 7 }))?.revision).toBe(7);
  });

  it("sensitive_snapshot_cannot_be_downgraded", () => {
    const validated = validateTransferEnvelope(
      imageEnvelope({ payload: { kind: "image", snapshot: snapshot({ storage_policy: "sensitive" }), width: 2, height: 2 } }),
    );
    expect(validated?.sensitive).toBe(true);
  });

  it("pdf_pages_are_one_based_sorted_and_deduplicated", () => {
    const pdf = snapshot({ mime: "application/pdf" });
    const base = {
      kind: "pdf_pages",
      snapshot: pdf,
      pages: [1, 2],
    };
    expect(validateTransferPayload(base)).not.toBeNull();
    expect(validateTransferPayload({ ...base, pages: [2, 1] })).toBeNull();
    expect(validateTransferPayload({ ...base, pages: [1, 1] })).toBeNull();
    expect(validateTransferPayload({ ...base, pages: [0, 1] })).toBeNull();
    expect(validateTransferPayload({ ...base, snapshot: snapshot({ mime: "image/png" }) })).toBeNull();
    expect(validateTransferPayload({ ...base, pages: Array.from({ length: 101 }, (_, index) => index + 1) })).toBeNull();
  });

  it("receipts_never_carry_raw_bytes", () => {
    const receipt = {
      transaction_id: TRANSACTION,
      target_document_id: DOCUMENT,
      revision: 2,
      inserted_count: 4,
      losses: ["transfer.lossFormula"],
      complete: true,
    };
    expect(validateTransferReceipt(receipt)).not.toBeNull();
    expect(validateTransferReceipt({ ...receipt, bytes: [1, 2, 3] })).toBeNull();
    expect(validateTransferReceipt({ ...receipt, complete: false })).not.toBeNull();
    expect(validateTransferReceipt({ ...receipt, transaction_id: "not-a-uuid" })).toBeNull();
  });
});
