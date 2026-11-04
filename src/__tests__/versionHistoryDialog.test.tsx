import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { formatDate } from "../services/format";
import VersionHistoryDialog, { type VersionHistoryDialogProps } from "../versions/VersionHistoryDialog";

vi.mock("../services/versions", () => ({
  versionsList: vi.fn(),
  versionsExtract: vi.fn(),
  versionsRestore: vi.fn(),
  versionsSaveCopy: vi.fn(),
}));

vi.mock("../services/files", () => ({
  extensionOf: (name: string) => name.split(".").pop()?.toLowerCase() ?? "",
  fileGrant: vi.fn(async (path: string) => path),
  fileRevoke: vi.fn(async () => undefined),
  fileUrl: (token: string) => `http://test/${token}`,
}));

import { fileGrant } from "../services/files";
import {
  versionsExtract,
  versionsList,
  versionsRestore,
  versionsSaveCopy,
  type VersionInfo,
} from "../services/versions";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let fetchTexts: Record<string, string>;

const version = (
  id: number,
  reason = "save",
  created = 1761696000,
  size = 4,
): VersionInfo => ({
  id,
  created_unix: created,
  reason,
  size,
  file_modified_unix: created,
});

const buttonWithText = (text: string) =>
  [...container!.querySelectorAll("button")].find((entry) => entry.textContent === text) as
    | HTMLButtonElement
    | undefined;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderDialog(overrides: Partial<VersionHistoryDialogProps> = {}) {
  const props: VersionHistoryDialogProps = {
    path: "C:\\notes\\notes.txt",
    name: "notes.txt",
    currentModified: 1761696000,
    currentSize: 20,
    versionsEnabled: true,
    onOpenCopy: vi.fn(),
    onRestored: vi.fn(),
    onShowWindowsVersions: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<VersionHistoryDialog {...props} />);
  });
  await flush();
  return props;
}

beforeEach(() => {
  vi.mocked(versionsList).mockReset().mockResolvedValue({ versions: [], too_large: false });
  vi.mocked(versionsExtract).mockReset().mockResolvedValue("C:\\versions\\open\\1-file.txt");
  vi.mocked(versionsRestore).mockReset().mockResolvedValue({
    previous_id: null,
    saved: { path: "C:\\notes\\notes.txt", size: 4, modified_unix: 10 },
  });
  vi.mocked(versionsSaveCopy).mockReset().mockResolvedValue(null);
  vi.mocked(fileGrant).mockClear();
  fetchTexts = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(fetchTexts[url] ?? "").buffer,
    })),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("version history dialog", () => {
  it("lists the current file and the versions", async () => {
    vi.mocked(versionsList).mockResolvedValue({
      versions: [version(2, "restore", 1761782400), version(1, "save")],
      too_large: false,
    });
    await renderDialog();
    await flush();

    expect(container!.textContent).toContain(i18n.t("versions.current"));
    const options = [...container!.querySelectorAll('[role="option"]')] as HTMLElement[];
    expect(options).toHaveLength(2);
    expect(container!.textContent).toContain(i18n.t("versions.reason.save"));
    expect(container!.textContent).toContain(i18n.t("versions.reason.restore"));
    expect(options[0].getAttribute("aria-selected")).toBe("true");
  });

  it("shows the changes of a text file", async () => {
    vi.mocked(versionsList).mockResolvedValue({ versions: [version(1, "save", 1761696000, 4)], too_large: false });
    vi.mocked(versionsExtract).mockResolvedValue("C:\\versions\\open\\1-notes.txt");
    fetchTexts["http://test/C:\\notes\\notes.txt"] = "a\nc\n";
    fetchTexts["http://test/C:\\versions\\open\\1-notes.txt"] = "a\nb\n";
    await renderDialog();
    await flush();
    await flush();

    const removed = container!.querySelectorAll(".adp-diff-row--removed");
    const added = container!.querySelectorAll(".adp-diff-row--added");
    expect(removed).toHaveLength(1);
    expect(removed[0].textContent).toBe("b");
    expect(added).toHaveLength(1);
    expect(added[0].textContent).toBe("c");
  });

  it("other files offer Open", async () => {
    vi.mocked(versionsList).mockResolvedValue({ versions: [version(1, "save", 1761696000, 4)], too_large: false });
    vi.mocked(versionsExtract).mockResolvedValue("C:\\versions\\open\\1-photo.png");
    const onOpenCopy = vi.fn();
    await renderDialog({ path: "C:\\photos\\photo.png", name: "photo.png", onOpenCopy });
    await flush();

    expect(container!.textContent).toContain(i18n.t("versions.noPreview"));
    await act(async () => {
      buttonWithText(i18n.t("versions.open"))!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(versionsExtract).toHaveBeenCalled();
    expect(onOpenCopy).toHaveBeenCalledWith("C:\\versions\\open\\1-photo.png");
  });

  it("restore asks first and reports", async () => {
    vi.mocked(versionsList).mockResolvedValue({ versions: [version(1, "save")], too_large: false });
    const onRestored = vi.fn();
    await renderDialog({ onRestored });
    await flush();

    act(() => buttonWithText(i18n.t("versions.restore"))!.click());
    const confirmButtons = [...container!.querySelectorAll("button")].filter(
      (entry) => entry.textContent === i18n.t("versions.restore"),
    );
    expect(confirmButtons).toHaveLength(2);
    await act(async () => {
      confirmButtons[1].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(versionsRestore).toHaveBeenCalledWith("C:\\notes\\notes.txt", 1);
    expect(onRestored).toHaveBeenCalled();
    expect(container!.textContent).toContain(
      i18n.t("versions.restored", { date: formatDate(1761696000, i18n.language) }),
    );
  });

  it("says when there are no versions", async () => {
    await renderDialog();
    await flush();
    expect(container!.textContent).toContain(i18n.t("versions.empty"));
  });

  it("loads older history pages without losing the first page", async () => {
    vi.mocked(versionsList)
      .mockResolvedValueOnce({ versions: [version(2)], too_large: false, next_before_id: 2 })
      .mockResolvedValue({ versions: [version(1)], too_large: false, next_before_id: null });
    await renderDialog({ name: "photo.png" });
    const more = buttonWithText(i18n.t("versions.loadMore"));
    expect(more).toBeDefined();
    await act(async () => more!.click());
    expect(versionsList).toHaveBeenLastCalledWith("C:\\notes\\notes.txt", 2);
    expect(container!.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(buttonWithText(i18n.t("versions.loadMore"))).toBeUndefined();
  });

  it("offers Undo after restoring from an editor", async () => {
    vi.mocked(versionsList)
      .mockResolvedValueOnce({ versions: [version(1)], too_large: false })
      .mockResolvedValue({ versions: [version(2, "restore"), version(1)], too_large: false });
    vi.mocked(versionsRestore).mockResolvedValue({
      previous_id: 2,
      saved: { path: "C:\\notes\\notes.txt", size: 4, modified_unix: 20 },
    });
    const onRestored = vi.fn();
    await renderDialog({ allowUndo: true, onRestored });
    act(() => buttonWithText(i18n.t("versions.restore"))!.click());
    await act(async () => {
      const buttons = [...container!.querySelectorAll("button")].filter(
        (entry) => entry.textContent === i18n.t("versions.restore"),
      );
      buttons[1].click();
    });
    expect(buttonWithText(i18n.t("commands.undo"))).toBeDefined();
    await act(async () => buttonWithText(i18n.t("commands.undo"))!.click());
    expect(versionsRestore).toHaveBeenLastCalledWith("C:\\notes\\notes.txt", 2);
    expect(onRestored).toHaveBeenCalledTimes(2);
  });

  it("keeps Undo when refreshing an editor fails after the file was restored", async () => {
    vi.mocked(versionsList).mockResolvedValue({ versions: [version(1)], too_large: false });
    vi.mocked(versionsRestore).mockResolvedValue({
      previous_id: 2,
      saved: { path: "C:\\notes\\notes.txt", size: 4, modified_unix: 20 },
    });
    await renderDialog({ allowUndo: true, onRestored: vi.fn().mockRejectedValue(new Error("reload failed")) });
    act(() => buttonWithText(i18n.t("versions.restore"))!.click());
    await act(async () => {
      [...container!.querySelectorAll("button")].filter(
        (entry) => entry.textContent === i18n.t("versions.restore"),
      )[1].click();
    });
    expect(buttonWithText(i18n.t("commands.undo"))).toBeDefined();
    expect(container!.textContent).toContain(i18n.t("versions.restored", { date: formatDate(1761696000, i18n.language) }));
    await act(async () => buttonWithText(i18n.t("commands.undo"))!.click());
    expect(versionsRestore).toHaveBeenLastCalledWith("C:\\notes\\notes.txt", 2);
  });

  it("refuses a text preview that grows past its limit", async () => {
    vi.mocked(versionsList).mockResolvedValue({ versions: [version(1)], too_large: false });
    fetchTexts["http://test/C:\\notes\\notes.txt"] = "x".repeat(1_048_577);
    await renderDialog();
    await flush();
    expect(container!.textContent).toContain(i18n.t("errors.versions.preview_too_large"));
    expect(container!.querySelector(".adp-versions-diff")).toBeNull();
  });

  it("unsaved changes are mentioned before restoring", async () => {
    vi.mocked(versionsList).mockResolvedValue({ versions: [version(1, "save")], too_large: false });
    await renderDialog({ hasUnsavedChanges: true });
    await flush();

    act(() => buttonWithText(i18n.t("versions.restore"))!.click());
    expect(container!.textContent).toContain(i18n.t("versions.restoreUnsaved"));
  });
});
