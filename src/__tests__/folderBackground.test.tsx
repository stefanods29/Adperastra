import "../i18n";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { FolderBackground, readableBackgroundOpacity } from "../folders/FolderBackground";
import { contrastRatio, themeColorHex } from "../appearance/themeMath";
import type { FolderBackground as Background } from "../services/folderCustomization";

vi.mock("../services/cache", () => ({ releaseCacheLease: vi.fn(async () => undefined) }));
vi.mock("../services/files", () => ({ fileUrl: vi.fn(() => "http://adpfile.localhost/token/image.png") }));
import { fileUrl } from "../services/files";
import { releaseCacheLease } from "../services/cache";

const background: Background = { kind: "image", asset_id: "12345678-1234-4234-8234-123456789abc", angle_degrees: 0, fit: "fit", opacity: 0.5, blur_px: 0, inherit: false };
const image = { asset_id: background.asset_id!, lease: { lease_id: "lease", token: "token", name: "image.png", mime: "image/png", byte_len: 16 } };

describe("FolderBackground", () => {
  it("globaloffdoesnotreadimage", async () => {
    vi.clearAllMocks();
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(<FolderBackground background={background} enabled={false} visible paneColor="#FFFFFF" textColor="#000000" image={image} onWarning={vi.fn()} />));
      expect(container.querySelector("img")).toBeNull();
      expect(fileUrl).not.toHaveBeenCalled();
      expect(releaseCacheLease).toHaveBeenCalledWith("lease");
    } finally { await act(async () => root.unmount()); }
  });

  it("textcontrast>=4.5", () => {
    // Every possible image pixel is between the all-black/all-white channel
    // bounds. Check a grid including all RGB corners after compositing.
    const opacity = readableBackgroundOpacity(background, "#FFFFFF", "#666666");
    expect(opacity).toBeLessThan(0.5);
    for (const red of [0, 64, 128, 192, 255]) {
      for (const green of [0, 64, 128, 192, 255]) {
        for (const blue of [0, 64, 128, 192, 255]) {
          const surface = themeColorHex(255 + (red - 255) * opacity, 255 + (green - 255) * opacity, 255 + (blue - 255) * opacity);
          expect(contrastRatio("#666666", surface)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("retains the current lease during effect replay and releases on unmount", async () => {
    vi.clearAllMocks();
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<StrictMode><FolderBackground background={background} enabled visible paneColor="#FFFFFF" textColor="#000000" image={image} onWarning={vi.fn()} /></StrictMode>));
    expect(container.querySelector("img")).not.toBeNull();
    expect(releaseCacheLease).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(releaseCacheLease).toHaveBeenCalledWith("lease");
  });

  it("firstrowsnotblocked", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(<div><span data-row="true">row</span><FolderBackground background={background} enabled visible paneColor="#FFFFFF" textColor="#000000" onWarning={vi.fn()} /></div>));
      expect(container.querySelector("[data-row]")?.textContent).toBe("row");
      expect(container.querySelector("img")).toBeNull();
    } finally { await act(async () => root.unmount()); }
  });
});
