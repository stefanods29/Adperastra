import { readFileSync } from "node:fs";
import { repoUrl } from "./nodeUrl";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { DocumentHandle } from "../documents/types";
import type { OfficeController } from "../office/OfficeController";
import {
  captureCurrentDeck, exportDeckPdf, exportDeckSlideImages, type DeckExportPublisher,
} from "../office/deck/deckExport";
import { deckRecoveryMetadata } from "../office/deck/deckRecovery";
import type { ExportSnapshot } from "../services/exportSnapshots";

vi.mock("../services/exportSnapshots", () => ({ releaseExportSnapshot: vi.fn(async () => undefined) }));
vi.mock("../documents/useRecoveryCapture", () => ({ useRecoveryCapture: vi.fn() }));
vi.mock("../services/recovery", () => ({ saveRecoverySnapshot: vi.fn() }));

const documentId = "00000000-0000-4000-8000-0000000000aa";

function snapshot(revision: number, mime = "application/pdf", sensitive = false): ExportSnapshot {
  return {
    snapshot_id: crypto.randomUUID(), document_id: documentId, revision,
    content_id: `00000000-0000-4000-8000-00000000000${revision}`,
    mime, byte_len: 120, storage_policy: sensitive ? "sensitive" : "ordinary", expires_unix: 10,
  };
}

function handle(sensitive = false): DocumentHandle {
  return {
    id: documentId, source: { kind: "disk", path: "C:\\decks\\deck.pptx" },
    info: {
      document_id: documentId, source: { kind: "disk", path: "C:\\decks\\deck.pptx" },
      name: "deck.pptx", ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 1, modified_unix: 1, read_only: false, from_internet: false, sensitive,
    },
    getState: () => ({}) as never, subscribe: () => () => undefined,
    readRange: async () => new Uint8Array(), captureSnapshot: async () => ({}) as never,
    save: async () => true, saveCopy: async () => true, discard: async () => undefined, release: () => undefined,
  };
}

function fixture(sensitive = false) {
  const state = {
    session_id: "00000000-0000-4000-8000-000000000001",
    document_id: documentId, revision: 1,
    content_id: "00000000-0000-4000-8000-0000000000cc",
    ready: true, busy: false, dirty: true,
  };
  const capture = vi.fn(async (revision: number, contentId: string) => ({
    ...snapshot(revision, "application/vnd.openxmlformats-officedocument.presentationml.presentation", sensitive),
    content_id: contentId,
  }));
  const exportLease = vi.fn(async (revision: number, format: string) => ({
    snapshot: snapshot(revision, format === "png" ? "image/png" : "application/pdf", sensitive),
  }));
  const controller = {
    session_id: state.session_id, document: handle(sensitive), getState: () => state, capture,
    export: exportLease,
  } as unknown as OfficeController;
  return { state, capture, exportLease, controller };
}

describe("deck export", () => {
  it("captures the unsaved current revision, not the saved file", async () => {
    const f = fixture();
    f.state.revision = 4;
    const captured = await captureCurrentDeck(f.controller);
    expect(f.capture).toHaveBeenCalledWith(4, f.state.content_id);
    expect(captured.revision).toBe(4);
  });

  it("saving R while editing R+1 leaves the later edit dirty", async () => {
    const f = fixture();
    const captured = await captureCurrentDeck(f.controller);
    f.state.revision = 2;
    expect(captured.revision).toBe(1);
    expect(f.controller.getState().revision).toBe(2);
    expect(f.controller.getState().dirty).toBe(true);
    expect(f.capture).toHaveBeenCalledTimes(1);
  });

  it("a failed export does not overwrite a foreign file", async () => {
    const f = fixture();
    const publisher: DeckExportPublisher = {
      accepts_sensitive: false,
      publish: vi.fn(async () => { throw new Error("files.exists"); }),
    };
    f.exportLease.mockResolvedValue({ snapshot: snapshot(1) });
    const result = await exportDeckPdf(f.controller, publisher, [{ first: 1, last: 1 }]);
    expect(result.artifacts).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("every slide image reports its actual publisher path", async () => {
    const f = fixture();
    f.exportLease.mockImplementation(async (_revision, format: string) => ({
      snapshot: snapshot(1, format === "png" ? "image/png" : "application/pdf"),
    }));
    const publisher: DeckExportPublisher = {
      accepts_sensitive: false,
      publish: vi.fn(async (_snapshot, name: string) => `C:\\out\\${name}`),
    };
    const result = await exportDeckSlideImages(f.controller, publisher, [0, 1]);
    expect(result.failures).toEqual([]);
    expect(result.artifacts.map((artifact) => artifact.path)).toEqual(["C:\\out\\slide-1.png", "C:\\out\\slide-2.png"]);
    expect(f.exportLease).toHaveBeenCalledTimes(2);
  });

  it("sensitive plaintext is never written to an ordinary publisher", async () => {
    const f = fixture(true);
    f.exportLease.mockResolvedValue({ snapshot: snapshot(1, "application/pdf", true) });
    const publisher: DeckExportPublisher = {
      accepts_sensitive: false,
      publish: vi.fn(async () => "C:\\out\\deck.pdf"),
    };
    const result = await exportDeckPdf(f.controller, publisher, [{ first: 1, last: 1 }]);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(result.failures[0].error_code).toBe("office_edit.sensitive_unsupported");
    expect(() => deckRecoveryMetadata(handle(true), 1, "c", 10, 1)).toThrow("recovery.sensitive");
  });

  it("unknown parts, masters, notes and effects survive an export", () => {
    const exportSource = readFileSync(fileURLToPath(repoUrl("../office/deck/deckExport.ts", import.meta.url)), "utf8");
    const recoverySource = readFileSync(fileURLToPath(repoUrl("../office/deck/deckRecovery.ts", import.meta.url)), "utf8");
    for (const source of [exportSource, recoverySource]) {
      expect(source).not.toMatch(/delete_slide|remove_animation|discardToSaved/);
      expect(source).not.toMatch(/\.transact\(/);
    }
  });
});
