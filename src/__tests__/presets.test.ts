import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PRESETS,
  applyLayoutValues,
  layoutValues,
  matchingPreset,
  presetNameError,
  withSavedPreset,
  withoutSavedPreset,
} from "../layout/presets";
import { defaultSettings, type LayoutSettings, type SavedLayout } from "../services/settings";

const defaults = () => defaultSettings().layout;
const layoutWith = (patch: Partial<LayoutSettings>): LayoutSettings => ({ ...defaults(), ...patch });
const preset = (name: string, values: Partial<SavedLayout> = {}): SavedLayout => ({
  name,
  ...layoutValues(defaults()),
  ...values,
});

describe("layout presets", () => {
  it("matchingPreset finds built-in presets first", () => {
    expect(matchingPreset(defaults())).toEqual({ kind: "builtIn", id: "standard" });
    expect(matchingPreset(applyLayoutValues(defaults(), BUILT_IN_PRESETS.minimal))).toEqual({
      kind: "builtIn",
      id: "minimal",
    });
    const left = layoutWith({ toolbar_position: "left" });
    expect(matchingPreset(left)).toBeNull();
    expect(matchingPreset({ ...left, saved_presets: [preset("Work", { toolbar_position: "left" })] })).toEqual({
      kind: "saved",
      index: 0,
    });
    expect(matchingPreset({ ...defaults(), saved_presets: [preset("Copy")] })).toEqual({
      kind: "builtIn",
      id: "standard",
    });
  });

  it("applyLayoutValues keeps the saved presets", () => {
    const saved = [preset("Work")];
    const next = applyLayoutValues(layoutWith({ saved_presets: saved }), BUILT_IN_PRESETS.classic);
    expect(layoutValues(next)).toEqual(BUILT_IN_PRESETS.classic);
    expect(next.saved_presets).toBe(saved);
  });

  it("presetNameError checks in order", () => {
    expect(presetNameError("", defaults())).toBe("empty");
    expect(presetNameError("   ", defaults())).toBe("empty");
    expect(presetNameError("a".repeat(61), defaults())).toBe("tooLong");
    expect(presetNameError("a".repeat(60), defaults())).toBeNull();
    expect(presetNameError("work", layoutWith({ saved_presets: [preset("Work")] }))).toBe("duplicate");
    const full = layoutWith({ saved_presets: Array.from({ length: 20 }, (_, index) => preset(`p${index}`)) });
    expect(presetNameError("Work", full)).toBe("full");
  });

  it("withSavedPreset trims and adds at the end", () => {
    const base = layoutWith({ toolbar_position: "left", saved_presets: [preset("A")] });
    const next = withSavedPreset(base, "  Work  ");
    expect(next.saved_presets.map((entry) => entry.name)).toEqual(["A", "Work"]);
    expect(next.saved_presets[1].toolbar_position).toBe("left");
    expect(withSavedPreset(next, "")).toBe(next);
  });

  it("withoutSavedPreset removes one", () => {
    const a = preset("A");
    const b = preset("B");
    expect(withoutSavedPreset(layoutWith({ saved_presets: [a, b] }), 0).saved_presets).toEqual([b]);
    expect(withoutSavedPreset(layoutWith({ saved_presets: [a, b] }), 5).saved_presets).toEqual([a, b]);
  });

  it("layoutValues drops the saved presets", () => {
    const values = layoutValues(layoutWith({ saved_presets: [preset("A")] }));
    expect(Object.keys(values).sort()).toEqual([
      "details_pane_position",
      "nav_pane_position",
      "tab_bar_collapsed",
      "tab_bar_position",
      "toolbar_mode",
      "toolbar_position",
    ]);
  });
});
