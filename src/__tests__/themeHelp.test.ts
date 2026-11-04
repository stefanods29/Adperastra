import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEMES } from "../appearance/themes";
import { createCustomTheme, themeStyleCss } from "../services/customThemes";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

const pages = [
  { slug: "theme-editor", en: "Theme editor", es: "Editor de temas" },
  { slug: "day-and-night-themes", en: "Day and night themes", es: "Temas diurnos y nocturnos" },
  { slug: "accent-colors", en: "Accent colors", es: "Colores de énfasis" },
];

function icuArguments(text: string): string[] {
  return [...text.matchAll(/\{([a-zA-Z0-9_]+)\s*,/g)].map((match) => match[1]).sort();
}

describe("theme help pages", () => {
  it("all three pages exist in both languages with their titles", () => {
    for (const page of pages) {
      expect(read("help", "en", `${page.slug}.md`)).toContain(`# ${page.en}`);
      expect(read("help", "es", `${page.slug}.md`)).toContain(`# ${page.es}`);
    }
  });

  it("all theme file fields are documented", () => {
    const text = read("docs", "theme-authoring.md");
    for (const field of [
      "schema_version",
      "id",
      "name",
      "scheme",
      "tokens",
      "editor_tokens",
      "material",
      "ui_font",
      "ui_font_size_px",
      "tab_shape",
      "icon_mode",
      "styles",
      "background",
      "modified_unix",
      "asset_id",
      "opacity",
      "blur_px",
      "selector",
      "property",
      "value",
      "unit",
    ]) {
      expect(text, field).toContain(`\`${field}\``);
    }
    // docs/theme-authoring.md says "It does not accept a CSS text field":
    // the exact wording of the integrated authoring document.
    for (const claim of ["does not accept a CSS text field", "font file", "never replaces an existing file", "4096", "16 MP"]) {
      expect(text.toLowerCase()).toContain(claim.toLowerCase());
    }
  });

  it("English and Spanish theme locale entries keep the same ICU arguments", () => {
    const en = JSON.parse(read("src", "i18n", "locales", "en.json")) as Record<string, unknown>;
    const es = JSON.parse(read("src", "i18n", "locales", "es.json")) as Record<string, unknown>;
    const flatten = (value: unknown, prefix = "", out = new Map<string, string>()) => {
      if (value !== null && typeof value === "object") {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          flatten(child, prefix === "" ? key : `${prefix}.${key}`, out);
        }
      } else if (typeof value === "string") {
        out.set(prefix, value);
      }
      return out;
    };
    const enFlat = flatten(en);
    const esFlat = flatten(es);
    for (const [key, value] of enFlat) {
      if (!/^(themeEditor|themeSchedule|themeAccent|errors\.theme)\./.test(key)) continue;
      expect(esFlat.has(key), key).toBe(true);
      expect(icuArguments(esFlat.get(key)!), key).toEqual(icuArguments(value));
    }
  });

  it("the CSS whitelist never accepts raw CSS and the built-in theme count is unchanged", () => {
    const draft = createCustomTheme("Example", "light", "33333333-3333-4333-8333-333333333333");
    draft.styles = [{ selector: ".adp-tab", property: "padding-inline", value: 8, unit: "px" }];
    const css = themeStyleCss(draft);
    expect(css).toBe(".adp-tab{padding-inline:8px;}");
    expect(css).not.toContain("url(");
    expect(css).not.toContain("background:");

    expect(THEMES).toHaveLength(6);
    const settingsSource = read("src", "views", "settings", "ThemeSettings.tsx");
    expect(settingsSource).toContain("THEMES.filter");
    expect(settingsSource).not.toContain("customThemes");
  });

  it("the pages do not promise sunrise calculation or embedded fonts", () => {
    for (const language of ["en", "es"]) {
      const schedule = read("help", language, "day-and-night-themes.md").toLowerCase();
      expect(schedule).toMatch(/sunrise|amanecer/);
      expect(schedule).toMatch(/not offered|no se ofrecen/);
      const editor = read("help", language, "theme-editor.md").toLowerCase();
      expect(editor).toMatch(/font file|archivo/);
    }
  });
});
