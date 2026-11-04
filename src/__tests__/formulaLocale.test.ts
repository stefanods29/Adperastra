import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeController } from "../office/OfficeController";
import { displayFormula, parseFormula } from "../office/sheet/formulaLocale";
import { createFormulaEditing } from "../office/sheet/formulaEditing";
import { parseSheetAddress } from "../office/sheet/useSheetSelection";

const api = vi.hoisted(() => ({ parse: vi.fn(), format: vi.fn() }));
vi.mock("../services/officeEdit", () => ({
  parseOfficeFormula: api.parse, formatOfficeFormula: api.format,
}));
const sheet = "11111111-1111-4111-8111-111111111111";
const range = { sheet_id: sheet, first_row: 0, last_row: 0, first_column: 0, last_column: 0 };
function controller() {
  return {
    session_id: "22222222-2222-4222-8222-222222222222",
    getState: () => ({ revision: 1 }),
    transact: vi.fn().mockResolvedValue({ changed: true }),
  } as unknown as OfficeController;
}
beforeEach(() => vi.clearAllMocks());
describe("formula locale", () => {
  it("SUMA(1;2) delegates AST parsing to produce SUM(1,2)", async () => {
    const c = controller();
    api.parse.mockResolvedValue({ canonical: "=SUM(1,2)", functions: ["SUM"], valid: true, error_offset_utf16: null });
    expect((await parseFormula(c, "=SUMA(1;2)", "es-419")).canonical).toBe("=SUM(1,2)");
    expect(api.parse).toHaveBeenCalledWith(c.session_id, "=SUMA(1;2)", "es-419");
  });
  it("literal SUMA; unchanged at the engine boundary", async () => {
    const c = controller();
    api.format.mockResolvedValue('="SUMA;"');
    expect(await displayFormula(c, '="SUMA;"', "es-419")).toBe('="SUMA;"');
    expect(api.format).toHaveBeenCalledWith(c.session_id, '="SUMA;"', "es-419");
  });
  it("Esc 0 mutations", () => {
    const c = controller();
    const edit = createFormulaEditing(c, range, "before", "en-US");
    edit.setBuffer("after"); edit.cancel();
    expect(edit.getState().buffer).toBe("before");
    expect(c.transact).not.toHaveBeenCalled();
  });
  it("unchanged input does not coerce an existing text value or create Undo", async () => {
    const c = controller(); const edit = createFormulaEditing(c, range, "000123", "en-US");
    expect(await edit.confirm()).toBe(true); expect(c.transact).not.toHaveBeenCalled();
  });
  it("Enter one transaction and repeated confirmation shares the intent", async () => {
    const c = controller();
    const edit = createFormulaEditing(c, range, "", "en-US");
    edit.setBuffer("123");
    await Promise.all([edit.confirm(), edit.confirm()]);
    expect(c.transact).toHaveBeenCalledTimes(1);
    expect(c.transact).toHaveBeenCalledWith(expect.objectContaining({
      expected_revision: 1,
      operations: [{ family: "sheet", operation: { kind: "set_cells", range, values: [[{ kind: "number", value: 123 }]], mode: "all" } }],
    }));
  });
  it("invalid keeps buffer", async () => {
    const c = controller();
    api.parse.mockResolvedValue({ canonical: "", functions: [], valid: false, error_offset_utf16: 4 });
    const edit = createFormulaEditing(c, range, "old", "es-419");
    edit.setBuffer("=SUMA(");
    expect(await edit.confirm()).toBe(false);
    expect(edit.getState()).toMatchObject({ buffer: "=SUMA(", error_offset_utf16: 4 });
    expect(c.transact).not.toHaveBeenCalled();
  });
  it("Esc during asynchronous formula parse prevents admission", async () => {
    let finish!: (value: unknown) => void;
    api.parse.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const c = controller(); const edit = createFormulaEditing(c, range, "old", "en-US");
    edit.setBuffer("=SUM(1,2)"); const confirming = edit.confirm(); edit.cancel();
    finish({ canonical: "=SUM(1,2)", functions: ["SUM"], valid: true, error_offset_utf16: null });
    expect(await confirming).toBe(false);
    expect(c.transact).not.toHaveBeenCalled(); expect(edit.getState().buffer).toBe("old");
  });
  it("failed transaction keeps buffer and does not silently rebase", async () => {
    const c = controller();
    vi.mocked(c.transact).mockRejectedValue(new Error("office_edit.changed"));
    const edit = createFormulaEditing(c, range, "old", "en-US"); edit.setBuffer("new");
    await expect(edit.confirm()).rejects.toThrow("office_edit.changed");
    expect(edit.getState().buffer).toBe("new");
    expect(edit.getState().editing).toBe(true);
  });
  it("named range not filesystem path", () => {
    expect(parseSheetAddress("C:\\private\\data.xlsx", sheet, 100, 10)).toBeNull();
    expect(parseSheetAddress("https://example.com", sheet, 100, 10)).toBeNull();
    expect(parseSheetAddress("Sales_2026", sheet, 100, 10)).toEqual({ kind: "name", name: "Sales_2026" });
    expect(parseSheetAddress("A1", sheet, 100, 10)).toEqual({ kind: "address", address: { sheet_id: sheet, row: 0, column: 0 } });
  });
});
