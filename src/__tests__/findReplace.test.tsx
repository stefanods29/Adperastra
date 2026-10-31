import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { FindRequest, HandlerViewProps } from "../handlers/types";
import { fileDetect, fileGrant, fileRevoke, type FileTypeInfo } from "../services/files";
import type { TabState } from "../services/tabs";
import FileTabView from "../views/FileTabView";

const state = vi.hoisted(() => ({ find: null as FindRequest | null, supportsReplace: true }));

vi.mock("../handlers", () => {
  const FakeView = (props: HandlerViewProps) => {
    state.find = props.find;
    return <div className="fake-view" />;
  };
  const handler = {
    id: "fake",
    version: 1,
    labelKey: "handlers.text",
    icon: () => null,
    accent: "explorer",
    extensions: ["txt"],
    mimeTypes: [],
    maxBytes: 1_000_000,
    helpSlug: "viewing-text",
    speedTier: "fast",
    supportsFind: true,
    get supportsReplace() {
      return state.supportsReplace;
    },
    view: FakeView,
  };
  return { handlers: { get: (id: string) => (id === "fake" ? handler : undefined) } };
});

vi.mock("../services/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/files")>()),
  fileDetect: vi.fn(),
  fileGrant: vi.fn(),
  fileRevoke: vi.fn(),
}));

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

const TAB: TabState = { id: "t1", kind: "file", title: "a.txt", path: "C:\\A\\a.txt", handler: "fake" };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <FileTabView
        tab={TAB}
        active={true}
        onShowInFolder={() => undefined}
        onOpenFolder={() => undefined}
        onClose={() => undefined}
        onViewState={() => undefined}
        onOpenHelp={() => undefined}
        protectedViewEnabled={false}
      />,
    );
  });
  await flush();
}

async function pressCtrlH() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "h", ctrlKey: true, bubbles: true, cancelable: true }));
  });
}

const searchInput = () => container!.querySelector<HTMLInputElement>(".adp-filetab-search input")!;
const replaceInput = () => container!.querySelector<HTMLInputElement>(".adp-filetab-replace input")!;
const buttonWithText = (text: string) =>
  [...container!.querySelectorAll("button")].find((entry) => entry.textContent === text) as HTMLButtonElement | undefined;

function typeInto(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  state.find = null;
  state.supportsReplace = true;
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  vi.mocked(fileDetect).mockResolvedValue(INFO);
  vi.mocked(fileGrant).mockResolvedValue("token");
  vi.mocked(fileRevoke).mockResolvedValue(undefined);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("find and replace", () => {
  it("Ctrl+H opens the replace row", async () => {
    await render();
    await pressCtrlH();
    const row = container!.querySelector(".adp-filetab-replace");
    expect(row).not.toBeNull();
    expect(document.activeElement).toBe(replaceInput());
  });

  it("replace and replace all ask the view", async () => {
    await render();
    await pressCtrlH();
    typeInto(searchInput(), "a");
    typeInto(replaceInput(), "b");

    act(() => buttonWithText(i18n.t("editor.replace"))!.click());
    expect(state.find!.replace).toEqual({ text: "b", request: 1, all: false });

    act(() => buttonWithText(i18n.t("editor.replaceAll"))!.click());
    expect(state.find!.replace).toEqual({ text: "b", request: 2, all: true });
  });

  it("match case reaches the view", async () => {
    await render();
    await pressCtrlH();
    const matchCase = [...container!.querySelectorAll("[role='switch']")].find(
      (entry) => entry.getAttribute("aria-label") === i18n.t("editor.matchCase"),
    ) as HTMLButtonElement;
    act(() => matchCase.click());
    expect(state.find!.options!.caseSensitive).toBe(true);
  });

  it("no replace row for viewers that can't replace", async () => {
    state.supportsReplace = false;
    await render();
    await pressCtrlH();
    expect(container!.querySelector(".adp-filetab-replace")).toBeNull();
  });
});
