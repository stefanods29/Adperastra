import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DocumentHandle, DocumentState } from "../documents/types";
import { acquireImageEditor, registerImageSourceDecoder } from "../image-edit/ImageDocument";
import { ImageHistory } from "../image-edit/history";
import { newUuid, type ImageModel } from "../image-edit/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGES = [
  "editing-images",
  "image-crop-resize",
  "image-adjustments",
  "image-markup",
  "image-erasing",
  "image-drawing",
] as const;

describe("image help pages", () => {
  it("alltoolshelp", () => {
    for (const language of ["en", "es"]) {
      for (const page of PAGES) {
        const text = readFileSync(join(root, "help", language, `${page}.md`), "utf8");
        expect(text.length, `${language}/${page}`).toBeGreaterThan(120);
      }
    }
    const drawing = readFileSync(join(root, "help", "en", "image-drawing.md"), "utf8");
    for (const word of ["Brush", "Pen", "Highlighter", "Erase", "shape", "arrow", "text"]) {
      expect(drawing.toLowerCase()).toContain(word.toLowerCase());
    }
    const spanish = readFileSync(join(root, "help", "es", "image-drawing.md"), "utf8");
    for (const word of ["Pincel", "Pluma", "Resaltador", "Borrar", "forma", "flecha", "texto"]) {
      expect(spanish.toLowerCase()).toContain(word.toLowerCase());
    }
    for (const page of PAGES) {
      expect(readFileSync(join(root, "help", "en", `${page}.md`), "utf8")).toContain("See also:");
      expect(readFileSync(join(root, "help", "es", `${page}.md`), "utf8")).toContain("Consulta también:");
    }
  });

  it("metadata_default_keep", () => {
    const text = readFileSync(join(root, "src", "image-edit", "encode.ts"), "utf8");
    expect(text).toContain("metadata_keep?: boolean");
    expect(text).toContain("options.metadata_keep !== false");
    expect(readFileSync(join(root, "help", "en", "editing-images.md"), "utf8").toLowerCase()).toContain("metadata");
  });

  it("protected_apply_refused", async () => {
    const documentId = newUuid();
    registerImageSourceDecoder(async () => ({ width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 255]) }));
    const contentId = newUuid();
    const handle = {
      id: documentId,
      info: {
        document_id: documentId,
        name: "protected.png",
        ext: "png",
        mime: "image/png",
        size: 4,
        modified_unix: 0,
        read_only: true,
        from_internet: true,
        sensitive: false,
      },
      getState: () =>
        ({
          revision: 1,
          saved_revision: 1,
          content_id: contentId,
          saved_content_id: contentId,
          dirty: false,
          ready: true,
          editing_enabled: false,
          can_save_existing: false,
          can_save_copy: true,
          read_only_reason: "protected",
        }) as DocumentState,
      subscribe: () => () => undefined,
      readRange: async () => new Uint8Array(4),
      captureSnapshot: async () =>
        ({
          snapshot_id: newUuid(),
          document_id: documentId,
          revision: 1,
          content_id: contentId,
          mime: "image/png",
          byte_len: 4,
          storage_policy: "ordinary",
          expires_unix: 9_999_999_999,
        }) as ImageModel["source_snapshot"],
      save: async () => false,
      saveCopy: async () => false,
      discard: async () => undefined,
      release: () => undefined,
    } as unknown as DocumentHandle;
    const controller = await acquireImageEditor(handle);
    await expect(
      controller.apply({
        kind: "set_adjustments",
        adjustments: { brightness: 0.1, contrast: 0, saturation: 0, warmth: 0, sharpness: 0, blur: 0, preset: "custom" },
      }),
    ).rejects.toThrow("image_edit.read_only");
    controller.release();
  });

  it("neweredits_dirty_after_oldsave", () => {
    const base = {
      content_id: newUuid(),
      original_tiles: [],
      layers: [],
      masks: [],
      overlays: [],
      metadata: [],
    } as unknown as ImageModel;
    const first = { ...base, content_id: newUuid() } as ImageModel;
    const second = { ...base, content_id: newUuid() } as ImageModel;
    const history = new ImageHistory(base);
    history.push(base, first, 0);
    history.markSaved(first.content_id);
    history.push(first, second, 0);
    expect(history.isDirty()).toBe(true);
    history.markSaved(first.content_id);
    expect(history.isDirty()).toBe(true);
    expect(history.undo()?.content_id).toBe(first.content_id);
    expect(history.isDirty()).toBe(false);
  });
});
