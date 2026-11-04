import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { initialDocumentState, type DocumentHandle } from "../documents/types";
import { VirtualOfficeView } from "../handlers/office/OfficeView";
import { openOfficeView } from "../services/officeView";

vi.mock("../services/officeView", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/officeView")>(),
  openOfficeView: vi.fn(async () => { throw new Error("office.unsupported"); }),
}));

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  vi.clearAllMocks();
});

async function renderPreview(sensitive: boolean) {
  const path = "C:\\Test\\Example.docx";
  const source = { kind: "disk", path } as const;
  const captureSnapshot = vi.fn(async () => { throw new Error("office.unsupported"); });
  const document: DocumentHandle = {
    id: "example",
    source,
    info: {
      document_id: "example", source, name: "Example.docx", ext: "docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 1, modified_unix: 0, read_only: true, from_internet: false, sensitive,
    },
    getState: () => initialDocumentState("example"),
    subscribe: vi.fn(), readRange: vi.fn(), captureSnapshot,
    save: vi.fn(), saveCopy: vi.fn(), discard: vi.fn(), release: vi.fn(),
  };
  const view = createRoot(window.document.createElement("div"));
  root = view;
  await act(async () => view.render(
    <VirtualOfficeView document={document} active savedState={null} onStateChange={vi.fn()}
      onStatus={vi.fn()} find={{ text: "", request: 0, backwards: false }}
      previewOnly={false} onOpenHelp={vi.fn()} />,
  ));
  return { path, captureSnapshot };
}

it("opens the read-only fallback for a disk document without taking a snapshot", async () => {
  const { path, captureSnapshot } = await renderPreview(false);
  expect(openOfficeView).toHaveBeenCalledWith({ kind: "file", path });
  expect(captureSnapshot).not.toHaveBeenCalled();
});

it("keeps a sensitive document on the snapshot path", async () => {
  const { captureSnapshot } = await renderPreview(true);
  expect(captureSnapshot).toHaveBeenCalledOnce();
  expect(openOfficeView).not.toHaveBeenCalled();
});
