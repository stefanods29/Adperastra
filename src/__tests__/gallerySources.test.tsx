import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import {
  closeGallery,
  defaultGallerySettings,
  galleryPathKey,
  listenGalleryChanges,
  normalizeGallerySettings,
  pickGallerySource,
  startGallery,
  validateGallerySettings,
  type GalleryPage,
  type GallerySettings,
} from "../services/gallery";
import { defaultSettings, normalizeSettings } from "../services/settings";
import GalleryContent from "../views/gallery/GalleryContent";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => options.count * 228,
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
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

const source = (id: number, path: string): GallerySettings["sources"][number] => ({
  id: `00000000-0000-4000-8000-${id.toString().padStart(12, "0")}`,
  path,
  recursive: true,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(async () => {
  vi.mocked(startGallery).mockReset();
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

async function renderGallery(
  initial: GallerySettings,
  persist: (next: GallerySettings) => Promise<void>,
) {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const Harness = () => {
    const [settings, setSettings] = useState(initial);
    return (
      <GalleryContent
        settings={settings}
        active
        showExtensions
        onOpenFile={async () => undefined}
        onSettingsChange={async (next) => {
          await persist(next);
          setSettings(next);
        }}
        onOpenHelp={() => undefined}
      />
    );
  };
  await act(async () => root?.render(<Harness />));
  await flush();
}

function buttonsByText(text: string): HTMLButtonElement[] {
  return [...container!.querySelectorAll<HTMLButtonElement>("button")].filter((button) =>
    (button.textContent ?? "").includes(text),
  );
}

function buttonByLabel(label: string): HTMLButtonElement | null {
  const candidates = container!.querySelectorAll<HTMLButtonElement>("button[aria-label]");
  return Array.from(candidates).find((button) => button.getAttribute("aria-label") === label) ?? null;
}

describe("gallery settings", () => {
  it("migrates a schema 12 file, keeps background/cache and adds an empty Gallery", () => {
    const input = {
      schema_version: 12,
      language: "es",
      theme: { mode: "dark" },
      background: {
        enabled: false,
        only_idle: true,
        only_ac: false,
        paused: true,
        tasks: { thumbnails: false, metadata: true },
      },
      cache: { max_mb: 256 },
    };
    const normalized = normalizeSettings(input) as unknown as Record<string, unknown>;
    expect(normalized.language).toBe("es");
    expect((normalized.theme as Record<string, unknown>).mode).toBe("dark");
    expect(normalized.background).toMatchObject({
      enabled: false,
      only_idle: true,
      paused: true,
      tasks: { thumbnails: false, metadata: true },
    });
    expect(normalized.cache).toMatchObject({ max_mb: 256 });
    expect(normalized.gallery).toEqual({ sources: [], date_source: "taken" });
    expect(defaultSettings().schema_version).toBe(13);
  });

  it("refuses 33 sources", () => {
    const sources = Array.from({ length: 33 }, (_, index) =>
      source(index + 1, `C:\\Pictures\\set${index + 1}`),
    );
    expect(normalizeGallerySettings({ sources }).sources).toHaveLength(32);
    expect(
      validateGallerySettings({ sources, date_source: "taken" }),
    ).toBe("gallery.too_many");
  });

  it("refuses duplicate roots with a different case and long prefix", () => {
    const settings = {
      sources: [
        source(1, "C:\\Pictures\\Holiday"),
        source(2, "\\\\?\\c:\\pictures\\HOLIDAY\\"),
      ],
      date_source: "taken" as const,
    };
    expect(normalizeGallerySettings(settings).sources).toHaveLength(1);
    expect(validateGallerySettings(settings)).toBe("gallery.bad_request");
    expect(galleryPathKey("\\\\?\\C:\\Pictures\\Holiday\\")).toBe(
      galleryPathKey("c:\\pictures\\holiday"),
    );
  });

  it("accepts an empty source list", () => {
    const settings = defaultGallerySettings();
    expect(settings.sources).toEqual([]);
    expect(validateGallerySettings(settings)).toBeNull();
  });
});

describe("Gallery source controls", () => {
  it("adds a folder only after the settings save succeeds", async () => {
    vi.mocked(pickGallerySource).mockResolvedValue("C:\\Pictures");
    const persist = vi.fn(async (_next: GallerySettings) => undefined);
    await renderGallery(defaultGallerySettings(), persist);
    expect(container!.textContent).toContain(i18n.t("gallery.empty"));

    const add = buttonsByText(i18n.t("gallery.addFolder"))[0];
    await act(async () => add.click());
    await flush();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0].sources).toEqual([
      expect.objectContaining({ path: "C:\\Pictures", recursive: true }),
    ]);
    expect(container!.textContent).toContain("C:\\Pictures");
    expect(vi.mocked(startGallery)).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [expect.objectContaining({ path: "C:\\Pictures" })],
      }),
    );
  });

  it("keeps the previous sources when the save fails", async () => {
    const initial: GallerySettings = {
      sources: [source(1, "C:\\Pictures")],
      date_source: "taken",
    };
    const persist = vi.fn(async () => {
      throw new Error("gallery.bad_request");
    });
    await renderGallery(initial, persist);

    const remove = buttonByLabel(i18n.t("gallery.removeFolder"))!;
    await act(async () => remove.click());
    await flush();

    expect(container!.textContent).toContain("C:\\Pictures");
    expect(container!.textContent).toContain(i18n.t("errors.gallery.bad_request"));
  });

  it("removes only the reference and leaves no file operation behind", async () => {
    const initial: GallerySettings = {
      sources: [source(1, "C:\\Pictures")],
      date_source: "taken",
    };
    const persist = vi.fn(async (_next: GallerySettings) => undefined);
    await renderGallery(initial, persist);

    const remove = buttonByLabel(i18n.t("gallery.removeFolder"))!;
    await act(async () => remove.click());
    await flush();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0]).toEqual({
      sources: [],
      date_source: "taken",
    });
    // No Gallery file operation exists to call; the settings list is the
    // only thing that changed.
    expect(container!.textContent).not.toContain("C:\\Pictures");
  });

  it("shows the Spanish empty state and source labels", async () => {
    await i18n.changeLanguage("es");
    vi.mocked(pickGallerySource).mockResolvedValue("C:\\Imágenes");
    const persist = vi.fn(async () => undefined);
    await renderGallery(defaultGallerySettings(), persist);

    expect(container!.textContent).toContain(
      "Elige una carpeta para ver sus imágenes aquí.",
    );
    const add = buttonsByText("Agregar carpeta de imágenes…")[0];
    expect(add).toBeInstanceOf(HTMLButtonElement);
    await act(async () => add.click());
    await flush();
    expect(container!.textContent).toContain("Incluir subcarpetas");
    expect(container!.textContent).not.toContain("gallery.");
    await i18n.changeLanguage("en");
  });

  it("keeps add and remove on reachable buttons", async () => {
    const initial: GallerySettings = {
      sources: [source(1, "C:\\Pictures")],
      date_source: "taken",
    };
    await renderGallery(initial, async () => undefined);

    const add = buttonsByText(i18n.t("gallery.addFolder"))[0];
    add.focus();
    expect(document.activeElement).toBe(add);
    expect(add.tagName).toBe("BUTTON");
    const remove = buttonByLabel(i18n.t("gallery.removeFolder"))!;
    remove.focus();
    expect(document.activeElement).toBe(remove);
    expect(remove.tagName).toBe("BUTTON");
  });
});
