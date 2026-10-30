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
