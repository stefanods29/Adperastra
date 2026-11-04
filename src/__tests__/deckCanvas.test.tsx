import { readFileSync } from "node:fs";
import { repoUrl } from "./nodeUrl";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import {
  fitZoomPercent, screenToPoints, pointsToScreen, slideAspect, slideVirtualWindow,
  MAX_SLIDES, SLIDE_ROW_HEIGHT,
} from "../office/deck/deckCoordinates";
import { dragDistanceQualifies, moveShapeRect, rectToScreen } from "../office/deck/SlideCanvas";
import SlideStrip, { type DeckSlideSummary } from "../office/deck/SlideStrip";

vi.mock("../services/officeEdit", () => ({
  renderOffice: vi.fn(),
  releaseOfficeLease: vi.fn(async () => undefined),
}));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => opts.count * opts.estimateSize(0),
    getVirtualItems: () => Array.from({ length: opts.count }, (_, index) => ({
      index, start: index * opts.estimateSize(index), key: index,
    })),
    scrollToIndex: () => undefined,
  }),
}));

const slides: DeckSlideSummary[] = Array.from({ length: 3 }, (_, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index + 1}`,
  index,
  hidden: index === 2,
  title: `Slide ${index + 1}`,
  layout_id: "00000000-0000-4000-8000-0000000000ff",
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("deck canvas geometry", () => {
  it("96 screen pixels at 100% are 72 points", () => {
    expect(screenToPoints(96, 100)).toBeCloseTo(72, 10);
    expect(pointsToScreen(72, 100)).toBeCloseTo(96, 10);
    expect(screenToPoints(96, 200)).toBeCloseTo(36, 10);
  });

  it("720 x 405 is 16:9 and fit uses the real ratio", () => {
    expect(slideAspect(720, 405)).toBeCloseTo(16 / 9, 10);
    expect(slideAspect(0, 0)).toBeCloseTo(16 / 9, 10);
    const zoom = fitZoomPercent(720, 405, 960, 540);
    expect(zoom).toBeGreaterThan(10);
    expect(zoom).toBeLessThanOrEqual(100);
  });

  it("drag preview commits only after a real pointer movement", () => {
    expect(dragDistanceQualifies(0, 0)).toBe(false);
    expect(dragDistanceQualifies(0.2, 0.2)).toBe(false);
    expect(dragDistanceQualifies(1, 0)).toBe(true);
    const rect = { x_pt: 10, y_pt: 20, width_pt: 100, height_pt: 50, rotation_deg: 0 };
    const moved = moveShapeRect(rect, 1.4, -2.1, true);
    expect(rect).toMatchObject({ x_pt: 10, y_pt: 20 });
    expect(moved).toMatchObject({ x_pt: 12, y_pt: 16 });
    const box = rectToScreen(rect, {
      x_px: 0, y_px: 0, width_px: 960, height_px: 540, zoom_percent: 100, device_scale: 1, view_revision: 0,
    });
    expect(box.left).toBeCloseTo(13.333, 2);
    expect(box.width).toBeCloseTo(133.333, 2);
  });

  it("10,000 slides mount only the visible window plus overscan", () => {
    const window = slideVirtualWindow({
      count: MAX_SLIDES, scrollTop: 5000 * SLIDE_ROW_HEIGHT, viewportHeight: 600,
    });
    expect(window.total).toBe(10_000);
    expect(window.end - window.start).toBeLessThan(20);
    expect(window.start).toBeGreaterThan(4900);
  });

  it("notes never become an image alt text", () => {
    const canvas = readFileSync(fileURLToPath(repoUrl("../office/deck/SlideCanvas.tsx", import.meta.url)), "utf8");
    const notes = readFileSync(fileURLToPath(repoUrl("../office/deck/SlideNotes.tsx", import.meta.url)), "utf8");
    expect(canvas).not.toMatch(/notes_preview|notesBySlide/);
    expect(canvas).toMatch(/alt=""/);
    expect(notes).toMatch(/notesPrivate/);
  });

  it("reorder commits one callback and leaves the source order in local state", async () => {
    const onReorder = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SlideStrip
          slides={slides}
          selectedIds={[slides[0].id]}
          activeSlideId={slides[0].id}
          width={196}
          onResize={() => undefined}
          onSelect={() => undefined}
          onReorder={onReorder}
          onOpenHelp={() => undefined}
        />,
      );
    });
    const rows = container.querySelectorAll<HTMLElement>("[data-slide-id]");
    expect(rows.length).toBe(3);
    await act(async () => {
      rows[0].dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      rows[2].dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      rows[2].dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(slides[0].id, slides[2].id);
  });
});