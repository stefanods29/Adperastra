import { describe, expect, it, vi } from "vitest";
import type { DocumentHandle } from "../documents/types";
import { acquireSheetController } from "../office/sheet/sheetController";
import { clampSheetViewState, defaultSheetViewState, sheetViewStateCodec } from "../office/sheet/sheetViewState";
const api = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock("../office/OfficeController", () => ({ acquireOfficeController: api.acquire }));
vi.mock("../office/officeCompatibility", () => ({ canOfficeCommand: () => ({ enabled: false, reason_key: "office.enableEditing" }) }));
describe("sheet controller", () => {
  it("missing engine view fallback", async () => {
    api.acquire.mockRejectedValue(new Error("office_edit.engine_missing"));
    expect(await acquireSheetController({} as DocumentHandle)).toEqual({ kind: "viewing", reason_key: "office.engineNeeded" });
  });
  it("preview cannot acquire editing controller", async () => {
    api.acquire.mockClear();
    expect((await acquireSheetController({} as DocumentHandle, true)).kind).toBe("viewing");
    expect(api.acquire).not.toHaveBeenCalled();
  });
  it("unknown sheet state clamped without content", () => {
    const state = sheetViewStateCodec.decode({ ...defaultSheetViewState(), active_sheet_id: "11111111-1111-4111-8111-111111111111", buffer: "secret", password: "secret" })!;
    const restored = clampSheetViewState(state, [{ id: "22222222-2222-4222-8222-222222222222", rows: 10, columns: 10, hidden: false }]);
    expect(restored.active_sheet_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(restored.selection).toBeNull();
    expect(JSON.stringify(restored)).not.toContain("secret");
  });
  it("nonfinite viewport and forged freeze cannot restore document state", () => {
    const restored = sheetViewStateCodec.decode({ viewport: { x_px: Infinity, y_px: NaN }, zoom: 999, freeze: { rows: 10, columns: 10 } })!;
    expect(restored.viewport.x_px).toBe(0); expect(restored.viewport.y_px).toBe(0);
    expect(restored.zoom).toBe(100); expect(restored.freeze).toBeNull();
  });
});
