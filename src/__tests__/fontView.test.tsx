import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import FontView from "../handlers/font/FontView";
import type { FileTypeInfo } from "../services/files";
import { fontInfo, fontInstall, type FontInfo } from "../services/fontView";
import type { JobHandle } from "../services/jobs";

vi.mock("../services/fontView", () => ({
  fontInfo: vi.fn(),
  fontInstall: vi.fn(),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => opts.count * opts.estimateSize(0),
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        index,
        start: index * opts.estimateSize(index),
        size: opts.estimateSize(index),
        key: index,
      })),
    measure: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

const info: FileTypeInfo = {
  path: "C:\\Windows\\Fonts\\sample.ttf",
  name: "sample.ttf",
  ext: "ttf",
  mime: "font/ttf",
  size: 2048,
  modified_unix: 0,
  online_only: false,
  read_only: false,
  from_internet: false,
};

function fontDetails(patch: Partial<FontInfo> = {}): FontInfo {
  return {
    format: "ttf",
    family: "Sample",
    style: "Regular",
    full_name: null,
    version: "1.0",
    designer: null,
    copyright: null,
    license: null,
    glyphs: 3,
    weight: 400,
    italic: false,
    monospaced: false,
    faces: 1,
    ranges: [[65, 67]],
    ranges_cut: false,
    code_points: 3,
    ...patch,
  };
}

function handle<T>(result: T): JobHandle<T> {
  return {
    id: "job",
    cancel: vi.fn(async () => undefined),
    completion: Promise.resolve(result),
  };
}

let loadFails = false;

class FakeFontFace {
  family: string;

  constructor(family: string, _source: ArrayBuffer) {
    this.family = family;
  }

  async load(): Promise<FakeFontFace> {
    if (loadFails) throw new Error("font.unreadable");
    return this;
  }
}

const addFace = vi.fn();
const removeFace = vi.fn();

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
  });
}

async function render(protectedView = false): Promise<void> {
  await act(async () =>
    root?.render(
      <FontView
        info={info}
        url="http://adpfile.localhost/token/sample.ttf"
        active={true}
        savedState={null}
        onStateChange={() => undefined}
        onStatus={() => undefined}
        onOpenInWindowsApp={() => undefined}
        find={{ text: "", request: 0, backwards: false }}
        protectedView={protectedView}
      />,
    ),
  );
  await flush();
}

beforeEach(() => {
  loadFails = false;
  vi.stubGlobal("FontFace", FakeFontFace);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([0, 1, 2]))),
  );
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { add: addFace, delete: removeFace },
  });
  vi.mocked(fontInfo).mockResolvedValue(handle(fontDetails()));
  vi.mocked(fontInstall).mockResolvedValue(true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("font view", () => {
  it("draws the six sample sizes", async () => {
    await render();
    expect(container!.querySelectorAll(".adp-font-sample")).toHaveLength(6);
  });

  it("shows names from the details", async () => {
    await render();
    expect(container!.textContent).toContain("Sample");
    expect(container!.textContent).toContain("1.0");
  });

  it("a WOFF font says there is no map", async () => {
    vi.mocked(fontInfo).mockResolvedValue(handle(fontDetails({ format: "woff", ranges: [], code_points: 0 })));
    await render();
    expect(container!.textContent).toContain("isn't available");
  });

  it("Install asks first, and Cancel does nothing", async () => {
    await render();
    const install = [...container!.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Install"),
    );
    expect(install).toBeDefined();
    await act(async () => install?.click());
    expect(container!.textContent).toContain("Install this font?");
    const cancel = [...container!.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Cancel",
    );
    await act(async () => cancel?.click());
    expect(fontInstall).not.toHaveBeenCalled();
  });

  it("Install is disabled in protected view", async () => {
    await render(true);
    const install = container!.querySelector<HTMLButtonElement>(".adp-ribbon-btn");
    expect(install).not.toBeNull();
    expect(install?.disabled).toBe(true);
  });

  it("removes the font on close", async () => {
    await render();
    expect(addFace).toHaveBeenCalled();
    await act(async () => root?.unmount());
    root = null;
    expect(removeFace).toHaveBeenCalled();
  });

  it("a bad font shows the error", async () => {
    loadFails = true;
    await render();
    expect(container!.textContent).toContain("couldn't be shown");
  });
});
