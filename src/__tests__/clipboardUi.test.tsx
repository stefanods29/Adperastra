import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import ClipboardHistoryPanel, {
  choosePasteSpecial,
} from "../clipboard/ClipboardHistoryPanel";
import MountedImageActions from "../clipboard/MountedImageActions";
import type { ClipboardHistoryPage } from "../services/clipboardHistory";
import type { MountedImage, MountResult } from "../services/diskImages";
import type { TransferEnvelope } from "../transfer/types";
import type { JobHandle } from "../services/jobs";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => opts.count * 72,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        index,
        start: index * opts.estimateSize(index),
        key: index,
      })),
  }),
}));

vi.mock("../services/clipboardHistory", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/clipboardHistory")>();
  return {
    ...original,
    listClipboardHistory: vi.fn(),
    patchClipboardHistory: vi.fn(),
    resolveClipboardHistory: vi.fn(),
    listenClipboardHistoryChanged: vi.fn(),
  };
});

vi.mock("../services/contentTransfer", () => ({
  releaseTransfer: vi.fn(),
}));

vi.mock("../services/diskImages", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/diskImages")>();
  return {
    ...original,
    mountDiskImage: vi.fn(),
    ejectDiskImage: vi.fn(),
    listMountedImages: vi.fn(),
  };
});

import * as clipboardService from "../services/clipboardHistory";
import * as contentTransfer from "../services/contentTransfer";
import * as diskService from "../services/diskImages";

const listClipboardHistory = vi.mocked(clipboardService.listClipboardHistory);
const patchClipboardHistory = vi.mocked(clipboardService.patchClipboardHistory);
const resolveClipboardHistory = vi.mocked(clipboardService.resolveClipboardHistory);
const listenClipboardHistoryChanged = vi.mocked(clipboardService.listenClipboardHistoryChanged);
const releaseTransfer = vi.mocked(contentTransfer.releaseTransfer);
const mountDiskImage = vi.mocked(diskService.mountDiskImage);
const listMountedImages = vi.mocked(diskService.listMountedImages);

const idA = "6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a";
const targetId = "0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9";
const idB = "2b1c3d4e-5f60-4712-8a9b-0c1d2e3f4a5b";

function page(generation = 4): ClipboardHistoryPage {
  return {
    items: [
      {
        id: idA,
        kind: "text",
        created_unix: 1_700_000_000,
        source: "app",
        preview: "hello",
        byte_len: 5,
        pinned: false,
        missing: false,
      },
      {
        id: idB,
        kind: "image",
        created_unix: 1_700_000_100,
        source: "windows",
        preview: "",
        byte_len: 100,
        pinned: false,
        missing: false,
      },
    ],
    complete: true,
    total: 2,
    used_bytes: 105,
    generation,
  };
}

function envelope(): TransferEnvelope {
  return {
    transfer_id: "9c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
    sensitive: false,
    payload: { kind: "text", text: "hello" },
    expires_unix: 2_000,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  listClipboardHistory.mockReset().mockResolvedValue(page());
  patchClipboardHistory.mockReset().mockResolvedValue(page(5));
  listenClipboardHistoryChanged.mockReset().mockResolvedValue(() => undefined);
  releaseTransfer.mockReset().mockResolvedValue(undefined);
  resolveClipboardHistory.mockReset();
  mountDiskImage.mockReset();
  listMountedImages.mockReset().mockResolvedValue([]);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function settle(times = 8) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(element: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(element);
  });
  await settle();
}

function button(text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!found) throw new Error(`button ${text} missing`);
  return found as HTMLButtonElement;
}

function dialogButton(text: string): HTMLButtonElement {
  const dialogs = container!.querySelectorAll(".adp-dialog");
  const dialog = dialogs[dialogs.length - 1];
  const found = [...dialog.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!found) throw new Error(`dialog button ${text} missing`);
  return found as HTMLButtonElement;
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("clipboard history panel", () => {
  it("selection does not paste until an explicit action", async () => {
    const onPaste = vi.fn().mockResolvedValue(undefined);
    resolveClipboardHistory.mockResolvedValue(envelope());
    await render(
      <ClipboardHistoryPanel
        targetId={targetId}
        onPaste={onPaste}
        onClose={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    const option = container!.querySelector("[role='option']")!;
    click(option);
    await settle();
    expect(resolveClipboardHistory).not.toHaveBeenCalled();
    expect(onPaste).not.toHaveBeenCalled();

    click(button(i18n.t("clipboardHistory.paste")));
    await settle();
    expect(resolveClipboardHistory).toHaveBeenCalledWith(idA, targetId);
    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(releaseTransfer).toHaveBeenCalledWith(envelope().transfer_id);
  });

  it("a read-only target failure is shown and the transfer is released", async () => {
    const onPaste = vi.fn().mockRejectedValue(new Error("transfer.read_only"));
    resolveClipboardHistory.mockResolvedValue(envelope());
    await render(
      <ClipboardHistoryPanel
        targetId={targetId}
        onPaste={onPaste}
        onClose={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    click(button(i18n.t("clipboardHistory.paste")));
    await settle();
    expect(releaseTransfer).toHaveBeenCalledTimes(1);
    expect(container!.textContent).toContain(i18n.t("errors.transfer.read_only"));
  });

  it("keyboard pins, searches and clears the selected item", async () => {
    await render(
      <ClipboardHistoryPanel
        targetId={targetId}
        onPaste={vi.fn()}
        onClose={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    const list = container!.querySelector<HTMLElement>("[role='listbox']")!;
    act(() => list.focus());
    // The first row is selected after load; Space pins that selection.
    act(() => {
      list.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    await settle();
    expect(patchClipboardHistory).toHaveBeenCalledWith({
      kind: "pin",
      id: idA,
      pinned: true,
      expected_generation: 4,
    });

    const listAfterPin = container!.querySelector<HTMLElement>("[role='listbox']")!;
    act(() => {
      listAfterPin.dispatchEvent(
        new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }),
      );
    });
    expect(document.activeElement?.tagName).toBe("INPUT");

    act(() => {
      listAfterPin.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    });
    await settle();
    click(dialogButton(i18n.t("clipboardHistory.clear")));
    await settle();
    expect(patchClipboardHistory).toHaveBeenCalledWith({
      kind: "remove",
      ids: [idA],
      expected_generation: 5,
    });
  });

  it("paste special follows editor focus", () => {
    expect(choosePasteSpecial(true)).toBe("editor");
    expect(choosePasteSpecial(false)).toBe("history");
  });
});

describe("disk mount actions", () => {
  const mounted: MountedImage = {
    mount_id: "0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
    source: {
      path_key: "C:\\images\\disk.iso",
      volume_id: "00112233",
      file_id: "0011223344556677",
      modified_ticks: "100",
      size_bytes: 1024,
    },
    kind: "iso",
    volume_roots: ["F:\\"],
    physical_path: "\\\\.\\PhysicalDrive4",
    readonly: true,
    owned: true,
    state: "mounted",
    brokered: false,
  };

  function handle(result: MountResult): JobHandle<MountResult> {
    return {
      id: "diskmount-test",
      cancel: vi.fn().mockResolvedValue(undefined),
      completion: Promise.resolve(result),
    };
  }

  it("asks for permission before the elevated retry", async () => {
    mountDiskImage
      .mockResolvedValueOnce(
        handle({ mount: null, requires_elevation: true, error_code: "disk.denied" }),
      )
      .mockResolvedValueOnce(handle({ mount: mounted, requires_elevation: false }));
    const onMounted = vi.fn();
    const onOpenDrive = vi.fn();
    await render(
      <MountedImageActions
        path="C:\\images\\disk.iso"
        name="disk.iso"
        onMounted={onMounted}
        onOpenDrive={onOpenDrive}
      />,
    );
    click(button(i18n.t("disk.mount")));
    await settle();
    expect(mountDiskImage).toHaveBeenCalledTimes(1);
    expect(mountDiskImage.mock.calls[0][0]).toMatchObject({
      readonly: true,
      allow_elevation: false,
    });
    expect(container!.textContent).toContain(i18n.t("disk.elevate"));

    click(button(i18n.t("disk.continue")));
    await settle();
    expect(mountDiskImage).toHaveBeenCalledTimes(2);
    expect(mountDiskImage.mock.calls[1][0]).toMatchObject({
      readonly: true,
      allow_elevation: true,
    });
    expect(onMounted).toHaveBeenCalledWith(mounted);
    expect(onOpenDrive).toHaveBeenCalledWith("F:\\");
  });

  it("keeps mount disabled when the native registry is unavailable", async () => {
    listMountedImages.mockRejectedValue(new Error("state not managed"));
    await render(
      <MountedImageActions
        path="C:\\images\\disk.iso"
        name="disk.iso"
      />,
    );
    const mountButton = button(i18n.t("disk.mount"));
    expect(mountButton.disabled).toBe(true);
    expect(mountButton.title).toBe(i18n.t("errors.disk.unavailable"));
    expect(mountDiskImage).not.toHaveBeenCalled();
  });

  it("reports a Windows-managed image without offering eject", async () => {
    mountDiskImage.mockResolvedValueOnce(
      handle({
        mount: { ...mounted, owned: false },
        requires_elevation: false,
      }),
    );
    const onOpenDrive = vi.fn();
    await render(
      <MountedImageActions
        path="C:\\images\\disk.iso"
        name="disk.iso"
        onOpenDrive={onOpenDrive}
      />,
    );
    click(button(i18n.t("disk.mount")));
    await settle();
    expect(container!.textContent).toContain(i18n.t("disk.external"));
    const eject = [...container!.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes(i18n.t("disk.eject")),
    );
    expect(eject).toBeUndefined();
    expect(onOpenDrive).toHaveBeenCalledWith("F:\\");
  });
});
