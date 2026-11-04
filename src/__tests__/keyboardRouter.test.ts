import { Bold } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../commands/registry";
import { KeyboardRouter } from "../keyboard/KeyboardRouter";
import { keyboardPreset } from "../keyboard/presets";
import {
  deterministicBindingId,
  type KeyboardHost,
  type KeyboardMap,
  type ShortcutBinding,
  type ShortcutScope,
} from "../keyboard/types";

function binding(
  commandId: string,
  scope: ShortcutScope,
  key: string,
  mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean }> = {},
  secondKey?: string,
): ShortcutBinding {
  const stroke = { ctrl: false, alt: false, shift: false, meta: false, mode: "key" as const, key, ...mods };
  return {
    id: deterministicBindingId(`router:${commandId}:${scope}:${key}:${secondKey ?? ""}`),
    command_id: commandId,
    scope,
    strokes: secondKey ? [stroke, { ...stroke, key: secondKey }] : [stroke],
    enabled: true,
  };
}

function fakeHost(scopes: ShortcutScope[], options: { typing?: boolean; disabled?: string[] } = {}) {
  const dispatched: string[] = [];
  const disabledShown: string[] = [];
  const navigated: string[] = [];
  const commands = new Map<string, Command<unknown>>();
  const host: KeyboardHost = {
    activeScopes: () => scopes,
    isTypingTarget: () => options.typing ?? false,
    command: (id) => commands.get(id),
    dispatch: (id) => dispatched.push(id),
    showDisabled: (id) => disabledShown.push(id),
    navigate: (direction) => navigated.push(direction),
    focusFilter: () => navigated.push("filter"),
    copyToFolder: async () => { navigated.push("copyTo"); },
    moveToFolder: async () => { navigated.push("moveTo"); },
  };
  const add = (id: string) => {
    commands.set(id, {
      id,
      labelKey: "commands.copy",
      icon: Bold,
      risk: "read-only",
      helpSlug: "command-bar",
      enabledWhen: () => !(options.disabled ?? []).includes(id),
      run: () => undefined,
    });
  };
  return { host, dispatched, disabledShown, navigated, add };
}

const keyEvent = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { cancelable: true, ...init });

function routerWith(bindings: ShortcutBinding[], fake: ReturnType<typeof fakeHost>): KeyboardRouter {
  const map: KeyboardMap = { id: "builtin:windows", name: "Windows", bindings, version: 1 };
  const router = new KeyboardRouter(fake.host);
  router.setMap(map);
  return router;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("keyboard router (step-10b/T3)", () => {
  it("oneeventonecommand", () => {
    const fake = fakeHost(["explorer", "global"]);
    fake.add("explorer.copy");
    fake.add("explorer.paste");
    const router = routerWith(
      [binding("explorer.copy", "global", "c", { ctrl: true }), binding("explorer.paste", "global", "v", { ctrl: true })],
      fake,
    );
    expect(router.handle(keyEvent({ key: "c", ctrlKey: true }))).toBe(true);
    expect(fake.dispatched).toEqual(["explorer.copy"]);
    router.dispose();
  });

  it("defaultPreventedignored", () => {
    const fake = fakeHost(["global"]);
    fake.add("explorer.copy");
    const router = routerWith([binding("explorer.copy", "global", "c", { ctrl: true })], fake);
    const event = keyEvent({ key: "c", ctrlKey: true });
    event.preventDefault();
    expect(router.handle(event)).toBe(false);
    expect(fake.dispatched).toEqual([]);
    router.dispose();
  });

  it("AltGr/compositionignored", () => {
    const fake = fakeHost(["global"]);
    fake.add("explorer.copy");
    const router = routerWith([binding("explorer.copy", "global", "c", { ctrl: true })], fake);
    const altGr = keyEvent({ key: "c", ctrlKey: true, altKey: true });
    Object.defineProperty(altGr, "getModifierState", { value: (name: string) => name === "AltGraph" });
    expect(router.handle(altGr)).toBe(false);
    const composing = keyEvent({ key: "c", ctrlKey: true });
    Object.defineProperty(composing, "isComposing", { value: true });
    expect(router.handle(composing)).toBe(false);
    expect(router.handle(keyEvent({ key: "Dead", ctrlKey: true }))).toBe(false);
    expect(fake.dispatched).toEqual([]);
    router.dispose();
  });

  it("searchCtrlTabwins", () => {
    const fake = fakeHost(["search", "explorer", "global"]);
    fake.add("search.cycleMode");
    fake.add("tabs.cycle");
    const router = routerWith(
      [binding("tabs.cycle", "global", "Tab", { ctrl: true }), binding("search.cycleMode", "search", "Tab", { ctrl: true })],
      fake,
    );
    expect(router.handle(keyEvent({ key: "Tab", ctrlKey: true }))).toBe(true);
    expect(fake.dispatched).toEqual(["search.cycleMode"]);
    router.dispose();
  });

  it("Gnotcapturedininput", () => {
    const fake = fakeHost(["explorer", "global"], { typing: true });
    const router = new KeyboardRouter(fake.host);
    router.setMap(keyboardPreset("vim", []));
    expect(router.handle(keyEvent({ key: "G", shiftKey: true }))).toBe(false);
    expect(router.handle(keyEvent({ key: "g" }))).toBe(false);
    expect(fake.navigated).toEqual([]);
    router.dispose();
  });

  it("globalModifiedShortcutWorksInInput", () => {
    const fake = fakeHost(["explorer", "global"], { typing: true });
    fake.add("app.commandPalette");
    const router = routerWith([binding("app.commandPalette", "global", "k", { ctrl: true })], fake);
    expect(router.handle(keyEvent({ key: "k", ctrlKey: true }))).toBe(true);
    expect(fake.dispatched).toEqual(["app.commandPalette"]);
    router.dispose();
  });

  it("textEditingChordStaysWithTheField", () => {
    const fake = fakeHost(["text", "global"], { typing: true });
    fake.add("explorer.undo");
    const router = routerWith([binding("explorer.undo", "global", "z", { ctrl: true })], fake);
    expect(router.handle(keyEvent({ key: "z", ctrlKey: true }))).toBe(false);
    expect(fake.dispatched).toEqual([]);
    router.dispose();
  });

  it("500mssequenceexpiry", () => {
    vi.useFakeTimers();
    const fake = fakeHost(["explorer", "global"]);
    const router = new KeyboardRouter(fake.host);
    router.setMap(keyboardPreset("vim", []));
    expect(router.handle(keyEvent({ key: "g" }))).toBe(true);
    vi.advanceTimersByTime(600);
    expect(router.handle(keyEvent({ key: "g" }))).toBe(true);
    expect(fake.navigated).toEqual([]);
    expect(router.handle(keyEvent({ key: "g" }))).toBe(true);
    expect(fake.navigated).toEqual(["first"]);
    router.dispose();
  });

  it("disabled candidate shows its reason and does not fall through", () => {
    const fake = fakeHost(["explorer", "global"], { disabled: ["explorer.safe"] });
    fake.add("explorer.safe");
    fake.add("explorer.destructive");
    const router = routerWith(
      [binding("explorer.destructive", "global", "d", { ctrl: true }), binding("explorer.safe", "explorer", "d", { ctrl: true })],
      fake,
    );
    expect(router.handle(keyEvent({ key: "d", ctrlKey: true }))).toBe(true);
    expect(fake.disabledShown).toEqual(["explorer.safe"]);
    expect(fake.dispatched).toEqual([]);
    router.dispose();
  });
});
