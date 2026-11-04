import { describe, expect, it } from "vitest";
import {
  acceptsSearchWatchEvent,
  registerSearchWatch,
  searchWatchNeedsReload,
  unregisterSearchWatch,
  type SearchWatchEvent,
  type SearchWatchState,
} from "../search/indexWatch";

const event = (overrides: Partial<SearchWatchEvent> = {}): SearchWatchEvent => ({
  subscription_id: "one",
  root: "C:\\Docs",
  generation: 1,
  kind: "change",
  path: "C:\\Docs\\a.txt",
  ...overrides,
});

describe("search watch routing", () => {
  it("ignores an event from an old generation", () => {
    let state: SearchWatchState = { subscriptions: {} };
    state = registerSearchWatch(state, "one", "C:\\Docs", 2);
    expect(acceptsSearchWatchEvent(state, event({ generation: 1 }))).toBe(false);
    expect(acceptsSearchWatchEvent(state, event({ generation: 2 }))).toBe(true);
  });

  it("removing one subscription leaves the other tab watching", () => {
    let state = registerSearchWatch({ subscriptions: {} }, "one", "C:\\One", 1);
    state = registerSearchWatch(state, "two", "C:\\Two", 1);
    state = unregisterSearchWatch(state, "one");
    expect(acceptsSearchWatchEvent(state, event({ subscription_id: "one" }))).toBe(false);
    expect(
      acceptsSearchWatchEvent(state, event({ subscription_id: "two", path: "C:\\Two\\b.txt" })),
    ).toBe(true);
  });

  it("overflow and an unpaired rename reload the first page", () => {
    expect(searchWatchNeedsReload(event({ kind: "overflow" }))).toBe(true);
    expect(searchWatchNeedsReload(event({ kind: "rename", old_path: null }))).toBe(true);
    expect(
      searchWatchNeedsReload(event({ kind: "rename", old_path: "C:\\Docs\\a.txt" })),
    ).toBe(false);
  });

  it("an error event never refreshes a page", () => {
    const state = registerSearchWatch({ subscriptions: {} }, "one", "C:\\Docs", 1);
    expect(acceptsSearchWatchEvent(state, event({ kind: "error" }))).toBe(false);
  });
});
