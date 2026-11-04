import type { TFunction } from "i18next";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n, { applyLanguage } from "../i18n";
import { formatSize } from "../services/format";
import {
  defaultResidentStartup,
  residentPolicy,
  runTrayAction,
  TRAY_ID,
  trayAction,
  trayMenuModel,
  type ResidentStatus,
} from "../services/resident";
import StartupResidentSettings from "../views/settings/StartupResidentSettings";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  await act(async () => {
    await applyLanguage("en");
  });
});

function status(overrides: Partial<ResidentStatus> = {}): ResidentStatus {
  return {
    state: "visible",
    enabled: false,
    start_with_windows: false,
    private_bytes: 0,
    measured_unix: 0,
    active_jobs: 0,
    ...overrides,
  };
}

async function renderSettings(value: ResidentStatus | null): Promise<HTMLDivElement> {
  const element = document.createElement("div");
  container = element;
  document.body.appendChild(element);
  root = createRoot(element);
  await act(async () => {
    root?.render(
      <StartupResidentSettings
        startup={defaultResidentStartup()}
        status={value}
        pending={false}
        error={null}
        locale="en"
        onChange={async () => undefined}
      />,
    );
  });
  return element;
}

describe("resident tray and memory", () => {
  it("onetray_after_languagechange", async () => {
    await act(async () => {
      await applyLanguage("en");
    });
    const english = trayMenuModel(i18n.t.bind(i18n) as TFunction);
    await act(async () => {
      await applyLanguage("es");
    });
    const spanish = trayMenuModel(i18n.t.bind(i18n) as TFunction);

    expect(english.id).toBe(TRAY_ID);
    expect(spanish.id).toBe(TRAY_ID);
    expect(english.items).toHaveLength(3);
    expect(spanish.items.map((item) => item.id)).toEqual(
      english.items.map((item) => item.id),
    );
    expect(english.items[0].label).toBe("Open");
    expect(spanish.items[0].label).toBe("Abrir");
    expect(english.items[1].label).toBe("Turn off stay in background");
    expect(spanish.items[1].label).toBe("Desactivar permanencia en segundo plano");
    expect(english.items[2].label).toBe("Quit");
    expect(spanish.items[2].label).toBe("Salir");
  });

  it("memory_value_fromsample", async () => {
    const privateBytes = 12_345_678;
    const element = await renderSettings(
      status({ state: "resident", enabled: true, private_bytes: privateBytes, measured_unix: 1_700_000_000 }),
    );
    const expected = formatSize(privateBytes, "en");
    expect(element.textContent).toContain(`Current background memory: ${expected}`);
    expect(element.textContent).not.toContain("0 B");
  });

  it("does not show a memory figure before the first sample", async () => {
    const element = await renderSettings(status({ measured_unix: 0 }));
    expect(element.textContent).not.toContain("Current background memory");
  });

  it("engines_unload_whenresident", () => {
    expect(residentPolicy("resident").release_engines).toBe(true);
    expect(residentPolicy("visible").release_engines).toBe(false);
    expect(residentPolicy("resident").keep_background_tasks).toBe(true);
  });

  it("Quit_doesnotdiscarddirty", async () => {
    const quit = vi.fn(async () => false);
    const turnOff = vi.fn(async () => false);
    const showWindow = vi.fn(async () => undefined);
    const handlers = { showWindow, turnOff, quit };

    expect(trayAction("resident.quit")?.direct_exit).toBe(false);
    expect(trayAction("resident.turnOff")?.requires_dirty_decision).toBe(true);
    expect(await runTrayAction("resident.quit", handlers)).toBe("cancelled");
    expect(quit).toHaveBeenCalledTimes(1);
    expect(await runTrayAction("resident.turnOff", handlers)).toBe("cancelled");
    expect(turnOff).toHaveBeenCalledTimes(1);
    expect(await runTrayAction("resident.open", handlers)).toBe("shown");
    expect(showWindow).toHaveBeenCalledTimes(1);
    expect(await runTrayAction("resident.unknown", handlers)).toBe("ignored");
  });
});

