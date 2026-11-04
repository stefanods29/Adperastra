import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import HomeSectionHost from "../shell/HomeSectionHost";
import { mergeHomeLayout } from "../shell/homeProviders";
import { HomeSectionRegistry } from "../shell/registries";
import type { HomeCustomization, HomeSectionProvider, ShellItem } from "../shell/types";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function item(id: string): ShellItem {
  return { id, kind: "folder", label: id, target_id: `C:\\${id}`, icon_id: "folder" };
}

function provider(id: string, load: HomeSectionProvider["load"]): HomeSectionProvider {
  return { id, label_key: `shellCustom.${id}`, load, activate: async () => undefined };
}

function layout(ids: readonly string[], limit = 12, visible = true): HomeCustomization {
  return {
    sections: ids.map((id) => ({ id, visible, collapsed: false, size: "medium" as const, limit })),
  };
}

async function renderHost(
  value: HomeCustomization,
  providers: readonly HomeSectionProvider[],
  onActivate: (entry: ShellItem) => void | Promise<void> = () => undefined,
) {
  const draw = async (nextValue: HomeCustomization, nextProviders: readonly HomeSectionProvider[]) => {
    await act(async () => {
      root?.render(
        <HomeSectionHost layout={nextValue} providers={nextProviders} onActivate={onActivate} />,
      );
    });
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await draw(value, providers);
  return { draw };
}

describe("HomeSectionHost", () => {
  it("futureproviderregisteredwithoutrootchange: shows a future provider registered without changing the root", async () => {
    const registry = new HomeSectionRegistry();
    registry.register(provider("quick_access", async () => [item("one")]));
    const first = layout(["quick_access"]);
    const view = await renderHost(first, registry.list());
    expect(container!.querySelector('[data-section-id="quick_access"]')).not.toBeNull();

    const loadFuture = vi.fn(async () => [item("future")]);
    registry.register(provider("tagged_files", loadFuture));
    const second = mergeHomeLayout(first, registry.list());
    second.sections[1].visible = true;
    await view.draw(second, registry.list());
    expect(container!.querySelector('[data-section-id="tagged_files"]')).not.toBeNull();
    expect(loadFuture).toHaveBeenCalledTimes(1);
  });

  it("staleloadcancelled: cancels a stale load and keeps the newest result", async () => {
    let resolveFirst: (items: readonly ShellItem[]) => void = () => undefined;
    let resolveSecond: (items: readonly ShellItem[]) => void = () => undefined;
    const load = vi
      .fn<HomeSectionProvider["load"]>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));
    const view = await renderHost(layout(["recent"], 5), [provider("recent", load)]);
    await view.draw(layout(["recent"], 6), [provider("recent", load)]);
    await act(async () => {
      resolveFirst([item("stale")]);
      resolveSecond([item("fresh")]);
      await Promise.resolve();
    });
    expect(container!.textContent).toContain("fresh");
    expect(container!.textContent).not.toContain("stale");
  });

  it("DOMorder=visualorder: renders DOM order exactly as the saved visual order", async () => {
    const providers = [provider("b", async () => [item("b")]), provider("a", async () => [item("a")]), provider("c", async () => [item("c")])];
    await renderHost(layout(["c", "a", "b"]), providers);
    const order = [...container!.querySelectorAll("[data-section-id]")].map((element) =>
      element.getAttribute("data-section-id"),
    );
    expect(order).toEqual(["c", "a", "b"]);
  });

  it("hiddenproviderdoesnoload: does not load a hidden provider", async () => {
    const load = vi.fn(async () => [item("hidden")]);
    await renderHost(layout(["recent"], 12, false), [provider("recent", load)]);
    expect(load).not.toHaveBeenCalled();
  });

  it("limit100enforced: passes at most 100 items to every provider", async () => {
    const load = vi.fn(async () => []);
    const view = await renderHost(layout(["recent"], 1000), [provider("recent", load)]);
    expect(load).toHaveBeenLastCalledWith(100, expect.any(AbortSignal));
    await view.draw(layout(["recent"], 0), [provider("recent", load)]);
    expect(load).toHaveBeenLastCalledWith(1, expect.any(AbortSignal));
  });

  it("allprovidersdispose: unregisters a provider without touching the others", () => {
    const registry = new HomeSectionRegistry();
    const unsubscribe = registry.register(provider("recent", async () => []));
    registry.register(provider("favorites", async () => []));
    unsubscribe();
    expect(registry.list().map((entry) => entry.id)).toEqual(["favorites"]);
  });

  it("routes item activation to the normal open pipeline", async () => {
    const onActivate = vi.fn();
    await renderHost(layout(["recent"]), [provider("recent", async () => [item("openme")])], onActivate);
    const card = container!.querySelector<HTMLButtonElement>("[data-shell-item-id]")!;
    await act(async () => card.click());
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ target_id: "C:\\openme" }));
  });
});
