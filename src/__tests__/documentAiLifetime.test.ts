import { expect, it, vi } from "vitest";
import { DocumentAiLifetime } from "../office/document/ai/documentAiLifetime";

it("obsolete_job_is_cancelled_and_not_retained", async () => {
  const lifetime = new DocumentAiLifetime();
  const old = lifetime.current();
  await lifetime.invalidate();
  const cancel = vi.fn(async () => undefined);
  expect(await lifetime.retainJob(old, { id: "old", cancel, completion: Promise.resolve("old result") })).toBe(false);
  expect(cancel).toHaveBeenCalledOnce();
  expect(lifetime.isCurrent(old)).toBe(false);
  expect(lifetime.isCurrent(lifetime.current())).toBe(true);
});
it("release_retries_failed_cleanup_only", async () => {
  const lifetime = new DocumentAiLifetime();
  const first = vi.fn(async () => undefined);
  const second = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(undefined);
  await lifetime.retainRelease(first);
  await lifetime.retainRelease(second);
  await expect(lifetime.release()).rejects.toThrow("document_ai.failed");
  await lifetime.release();
  await lifetime.release();
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledTimes(2);
});
it("late_failed_acquisition_cleanup_is_retained", async () => {
  const lifetime = new DocumentAiLifetime();
  await lifetime.release();
  const cleanup = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(undefined);
  await expect(lifetime.retainRelease(cleanup)).rejects.toThrow("busy");
  await lifetime.release();
  expect(cleanup).toHaveBeenCalledTimes(2);
});
