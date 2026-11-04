import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { OfficeController } from "../office/OfficeController";
import { OfficeViewportView } from "../office/OfficeViewport";
import { releaseOfficeLease, renderOffice } from "../services/officeEdit";

vi.mock("../services/officeEdit", () => ({
  renderOffice: vi.fn(),
  releaseOfficeLease: vi.fn(async () => undefined),
}));

it("uses the paragraph's original value and revision to replace text", async () => {
  const block = "64af5d67-995a-4eb6-9d89-a0a0489340ee";
  const span = {
    anchor: { block_id: block, offset_utf16: 2 },
    focus: { block_id: block, offset_utf16: 5 },
    revision: 4,
  };
  const rect = { x_pt: 0, y_pt: 0, width_pt: 80, height_pt: 40, rotation_deg: 0 };
  const transact = vi.fn(async () => undefined);
  let liveRevision = 4;
  const controller = {
    family: "document", session_id: "session", getState: () => ({ ready: true, revision: liveRevision }), transact,
  } as unknown as OfficeController;
  vi.mocked(renderOffice).mockResolvedValue({
    cancel: vi.fn(async () => undefined),
    completion: Promise.resolve({ revision: 4, items: [{
      session_id: "session", view_revision: 0, page_id: "1", rect,
      image: { lease_id: "image", token: "token", name: "page.png" },
      accessibility: [{ id: block, role: "paragraph", name: "Paragraph label",
        rect, editable: true, document_text: { span, text: "Old" } }],
    }] }),
  } as unknown as Awaited<ReturnType<typeof renderOffice>>);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<OfficeViewportView controller={controller}
      active revision={4} canEditText selection={null} onSelection={vi.fn()}
      viewport={{ x_px: 0, y_px: 0, width_px: 100, height_px: 100, zoom_percent: 100,
        device_scale: 1, view_revision: 0 }} onViewport={vi.fn()} onOpenHelp={vi.fn()} />));
    const node = host.querySelector<HTMLButtonElement>(".adp-office-node")!;
    await act(async () => node.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = host.querySelector("textarea")!;
    expect(input.value).toBe("Old");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "New");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = host.querySelector("form")!;
    liveRevision = 5;
    await act(async () => form.requestSubmit());
    expect(transact).not.toHaveBeenCalled();
    liveRevision = 4;
    await act(async () => form.requestSubmit());
    expect(transact).toHaveBeenCalledWith(expect.objectContaining({
      expected_revision: 4,
      operations: [{ family: "document", operation: {
        kind: "replace_match", span, expected_text: "Old", replacement: "New",
      } }],
    }));
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
  expect(releaseOfficeLease).toHaveBeenCalledWith("image");
});
