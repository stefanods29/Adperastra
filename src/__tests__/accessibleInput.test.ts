import { describe, expect, it, vi } from "vitest";
import { ClickPickDropController } from "../accessibility/ClickPickDrop";
import { TransferRegistry } from "../transfer/TransferRegistry";
import type {
  TransferAction,
  TransferEnvelope,
  TransferPayload,
  TransferReceipt,
  TransferTarget,
} from "../transfer/types";
import {
  autoplayAllowed,
  completionFeedback,
  defaultAccessibilitySettings,
  posterOnly,
  presentationVisible,
  resolveAccessibility,
  subtitleMeetsContrast,
} from "../services/accessibility";

const TRANSFER_ID = "123e4567-e89b-12d3-a456-426614174000";

function envelope(payload: TransferPayload): TransferEnvelope {
  return {
    transfer_id: TRANSFER_ID,
    sensitive: false,
    payload,
    expires_unix: 1893456000,
  };
}

const insertAction: TransferAction = {
  id: "insert_text",
  label_key: "transfer.insertText",
  losses: [],
  mutates: true,
};

function target(receipts: TransferReceipt[]): TransferTarget {
  return {
    target_id: "editor-1",
    accepted_kinds: ["text"],
    describe: () => [insertAction],
    accept: async () => {
      const receipt: TransferReceipt = {
        transaction_id: TRANSFER_ID,
        inserted_count: 1,
        losses: [],
        complete: true,
      };
      receipts.push(receipt);
      return receipt;
    },
  };
}

describe("click pick and drop (E4)", () => {
  it("pickEsc0changes: cancel releases the lease and mutates nothing", async () => {
    const receipts: TransferReceipt[] = [];
    const registry = new TransferRegistry();
    registry.register(target(receipts));
    const release = vi.fn(async () => undefined);
    const controller = new ClickPickDropController({
      registry,
      targetIds: () => ["editor-1"],
      create: async (_source, payload) => envelope(payload),
      release,
    });
    await controller.pick({ kind: "text", text: "hello" }, null);
    expect(controller.targets().map((a) => a.id)).toEqual(["insert_text"]);
    await controller.cancel();
    expect(receipts).toEqual([]);
    expect(release).toHaveBeenCalledWith(TRANSFER_ID);
    expect(controller.targets()).toEqual([]);
  });

  it("dropreusesnegotiation through the 09c registry accept", async () => {
    const receipts: TransferReceipt[] = [];
    const registry = new TransferRegistry();
    registry.register(target(receipts));
    const release = vi.fn(async () => undefined);
    const controller = new ClickPickDropController({
      registry,
      targetIds: () => ["editor-1"],
      create: async (_source, payload) => envelope(payload),
      release,
    });
    await controller.pick({ kind: "text", text: "hello" }, null);
    const receipt = await controller.drop("editor-1", "insert_text");
    expect(receipt.complete).toBe(true);
    expect(receipts).toHaveLength(1);
    expect(release).toHaveBeenCalledWith(TRANSFER_ID);
  });

  it("drop of an unoffered action fails without touching the target", async () => {
    const receipts: TransferReceipt[] = [];
    const registry = new TransferRegistry();
    registry.register(target(receipts));
    const controller = new ClickPickDropController({
      registry,
      targetIds: () => ["editor-1"],
      create: async (_source, payload) => envelope(payload),
      release: async () => undefined,
    });
    await controller.pick({ kind: "text", text: "hello" }, null);
    await expect(controller.drop("editor-1", "move_files")).rejects.toThrow();
    expect(receipts).toEqual([]);
  });
});

describe("clear presentation (T5)", () => {
  it("simplemodekeepsSettings/help: only advanced presentation hides", () => {
    const simple = { ...defaultAccessibilitySettings(), simple_mode: true };
    expect(presentationVisible(true, simple)).toBe(false);
    expect(presentationVisible(false, simple)).toBe(true);
    expect(presentationVisible(undefined, simple)).toBe(true);
    expect(presentationVisible(true, defaultAccessibilitySettings())).toBe(true);
  });

  it("subtitlecontrast4.5 is required", () => {
    expect(subtitleMeetsContrast(defaultAccessibilitySettings().subtitle)).toBe(true);
    expect(
      subtitleMeetsContrast({
        font_percent: 100,
        text_color: "#999999",
        background_color: "#777777",
        background_opacity: 1,
        position: "bottom",
      }),
    ).toBe(false);
  });

  it("soundalwaysvisual and noautoplayGIFposter", () => {
    const settings = { ...defaultAccessibilitySettings(), completion_sound: true, no_autoplay: true };
    expect(completionFeedback(settings)).toEqual({ sound: true, visual: true });
    expect(completionFeedback(defaultAccessibilitySettings()).visual).toBe(true);
    const system = {
      forced_colors: false,
      reduced_motion: false,
      text_scale: 1,
      double_click_ms: 500,
      generation: 1,
    };
    const effective = resolveAccessibility(settings, 100, system);
    expect(posterOnly(settings, effective)).toBe(true);
    expect(autoplayAllowed(settings, false)).toBe(false);
    expect(autoplayAllowed(defaultAccessibilitySettings(), true)).toBe(false);
    expect(autoplayAllowed(defaultAccessibilitySettings(), false)).toBe(true);
  });
});
