import { expect, it, vi } from "vitest";
import { CommandRegistry } from "../commands/registry";
import type { DocumentHandle } from "../documents/types";
import { saveOfficeCopy } from "../office/saveOfficeCopy";
import { registerSheetCommands } from "../office/sheet/sheetCommands";
import type { SheetCommandContext } from "../office/sheet/sheetUiTypes";
import { pickSavePath } from "../services/textFiles";

vi.mock("../services/textFiles", () => ({ pickSavePath: vi.fn() }));

it("routes a workbook copy through the live capability and scoped view action", () => {
  const registry = new CommandRegistry<SheetCommandContext>();
  registerSheetCommands(registry);
  const command = registry.get("sheet.saveCopy")!;
  const saveCopy = vi.fn();
  const context = {
    saveCopy,
    state: { ready: true, busy: false, capabilities: [] },
  } as unknown as SheetCommandContext;
  expect(command.enabledWhen(context)).toBe(false);
  command.run(context);
  expect(saveCopy).not.toHaveBeenCalled();
  const supported = { ...context, state: { ...context.state, capabilities: ["save_copy" as const] } };
  expect(command.enabledWhen(supported)).toBe(true);
  command.run(supported);
  expect(saveCopy).toHaveBeenCalledOnce();
  expect(command.enabledWhen({ ...supported, saveCopy: undefined })).toBe(false);
});

it("passes the chosen copy path to the current document and skips a cancelled picker", async () => {
  const saveCopy = vi.fn(async () => true);
  const document = { info: { name: "Fixture.docx" }, saveCopy } as unknown as DocumentHandle;
  vi.mocked(pickSavePath).mockResolvedValueOnce(null).mockResolvedValueOnce("C:\\Test\\Copy.docx");
  await saveOfficeCopy(document, "Save a copy", "All files");
  expect(saveCopy).not.toHaveBeenCalled();
  await saveOfficeCopy(document, "Save a copy", "All files");
  expect(saveCopy).toHaveBeenCalledExactlyOnceWith("C:\\Test\\Copy.docx");
});
