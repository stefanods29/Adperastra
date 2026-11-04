import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import MetadataFacts, { formatMetadataDuration } from "../metadata/MetadataFacts";
import { useMetadata } from "../metadata/useMetadata";
import DetailsPane from "../views/explorer/DetailsPane";
import type { ExplorerItem } from "../services/explorer";
import type { MetadataInfo } from "../services/metadata";

vi.mock("../components/PreviewSurface", () => ({
  default: () => null,
  usePreviewInfo: () => null,
}));

vi.mock("../services/metadata", () => ({
  readMetadata: vi.fn(),
  releaseMetadata: vi.fn(async () => undefined),
}));

import { readMetadata, releaseMetadata } from "../services/metadata";

vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));

const mockedRead = vi.mocked(readMetadata);
const mockedRelease = vi.mocked(releaseMetadata);

const item = (name: string): ExplorerItem => ({
  path: `C:\\F\\${name}`,
  name,
  kind: "file",
  size: 2048,
  modified_unix: 1700000000,
  hidden: false,
  system: false,
  is_link: false,
  online_only: false,
  file_id: null,
  file_id_stable: false,
});

const info = (path: string, camera: string): MetadataInfo => ({
  source: {
    path_key: path.toLowerCase(),
    volume_id: "00112233",
    file_id: "8899aabbccddeeff",
    modified_ticks: "133000000000000000",
    size_bytes: 2048,
  },
  fields: [{ id: "camera_model", value: { kind: "text", value: camera } }],
  partial: false,
  missing: [],
});

const handle = (completion: Promise<MetadataInfo>) => ({
  id: "metadata-1",
  cancel: vi.fn(async () => undefined),
  completion,
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  mockedRead.mockReset();
  mockedRelease.mockClear();
  await i18n.changeLanguage("en");
});

async function wait(ms = 200) {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  });
}

function Probe({ path }: { path: string }) {
  const state = useMetadata(path);
  return (
    <div data-status={state.status}>
      {state.info?.fields.map((field) => (field.value.kind === "text" ? field.value.value : "")).join(",")}
    </div>
  );
}

describe("rich metadata", () => {
  it("rapid A to B never shows A's facts", async () => {
    let resolveA: (value: MetadataInfo) => void = () => undefined;
    mockedRead.mockImplementation(async (_requestId, request) => {
      if (request.path.endsWith("a.jpg")) {
        return handle(new Promise<MetadataInfo>((resolve) => (resolveA = resolve)));
      }
      return handle(Promise.resolve(info(request.path, "Model B")));
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<Probe path="C:\\F\\a.jpg" />));
    await wait();
    await act(async () => root?.render(<Probe path="C:\\F\\b.jpg" />));
    await wait();
    expect(container.textContent).toContain("Model B");
    await act(async () => resolveA(info("C:\\F\\a.jpg", "Model A")));
    await wait(20);
    expect(container.textContent).not.toContain("Model A");
    expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("ready");
  });

  it("a failed read leaves the listing facts and history action", async () => {
    mockedRead.mockImplementation(async () => handle(Promise.reject(new Error("background.paused"))));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <DetailsPane
          selected={[item("photo.jpg")]}
          summary={{ count: 1, files: 1, folders: 0, bytes: 2048 }}
          folder={null}
          showExtensions
          typeLabel={() => "JPG file"}
          onCopyPath={() => undefined}
          onOpenHelp={() => undefined}
          onShowHistory={() => undefined}
          onOpen={() => undefined}
        />,
      ),
    );
    await wait();
    expect(container.textContent).toContain("2 KB");
    expect(container.querySelector(".adp-details-grid")).not.toBeNull();
    expect(container.textContent).toContain("Version history");
    expect(container.textContent).toContain("Background preparation is paused.");
    expect(container.querySelector(".adp-metadata-facts")).toBeNull();
    expect(container.querySelector(".adp-metadata-skeleton")).toBeNull();
  });

  it("several selected files show no mixed metadata", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <DetailsPane
          selected={[item("a.jpg"), item("b.jpg")]}
          summary={{ count: 2, files: 2, folders: 0, bytes: 4096 }}
          folder={null}
          showExtensions
          typeLabel={() => "JPG file"}
          onCopyPath={() => undefined}
          onOpenHelp={() => undefined}
          onShowHistory={() => undefined}
          onOpen={() => undefined}
        />,
      ),
    );
    await wait();
    expect(container.textContent).toContain("2 items selected");
    expect(container.querySelector(".adp-metadata")).toBeNull();
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it("shows Spanish labels in the two-column list", async () => {
    await i18n.changeLanguage("es");
    mockedRead.mockResolvedValue(handle(Promise.resolve(info("C:\\F\\camera.jpg", "Contoso"))));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<MetadataFacts item={item("camera.jpg")} />));
    await wait();
    expect(container.textContent).toContain("Modelo de cámara");
    expect(container.querySelector(".adp-metadata-facts dt")).not.toBeNull();
    expect(container.querySelector(".adp-metadata-facts dd")?.textContent).toBe("Contoso");
  });

  it("formats durations with locale units", () => {
    expect(formatMetadataDuration(2000, "en")).toContain("2");
    expect(formatMetadataDuration(125000, "es")).toContain("2");
  });

  it("releases an orphaned consumer when the pane closes", async () => {
    mockedRead.mockResolvedValue(handle(Promise.resolve(info("C:\\F\\a.jpg", "Model A"))));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<MetadataFacts item={item("a.jpg")} />));
    await wait();
    const consumer = mockedRead.mock.calls[0][1].consumer_id;
    await act(async () => root?.unmount());
    root = null;
    expect(mockedRelease).toHaveBeenCalledWith(consumer);
  });
});
