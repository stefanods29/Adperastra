import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import PdfView from "../handlers/pdf/PdfView";
import type { JobHandle } from "../services/jobs";
import type { FileTypeInfo } from "../services/files";
import type { PdfPageImage, PdfSession, PdfTextPage } from "../services/pdf";

/** The PDF tab's layout rules (Step 07d T4): work stops when the tab is not
 * visible, only the virtualized pages exist, the sidebar and the pages agree
 * on the current page, the view scrolls at 400 %, and a quick preview never
 * offers printing. */

vi.mock("../services/pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/pdf")>();
  return {
    ...actual,
    openPdf: vi.fn(),
    closePdf: vi.fn(async () => undefined),
    renderPdfPage: vi.fn(),
    readPdfText: vi.fn(),
    pdfOutline: vi.fn(),
    searchPdf: vi.fn(),
    printPdf: vi.fn(),
  };
});

vi.mock("../services/cache", () => ({
  releaseCacheLease: vi.fn(async () => undefined),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number; estimateSize?: (index: number) => number }) => {
    const size = 400;
    const count = Math.min(options.count, 3);
    return {
      getTotalSize: () => options.count * size,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          index,
          start: index * size,
          size,
          key: index,
        })),
      scrollToIndex: vi.fn(),
      measure: vi.fn(),
    };
  },
}));

import { openPdf, renderPdfPage, readPdfText } from "../services/pdf";

const SOURCE: PdfSession["source"] = {
  kind: "disk",
  stamp: {
    path_key: "c:\\docs\\a.pdf",
    volume_id: "01234567",
    file_id: "0123456789abcdef",
    modified_ticks: "10",
    size_bytes: 1000,
  },
};

const session = (pageCount: number): PdfSession => ({
  session_id: "11111111-1111-1111-1111-111111111111",
  source: SOURCE,
  page_count: pageCount,
  password_required: false,
  permissions: { can_copy: true, can_print: true },
});

const image = (page: number): PdfPageImage => ({
  info: { page, width_pt: 595, height_pt: 842, rotation: 0 },
  image: {
    lease_id: "22222222-2222-2222-2222-222222222222",
    token: "0123456789abcdef0123456789abcdef",
    name: `page-${page}.png`,
    mime: "image/png",
    byte_len: 100,
    width: 512,
    height: 724,
    sensitive: false,
  },
  render_width: 512,
  render_height: 724,
  resolved_scale: 0.86,
  rendered_rotation: 0,
  request_revision: 1,
});

const textPage = (page: number): PdfTextPage => ({
  page,
  runs: [],
  next_run: null,
  complete: true,
  source: SOURCE,
});

function handle<T>(value: T): JobHandle<T> {
  return { id: "job", cancel: vi.fn(async () => undefined), completion: Promise.resolve(value) };
}

function pending<T>(): { handle: JobHandle<T>; done: (value: T) => void } {
  let done!: (value: T) => void;
  const completion = new Promise<T>((resolve) => {
    done = resolve;
  });
  return { handle: { id: "pending", cancel: vi.fn(async () => undefined), completion }, done };
}

const info: FileTypeInfo = {
  path: "C:\\docs\\a.pdf",
  name: "a.pdf",
  ext: "pdf",
  mime: "application/pdf",
  size: 1000,
  modified_unix: 0,
  online_only: false,
  read_only: false,
  from_internet: false,
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.mocked(openPdf).mockResolvedValue(handle(session(1000)));
  vi.mocked(renderPdfPage).mockImplementation(async (request) => handle(image(request.page)));
  vi.mocked(readPdfText).mockImplementation(async (_session, page) => textPage(page));
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.clearAllMocks();
});

async function render(patch: { active?: boolean; savedState?: unknown; previewOnly?: boolean } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props = {
    info,
    url: "http://adpfile.localhost/0123456789abcdef0123456789abcdef/a.pdf",
    active: patch.active ?? true,
    savedState: patch.savedState ?? null,
    onStateChange: () => undefined,
    onStatus: () => undefined,
    onOpenInWindowsApp: () => undefined,
    find: { text: "", request: 0, backwards: false },
    protectedView: false,
    previewOnly: patch.previewOnly ?? false,
  };
  await act(async () => root?.render(<PdfView {...props} />));
  await act(async () => undefined);
  return props;
}

describe("pdf viewer", () => {
  it("cancels the page work when the tab stops being visible", async () => {
    const work = pending<PdfPageImage>();
    vi.mocked(renderPdfPage).mockReturnValue(Promise.resolve(work.handle));
    const props = await render();
    expect(renderPdfPage).toHaveBeenCalled();
    await act(async () =>
      root?.render(<PdfView {...props} active={false} />),
    );
    expect(work.handle.cancel).toHaveBeenCalled();
  })

  it("mounts only the virtualized pages of a thousand-page document", async () => {
    await render();
    const pages = container?.querySelectorAll(".adp-pdf-page-row") ?? [];
    expect(pages).toHaveLength(3);
    expect(container?.querySelector(".adp-pdf-scroll")?.getAttribute("data-count")).toBe("1000");
    // The first page was rendered first (the visible one).
    expect(vi.mocked(renderPdfPage).mock.calls[0][0].page).toBe(1);
  })

  it("keeps the thumbnails and the page on the same page", async () => {
    await render();
    const thumbnails = [...(container?.querySelectorAll<HTMLButtonElement>(".adp-pdf-thumb") ?? [])];
    expect(thumbnails.length).toBeGreaterThan(1);
    const second = thumbnails[1];
    await act(async () => second.click());
    expect(container?.querySelector(".adp-pdf-scroll")?.getAttribute("data-page")).toBe("2");
    const selected = container?.querySelector('.adp-pdf-thumb[aria-current="page"]');
    expect(selected?.getAttribute("data-page")).toBe("2");
  })

  it("scrolls a page at 400 % without touching the ribbon", async () => {
    await render({ savedState: { zoom: 400, page: 2 } });
    const page = container?.querySelector<HTMLElement>(".adp-pdf-page");
    expect(page).not.toBeNull();
    const width = Number.parseFloat(page?.style.width ?? "0");
    expect(width).toBeGreaterThan(2000);
    expect(container?.querySelector(".adp-dock-bar")).not.toBeNull();
    const labelled = [...(container?.querySelectorAll("[aria-label]") ?? [])];
    expect(labelled.some((element) => element.getAttribute("aria-label") === "Thumbnails")).toBe(true);
  })

  it("never offers printing in a quick preview", async () => {
    await render({ previewOnly: true });
    const labels = [...(container?.querySelectorAll("button") ?? [])].map(
      (button) => button.getAttribute("aria-label") ?? "",
    );
    expect(labels.some((label) => label.startsWith("Print"))).toBe(false);
    expect(container?.querySelector('[role="dialog"]')).toBeNull();
  })

  it("offers printing for a normal document", async () => {
    await render();
    const labels = [...(container?.querySelectorAll("button") ?? [])].map(
      (button) => button.getAttribute("aria-label") ?? "",
    );
    expect(labels.some((label) => label.startsWith("Print"))).toBe(true);
  })
});
