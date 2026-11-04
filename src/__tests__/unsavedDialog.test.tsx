import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import UnsavedDialog from "../views/UnsavedDialog";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(names: string[], callbacks: { save?: () => void; dontSave?: () => void; cancel?: () => void } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <UnsavedDialog
        names={names}
        onSave={callbacks.save ?? (() => undefined)}
        onDontSave={callbacks.dontSave ?? (() => undefined)}
        onCancel={callbacks.cancel ?? (() => undefined)}
      />,
    );
  });
}

const buttonWithText = (text: string) =>
  [...container!.querySelectorAll("button")].find((entry) => entry.textContent === text) as HTMLButtonElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("unsaved dialog", () => {
  it("asks about one file and offers its three answers", async () => {
    const save = vi.fn();
    const dontSave = vi.fn();
    const cancel = vi.fn();
    await render(["notes.txt"], { save, dontSave, cancel });

    expect(container!.textContent).toContain(i18n.t("editor.unsavedTitle", { name: "notes.txt" }));
    expect(container!.textContent).toContain(i18n.t("editor.unsavedBody"));
    expect(container!.querySelectorAll(".adp-dialog-actions button")).toHaveLength(3);

    act(() => buttonWithText(i18n.t("editor.save"))!.click());
    expect(save).toHaveBeenCalledTimes(1);

    act(() => buttonWithText(i18n.t("editor.dontSave"))!.click());
    expect(dontSave).toHaveBeenCalledTimes(1);

    act(() => buttonWithText(i18n.t("common.cancel"))!.click());
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("lists several files and saves them all", async () => {
    const save = vi.fn();
    await render(["a.txt", "b.txt"], { save });

    expect(container!.textContent).toContain(i18n.t("editor.unsavedManyBody", { count: 2 }));
    const items = [...container!.querySelectorAll("li")].map((entry) => entry.textContent);
    expect(items).toEqual(["a.txt", "b.txt"]);
    expect(buttonWithText(i18n.t("editor.saveAll"))).toBeDefined();

    act(() => buttonWithText(i18n.t("editor.saveAll"))!.click());
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("Escape means Cancel", async () => {
    const cancel = vi.fn();
    await render(["notes.txt"], { cancel });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
