import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import PrivacyFields from "../privacy/PrivacyFields";
import type { PrivacyField } from "../services/privacy";

const fields: PrivacyField[] = [
  {
    category: "gps",
    containers: ["exif"],
    related_categories: [],
    field_id: "exif.0002",
    label_key: "privacy.gps",
    preview: "51.5, -0.1",
    count: 1,
    content_affecting: false,
    coverage: "complete",
  },
  {
    category: "author",
    containers: ["xmp"],
    related_categories: [],
    field_id: "xmp.attr.dc.creator",
    label_key: "privacy.author",
    preview: "<b>Author</b>",
    count: 1,
    content_affecting: false,
    coverage: "complete",
  },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
}

function checkbox(label: string): HTMLInputElement | null {
  return (
    [...(container?.querySelectorAll<HTMLInputElement>("input[type='checkbox']") ?? [])].find(
      (input) => input.getAttribute("aria-label") === label,
    ) ?? null
  );
}

describe("PrivacyFields", () => {
  it("lists each category with plain escaped values", async () => {
    const onToggle = vi.fn();
    await render(
      <PrivacyFields fields={fields} selectedCategories={["gps"]} onToggle={onToggle} />,
    );
    expect(checkbox("Location")?.checked).toBe(true);
    expect(checkbox("Author information")?.checked).toBe(false);
    expect(container!.textContent).toContain("<b>Author</b>");
    expect(container!.querySelector("b")).toBeNull();
  });

  it("keeps keyboard category focus and reports toggles", async () => {
    const onToggle = vi.fn();
    await render(
      <PrivacyFields fields={fields} selectedCategories={["gps"]} onToggle={onToggle} />,
    );
    const author = checkbox("Author information")!;
    author.focus();
    expect(document.activeElement).toBe(author);
    await act(async () => {
      author.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onToggle).toHaveBeenCalledWith("author", true);
  });

  it("disables a selective category whose coverage is unknown", async () => {
    const unknown: PrivacyField[] = [
      { ...fields[0], field_id: "exif.gps.unknown", coverage: "unknown" },
    ];
    await render(
      <PrivacyFields fields={unknown} selectedCategories={[]} onToggle={() => undefined} />,
    );
    expect(checkbox("Location")?.disabled).toBe(true);
  });

  it("allows whole-container removal for an unknown XMP packet", async () => {
    const unknown: PrivacyField[] = [
      { ...fields[0], field_id: "xmp.unknown", category: "xmp", coverage: "unknown" },
    ];
    await render(
      <PrivacyFields fields={unknown} selectedCategories={[]} onToggle={() => undefined} />,
    );
    expect(checkbox("XMP information")?.disabled).toBe(false);
  });

  it("shows the honest none message", async () => {
    await render(
      <PrivacyFields fields={[]} selectedCategories={[]} onToggle={() => undefined} />,
    );
    expect(container!.textContent).toContain("No supported hidden information was found.");
  });
});
