import { describe, expect, it } from "vitest";
import dark from "../../themes/dark.tokens.json";
import light from "../../themes/light.tokens.json";

describe("design tokens (plan/design-spec.md)", () => {
  it("light surfaces match the spec", () => {
    expect(light.color.surface.window).toBe("#FFFFFF");
    expect(light.color.surface.chrome).toBe("#F3F3F3");
    expect(light.color.surface.pane).toBe("#FAFAFA");
    expect(light.color.surface.sidebar).toBe("#F7F7F7");
    expect(light.color.surface.selected).toBe("#EAEAEA");
    expect(light.color.surface.tabInactive).toBe("#E1E1E1");
    expect(light.color.surface.header).toBe("#F0F0F0");
    expect(light.color.surface.segmentTrack).toBe("#EDEDED");
    expect(light.color.surface.canvasDoc).toBe("#EFEFEF");
    expect(light.color.surface.canvasMedia).toBe("#ECECEC");
    expect(light.color.surface.selectedRow).toBe("#E5F1FB");
  });

  it("light text, borders and accents match the spec", () => {
    expect(light.color.text.primary).toBe("#202020");
    expect(light.color.text.secondary).toBe("#616161");
    expect(light.color.text.tertiary).toBe("#8A8A8A");
    expect(light.color.text.bodyMuted).toBe("#333333");
    expect(light.color.text.onAccent).toBe("#FFFFFF");
    expect(light.color.border.default).toBe("#E5E5E5");
    expect(light.color.border.subtle).toBe("#E0E0E0");
    expect(light.color.border.panel).toBe("#ECECEC");
    expect(light.color.border.input).toBe("#C8C8C8");
    expect(light.color.border.chip).toBe("#D0D0D0");
    expect(light.color.accent.explorer).toBe("#0067C0");
    expect(light.color.accent.excel).toBe("#107C41");
    expect(light.color.accent.word).toBe("#185ABD");
    expect(light.color.accent.pdf).toBe("#E4181F");
    expect(light.color.accent.image).toBe("#0A8A93");
    expect(light.color.accent.powerpoint).toBe("#C43E1C");
    expect(light.color.accent.group).toBe("#7F56D9");
  });

  it("dark theme is derived and differs from light", () => {
    expect(dark.color.surface.window).toBe("#202020");
    expect(dark.color.surface.window).not.toBe(light.color.surface.window);
    expect(dark.color.text.primary).not.toBe(light.color.text.primary);
    expect(dark.color.accent.explorer).toBe("#4CC2FF");
    expect(dark.color.accent.explorer).not.toBe(light.color.accent.explorer);
  });
});