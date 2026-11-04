import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import NavigationEditor from "../shell/NavigationEditor";
import StatusFieldHost from "../shell/StatusFieldHost";
import { StatusFieldRegistry, defaultNavigationCustomization } from "../shell/registries";
import type { NavigationCustomization, StatusFieldOrderEntry } from "../shell/types";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const uuid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

function navigationWithItem(): NavigationCustomization {
  const value = defaultNavigationCustomization();
  value.sections[2].items.push({
    id: uuid(1),
    kind: "folder",
    target_id: "C:\\Work\\Data",
    display_label: "Data",
    visible: true,
    section_id: "pinned",
  });
  return value;
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function applyButton(): HTMLButtonElement {
  return [...container!.querySelectorAll("button")].find(
    (button) => button.textContent === i18n.t("common.apply"),
  ) as HTMLButtonElement;
}

describe("navigation and status customization", () => {
  it("displayrenameleavespath: changes a display name without changing the folder path", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const applied: NavigationCustomization[] = [];
    await act(async () => {
      root?.render(
        <NavigationEditor
          value={navigationWithItem()}
          onApply={async (value) => {
            applied.push(value);
          }}
          onCancel={() => undefined}
          onOpenHelp={() => undefined}
        />,
      );
    });
    const input = container.querySelector(`[data-nav-item="${uuid(1)}"] input`) as HTMLInputElement;
    await typeInto(input, "Projects");
    await act(async () => applyButton().click());
    const item = applied[0].sections[2].items[0];
    expect(item.display_label).toBe("Projects");
    expect(item.target_id).toBe("C:\\Work\\Data");
  });

  it("missingLocate: shows a warning and Locate for a missing path", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onLocate = vi.fn();
    await act(async () => {
      root?.render(
        <NavigationEditor
          value={navigationWithItem()}
          pathStatus={() => "missing"}
          onLocate={onLocate}
          onApply={async () => undefined}
          onCancel={() => undefined}
          onOpenHelp={() => undefined}
        />,
      );
    });
    expect(container.textContent).toContain(i18n.t("shellCustom.missingFolder"));
    const locate = container.querySelector(`button[aria-label="${i18n.t("shellCustom.locate")}"]`) as HTMLButtonElement;
    await act(async () => locate.click());
    expect(onLocate).toHaveBeenCalledWith("C:\\Work\\Data");
  });

  it("disposeOwnerstopsgetter: disposing an owner stops its getters", () => {
    const registry = new StatusFieldRegistry();
    const read = vi.fn(() => ({ kind: "text" as const, text: "12 items" }));
    registry.register("explorer", { id: "item_count", label_key: "statusFields.itemCount", read });
    expect(registry.read("explorer", ["item_count"])).toHaveLength(1);
    registry.disposeOwner("explorer");
    expect(registry.read("explorer", ["item_count"])).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("hiddenfree-spacefielddoesnotquerydrive: does not query a drive for a hidden free-space field", async () => {
    const registry = new StatusFieldRegistry();
    const freeSpace = vi.fn(() => ({ kind: "size" as const, bytes: 1024 }));
    const itemCount = vi.fn(() => ({ kind: "text" as const, text: "3 items" }));
    registry.register("explorer", { id: "free_space", label_key: "statusFields.freeSpace", read: freeSpace });
    registry.register("explorer", { id: "item_count", label_key: "statusFields.itemCount", read: itemCount });
    const order: StatusFieldOrderEntry[] = [
      { id: "free_space", visible: false },
      { id: "item_count", visible: true },
    ];
    const draw = async (next: readonly StatusFieldOrderEntry[]) => {
      await act(async () => {
        root?.render(
          <StatusFieldHost registry={registry} ownerId="explorer" order={next} visible />,
        );
      });
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await draw(order);
    expect(freeSpace).not.toHaveBeenCalled();
    expect(itemCount).toHaveBeenCalled();
    await draw([
      { id: "free_space", visible: true },
      { id: "item_count", visible: true },
    ]);
    expect(freeSpace).toHaveBeenCalled();
    expect(container.textContent).toContain("1 KB");
  });

  it("criticalerrorsremainwhenstatushidden: keeps critical errors visible when the status bar is hidden", async () => {
    const registry = new StatusFieldRegistry();
    const read = vi.fn(() => ({ kind: "text" as const, text: "12 items" }));
    registry.register("explorer", { id: "item_count", label_key: "statusFields.itemCount", read });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <StatusFieldHost
          registry={registry}
          ownerId="explorer"
          order={[{ id: "item_count", visible: true }]}
          visible={false}
          critical={<span>Save failed</span>}
        />,
      );
    });
    expect(container.textContent).toContain("Save failed");
    expect(container.textContent).not.toContain("12 items");
    expect(read).not.toHaveBeenCalled();
  });
});
