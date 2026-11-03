import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));

import { invoke } from "@tauri-apps/api/core";
import { subscribeBackgroundEligible } from "../services/background";

const stops: Array<() => void> = [];
beforeEach(() => { vi.useFakeTimers(); vi.mocked(invoke).mockReset(); });
afterEach(() => { stops.splice(0).forEach((stop) => stop()); vi.useRealTimers(); });

describe("shared paused-preview eligibility", () => {
  it("uses one poll for many views and notifies once when idle or power permits work", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ eligible: false }).mockResolvedValue({ eligible: true });
    const first = vi.fn(), second = vi.fn();
    stops.push(subscribeBackgroundEligible(first), subscribeBackgroundEligible(second));
    await vi.advanceTimersByTimeAsync(1000);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("stops polling after the last view leaves and ignores an in-flight late result", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(invoke).mockReturnValue(new Promise((done) => { resolve = done; }));
    const notify = vi.fn();
    const stop = subscribeBackgroundEligible(notify);
    stops.push(stop);
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    resolve({ eligible: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(notify).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("recovers from a failed status request without an unhandled rejection", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("background.unavailable").mockResolvedValue({ eligible: true });
    const notify = vi.fn();
    stops.push(subscribeBackgroundEligible(notify));
    await vi.advanceTimersByTimeAsync(2000);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
