import { describe, expect, it, vi } from "vitest";
import { TabHistory } from "../services/tabHistory";
import { UiHistoryRegistry } from "../services/uiHistory";
import type { SessionData } from "../services/tabs";

const session = (active: string): SessionData => ({
  schema_version: 2,
  tabs: [{ id: "explorer", kind: "explorer" }],
  active_tab: active,
  saved_unix: 1,
  history: ["explorer"],
});

describe("ui and tab history (E9/E10)", () => {
  it("record_delegates_to_the_tabs_adapter_and_returns_an_ui_state_entry", async () => {
    UiHistoryRegistry.clear();
    const applied: unknown[] = [];
    UiHistoryRegistry.registerAdapter("tabs", {
      validate: () => true,
      apply: async (state) => {
        applied.push(state);
      },
    });
    const entry = TabHistory.record(session("explorer"), session("explorer"), "tabs.pin", undefined);
    expect(entry.undo).toMatchObject({ type: "uiState", reverse: true });
    expect(entry.redo).toMatchObject({ type: "uiState", reverse: false });
    const id = (entry.undo as { id: string }).id;
    await TabHistory.apply(id, true);
    expect(applied).toHaveLength(1);
    UiHistoryRegistry.clear();
  });

  it("failing_restore_rejects_so_the_cursor_stays_unchanged", async () => {
    UiHistoryRegistry.clear();
    UiHistoryRegistry.registerAdapter("tabs", {
      validate: () => true,
      apply: async () => {
        throw new Error("tabs.invalid_state");
      },
    });
    const entry = TabHistory.record(session("explorer"), session("explorer"), "tabs.pin", undefined);
    const id = (entry.undo as { id: string }).id;
    await expect(TabHistory.apply(id, true)).rejects.toThrow("tabs.invalid_state");
    UiHistoryRegistry.clear();
  });

  it("retained_capacity_refuses_without_dropping_entries", () => {
    UiHistoryRegistry.clear();
    UiHistoryRegistry.registerAdapter("tabs", { validate: () => true, apply: async () => undefined });
    // One state above the 4 MiB per-state cap is refused even though the
    // retained one-record history still has room in its 16 MiB budget.
    const big = { blob: "x".repeat(5 * 1024 * 1024) };
    TabHistory.record(session("explorer"), session("explorer"), "tabs.pin", undefined);
    expect(() => UiHistoryRegistry.record("tabs", big as never, big as never)).toThrow("ui_history.limit");
    expect(UiHistoryRegistry.size).toBe(1);
    UiHistoryRegistry.clear();
  });

  it("release_unreferenced_drops_only_unkept_records", () => {
    UiHistoryRegistry.clear();
    const apply = vi.fn(async () => undefined);
    UiHistoryRegistry.registerAdapter("tabs", { validate: () => true, apply });
    const first = TabHistory.record(session("explorer"), session("explorer"), "tabs.pin", undefined);
    TabHistory.record(session("explorer"), session("explorer"), "tabs.pin", undefined);
    expect(UiHistoryRegistry.size).toBe(2);
    TabHistory.releaseUnreferenced([(first.undo as { id: string }).id]);
    expect(UiHistoryRegistry.size).toBe(1);
    UiHistoryRegistry.clear();
  });
});
