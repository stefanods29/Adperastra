import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import "../i18n";
import OfficeEditorChoice from "../handlers/office/OfficeEditorChoice";

it("opens worksheets in the live grid and keeps the saved-source preview available", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(<OfficeEditorChoice initialEditor
      editor={(active) => <div data-editor-active={String(active)} />}
      original={(active) => <div data-source-active={String(active)} />} />));
    expect(host.querySelector('[data-editor-active="true"]')).not.toBeNull();
    expect(host.querySelector('[data-source-active="false"]')).not.toBeNull();
    const buttons = host.querySelectorAll("button");
    expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
    act(() => buttons[0].click());
    expect(host.querySelector('[data-editor-active="false"]')).not.toBeNull();
    expect(host.querySelector('[data-source-active="true"]')).not.toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
