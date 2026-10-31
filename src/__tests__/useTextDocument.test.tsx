import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { useTextDocument, type TextDocumentOptions, type TextDocumentResult } from "../editor/useTextDocument";
import type { FileTypeInfo } from "../services/files";
import { deleteDraft, readDraft, writeDraft } from "../services/recovery";
import { pickSavePath, saveText } from "../services/textFiles";

vi.mock("../services/textFiles", () => ({ saveText: vi.fn(), pickSavePath: vi.fn() }));
vi.mock("../services/recovery", () => ({ readDraft: vi.fn(), writeDraft: vi.fn(), deleteDraft: vi.fn() }));

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

let latest: TextDocumentResult | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Probe(props: Partial<TextDocumentOptions>) {
  const doc = useTextDocument({
    info: INFO,
    url: "http://adpfile.localhost/t/a.txt",
    active: true,
    protectedView: false,
    paged: false,
    part: 0,
    phrases: {},
    spellcheck: false,
    lang: "en",
    ...props,
  });
  latest = doc;
  return <div ref={doc.hostRef} />;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function render(overrides: Partial<TextDocumentOptions> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<Probe {...overrides} />);
  });
  await flush();
}

async function rerender(overrides: Partial<TextDocumentOptions>) {
  await act(async () => {
    root?.render(<Probe {...overrides} />);
  });
  await flush();
}

function type(text: string) {
  act(() => {
    latest!.viewRef.current!.dispatch({ changes: { from: 0, insert: text }, userEvent: "input.type" });
  });
}

function text(): string {
  return latest!.viewRef.current!.state.doc.toString();
}

beforeEach(() => {
  latest = null;
  vi.mocked(saveText).mockReset();
  vi.mocked(pickSavePath).mockReset();
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

describe("useTextDocument", () => {
  it("loads clean and becomes editable", async () => {
    await render();
    expect(text()).toBe("one\ntwo\n");
    expect(latest!.dirty).toBe(false);
    expect(latest!.readOnly).toBeNull();
    expect(latest!.viewRef.current!.state.readOnly).toBe(false);
    expect(latest!.lineEnding).toBe("crlf");
    expect(latest!.saveEncoding).toBe("utf-8");
  });

  it("typing makes it dirty and saving makes it clean", async () => {
    const onDirtyChange = vi.fn();
    vi.mocked(saveText).mockResolvedValue({ path: INFO.path, size: 11, modified_unix: 200 });
    await render({ onDirtyChange });

    type("x");
    expect(latest!.dirty).toBe(true);
    expect(onDirtyChange).toHaveBeenCalledWith(true);

    let saved = false;
    await act(async () => {
      saved = await latest!.save();
    });
    expect(saved).toBe(true);
    expect(saveText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "xone\r\ntwo\r\n",
        mode: "save",
        expected_modified_unix: 100,
        expected_size: 10,
        force: false,
      }),
    );
    expect(latest!.dirty).toBe(false);
    expect(deleteDraft).toHaveBeenCalled();
  });

  it("protected view keeps it read-only", async () => {
    await render({ protectedView: true });
    expect(latest!.readOnly).toBe("protected");
    expect(latest!.viewRef.current!.state.readOnly).toBe(true);

    await rerender({ protectedView: false });
    expect(latest!.readOnly).toBeNull();
    expect(latest!.viewRef.current!.state.readOnly).toBe(false);
  });

  it("a changed file asks before overwriting", async () => {
    vi.mocked(saveText)
      .mockRejectedValueOnce("textSave.changed_on_disk")
      .mockResolvedValueOnce({ path: INFO.path, size: 11, modified_unix: 200 });
    await render();
    type("x");

    let pending!: Promise<boolean>;
    await act(async () => {
      pending = latest!.save();
      await Promise.resolve();
    });
    expect(latest!.conflict).toBe(true);

    let outcome = false;
    await act(async () => {
      latest!.resolveConflict("overwrite");
      outcome = await pending;
    });
    expect(outcome).toBe(true);
    expect(vi.mocked(saveText).mock.calls[1][0].force).toBe(true);
  });

  it("unmappable characters stop the save", async () => {
    await render();
    act(() => latest!.setSaveEncoding("windows-1251"));
    type("é");

    await act(async () => {
      await latest!.save();
    });
    expect(saveText).not.toHaveBeenCalled();
    expect(latest!.notice).toContain("line 1");
  });

  it("a recovery copy is written two seconds after typing", async () => {
    vi.useFakeTimers();
    await render();
    type("x");

    await act(async () => {
      vi.advanceTimersByTime(1999);
    });
    expect(writeDraft).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(writeDraft).toHaveBeenCalledTimes(1);
    expect(writeDraft).toHaveBeenCalledWith(INFO.path, "xone\ntwo\n", 100);
  });

  it("a found draft can be restored", async () => {
    vi.mocked(readDraft).mockResolvedValue({
      schema_version: 1,
      path: INFO.path,
      text: "changed",
      saved_unix: 5,
      file_modified_unix: 2,
    });
    await render();
    expect(latest!.draft).not.toBeNull();

    act(() => latest!.restoreDraft());
    expect(text()).toBe("changed");
    expect(latest!.dirty).toBe(true);
  });

  it("Save as switches to the new file", async () => {
    vi.mocked(pickSavePath).mockResolvedValue("C:\\A\\b.txt");
    vi.mocked(saveText).mockResolvedValue({ path: "C:\\A\\b.txt", size: 11, modified_unix: 200 });
    const onPathChange = vi.fn();
    await render({ onPathChange });
    type("x");

    await act(async () => {
      await latest!.saveAs();
    });
    expect(saveText).toHaveBeenCalledWith(expect.objectContaining({ mode: "saveAs", path: "C:\\A\\b.txt" }));
    expect(onPathChange).toHaveBeenCalledWith("C:\\A\\b.txt");
    expect(latest!.dirty).toBe(false);
  });
});
