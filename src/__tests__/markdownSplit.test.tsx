import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import MarkdownView from "../handlers/markdown/MarkdownView";
import type { FileTabStatus, HandlerViewProps } from "../handlers/types";
import type { FileTypeInfo } from "../services/files";
import { deleteDraft, readDraft, writeDraft } from "../services/recovery";

vi.mock("../services/textFiles", () => ({ saveText: vi.fn(), pickSavePath: vi.fn() }));
vi.mock("../services/recovery", () => ({ readDraft: vi.fn(), writeDraft: vi.fn(), deleteDraft: vi.fn() }));

const INFO: FileTypeInfo = {
  path: "C:\\A\\readme.md",
  name: "readme.md",
  ext: "md",
  mime: "text/markdown",
  size: 8,
  modified_unix: 100,
  online_only: false,
  read_only: false,
  from_internet: false,
};

const BYTES = new TextEncoder().encode("# Title");

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let status: FileTabStatus = { items: [] };

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function render(savedState: unknown = { mode: "split" }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props: HandlerViewProps = {
    info: INFO,
    url: "http://adpfile.localhost/t/readme.md",
    active: true,
    savedState,
    onStateChange: () => undefined,
    onStatus: (next) => {
      status = next;
    },
    onOpenInWindowsApp: () => undefined,
    find: { text: "", request: 0, backwards: false },
    protectedView: false,
  };
  await act(async () => {
    root?.render(<MarkdownView {...props} />);
  });
  await flush();
}

const frame = () => container!.querySelector(".adp-markdown-frame") as HTMLIFrameElement;

function view(): EditorView {
  const content = container!.querySelector(".cm-content") as HTMLElement;
  return EditorView.findFromDOM(content)!;
}

function button(name: string): HTMLButtonElement | undefined {
  return [...container!.querySelectorAll("button")].find(
    (entry) => entry.getAttribute("aria-label") === name,
  ) as HTMLButtonElement | undefined;
}

beforeEach(() => {
  status = { items: [] };
  vi.mocked(readDraft).mockReset();
  vi.mocked(writeDraft).mockReset();
  vi.mocked(deleteDraft).mockReset();
  vi.mocked(readDraft).mockResolvedValue(null);
  vi.mocked(writeDraft).mockResolvedValue(undefined);
  vi.mocked(deleteDraft).mockResolvedValue(undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => BYTES.slice().buffer })),
  );
});

afterEach(async () => {
  vi.useRealTimers();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("Markdown split mode", () => {
  it("Split shows the source and the page", async () => {
    await render();
    const split = container!.querySelector(".adp-md-split");
    expect(split).not.toBeNull();
    expect(split!.querySelector(".adp-text-host")).not.toBeNull();
    expect(split!.querySelector(".adp-markdown-frame")).not.toBeNull();
  });

  it("typing updates the page after a short pause", async () => {
    vi.useFakeTimers();
    await render();
    expect(frame().getAttribute("srcdoc")).toContain("Title");

    const editorView = view();
    act(() => {
      editorView.dispatch({ changes: { from: editorView.state.doc.length, insert: "x" }, userEvent: "input.type" });
    });
    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    expect(frame().getAttribute("srcdoc")).not.toContain("Titlex");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(frame().getAttribute("srcdoc")).toContain("Titlex");
  });

  it("switching modes keeps unsaved edits", async () => {
    await render();
    const editorView = view();
    act(() => {
      editorView.dispatch({ changes: { from: editorView.state.doc.length, insert: "x" }, userEvent: "input.type" });
    });

    act(() => button(i18n.t("markdown.renderedMode"))!.click());
    act(() => button(i18n.t("markdown.sourceMode"))!.click());

    expect(editorView.state.doc.toString()).toContain("x");
    expect(status.items[0]).toBe(i18n.t("editor.unsaved"));
  });
});
