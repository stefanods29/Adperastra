import { beforeEach, describe, expect, it, vi } from "vitest";
import { startSheetWorkbook } from "../office/sheet/SheetBackstage";
import { createOfficeBlankDraft } from "../services/officeDrafts";
vi.mock("../services/officeDrafts", () => ({ createOfficeBlankDraft: vi.fn() }));
const create = vi.mocked(createOfficeBlankDraft);
beforeEach(() => vi.clearAllMocks());
describe("new sheet workbook", () => {
  it("new_workbook_uses_E25", async () => {
    const draft = { document: { release: vi.fn() }, controller: { close: vi.fn() } };
    create.mockResolvedValue({ id: "new-sheet", cancel: vi.fn(), completion: Promise.resolve(draft) } as unknown as Awaited<ReturnType<typeof createOfficeBlankDraft>>);
    const open = vi.fn().mockResolvedValue(undefined), error = vi.fn();
    await startSheetWorkbook(open, error).completion;
    expect(create).toHaveBeenCalledWith("sheet");
    expect(open).toHaveBeenCalledWith(draft);
    expect(open.mock.calls[0][0].controller).toBe(draft.controller);
    expect(error).not.toHaveBeenCalled();
  });
  it("new_workbook_cancel_no_tab even when cancellation races native completion", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined), release = vi.fn();
    let finish!: (value: unknown) => void;
    const completion = new Promise((resolve) => { finish = resolve; });
    create.mockResolvedValue({ id: "new-sheet", cancel, completion } as Awaited<ReturnType<typeof createOfficeBlankDraft>>);
    const open = vi.fn(), error = vi.fn();
    const job = startSheetWorkbook(open, error);
    await job.cancel();
    finish({ document: { release }, controller: { close } });
    await job.completion;
    expect(open).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalled();
  });
});
