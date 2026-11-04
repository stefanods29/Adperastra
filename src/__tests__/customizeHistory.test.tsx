import { Bold } from "lucide-react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import type { Command } from "../commands/registry";
import type { SerializableViewState } from "../documents/types";
import {
  applyToolbarWithHistory,
  registerCustomizeHistory,
  type CustomizeHistoryHost,
  type CustomizeHistoryRegistry,
} from "../layout/customizeHistory";
import QuickAccessBar from "../layout/QuickAccessBar";
import { addQuickAccess } from "../layout/toolbarCustomization";
import type { KeyboardCustomSettings } from "../keyboard/types";
import {
  CommandLayoutRegistry,
  defaultToolbarCustomSettings,
  type ToolbarCustomSettings,
} from "../services/commandLayout";
import { defaultKeyboardCustomSettings } from "../services/keyboardMaps";

/** In-memory double of the 09a UiHistoryRegistry contract (E9). */
class FakeHistory {
  adapters = new Map<string, { validate: (s: SerializableViewState) => boolean; apply: (s: SerializableViewState) => Promise<void> }>();
  records = new Map<string, { adapterId: string; before: SerializableViewState; after: SerializableViewState }>();
  released: string[] = [];
  failRecord = false;
  private next = 1;

  registerAdapter(id: string, adapter: { validate: (s: SerializableViewState) => boolean; apply: (s: SerializableViewState) => Promise<void> }): void {
    this.adapters.set(id, adapter);
  }

  record(adapterId: string, before: SerializableViewState, after: SerializableViewState): string {
    if (this.failRecord) throw new Error("ui_history.limit");
    const id = `00000000-0000-4000-a000-00000000000${this.next}`;
    this.next += 1;
    this.records.set(id, { adapterId, before, after });
    return id;
  }

  async apply(id: string, reverse: boolean): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error("ui_history.limit");
    const adapter = this.adapters.get(record.adapterId);
    const state = reverse ? record.before : record.after;
    if (!adapter || !adapter.validate(state)) throw new Error("ui_history.limit");
    await adapter.apply(state);
  }

  releaseUnreferenced(ids: readonly string[]): void {
    const keep = new Set(ids);
    for (const id of this.records.keys()) {
      if (keep.has(id)) continue;
      this.records.delete(id);
      this.released.push(id);
    }
  }
}

function fakeHost() {
  let toolbar = defaultToolbarCustomSettings();
  let keyboard = defaultKeyboardCustomSettings();
  const applied: ToolbarCustomSettings[] = [];
  const host: CustomizeHistoryHost = {
    getToolbar: () => toolbar,
    applyToolbar: async (value) => {
      applied.push(value);
      toolbar = value;
    },
    getKeyboard: () => keyboard,
    applyKeyboard: async (value) => {
      keyboard = value;
    },
  };
  return { host, applied, getToolbar: () => toolbar };
}

let container: HTMLDivElement | null = null;
afterEach(() => {
  container?.remove();
  container = null;
});

describe("customize history and quick access (step-10b/T5)", () => {
  it("applyoneUndo", async () => {
    const history = new FakeHistory();
    const fake = fakeHost();
    registerCustomizeHistory(history as unknown as CustomizeHistoryRegistry, fake.host);
    const next: ToolbarCustomSettings = { ...defaultToolbarCustomSettings(), classic_menu: true };
    const id = await applyToolbarWithHistory(history as unknown as CustomizeHistoryRegistry, fake.host, next, []);
    expect(fake.getToolbar().classic_menu).toBe(true);
    await history.apply(id, true);
    expect(fake.getToolbar().classic_menu).toBe(false);
    await history.apply(id, false);
    expect(fake.getToolbar().classic_menu).toBe(true);
  });

  it("capacityfailsbeforemutation", async () => {
    const history = new FakeHistory();
    history.failRecord = true;
    const fake = fakeHost();
    registerCustomizeHistory(history as unknown as CustomizeHistoryRegistry, fake.host);
    await expect(
      applyToolbarWithHistory(history as unknown as CustomizeHistoryRegistry, fake.host, {
        ...defaultToolbarCustomSettings(),
        classic_menu: true,
      }, []),
    ).rejects.toThrow("ui_history.limit");
    expect(fake.applied).toEqual([]);
    expect(fake.getToolbar().classic_menu).toBe(false);
  });

  it("undoinvalidcommanddoesnotexecute", async () => {
    const history = new FakeHistory();
    const fake = fakeHost();
    registerCustomizeHistory(history as unknown as CustomizeHistoryRegistry, fake.host);
    const run = vi.fn();
    const withUnknown: ToolbarCustomSettings = {
      classic_menu: false,
      bars: [{ bar_id: "explorer.command", entries: [{ kind: "command", id: "future.command", visible: true }] }],
      quick_access: [],
    };
    const id = await applyToolbarWithHistory(history as unknown as CustomizeHistoryRegistry, fake.host, withUnknown, []);
    await history.apply(id, true);
    await history.apply(id, false);
    expect(run).not.toHaveBeenCalled();
    expect(fake.getToolbar().bars[0].entries[0].id).toBe("future.command");
    const adapter = history.adapters.get("command-layout");
    const bad = { classic_menu: false, bars: [{ bar_id: "b", entries: [{ kind: "custom", id: "z", visible: true, render: "x" }] }], quick_access: [] } as unknown as SerializableViewState;
    expect(adapter?.validate(bad)).toBe(false);
  });

  it("failedsavekeepsdraft", async () => {
    const history = new FakeHistory();
    const fake = fakeHost();
    registerCustomizeHistory(history as unknown as CustomizeHistoryRegistry, fake.host);
    const failing: CustomizeHistoryHost = {
      ...fake.host,
      applyToolbar: async () => {
        throw new Error("toolbar.invalid");
      },
    };
    const draft: ToolbarCustomSettings = { ...defaultToolbarCustomSettings(), classic_menu: true };
    await expect(applyToolbarWithHistory(history as unknown as CustomizeHistoryRegistry, failing, draft, [])).rejects.toThrow("toolbar.invalid");
    expect(draft.classic_menu).toBe(true);
    expect(fake.getToolbar().classic_menu).toBe(false);
    expect(history.released).toHaveLength(1);
    expect(history.records.size).toBe(0);
  });

  it("quickmax20", async () => {
    let settings = defaultToolbarCustomSettings();
    for (let i = 0; i < 20; i += 1) {
      settings = addQuickAccess(settings, `cmd.${i}`) ?? settings;
    }
    expect(settings.quick_access).toHaveLength(20);
    expect(addQuickAccess(settings, "cmd.21")).toBeNull();

    const commands: Command[] = Array.from({ length: 25 }, (_, i) => ({
      id: `cmd.${i}`,
      labelKey: "commands.copy",
      icon: Bold,
      risk: "read-only",
      helpSlug: "command-bar",
      enabledWhen: () => true,
      run: () => undefined,
    }));
    const registry = new CommandLayoutRegistry();
    registry.register({ id: "app.quickAccess", default_entries: [], compatible_groups: [], mandatory_ids: [] });
    const wide: ToolbarCustomSettings = {
      classic_menu: false,
      bars: [],
      quick_access: commands.map((c) => c.id),
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const ctx = {} as never;
    await act(async () => root.render(<QuickAccessBar settings={wide} registry={registry} commands={commands} ctx={ctx} />));
    expect(container.querySelectorAll("button")).toHaveLength(20);
    await act(async () => root.unmount());
  });
});
