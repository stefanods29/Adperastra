import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMetadata, metadataConsumerId } from "../metadata/useMetadata";
import { readMetadata, releaseMetadata, type MetadataInfo } from "../services/metadata";
import type { JobHandle } from "../services/jobs";
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));
vi.mock("../services/metadata", () => ({ readMetadata: vi.fn(), releaseMetadata: vi.fn(async () => undefined) }));
const read = vi.mocked(readMetadata), release = vi.mocked(releaseMetadata);
let root: Root | null = null, host: HTMLDivElement | null = null;
const done = (): MetadataInfo => ({ source: { path_key: "c:\\a.jpg", volume_id: "00000001", file_id: "0000000000000001", modified_ticks: "1", size_bytes: 1 }, fields: [], partial: false, missing: [] });
function Probe({ revision, active = true }: { revision?: object; active?: boolean }) {
  const state = useMetadata("C:\\a.jpg", active, revision);
  return <span>{state.status}</span>;
}
async function mount(node: React.ReactNode) { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); await act(async () => root!.render(node)); }
async function tick() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 170)); }); }
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null; host?.remove(); host = null; read.mockReset(); release.mockClear(); });
describe("metadata lifetime", () => {
  it("observes a late rejected completion and releases again after acknowledgement", async () => {
    let acknowledge!: (handle: JobHandle<MetadataInfo>) => void;
    read.mockImplementation(() => new Promise(resolve => { acknowledge = resolve; }));
    await mount(<Probe />); await tick(); const id = read.mock.calls[0][1].consumer_id;
    await act(async () => root!.unmount()); root = null;
    const cancel = vi.fn(async () => undefined);
    await act(async () => acknowledge({ id: "late", cancel, completion: Promise.reject(new Error("background.cancelled")) }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(release.mock.calls.filter(call => call[0] === id).length).toBeGreaterThanOrEqual(2);
  });
  it("refreshes the same path when its listing revision changes", async () => {
    read.mockImplementation(async () => ({ id: "ok", cancel: vi.fn(async () => undefined), completion: Promise.resolve(done()) }));
    await mount(<Probe revision={{}} />); await tick();
    await act(async () => root!.render(<Probe revision={{}} />)); await tick();
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[0][1].consumer_id).not.toBe(read.mock.calls[1][1].consumer_id);
  });
  it("inactive panes do not start reads, including StrictMode", async () => {
    await mount(<StrictMode><Probe active={false} /></StrictMode>); await tick(); expect(read).not.toHaveBeenCalled();
  });
  it("secure fallback IDs stay distinct when randomUUID is absent", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID");
    Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: undefined });
    try { expect(metadataConsumerId()).not.toBe(metadataConsumerId()); }
    finally { if (descriptor) Object.defineProperty(globalThis.crypto, "randomUUID", descriptor); else delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID; }
  });
});
