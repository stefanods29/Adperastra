import { describe, expect, it } from "vitest";
import {
  ProfileSwitchCoordinator,
  type ProfileSwitchDependencies,
} from "../profiles/ProfileSwitchCoordinator";
import type { ProfileSwitchPlan } from "../services/profiles";

const TARGET = "9f1a2b3c-4d5e-4f60-8a7b-1c2d3e4f5a6b";
const PLAN: ProfileSwitchPlan = {
  plan_id: "7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
  target_id: TARGET,
  catalog_revision: 3,
  needs_dirty_prompt: true,
  active_job_ids: [],
  expires_unix: 2_000_000_000,
};

function dependencies(calls: string[], overrides: Partial<ProfileSwitchDependencies> = {}): ProfileSwitchDependencies {
  return {
    confirmDirty: async () => {
      calls.push("dirty");
      return true;
    },
    activeJobIds: async () => {
      calls.push("jobs");
      return [];
    },
    cancelJobs: async (ids) => {
      calls.push(`cancel:${ids.join(",")}`);
      return true;
    },
    lockSensitiveContainers: async () => {
      calls.push("lock");
    },
    flushState: async () => {
      calls.push("flush");
    },
    requestRestart: async () => {
      calls.push("restart");
    },
    prepare: async (targetId) => {
      calls.push(`prepare:${targetId}`);
      return PLAN;
    },
    commit: async (planId) => {
      calls.push(`commit:${planId}`);
    },
    nowUnix: () => 1_900_000_000,
    ...overrides,
  };
}

describe("ProfileSwitchCoordinator", () => {
  it("changes nothing when the dirty decision is cancelled", async () => {
    const calls: string[] = [];
    const coordinator = new ProfileSwitchCoordinator(
      dependencies(calls, {
        confirmDirty: async () => {
          calls.push("dirty");
          return false;
        },
      }),
    );
    await expect(coordinator.switchTo(TARGET)).resolves.toBe(false);
    expect(calls).toEqual(["dirty"]);
  });

  it("refuses while a job cannot finish or cancel", async () => {
    const calls: string[] = [];
    const coordinator = new ProfileSwitchCoordinator(
      dependencies(calls, {
        activeJobIds: async () => {
          calls.push("jobs");
          return ["job-1"];
        },
        cancelJobs: async () => {
          calls.push("cancel");
          return false;
        },
      }),
    );
    await expect(coordinator.switchTo(TARGET)).rejects.toThrow("profiles.busy");
    expect(calls).toEqual(["dirty", "jobs", "cancel"]);
  });

  it("keeps the active profile when flushing fails", async () => {
    const calls: string[] = [];
    const coordinator = new ProfileSwitchCoordinator(
      dependencies(calls, {
        flushState: async () => {
          calls.push("flush");
          throw new Error("profiles.io");
        },
      }),
    );
    await expect(coordinator.switchTo(TARGET)).rejects.toThrow("profiles.io");
    expect(calls).toEqual(["dirty", "jobs", "lock", "flush"]);
    expect(calls).not.toContain("restart");
  });

  it("makes the pending id durable before asking for a restart", async () => {
    const calls: string[] = [];
    let durable = false;
    const coordinator = new ProfileSwitchCoordinator(
      dependencies(calls, {
        commit: async (planId) => {
          calls.push(`commit:${planId}`);
          durable = true;
        },
        requestRestart: async () => {
          calls.push("restart");
          expect(durable).toBe(true);
        },
      }),
    );
    await expect(coordinator.switchTo(TARGET)).resolves.toBe(true);
    expect(calls).toEqual([
      "dirty",
      "jobs",
      "lock",
      "flush",
      `prepare:${TARGET}`,
      `commit:${PLAN.plan_id}`,
      "restart",
    ]);
  });

  it("locks every container before any catalog write", async () => {
    const calls: string[] = [];
    const coordinator = new ProfileSwitchCoordinator(dependencies(calls));
    await coordinator.switchTo(TARGET);
    expect(calls.indexOf("lock")).toBeLessThan(calls.indexOf(`prepare:${TARGET}`));
    expect(calls.indexOf("lock")).toBeLessThan(calls.indexOf(`commit:${PLAN.plan_id}`));
    expect(calls.filter((call) => call === "lock")).toHaveLength(1);
  });

  it("failed target startup or commit retains the last profile and skips restart", async () => {
    const calls: string[] = [];
    const coordinator = new ProfileSwitchCoordinator(
      dependencies(calls, {
        commit: async () => {
          calls.push("commit");
          throw new Error("profiles.io");
        },
      }),
    );
    await expect(coordinator.switchTo(TARGET)).rejects.toThrow("profiles.io");
    expect(calls).not.toContain("restart");
  });

  it("refuses a stale plan revision or expiry before committing", async () => {
    const staleCalls: string[] = [];
    const wrongTarget = new ProfileSwitchCoordinator(
      dependencies(staleCalls, {
        prepare: async () => ({ ...PLAN, target_id: "default" }),
      }),
    );
    await expect(wrongTarget.switchTo(TARGET)).rejects.toThrow("profiles.changed");

    const expiredCalls: string[] = [];
    const expired = new ProfileSwitchCoordinator(
      dependencies(expiredCalls, {
        prepare: async () => ({ ...PLAN, expires_unix: 1 }),
        nowUnix: () => 2,
      }),
    );
    await expect(expired.switchTo(TARGET)).rejects.toThrow("profiles.changed");
    expect(staleCalls).not.toContain("commit");
    expect(expiredCalls).not.toContain("commit");
  });
});
