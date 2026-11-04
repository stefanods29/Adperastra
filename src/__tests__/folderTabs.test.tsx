import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultFolderTabState } from "../services/folderState";
import { useFolderTabState, type FolderTabViewState } from "../views/folders/useFolderTabState";

const watchers = new Map<string, { active: boolean; released: boolean }>();

vi.mock("../services/watcherMultiplexer", () => ({
  INACTIVE_WATCH_RELEASE_MS: 30000,
  watchSubscribe: vi.fn(async (path: string) => {
    const subscription = { subscription_id: `sub-${path}`, root: path, generation: 1 };
    watchers.set(subscription.subscription_id, { active: true, released: false });
    return subscription;
  }),
  watchUnsubscribe: vi.fn(async (id: string) => {
    const watcher = watchers.get(id);
    if (watcher) watcher.released = true;
  }),
  watchSetActive: vi.fn((id: string, active: boolean) => {
    const watcher = watchers.get(id);
    if (watcher) watcher.active = active;
  }),
  watchConsumerCount: () => watchers.size,
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  watchers.clear();
});

interface Probe {
  a: FolderTabViewState;
  b: FolderTabViewState;
}

async function renderTwoTabs(): Promise<Probe> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let probe: Probe | null = null;
  function Harness() {
    const a = useFolderTabState(defaultFolderTabState("C:\\a"), true, () => undefined);
    const b = useFolderTabState(defaultFolderTabState("C:\\b"), true, () => undefined);
    probe = { a, b };
    return null;
  }
  await act(async () => {
    root?.render(<Harness />);
  });
  // Re-read the latest render's state after every update: the hook returns
  // a fresh snapshot, so the first object must not be held.
  return {
    get a() {
      return probe!.a;
    },
    get b() {
      return probe!.b;
    },
  };
}

describe("independent folder tab views (T4)", () => {
  it("folder_a_selection_does_not_change_b", async () => {
    const probe = await renderTwoTabs();
    await act(async () => {
      probe.a.setSelectedPaths(["C:\\a\\one.txt"]);
    });
    expect(probe.a.selectedPaths).toEqual(["C:\\a\\one.txt"]);
    expect(probe.b.selectedPaths).toEqual([]);
  });

  it("one_folder_preview_does_not_control_another", async () => {
    const probe = await renderTwoTabs();
    await act(async () => {
      probe.a.setPreviewItem({
        path: "C:\\a\\pic.png",
        name: "pic.png",
        kind: "file",
        size: 1,
        modified_unix: 1,
        hidden: false,
        system: false,
        is_link: false,
        online_only: false,
        file_id: null,
        file_id_stable: false,
      });
    });
    expect(probe.a.previewItem?.path).toBe("C:\\a\\pic.png");
    expect(probe.b.previewItem).toBeNull();
  });

  it("each_tab_keeps_its_own_folder_state", async () => {
    const probe = await renderTwoTabs();
    await act(async () => {
      probe.a.setState({ ...probe.a.state, scroll_top: 400 });
    });
    expect(probe.a.state.scroll_top).toBe(400);
    expect(probe.b.state.scroll_top).toBe(0);
    expect(probe.b.state.path).toBe("C:\\b");
  });
});
