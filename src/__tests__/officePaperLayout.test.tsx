import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { DocumentHandle } from "../documents/types";
import { usePaperLayout, type PaperLayout } from "../office/paper/usePaperLayout";

const mocks = vi.hoisted(() => ({
  open: vi.fn(), close: vi.fn(async () => undefined), release: vi.fn(async () => undefined),
}));
vi.mock("../services/exportSnapshots", () => ({ releaseExportSnapshot: mocks.release }));
vi.mock("../services/officeView", () => ({
  openOfficeView: mocks.open, closeOfficeView: mocks.close,
  officeViewSections: async () => ({ items: [{ id: "document", kind: "document", page_count: 1 }] }),
  officeViewText: async () => ({ cancel: vi.fn(), completion: Promise.resolve({ runs: [], complete: true }) }),
}));

it("renders immutable revisions and keeps the old page visible until the updated layout is ready", async () => {
  mocks.close.mockClear(); mocks.release.mockClear();
  let revision = 1;
  let latest: ReturnType<typeof usePaperLayout> | undefined;
  let resolveSecond!: (value: unknown) => void;
  const opened = (session: string) => ({ session_id: session, quality: "accurate" });
  mocks.open.mockReset().mockResolvedValueOnce({ cancel: vi.fn(), completion: Promise.resolve(opened("one")) })
    .mockResolvedValueOnce({ cancel: vi.fn(), completion: new Promise(resolve => { resolveSecond = resolve; }) });
  const capture = vi.fn(async () => ({ snapshot_id: `snapshot-${revision}`, document_id: "doc", revision }));
  const document = { id: "doc", captureSnapshot: capture } as unknown as DocumentHandle;
  function Fixture({ current }: { current: number }) {
    latest = usePaperLayout(document, current, true);
    return null;
  }
  const root = createRoot(window.document.createElement("div"));
  try {
    await act(async () => root.render(<Fixture current={revision} />));
    expect(latest?.layout?.revision).toBe(1);
    const original = latest?.layout as PaperLayout;
    revision = 2;
    await act(async () => root.render(<Fixture current={revision} />));
    expect(latest?.layout).toBe(original);
    expect(mocks.open.mock.calls[1][0]).toEqual({ kind: "snapshot", snapshot_id: "snapshot-2", document_id: "doc", revision: 2 });
    await act(async () => resolveSecond(opened("two")));
    expect(latest?.layout?.revision).toBe(2);
    expect(latest?.layout?.sessionId).toBe("two");
    expect(mocks.close).toHaveBeenCalledWith("one");
    expect(mocks.release).toHaveBeenCalledWith("snapshot-2");
  } finally { await act(async () => root.unmount()); }
  expect(mocks.close).toHaveBeenCalledWith("two");
});
