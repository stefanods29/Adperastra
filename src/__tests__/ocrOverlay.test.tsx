import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OcrOverlay from "../ocr/OcrOverlay";
import {
  findMatches,
  matchSourceBox,
  pageText,
  selectionText,
} from "../ocr/ocrSelection";
import type { OcrPage, OcrWord } from "../services/ocr";

function word(text: string, x: number, line: number, order: number): OcrWord {
  return { text, x, y: 20, width: 30, height: 40, line, order };
}

function makePage(words: OcrWord[]): OcrPage {
  return {
    source: {
      kind: "disk",
      stamp: {
        path_key: "c:\\pictures\\a.png",
        volume_id: "0011aabb",
        file_id: "00112233445566aa",
        modified_ticks: "133000000000000000",
        size_bytes: 1234,
      },
    },
    page: 1,
    language: "en-US",
    original_width: 4000,
    original_height: 2000,
    recognized_width: 1000,
    recognized_height: 500,
    words,
    text: pageText(words),
    partial: false,
    next_word: null,
    rotation: 0,
    text_angle: null,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  window.getSelection()?.removeAllRanges();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function render(page: OcrPage, onSelectionText = vi.fn()): Promise<void> {
  await act(async () =>
    root?.render(
      <OcrOverlay
        result={page}
        viewWidth={4000}
        viewHeight={2000}
        rotation={0}
        zoom={1}
        onSelectionText={onSelectionText}
      />,
    ),
  );
}

describe("OCR overlay", () => {
  it("places escaped, selectable words without focus stops", async () => {
    await render(makePage([word("Hello", 10, 0, 0), word("123", 50, 0, 1)]));
    const spans = [...container!.querySelectorAll<HTMLSpanElement>(".adp-ocr-word")];
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toBe("Hello");
    expect(spans[0].style.left).toBe("40px");
    expect(spans[0].style.top).toBe("80px");
    expect(spans[0].style.width).toBe("120px");
    expect(spans[0].style.height).toBe("160px");
    expect(spans[1].style.left).toBe("200px");
    expect(spans.every((span) => !span.hasAttribute("tabindex"))).toBe(true);
  });

  it("shows recognised markup as literal text", async () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    await render(makePage([word(hostile, 10, 0, 0)]));
    expect(container!.querySelector("img")).toBeNull();
    expect(container!.textContent).toContain(hostile);
  });

  it("copies selected words in reading order", async () => {
    // The array is deliberately out of order; reading order is line/order.
    const page = makePage([word("123", 50, 0, 1), word("Hello", 10, 0, 0)]);
    const onSelectionText = vi.fn();
    await render(page, onSelectionText);
    const first = container!.querySelector<HTMLSpanElement>('[data-adp-ocr-index="0"]')!;
    const second = container!.querySelector<HTMLSpanElement>('[data-adp-ocr-index="1"]')!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(first.firstChild!, 0);
    range.setEnd(second.firstChild!, second.textContent!.length);
    selection.removeAllRanges();
    selection.addRange(range);

    const setData = vi.fn();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    await act(async () => {
      container!.querySelector(".adp-ocr-overlay")!.dispatchEvent(event);
    });

    expect(setData).toHaveBeenCalledWith("text/plain", "Hello 123");
    expect(onSelectionText).toHaveBeenCalledWith("Hello 123");
  });

  it("maps a find match to its words and source box", () => {
    const page = makePage([word("Hello", 10, 0, 0), word("123", 50, 0, 1)]);
    expect(page.text).toBe("Hello 123");
    const matches = findMatches(page.words, "hello 123", false);
    expect(matches).toHaveLength(1);
    expect(matches[0].words).toEqual([0, 1]);
    expect(
      matchSourceBox(page.words, matches[0], 1000, 500, 4000, 2000),
    ).toEqual({ x: 40, y: 80, width: 280, height: 160 });
    expect(selectionText(page.words, new Set([0, 1]))).toBe("Hello 123");
    expect(findMatches(page.words, "HELLO", true)).toEqual([]);
  });
});
