/** Readable accent colours from the local wallpaper (Step 10a).
 *
 * Wallpaper pixels stay on this PC. The picker never scans pictures; it reads
 * only the path Windows reports for the current desktop background.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../components/HelpButton";
import Skeleton from "../components/Skeleton";
import Switch from "../components/Switch";
import {
  THEME_CANONICAL_TYPE_IDS,
  type ThemeColor,
  type ThemeCustomSettings,
  type ThemeTypeId,
} from "../services/customThemes";
import type { ThemeSettings } from "../services/settings";
import {
  accentMeetsContrast,
  resolveReadableAccent,
  type ReadableAccent,
} from "./themeMath";
import { useWallpaperPalette } from "./useWallpaperPalette";

/** The first wallpaper colour that stays readable on every used surface. */
function firstReadableAccent(
  colors: readonly ThemeColor[],
  backgrounds: readonly ThemeColor[],
): ReadableAccent | null {
  for (const color of colors) {
    const resolved = resolveReadableAccent(color, backgrounds);
    if (accentMeetsContrast(resolved.accent, backgrounds)) return resolved;
  }
  return null;
}

export interface WallpaperAccentPickerProps {
  theme: ThemeSettings;
  value: ThemeCustomSettings;
  /** The surfaces the chosen accent must stay readable against. */
  backgrounds: readonly ThemeColor[];
  onChangeTheme: (theme: ThemeSettings) => void;
  onChange: (value: ThemeCustomSettings) => void;
  onOpenHelp: (slug: string) => void;
}

export default function WallpaperAccentPicker({
  theme,
  value,
  backgrounds,
  onChangeTheme,
  onChange,
  onOpenHelp,
}: WallpaperAccentPickerProps) {
  const { t } = useTranslation();
  const { palette, loading, reload } = useWallpaperPalette(value.follow_wallpaper);
  const [message, setMessage] = useState<string | null>(null);
  const [customColor, setCustomColor] = useState(theme.accent_custom ?? "#0067C0");
  const latest = useRef({ theme, backgrounds, onChangeTheme });
  latest.current = { theme, backgrounds, onChangeTheme };

  useEffect(() => {
    setCustomColor(theme.accent_custom ?? "#0067C0");
  }, [theme.accent_custom]);

  // "Always follow wallpaper" is an opt-in: the first readable wallpaper
  // colour becomes the accent when the palette arrives or changes. A colour
  // that cannot reach normal-text contrast is skipped, never forced.
  useEffect(() => {
    if (!value.follow_wallpaper || !palette?.available || palette.colors.length === 0) return;
    const current = latest.current;
    const resolved = firstReadableAccent(palette.colors, current.backgrounds);
    if (!resolved) {
      setMessage(t("themeAccent.fallback"));
      return;
    }
    if (current.theme.accent_custom === resolved.accent) return;
    setMessage(resolved.adjusted ? t("themeAccent.adjusted") : null);
    current.onChangeTheme({ ...current.theme, accent_source: "custom", accent_custom: resolved.accent });
  }, [palette, value.follow_wallpaper, t]);

  const choose = (candidate: ThemeColor, typeId?: ThemeTypeId): ThemeColor | null => {
    const resolved = resolveReadableAccent(candidate, backgrounds);
    if (!accentMeetsContrast(resolved.accent, backgrounds)) {
      setMessage(t("themeAccent.fallback"));
      return null;
    }
    setMessage(resolved.adjusted ? t("themeAccent.adjusted") : null);
    if (typeId) {
      onChange({ ...value, type_accents: { ...value.type_accents, [typeId]: resolved.accent } });
      return resolved.accent;
    }
    onChangeTheme({ ...theme, accent_source: "custom", accent_custom: resolved.accent });
    return resolved.accent;
  };

  const colors = palette?.available ? palette.colors : [];
  const showSkeleton = loading || palette === null;

  return (
    <section className="adp-settings-section adp-theme-accent" aria-labelledby="adp-theme-accent-title">
      <div className="adp-view-header">
        <h3 id="adp-theme-accent-title" className="adp-heading">
          {t("themeAccent.title")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("accent-colors")} />
      </div>

      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("themeAccent.wallpaper")}</span>
        {showSkeleton ? (
          <div className="adp-theme-accent-swatches" aria-busy="true">
            <Skeleton variant="tiles" count={3} />
          </div>
        ) : colors.length > 0 ? (
          <div className="adp-theme-accent-swatches">
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                className="adp-theme-accent-swatch"
                style={{ background: color }}
                aria-label={color}
                data-accent-color={color}
                onClick={() => {
                  const applied = choose(color);
                  if (applied) setCustomColor(applied);
                }}
              />
            ))}
          </div>
        ) : (
          <p className="adp-note">{t("errors.theme.wallpaper_unavailable")}</p>
        )}
      </div>

      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("themeAccent.title")}</span>
        <div className="adp-button-row">
          <label className="adp-button-row">
            <span>{t("settings.customColor")}</span>
            <input
              className="adp-color-input"
              type="color"
              value={customColor}
              aria-label={t("settings.customColor")}
              onChange={(event) => {
                const applied = choose(event.target.value.toUpperCase());
                if (applied) setCustomColor(applied);
              }}
            />
          </label>
        </div>
      </div>

      <Switch
        checked={value.follow_wallpaper}
        onChange={(follow_wallpaper) => {
          onChange({ ...value, follow_wallpaper });
          if (follow_wallpaper) void reload();
        }}
        label={t("themeAccent.follow")}
      />

      {message ? (
        <p className="adp-note" role="status">
          {message}
        </p>
      ) : null}

      <div className="adp-theme-accent-types">
        {THEME_CANONICAL_TYPE_IDS.map((id) => {
          const stored = value.type_accents[id];
          return (
            <label key={id} className="adp-theme-accent-type">
              <span>{t(`themeAccent.type${id.charAt(0).toUpperCase()}${id.slice(1)}`)}</span>
              <select
                className="adp-theme-select"
                value={stored ?? ""}
                aria-label={t(`themeAccent.type${id.charAt(0).toUpperCase()}${id.slice(1)}`)}
                onChange={(event) => {
                  const color = event.target.value;
                  if (color === "") {
                    const next = { ...value.type_accents };
                    delete next[id];
                    onChange({ ...value, type_accents: next });
                    return;
                  }
                  choose(color, id);
                }}
              >
                <option value="">{t("settings.accentDesign")}</option>
                {stored !== undefined && !colors.includes(stored) ? (
                  <option value={stored}>{stored}</option>
                ) : null}
                {colors.map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    </section>
  );
}
