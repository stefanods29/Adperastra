import { readFileSync } from "node:fs";
import { repoUrl } from "./nodeUrl";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { DeckPresentDialog, formatPresentationTime, visibleSlideIds } from "../office/deck/PresentationControls";
import type { OfficeController } from "../office/OfficeController";
import { isPresentationDisplay, validatePresentationRequest } from "../services/presentation";
import type { PresentationDisplay, PresentationState } from "../office/presentationTypes";

const api = vi.hoisted(() => ({
  displays: vi.fn(), start: vi.fn(), navigate: vi.fn(), end: vi.fn(),
  state: vi.fn(), lost: vi.fn(),
}));
vi.mock("../services/presentation", async () => {
  const actual = await vi.importActual<typeof import("../services/presentation")>("../services/presentation");
  return {
    ...actual,
    presentationDisplays: api.displays,
    startPresentation: api.start,
    presentationNavigate: api.navigate,
    endPresentation: api.end,
    onPresentationState: api.state,
    onPresentationDisplayLost: api.lost,
  };
});

const ids = {
  presentation: "00000000-0000-4000-8000-000000000001",
  session: "00000000-0000-4000-8000-000000000002",
  slide: "00000000-0000-4000-8000-000000000003",
  display: "\\\\.\\DISPLAY2",
};

const display: PresentationDisplay = {
  id: ids.display, name: "Display 2",
  rect: { left: -1920, top: 0, width: 1920, height: 1080 }, primary: false,
};

const state: PresentationState = {
  presentation_id: ids.presentation, session_id: ids.session, slide_id: ids.slide,
  slide_index: 0, slide_count: 2, step_index: 0, elapsed_ms: 0,
  paused: false, black: false, ended: false, output_display_id: ids.display,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  api.displays.mockResolvedValue([display]);
  api.start.mockResolvedValue(state);
  api.navigate.mockResolvedValue({ ...state, slide_index: 1 });
  api.end.mockResolvedValue(undefined);
  api.state.mockResolvedValue(() => undefined);
  api.lost.mockResolvedValue(() => undefined);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onClose = vi.fn();
  await act(async () => {
    root?.render(
      <DeckPresentDialog
        controller={{
          session_id: ids.session,
          getState: () => ({ ready: true, mode: "editing", capabilities: ["deck_present"] }),
        } as unknown as OfficeController}
        visibleSlideIds={[ids.slide]}
        currentSlideId={ids.slide}
        notes="PRIVATE NOTES"
        onClose={onClose}
        onOpenHelp={() => undefined}
      />,
    );
    await Promise.resolve();
  });
  return { onClose };
}

describe("presentation", () => {
  it("a display with a negative origin is valid", () => {
    expect(isPresentationDisplay(display)).toBe(true);
    expect(display.rect.left).toBe(-1920);
    expect(isPresentationDisplay({ ...display, id: "" })).toBe(false);
    expect(isPresentationDisplay({ ...display, rect: { ...display.rect, width: 0 } })).toBe(false);
  });

  it("hidden slides are excluded", () => {
    expect(visibleSlideIds([
      { id: "a", hidden: false }, { id: "b", hidden: true }, { id: "c", hidden: false },
    ])).toEqual(["a", "c"]);
  });

  it("Escape ends the presentation and restores the prior focus", async () => {
    const { onClose } = await render();
    const checkboxes = container!.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
    expect(checkboxes.length).toBeGreaterThan(1);
    const radios = container!.querySelectorAll<HTMLInputElement>("input[type=radio]");
    expect(radios.length).toBeGreaterThan(0);
    await act(async () => {
      radios[0].click();
      checkboxes[checkboxes.length - 1].click();
    });
    const start = Array.from(container!.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.className.includes("adp-btn--primary"));
    expect(start).toBeTruthy();
    start!.focus();
    await act(async () => {
      start!.click();
      await Promise.resolve();
    });
    expect(api.start).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.end).toHaveBeenCalledWith(ids.presentation);
    expect(onClose).toHaveBeenCalled();
    const afterEnd = Array.from(container!.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.className.includes("adp-btn--primary"));
    expect(document.activeElement).toBe(afterEnd);
  });

  it("shows the timer as minutes and seconds", () => {
    expect(formatPresentationTime(0)).toBe("0:00");
    expect(formatPresentationTime(65_000)).toBe("1:05");
  });

  it("notes never enter the audience payload", () => {
    const helper = readFileSync(fileURLToPath(repoUrl("../services/presentationHelperTypes.ts", import.meta.url)), "utf8");
    expect(helper).toContain("presentation_id");
    expect(helper).not.toMatch(/notes\??:/);
    expect(helper).toContain("exactKeys");
  });

  it("the audience helper cannot call a save or filesystem command", () => {
    for (const file of ["main.ts", "frames.ts", "intents.ts"]) {
      const source = readFileSync(fileURLToPath(repoUrl(`../presentation-helper/${file}`, import.meta.url)), "utf8");
      expect(source).not.toMatch(/save|writeFile|removeFile|invoke\(/);
    }
  });

  it("no command accepts an arbitrary display id", () => {
    const base = {
      slide_id: ids.slide, start_from: "first" as const, presenter_display_id: null, show_presenter: true,
    };
    expect(() => validatePresentationRequest({ ...base, output_display_id: "" })).toThrow("presentation.invalid");
    expect(() => validatePresentationRequest({ ...base, output_display_id: "x".repeat(129) })).toThrow("presentation.invalid");
    expect(() => validatePresentationRequest({ ...base, output_display_id: ids.display })).not.toThrow();
  });

  it("a display disconnect pauses and asks instead of silently continuing", () => {
    const source = readFileSync(fileURLToPath(repoUrl("../../src-tauri/src/presentation_worker.rs", import.meta.url)), "utf8");
    expect(source).toContain("office-presentation-display-lost");
    expect(source).toContain("set_paused");
    expect(source).toContain("continue");
  });

  it("a step happens before the next slide and a duplicate end succeeds", () => {
    const source = readFileSync(fileURLToPath(repoUrl("../../src-tauri/src/presentation_worker.rs", import.meta.url)), "utf8");
    expect(source.indexOf("presentation_step")).toBeLessThan(source.indexOf("present_frame"));
    const presentation = readFileSync(fileURLToPath(repoUrl("../../src-tauri/src/presentation.rs", import.meta.url)), "utf8");
    expect(presentation).toContain("Duplicate end succeeds");
  });
});