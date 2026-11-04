import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import HexView from "../handlers/hex/HexView";
import type { FileTypeInfo } from "../services/files";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => opts.count * opts.estimateSize(0),
    getVirtualItems: () => Array.from({ length: opts.count }, (_, index) => ({ index, start: index * opts.estimateSize(index), key: index })),
    measure: () => undefined,
  }),
}));

const info: FileTypeInfo = {
  path: "C:\\data\\sample.bin",
  name: "sample.bin",
  ext: "bin",
  mime: "application/octet-stream",
  size: 20,
  modified_unix: 0,
  online_only: false,
  read_only: false,
  from_internet: false,
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
});

describe("hex viewer", () => {
  it("reads the file with a Range request and shows offset, hex and text rows", async () => {
    const fetchMock = vi.fn(async () => new Response(new TextEncoder().encode("ABCDEFGHIJKLMNOPQRST")));
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <HexView
          info={info}
          url="http://adpfile.localhost/0123456789abcdef0123456789abcdef/sample.bin"
          active={true}
          savedState={null}
          onStateChange={() => undefined}
          onStatus={() => undefined}
          onOpenInWindowsApp={() => undefined}
          find={{ text: "", request: 0, backwards: false }}
          protectedView={false}
        />,
      ),
    );
    await act(async () => undefined);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), { headers: { Range: "bytes=0-19" } });
    const rows = container.querySelectorAll(".adp-hex-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("00000000");
    expect(rows[0].textContent).toContain("ABCDEFGHIJKLMNOP");
    expect(rows[1].textContent).toContain("00000010");
    expect(rows[1].textContent).toContain("51 52 53 54");
  });
});
