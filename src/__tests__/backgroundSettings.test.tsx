import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { defaultSettings, normalizeSettings, type AppSettings } from "../services/settings";
import BackgroundSettings, {
  type BackgroundSettingsProps,
} from "../views/settings/BackgroundSettings";

vi.mock("../services/background", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/background")>();
  return { ...actual, getBackgroundStatus: vi.fn() };
});

import { getBackgroundStatus } from "../services/background";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const click = async (element: Element | null) => {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
};

const buttonWithText = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  ) ?? null;

async function renderBackground(initial: AppSettings = defaultSettings()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let settings = initial;
  const changes: AppSettings[] = [];
  const props = (): BackgroundSettingsProps => ({
    settings,
    onApply: (next) => {
      settings = next;
      changes.push(next);
      void rerender();
    },
    onOpenHelp: () => undefined,
  });
  const rerender = async () => {
    await act(async () => {
      root?.render(<BackgroundSettings {...props()} />);
    });
  };
  await rerender();
  return { changes, current: () => settings };
}

beforeEach(() => {
  vi.mocked(getBackgroundStatus).mockReset().mockResolvedValue({
    paused: false,
    eligible: true,
    reason: "none",
    running: 0,
    queued: 0,
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("BackgroundSettings", () => {
  it("pausing saves exactly one complete settings object", async () => {
    const view = await renderBackground();
    await click(buttonWithText(container!, i18n.t("settings.backgroundPaused")));
    expect(view.changes).toHaveLength(1);
    const changed = view.changes[0];
    expect(changed.background.paused).toBe(true);
    expect(changed.background.enabled).toBe(true);
    expect(changed.background.only_idle).toBe(false);
    expect(changed.cache).toEqual(view.current().cache);
    expect(changed.explorer).toEqual(defaultSettings().explorer);
    expect(changed.language).toBe(defaultSettings().language);
  });

  it("shows the waiting reason from the policy status", async () => {
    vi.mocked(getBackgroundStatus).mockResolvedValue({
      paused: false,
      eligible: false,
      reason: "idle",
      running: 0,
      queued: 0,
    });
    await renderBackground();
    expect(container!.textContent).toContain(i18n.t("background.waitingIdle"));
  });

  it("changes the cache limit once", async () => {
    const view = await renderBackground();
    const select = container!.querySelector<HTMLSelectElement>(
      "select[data-background-field='max_mb']",
    )!;
    await act(async () => {
      select.value = "1024";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(view.changes).toHaveLength(1);
    expect(view.changes[0].cache.max_mb).toBe(1024);
  });

  it("importing schema 11 keeps language, theme and templates and adds defaults", () => {
    const imported = normalizeSettings({
      schema_version: 11,
      language: "es",
      theme: { mode: "dark", accent_source: "design", accent_custom: "#0067C0" },
      templates: { my_folder: "C:\\Templates" },
    });
    expect(imported.language).toBe("es");
    expect(imported.theme.mode).toBe("dark");
    expect(imported.templates.my_folder).toBe("C:\\Templates");
    expect(imported.background).toEqual(defaultSettings().background);
    expect(imported.cache).toEqual({ max_mb: 512 });
  });

  it("an unsupported cache limit falls back without resetting other fields", () => {
    const repaired = normalizeSettings({
      schema_version: 11,
      language: "es",
      cache: { max_mb: 300 },
      templates: { my_folder: "C:\\Templates" },
    });
    expect(repaired.cache.max_mb).toBe(512);
    expect(repaired.language).toBe("es");
    expect(repaired.templates.my_folder).toBe("C:\\Templates");
  });
});


describe("background status lifecycle", () => {
  it("refreshes status while visible and stops when its tab hides", async () => {
    vi.useFakeTimers();
    try {
      await renderBackground();
      expect(getBackgroundStatus).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(getBackgroundStatus).toHaveBeenCalledTimes(3);
      await act(async () => root?.render(<BackgroundSettings settings={defaultSettings()}
        active={false} onApply={() => undefined} onOpenHelp={() => undefined} />));
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(getBackgroundStatus).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });
});
