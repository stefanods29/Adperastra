/** Puts the theme and appearance on the root element (Step 05d). */
import type { AppearanceSettings, ThemeSettings } from "../services/settings";
import { resolveThemeId, themeScheme } from "./themes";

/** `data-theme` picks the token block; `data-scheme` sets `color-scheme`. */
export function applyThemeAttributes(root: HTMLElement, theme: ThemeSettings, systemDark: boolean): void {
  const id = resolveThemeId(theme, systemDark);
  root.dataset.theme = id;
  root.dataset.scheme = themeScheme(id);
}

/** `data-density`, `data-radius` and `data-motion` drive appearance.css. */
export function applyAppearanceAttributes(root: HTMLElement, appearance: AppearanceSettings): void {
  root.dataset.density = appearance.density;
  root.dataset.radius = appearance.corner_radius;
  root.dataset.motion = appearance.animations;
}
