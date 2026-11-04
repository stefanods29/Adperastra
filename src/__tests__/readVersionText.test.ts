import { ReadableStream as NodeReadableStream } from "node:stream/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readVersionText, VERSION_TEXT_PREVIEW_MAX } from "../versions/readVersionText";

const mocks = vi.hoisted(() => ({ revoke: vi.fn() }));
vi.mock("../services/files", () => ({
  fileGrant: vi.fn(async () => "version-token"),
  fileUrl: () => "http://test/version.txt",
  fileRevoke: mocks.revoke,
}));

afterEach(() => { vi.unstubAllGlobals(); mocks.revoke.mockClear(); });

describe("bounded version text reads", () => {
  it("requests only the preview range and decodes the text", async () => {
    const fetch = vi.fn(async () => new Response("one\ntwo"));
    vi.stubGlobal("fetch", fetch);
    await expect(readVersionText("C:\\notes.txt", "notes.txt")).resolves.toBe("one\ntwo");
    expect(fetch).toHaveBeenCalledWith("http://test/version.txt", {
      signal: undefined,
      headers: { Range: `bytes=0-${VERSION_TEXT_PREVIEW_MAX}` },
    });
    expect(mocks.revoke).toHaveBeenCalledWith("version-token");
  });

  it("stops an oversized response stream and releases its grant", async () => {
    vi.stubGlobal("ReadableStream", NodeReadableStream);
    const cancelled = vi.fn();
    let chunk = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunk += 1;
        controller.enqueue(new Uint8Array(chunk < 3 ? VERSION_TEXT_PREVIEW_MAX / 2 : 1));
      },
      cancel: cancelled,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream)));
    await expect(readVersionText("C:\\notes.txt", "notes.txt")).rejects.toThrow("versions.preview_too_large");
    expect(cancelled).toHaveBeenCalledOnce();
    expect(mocks.revoke).toHaveBeenCalledWith("version-token");
  });

  it("releases its grant when fetching fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unavailable"); }));
    await expect(readVersionText("C:\\notes.txt", "notes.txt")).rejects.toThrow("unavailable");
    expect(mocks.revoke).toHaveBeenCalledWith("version-token");
  });
});
