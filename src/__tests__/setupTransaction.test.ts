import { describe, expect, it, vi } from "vitest";
import type { SerializableViewState } from "../documents/types";
import {
  SetupPartRegistry,
  runSetupParts,
  type SetupPartAdapter,
  type SetupPartRun,
} from "../shell/SetupPartRegistry";
import {
  buildSetupHistoryState,
  recordSetupImport,
  registerSetupHistory,
  type SetupHistoryRegistry,
  type SetupHistoryState,
} from "../shell/setupHistory";
import type { SetupPart } from "../services/setups";

class FakeAdapter implements SetupPartAdapter {
  current: SerializableViewState = { value: "old" };
  previous: SerializableViewState = { value: "old" };
  staged: SerializableViewState | null = null;
  committed: SerializableViewState | null = null;
  failStage = false;
  failCommit = false;
  external = false;
  log: string[];

  constructor(readonly id: SetupPart, log: string[]) {
    this.log = log;
  }

  async read(): Promise<SerializableViewState> {
    return this.current;
  }

  validate(state: SerializableViewState): boolean {
    return state !== null && typeof state === "object";
  }

  async stage(state: SerializableViewState): Promise<void> {
    this.log.push(`stage:${this.id}`);
    if (this.failStage) throw new Error("setup.io");
    this.staged = state;
  }

  async commit(): Promise<void> {
    this.log.push(`commit:${this.id}`);
    if (this.failCommit) throw new Error("setup.io");
    this.previous = this.current;
    this.committed = this.staged;
    this.current = this.external ? { value: "external" } : this.staged!;
  }

  async rollback(): Promise<void> {
    this.log.push(`rollback:${this.id}`);
    if (this.external) throw new Error("setup.changed");
    if (this.committed !== null && JSON.stringify(this.current) !== JSON.stringify(this.committed)) {
      throw new Error("setup.changed");
    }
    this.current = this.previous;
    this.staged = null;
    this.committed = null;
  }
}

const PART_IDS: SetupPart[] = ["theme", "layout", "keyboard"];
const run = (id: SetupPart, value: string): SetupPartRun => ({ id, state: { value } });

function registryWith(log: string[], failAt = -1, externalTheme = false) {
  const registry = new SetupPartRegistry();
  const adapters = new Map<SetupPart, FakeAdapter>();
  PART_IDS.forEach((id, index) => {
    const adapter = new FakeAdapter(id, log);
    adapter.failCommit = index === failAt;
    adapter.external = id === "theme" && externalTheme;
    adapters.set(id, adapter);
    registry.register(id, adapter);
  });
  return { registry, adapters };
}

describe("setup transaction", () => {
  it("failureaftereachpartrollsbackreverse: fails after each part and rolls the written prefix back in reverse", async () => {
    for (let failAt = 0; failAt < PART_IDS.length; failAt += 1) {
      const log: string[] = [];
      const { registry, adapters } = registryWith(log, failAt);
      const publish = vi.fn();
      await expect(
        runSetupParts(
          registry,
          PART_IDS.map((id) => run(id, `new-${id}`)),
          { reserveHistory: () => undefined, publish },
        ),
      ).rejects.toThrow("setup.io");
      const rollbacks = log.filter((line) => line.startsWith("rollback:"));
      const expected = PART_IDS.slice(0, failAt + 1)
        .reverse()
        .map((id) => `rollback:${id}`);
      expect(rollbacks).toEqual(expected);
      for (const id of PART_IDS) {
        expect(adapters.get(id)!.current).toEqual({ value: "old" });
      }
      expect(publish).not.toHaveBeenCalled();
    }
  });

  it("externallychangedconfigretainedwithrecovery: retains an externally changed configuration with recovery", async () => {
    const log: string[] = [];
    const { registry, adapters } = registryWith(log, 1, true);
    const publish = vi.fn();
    await expect(
      runSetupParts(
        registry,
        PART_IDS.map((id) => run(id, `new-${id}`)),
        { reserveHistory: () => undefined, publish },
      ),
    ).rejects.toThrow("setup.recovery_required");
    expect(adapters.get("theme")!.current).toEqual({ value: "external" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("UIpublishesonceaftercommit: publishes exactly one committed configuration", async () => {
    const log: string[] = [];
    const { registry } = registryWith(log);
    const publish = vi.fn();
    const applied = await runSetupParts(
      registry,
      [run("keyboard", "k"), run("theme", "t"), run("layout", "l")],
      { reserveHistory: () => undefined, publish },
    );
    expect(applied).toEqual(["theme", "layout", "keyboard"]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(["theme", "layout", "keyboard"]);
  });

  it("historylimitbeforewrite: fails on history capacity before any part is staged", async () => {
    const log: string[] = [];
    const { registry } = registryWith(log);
    const fakeHistory: SetupHistoryRegistry = {
      registerAdapter: () => undefined,
      record: () => {
        throw new Error("ui_history.limit");
      },
      apply: async () => undefined,
      releaseUnreferenced: () => undefined,
    };
    const publish = vi.fn();
    await expect(
      runSetupParts(registry, [run("theme", "t")], {
        reserveHistory: () =>
          recordSetupImport(
            [{ id: "theme", before: { value: "old" }, after: { value: "t" } }],
            fakeHistory,
          ),
        publish,
      }),
    ).rejects.toThrow("ui_history.limit");
    expect(log).not.toContain("stage:theme");
    expect(publish).not.toHaveBeenCalled();
  });

  it("keeps one validated history record and one atomic restore", async () => {
    const captured: {
      adapter?: { validate(state: SerializableViewState): boolean; apply(state: SerializableViewState): Promise<void> };
    } = {};
    const registry: SetupHistoryRegistry = {
      registerAdapter: (_id, value) => {
        captured.adapter = value;
      },
      record: () => "00000000-0000-4000-a000-000000000001",
      apply: async () => undefined,
      releaseUnreferenced: () => undefined,
    };
    const applyState = vi.fn(async (state: SetupHistoryState) => {
      void state;
    });
    registerSetupHistory(applyState, registry);
    const state = buildSetupHistoryState("after", [
      { id: "layout", state: { value: "l" } },
      { id: "theme", state: { value: "t" } },
    ]);
    expect(captured.adapter!.validate(state)).toBe(true);
    await captured.adapter!.apply(state);
    expect(applyState).toHaveBeenCalledTimes(1);
    expect(applyState.mock.calls[0][0].parts.map((part) => part.id)).toEqual(["theme", "layout"]);
  });

  it("refuses a second adapter for the same part", () => {
    const registry = new SetupPartRegistry();
    const log: string[] = [];
    registry.register("theme", new FakeAdapter("theme", log));
    expect(() => registry.register("theme", new FakeAdapter("theme", log))).toThrow("catalog.invalid");
  });
});
