import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import LocalAiSettings from "../views/settings/LocalAiSettings";
import AiRuntimeCard from "../ai/AiRuntimeCard";
import {
  AI_TASK_KINDS,
  defaultLocalAiSettings,
  normalizeLocalAiSettings,
  recommendAiTier,
} from "../services/localAiTypes";
import {
  buildAiUpscaleRequest,
  startAiUpscaleConversion,
  validateBatchCount,
} from "../convert/aiUpscaleConverter";
import { defaultSettings } from "../services/settings";

const mocks = vi.hoisted(() => ({
  hardware: vi.fn(async () => ({
    ram_bytes: 16 * 1_073_741_824,
    available_ram_bytes: 8 * 1_073_741_824,
    logical_cores: 8,
    gpu_name: null,
    dedicated_vram_bytes: null,
    gpu_backend: null,
    recommended_tier: "default",
  })),
  capabilities: vi.fn(async () => [
    {
      task: "upscale",
      available: false,
      pack_id: null,
      model_id: null,
      reason: "pack_missing",
    },
  ]),
  shutdown: vi.fn(async () => undefined),
  startConversion: vi.fn(async () => ({
    id: "convert-1",
    cancel: vi.fn(async () => undefined),
    completion: new Promise(() => undefined),
  })),
}));

vi.mock("../services/localAiRuntime", () => ({
  aiHardware: mocks.hardware,
  aiCapabilities: mocks.capabilities,
  shutdownAi: mocks.shutdown,
}));

vi.mock("../services/convert", () => ({
  startConversion: mocks.startConversion,
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  mocks.hardware.mockClear();
  mocks.capabilities.mockClear();
  mocks.shutdown.mockClear();
  mocks.startConversion.mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render(element: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(element));
}

describe("Local AI settings", () => {
  it("schema40_default_all_disabled", () => {
    const settings = normalizeLocalAiSettings(undefined);
    expect(settings.enabled).toBe(false);
    expect(settings.device).toBe("auto");
    expect(settings.tier).toBe("auto");
    for (const kind of AI_TASK_KINDS) expect(settings.tasks[kind]).toBe(false);
    expect(settings).toEqual(defaultLocalAiSettings());
  });

  it("disabling_cancels_unloads", async () => {
    const settings = defaultSettings() as ReturnType<typeof defaultSettings> & {
      local_ai: ReturnType<typeof defaultLocalAiSettings>;
    };
    settings.local_ai = { ...defaultLocalAiSettings(), enabled: true };
    const onApply = vi.fn();
    await render(
      <LocalAiSettings
        settings={settings}
        onApply={onApply}
        onOpenHelp={vi.fn()}
        onOpenStorage={vi.fn()}
      />,
    );
    const toggle = document.querySelector<HTMLButtonElement>("[role='switch']");
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(mocks.shutdown).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalled();
    const next = onApply.mock.calls[0][0] as typeof settings;
    expect(next.local_ai.enabled).toBe(false);
  });

  it("quickconvert_keep_original", () => {
    const request = buildAiUpscaleRequest({
      inputs: [{ kind: "file", path: "C:\\Images\\a.png" }],
      dest_dir: "C:\\Out",
      naming: { pattern: "{stem}.{ext}", date_utc: "2026-11-02", start_index: 1 },
    });
    expect(request.keep_original).toBe(true);
    expect(request.accepted_losses).toEqual([
      "exif",
      "gps",
      "camera",
      "date",
      "icc",
      "xmp",
      "iptc",
      "author",
      "comments",
    ]);
    expect(request.converter_id).toBe("image/ai-upscale");
  });

  it("duplicate_click_one_job", async () => {
    const request = buildAiUpscaleRequest({
      inputs: [{ kind: "file", path: "C:\\Images\\b.png" }],
      dest_dir: "C:\\Out",
      naming: { pattern: "{stem}.{ext}", date_utc: "2026-11-02", start_index: 1 },
      request_revision: 77,
    });
    await startAiUpscaleConversion(request);
    await startAiUpscaleConversion(request);
    expect(mocks.startConversion).toHaveBeenCalledTimes(1);
  });

  it("batch1001_refused", () => {
    expect(() => validateBatchCount(1_001)).toThrow("ai.bad_request");
    expect(() => validateBatchCount(1_000)).not.toThrow();
  });

  it("missingGPUrecommendation_noclaimedVRAM", async () => {
    expect(
      recommendAiTier({ ram_bytes: 32 * 1_073_741_824, dedicated_vram_bytes: null }),
    ).toBe("default");
    await render(
      <AiRuntimeCard
        settings={{ ...defaultLocalAiSettings(), enabled: true }}
        hardware={{
          ram_bytes: 32 * 1_073_741_824,
          available_ram_bytes: 16 * 1_073_741_824,
          logical_cores: 12,
          gpu_name: null,
          dedicated_vram_bytes: null,
          gpu_backend: null,
          recommended_tier: "default",
        }}
        capabilities={[
          {
            task: "upscale",
            available: false,
            pack_id: null,
            model_id: null,
            reason: "pack_missing",
          },
        ]}
        onOpenStorage={vi.fn()}
        onOpenHelp={vi.fn()}
      />,
    );
    const text = host?.textContent ?? "";
    expect(text).not.toContain("8 GB");
    // No GPU name is claimed when hardware reports none; the CPU row is shown.
    expect(text).not.toContain("GPU");
    expect(text).toContain("CPU");
    expect(document.querySelector("[data-ai-action='storage']")).toBeTruthy();
  });
});
