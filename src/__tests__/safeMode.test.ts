import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() =>
  vi.fn(async (command: string, _args?: unknown) => {
    if (command === "safe_mode_status") {
      return {
        active: true,
        reason: "repeated_startup_failure",
        failed_starts: 3,
        settings_read_only: true,
      };
    }
    return null;
  }),
);

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));

import { registerRestartGuard, restartNormally, safeModeStatus } from "../services/recovery";

beforeEach(() => {
  invoke.mockClear();
  registerRestartGuard(null);
});

describe("safe-mode restart", () => {
  it("reports the native status", async () => {
    const status = await safeModeStatus();
    expect(status.active).toBe(true);
    expect(status.failed_starts).toBe(3);
    expect(status.settings_read_only).toBe(true);
  });

  it("awaits a cancelled dirty decision and never restarts", async () => {
    const guard = vi.fn(async () => false);
    registerRestartGuard(guard);
    await expect(restartNormally()).rejects.toThrow("app.close_cancelled");
    expect(guard).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls.some((call) => call[0] === "restart_normal")).toBe(false);
  });

  it("restarts only after the dirty decision accepted", async () => {
    const order: string[] = [];
    const guard = vi.fn(async () => {
      order.push("dirty");
      return true;
    });
    invoke.mockImplementation(async (command: string) => {
      if (command === "restart_normal") order.push("restart");
      return null;
    });
    registerRestartGuard(guard);
    await restartNormally();
    expect(order).toEqual(["dirty", "restart"]);
  });
});
