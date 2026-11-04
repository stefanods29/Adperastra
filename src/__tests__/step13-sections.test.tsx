import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import OfficeComments from "../handlers/office/OfficeComments";
import OfficeNavigation from "../handlers/office/OfficeNavigation";
import { validateOfficePageRequest } from "../services/officeView";
import type { OfficeComment, OfficeSection } from "../services/officeViewTypes";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

const sections: OfficeSection[] = [
  { id: "sheet:0", name: "First", kind: "sheet", index: 0, page_count: 1 },
  { id: "sheet:1", name: "Second", kind: "sheet", index: 1, page_count: 1 },
  { id: "sheet:2", name: "Third", kind: "sheet", index: 2, page_count: 1 },
];

const comment = (id: string, text: string, parent_id?: string): OfficeComment => ({
  id,
  section_id: "document:0",
  page: 1,
  author: "Ada",
  text,
  parent_id: parent_id ?? null,
  source_anchor: { kind: "paragraph", index: 0 },
});

describe("Office sections", () => {
  it("sheet2_selected_correct", async () => {
    const selected = vi.fn();
    const view = render(
      <OfficeNavigation
        sections={sections}
        selectedSection="sheet:0"
        onSelectSection={selected}
        commentsOpen={false}
        commentsAvailable={false}
        onToggleComments={() => undefined}
      />,
    );
    const second = view.querySelector<HTMLButtonElement>('[data-section-id="sheet:1"]')!;
    expect(second).not.toBeNull();
    await act(async () => second.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(selected).toHaveBeenCalledWith("sheet:1");
    expect(second.getAttribute("aria-selected")).toBe("false");
  });

  it("reply_parent_preserved", () => {
    const view = render(
      <OfficeComments
        page={{
          items: [comment("c1", "Root"), comment("c2", "Reply", "c1")],
          complete: true,
        }}
      />,
    );
    const reply = view.querySelector('[data-parent-id="c1"]')!;
    expect(reply).not.toBeNull();
    expect(reply.textContent).toContain("Reply");
    expect(view.querySelector(".adp-office-comment-replies")).not.toBeNull();
  });

  it("page0_refused", () => {
    expect(() => validateOfficePageRequest("session", "document:0", 0, 1)).toThrow("office.bad_request");
    expect(() => validateOfficePageRequest("session", "document:0", 1, 0.1)).toThrow("office.bad_request");
    expect(() => validateOfficePageRequest("session", "not-a-section", 1, 1)).toThrow("office.bad_request");
    expect(() => validateOfficePageRequest("session", "document:0", 1, 1)).not.toThrow();
  });

  it("comments_escaped_script_text", () => {
    const view = render(
      <OfficeComments
        page={{
          items: [comment("c1", "<script>alert('x')</script>")],
          complete: true,
        }}
      />,
    );
    expect(view.querySelector("script")).toBeNull();
    expect(view.textContent).toContain("<script>alert('x')</script>");
  });
});
