import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { ExplorerItem } from "../services/explorer";
import {
  closeGallery,
  galleryPage,
  listenGalleryChanges,
  pickGallerySource,
  startGallery,
  type GalleryItem,
  type GalleryPage,
  type GallerySettings,
} from "../services/gallery";
import { EMPTY_SELECTION, selectOnly, type SelectionState } from "../services/selection";
import GalleryContent from "../views/gallery/GalleryContent";
import GalleryGrid, {
  GALLERY_CELL_WIDTH,
  GALLERY_GAP,
  GALLERY_PADDING,
  galleryColumns,
} from "../views/gallery/GalleryGrid";
import { groupGalleryItems } from "../views/gallery/galleryDates";
import {
  GALLERY_IDLE_CLOSE_MS,
  useGallery as useGalleryHook,
  type GalleryController,
  type GalleryServices,
} from "../views/gallery/useGallery";
import {
  keepGallerySelection,
  mergeGalleryItems,
  singleGallerySelection,
} from "../views/gallery/gallerySelection";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => options.count * 228,
    getVirtualItems: () =>
      Array.from({ length: Math.min(options.count, 3) }, (_, index) => ({
        index,
        start: index * options.estimateSize(index),
        key: index,
      })),
    scrollToIndex: () => undefined,
  }),
}));

vi.mock("../components/FileThumbnail", () => ({
  default: ({ fallback }: { fallback: unknown }) => fallback,
}));

vi.mock("../preview/QuickPreviewDialog", () => ({
  QuickPreviewDialog: ({ selection }: { selection: { path: string } }) => (
    <div data-testid="quick-preview">{selection.path}</div>
  ),
}));

vi.mock("../services/metadata", () => ({
  readMetadata: vi.fn(),
  releaseMetadata: vi.fn(async () => undefined),
}));

vi.mock("../services/gallery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/gallery")>();
  return {
    ...actual,
    startGallery: vi.fn(),
    galleryPage: vi.fn(),
    closeGallery: vi.fn(async () => undefined),
    pickGallerySource: vi.fn(async () => null),
    listenGalleryChanges: vi.fn(async () => () => undefined),
    listenGalleryScanFinished: vi.fn(async () => () => undefined),
  };
});

const GENERATION = "00000000-0000-4000-8000-0000000000aa";

function explorerItem(index: number): ExplorerItem {
  return {
    path: `C:\\Pictures\\p${index}.png`,
    name: `p${index}.png`,
    kind: "file",
    size: 1,
    modified_unix: 1_700_000_000 - index,
    hidden: false,
    system: false,
    is_link: false,
    online_only: false,
    file_id: null,
    file_id_stable: false,
  };
}

function galleryItem(index: number): GalleryItem {
  return {
    item: explorerItem(index),
    identity: `path:c:\\pictures\\p${index}.png`,
    taken_utc: null,
    group_key: "2023-11",
    source_ids: ["00000000-0000-4000-8000-000000000001"],
  };
}

function page(overrides: Partial<GalleryPage> = {}): GalleryPage {
  return {
    generation: GENERATION,
    items: [],
    next_cursor: null,
    complete: true,
    partial: false,
    skipped_count: 0,
    limit_reason: null,
    ...overrides,
  };
}

function job(result: GalleryPage) {
  return {
    id: "gallery-job",
    cancel: vi.fn(async () => undefined),
    completion: Promise.resolve(result),
  };
}

const source: GallerySettings["sources"][number] = {
  id: "00000000-0000-4000-8000-000000000001",
  path: "C:\\Pictures",
  recursive: true,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(async () => {
  vi.mocked(startGallery).mockReset();
  vi.mocked(galleryPage).mockReset();
  vi.mocked(closeGallery).mockReset();
  vi.mocked(pickGallerySource).mockReset();
  vi.mocked(listenGalleryChanges).mockReset();
  vi.mocked(listenGalleryChanges).mockResolvedValue(() => undefined);
  vi.mocked(closeGallery).mockResolvedValue(undefined);
  vi.mocked(pickGallerySource).mockResolvedValue(null);
  vi.mocked(startGallery).mockResolvedValue(job(page()));
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

const groupsOf = (count: number) =>
  groupGalleryItems(
    Array.from({ length: count }, (_, index) => galleryItem(index)),
    "modified",
    "UTC",
    "en",
  );

async function renderGrid(count: number, initial: SelectionState = EMPTY_SELECTION) {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let selection = initial;
  const opens: Array<[GalleryItem, boolean]> = [];
  const previews: GalleryItem[] = [];
  const rerender = async () => {
    await act(async () => {
      root?.render(
        <GalleryGrid
          groups={groupsOf(count)}
          selection={selection}
          onSelectionChange={(next) => {
            selection = next;
            void rerender();
          }}
          onOpen={(item, background) => opens.push([item, background ?? false])}
          onPreview={(item) => previews.push(item)}
          showExtensions
          active
          label="Gallery"
          hasMore={false}
          loadingMore={false}
          onLoadMore={() => undefined}
        />,
      );
    });
  };
  await rerender();
  const list = container.querySelector<HTMLElement>("[role='listbox']")!;
  const key = async (init: KeyboardEventInit) => {
    await act(async () => {
      list.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    });
  };
  const options = () =>
    [...container!.querySelectorAll<HTMLElement>("[role='option']")];
  return {
    key,
    options,
    opens,
    previews,
    current: () => selection,
  };
}

async function renderContent(
  settings: GallerySettings,
  onOpenFile: (path: string, background: boolean) => Promise<void> = async () =>
    undefined,
) {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <GalleryContent
        settings={settings}
        active
        showExtensions
        onOpenFile={onOpenFile}
        onSettingsChange={async () => undefined}
        onOpenHelp={() => undefined}
      />,
    ),
  );
  await flush();
}

describe("GalleryGrid", () => {
  it("renders only the viewport plus overscan rows", async () => {
    const grid = await renderGrid(100);
    expect(grid.options()).toHaveLength(8);
    expect(grid.options().length).toBeLessThan(100);
  });

  it("fits four 184px cells with 12px gaps inside 928px at 960px", async () => {
    expect(galleryColumns(960)).toBe(4);
    expect(4 * GALLERY_CELL_WIDTH + 3 * GALLERY_GAP).toBeLessThanOrEqual(
      960 - GALLERY_PADDING * 2,
    );
    await renderGrid(8);
    const rows = [...container!.querySelectorAll<HTMLElement>(".adp-gallery-row")];
    expect(rows.map((row) => row.querySelectorAll("[role='option']").length)).toEqual([
      4, 4,
    ]);
  });

  it("moves the caret and extends the range with the layout", async () => {
    const grid = await renderGrid(6, selectOnly("C:\\Pictures\\p0.png"));
    await grid.key({ key: "ArrowDown" });
    expect([...grid.current().selected]).toEqual(["C:\\Pictures\\p4.png"]);
    await grid.key({ key: "ArrowRight" });
    expect([...grid.current().selected]).toEqual(["C:\\Pictures\\p5.png"]);
    await grid.key({ key: "ArrowLeft", shiftKey: true });
    expect([...grid.current().selected].sort()).toEqual([
      "C:\\Pictures\\p4.png",
      "C:\\Pictures\\p5.png",
    ]);
    await grid.key({ key: "Home" });
    expect([...grid.current().selected]).toEqual(["C:\\Pictures\\p0.png"]);
  });

  it("opens with Enter or a double-click and previews with Space", async () => {
    const grid = await renderGrid(6, selectOnly("C:\\Pictures\\p0.png"));
    await grid.key({ key: "Enter" });
    expect(grid.opens[0][0].item.path).toBe("C:\\Pictures\\p0.png");
    expect(grid.opens[0][1]).toBe(false);
    await grid.key({ key: " " });
    expect(grid.previews[0].item.path).toBe("C:\\Pictures\\p0.png");
    const second = grid.options()[1];
    await act(async () => {
      second.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(grid.opens[1][0].item.path).toBe("C:\\Pictures\\p1.png");
    await act(async () => {
      second.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    });
    expect(grid.opens[2][1]).toBe(true);
  });

  it("drops a vanished selection instead of selecting a neighbour", () => {
    const selected = selectOnly("C:\\Pictures\\gone.png");
    const next = keepGallerySelection(selected, [galleryItem(1)]);
    expect(next.selected.size).toBe(0);
    expect(next.focus).toBeNull();
    expect(singleGallerySelection([galleryItem(1)], next)).toBeNull();
  });

  it("merges pages by stable key", () => {
    const first = [galleryItem(1), galleryItem(2)];
    const second = [galleryItem(2), galleryItem(3)];
    expect(mergeGalleryItems(first, second)).toHaveLength(3);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function jobOf(completion: Promise<GalleryPage>) {
  return {
    id: "gallery-job",
    cancel: vi.fn(async () => undefined),
    completion,
  };
}

function servicesFor(): GalleryServices {
  return {
    start: vi.fn(async () => jobOf(Promise.resolve(page()))),
    page: vi.fn(async () => page()),
    close: vi.fn(async () => undefined),
    listen: vi.fn(async () => () => undefined),
    listenFinished: vi.fn(async () => () => undefined),
  };
}

let probe: GalleryController | null = null;

function Probe({
  settings,
  active,
  services,
}: {
  settings: GallerySettings;
  active: boolean;
  services: GalleryServices;
}) {
  probe = useGalleryHook({
    settings,
    active,
    showHidden: false,
    showSystem: false,
    services,
    metadata: async () => null,
  });
  return null;
}

async function mountProbe(
  settings: GallerySettings,
  active: boolean,
  services: GalleryServices,
) {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  probe = null;
  await act(async () => root?.render(<Probe settings={settings} active={active} services={services} />));
  await flush();
}

async function rerenderProbe(
  settings: GallerySettings,
  active: boolean,
  services: GalleryServices,
) {
  await act(async () => {
    root?.render(<Probe settings={settings} active={active} services={services} />);
  });
}

describe("useGallery lifecycle", () => {
  it("ignores a late reply from an older source state", async () => {
    const first = deferred<GalleryPage>();
    const second = deferred<GalleryPage>();
    let calls = 0;
    const services = servicesFor();
    services.start = vi.fn(async () =>
      jobOf(calls++ === 0 ? first.promise : second.promise),
    );
    const firstSettings: GallerySettings = {
      sources: [source],
      date_source: "taken",
    };
    const secondSettings: GallerySettings = {
      sources: [
        {
          ...source,
          id: "00000000-0000-4000-8000-000000000002",
          path: "C:\\Pictures2",
        },
      ],
      date_source: "taken",
    };
    await mountProbe(firstSettings, true, services);
    expect(services.start).toHaveBeenCalledTimes(1);
    await rerenderProbe(secondSettings, true, services);
    await flush();
    expect(services.start).toHaveBeenCalledTimes(2);

    second.resolve(
      page({
        generation: "00000000-0000-4000-8000-0000000000bb",
        items: [galleryItem(2)],
      }),
    );
    await flush();
    expect(probe?.items.map((item) => item.item.name)).toEqual(["p2.png"]);

    first.resolve(
      page({
        generation: "00000000-0000-4000-8000-0000000000aa",
        items: [galleryItem(1)],
      }),
    );
    await flush();
    expect(probe?.items.map((item) => item.item.name)).toEqual(["p2.png"]);
  });

  it("closes the session 30 seconds after the Gallery becomes inactive", async () => {
    const services = servicesFor();
    services.start = vi.fn(async () =>
      jobOf(
        Promise.resolve(
          page({
            generation: "00000000-0000-4000-8000-0000000000aa",
            items: [],
          }),
        ),
      ),
    );
    await mountProbe({ sources: [source], date_source: "taken" }, true, services);
    const generation = probe?.generation;
    expect(generation).toBe("00000000-0000-4000-8000-0000000000aa");
    vi.useFakeTimers();
    try {
      await rerenderProbe(
        { sources: [source], date_source: "taken" },
        false,
        services,
      );
      act(() => {
        vi.advanceTimersByTime(GALLERY_IDLE_CLOSE_MS);
      });
      expect(services.close).toHaveBeenCalledWith(generation);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GalleryContent states", () => {
  it("shows the add-folder empty state without sources", async () => {
    await renderContent({ sources: [], date_source: "taken" });
    expect(container!.textContent).toContain(i18n.t("gallery.empty"));
    expect(vi.mocked(startGallery)).not.toHaveBeenCalled();
  });

  it("shows no pictures when the folders are empty", async () => {
    vi.mocked(startGallery).mockResolvedValue(job(page()));
    await renderContent({ sources: [source], date_source: "taken" });
    expect(container!.textContent).toContain(i18n.t("gallery.noPictures"));
  });

  it("shows the partial notice with the exact skipped count", async () => {
    vi.mocked(startGallery).mockResolvedValue(
      job(
        page({
          items: [galleryItem(1)],
          partial: true,
          skipped_count: 3,
          limit_reason: "access",
        }),
      ),
    );
    await renderContent({ sources: [source], date_source: "taken" });
    expect(container!.textContent).toContain(i18n.t("gallery.partial"));
    expect(container!.textContent).toContain(
      i18n.t("gallery.skipped", { count: 3 }),
    );
    expect(
      [...container!.querySelectorAll("button")].some((button) =>
        (button.textContent ?? "").includes(i18n.t("commands.refresh")),
      ),
    ).toBe(true);
  });

  it("passes the exact path and background flag to the normal open pipeline", async () => {
    vi.mocked(startGallery).mockResolvedValue(
      job(page({ items: [galleryItem(1), galleryItem(2)] })),
    );
    const openFile = vi.fn(async () => undefined);
    await renderContent({ sources: [source], date_source: "taken" }, openFile);
    const list = container!.querySelector<HTMLElement>("[role='listbox']")!;
    await act(async () => {
      list.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    await act(async () => {
      list.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(openFile).toHaveBeenCalledWith("C:\\Pictures\\p1.png", false);
    const second = container!.querySelectorAll<HTMLElement>("[role='option']")[1];
    await act(async () => {
      second.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    });
    expect(openFile).toHaveBeenCalledWith("C:\\Pictures\\p2.png", true);
  });

  it("shows a translated error when the open pipeline falls back", async () => {
    vi.mocked(startGallery).mockResolvedValue(
      job(page({ items: [galleryItem(1)] })),
    );
    await renderContent({ sources: [source], date_source: "taken" }, async () => {
      throw new Error("files.other");
    });
    const list = container!.querySelector<HTMLElement>("[role='listbox']")!;
    await act(async () => {
      list.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    await act(async () => {
      list.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    await flush();
    expect(container!.textContent).toContain(i18n.t("errors.files.other"));
  });

  it("opens the read-only preview with the current item list", async () => {
    vi.mocked(startGallery).mockResolvedValue(
      job(page({ items: [galleryItem(1), galleryItem(2)] })),
    );
    await renderContent({ sources: [source], date_source: "taken" });
    const list = container!.querySelector<HTMLElement>("[role='listbox']")!;
    await act(async () => {
      list.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    await act(async () => {
      list.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }));
    });
    await flush();
    expect(container!.textContent).toContain("C:\\Pictures\\p1.png");
  });
});
