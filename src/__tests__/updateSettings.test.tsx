import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import UpdateSettings, { type UpdateSettingsProps } from "../views/settings/UpdateSettings";
import type { UpdateInfo } from "../services/updates";

vi.mock("../services/updates", () => ({
  checkForUpdates: vi.fn(),
  openUpdatePage: vi.fn(),
}));

import { checkForUpdates, openUpdatePage } from "../services/updates";

const info = (available: boolean): UpdateInfo => ({
  current_version: "0.1.0",
  latest_version: available ? "0.2.0" : "0.1.0",
  available,
  release_url: "https://github.com/stefanods29/Adperastra/releases/tag/v0.2.0",
  checked_unix: 1_700_000_000,
});

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

async function renderUpdates(overrides: Partial<UpdateSettingsProps> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const changes: boolean[] = [];
  const checked: UpdateInfo[] = [];
  const help: string[] = [];
  const props: UpdateSettingsProps = {
    enabled: false,
    onEnabledChange: (enabled) => changes.push(enabled),
    onChecked: (value) => checked.push(value),
    onOpenHelp: (slug) => help.push(slug),
    ...overrides,
  };
  await act(async () => {
    root?.render(<UpdateSettings {...props} />);
  });
  return { changes, checked, help };
}

beforeEach(() => {
  vi.mocked(checkForUpdates).mockReset();
  vi.mocked(openUpdatePage).mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("UpdateSettings", () => {
  it("makes no network request when it appears", async () => {
    await renderUpdates();
    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(openUpdatePage).not.toHaveBeenCalled();
    expect(container!.textContent).toContain("Check for updates");
  });

  it("checks only when Check now is chosen and shows the result", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue(info(true));
    const view = await renderUpdates();
    await click(buttonWithText(container!, "Check now"));
    expect(checkForUpdates).toHaveBeenCalledWith(true);
    expect(container!.textContent).toContain("Version 0.2.0 is available.");
    expect(view.checked).toEqual([info(true)]);

    await click(buttonWithText(container!, "Open release page"));
    expect(openUpdatePage).toHaveBeenCalledTimes(1);
  });

  it("says the checked version is current when no update is available", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue(info(false));
    await renderUpdates();
    await click(buttonWithText(container!, "Check now"));
    expect(container!.textContent).toContain("You have the latest checked version.");
    expect(buttonWithText(container!, "Open release page")).toBeNull();
  });

  it("keeps the app usable and explains a failed check", async () => {
    vi.mocked(checkForUpdates).mockRejectedValue("updates.network");
    await renderUpdates();
    await click(buttonWithText(container!, "Check now"));
    expect(container!.textContent).toContain("Updates could not be checked. Try again later.");
    expect(buttonWithText(container!, "Check now")).not.toBeNull();
  });

  it("turns the opt-in switch and opens the two help pages", async () => {
    const view = await renderUpdates({ enabled: true });
    const toggle = container!.querySelector<HTMLButtonElement>("[role='switch']")!;
    await click(toggle);
    expect(view.changes).toEqual([false]);

    await click(buttonWithText(container!, "What's new"));
    expect(view.help).toContain("whats-new-0-1");

    await click(container!.querySelector("button[aria-label='Help']"));
    expect(view.help).toContain("installing-and-updating");
  });
});
