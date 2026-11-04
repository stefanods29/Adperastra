import { act, type DragEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenDecision } from "../handlers/openPipeline";
import type { FileTypeInfo } from "../services/files";
import {
  MAX_OPEN_PATHS,
  TAB_DRAG_MIME,
  TRANSFER_DRAG_MIME,
  readDropPayload,
  routeFileDrop,
  type DropDataTransfer,
  type DropModifiers,
  type FileDropPorts,
} from "../transfer/tabDropRouting";
import { useTabDropTarget, type TabDropTarget } from "../transfer/useTabDropTarget";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const NO_MODIFIERS: DropModifiers = { ctrl: false, shift: false, alt: false };
const VALID_TRANSFER_ID = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

interface MountOptions {
  active?: boolean;
  hoverMs?: number;
  onActivate?: (tabId: string) => void;
  onDropFiles?: (paths: readonly string[]) => Promise<void>;
}

/** Mounts one E3 target and returns a reader for its latest hook result. */
async function mountTarget(options: MountOptions = {}): Promise<() => TabDropTarget> {
  const onActivate = options.onActivate ?? (() => undefined);
  const onDropFiles = options.onDropFiles ?? (async () => undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let current: TabDropTarget | null = null;
  function Harness() {
    current = useTabDropTarget({
      target_id: "target-1",
      tab_id: "tab-1",
      hover_ms: options.hoverMs ?? 600,
      active: options.active ?? true,
      onActivate,
      onDropFiles,
    });
    return null;
  }
  await act(async () => {
    root?.render(<Harness />);
  });
  return () => {
    if (!current) throw new Error("target_not_mounted");
    return current;
  };
}

function transferOf(options: {
  types?: readonly string[];
  data?: Readonly<Record<string, string>>;
  files?: readonly { path?: string }[];
}): DropDataTransfer {
  return {
    types: options.types ?? ["Files"],
    getData: (type: string) => options.data?.[type] ?? "",
    files: options.files ?? [],
  };
}

function filesTransfer(paths: readonly string[]): DropDataTransfer {
  return transferOf({ types: ["Files"], files: paths.map((path) => ({ path })) });
}

function dragEvent(dataTransfer: DropDataTransfer): DragEvent<HTMLElement> {
  return {
    dataTransfer,
    relatedTarget: null,
    currentTarget: { contains: () => false },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as DragEvent<HTMLElement>;
}

function infoOf(path: string): FileTypeInfo {
  return {
    path,
    name: path.split("\\").pop() ?? path,
    ext: "txt",
    mime: "text/plain",
    size: 1,
    modified_unix: 0,
    online_only: false,
    read_only: false,
    from_internet: false,
  };
}

function windowsDecision(path: string): OpenDecision {
  return { kind: "windows", info: infoOf(path) };
}

describe("tab hover activation (T4)", () => {
  it("hover_does_not_activate_at_599ms_and_activates_at_600ms", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const onActivate = vi.fn();
    const read = await mountTarget({ onActivate });
    const enter = dragEvent(filesTransfer(["C:\\src\\a.txt"]));

    act(() => read().onDragEnter(enter));
    expect(read().hover).toBe(true);

    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(onActivate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith("tab-1");
  });

  it("leaving_escape_and_inactive_targets_cancel_hover_activation", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const onActivate = vi.fn();
    const read = await mountTarget({ onActivate });

    act(() => read().onDragEnter(dragEvent(filesTransfer(["C:\\src\\a.txt"]))));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => read().onDragLeave(dragEvent(filesTransfer(["C:\\src\\a.txt"]))));
    expect(read().hover).toBe(false);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onActivate).not.toHaveBeenCalled();

    act(() => read().onDragEnter(dragEvent(filesTransfer(["C:\\src\\a.txt"]))));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onActivate).not.toHaveBeenCalled();
    expect(read().hover).toBe(false);
  });

  it("an_inactive_target_never_activates", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const onActivate = vi.fn();
    const read = await mountTarget({ onActivate, active: false });

    act(() => read().onDragEnter(dragEvent(filesTransfer(["C:\\src\\a.txt"]))));
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onActivate).not.toHaveBeenCalled();
    expect(read().hover).toBe(false);
  });
});

describe("typed drop routing (T4)", () => {
  it("bar_drop_opens_files_through_plan_open", async () => {
    const planOpen = vi.fn(async (path: string) => windowsDecision(path));
    const openDecision = vi.fn(
      async (_decision: OpenDecision, _background: boolean): Promise<string | null> => null,
    );
    const ports: FileDropPorts = { planOpen, openDecision };
    const paths = ["C:\\src\\a.txt", "C:\\src\\b.txt"];

    const result = await routeFileDrop({ kind: "bar" }, paths, NO_MODIFIERS, ports);

    expect(planOpen.mock.calls.map((call) => call[0])).toEqual(paths);
    expect(openDecision).toHaveBeenCalledTimes(2);
    expect(openDecision.mock.calls[0][1]).toBe(false);
    expect(result).toEqual({ kind: "opened", opened: 2, refused: 0 });

    const tooMany = Array.from({ length: MAX_OPEN_PATHS + 1 }, (_, index) => `C:\\src\\${index}.txt`);
    const refused = await routeFileDrop({ kind: "bar" }, tooMany, NO_MODIFIERS, ports);
    expect(refused).toEqual({ kind: "none", reason: "too_many" });
    expect(planOpen).toHaveBeenCalledTimes(2);
  });

  it("group_drop_assigns_fresh_tabs_to_the_group", async () => {
    let next = 0;
    const planOpen = vi.fn(async (path: string) => windowsDecision(path));
    const openDecision = vi.fn(
      async (_decision: OpenDecision, _background: boolean): Promise<string | null> => {
        next += 1;
        return `tab-${next}`;
      },
    );
    const addToGroup = vi.fn();
    const ports: FileDropPorts = { planOpen, openDecision, addToGroup };

    const result = await routeFileDrop(
      { kind: "group", groupId: "group-1" },
      ["C:\\src\\a.txt", "C:\\src\\b.txt"],
      NO_MODIFIERS,
      ports,
    );

    expect(result).toEqual({ kind: "opened", opened: 2, refused: 0 });
    expect(openDecision.mock.calls.every((call) => call[1] === true)).toBe(true);
    expect(addToGroup).toHaveBeenCalledTimes(1);
    expect(addToGroup).toHaveBeenCalledWith("group-1", ["tab-1", "tab-2"]);
  });

  it("folder_drop_delegates_copy_or_move_to_fileops", async () => {
    const copyMove = vi.fn(
      async (_kind: "copy" | "move", _sources: readonly string[], _destDir: string) => undefined,
    );
    const volumeOf = (path: string) => path.slice(0, 2).toUpperCase();
    const ports: FileDropPorts = { copyMove, volumeOf };
    const sources = ["C:\\src\\a.txt"];

    const sameVolume = await routeFileDrop(
      { kind: "folder", destDir: "C:\\dest" },
      sources,
      NO_MODIFIERS,
      ports,
    );
    expect(sameVolume).toEqual({ kind: "moved", count: 1 });
    expect(copyMove).toHaveBeenLastCalledWith("move", sources, "C:\\dest");

    const copied = await routeFileDrop(
      { kind: "folder", destDir: "C:\\dest" },
      sources,
      { ctrl: true, shift: false, alt: false },
      ports,
    );
    expect(copied).toEqual({ kind: "copied", count: 1 });
    expect(copyMove).toHaveBeenLastCalledWith("copy", sources, "C:\\dest");

    const moved = await routeFileDrop(
      { kind: "folder", destDir: "D:\\dest" },
      sources,
      { ctrl: false, shift: true, alt: false },
      ports,
    );
    expect(moved).toEqual({ kind: "moved", count: 1 });
    expect(copyMove).toHaveBeenLastCalledWith("move", sources, "D:\\dest");

    const mixedVolumes = await routeFileDrop(
      { kind: "folder", destDir: "C:\\dest" },
      ["D:\\src\\a.txt"],
      NO_MODIFIERS,
      ports,
    );
    expect(mixedVolumes).toEqual({ kind: "copied", count: 1 });
    expect(copyMove).toHaveBeenLastCalledWith("copy", ["D:\\src\\a.txt"], "C:\\dest");

    const sameFolder = await routeFileDrop(
      { kind: "folder", destDir: "C:\\src" },
      sources,
      NO_MODIFIERS,
      ports,
    );
    expect(sameFolder).toEqual({ kind: "none", reason: "same_folder" });
    expect(copyMove).toHaveBeenCalledTimes(4);
  });

  it("malformed_mime_never_authorizes_a_path", async () => {
    const smuggled = "C:\\Windows\\System32\\cmd.exe";

    expect(
      readDropPayload(
        transferOf({
          types: [TAB_DRAG_MIME, "text/plain"],
          data: {
            [TAB_DRAG_MIME]: JSON.stringify({ path: smuggled }),
            "text/plain": smuggled,
          },
          files: [],
        }),
      ),
    ).toEqual({ kind: "invalid" });

    expect(
      readDropPayload(
        transferOf({
          types: [TRANSFER_DRAG_MIME],
          data: {
            [TRANSFER_DRAG_MIME]: JSON.stringify({ transfer_id: "not-a-uuid", path: smuggled }),
          },
        }),
      ),
    ).toEqual({ kind: "invalid" });

    expect(
      readDropPayload(
        transferOf({ types: ["text/plain"], data: { "text/plain": smuggled }, files: [] }),
      ),
    ).toEqual({ kind: "invalid" });

    expect(
      readDropPayload(
        transferOf({
          types: ["Files"],
          files: [{ name: "cmd.exe" } as unknown as { path?: string }],
        }),
      ),
    ).toEqual({ kind: "invalid" });

    expect(
      readDropPayload(transferOf({ types: ["Files"], files: [{ path: smuggled }] })),
    ).toEqual({ kind: "files", paths: [smuggled] });
    expect(
      readDropPayload(
        transferOf({
          types: [TAB_DRAG_MIME],
          data: { [TAB_DRAG_MIME]: JSON.stringify({ tab_id: "file-abc-1" }) },
        }),
      ),
    ).toEqual({ kind: "tab", tabId: "file-abc-1" });
    expect(
      readDropPayload(
        transferOf({
          types: [TRANSFER_DRAG_MIME],
          data: { [TRANSFER_DRAG_MIME]: JSON.stringify({ transfer_id: VALID_TRANSFER_ID }) },
        }),
      ),
    ).toEqual({ kind: "content", transferId: VALID_TRANSFER_ID });

    const onDropFiles = vi.fn(async () => undefined);
    const read = await mountTarget({ onDropFiles });
    const drop = dragEvent(
      transferOf({
        types: [TAB_DRAG_MIME, "text/plain"],
        data: {
          [TAB_DRAG_MIME]: JSON.stringify({ path: smuggled }),
          "text/plain": smuggled,
        },
        files: [],
      }),
    );
    act(() => read().onDrop(drop));
    expect(onDropFiles).not.toHaveBeenCalled();
    expect(drop.preventDefault).not.toHaveBeenCalled();
  });
});
