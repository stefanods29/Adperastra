import { describe, expect, it } from "vitest";
import {
  listClipboardHistory,
  patchClipboardHistory,
  resolveClipboardHistory,
  recordAppClipboard,
  validateClipboardHistoryPage,
  validatePatch,
  validateSettings,
  type ClipboardHistoryPatch,
} from "../services/clipboardHistory";

const idA = "6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a";
const idB = "2b1c3d4e-5f60-4712-8a9b-0c1d2e3f4a5b";

function page(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        id: idA,
        kind: "text",
        created_unix: 10,
        source: "app",
        preview: "hello",
        byte_len: 5,
        pinned: false,
        missing: false,
      },
    ],
    complete: true,
    total: 1,
    used_bytes: 5,
    generation: 3,
    ...overrides,
  };
}

describe("clipboard history contracts", () => {
  it("normalizes settings within the documented ranges", () => {
    expect(validateSettings(null)).toMatchObject({
      enabled: true,
      capture_windows: false,
      persist: false,
      max_items: 100,
      max_mib: 64,
    });
    expect(
      validateSettings({ enabled: false, capture_windows: true, persist: true, max_items: 10, max_mib: 8 }),
    ).toEqual({
      enabled: false,
      capture_windows: true,
      persist: true,
      max_items: 10,
      max_mib: 8,
    });
    expect(validateSettings({ max_items: 9, max_mib: 65 })).toMatchObject({
      max_items: 100,
      max_mib: 64,
    });
  });

  it("rejects malformed pages and too many rows", () => {
    expect(validateClipboardHistoryPage(page()).generation).toBe(3);
    const fiftyOne = Array.from({ length: 51 }, (_, index) => ({
      ...page().items[0],
      id: `${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
    }));
    expect(() => validateClipboardHistoryPage(page({ items: fiftyOne }))).toThrow(
      "clipboard_history.invalid",
    );
    expect(() =>
      validateClipboardHistoryPage(
        page({ items: [{ ...page().items[0], preview: "x".repeat(513) }] }),
      ),
    ).toThrow("clipboard_history.invalid");
    expect(() =>
      validateClipboardHistoryPage(page({ next_cursor: "not-a-uuid" })),
    ).toThrow("clipboard_history.invalid");
    expect(() =>
      validateClipboardHistoryPage(page({ items: [{ ...page().items[0], kind: "rich" }] })),
    ).toThrow("clipboard_history.invalid");
  });

  it("validates every patch shape", () => {
    const pin: ClipboardHistoryPatch = {
      kind: "pin",
      id: idA,
      pinned: true,
      expected_generation: 2,
    };
    expect(validatePatch(pin)).toEqual(pin);
    expect(() =>
      validatePatch({ ...pin, id: "bad" } as ClipboardHistoryPatch),
    ).toThrow("clipboard_history.invalid");
    expect(() =>
      validatePatch({
        kind: "remove",
        ids: Array.from({ length: 101 }, () => idA),
        expected_generation: 2,
      }),
    ).toThrow("clipboard_history.invalid");
    expect(
      validatePatch({
        kind: "clear",
        include_pinned: true,
        expected_generation: 2,
      }),
    ).toEqual({ kind: "clear", include_pinned: true, expected_generation: 2 });
  });

  it("refuses oversized searches and malformed ids before invoking", async () => {
    await expect(listClipboardHistory("x".repeat(257))).rejects.toThrow(
      "clipboard_history.invalid",
    );
    await expect(listClipboardHistory("ok", "bad")).rejects.toThrow(
      "clipboard_history.invalid",
    );
    await expect(resolveClipboardHistory("bad")).rejects.toThrow(
      "clipboard_history.invalid",
    );
    await expect(recordAppClipboard("bad")).rejects.toThrow(
      "clipboard_history.invalid",
    );
    await expect(
      patchClipboardHistory({
        kind: "remove",
        ids: [],
        expected_generation: 1,
      }),
    ).rejects.toThrow("clipboard_history.invalid");
  });
});
