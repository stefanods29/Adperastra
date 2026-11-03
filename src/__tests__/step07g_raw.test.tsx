import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import type { JobHandle } from "../services/jobs";
import type { SpecialSession } from "../services/specialViews";
import type { FileTypeInfo } from "../services/files";

const mocks = vi.hoisted(() => ({
  openSpecialView: vi.fn(),
  fullRawPreview: vi.fn(),
  closeSpecialView: vi.fn(),
}));

vi.mock("../services/specialViews", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/specialViews")>();
  return { ...actual, ...mocks };
});

import RawView from "../handlers/raw/RawView";

const info: FileTypeInfo = {
  path: "C:\\Photos\\sample.cr2",
  name: "sample.cr2",
  ext: "cr2",
  mime: "image/x-canon-cr2",
  size: 1024,
  modified_unix: 1_700_000_000,
  online_only: false,
  read_only: true,
  from_internet: false,
};

function session(overrides: Partial<SpecialSession> = {}): SpecialSession {
  return {
    session_id: "11111111-1111-4111-8111-111111111111",
    source: {
      path_key: info.path,
      volume_id: "00000000",
      file_id: "0000000000000000",
      modified_ticks: "1",
      size_bytes: 1024,
    },
    kind: "raw",
    preview: { lease_id: "22222222-2222-4222-8222-222222222222", token: "a".repeat(32), name: "preview.png", mime: "image/png", byte_len: 10, width: 400, height: 300 },
    width: 400,
    height: 300,
    codec_required: false,
    partial: false,
    ...overrides,
  };
}

function job(completion: Promise<SpecialSession>): JobHandle<SpecialSession> {
  return { id: "job", cancel: async () => undefined, completion };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function render(overrides: Partial<ComponentProps<typeof RawView>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const registerSave = vi.fn();
  const props = {
    info,
    url: "http://adpfile.localhost/file",
    active: true,
    savedState: null,
    onStateChange: vi.fn(),
    onStatus: vi.fn(),
    onOpenInWindowsApp: vi.fn(),
    find: { text: "", request: 0, backwards: false },
    protectedView: false,
    registerSave,
    ...overrides,
  } as ComponentProps<typeof RawView>;
  await act(async () => root?.render(<RawView {...props} />));
  return { registerSave };
}

describe("RAW viewer", () => {
  it("uses the embedded preview for the first view", async () => {
    mocks.closeSpecialView.mockResolvedValue(undefined);
    mocks.openSpecialView.mockResolvedValue(job(Promise.resolve(session())));
    const { registerSave } = await render();
    await act(async () => undefined);
    expect(mocks.openSpecialView).toHaveBeenCalledWith(info.path, "raw");
    expect(mocks.fullRawPreview).not.toHaveBeenCalled();
    expect(container?.querySelector("img")?.getAttribute("src")).toContain("a".repeat(32));
    expect(registerSave).not.toHaveBeenCalled();
  });

  it("does not read the full frame until the explicit request", async () => {
    mocks.closeSpecialView.mockResolvedValue(undefined);
    mocks.openSpecialView.mockResolvedValue(job(Promise.resolve(session())));
    await render();
    await act(async () => undefined);
    const button = Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent?.includes("Load full resolution"));
    expect(button).toBeTruthy();
    mocks.fullRawPreview.mockResolvedValue(job(Promise.resolve(session())));
    await act(async () => button?.click());
    expect(mocks.fullRawPreview).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", 4096);
  });

  it("shows the codec notice without registering a save", async () => {
    mocks.closeSpecialView.mockResolvedValue(undefined);
    mocks.openSpecialView.mockResolvedValue(job(Promise.resolve(session({ preview: null, codec_required: true }))));
    const { registerSave } = await render();
    await act(async () => undefined);
    expect(container?.textContent).toContain("codec");
    expect(registerSave).not.toHaveBeenCalled();
  });

  it("never reads an online-only file in the background", async () => {
    mocks.closeSpecialView.mockResolvedValue(undefined);
    await render({ info: { ...info, online_only: true } });
    await act(async () => undefined);
    expect(mocks.openSpecialView).not.toHaveBeenCalled();
  });
});
