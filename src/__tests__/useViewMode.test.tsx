import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOLDER_VIEWS_CLEARED_EVENT } from "../services/folderViews";
import { defaultSettings, type ExplorerViewSettings } from "../services/settings";
import { useViewMode, type ViewModeState } from "../views/explorer/views/useViewMode";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let latest: ViewModeState | null = null;

interface ProbeProps {
  view: ExplorerViewSettings;
  folderPath: string | null;
  onViewChange?: (patch: Partial<ExplorerViewSettings>) => void;
}

/** Records the hook's result on every render, for the test to read. */
function Probe({ view, folderPath, onViewChange }: ProbeProps) {
  latest = useViewMode({ view, onViewChange, folderPath });
  return null;
}

async function renderProbe(props: ProbeProps) {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(<Probe {...props} />);
  });
  // Let the folder-view load settle inside act.
  await act(async () => undefined);
  return () => latest!;
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  latest = null;
});

describe("useViewMode", () => {
  it("uses the default view and remembers a folder's own view", async () => {
    const view = defaultSettings().explorer;
    const onViewChange = vi.fn();
    const get = await renderProbe({ view, folderPath: "C:\\A", onViewChange });
    expect(get().mode).toBe("details");
    await act(async () => get().setMode("tiles"));
    expect(get().mode).toBe("tiles");
    const withB = await renderProbe({ view, folderPath: "C:\\B", onViewChange });
    expect(withB().mode).toBe("details");
    const withA = await renderProbe({ view, folderPath: "c:\\a\\", onViewChange });
    expect(withA().mode).toBe("tiles");
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("changes the default view when folder memory is off", async () => {
    const view: ExplorerViewSettings = { ...defaultSettings().explorer, remember_view_per_folder: false };
    const onViewChange = vi.fn();
    const get = await renderProbe({ view, folderPath: "C:\\A", onViewChange });
    await act(async () => get().setMode("list"));
    expect(onViewChange).toHaveBeenCalledWith({ view_mode: "list" });
  });

  it("ignores hidden views and forgets on the cleared event", async () => {
    const view: ExplorerViewSettings = { ...defaultSettings().explorer, hidden_view_modes: ["tiles"] };
    const get = await renderProbe({ view, folderPath: "C:\\A" });
    await act(async () => get().setMode("tiles"));
    expect(get().mode).toBe("details");
    await act(async () => get().setMode("content"));
    expect(get().mode).toBe("content");
    await act(async () => {
      window.dispatchEvent(new Event(FOLDER_VIEWS_CLEARED_EVENT));
    });
    expect(get().mode).toBe("details");
  });

  it("Column view stays on inside its folders", async () => {
    const view = defaultSettings().explorer;
    const onViewChange = vi.fn();
    const get = await renderProbe({ view, folderPath: "C:\\A", onViewChange });
    await act(async () => get().setMode("columns"));
    expect([get().mode, get().columnRoot]).toEqual(["columns", "C:\\A"]);
    const b = await renderProbe({ view, folderPath: "C:\\A\\B", onViewChange });
    expect([b().mode, b().columnRoot]).toEqual(["columns", "C:\\A"]);
    const c = await renderProbe({ view, folderPath: "C:\\A\\B\\C", onViewChange });
    expect([c().mode, c().columnRoot]).toEqual(["columns", "C:\\A"]);
    const root = await renderProbe({ view, folderPath: "C:\\", onViewChange });
    expect([root().mode, root().columnRoot]).toEqual(["columns", "C:\\"]);
    const other = await renderProbe({ view, folderPath: "D:\\X", onViewChange });
    expect([other().mode, other().columnRoot]).toEqual(["details", null]);
    const back = await renderProbe({ view, folderPath: "C:\\A", onViewChange });
    expect([back().mode, back().columnRoot]).toEqual(["columns", "C:\\A"]);
  });

  it("choosing another view leaves Column view", async () => {
    const view = defaultSettings().explorer;
    const onViewChange = vi.fn();
    const get = await renderProbe({ view, folderPath: "C:\\A", onViewChange });
    await act(async () => get().setMode("columns"));
    await renderProbe({ view, folderPath: "C:\\A\\B", onViewChange });
    expect(get().mode).toBe("columns");
    await act(async () => get().setMode("largeIcons"));
    expect([get().mode, get().columnRoot]).toEqual(["largeIcons", null]);
    await renderProbe({ view, folderPath: "C:\\A\\B\\C", onViewChange });
    expect([get().mode, get().columnRoot]).toEqual(["details", null]);
  });

  it("with folder memory off, Column view follows the default view", async () => {
    const view: ExplorerViewSettings = {
      ...defaultSettings().explorer,
      remember_view_per_folder: false,
      view_mode: "columns",
    };
    const onViewChange = vi.fn();
    const get = await renderProbe({ view, folderPath: "C:\\A", onViewChange });
    expect([get().mode, get().columnRoot]).toEqual(["columns", "C:\\A"]);
    await renderProbe({ view, folderPath: "C:\\A\\B", onViewChange });
    expect([get().mode, get().columnRoot]).toEqual(["columns", "C:\\A"]);
    await act(async () => get().setMode("details"));
    expect(onViewChange).toHaveBeenCalledWith({ view_mode: "details" });
    await renderProbe({ view: { ...view, view_mode: "details" }, folderPath: "C:\\A\\B", onViewChange });
    expect([get().mode, get().columnRoot]).toEqual(["details", null]);
  });

  it("a hidden Column view never shows", async () => {
    const view: ExplorerViewSettings = {
      ...defaultSettings().explorer,
      view_mode: "columns",
      hidden_view_modes: ["columns"],
    };
    const get = await renderProbe({ view, folderPath: "C:\\A" });
    expect([get().mode, get().columnRoot]).toEqual(["details", null]);
  });

  it("zoomStep walks the sizes", async () => {
    const get = await renderProbe({ view: defaultSettings().explorer, folderPath: "C:\\A" });
    await act(async () => get().zoomStep(1));
    expect(get().mode).toBe("list");
    await act(async () => get().zoomStep(1));
    expect(get().mode).toBe("smallIcons");
    await act(async () => get().zoomStep(-1));
    expect(get().mode).toBe("list");
  });
});
