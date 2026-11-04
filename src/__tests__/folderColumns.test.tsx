import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import ColumnChooser from "../views/explorer/views/ColumnChooser";
import { useColumnResize } from "../views/explorer/views/useColumnResize";
import { defaultColumns } from "../services/folderPresentation";
import { useMetadata } from "../metadata/useMetadata";
import { readMetadata, releaseMetadata } from "../services/metadata";
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));
vi.mock("../services/metadata", () => ({ readMetadata: vi.fn(), releaseMetadata: vi.fn(async () => undefined) }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); root = null; container = null; vi.useRealTimers(); vi.clearAllMocks(); });
async function mount(node: React.ReactNode) {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root?.render(node));
}
function Resize({ commit }: { commit: (width: number) => void }) {
  const resize = useColumnResize("size", 100, commit);
  return <div {...resize.separatorProps} aria-label="width" />;
}
function MetadataColumn({ visible }: { visible: boolean }) {
  useMetadata("C:\\fixtures\\photo.jpg", visible);
  return null;
}
function pointer(type: string, x: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
  return event;
}
describe("folder columns", () => {
  it("name cannot uncheck", async () => {
    const change = vi.fn(); await mount(<ColumnChooser value={defaultColumns()} onChange={change} onClose={() => undefined} />);
    const name = container!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(name.checked).toBe(true); expect(name.disabled).toBe(true); name.click(); expect(change).not.toHaveBeenCalled();
  });
  it("Right+8/ShiftRight+32", async () => {
    const commit = vi.fn(); await mount(<Resize commit={commit} />);
    const separator = container!.querySelector('[role="separator"]')!;
    await act(async () => separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(commit).toHaveBeenLastCalledWith(108);
    await act(async () => separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })));
    expect(commit).toHaveBeenLastCalledWith(132);
  });
  it("Esc reset", async () => {
    const commit = vi.fn(); await mount(<Resize commit={commit} />);
    const separator = container!.querySelector<HTMLElement>('[role="separator"]')!;
    separator.setPointerCapture = vi.fn(); separator.hasPointerCapture = () => true; separator.releasePointerCapture = vi.fn();
    await act(async () => { separator.dispatchEvent(pointer("pointerdown", 0)); separator.dispatchEvent(pointer("pointermove", 200)); });
    expect(separator.getAttribute("aria-valuenow")).toBe("300");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(separator.getAttribute("aria-valuenow")).toBe("100"); expect(commit).not.toHaveBeenCalled();
  });
  it("persisted 600 max", async () => {
    const commit = vi.fn(); await mount(<Resize commit={commit} />);
    const separator = container!.querySelector<HTMLElement>('[role="separator"]')!;
    separator.setPointerCapture = vi.fn(); separator.hasPointerCapture = () => false;
    await act(async () => { separator.dispatchEvent(pointer("pointerdown", 0)); separator.dispatchEvent(pointer("pointermove", 2000)); });
    expect(commit).not.toHaveBeenCalled();
    await act(async () => separator.dispatchEvent(pointer("pointerup", 2000)));
    expect(commit).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenCalledWith(600);
  });
  it("metadata hidden cancels", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(async () => undefined);
    vi.mocked(readMetadata).mockResolvedValue({ id: "metadata-1-a", cancel, completion: new Promise(() => undefined) });
    await mount(<MetadataColumn visible />);
    await act(async () => vi.advanceTimersByTime(150));
    expect(readMetadata).toHaveBeenCalledTimes(1);
    await act(async () => root!.render(<MetadataColumn visible={false} />));
    expect(cancel).toHaveBeenCalledTimes(1); expect(releaseMetadata).toHaveBeenCalledTimes(1);
  });
});
