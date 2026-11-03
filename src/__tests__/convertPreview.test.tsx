import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import ConversionPreviewView from "../convert/ConversionPreview";
import { APP_CONVERTERS } from "../convert/registry";
import type { ConversionInput, ConverterSpec, ConvertOptions, ImageOptions } from "../convert/types";
import { defaultImageOptions } from "../convert/types";
import { useConversionPreview } from "../convert/useConversionPreview";
import type { ConversionPreview } from "../services/convert";

vi.mock("../services/convert", () => ({
  previewConversion: vi.fn(),
}));
vi.mock("../services/cache", () => ({
  releaseCacheLease: vi.fn(async () => undefined),
}));

import { previewConversion } from "../services/convert";
import { releaseCacheLease } from "../services/cache";

const png = APP_CONVERTERS.find((spec) => spec.id === "image/png")! as ConverterSpec;
const inputs: ConversionInput[] = [{ kind: "file", path: "C:\\Pictures\\photo.png" }];

function options(quality: number): ConvertOptions {
  const value: ImageOptions = { ...defaultImageOptions(quality) };
  return { kind: "image", value };
}

function lease(id: string) {
  return {
    lease_id: id,
    token: "a".repeat(32),
    name: "preview.png",
    mime: "image/png",
    byte_len: 10,
    width: 100,
    height: 50,
  };
}

function preview(revision: number, id: string): ConversionPreview {
  return {
    image: lease(id),
    input_revision: revision,
    width: 100,
    height: 50,
    estimated_bytes: 10,
    estimated_ms: 120,
    warnings: [],
    metadata_lost: [],
  };
}

function deferred(revision: number, id: string) {
  let resolve!: (value: ConversionPreview) => void;
  let reject!: (error: unknown) => void;
  const completion = new Promise<ConversionPreview>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const cancel = vi.fn(async () => undefined);
  return {
    handle: { id: `job-${revision}`, cancel, completion },
    cancel,
    resolve: () => resolve(preview(revision, id)),
    reject,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Probe({
  converter,
  value,
}: {
  converter: ConverterSpec;
  value: ConvertOptions;
}) {
  const api = useConversionPreview({ inputs, converter, options: value });
  return (
    <span>
      {api.state.status}:{api.state.preview?.input_revision ?? ""}
    </span>
  );
}

beforeEach(() => {
  vi.mocked(previewConversion).mockReset();
  vi.mocked(releaseCacheLease).mockReset().mockResolvedValue(undefined);
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

async function render(value: ConvertOptions) {
  await act(async () => {
    root?.render(<Probe converter={png} value={value} />);
  });
}

describe("conversion preview", () => {
  it("shows option revision 2 when its completion arrives before revision 1", async () => {
    const first = deferred(1, "lease-1");
    const second = deferred(2, "lease-2");
    vi.mocked(previewConversion)
      .mockResolvedValueOnce(first.handle)
      .mockResolvedValueOnce(second.handle);
    await render(options(90));
    await render(options(80));
    await act(async () => {
      second.resolve();
      await Promise.resolve();
    });
    expect(container?.textContent).toBe("ready:2");
    await act(async () => {
      first.resolve();
      await Promise.resolve();
    });
    expect(container?.textContent).toBe("ready:2");
    expect(vi.mocked(releaseCacheLease)).toHaveBeenCalledWith("lease-1");
  });

  it("closing cancels the job and releases the ready lease", async () => {
    const first = deferred(1, "lease-close");
    vi.mocked(previewConversion).mockResolvedValueOnce(first.handle);
    await render(options(90));
    await act(async () => {
      first.resolve();
      await Promise.resolve();
    });
    expect(container?.textContent).toBe("ready:1");
    await act(async () => root?.unmount());
    root = null;
    expect(first.cancel).toHaveBeenCalled();
    expect(vi.mocked(releaseCacheLease)).toHaveBeenCalledWith("lease-close");
  });

  it("reports a stable converter error when the preview fails", async () => {
    const failed = deferred(1, "lease-failed");
    vi.mocked(previewConversion).mockResolvedValueOnce(failed.handle);
    await render(options(90));
    await act(async () => {
      failed.reject(new Error("convert.too_large"));
      await Promise.resolve();
    });
    expect(container?.textContent).toBe("failed:");
    const apiText = container?.textContent ?? "";
    expect(apiText).not.toContain("ready");
  });
});

describe("preview pane", () => {
  it("labels the size as an estimate", async () => {
    await act(async () => {
      root?.render(
        <ConversionPreviewView
          originalUrl={null}
          originalName="photo.png"
          preview={{
            status: "ready",
            preview: preview(1, "lease-estimate"),
            error: "",
            revision: 1,
          }}
          onRetry={() => undefined}
        />,
      );
    });
    expect(container?.textContent).toContain("Estimated size:");
  });
});
