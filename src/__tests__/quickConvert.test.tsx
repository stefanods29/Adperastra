vi.mock("../services/previewAccess", () => ({
  previewGrant: vi.fn(async () => ({ token: "a".repeat(32), info: {} })),
  previewRevoke: vi.fn(async () => undefined),
}));
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { ConversionProvider } from "../convert/ConversionContext";
import QuickConvertDialog from "../convert/QuickConvertDialog";
import type { ConversionInput, ConversionReport } from "../convert/types";
import { UndoStack } from "../services/undo";
import type { TrackJob, TrackJobOptions } from "../views/explorer/JobsPanel";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => ({
    getTotalSize: () => options.count * 28,
    getVirtualItems: () =>
      Array.from({ length: Math.min(options.count, 40) }, (_, index) => ({
        index,
        start: index * 28,
        size: 28,
        key: index,
      })),
  }),
}));

vi.mock("../services/convert", () => ({
  previewConversion: vi.fn(),
  startConversion: vi.fn(),
  collectReportPages: vi.fn(),
  conversionPage: vi.fn(),
}));
vi.mock("../services/files", () => ({
  fileGrant: vi.fn(async () => "a".repeat(32)),
  fileRevoke: vi.fn(async () => undefined),
  fileUrl: (token: string, name: string) => `http://adpfile.localhost/${token}/${name}`,
}));
vi.mock("../services/templates", () => ({
  templatesPickFolder: vi.fn(async () => null),
}));
vi.mock("../services/cache", () => ({
  releaseCacheLease: vi.fn(async () => undefined),
}));

import { previewConversion, startConversion } from "../services/convert";
import { previewGrant } from "../services/previewAccess";

const lease = {
  lease_id: "lease",
  token: "a".repeat(32),
  name: "preview.png",
  mime: "image/png",
  byte_len: 10,
  width: 100,
  height: 50,
};

function previewFor(revision: number) {
  return {
    image: lease,
    input_revision: revision,
    width: 100,
    height: 50,
    estimated_bytes: 1000,
    estimated_ms: 120,
    warnings: [],
    metadata_lost: [],
  };
}

function report(overrides: Partial<ConversionReport> = {}): ConversionReport {
  return {
    report_id: "report",
    items: [],
    outputs: [],
    created_paths: [],
    input_total: 1,
    done_count: 1,
    failed_count: 0,
    skipped_count: 0,
    cancelled_count: 0,
    outputs_created: 0,
    cancelled: false,
    job_finished: true,
    complete: true,
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let onCompleted: ReturnType<typeof vi.fn<(report: ConversionReport) => void>>;
let onClose: ReturnType<typeof vi.fn<() => void>>;
let onOpenHelp: ReturnType<typeof vi.fn<(slug: string) => void>>;
let trackJob: TrackJob;

function render(inputs: ConversionInput[], initialConverter?: string) {
  onCompleted = vi.fn();
  onClose = vi.fn();
  onOpenHelp = vi.fn();
  const trackJobMock = vi.fn(async (options: unknown) => {
    const typed = options as TrackJobOptions<ConversionReport>;
    const job = await typed.start(() => undefined);
    return await job.completion;
  });
  trackJob = trackJobMock as unknown as TrackJob;
  const environment = {
    trackJob,
    notify: vi.fn(),
    notifyAction: vi.fn(),
    notifyError: vi.fn(),
    undoStack: new UndoStack(),
    touchUndo: vi.fn(),
    currentFolder: () => "C:\\Pictures",
    showResult: vi.fn(),
  };
  act(() => {
    root?.render(
      <ConversionProvider value={environment}>
        <QuickConvertDialog
          inputs={inputs}
          onClose={onClose}
          onCompleted={onCompleted}
          onOpenHelp={onOpenHelp}
          initialConverter={initialConverter}
        />
      </ConversionProvider>,
    );
  });
  return trackJobMock;
}

beforeEach(() => {
  vi.mocked(previewConversion).mockReset();
  vi.mocked(startConversion).mockReset();
  vi.mocked(previewGrant).mockClear();
  vi.mocked(previewConversion).mockImplementation(async (request) => ({
    id: "preview-job",
    cancel: async () => undefined,
    completion: Promise.resolve(previewFor(request.request_revision)),
  }));
  vi.mocked(startConversion).mockImplementation(async () => ({
    id: "convert-job",
    cancel: async () => undefined,
    completion: Promise.resolve(report()),
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function ready() {
  await act(async () => {
    for (let step = 0; step < 12; step += 1) await Promise.resolve();
  });
}

describe("Quick Convert dialog", () => {
  it("mixed PNG and JPEG show only the formats that accept both", async () => {
    render([
      { kind: "file", path: "C:\\Pictures\\one.png" },
      { kind: "file", path: "D:\\Other\\two.jpg" },
    ]);
    await ready();
    const labels = [...(container?.querySelectorAll("#adp-convert-format option") ?? [])].map(
      (option) => option.textContent,
    );
    expect(labels).toContain("PNG");
    expect(labels).toContain("JPEG");
    expect(labels).not.toContain("SVG");
    const destination = [...(container?.querySelectorAll<HTMLInputElement>("input") ?? [])].find((input) => input.getAttribute("aria-label") === i18n.t("convert.destination"));
    expect(destination?.value).toBe("");
  });

  it("destination, Convert and Cancel are keyboard-reachable controls", async () => {
    render([{ kind: "file", path: "C:\\Pictures\\one.png" }]);
    await ready();
    const destination = [...(container?.querySelectorAll<HTMLInputElement>("input") ?? [])].find((input) => input.getAttribute("aria-label") === i18n.t("convert.destination"));
    expect(destination).not.toBeNull();
    expect(destination?.value).toBe("C:\\Pictures");
    const buttons = [...(container?.querySelectorAll("button") ?? [])];
    const convert = buttons.find((button) => button.textContent === "Convert");
    const cancel = buttons.find((button) => button.textContent === "Cancel");
    expect(convert).toBeDefined();
    expect(cancel).toBeDefined();
    expect(convert?.disabled).toBe(false);
    expect(convert?.getAttribute("type")).toBe("button");
    expect(cancel?.getAttribute("type")).toBe("button");
    expect(container?.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("converts images to PDF without a native preview after accepting the static losses", async () => {
    render([{ kind: "file", path: "C:\\Pictures\\one.png" }], "images/pdf");
    await ready();
    expect(vi.mocked(previewConversion)).not.toHaveBeenCalled();
    const convertButton = () =>
      [...(container?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent === "Convert",
      );
    expect(convertButton()?.disabled).toBe(true);
    const accept = container?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(accept).not.toBeNull();
    act(() => accept?.click());
    expect(convertButton()?.disabled).toBe(false);
    await act(async () => {
      convertButton()?.click();
      await Promise.resolve();
    });
    const request = vi.mocked(startConversion).mock.calls[0][0];
    expect(request.converter_id).toBe("images/pdf");
    expect(request.options).toMatchObject({
      kind: "document",
      value: { page_size: "source", margin_mm: 20 },
    });
    expect(request.accepted_losses).toContain("exif");
  });

  it("retries only the failed input, never an item that already finished", async () => {
    vi.mocked(startConversion)
      .mockImplementationOnce(async () => ({
        id: "first",
        cancel: async () => undefined,
        completion: Promise.resolve(
          report({
            input_total: 2,
            done_count: 1,
            failed_count: 1,
            items: [
              { input_index: 0, output_count: 1, status: "done", metadata_lost: [], bytes_written: 3 },
              { input_index: 1, output_count: 0, status: "failed", reason: "unsupported", metadata_lost: [], bytes_written: 0 },
            ],
          }),
        ),
      }))
      .mockImplementationOnce(async () => ({
        id: "second",
        cancel: async () => undefined,
        completion: Promise.resolve(report()),
      }));
    render([
      { kind: "file", path: "C:\\Pictures\\one.png" },
      { kind: "file", path: "C:\\Pictures\\two.png" },
    ]);
    await ready();
    const convert = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Convert",
    );
    await act(async () => {
      convert?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const retry = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Retry failed files",
    );
    expect(retry).toBeDefined();
    await act(async () => {
      retry?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const requests = vi.mocked(startConversion).mock.calls.map(([request]) => request);
    expect(requests).toHaveLength(2);
    expect(requests[1].inputs).toHaveLength(1);
    expect(requests[1].inputs[0]).toEqual({ kind: "file", path: "C:\\Pictures\\two.png" });
  });

  it("an unsaved capture uses the immutable snapshot, not the disk file", async () => {
    render([
      { kind: "snapshot", snapshot_id: "11111111-1111-1111-1111-111111111111", document_id: "doc", revision: 1 },
    ]);
    await ready();
    expect(vi.mocked(previewGrant)).not.toHaveBeenCalled();
    const previewRequest = vi.mocked(previewConversion).mock.calls[0][0];
    expect(previewRequest.inputs[0].kind).toBe("snapshot");
    const destination = [...(container?.querySelectorAll<HTMLInputElement>("input") ?? [])].find((input) => input.getAttribute("aria-label") === i18n.t("convert.destination"));
    expect(destination).toBeDefined();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(destination, "C:\\Pictures");
      destination?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const convert = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Convert",
    );
    await act(async () => {
      convert?.click();
      await Promise.resolve();
    });
    const request = vi.mocked(startConversion).mock.calls[0][0];
    expect(request.inputs[0].kind).toBe("snapshot");
  });

  it("a metadata-failed preview keeps Convert disabled until it is resolved", async () => {
    vi.mocked(previewConversion).mockReset();
    vi.mocked(previewConversion)
      .mockRejectedValueOnce(new Error("convert.metadata_loss"))
      .mockImplementationOnce(async (request) => ({
        id: "retry-preview",
        cancel: async () => undefined,
        completion: Promise.resolve({
          ...previewFor(request.request_revision),
          metadata_lost: ["icc" as const],
        }),
      }));
    render([{ kind: "file", path: "C:\\Pictures\\one.png" }]);
    await ready();
    const convertButton = () =>
      [...(container?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent === "Convert",
      );
    expect(convertButton()?.disabled).toBe(true);
    const retryPreview = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Preview",
    );
    await act(async () => {
      retryPreview?.click();
      for (let step = 0; step < 8; step += 1) await Promise.resolve();
    });
    expect(convertButton()?.disabled).toBe(true);
    const accept = container?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(accept).not.toBeNull();
    act(() => accept?.click());
    expect(convertButton()?.disabled).toBe(false);
  });

  it("turning keep-original off is refused with the exact notice", async () => {
    render([{ kind: "file", path: "C:\\Pictures\\one.png" }]);
    await ready();
    const toggle = [...(container?.querySelectorAll<HTMLButtonElement>('button[role="switch"]') ?? [])].find((button) => button.getAttribute("aria-label") === i18n.t("convert.keepOriginal"));
    act(() => toggle?.click());
    expect(container?.textContent).toContain(
      "Choose a new file name. Replacing files is not available yet.",
    );
    const convert = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Convert",
    );
    await act(async () => {
      convert?.click();
      await Promise.resolve();
    });
    expect(vi.mocked(startConversion).mock.calls[0][0].keep_original).toBe(true);
  });
});
