import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import PreviewSurface from "../components/PreviewSurface";
import type { FileTypeInfo } from "../services/files";

vi.mock("../services/files", () => ({
  fileGrant: vi.fn(async () => "a".repeat(32)),
  fileRevoke: vi.fn(async () => undefined),
  fileUrl: (token: string, name: string) => `http://adpfile.localhost/${token}/${name}`,
  fileDetect: vi.fn(),
}));

vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));
vi.mock("../services/previewAccess", () => ({ previewGrant: vi.fn(), previewRevoke: vi.fn(async () => undefined), previewDetect: vi.fn() }));

const info = (
  name: string,
  mime: string,
  onlineOnly = false,
): FileTypeInfo => ({
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

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function render(file: FileTypeInfo) {
  const onOpen = vi.fn(async () => undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(<PreviewSurface info={file} active onOpen={onOpen} onOpenHelp={() => undefined} />),
  );
  return onOpen;
}

describe("read-only preview surface", () => {
  it("offers Open when no handler exists", async () => {
    const onOpen = await render(info("data.zzz", "application/octet-stream"));
    expect(container?.textContent).toContain("No preview is available for this file.");
    expect(container?.querySelector("button")?.textContent).toContain("Open");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows the cloud state for an online-only file without granting it", async () => {
    await render(info("cloud.txt", "text/plain", true));
    expect(container?.textContent).toContain("Open this online-only file to download it.");
    const files = await import("../services/previewAccess");
    expect(vi.mocked(files.previewGrant)).not.toHaveBeenCalled();
  });

  it("opens only when the Open button is chosen", async () => {
    const onOpen = await render(info("data.zzz", "application/octet-stream"));
    const button = Array.from(container?.querySelectorAll("button") ?? []).find((element) =>
      element.textContent?.includes("Open"),
    );
    await act(async () => button?.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
