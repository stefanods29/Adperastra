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
  emptyTemplateList: () => ({ builtin: [], blank: [], user: [], user_folder: "", user_folder_missing: false, user_error: null, user_skipped: 0 }),
  templatesList: mocks.templatesList,
  templatesPickFolder: mocks.templatesPickFolder,
}));

import TemplatePickerDialog, { type TemplatePickerDialogProps } from "../templates/TemplatePickerDialog";

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
    user_error: null,
    user_skipped: 0,
    ...overrides,
  };
}

type Callbacks = Partial<Pick<TemplatePickerDialogProps, "onCreate" | "onFolderChange" | "onOpenFolder" | "onClose">>;

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
    await act(async () => buttonWithText(i18n.t("templates.create"))!.click());
    expect(onCreate).toHaveBeenCalledWith("C:\\App\\templates\\builtin\\en\\budget.xlsx", "Budget.xlsx", expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Enter and double-click create", async () => {
    const first = vi.fn();
    await render(templateList(), { onCreate: first });
    await act(async () => {
      options()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(first).toHaveBeenCalledWith("C:\\App\\templates\\builtin\\en\\letter.docx", "Letter.docx", expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) }));

    const second = vi.fn();
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    await render(templateList(), { onCreate: second });
    await act(async () => {
      optionWithText(i18n.t("templates.invoice.name"))!.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });
    expect(second).toHaveBeenCalledWith("C:\\App\\templates\\builtin\\en\\invoice.xlsx", "Invoice.xlsx", expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) }));
  });

  it("my templates come from the folder", async () => {
    const onCreate = vi.fn();
    await render(
      templateList({ user_folder: "C:\\T", user: [{ name: "Offer.docx", path: "C:\\T\\Offer.docx" }] }),
      { onCreate },
    );
    expect(optionWithText("Offer.docx")).toBeDefined();
    act(() => optionWithText("Offer.docx")!.click());
    await act(async () => buttonWithText(i18n.t("templates.create"))!.click());
    expect(onCreate).toHaveBeenCalledWith("C:\\T\\Offer.docx", "Offer.docx", expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) }));
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

  it("Tab focus selects the template that Enter creates", async () => {
    const onCreate = vi.fn();
    await render(templateList(), { onCreate });
    const budget = optionWithText(i18n.t("templates.budget.name"))!;
    act(() => budget.focus());
    expect(budget.getAttribute("aria-selected")).toBe("true");
    expect(options()[0].getAttribute("aria-selected")).toBe("false");
    await act(async () => {
      budget.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onCreate).toHaveBeenCalledWith("C:\\App\\templates\\builtin\\en\\budget.xlsx", "Budget.xlsx", expect.any(Object));
  });

  it("shows a translated error when the catalog cannot be read", async () => {
    mocks.templatesList.mockRejectedValueOnce(new Error("templates.access_denied"));
    await render(templateList());
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain(i18n.t("errors.templates.access_denied"));
    expect(container!.textContent).not.toContain(i18n.t("templates.mineEmpty"));
    expect(buttonWithText(i18n.t("templates.create"))!.disabled).toBe(true);
    expect(container!.querySelector(".adp-skeleton-rows")).toBeNull();
  });

  it("marks partial listings and keeps the readable templates", async () => {
    await render(templateList({
      user_folder: "C:\\T",
      user: [{ name: "Offer.docx", path: "C:\\T\\Offer.docx" }],
      user_error: "templates.access_denied",
      user_skipped: 2,
    }));
    expect(optionWithText("Offer.docx")).toBeDefined();
    expect(container!.textContent).toContain(i18n.t("templates.someUnreadable", { count: 2 }));
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain(i18n.t("errors.templates.access_denied"));
  });

  it("accepts catalogs without optional partial-listing fields", async () => {
    await render({ builtin: [], blank: [], user: [], user_folder: "C:\\T", user_folder_missing: false });
    expect(container!.textContent).toContain(i18n.t("templates.mineNone", { folder: "C:\\T" }));
    expect(container!.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps My templates unchanged when saving a chosen folder fails", async () => {
    const onFolderChange = vi.fn().mockRejectedValue(new Error("settings.failed"));
    const onOpenFolder = vi.fn();
    await render(templateList({
      user_folder: "C:\\Old",
      user: [{ name: "Offer.docx", path: "C:\\Old\\Offer.docx" }],
    }), { onFolderChange, onOpenFolder });
    mocks.templatesPickFolder.mockResolvedValue("C:\\New");
    await act(async () => buttonWithText(i18n.t("templates.changeFolder"))!.click());
    expect(onFolderChange).toHaveBeenCalledWith("C:\\New");
    expect(mocks.templatesList).toHaveBeenCalledTimes(1);
    expect(optionWithText("Offer.docx")).toBeDefined();
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain(i18n.t("errors.templates.other"));
    act(() => buttonWithText(i18n.t("templates.openFolder"))!.click());
    expect(onOpenFolder).toHaveBeenCalledWith("C:\\Old");
  });

  it("refreshes templates only after the chosen folder has been saved", async () => {
    let finishSave!: () => void;
    const onFolderChange = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    await render(templateList(), { onFolderChange });
    mocks.templatesPickFolder.mockResolvedValue("C:\\New");
    await act(async () => buttonWithText(i18n.t("templates.chooseFolder"))!.click());
    expect(onFolderChange).toHaveBeenCalledWith("C:\\New");
    expect(mocks.templatesList).toHaveBeenCalledTimes(1);
    await act(async () => finishSave());
    expect(mocks.templatesList).toHaveBeenCalledTimes(2);
  });

  it("waits for creation, reports byte progress, and prevents duplicate creates", async () => {
    let finishCreate!: () => void;
    const onCreate = vi.fn(() => new Promise<void>((resolve) => { finishCreate = resolve; }));
    const onClose = vi.fn();
    await render(templateList(), { onCreate, onClose });
    act(() => {
      buttonWithText(i18n.t("templates.create"))!.click();
      options()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      options()[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(buttonWithText(i18n.t("templates.create"))!.disabled).toBe(true);
    const createOptions = (onCreate.mock.calls[0] as unknown as Parameters<TemplatePickerDialogProps["onCreate"]>)[2]!;
    act(() => createOptions.onProgress!({ items_done: 0, items_total: 1, bytes_done: 1024, bytes_total: 4096, current: "Letter.docx" }));
    expect(container!.textContent).toContain(i18n.t("templates.copyProgress", { done: "1 KB", total: "4 KB" }));
    expect(container!.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("25");
    await act(async () => finishCreate());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the picker open when creation fails", async () => {
    const onClose = vi.fn();
    await render(templateList(), { onCreate: vi.fn().mockRejectedValue(new Error("templates.access_denied")), onClose });
    await act(async () => buttonWithText(i18n.t("templates.create"))!.click());
    expect(onClose).not.toHaveBeenCalled();
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain(i18n.t("errors.templates.access_denied"));
    expect(buttonWithText(i18n.t("templates.create"))!.disabled).toBe(false);
  });

  it("Cancel aborts creation and keeps the picker open with a translated message", async () => {
    const onClose = vi.fn();
    await render(templateList(), {
      onCreate: (_path, _name, options) => new Promise<void>((_resolve, reject) => {
        options!.signal!.addEventListener("abort", () => reject(new Error("templates.cancelled")), { once: true });
      }),
      onClose,
    });
    act(() => buttonWithText(i18n.t("templates.create"))!.click());
    await act(async () => buttonWithText(i18n.t("common.cancel"))!.click());
    expect(onClose).not.toHaveBeenCalled();
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain(i18n.t("errors.templates.cancelled"));
    expect(buttonWithText(i18n.t("templates.create"))!.disabled).toBe(false);
  });

  it("unmount aborts an active creation", async () => {
    let signal: AbortSignal | undefined;
    const onClose = vi.fn();
    await render(templateList(), {
      onCreate: (_path, _name, options) => new Promise<void>((_resolve, reject) => {
        signal = options!.signal;
        signal!.addEventListener("abort", () => reject(new Error("templates.cancelled")), { once: true });
      }),
      onClose,
    });
    act(() => buttonWithText(i18n.t("templates.create"))!.click());
    await act(async () => root?.unmount());
    root = null;
    expect(signal?.aborted).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});
