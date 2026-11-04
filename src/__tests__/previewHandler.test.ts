import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import type { FileTypeInfo } from "../services/files";
import { previewGrant, previewRevoke } from "../services/previewAccess";
import {
  PreviewGrantStore,
  previewTargetFor,
  previewViewProps,
} from "../preview/previewHandler";

vi.mock("../services/files", () => ({
  fileGrant: vi.fn(),
  fileRevoke: vi.fn(async () => undefined),
  fileUrl: (token: string, name: string) =>
    `http://adpfile.localhost/${token}/${encodeURIComponent(name)}`,
}));

vi.mock("../services/previewAccess", () => ({ previewGrant: vi.fn(), previewRevoke: vi.fn(async () => undefined) }));

const info = (name: string, mime: string, onlineOnly = false): FileTypeInfo => ({
  path: `C:\\F\\${name}`,
  name,
  ext: name.split(".").pop() ?? "",
  mime,
  size: 100,
  modified_unix: 1700000000,
  online_only: onlineOnly,
  read_only: false,
  from_internet: false,
});

const mockedGrant = vi.mocked(previewGrant);
const mockedRevoke = vi.mocked(previewRevoke);

beforeEach(() => {
  mockedGrant.mockReset();
  mockedRevoke.mockClear();
});

describe("preview handler choice", () => {
  it("uses the existing registry for a supported local file", () => {
    const target = previewTargetFor(info("notes.txt", "text/plain"));
    expect(target.kind).toBe("preview");
    if (target.kind === "preview") expect(target.handler.id).toBe("text");
  });

  it("keeps the tile when no handler exists", () => {
    expect(previewTargetFor(info("data.zzz", "application/octet-stream")).kind).toBe(
      "unsupported",
    );
  });

  it("shows the cloud state before choosing a handler", () => {
    expect(previewTargetFor(info("cloud.txt", "text/plain", true)).kind).toBe("cloud");
  });
});

describe("preview view props", () => {
  it("is read-only and never receives mutation callbacks", () => {
    const onOpen = vi.fn(async () => undefined);
    const props = previewViewProps(info("notes.txt", "text/plain"), "url", true, { onOpen });
    expect(props.previewOnly).toBe(true);
    expect(props.savedState).toBeNull();
    expect(props.registerSave).toBeUndefined();
    expect(props.onDirtyChange).toBeUndefined();
    expect(props.onPathChange).toBeUndefined();
    expect(props.find).toEqual({ text: "", request: 0, backwards: false });
    expect(props.protectedView).toBe(false);
  });

  it("keeps protected view for a file from the internet", () => {
    const fromInternet = { ...info("notes.txt", "text/plain"), from_internet: true };
    const props = previewViewProps(fromInternet, "url", true, {
      onOpen: async () => undefined,
    });
    expect(props.protectedView).toBe(true);
  });

  it("opens only through the explicit callback", () => {
    const onOpen = vi.fn(async () => undefined);
    const props = previewViewProps(info("notes.txt", "text/plain"), "url", true, { onOpen });
    expect(onOpen).not.toHaveBeenCalled();
    props.onOpenInWindowsApp();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("preview grants", () => {
  it("revokes the old grant when the path changes", async () => {
    mockedGrant.mockResolvedValueOnce({ token: "a".repeat(32), info: info("a.txt", "text/plain") }).mockResolvedValueOnce({ token: "b".repeat(32), info: info("b.txt", "text/plain") });
    const store = new PreviewGrantStore();
    const first = await store.acquire(info("a.txt", "text/plain"));
    expect(first?.token).toBe("a".repeat(32));
    const second = await store.acquire(info("b.txt", "text/plain"));
    expect(second?.token).toBe("b".repeat(32));
    expect(mockedRevoke).toHaveBeenCalledWith("a".repeat(32));
    store.release();
    expect(mockedRevoke).toHaveBeenCalledWith("b".repeat(32));
    expect(mockedRevoke).toHaveBeenCalledTimes(2);
  });

  it("revokes a late grant instead of showing it", async () => {
    let resolveFirst: (token: string) => void = () => undefined;
    mockedGrant.mockImplementationOnce(
      () => new Promise<{ token: string; info: FileTypeInfo }>((resolve) => (resolveFirst = token => resolve({ token, info: info("a.txt", "text/plain") }))),
    );
    mockedGrant.mockResolvedValueOnce({ token: "b".repeat(32), info: info("b.txt", "text/plain") });
    const store = new PreviewGrantStore();
    const late = store.acquire(info("a.txt", "text/plain"));
    const current = await store.acquire(info("b.txt", "text/plain"));
    expect(current?.token).toBe("b".repeat(32));
    resolveFirst("a".repeat(32));
    expect(await late).toBeNull();
    expect(mockedRevoke).toHaveBeenCalledWith("a".repeat(32));
    store.release();
  });

  it("release is idempotent", () => {
    const store = new PreviewGrantStore();
    store.release();
    store.release();
    expect(mockedRevoke).not.toHaveBeenCalled();
  });
});
