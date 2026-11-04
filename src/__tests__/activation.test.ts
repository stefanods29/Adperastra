import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activationReady, onOpenRequest } from "../services/activation";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));

type Handler = (event: { payload: unknown }) => void;

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const unlisten = vi.fn();

let handler: Handler | null = null;

const ID_ONE = "0f2f6a8e-7b1c-4d3a-9e5f-1a2b3c4d5e6f";
const ID_TWO = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ID_THREE = "11111111-2222-4333-8444-555555555555";
const ID_FOUR = "22222222-3333-4444-8555-666666666666";
const ID_FIVE = "33333333-4444-4555-8666-777777777777";
const ID_SIX = "44444444-5555-4666-8777-888888888888";
const ID_SEVEN = "55555555-6666-4777-8888-999999999999";
const ID_EIGHT = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const ID_NINE = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    request_id: ID_ONE,
    paths: ["C:\\Users\\Public\\alpha.txt"],
    sent_unix: 1_800_000_000,
    ...overrides,
  };
}

function emit(payload: unknown): void {
  handler?.({ payload });
}

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  unlisten.mockReset();
  handler = null;
  listenMock.mockImplementation((async (_event: string, callback: Handler) => {
    handler = callback;
    return unlisten;
  }) as never);
});

describe("activation service", () => {
  it("delivers a valid request once", async () => {
    const listener = vi.fn();
    await onOpenRequest(listener);
    expect(listenMock).toHaveBeenCalledWith("activation-open", expect.any(Function));

    emit(request({ request_id: ID_ONE }));
    emit(request({ request_id: ID_ONE }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        request_id: ID_ONE,
        paths: ["C:\\Users\\Public\\alpha.txt"],
        sent_unix: 1_800_000_000,
      }),
    );
  });

  it("drops malformed requests before any listener runs", async () => {
    const listener = vi.fn();
    await onOpenRequest(listener);

    emit(request({ request_id: ID_TWO, paths: ["alpha.txt"] }));
    emit(request({ request_id: ID_THREE, paths: [] }));
    emit(request({ request_id: ID_FOUR, version: 2 }));
    emit(request({ request_id: ID_FIVE, sent_unix: 1.5 }));
    emit(request({ request_id: "not-a-uuid" }));
    emit({ ...request({ request_id: ID_SIX }), working_directory: "C:\\Windows" });
    emit(request({ request_id: ID_SEVEN, paths: Array.from({ length: 257 }, (_, index) => `C:\\f${index}.txt`) }));

    expect(listener).not.toHaveBeenCalled();
  });

  it("carries the fixed intent and drops unknown verbs", async () => {
    const listener = vi.fn();
    await onOpenRequest(listener);

    emit(request({ request_id: ID_FOUR, intent: "convert" }));
    emit(request({ request_id: ID_FIVE, intent: "convert_all" }));
    emit(request({ request_id: ID_SIX, intent: undefined }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toEqual(
      expect.objectContaining({ request_id: ID_FOUR, intent: "convert" }),
    );
  });

  it("drains the startup queue and deduplicates by request id", async () => {
    invokeMock.mockResolvedValue([
      request({ request_id: ID_EIGHT, intent: "convert" }),
    ]);
    const first = await activationReady();
    expect(invokeMock).toHaveBeenCalledWith("activation_ready");
    expect(first).toHaveLength(1);
    expect(first[0].request_id).toBe(ID_EIGHT);
    expect(first[0].intent).toBe("convert");
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(first[0].paths)).toBe(true);

    const second = await activationReady();
    expect(second).toEqual([]);
  });

  it("filters invalid queue entries instead of failing the handshake", async () => {
    invokeMock.mockResolvedValue([
      request({ request_id: ID_NINE }),
      { garbage: true },
      request({ request_id: ID_TWO, paths: ["relative.txt"] }),
      request({ request_id: ID_THREE, sent_unix: Number.MAX_SAFE_INTEGER + 1 }),
    ]);
    const ready = await activationReady();
    expect(ready.map((item) => item.request_id)).toEqual([ID_NINE]);
  });
});
