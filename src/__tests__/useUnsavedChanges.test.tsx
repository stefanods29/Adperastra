import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { SaveHandle } from "../handlers/types";
import type { TabState } from "../services/tabs";
import { useUnsavedChanges, type UnsavedChanges } from "../views/useUnsavedChanges";

const TABS: TabState[] = [
  { id: "t1", kind: "file", title: "a.txt", path: "C:\\A\\a.txt", handler: "text" },
  { id: "t2", kind: "file", title: "b.txt", path: "C:\\B\\b.txt", handler: "text" },
];

let latest: UnsavedChanges | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Probe() {
  const unsaved = useUnsavedChanges(TABS);
  latest = unsaved;
  return <>{unsaved.dialog}</>;
}

const handle = (saved = true): SaveHandle => ({ save: vi.fn(async () => saved), discard: vi.fn() });

const buttonWithText = (text: string) =>
  [...container!.querySelectorAll("button")].find((entry) => entry.textContent === text) as HTMLButtonElement | undefined;

beforeEach(async () => {
  latest = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<Probe />);
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("useUnsavedChanges", () => {
  it("clean tabs close without a question", async () => {
    let resolved: boolean | null = null;
    await act(async () => {
      resolved = await latest!.confirmClose(["t1"]);
    });
    expect(resolved).toBe(true);
    expect(container!.querySelector("[role='dialog']")).toBeNull();
  });

  it("Save saves, then closes", async () => {
    const handleOne = handle(true);
    act(() => {
      latest!.registerSave("t1", handleOne);
      latest!.onDirtyChange("t1", true);
    });
    let pending!: Promise<boolean>;
    act(() => {
      pending = latest!.confirmClose(["t1"]);
    });
    expect(container!.textContent).toContain(i18n.t("editor.unsavedTitle", { name: "a.txt" }));

    let outcome = false;
    await act(async () => {
      buttonWithText(i18n.t("editor.save"))!.click();
      outcome = await pending;
    });
    expect(handleOne.save).toHaveBeenCalledTimes(1);
    expect(outcome).toBe(true);
    expect(container!.querySelector("[role='dialog']")).toBeNull();
  });

  it("a failed save keeps the tab", async () => {
    const handleOne = handle(false);
    act(() => {
      latest!.registerSave("t1", handleOne);
      latest!.onDirtyChange("t1", true);
    });
    let pending!: Promise<boolean>;
    act(() => {
      pending = latest!.confirmClose(["t1"]);
    });

    let outcome = true;
    await act(async () => {
      buttonWithText(i18n.t("editor.save"))!.click();
      outcome = await pending;
    });
    expect(outcome).toBe(false);
  });

  it("Don't save discards", async () => {
    const handleOne = handle();
    const handleTwo = handle();
    act(() => {
      latest!.registerSave("t1", handleOne);
      latest!.registerSave("t2", handleTwo);
      latest!.onDirtyChange("t1", true);
      latest!.onDirtyChange("t2", true);
    });
    let pending!: Promise<boolean>;
    act(() => {
      pending = latest!.confirmClose(["t1", "t2"]);
    });
    expect(container!.textContent).toContain("a.txt");
    expect(container!.textContent).toContain("b.txt");

    let outcome = false;
    await act(async () => {
      buttonWithText(i18n.t("editor.dontSave"))!.click();
      outcome = await pending;
    });
    expect(handleOne.discard).toHaveBeenCalledTimes(1);
    expect(handleTwo.discard).toHaveBeenCalledTimes(1);
    expect(outcome).toBe(true);
  });

  it("Cancel keeps everything", async () => {
    const handleOne = handle();
    act(() => {
      latest!.registerSave("t1", handleOne);
      latest!.onDirtyChange("t1", true);
    });
    let pending!: Promise<boolean>;
    act(() => {
      pending = latest!.confirmClose(["t1"]);
    });

    let outcome = true;
    await act(async () => {
      buttonWithText(i18n.t("common.cancel"))!.click();
      outcome = await pending;
    });
    expect(outcome).toBe(false);
    expect(handleOne.save).not.toHaveBeenCalled();
    expect(handleOne.discard).not.toHaveBeenCalled();
  });
});
