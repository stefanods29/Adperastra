import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { defaultSettings, type AppSettings } from "../services/settings";
import VersionsSettings, { type VersionsSettingsProps } from "../views/settings/VersionsSettings";

vi.mock("../services/versions", () => ({
  versionsStoreSize: vi.fn(),
  versionsDeleteAll: vi.fn(),
}));

import { versionsDeleteAll, versionsStoreSize } from "../services/versions";

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

async function renderVersions(initial: AppSettings = defaultSettings()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let settings = initial;
  const changes: AppSettings[] = [];
  const props = (): VersionsSettingsProps => ({
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
      root?.render(<VersionsSettings {...props()} />);
    });
  };
  await rerender();
  return { changes, current: () => settings };
}

beforeEach(() => {
  vi.mocked(versionsStoreSize).mockReset().mockResolvedValue(2048);
  vi.mocked(versionsDeleteAll).mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("VersionsSettings", () => {
  it("changes the limits", async () => {
    const view = await renderVersions();
    const keep = container!.querySelector<HTMLSelectElement>("select[data-versions-field='keep_days']")!;
    await act(async () => {
      keep.value = "90";
      keep.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(view.changes.at(-1)!.versions.keep_days).toBe(90);

    const toggle = container!.querySelector<HTMLButtonElement>("[role='switch']")!;
    await click(toggle);
    expect(view.changes.at(-1)!.versions.enabled).toBe(false);
  });

  it("delete all asks first", async () => {
    await renderVersions();
    await click(buttonWithText(container!, i18n.t("settings.versionsDeleteAll")));
    const dialog = container!.querySelector("[role='dialog']")!;
    await click(buttonWithText(dialog, i18n.t("common.cancel")));
    expect(versionsDeleteAll).not.toHaveBeenCalled();

    await click(buttonWithText(container!, i18n.t("settings.versionsDeleteAll")));
    await click(container!.querySelector("[role='dialog'] .adp-btn--primary"));
    expect(versionsDeleteAll).toHaveBeenCalledTimes(1);
    expect(container!.textContent).toContain(i18n.t("settings.versionsDeleted"));
  });
});
