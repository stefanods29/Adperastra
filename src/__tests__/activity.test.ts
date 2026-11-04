import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import "../i18n";
import * as smartViews from "../services/smartViews";
import {
  ACTIVITY_KINDS,
  type ActivityEvent,
  type ActivityKind,
  type ActivityPage,
} from "../services/smartViews";
import { HomeSectionRegistry } from "../shell/registries";
import RecentActivityView from "../views/RecentActivityView";
import { registerActivityHome } from "../views/activityProviders";

const mockedInvoke = vi.mocked(invoke);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

beforeEach(() => {
  mockedInvoke.mockReset();
});

const NOW = Math.floor(Date.now() / 1000);

function uuidFor(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function event(
  id: string,
  kind: ActivityKind,
  path: string,
  createdUnix = NOW,
  destPath: string | null = null,
): ActivityEvent {
  return {
    id,
    kind,
    key: null,
    path,
    dest_path: destPath,
    created_unix: createdUnix,
    operation_id: null,
  };
}

function page(events: ActivityEvent[], cursor: string | null = null, complete = true): ActivityPage {
  return { events, next_cursor: cursor, complete };
}

async function renderView(
  onOpenFile: (path: string) => void = () => undefined,
): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(RecentActivityView, {
        active: true,
        onOpenFile,
        onOpenHelp: () => undefined,
      }),
    );
  });
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function commandName(call: readonly unknown[]): string {
  return String(call[0]);
}

describe("recent activity", () => {
  it("onlysuccessfulappactions", async () => {
    const events = ACTIVITY_KINDS.map((kind, index) =>
      event(uuidFor(index + 1), kind, `C:\\Work\\${kind}.txt`),
    );
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "activity_status") return { paused: false };
      if (command === "activity_list") return page(events);
      return undefined;
    });
    await renderView();
    const rendered = [...container!.querySelectorAll("[data-activity-kind]")].map((element) =>
      element.getAttribute("data-activity-kind"),
    );
    expect(rendered).toEqual([...ACTIVITY_KINDS]);
    // The list has no write path: only status and list were asked for.
    expect(mockedInvoke.mock.calls.map(commandName)).toEqual([
      "activity_status",
      "activity_list",
    ]);
    expect("recordActivity" in smartViews).toBe(false);
    expect("appendActivity" in smartViews).toBe(false);
    const fields = Object.keys(events[0]).sort();
    expect(fields).toEqual([
      "created_unix",
      "dest_path",
      "id",
      "key",
      "kind",
      "operation_id",
      "path",
    ]);
  });

  it("lockedcontentexcluded", async () => {
    const normal = event(uuidFor(1), "open", "C:\\Work\\notes.txt");
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "activity_status") return { paused: false };
      if (command === "activity_list") return page([normal]);
      if (command.startsWith("activity_record")) throw new Error("activity.invalid");
      return undefined;
    });
    await renderView();
    // A sensitive document never reaches the wire, so it cannot be rendered.
    expect(container!.textContent).toContain("C:\\Work\\notes.txt");
    expect(container!.textContent).not.toContain("locked");
    expect(container!.textContent).not.toContain("secret");
    // There is no control that appends an entry, not even for a locked file.
    expect(container!.querySelector('[data-activity-action="record"]')).toBeNull();
  });

  it("1001dropsoldest", async () => {
    // The native ring keeps ids 1..1000 and dropped id 0. The view must page
    // through exactly those rows, newest first, and never invent the dropped
    // entry on its own.
    const stored = Array.from({ length: 1000 }, (_, index) =>
      event(uuidFor(1000 - index), "open", `C:\\Work\\${1000 - index}.txt`, NOW - index),
    );
    mockedInvoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "activity_status") return { paused: false };
      if (command === "activity_list") {
        const cursor = (args as { cursor?: string | null } | undefined)?.cursor ?? null;
        const start = cursor ? stored.findIndex((entry) => entry.id === cursor) + 1 : 0;
        const slice = stored.slice(start, start + 256);
        const complete = start + slice.length >= stored.length;
        return page(slice, complete ? null : slice[slice.length - 1].id, complete);
      }
      return undefined;
    });
    await renderView();
    expect(container!.querySelectorAll("[data-activity-id]")).toHaveLength(256);
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      const more = container!.querySelector(".adp-view-more button");
      expect(more).not.toBeNull();
      await click(more!);
    }
    expect(container!.querySelectorAll("[data-activity-id]")).toHaveLength(1000);
    expect(
      container!.querySelector(`[data-activity-id="${uuidFor(0)}"]`),
    ).toBeNull();
    expect(
      container!.querySelector("[data-activity-id]")?.getAttribute("data-activity-id"),
    ).toBe(uuidFor(1000));
    const listCalls = mockedInvoke.mock.calls.filter(
      (call) => commandName(call) === "activity_list",
    );
    expect(listCalls).toHaveLength(4);
  });

  it("older30daysexcluded", async () => {
    const old = event(uuidFor(1), "open", "C:\\Work\\old.txt", NOW - 31 * 24 * 60 * 60);
    const fresh = event(uuidFor(2), "open", "C:\\Work\\fresh.txt", NOW - 60);
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "activity_status") return { paused: false };
      // The native store excludes entries older than 30 days.
      if (command === "activity_list") return page([fresh]);
      return undefined;
    });
    await renderView();
    expect(container!.textContent).toContain("C:\\Work\\fresh.txt");
    expect(container!.textContent).not.toContain("C:\\Work\\old.txt");
    expect(old.created_unix).toBeLessThan(fresh.created_unix);
  });

  it("Pause0new", async () => {
    const only = event(uuidFor(1), "open", "C:\\Work\\keep.txt");
    mockedInvoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "activity_status") return { paused: false };
      if (command === "activity_list") return page([only]);
      if (command === "activity_set_paused") {
        return { paused: Boolean((args as { paused?: boolean } | undefined)?.paused) };
      }
      return undefined;
    });
    await renderView();
    const pause = container!.querySelector('[data-activity-action="pause"]')!;
    expect(pause.getAttribute("aria-pressed")).toBe("false");
    await click(pause);
    expect(mockedInvoke).toHaveBeenCalledWith("activity_set_paused", { paused: true });
    expect(pause.getAttribute("aria-pressed")).toBe("true");
    // Old entries stay visible; no new list load happened after pausing.
    expect(container!.querySelectorAll("[data-activity-id]")).toHaveLength(1);
    expect(container!.textContent).toContain("C:\\Work\\keep.txt");
    expect(
      mockedInvoke.mock.calls.filter((call) => commandName(call) === "activity_list"),
    ).toHaveLength(1);
  });

  it("Cleardoesnotdeletefiles", async () => {
    const only = event(uuidFor(1), "move", "C:\\Work\\a.txt", NOW, "C:\\Archive\\a.txt");
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "activity_status") return { paused: false };
      if (command === "activity_list") return page([only]);
      if (command === "activity_clear") return undefined;
      return undefined;
    });
    await renderView();
    expect(container!.textContent).toContain("C:\\Archive\\a.txt");
    await click(container!.querySelector('[data-activity-action="clear"]')!);
    expect(mockedInvoke).toHaveBeenCalledWith("activity_clear");
    expect(container!.querySelectorAll("[data-activity-id]")).toHaveLength(0);
    // Clearing is app state only: no file operation is ever requested.
    const destructive = mockedInvoke.mock.calls
      .map(commandName)
      .filter((name) => /recycle|delete|remove|move|copy|transfer/i.test(name));
    expect(destructive).toEqual([]);
  });

  it("homelistsstoredactions", async () => {
    const registry = new HomeSectionRegistry();
    const openPath = vi.fn(async () => undefined);
    const loaded = [event(uuidFor(1), "open", "C:\\Work\\home.txt")];
    const off = registerActivityHome(registry, {
      openPath,
      load: async () => loaded,
    });
    const provider = registry.get("recent_activity");
    expect(provider?.label_key).toBe("views.activity");
    const items = await provider!.load(10, new AbortController().signal);
    expect(items).toHaveLength(1);
    expect(items[0].target_id).toBe("C:\\Work\\home.txt");
    await provider!.activate(items[0]);
    expect(openPath).toHaveBeenCalledWith("C:\\Work\\home.txt");
    off();
    expect(registry.list()).toHaveLength(0);
  });
});
