import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import TextView from "../handlers/text/TextView";
import type { FileTabStatus, HandlerViewProps } from "../handlers/types";
import type { FileTypeInfo } from "../services/files";
import { deleteDraft, readDraft, writeDraft } from "../services/recovery";
import { saveText } from "../services/textFiles";

vi.mock("../services/textFiles", () => ({ saveText: vi.fn(), pickSavePath: vi.fn() }));
vi.mock("../services/recovery", () => ({ readDraft: vi.fn(), writeDraft: vi.fn(), deleteDraft: vi.fn() }));
vi.mock("../services/versions", () => ({
  versionsList: vi.fn(),
  versionsExtract: vi.fn(),
  versionsRestore: vi.fn(),
  versionsSaveCopy: vi.fn(),
}));

import { versionsExtract, versionsList, versionsRestore, versionsSaveCopy } from "../services/versions";

const INFO: FileTypeInfo = {
  path: "C:\\A\\a.txt",
  name: "a.txt",
  ext: "txt",
  mime: "text/plain",
  size: 10,
  modified_unix: 100,
  online_only: false,
  read_only: false,
  from_internet: false,
};

const BYTES = new TextEncoder().encode("one\r\ntwo\r\n");

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

async function render(overrides: Partial<HandlerViewProps> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props: HandlerViewProps = {
    info: INFO,
    url: "http://adpfile.localhost/t/a.txt",
    active: true,
    savedState: null,
    onStateChange: () => undefined,
    onStatus: (next) => {
      status = next;
    },
    onOpenInWindowsApp: () => undefined,
    find: { text: "", request: 0, backwards: false },
    protectedView: false,
    onDirtyChange,
    registerSave,
    ...overrides,
  };
  await act(async () => {
    root?.render(<TextView {...props} />);
  });
  await flush();
}

const onDirtyChange = vi.fn();
const registerSave = vi.fn();

function button(name: string): HTMLButtonElement | undefined {
  return [...container!.querySelectorAll("button")].find(
    (entry) => entry.getAttribute("aria-label") === name,
  ) as HTMLButtonElement | undefined;
}

function view(): EditorView {
  const content = container!.querySelector(".cm-content") as HTMLElement;
  return EditorView.findFromDOM(content)!;
}

function type(text: string) {
  act(() => {
    view().dispatch({ changes: { from: 0, insert: text }, userEvent: "input.type" });
  });
}

beforeEach(() => {
  status = { items: [] };
  onDirtyChange.mockReset();
  registerSave.mockReset();
  vi.mocked(saveText).mockReset();
  vi.mocked(readDraft).mockReset();
  vi.mocked(writeDraft).mockReset();
  vi.mocked(deleteDraft).mockReset();
  vi.mocked(saveText).mockResolvedValue({ path: INFO.path, size: 11, modified_unix: 200 });
  vi.mocked(readDraft).mockResolvedValue(null);
  vi.mocked(writeDraft).mockResolvedValue(undefined);
  vi.mocked(deleteDraft).mockResolvedValue(undefined);
  vi.mocked(versionsList).mockReset().mockResolvedValue({
    versions: [{ id: 1, created_unix: 150, reason: "save", size: 10, file_modified_unix: 150 }],
    too_large: false,
  });
  vi.mocked(versionsExtract).mockReset().mockResolvedValue("C:\\V\\open\\1-a.txt");
  vi.mocked(versionsRestore).mockReset().mockResolvedValue({
    previous_id: 9,
    saved: { path: INFO.path, size: 12, modified_unix: 300 },
  });
  vi.mocked(versionsSaveCopy).mockReset().mockResolvedValue(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => BYTES.slice().buffer })),
  );
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("editing in the text viewer", () => {
  it("Save is off until the text changes", async () => {
    await render();
    expect(button(i18n.t("editor.save"))!.disabled).toBe(true);

    type("x");
    const save = button(i18n.t("editor.save"))!;
    expect(save.disabled).toBe(false);
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    expect(status.items[0]).toBe(i18n.t("editor.unsaved"));

    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    expect(saveText).toHaveBeenCalled();
  });

  it("Ctrl+S saves while typing", async () => {
    await render();
    type("x");
    const content = container!.querySelector(".cm-content") as HTMLElement;
    await act(async () => {
      content.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(saveText).toHaveBeenCalledTimes(1);
  });

  it("read-only files say why and still offer Save as", async () => {
    await render({ info: { ...INFO, read_only: true } });
    expect(container!.textContent).toContain(i18n.t("editor.readOnlyAttribute"));
    expect(button(i18n.t("editor.save"))!.disabled).toBe(true);
    expect(button(i18n.t("editor.saveAs"))!.disabled).toBe(false);
  });

  it("the encoding list waits for a save", async () => {
    await render();
    type("x");
    const encoding = container!.querySelector(`select[aria-label='${i18n.t("text.encoding")}']`) as HTMLSelectElement;
    const saveWith = container!.querySelector(`select[aria-label='${i18n.t("editor.saveWith")}']`) as HTMLSelectElement;
    expect(encoding.disabled).toBe(true);
    expect(saveWith.disabled).toBe(false);
  });

  it("registers its save handle", async () => {
    await render();
    expect(registerSave).toHaveBeenCalled();
    const handle = registerSave.mock.calls[0][0];
    expect(typeof handle.save).toBe("function");
    expect(typeof handle.discard).toBe("function");
  });

  it("the ribbon opens the version history", async () => {
    await render();
    act(() => button(i18n.t("commands.versionHistory"))!.click());
    await flush();
    expect(container!.textContent).toContain(i18n.t("versions.title", { name: "a.txt" }));
  });

  it("a restore reloads the text", async () => {
    await render();
    type("x");
    await flush();
    const restoredBytes = new TextEncoder().encode("new text\r\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => restoredBytes.slice().buffer })),
    );

    act(() => button(i18n.t("commands.versionHistory"))!.click());
    await flush();
    const byText = (label: string) =>
      [...container!.querySelectorAll("button")].filter((entry) => entry.textContent === label);
    act(() => byText(i18n.t("versions.restore"))[0].click());
    const confirm = byText(i18n.t("versions.restore"));
    expect(confirm).toHaveLength(2);
    await act(async () => {
      confirm[1].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
    await flush();

    expect(versionsRestore).toHaveBeenCalledWith(INFO.path, 1);
    expect(deleteDraft).toHaveBeenCalledWith(INFO.path);
    expect(view().state.doc.toString()).toBe("new text\r\n");
    expect(status.items).not.toContain(i18n.t("editor.unsaved"));
  });
});
