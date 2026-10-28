import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { formatShortcut } from "../services/shortcuts";

describe("shortcut hints", () => {
  it("translate key names and keep letters and function keys", async () => {
    await i18n.changeLanguage("es");
    const t = (key: string) => i18n.t(key);
    expect(formatShortcut("Shift+F10", t)).toBe("Mayús+F10");
    expect(formatShortcut("Delete", t)).toBe("Supr");
    expect(formatShortcut("Ctrl+Shift+C", t)).toBe("Ctrl+Mayús+C");
    expect(formatShortcut("Alt+Left", t)).toBe("Alt+Flecha izquierda");
    await i18n.changeLanguage("en");
    expect(formatShortcut("Alt+Enter", (key) => i18n.t(key))).toBe("Alt+Enter");
  });
});
