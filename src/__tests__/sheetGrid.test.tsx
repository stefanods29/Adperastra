import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import "../i18n";
import SheetGrid from "../office/sheet/SheetGrid";
import { sheetVisibleWindow, loadSheetWindow } from "../office/sheet/sheetWindow";
import { validSheetAddress } from "../office/sheet/useSheetSelection";
import type { OfficeCellWindow } from "../office/types";

const sheet_id = "11111111-1111-4111-8111-111111111111";
describe("bounded sheet window", () => {
  it("starts typing in an editable empty cell and leaves read-only cells alone", () => {
    const range = { sheet_id, first_row: 0, last_row: 0, first_column: 0, last_column: 0 };
    const address = { sheet_id, row: 0, column: 0 };
    const inputs: (string | undefined)[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (editable: boolean) => act(() => root.render(<SheetGrid
      window={{ revision: 1, range, rows: [[{
        address, display: "", input: { kind: "blank" }, format: {},
        error_code: null, merged_range: null, editable,
      }]], next_row: null }}
      rows={10} columns={10} selection={{ kind: "sheet", active: address, ranges: [range] }}
      zoom={100} headings gridlines active onSelect={() => undefined}
      onEdit={(value) => inputs.push(value)} onScroll={() => undefined} />));
    const type = () => act(() => {
      host.querySelector('[role="grid"]')!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "7", bubbles: true, cancelable: true,
      }));
    });
    try {
      render(true);
      type();
      expect(inputs).toEqual(["7"]);
      render(false);
      type();
      expect(inputs).toEqual(["7"]);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
  it("merged active cell announced through the bounded accessible window", () => {
    const range = { sheet_id, first_row: 0, last_row: 1, first_column: 0, last_column: 1 };
    const cell = { address: { sheet_id, row: 0, column: 0 }, display: "Merged title", input: { kind: "text" as const, text: "Merged title" }, format: {}, error_code: null, merged_range: range, editable: true };
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      act(() => root.render(<SheetGrid window={{ revision: 1, range, rows: [[cell]], next_row: null }} rows={100_000} columns={10}
        selection={{ kind: "sheet", active: { sheet_id, row: 1, column: 1 }, ranges: [range] }} zoom={100} headings gridlines active
        onSelect={() => undefined} onEdit={() => undefined} onScroll={() => undefined} />));
      const grid = host.querySelector('[role="grid"]')!;
      const selected = document.getElementById(grid.getAttribute("aria-activedescendant")!)!;
      expect(grid.getAttribute("aria-rowcount")).toBe("100000");
      expect(selected.getAttribute("aria-rowspan")).toBe("2");
      expect(selected.getAttribute("aria-colspan")).toBe("2");
      expect(selected.getAttribute("aria-label")).toContain("Merged title");
      expect(host.querySelector('.adp-sheet-row-headings span')?.textContent).toBe("1");
      expect(parseFloat((selected as HTMLElement).style.fontSize)).toBeCloseTo(14.67, 2);
    } finally { act(() => root.unmount()); host.remove(); }
  });
  it("100k rows <=2000 mounted cells even with a maximal viewport", () => {
    for (const y of [0, 22 * 50_000, 22 * 99_999]) {
      const range = sheetVisibleWindow(sheet_id, 100_000, 10, 0, y, 16_384, 16_384, 100);
      expect(range).not.toBeNull();
      expect((range!.last_row - range!.first_row + 1) * (range!.last_column - range!.first_column + 1)).toBeLessThanOrEqual(2000);
    }
  });
  it("row1048575 col16383 selectable; +1 rejected", () => {
    expect(validSheetAddress({ sheet_id, row: 1_048_575, column: 16_383 }, 1_048_576, 16_384)).toBe(true);
    expect(validSheetAddress({ sheet_id, row: 1_048_576, column: 16_383 }, 1_048_576, 16_384)).toBe(false);
    expect(validSheetAddress({ sheet_id, row: 1_048_575, column: 16_384 }, 1_048_576, 16_384)).toBe(false);
  });
  it("stale response ignored", async () => {
    const range = sheetVisibleWindow(sheet_id, 100, 10, 0, 0, 100, 100, 100)!;
    const page: OfficeCellWindow = { revision: 4, range, rows: [], next_row: null };
    let current = true;
    const result = await loadSheetWindow("session", range, 4, () => current, async () => {
      current = false; return page;
    });
    expect(result).toBeNull();
  });
  it("hidden view no continuing fetch", async () => {
    const range = sheetVisibleWindow(sheet_id, 100, 10, 0, 0, 100, 100, 100)!;
    let calls = 0;
    await loadSheetWindow("session", range, 1, () => false, async () => {
      calls += 1; throw new Error("must not fetch");
    });
    expect(calls).toBe(0);
  });
  it("continuation retains columns and advances next_row", async () => {
    const range = { sheet_id, first_row: 0, last_row: 1, first_column: 2, last_column: 2 };
    const requests: typeof range[] = [];
    const result = await loadSheetWindow("session", range, 1, () => true, async (_session, request) => {
      requests.push(request);
      const address = { sheet_id, row: request.first_row, column: 2 };
      return { revision: 1, range: { ...request, last_row: request.first_row }, rows: [[{
        address, display: "2", input: { kind: "number", value: 2 }, format: {}, error_code: null, merged_range: null, editable: true,
      }]], next_row: request.first_row === 0 ? 1 : null };
    });
    expect(result?.rows).toHaveLength(2);
    expect(requests[1]).toEqual({ ...range, first_row: 1 });
  });
});
