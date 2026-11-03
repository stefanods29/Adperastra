import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/jobs", () => ({ runJob: vi.fn() }));
vi.mock("../services/cache", () => ({ releaseCacheLease: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { releaseCacheLease } from "../services/cache";
import type { JobHandle } from "../services/jobs";
import { runJob } from "../services/jobs";
import {
  isThumbnailFile,
  newThumbnailConsumerId,
  releaseThumbnail,
  requestThumbnail,
  resetThumbnailServiceForTests,
  thumbnailEdgeFor,
  type ThumbnailReply,
} from "../services/thumbnails";

const lease = {
  lease_id: "11111111-1111-4111-8111-111111111111",
  token: "a".repeat(32),
  name: "thumbnail.png",
  mime: "image/png",
  byte_len: 120,
};

function handle(reply: ThumbnailReply): JobHandle<ThumbnailReply> {
  return {
    id: "thumb-1",
    cancel: vi.fn(async () => undefined),
    completion: Promise.resolve(reply),
  };
}

function request(consumer: string, path = "C:\\Pictures\\a.png") {
  return { path, edge: 128 as const, consumer_id: consumer };
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(runJob).mockReset();
  vi.mocked(releaseCacheLease).mockReset();
  vi.mocked(releaseCacheLease).mockResolvedValue(undefined);
  resetThumbnailServiceForTests();
});

describe("thumbnail service coalescing", () => {
  it("two consumers of one key start one helper and release independently", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "thumbnail_lookup") return null;
      return undefined;
    });
    const ready = handle({ state: "ready", lease });
    vi.mocked(runJob).mockImplementation(async (_prefix, start) => {
      await start("thumb-1");
      return ready;
    });

    const first = newThumbnailConsumerId();
    const second = newThumbnailConsumerId();
    const one = await requestThumbnail(request(first));
    const two = await requestThumbnail(request(second));
    expect(one.id).toBe(two.id);
    expect(runJob).toHaveBeenCalledTimes(1);
    await Promise.resolve();

    await releaseThumbnail(first);
    expect(invoke).not.toHaveBeenCalledWith("thumbnail_release", expect.anything());

    await releaseThumbnail(second);
    expect(ready.cancel).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("thumbnail_release", { consumerId: first });
    expect(releaseCacheLease).toHaveBeenCalledWith(lease.lease_id);
  });

  it("a cache hit starts no job and releases its lease once", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "thumbnail_lookup") return { state: "ready", lease };
      return undefined;
    });
    const consumer = newThumbnailConsumerId();
    const result = await requestThumbnail(request(consumer));
    await expect(result.completion).resolves.toMatchObject({ state: "ready" });
    expect(runJob).not.toHaveBeenCalled();

    await releaseThumbnail(consumer);
    expect(releaseCacheLease).toHaveBeenCalledTimes(1);
    expect(releaseCacheLease).toHaveBeenCalledWith(lease.lease_id);
    await releaseThumbnail(consumer);
    expect(releaseCacheLease).toHaveBeenCalledTimes(1);
  });

  it("an online-only reply keeps the fallback and never starts a helper", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "thumbnail_lookup") return { state: "online_only" };
      return undefined;
    });
    const consumer = newThumbnailConsumerId();
    const result = await requestThumbnail(request(consumer));
    await expect(result.completion).resolves.toEqual({ state: "online_only" });
    expect(runJob).not.toHaveBeenCalled();
    await releaseThumbnail(consumer);
    expect(releaseCacheLease).not.toHaveBeenCalled();
  });
});

describe("thumbnail release races", () => {
  it("observes completion and releases a ready result when its consumer leaves during start", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) =>
      command === "thumbnail_lookup" ? null : undefined);
    let started!: (value: JobHandle<ThumbnailReply>) => void;
    vi.mocked(runJob).mockReturnValue(new Promise((resolve) => { started = resolve; }));
    const consumer = newThumbnailConsumerId();
    const pending = requestThumbnail(request(consumer));
    const rejected = expect(pending).rejects.toThrow("background.cancelled");
    await vi.waitFor(() => expect(runJob).toHaveBeenCalledTimes(1));
    await releaseThumbnail(consumer);
    started(handle({ state: "ready", lease }));
    await rejected;
    await vi.waitFor(() => expect(releaseCacheLease).toHaveBeenCalledTimes(1));
    expect(releaseCacheLease).toHaveBeenCalledWith(lease.lease_id);
  });

  it("releases a result that arrives after its final consumer left", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) =>
      command === "thumbnail_lookup" ? null : undefined);
    let finish!: (reply: ThumbnailReply) => void;
    const completion = new Promise<ThumbnailReply>((resolve) => { finish = resolve; });
    vi.mocked(runJob).mockResolvedValue({ id: "late", completion, cancel: vi.fn(async () => undefined) });
    const consumer = newThumbnailConsumerId();
    await requestThumbnail(request(consumer));
    await releaseThumbnail(consumer);
    expect(releaseCacheLease).not.toHaveBeenCalled();
    finish({ state: "ready", lease });
    await completion;
    await Promise.resolve();
    expect(releaseCacheLease).toHaveBeenCalledTimes(1);
    expect(releaseCacheLease).toHaveBeenCalledWith(lease.lease_id);
  });
});

describe("thumbnail helpers", () => {
  it("picks the smallest edge at least the displayed size", () => {
    expect(thumbnailEdgeFor(48, 1)).toBe(64);
    expect(thumbnailEdgeFor(48, 1.25)).toBe(64);
    expect(thumbnailEdgeFor(96, 1.25)).toBe(128);
    expect(thumbnailEdgeFor(256, 1.5)).toBe(256);
    expect(thumbnailEdgeFor(20, 1)).toBe(64);
  });

  it("claims only the WIC picture types", () => {
    expect(isThumbnailFile("photo.JPG")).toBe(true);
    expect(isThumbnailFile("scan.tiff")).toBe(true);
    expect(isThumbnailFile("notes.txt")).toBe(false);
    expect(isThumbnailFile("folder")).toBe(false);
    expect(isThumbnailFile(".gitignore")).toBe(false);
  });

  it("creates UUID consumer IDs", () => {
    const value = newThumbnailConsumerId();
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
