import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import Dialog from "../components/Dialog";
import { Toast } from "../components/Toast";
import {
  AccessibleFileAnnouncement,
  AnnouncementRegion,
  listItemAriaProps,
} from "../accessibility/AccessibleFileAnnouncement";
import { AnnouncementQueue } from "../accessibility/announcements";
import { defaultAccessibilitySettings, resolveAccessibility } from "../services/accessibility";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
  return container;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

describe("accessible file announcements", () => {
  it("logicalposinsetwithvirtualrows", () => {
    expect(listItemAriaProps(0, 10000)).toEqual({ "aria-setsize": 10000, "aria-posinset": 1 });
    expect(listItemAriaProps(9999, 10000)).toEqual({ "aria-setsize": 10000, "aria-posinset": 10000 });
    expect(listItemAriaProps(50, 10)).toEqual({ "aria-setsize": 10, "aria-posinset": 10 });
  });

  it("oneannounce/2sprogress", async () => {
    const delivered: string[] = [];
    const queue = new AnnouncementQueue((a) => delivered.push(a.key));
    queue.announce("progress.one", {}, "polite");
    queue.announce("progress.two", {}, "polite");
    queue.announce("progress.three", {}, "polite");
    expect(delivered).toEqual(["progress.one"]);
    await act(async () => vi.advanceTimersByTime(1999));
    expect(delivered).toEqual(["progress.one"]);
    await act(async () => vi.advanceTimersByTime(1));
    expect(delivered).toEqual(["progress.one", "progress.two"]);
    queue.announce("errors.done", {}, "assertive", true);
    expect(delivered).toContain("errors.done");
    queue.dispose();
  });

  it("coalesces the same key and never speaks after dispose (noinactiveannouncements)", async () => {
    const delivered: string[] = [];
    const queue = new AnnouncementQueue((a) => delivered.push(`${a.key}:${String(a.args.count)}`));
    queue.announce("progress.start", { count: 0 }, "polite");
    queue.announce("selection.count", { count: 1 }, "polite");
    queue.announce("selection.count", { count: 2 }, "polite");
    await act(async () => vi.advanceTimersByTime(2000));
    expect(delivered).toEqual(["progress.start:0", "selection.count:2"]);
    queue.dispose();
    queue.announce("selection.count", { count: 3 }, "polite");
    await act(async () => vi.advanceTimersByTime(5000));
    expect(delivered).toEqual(["progress.start:0", "selection.count:2"]);
  });

  it("renders the combined file announcement as escaped text", async () => {
    const el = await render(
      <AccessibleFileAnnouncement
        parts={{ name: "<b>alpha.txt</b>", type: "Text file", size: "1 KB", date: "today" }}
      />,
    );
    const span = el.querySelector("[data-file-announcement]");
    expect(span?.textContent).toContain("alpha.txt");
    expect(el.querySelector("b")).toBeNull();
  });

  it("announcement region separates polite and assertive output", async () => {
    const queue = new AnnouncementQueue();
    const el = await render(<AnnouncementRegion queue={queue} />);
    await act(async () => queue.announce("common.dismiss", {}, "assertive"));
    expect(el.querySelector('[data-announcement="assertive"]')?.textContent).toContain("Dismiss");
    expect(el.querySelector('[data-announcement="polite"]')?.textContent).toBe("");
    queue.dispose();
  });
});

describe("focus, dialogs and targets", () => {
  it("focusedtoastnoexpiry", async () => {
    const dismissed: number[] = [];
    const el = await render(
      <Toast toast={{ id: 1, message: "Saved" }} onDismiss={(id) => dismissed.push(id)} />,
    );
    const toast = el.querySelector(".adp-toast") as HTMLElement;
    await act(async () => toast.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(20000));
    expect(dismissed).toEqual([]);
  });

  it("dialog300%stack keeps a modal scrollable dialog", async () => {
    const effective = resolveAccessibility(
      { ...defaultAccessibilitySettings(), large_targets: true },
      300,
      { forced_colors: false, reduced_motion: false, text_scale: 1, double_click_ms: 500, generation: 1 },
    );
    expect(effective.effective_zoom).toBe(300);
    expect(effective.target_px).toBe(44);
    const el = await render(
      <Dialog title="Settings" onClose={() => undefined}>
        <p>Body</p>
      </Dialog>,
    );
    const dialog = el.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(el.querySelector(".adp-dialog-body")?.textContent).toContain("Body");
  });

  it("alltargets24or44", () => {
    const system = {
      forced_colors: false,
      reduced_motion: false,
      text_scale: 1,
      double_click_ms: 500,
      generation: 1,
    };
    expect(resolveAccessibility(defaultAccessibilitySettings(), 100, system).target_px).toBe(24);
    expect(
      resolveAccessibility({ ...defaultAccessibilitySettings(), large_targets: true }, 100, system)
        .target_px,
    ).toBe(44);
  });
});
