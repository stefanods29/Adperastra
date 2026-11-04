import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import "../i18n";
import NavPane from "../views/explorer/NavPane";
import { defaultHomeCustomization, defaultNavigationCustomization } from "../shell/registries";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderNav(navigation: ReturnType<typeof defaultNavigationCustomization>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <NavPane
        knownFolders={[
          { id: "desktop", name: "Escritorio", path: "C:\\Users\\stefa\\Desktop" },
          { id: "downloads", name: "Descargas", path: "C:\\Users\\stefa\\Downloads" },
        ]}
        pinnedFolders={[]}
        drives={[]}
        location={{ type: "home" }}
        onHome={() => undefined}
        onGallery={() => undefined}
        onDrives={() => undefined}
        onNetwork={() => undefined}
        onOpenFolder={() => undefined}
        onUnpin={() => undefined}
        navigation={navigation}
      />,
    );
  });
  return container;
}

describe("home grid restore", () => {
  it("defaults Home sections to small cards for the 3-column grid", () => {
    const home = defaultHomeCustomization();
    expect(home.sections.map((section) => section.id)).toEqual(["quick_access", "recent", "favorites"]);
    for (const section of home.sections) expect(section.size).toBe("small");
  });

  it("shows known folders under pinned when custom navigation has no pinned items", async () => {
    const navigation = defaultNavigationCustomization();
    const element = await renderNav(navigation);
    expect(element.textContent).toContain("Escritorio");
    expect(element.textContent).toContain("Descargas");
  });

  it("does not duplicate a pinned folder already in navigation", async () => {
    const navigation = defaultNavigationCustomization();
    navigation.sections
      .find((section) => section.id === "pinned")!
      .items.push({
        id: "custom-1",
        kind: "folder",
        target_id: "C:\\Users\\stefa\\Desktop",
        visible: true,
        section_id: "pinned",
      });
    const element = await renderNav(navigation);
    const text = element.textContent ?? "";
    const desktopMatches = text.split("Desktop").length - 1;
    expect(desktopMatches).toBe(1);
    expect(text).toContain("Descargas");
  });
});
