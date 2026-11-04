import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { DocumentHandle } from "../documents/types";
import type { OfficeController } from "../office/OfficeController";
import { useOfficeEditorMode } from "../handlers/office/useOfficeEditorMode";

const documentHandle = { id: "office-fixture" } as DocumentHandle;

it("retains the shared session while the editor mounts and releases it when preview-only", async () => {
  const close = vi.fn(async () => undefined);
  const open = vi.fn(async () => ({ kind: "editing" as const, controller: { close } as unknown as OfficeController }));
  function Harness({ readOnly }: { readOnly: boolean }) {
    return <div data-mode={useOfficeEditorMode(documentHandle, readOnly, open)} />;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness readOnly={false} />));
    expect(container.firstElementChild?.getAttribute("data-mode")).toBe("editor");
    expect(close).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness readOnly />));
    expect(container.firstElementChild?.getAttribute("data-mode")).toBe("viewer");
    expect(open).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
  }
  expect(close).toHaveBeenCalledOnce();
});

it("releases a controller returned after its view has unmounted", async () => {
  const close = vi.fn(async () => undefined);
  const outcome = { kind: "editing" as const, controller: { close } as unknown as OfficeController };
  let resolve!: (value: typeof outcome) => void;
  const open = () => new Promise<typeof outcome>((finish) => { resolve = finish; });
  function Harness() {
    useOfficeEditorMode(documentHandle, false, open);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  await act(async () => root.unmount());
  await act(async () => resolve(outcome));
  expect(close).toHaveBeenCalledOnce();
});
