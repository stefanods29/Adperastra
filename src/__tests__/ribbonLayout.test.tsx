import { Bold, Italic } from "lucide-react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import type { Command } from "../commands/registry";
import { LayoutContext } from "../layout/LayoutContext";
import { ToolbarLayoutContext, type ToolbarLayout } from "../layout/toolbarLayout";
import Ribbon from "../ribbon/Ribbon";
import ViewerFrame from "../ribbon/ViewerFrame";
import type { RibbonDef } from "../ribbon/types";
import { defaultSettings } from "../services/settings";

interface Ctx {
  bold: boolean;
  canItalic: boolean;
}

const ctx: Ctx = { bold: true, canItalic: false };

const commands: Command<Ctx>[] = [
  {
    id: "t.bold",
    labelKey: "viewer.fitToWindow",
    icon: Bold,
    risk: "read-only",
    helpSlug: "viewing-images",
    checkedWhen: (value) => value.bold,
    enabledWhen: () => true,
    run: () => undefined,
  },
  {
    id: "t.italic",
    labelKey: "viewer.actualSize",
    icon: Italic,
    risk: "read-only",
    helpSlug: "viewing-images",
    enabledWhen: () => true,
    run: () => undefined,
  },
  {
    id: "t.second",
    labelKey: "viewer.zoomIn",
    icon: Bold,
    risk: "read-only",
    helpSlug: "viewing-images",
    enabledWhen: () => true,
    run: () => undefined,
  },
];

const SELECT_LABEL = "Zoom list";
const OPTIONS = ["One", "Two"];

const def: RibbonDef = {
  tabs: [
    {
      id: "view",
      labelKey: "ribbon.view",
      keyTip: "V",
      groups: [
        {
          id: "g",
          labelKey: "ribbon.show",
          controls: [
            { type: "toggle", command: "t.bold", keyTip: "B" },
            { type: "button", command: "t.italic", showLabel: false, keyTip: "I" },
          ],
        },
      ],
    },
  ],
};

const defWithList: RibbonDef = {
  tabs: [
    {
      id: "view",
      labelKey: "ribbon.view",
      keyTip: "V",
      groups: [
        { id: "g", labelKey: "ribbon.show", controls: [{ type: "button", command: "t.bold" }] },
        {
          id: "list",
          labelKey: "ribbon.zoom",
          controls: [
            {
              type: "custom",
              id: "zoom",
              render: () => (
                <select aria-label={SELECT_LABEL}>
                  {OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ),
            },
          ],
        },
      ],
    },
  ],
};

const defTwoTabs: RibbonDef = {
  tabs: [
    {
      id: "view",
      labelKey: "ribbon.view",
      keyTip: "V",
      groups: [{ id: "g", labelKey: "ribbon.show", controls: [{ type: "button", command: "t.bold" }] }],
    },
    {
      id: "zoom",
      labelKey: "ribbon.zoom",
      keyTip: "Z",
      groups: [{ id: "h", labelKey: "ribbon.zoom", controls: [{ type: "button", command: "t.second" }] }],
    },
  ],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderRibbon(layout: ToolbarLayout, definition: RibbonDef): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <ToolbarLayoutContext.Provider value={layout}>
        <Ribbon def={definition} ctx={ctx} commands={commands} accent="explorer" active={true} />
      </ToolbarLayoutContext.Provider>,
    );
  });
  return container;
}

const buttonWith = (rootElement: ParentNode, label: string) =>
  [...rootElement.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === label,
  ) as HTMLButtonElement | undefined;

describe("Ribbon layouts", () => {
  it("a side ribbon shows names and stacks its groups", async () => {
    const element = await renderRibbon({ side: "left", orientation: "vertical", mode: "full" }, def);
    expect(element.querySelector(".adp-ribbon")!.classList.contains("adp-ribbon--vertical")).toBe(true);
    expect(element.querySelector(".adp-ribbon-body")!.getAttribute("aria-orientation")).toBe("vertical");
    const buttons = element.querySelectorAll(".adp-ribbon-btn");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain(i18n.t("viewer.fitToWindow"));
    expect(buttons[1].textContent).toContain(i18n.t("viewer.actualSize"));
  });

  it("icons only moves lists into More options", async () => {
    const element = await renderRibbon({ side: "left", orientation: "vertical", mode: "iconsOnly" }, defWithList);
    expect(element.querySelector(".adp-ribbon-body select")).toBeNull();
    const more = buttonWith(element.querySelector(".adp-ribbon-body")!, i18n.t("common.moreOptions"))!;
    expect(more).toBeDefined();
    await act(async () => {
      more.click();
    });
    const flyout = element.querySelector(".adp-flyout");
    expect(flyout).not.toBeNull();
    const select = flyout!.querySelector("select");
    expect(select).not.toBeNull();
    expect(document.activeElement).toBe(select);
    await act(async () => {
      select!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(element.querySelector(".adp-flyout")).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("ribbon tabs become a list on a side", async () => {
    const element = await renderRibbon({ side: "right", orientation: "vertical", mode: "full" }, defTwoTabs);
    expect(element.querySelector("[role='tab']")).toBeNull();
    const picker = buttonWith(element, i18n.t("ribbon.tabs"))!;
    expect(picker).toBeDefined();
    expect(picker.textContent).toContain(i18n.t("ribbon.view"));
    await act(async () => {
      picker.click();
    });
    const item = [...element.querySelectorAll("[role='menuitem']")].find(
      (entry) => entry.textContent === i18n.t("ribbon.zoom"),
    ) as HTMLElement;
    await act(async () => {
      item.click();
    });
    expect(buttonWith(element.querySelector(".adp-ribbon-body")!, i18n.t("viewer.zoomIn"))).toBeDefined();
  });

  it("ViewerFrame docks the ribbon", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const layout = { ...defaultSettings().layout, toolbar_position: "right" as const };
    await act(async () => {
      root?.render(
        <LayoutContext.Provider value={{ layout, onLayoutChange: () => undefined }}>
          <ViewerFrame ribbon={<div className="probe" />}>
            <p>{i18n.t("common.ready")}</p>
          </ViewerFrame>
        </LayoutContext.Provider>,
      );
    });
    expect(container.querySelector(".adp-dock--right .adp-dock-bar .probe")).not.toBeNull();
    const content = container.querySelector(".adp-dock-content.adp-viewer-content");
    expect(content).not.toBeNull();
    expect(content!.querySelector("p")).not.toBeNull();
  });
});
