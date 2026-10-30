import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import { BUILT_IN_PRESETS, layoutValues } from "../layout/presets";
import { defaultSettings, type LayoutSettings as LayoutValues } from "../services/settings";
import LayoutSettings from "../views/settings/LayoutSettings";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderLayout(layout: LayoutValues = defaultSettings().layout, detailsPane = false) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const changes: { layout: LayoutValues; detailsPane: boolean }[] = [];
  let currentLayout = layout;
  let currentDetails = detailsPane;
  const draw = async () => {
    await act(async () => {
      root?.render(
        <LayoutSettings
          layout={currentLayout}
          detailsPane={currentDetails}
          onChange={(next, nextDetails) => {
            currentLayout = next;
            currentDetails = nextDetails;
            changes.push({ layout: next, detailsPane: nextDetails });
            void draw();
          }}
          onOpenHelp={() => undefined}
        />,
      );
    });
  };
  await draw();
  return { changes, current: () => ({ layout: currentLayout, detailsPane: currentDetails }) };
}

const field = (name: string) =>
  container!.querySelector(`select[data-layout-field="${name}"]`) as HTMLSelectElement;

async function setField(name: string, value: string) {
  const select = field(name);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const buttonWithText = (text: string) =>
  [...container!.querySelectorAll("button")].find((button) => button.textContent === text) as
    | HTMLButtonElement
    | undefined;

const saveButton = () => buttonWithText(i18n.t("common.save"))!;

async function typeName(value: string) {
  const input = container!.querySelector("input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const saved = (name: string) => ({ name, ...layoutValues(defaultSettings().layout) });

describe("LayoutSettings", () => {
  it("shows the matching preset and applies another", async () => {
    const view = await renderLayout(defaultSettings().layout, false);
    expect(field("preset").value).toBe("builtin:standard");
    await setField("preset", "builtin:minimal");
    expect(view.changes.at(-1)!.layout).toMatchObject(BUILT_IN_PRESETS.minimal);
    expect(view.changes.at(-1)!.detailsPane).toBe(false);
  });

  it("shows Custom when nothing matches", async () => {
    await renderLayout({ ...defaultSettings().layout, toolbar_position: "left" }, false);
    expect(field("preset").value).toBe("custom");
    const custom = [...field("preset").options].find((option) => option.value === "custom")!;
    expect(custom.disabled).toBe(true);
  });

  it("moves the toolbar and the panes", async () => {
    const view = await renderLayout(defaultSettings().layout, false);
    await setField("toolbar_position", "right");
    await setField("nav_pane_position", "hidden");
    await setField("details_pane", "bottom");
    expect(view.changes).toHaveLength(3);
    expect(view.changes[0].layout.toolbar_position).toBe("right");
    expect(view.changes[0].detailsPane).toBe(false);
    expect(view.changes[1].layout.nav_pane_position).toBe("hidden");
    expect(view.changes[1].detailsPane).toBe(false);
    expect(view.changes[2].layout.details_pane_position).toBe("bottom");
    expect(view.changes[2].detailsPane).toBe(true);
  });

  it("hides the Details pane", async () => {
    const layout = defaultSettings().layout;
    const view = await renderLayout(layout, true);
    await setField("details_pane", "hidden");
    expect(view.changes.at(-1)).toEqual({ layout, detailsPane: false });
  });

  it("the side tab bar switch works only on a side", async () => {
    const view = await renderLayout(defaultSettings().layout, false);
    const switchButton = () => container!.querySelector("[role='switch']") as HTMLButtonElement;
    expect(switchButton().disabled).toBe(true);
    await setField("tab_bar_position", "left");
    expect(switchButton().disabled).toBe(false);
    await act(async () => {
      switchButton().click();
    });
    expect(view.changes.at(-1)!.layout.tab_bar_collapsed).toBe(true);
  });

  it("saves a preset", async () => {
    const view = await renderLayout(defaultSettings().layout, false);
    await act(async () => {
      buttonWithText(i18n.t("settings.layoutSave"))!.click();
    });
    await typeName("  Work  ");
    await act(async () => {
      saveButton().click();
    });
    const last = view.changes.at(-1)!;
    expect(last.layout.saved_presets).toEqual([saved("Work")]);
    expect(last.detailsPane).toBe(false);
    expect(container!.querySelector("[role='dialog']")).toBeNull();
  });

  it("refuses a duplicate or empty name", async () => {
    await renderLayout({ ...defaultSettings().layout, saved_presets: [saved("Work")] }, false);
    await act(async () => {
      buttonWithText(i18n.t("settings.layoutSave"))!.click();
    });
    await typeName("work");
    expect(container!.querySelector("[role='alert']")!.textContent).toBe(i18n.t("settings.layoutNameDuplicate"));
    expect(saveButton().disabled).toBe(true);
    await typeName("");
    expect(container!.querySelector("[role='alert']")).toBeNull();
    expect(saveButton().disabled).toBe(true);
  });

  it("deletes a saved preset", async () => {
    const home = saved("Home");
    const view = await renderLayout(
      { ...defaultSettings().layout, saved_presets: [saved("Work"), home] },
      false,
    );
    const remove = [...container!.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === i18n.t("settings.layoutDelete", { name: "Work" }),
    ) as HTMLButtonElement;
    await act(async () => {
      remove.click();
    });
    expect(view.changes.at(-1)!.layout.saved_presets).toEqual([home]);
  });

  it("the save button is disabled at 20 presets", async () => {
    const many = Array.from({ length: 20 }, (_, index) => saved(`p${index}`));
    await renderLayout({ ...defaultSettings().layout, saved_presets: many }, false);
    expect(buttonWithText(i18n.t("settings.layoutSave"))!.disabled).toBe(true);
    expect(container!.textContent).toContain(i18n.t("settings.layoutFull", { max: 20 }));
  });
});
