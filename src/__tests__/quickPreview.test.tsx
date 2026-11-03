import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import QuickPreviewDialog from "../preview/QuickPreviewDialog";
import { useQuickPreview, type QuickPreviewController } from "../preview/useQuickPreview";
import type { ExplorerItem } from "../services/explorer";

vi.mock("../components/PreviewSurface", () => ({
  default: () => null,
  usePreviewInfo: () => null,
  PreviewFallback: ({ name }: { name: string }) => <div data-preview-fallback>{name}</div>,
}));

vi.mock("../services/files", () => ({
  fileDetect: vi.fn(async (path: string) => ({
    path,
    name: path.split("\\").pop() ?? path,
    ext: "txt",
    mime: "text/plain",
    size: 100,
    modified_unix: 1700000000,
    online_only: false,
    read_only: false,
    from_internet: false,
  })),
  extensionOf: (name: string) => name.split(".").pop()?.toLowerCase() ?? "",
  fileGrant: vi.fn(async () => "a".repeat(32)),
  fileRevoke: vi.fn(async () => undefined),
  fileUrl: (token: string, name: string) => `http://adpfile.localhost/${token}/${name}`,
}));

vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));
vi.mock("../services/previewAccess", async () => {
  const files = await import("../services/files");
  return { previewDetect: vi.fn((path: string) => files.fileDetect(path)) };
});

const item = (name: string, kind: ExplorerItem["kind"] = "file"): ExplorerItem => ({
  path: `C:\\F\\${name}`,
  name,
  kind,
  size: 100,
  modified_unix: 1700000000,
  hidden: false,
  system: false,
  is_link: false,
  online_only: false,
  file_id: null,
  file_id_stable: false,
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  await i18n.changeLanguage("en");
});

async function renderDialog(items: ExplorerItem[], path: string, onOpen = vi.fn(async () => undefined)) {
  const onClose = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <QuickPreviewDialog
        selection={{ items, path, origin: null }}
        onClose={onClose}
        onOpen={onOpen}
        onOpenHelp={() => undefined}
      />,
    ),
  );
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
  return { dialog, onClose, onOpen };
}

const key = async (dialog: HTMLElement | null, name: string) => {
  await act(async () => {
    dialog?.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
};

function button(dialog: HTMLElement | null, label: string): HTMLButtonElement | null {
  const candidates = dialog?.querySelectorAll<HTMLButtonElement>("button[aria-label]") ?? [];
  return Array.from(candidates).find((candidate) => candidate.getAttribute("aria-label") === label) ?? null;
}

describe("quick preview dialog", () => {
  it("disables Previous at the first eligible file", async () => {
    const { dialog } = await renderDialog(
      [item("folder", "folder"), item("a.txt"), item("b.txt")],
      "C:\\F\\a.txt",
    );
    expect(button(dialog, "Previous file")?.disabled).toBe(true);
    expect(button(dialog, "Next file")?.disabled).toBe(false);
  });

  it("moves with the arrow keys and disables Next at the end", async () => {
    const { dialog } = await renderDialog([item("a.txt"), item("b.txt")], "C:\\F\\a.txt");
    await key(dialog, "ArrowRight");
    expect(button(dialog, "Previous file")?.disabled).toBe(false);
    expect(button(dialog, "Next file")?.disabled).toBe(true);
  });

  it("Escape and Space close the dialog", async () => {
    const { dialog, onClose } = await renderDialog([item("a.txt")], "C:\\F\\a.txt");
    await key(dialog, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    await key(dialog, " ");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("Space on a button is left to the button", async () => {
    const { dialog, onClose } = await renderDialog([item("a.txt")], "C:\\F\\a.txt");
    const next = button(dialog, "Next file");
    await act(async () => {
      next?.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the Spanish navigation labels", async () => {
    await i18n.changeLanguage("es");
    const { dialog } = await renderDialog([item("a.txt"), item("b.txt")], "C:\\F\\a.txt");
    expect(button(dialog, "Archivo anterior")).not.toBeNull();
    expect(button(dialog, "Archivo siguiente")).not.toBeNull();
  });

  it("uses the same dialog structure in the dark theme", async () => {
    document.documentElement.dataset.theme = "dark";
    const { dialog } = await renderDialog([item("a.txt")], "C:\\F\\a.txt");
    expect(dialog).not.toBeNull();
    expect(dialog?.className).toContain("adp-preview-dialog");
    delete document.documentElement.dataset.theme;
  });

  it("Open closes the preview and then opens the file normally", async () => {
    const onOpen = vi.fn(async () => undefined);
    const { dialog, onClose } = await renderDialog([item("a.txt")], "C:\\F\\a.txt", onOpen);
    const open = Array.from(dialog?.querySelectorAll("button") ?? []).find((element) =>
      element.textContent?.includes("Open"),
    );
    await act(async () => open?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("C:\\F\\a.txt");
  });
});

describe("quick preview focus", () => {
  it("restores the exact invoking element", async () => {
    const origin = document.createElement("button");
    document.body.appendChild(origin);
    origin.focus();
    let controller: QuickPreviewController | null = null;
    function Probe() {
      const hook = useQuickPreview();
      useEffect(() => {
        controller = hook;
      }, [hook]);
      return <div>{hook.preview ? "open" : "closed"}</div>;
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const localRoot = createRoot(host);
    await act(async () => localRoot.render(<Probe />));
    const target = item("a.txt");
    await act(async () => controller?.toggle(target, [target]));
    await act(async () => controller?.close());
    expect(document.activeElement).toBe(origin);
    await act(async () => localRoot.unmount());
  });

  it("falls back to the list when the origin was deleted", async () => {
    const origin = document.createElement("button");
    document.body.appendChild(origin);
    origin.focus();
    const list = document.createElement("div");
    list.setAttribute("role", "listbox");
    list.tabIndex = 0;
    document.body.appendChild(list);
    list.appendChild(origin);
    origin.focus();
    let controller: QuickPreviewController | null = null;
    function Probe() {
      const hook = useQuickPreview();
      controller = hook;
      return <div>{hook.preview ? "open" : "closed"}</div>;
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const localRoot = createRoot(host);
    await act(async () => localRoot.render(<Probe />));
    const target = item("a.txt");
    await act(async () => controller?.toggle(target, [target]));
    origin.remove();
    await act(async () => controller?.close());
    expect(document.activeElement).toBe(list);
    await act(async () => localRoot.unmount());
  });

  it("repeated Space closes the open preview", async () => {
    const controller: { current: QuickPreviewController | null } = { current: null };
    function Probe() {
      controller.current = useQuickPreview();
      return <div>{controller.current.preview ? "open" : "closed"}</div>;
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const localRoot = createRoot(host);
    await act(async () => localRoot.render(<Probe />));
    const target = item("a.txt");
    await act(async () => controller.current?.toggle(target, [target]));
    expect(controller.current?.preview?.path).toBe("C:\\F\\a.txt");
    await act(async () => controller.current?.toggle(target, [target]));
    expect(controller.current?.preview).toBeNull();
    await act(async () => localRoot.unmount());
  });
});


describe("modal command isolation", () => {
  it("keeps destructive window shortcuts out of the background scope", async () => {
    const dispatch = vi.fn();
    window.addEventListener("keydown", dispatch);
    const { dialog } = await renderDialog([item("a.txt")], "C:\\F\\a.txt");
    await key(dialog, "Delete"); await key(dialog, "F2");
    expect(dispatch).not.toHaveBeenCalled();
    window.removeEventListener("keydown", dispatch);
  });
  it("a key consumed by a child does not also navigate", async () => {
    const { dialog } = await renderDialog([item("a.txt"), item("b.txt")], "C:\\F\\a.txt");
    const child = document.createElement("div"); dialog?.appendChild(child);
    child.addEventListener("keydown", event => event.preventDefault());
    await key(child, "ArrowRight");
    expect(button(dialog, "Previous file")?.disabled).toBe(true);
  });
  it("makes the actual background inert and restores it after closing", async () => {
    const background = document.createElement("div"); document.body.appendChild(background);
    await renderDialog([item("a.txt")], "C:\\F\\a.txt");
    expect(background.inert).toBe(true);
    await act(async () => root?.unmount()); root = null;
    expect(background.inert).toBe(false);
  });
  it("failed detection never mounts a parser or acquires bytes", async () => {
    const files = await import("../services/files");
    vi.mocked(files.fileDetect).mockRejectedValueOnce(new Error("files.denied"));
    const { dialog } = await renderDialog([item("a.txt")], "C:\\F\\a.txt");
    expect(dialog?.querySelector("[data-preview-fallback]")).not.toBeNull();
    expect(files.fileGrant).not.toHaveBeenCalled();
  });
});
