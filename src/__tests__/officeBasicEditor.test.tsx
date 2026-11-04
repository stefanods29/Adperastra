import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import OfficeBasicEditor from "../office/OfficeBasicEditor";
import type { OfficeController } from "../office/OfficeController";
import type { DocumentHandle } from "../documents/types";
import type { OfficeFamily, OfficeSessionState } from "../office/types";
import { officeBasicPage } from "../services/officeBasic";
import { saveOfficeCopy } from "../office/saveOfficeCopy";

vi.mock("../services/officeBasic", () => ({ officeBasicPage: vi.fn() }));
vi.mock("../office/saveOfficeCopy", () => ({ saveOfficeCopy: vi.fn() }));

it.each<OfficeFamily>(["document", "sheet", "deck"])("edits %s through its canonical controller and refuses a stale draft", async (family) => {
  const id = "99a218bc-a8ab-465c-a734-a6f2ec021640";
  const section = "122aab72-ebac-47cf-b9b4-39fb9e52730f";
  const state = { family, revision: 4, mode: "editing", capabilities: ["save_copy"] } as OfficeSessionState;
  let liveRevision = 4;
  const transact = vi.fn(async () => undefined);
  const controller = { session_id: "session", family, transact, getState: () => ({ ...state, revision: liveRevision }) } as unknown as OfficeController;
  vi.mocked(officeBasicPage).mockResolvedValue({ revision: 4, section_id: section, section_index: 0, next_start: null, has_next_section: false, items: [{ id, section_id: section, text: "A🐴B", address: family === "sheet" ? "A1" : null }] });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<OfficeBasicEditor document={{ info: { read_only: false } } as DocumentHandle} controller={controller} state={state} active />));
    await act(async () => host.querySelector<HTMLButtonElement>("article button")!.click());
    const input = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "AhorseB");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    liveRevision = 5;
    await act(async () => host.querySelector("form")!.requestSubmit());
    expect(transact).not.toHaveBeenCalled();
    liveRevision = 4;
    await act(async () => host.querySelector("form")!.requestSubmit());
    expect(transact).toHaveBeenCalledTimes(1);
    const transaction = transact.mock.calls[0] as unknown as [{ expected_revision: number; operations: unknown[] }];
    expect(transaction[0].expected_revision).toBe(4);
    if (family === "document") expect(transaction[0].operations).toEqual([{ family, operation: { kind: "replace_match", expected_text: "A🐴B", replacement: "AhorseB", span: { anchor: { block_id: id, offset_utf16: 0 }, focus: { block_id: id, offset_utf16: 4 }, revision: 4 } } }]);
    if (family === "sheet") expect(transaction[0].operations).toEqual([{ family, operation: { kind: "set_cells", mode: "values", values: [[{ kind: "text", text: "AhorseB" }]], range: { sheet_id: section, first_row: 0, last_row: 0, first_column: 0, last_column: 0 } } }]);
    if (family === "deck") expect(transaction[0].operations).toEqual([
      { family, operation: { kind: "delete_text", slide_id: section, shape_id: id, span: { anchor: { block_id: id, offset_utf16: 1 }, focus: { block_id: id, offset_utf16: 3 }, revision: 4 } } },
      { family, operation: { kind: "insert_text", slide_id: section, shape_id: id, position: { block_id: id, offset_utf16: 1 }, text: "horse" } },
    ]);
    vi.mocked(saveOfficeCopy).mockClear();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })));
    expect(saveOfficeCopy).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<OfficeBasicEditor document={{ info: { read_only: false } } as DocumentHandle} controller={controller} state={state} active previewOnly />));
    vi.mocked(saveOfficeCopy).mockClear();
    await act(async () => host.querySelector("section")!.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })));
    expect(saveOfficeCopy).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLButtonElement>("article button")!.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
