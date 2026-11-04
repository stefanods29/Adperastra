import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import OfficePresentation, { audienceSlides } from "../handlers/office/OfficePresentation";
import OfficePresenter from "../handlers/office/OfficePresenter";
import type { OfficeSection, OfficeSession } from "../services/officeViewTypes";

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

const session: OfficeSession = {
  session_id: "00000000-0000-4000-8000-000000000001",
  format: "docx",
  source_revision: 1,
  engine_version: "quick",
  quality: "quick",
  section_count: 2,
  read_only: true,
  capabilities: { comments: true, presentation: false, exact_render: false },
};

const sections: OfficeSection[] = [
  { id: "document:0", name: "Body", kind: "document", index: 0, page_count: 2 },
  { id: "document:1", name: "Appendix", kind: "document", index: 1, page_count: 1 },
];

describe("Office view", () => {
  it("presentation_notes_never_on_audience", () => {
    const slides = [
      {
        section_id: "slide:0",
        title: "Public title",
        text: "Public body",
        notes: "PRIVATE PRESENTER NOTE",
        comments: ["PRIVATE COMMENT"],
        image: null,
      },
    ];
    const audience = audienceSlides(slides);
    expect(audience[0]).toEqual({
      section_id: "slide:0",
      title: "Public title",
      text: "Public body",
      image: null,
    });
    const view = render(<OfficePresentation slides={slides} onClose={() => undefined} />);
    expect(view.textContent).toContain("Public title");
    expect(view.textContent).not.toContain("PRIVATE PRESENTER NOTE");
    expect(view.textContent).not.toContain("PRIVATE COMMENT");
  });

  it("protected_view_no_mutation", () => {
    const view = render(
      <OfficePresenter
        session={session}
        sections={sections}
        selectedSection="document:0"
        page={1}
        pageImage={null}
        cells={null}
        comments={null}
        commentsOpen={false}
        commentsAvailable={true}
        loading={false}
        protectedView={true}
        previewOnly={false}
        onSelectSection={() => undefined}
        onPage={() => undefined}
        onToggleComments={() => undefined}
        onOpenChosenApp={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    expect(view.textContent).toContain(i18n.t("office.readOnly"));
    expect(view.textContent).not.toContain(i18n.t("common.save"));
    expect(view.querySelector("[contenteditable='true']")).toBeNull();
    expect(view.querySelector("textarea")).toBeNull();
    expect(view.querySelector("input")).toBeNull();
  });

  it("missing_pack_chosen_app", async () => {
    const openChosen = vi.fn();
    const view = render(
      <OfficePresenter
        session={session}
        sections={sections}
        selectedSection="document:0"
        page={1}
        pageImage={null}
        cells={null}
        comments={null}
        commentsOpen={false}
        commentsAvailable={false}
        loading={false}
        errorCode="office.pack_missing"
        errorText={i18n.t("office.noPreview")}
        onSelectSection={() => undefined}
        onPage={() => undefined}
        onToggleComments={() => undefined}
        onOpenChosenApp={openChosen}
        onOpenHelp={() => undefined}
      />,
    );
    expect(view.textContent).toContain(i18n.t("office.noPreview"));
    const button = [...view.querySelectorAll("button")].find((entry) =>
      entry.textContent?.includes(i18n.t("office.openChosen")),
    );
    expect(button).toBeDefined();
    await act(async () => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(openChosen).toHaveBeenCalled();
  });

  it("keyboard_panel_focus", () => {
    const view = render(
      <OfficePresenter
        session={session}
        sections={sections}
        selectedSection="document:0"
        page={1}
        pageImage={null}
        cells={null}
        comments={{ items: [], complete: true }}
        commentsOpen={true}
        commentsAvailable={true}
        loading={false}
        onSelectSection={() => undefined}
        onPage={() => undefined}
        onToggleComments={() => undefined}
        onOpenChosenApp={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    const nav = view.querySelector<HTMLElement>(".adp-office-navigation")!;
    const surface = view.querySelector<HTMLElement>(".adp-office-surface")!;
    const comments = view.querySelector<HTMLElement>(".adp-office-comments")!;
    expect(nav).not.toBeNull();
    expect(surface).not.toBeNull();
    expect(comments).not.toBeNull();
    expect(nav.compareDocumentPosition(surface) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(surface.compareDocumentPosition(comments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const selected = view.querySelector<HTMLButtonElement>('[data-section-id="document:0"]')!;
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(selected.tabIndex).toBe(0);
    expect(view.querySelector<HTMLButtonElement>('[data-section-id="document:1"]')!.tabIndex).toBe(-1);
    surface.focus();
    expect(document.activeElement).toBe(surface);
    comments.focus();
    expect(document.activeElement).toBe(comments);
  });
});
