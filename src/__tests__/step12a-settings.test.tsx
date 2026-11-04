import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { PackState, StorageReport } from "../services/packTypes";
import AppStorageSettings, {
  MissingPackNotice,
} from "../views/settings/AppStorageSettings";

vi.mock("../services/packs", () => ({
  listPacks: vi.fn(),
  installPack: vi.fn(),
  pausePackDownload: vi.fn(),
  refreshPackCatalog: vi.fn(),
  removePack: vi.fn(),
  resumePackDownload: vi.fn(),
}));

vi.mock("../services/storage", () => ({
  storageReport: vi.fn(),
  clearStorage: vi.fn(),
  setStorageLimit: vi.fn(),
}));

import {
  installPack,
  listPacks,
  removePack,
} from "../services/packs";
import { clearStorage, storageReport } from "../services/storage";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function pack(overrides: Partial<PackState> = {}): PackState {
  return {
    id: "media",
    installed_version: "1.0.0",
    available_version: "1.0.0",
    state: "installed",
    bytes_received: 0,
    error_code: null,
    installed_unix: 1,
    leased_count: 0,
    ...overrides,
  };
}

function report(
  category: StorageReport["category"],
  overrides: Partial<StorageReport> = {},
): StorageReport {
  return {
    category,
    disk_bytes: 1024,
    memory_bytes: 0,
    pending_delete_bytes: 0,
    limit_bytes: 512 * 1024 * 1024,
    clearable: true,
    loss_key: "storage.lossVersions",
    busy: false,
    ...overrides,
  };
}

function click(element: Element | null) {
  return act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

function buttonWithText(scope: ParentNode, text: string) {
  return (
    [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === text,
    ) ?? null
  );
}

async function renderApp() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<AppStorageSettings onOpenHelp={() => undefined} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container!;
}

beforeEach(() => {
  vi.mocked(listPacks).mockReset().mockResolvedValue([pack()]);
  vi.mocked(storageReport).mockReset().mockResolvedValue([report("versions")]);
  vi.mocked(removePack).mockReset().mockResolvedValue({
    id: "packrem-1",
    cancel: vi.fn(),
    completion: Promise.resolve(pack({ state: "absent" })),
  });
  vi.mocked(clearStorage).mockReset().mockResolvedValue({
    id: "storage-1",
    cancel: vi.fn(),
    completion: Promise.resolve({
      category: "versions",
      freed_bytes: 1024,
      pending_bytes: 0,
      complete: true,
      errors: [],
    }),
  });
  vi.mocked(installPack).mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("App storage settings", () => {
  it("remove waits for dirty editor", async () => {
    vi.mocked(listPacks).mockResolvedValue([pack({ leased_count: 1 })]);
    const view = await renderApp();
    await click(buttonWithText(view, i18n.t("packs.remove")));
    const dialog = view.querySelector("[role='dialog']")!;
    expect(dialog.textContent).toContain(i18n.t("packs.inUse"));
    await click(buttonWithText(dialog, i18n.t("common.cancel")));
    expect(removePack).not.toHaveBeenCalled();
    expect(view.querySelector("[data-pack='media']")).not.toBeNull();
  });

  it("missing pack link opens storage", async () => {
    const onOpenStorage = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<MissingPackNotice packId="media" onOpenStorage={onOpenStorage} />);
    });
    await click(buttonWithText(container, i18n.t("packs.openStorage")));
    expect(onOpenStorage).toHaveBeenCalledTimes(1);
  });

  it("clear confirmation names loss", async () => {
    const view = await renderApp();
    const clearButton = view.querySelector<HTMLButtonElement>(
      "[data-storage-clear='versions']",
    )!;
    await click(clearButton);
    const dialog = view.querySelector("[role='dialog']")!;
    expect(dialog.textContent).toContain(i18n.t("storage.lossVersions"));
    expect(dialog.textContent).toContain(i18n.t("common.cancel"));
    await click(buttonWithText(dialog, i18n.t("common.cancel")));
    expect(clearStorage).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(clearButton);

    await click(clearButton);
    const reopened = view.querySelector("[role='dialog']")!;
    await click(buttonWithText(reopened, i18n.t("storage.clearAction")));
    expect(clearStorage).toHaveBeenCalledTimes(1);
    expect(clearStorage).toHaveBeenCalledWith("versions");
  });

  it("duplicate click starts one job", async () => {
    vi.mocked(listPacks).mockResolvedValue([
      pack({
        state: "absent",
        installed_version: null,
        available_version: "1.0.0",
        installed_unix: null,
      }),
    ]);
    vi.mocked(installPack).mockReturnValue(
      new Promise<never>(() => {
        // The first job stays in flight; a second click must not start one.
      }),
    );
    const view = await renderApp();
    const installButton = buttonWithText(view, i18n.t("packs.install"))!;
    await act(async () => {
      installButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      installButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(installPack).toHaveBeenCalledTimes(1);
    expect(installPack).toHaveBeenCalledWith("media", "1.0.0");
  });
});
