import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { DocumentFontControls } from "../office/document/DocumentFontControls";
import { DocumentStyleGallery } from "../office/document/DocumentStyleGallery";
import type { DocumentOperation } from "../office/types";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove(); root = null; container = null;
});
function mount() {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
}
describe("document pickers", () => {
  it("mixedfontpickerdoesnotapplydefault", async () => {
    mount(); const onPatch = vi.fn(async () => undefined);
    const font = { family: "Bundled test font", source: "bundled" as const, embeddable: true };
    await act(async () => root?.render(<DocumentFontControls font={{ kind: "mixed" }} size={{ kind: "mixed" }}
      fonts={[font]} disabled={false} onPatch={onPatch} />));
    expect(container?.querySelector("select")?.value).toBe("");
    expect(container?.querySelector("input")?.value).toBe("");
    expect(onPatch).not.toHaveBeenCalled();
    await act(async () => root?.render(<DocumentFontControls font={{ kind: "value", value: font }}
      size={{ kind: "value", value: 12 }} fonts={[font]} disabled={false} onPatch={onPatch} />));
    expect(container?.querySelector("input")?.value).toBe("12");
    expect(onPatch).not.toHaveBeenCalled();
  });
  it("readonlydisabled", async () => {
    mount();
    await act(async () => root?.render(<DocumentFontControls font={{ kind: "mixed" }} size={{ kind: "mixed" }}
      fonts={[]} disabled onPatch={vi.fn()} />));
    expect(container?.querySelector("select")?.disabled).toBe(true);
    expect(container?.querySelector("input")?.disabled).toBe(true);
  });
  it("sourceunsupportedstylepreserved", async () => {
    mount(); const onApply = vi.fn(async (_operation: DocumentOperation) => undefined);
    await act(async () => root?.render(<DocumentStyleGallery styles={[]} selectedId="imported-preserved-only-style"
      blockIds={["block"]} disabled={false} onApply={onApply} />));
    expect(container?.querySelectorAll("button")).toHaveLength(0);
    expect(onApply).not.toHaveBeenCalled();
  });
});
