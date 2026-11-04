import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import "../i18n";
import OfficePreviewGate from "../handlers/office/OfficePreviewGate";
import type { DocumentHandle } from "../documents/types";
import type { OfficeController } from "../office/OfficeController";

it("opens in preview, acquires editing only after acceptance, and respects protected mode", async () => {
  const close = vi.fn(async () => undefined);
  const enable = vi.fn(async () => undefined);
  const open = vi.fn(async () => ({
    kind: "editing" as const,
    controller: { close, getState: () => ({ mode: "viewing" }), setEditingEnabled: enable } as unknown as OfficeController,
  }));
  const document = { id: "one", info: { from_internet: false } } as DocumentHandle;
  const host = window.document.createElement("div");
  const root = createRoot(host);
  const render = (readOnly: boolean) => act(async () => root.render(<OfficePreviewGate document={document}
    readOnly={readOnly} open={open} original={() => <p data-preview />} editor={() => <p data-editor />} />));
  try {
    await render(false);
    expect(host.querySelector("[data-preview]")).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(enable).toHaveBeenCalledWith(true);
    expect(host.querySelector("[data-editor]")).not.toBeNull();
    await render(true);
    expect(host.querySelector("[data-preview]")).not.toBeNull();
    expect(host.querySelector("[data-editor]")).toBeNull();
    expect(close).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); }
});

it("uses the file tab's protected-view acceptance without a second editing prompt", async () => {
  const close = vi.fn(async () => undefined);
  const enable = vi.fn(async () => undefined);
  const open = vi.fn(async () => ({
    kind: "editing" as const,
    controller: { close, getState: () => ({ mode: "viewing" }), setEditingEnabled: enable } as unknown as OfficeController,
  }));
  const document = { id: "download", info: { from_internet: true } } as DocumentHandle;
  const host = window.document.createElement("div");
  const root = createRoot(host);
  const render = (readOnly: boolean) => act(async () => root.render(<OfficePreviewGate document={document}
    readOnly={readOnly} open={open} original={() => <p data-preview />} editor={() => <p data-editor />} />));
  try {
    await render(true);
    expect(open).not.toHaveBeenCalled();
    expect(host.querySelector("button")).toBeNull();
    await render(false);
    expect(open).toHaveBeenCalledOnce();
    expect(enable).toHaveBeenCalledWith(true);
    expect(host.querySelector("[data-editor]")).not.toBeNull();
  } finally { await act(async () => root.unmount()); }
});
