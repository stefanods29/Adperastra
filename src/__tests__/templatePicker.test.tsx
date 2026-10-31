import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { TemplateList } from "../services/templates";

const mocks = vi.hoisted(() => ({
  templatesList: vi.fn(),
  templatesPickFolder: vi.fn(),
}));

vi.mock("../services/templates", () => ({
  emptyTemplateList: () => ({ builtin: [], blank: [], user: [], user_folder: "", user_folder_missing: false }),
  templatesList: mocks.templatesList,
  templatesPickFolder: mocks.templatesPickFolder,
}));

import TemplatePickerDialog from "../templates/TemplatePickerDialog";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const builtinFiles = [
  ["letter", "letter.docx"],
  ["report", "report.docx"],
  ["budget", "budget.xlsx"],
  ["invoice", "invoice.xlsx"],
  ["meetingNotes", "meeting-notes.md"],
  ["presentation", "presentation.pptx"],
] as const;

function templateList(overrides: Partial<TemplateList> = {}): TemplateList {
  return {
    builtin: builtinFiles.map(([id, file]) => ({ id, path: `C:\\App\\templates\\builtin\\en\\${file}` })),
    blank: [],
    user: [],
    user_folder: "",
    user_folder_missing: false,
    ...overrides,
  };
}

interface Callbacks {
  onCreate?: (path: string, name: string) => void;
  onFolderChange?: (folder: string) => void;
  onOpenFolder?: (folder: string) => void;
  onClose?: () => void;
}

async function render(list: TemplateList, callbacks: Callbacks = {}) {
  mocks.templatesList.mockResolvedValue(list);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <TemplatePickerDialog
        lang="en"
        onCreate={callbacks.onCreate ?? (() => undefined)}
        onFolderChange={callbacks.onFolderChange ?? (() => undefined)}
        onOpenFolder={callbacks.onOpenFolder ?? (() => undefined)}
        onClose={callbacks.onClose ?? (() => undefined)}
      />,
    );
  });
}

const options = () => [...container!.querySelectorAll<HTMLElement>('[role="option"]')];
const buttonWithText = (text: string) =>
  [...container!.querySelectorAll("button")].find((entry) => entry.textContent === text) as HTMLButtonElement | undefined;
const optionWithText = (text: string) => options().find((entry) => entry.textContent?.includes(text));

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  mocks.templatesList.mockReset();
  mocks.templatesPickFolder.mockReset();
});

describe("template window", () => {
  it("lists the built-in templates in the app language", async () => {
    await render(templateList());
    const texts = options().map((entry) => entry.textContent);
    expect(texts).toHaveLength(6);
    expect(texts.join("|")).toContain(i18n.t("templates.letter.name"));
    expect(texts.join("|")).toContain(i18n.t("templates.report.name"));
    expect(texts.join("|")).toContain(i18n.t("templates.budget.name"));
    expect(texts.join("|")).toContain(i18n.t("templates.invoice.name"));
    expect(texts.join("|")).toContain(i18n.t("templates.meeting.name"));
    expect(texts.join("|")).toContain(i18n.t("templates.presentation.name"));
    expect(container!.textContent).toContain(i18n.t("templates.mineEmpty"));
    expect(buttonWithText(i18n.t("templates.chooseFolder"))).toBeDefined();
    expect(buttonWithText(i18n.t("templates.openFolder"))).toBeUndefined();
  });

  it("creates the selected template", async () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    await render(templateList(), { onCreate, onClose });
    act(() => optionWithText(i18n.t("templates.budget.name"))!.click());
    act(() => buttonWithText(i18n.t("templates.create"))!.click());
    expect(onCreate).toHaveBeenCalledWith("C:\\App\\templates\\builtin\\en\\budget.xlsx", "Budget.xlsx");
    expect(onClose).toHaveBeenCalled();
  });

  it("Enter and double-click create", async () => {
    const first = vi.fn();
    await render(templateList(), { onCreate: first });
    act(() => {
      options()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(first).toHaveBeenCalledWith("C:\\App\\templates\\builtin\\en\\letter.docx", "Letter.docx");

    const second = vi.fn();
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    await render(templateList(), { onCreate: second });
    act(() => {
      optionWithText(i18n.t("templates.invoice.name"))!.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });
    expect(second).toHaveBeenCalledWith("C:\\App\\templates\\builtin\\en\\invoice.xlsx", "Invoice.xlsx");
  });

  it("my templates come from the folder", async () => {
    const onCreate = vi.fn();
    await render(
      templateList({ user_folder: "C:\\T", user: [{ name: "Offer.docx", path: "C:\\T\\Offer.docx" }] }),
      { onCreate },
    );
    expect(optionWithText("Offer.docx")).toBeDefined();
    act(() => optionWithText("Offer.docx")!.click());
    act(() => buttonWithText(i18n.t("templates.create"))!.click());
    expect(onCreate).toHaveBeenCalledWith("C:\\T\\Offer.docx", "Offer.docx");
    expect(buttonWithText(i18n.t("templates.changeFolder"))).toBeDefined();
    expect(buttonWithText(i18n.t("templates.openFolder"))).toBeDefined();
  });

  it("choosing a folder saves it", async () => {
    const onFolderChange = vi.fn();
    await render(templateList(), { onFolderChange });
    mocks.templatesPickFolder.mockResolvedValue("C:\\T");
    expect(mocks.templatesList).toHaveBeenCalledTimes(1);
    await act(async () => {
      buttonWithText(i18n.t("templates.chooseFolder"))!.click();
    });
    expect(onFolderChange).toHaveBeenCalledWith("C:\\T");
    expect(mocks.templatesList.mock.calls.length).toBeGreaterThan(1);
  });

  it("a missing folder says so", async () => {
    await render(templateList({ user_folder: "C:\\T", user_folder_missing: true }));
    expect(container!.textContent).toContain(i18n.t("templates.mineMissing", { folder: "C:\\T" }));
  });
});
