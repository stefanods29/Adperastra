import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import type { JobHandle } from "../services/jobs";
import type { PsdInfo, SpecialSession } from "../services/specialViews";
import type { FileTypeInfo } from "../services/files";

const mocks = vi.hoisted(() => ({
  openSpecialView: vi.fn(),
  psdLayers: vi.fn(),
  closeSpecialView: vi.fn(),
}));

vi.mock("../services/specialViews", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/specialViews")>();
  return { ...actual, ...mocks };
});

import PsdView from "../handlers/psd/PsdView";

const info: FileTypeInfo = {
  path: "C:\\Design\\sample.psd",
  name: "sample.psd",
  ext: "psd",
  mime: "image/vnd.adobe.photoshop",
  size: 2048,
  modified_unix: 1_700_000_000,
  online_only: false,
  read_only: true,
  from_internet: false,
};

function session(overrides: Partial<SpecialSession> = {}): SpecialSession {
  return {
    session_id: "33333333-3333-4333-8333-333333333333",
    source: { path_key: info.path, volume_id: "00000000", file_id: "0000000000000000", modified_ticks: "1", size_bytes: 2048 },
    kind: "psd",
    preview: null,
    width: 800,
    height: 600,
    codec_required: false,
    partial: false,
    ...overrides,
  };
}

function page(layers: PsdInfo["layers"], complete: boolean): PsdInfo {
  return { session: session(), layers, next_cursor: complete ? null : "cursor-1", complete };
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

async function render(overrides: Partial<ComponentProps<typeof PsdView>> = {}) {
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
  } as ComponentProps<typeof PsdView>;
  await act(async () => root?.render(<PsdView {...props} />));
  return { registerSave };
}

describe("PSD viewer", () => {
  it("explains a missing composite instead of inventing one", async () => {
    mocks.closeSpecialView.mockResolvedValue(undefined);
    mocks.openSpecialView.mockResolvedValue(job(Promise.resolve(session())));
    mocks.psdLayers.mockResolvedValue(page([], true));
    const { registerSave } = await render();
    await act(async () => undefined);
    expect(container?.textContent).toContain("composite");
    expect(registerSave).not.toHaveBeenCalled();
  });

  it("renders escaped layer names as text", async () => {
    mocks.closeSpecialView.mockResolvedValue(undefined);
    mocks.openSpecialView.mockResolvedValue(job(Promise.resolve(session())));
    mocks.psdLayers.mockResolvedValue(page([
      { id: 0, parent: null, name: "<img src=x onerror=alert(1)>", visible: true, opacity: 0.5, children_count: 0 },
    ], true));
    const { registerSave } = await render();
    await act(async () => undefined);
    const panel = container?.querySelector(".adp-psd-layers");
    expect(panel?.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(panel?.querySelector("img")).toBeNull();
    expect(registerSave).not.toHaveBeenCalled();
  });
});
