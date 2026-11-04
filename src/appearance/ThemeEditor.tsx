/** Live, local-only custom theme editor (Step 10a).
 *
 * The draft is separate from the saved settings. The preview writes CSSOM
 * custom properties on its own subtree, so the app's root is never changed
 * before Save. All data is validated before it leaves this component.
 */
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import Slider from "../components/Slider";
import Switch from "../components/Switch";
import TextInput from "../components/TextInput";
import { errorText } from "../services/errors";
import { fileUrl } from "../services/files";
import {
  isSafeFontFamily,
  isThemeStyleRule,
  isThemeUuid,
  leaseThemeBackground,
  listSystemFontFamilies,
  MAX_THEME_STYLES,
  normalizeCustomTheme,
  pickThemeBackground,
  pickThemeToExport,
  pickThemeToImport,
  revokeThemeBackground,
  THEME_EDITOR_TOKEN_PATHS,
  THEME_STYLE_PROPERTIES,
  THEME_STYLE_SELECTORS,
  type CustomTheme,
  type ThemeStyleProperty,
  type ThemeStyleRule,
  type ThemeStyleSelector,
  type ThemeStyleUnit,
  type ThemeValue,
} from "../services/customThemes";
import {
  applyCustomThemeAttributes,
  clearCustomThemeAttributes,
  customThemeContrastProblems,
  customThemeCss,
  resolveMaterial,
} from "./themeResolver";
import { THEME_TOKEN_PATHS } from "./themeTokens";
import ThemeTokenEditor from "./ThemeTokenEditor";

export interface ThemeEditorProps {
  draft: CustomTheme;
  onSave: (theme: CustomTheme) => Promise<void>;
  onCancel: () => void;
  onOpenHelp: (slug: string) => void;
}

const PREVIEW_ID = "adp-theme-editor-preview";
const MATERIALS = ["solid", "mica", "acrylic"] as const;
const TAB_SHAPES = ["square", "rounded", "pill"] as const;
const ICON_MODES = ["lucide", "system"] as const;
const FITS = ["fill", "fit", "tile"] as const;

export default function ThemeEditor({ draft, onSave, onCancel, onOpenHelp }: ThemeEditorProps) {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<CustomTheme>(draft);
  const [fonts, setFonts] = useState<string[]>([]);
  const [backgroundToken, setBackgroundToken] = useState<{
    token: string;
    name: string;
    assetId: string;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Export reads the saved catalog entry, so an unsaved draft has none. */
  const [persisted, setPersisted] = useState(() => draft.modified_unix > 0);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const backgroundTokenRef = useRef(backgroundToken);
  backgroundTokenRef.current = backgroundToken;
  const liveRef = useRef(true);

  useEffect(() => {
    setTheme(draft);
    setPersisted(draft.modified_unix > 0);
  }, [draft]);

  useEffect(
    () => () => {
      liveRef.current = false;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void listSystemFontFamilies()
      .then((names) => {
        if (!cancelled) setFonts(names);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    applyCustomThemeAttributes(root, theme);
    return () => {
      clearCustomThemeAttributes(root, theme);
    };
  }, [theme]);

  useEffect(() => {
    const assetId = theme.background?.asset_id;
    if (!assetId) {
      setBackgroundToken(null);
      return;
    }
    if (backgroundTokenRef.current?.assetId === assetId) return;
    if (backgroundTokenRef.current) setBackgroundToken(null);
    let cancelled = false;
    void leaseThemeBackground(assetId)
      .then((asset) => {
        if (cancelled) {
          void revokeThemeBackground(asset.token).catch(() => undefined);
          return;
        }
        setBackgroundToken({ token: asset.token, name: asset.name, assetId });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [theme.background?.asset_id]);

  useEffect(
    () => () => {
      const token = backgroundTokenRef.current;
      if (token) void revokeThemeBackground(token.token).catch(() => undefined);
    },
    [backgroundToken],
  );

  const material = useMemo(() => resolveMaterial(theme.material), [theme.material]);
  const styleCss = useMemo(() => customThemeCss(theme, `#${PREVIEW_ID}`), [theme]);
  const patch = (next: Partial<CustomTheme>) => setTheme((current) => ({ ...current, ...next }));

  // The editor palette shares token paths with the main palette; keep both
  // maps in step so the layer applied last can never show a stale colour.
  const setToken = (path: string, value: ThemeValue) =>
    setTheme((current) => ({
      ...current,
      tokens: { ...current.tokens, [path]: value },
      ...(THEME_EDITOR_TOKEN_PATHS.includes(path)
        ? { editor_tokens: { ...current.editor_tokens, [path]: value } }
        : {}),
    }));
  const setEditorToken = (path: string, value: ThemeValue) =>
    setTheme((current) => ({
      ...current,
      editor_tokens: { ...current.editor_tokens, [path]: value },
      tokens: { ...current.tokens, [path]: value },
    }));

  const save = async () => {
    setMessage(null);
    const normalized = normalizeCustomTheme(theme);
    if (!normalized) {
      setMessage(t("errors.theme.invalid"));
      return;
    }
    if (customThemeContrastProblems(normalized).length > 0) {
      setMessage(t("errors.theme.contrast"));
      return;
    }
    setBusy(true);
    try {
      await onSave(normalized);
      if (liveRef.current) setPersisted(true);
    } catch (error) {
      setMessage(errorText(t, error, "theme"));
    } finally {
      setBusy(false);
    }
  };

  const importDraft = async () => {
    setMessage(null);
    try {
      const imported = await pickThemeToImport(
        t("themeEditor.import"),
        t("themeEditor.fileFilter"),
      );
      if (imported) {
        setPersisted(false);
        setTheme(imported);
      }
    } catch (error) {
      setMessage(errorText(t, error, "theme"));
    }
  };

  const exportDraft = async () => {
    setMessage(null);
    try {
      const result = await pickThemeToExport(
        theme.id,
        theme.background?.asset_id !== undefined,
        t("themeEditor.export"),
        `${theme.name}.adptheme`,
        t("themeEditor.fileFilter"),
      );
      if (result) setMessage(t("themeEditor.exported", { path: result.path }));
    } catch (error) {
      setMessage(errorText(t, error, "theme"));
    }
  };

  const chooseBackground = async () => {
    setMessage(null);
    try {
      const asset = await pickThemeBackground(
        t("themeEditor.background"),
        t("themeEditor.imageFilter"),
      );
      if (!asset) return;
      if (!liveRef.current) {
        void revokeThemeBackground(asset.token).catch(() => undefined);
        return;
      }
      // The picker already granted a token for this image; preview it
      // directly instead of leasing a second grant for the same asset.
      setBackgroundToken({ token: asset.token, name: asset.name, assetId: asset.asset_id });
      patch({
        background: {
          asset_id: asset.asset_id,
          fit: theme.background?.fit ?? "fill",
          opacity: theme.background?.opacity ?? 0.15,
          blur_px: theme.background?.blur_px ?? 0,
        },
      });
    } catch (error) {
      setMessage(errorText(t, error, "theme"));
    }
  };

  const toggleBackground = (on: boolean) => {
    if (!on) {
      patch({ background: undefined });
      return;
    }
    void chooseBackground();
  };

  const familyOptions = useMemo(() => {
    const options = [
      "Inter",
      "system-ui",
      ...fonts.filter((font) => font !== "Inter" && font !== "system-ui"),
    ];
    if (!options.includes(theme.ui_font)) options.push(theme.ui_font);
    return options;
  }, [fonts, theme.ui_font]);
  const background = theme.background;
  const previewBackground =
    background && backgroundToken
      ? {
          opacity: background.opacity,
          filter: `blur(${background.blur_px}px)`,
          backgroundImage: `url("${fileUrl(backgroundToken.token, backgroundToken.name)}")`,
          backgroundSize:
            background.fit === "fit" ? "contain" : background.fit === "tile" ? "auto" : "cover",
          backgroundRepeat: background.fit === "tile" ? "repeat" : "no-repeat",
          backgroundPosition: "center",
        }
      : undefined;
  const materialFallback = material.fallback && materialSupportKnown();

  return (
    <Dialog title={t("themeEditor.title")} onClose={onCancel} className="adp-theme-editor">
      <div className="adp-theme-editor-body">
        <div className="adp-theme-editor-controls">
          <div className="adp-theme-editor-heading">
            <span className="adp-heading">{t("themeEditor.new")}</span>
            <HelpButton onOpenHelp={() => onOpenHelp("theme-editor")} />
          </div>
          <label className="adp-theme-field">
            <span>{t("themeEditor.name")}</span>
            <TextInput value={theme.name} onChange={(name) => patch({ name })} maxLength={60} />
          </label>

          <fieldset className="adp-theme-fieldset">
            <legend>{t("themeEditor.material")}</legend>
            <div className="adp-button-row">
              {MATERIALS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="adp-theme-choice"
                  aria-pressed={theme.material === value}
                  data-material={value}
                  onClick={() => patch({ material: value })}
                >
                  {t(`themeEditor.${value}`)}
                </button>
              ))}
            </div>
            {materialFallback ? (
              <p className="adp-note" role="status" data-material-fallback="true">
                {t("errors.theme.unavailable")}
              </p>
            ) : null}
          </fieldset>

          <fieldset className="adp-theme-fieldset">
            <legend>{t("themeEditor.background")}</legend>
            <Switch checked={background !== undefined} onChange={toggleBackground} label={t("themeEditor.background")} />
            {background ? (
              <div className="adp-theme-background-options">
                <label className="adp-theme-field">
                  <span>{t("themeEditor.opacity")}</span>
                  <Slider
                    value={Math.round(background.opacity * 100)}
                    min={0}
                    max={50}
                    onChange={(value) => patch({ background: { ...background, opacity: value / 100 } })}
                    label={t("themeEditor.opacity")}
                  />
                </label>
                <label className="adp-theme-field">
                  <span>{t("themeEditor.blur")}</span>
                  <Slider
                    value={background.blur_px}
                    min={0}
                    max={32}
                    onChange={(value) => patch({ background: { ...background, blur_px: value } })}
                    label={t("themeEditor.blur")}
                  />
                </label>
                <label className="adp-theme-field">
                  <span>{t("themeEditor.background")}</span>
                  <select
                    className="adp-theme-select"
                    value={background.fit}
                    aria-label={t("themeEditor.background")}
                    onChange={(event) =>
                      patch({ background: { ...background, fit: event.target.value as (typeof FITS)[number] } })
                    }
                  >
                    {FITS.map((fit) => (
                      <option key={fit} value={fit}>
                        {t(`themeEditor.${fit}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </fieldset>

          <label className="adp-theme-field">
            <span>{t("themeEditor.font")}</span>
            <select
              className="adp-theme-select"
              value={theme.ui_font}
              aria-label={t("themeEditor.font")}
              onChange={(event) => patch({ ui_font: event.target.value })}
            >
              {familyOptions.map((font) => (
                <option key={font} value={font} disabled={!isSafeFontFamily(font)}>
                  {font === "system-ui" ? t("themeEditor.systemFont") : font}
                </option>
              ))}
            </select>
          </label>
          <label className="adp-theme-field">
            <span>{t("themeEditor.fontSize")}</span>
            <Slider
              value={theme.ui_font_size_px}
              min={10}
              max={24}
              onChange={(value) => patch({ ui_font_size_px: value })}
              label={t("themeEditor.fontSize")}
            />
          </label>

          <fieldset className="adp-theme-fieldset">
            <legend>{t("themeEditor.tabShape")}</legend>
            <div className="adp-button-row">
              {TAB_SHAPES.map((shape) => (
                <button
                  key={shape}
                  type="button"
                  className="adp-theme-choice"
                  aria-pressed={theme.tab_shape === shape}
                  data-tab-shape={shape}
                  onClick={() => patch({ tab_shape: shape })}
                >
                  {t(`themeEditor.${shape}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="adp-theme-fieldset">
            <legend>{t("themeEditor.icons")}</legend>
            <div className="adp-button-row">
              {ICON_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="adp-theme-choice"
                  aria-pressed={theme.icon_mode === mode}
                  data-icon-mode={mode}
                  onClick={() => patch({ icon_mode: mode })}
                >
                  {t(`themeEditor.${mode}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="adp-theme-fieldset">
            <legend>{t("themeEditor.editorColors")}</legend>
            <ThemeTokenEditor
              tokens={theme.editor_tokens}
              paths={THEME_EDITOR_TOKEN_PATHS}
              onChange={setEditorToken}
              idPrefix="theme-editor-colors"
            />
          </fieldset>

          <fieldset className="adp-theme-fieldset">
            <legend>{t("themeEditor.colors")}</legend>
            <ThemeTokenEditor
              tokens={theme.tokens}
              paths={THEME_TOKEN_PATHS}
              onChange={setToken}
              idPrefix="theme-tokens"
              labelKey="themeEditor.colors"
            />
          </fieldset>

          <StyleRows theme={theme} onChange={(styles) => patch({ styles })} />
        </div>

        <div className="adp-theme-editor-preview-column">
          <span className="adp-setting-label">{t("themeEditor.preview")}</span>
          <div
            id={PREVIEW_ID}
            ref={previewRef}
            className="adp-theme-preview-surface"
            data-theme-preview-kind="custom"
            role="group"
            aria-label={t("themeEditor.preview")}
          >
            <style>{styleCss}</style>
            {previewBackground ? (
              <div className="adp-theme-preview-background" style={previewBackground} aria-hidden="true" />
            ) : null}
            <div className="adp-theme-preview-chrome adp-window" data-tab-shape={theme.tab_shape}>
              <div className="adp-theme-preview-title">{theme.name}</div>
              <div className="adp-theme-preview-tabs" aria-hidden="true">
                <span className="adp-theme-preview-tab adp-tab adp-theme-preview-tab--active" />
                <span className="adp-theme-preview-tab adp-tab" />
              </div>
              <div className="adp-theme-preview-command adp-command-bar" aria-hidden="true">
                <span className="adp-theme-preview-command-item" />
                <span className="adp-theme-preview-command-item" />
                <span className="adp-theme-preview-command-item" />
              </div>
              <div className="adp-theme-preview-files adp-filelist-scroll" aria-hidden="true">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="adp-theme-preview-file">
                    <span className="adp-theme-preview-dot" />
                    <span
                      className={
                        index % 2 === 0
                          ? "adp-theme-preview-line"
                          : "adp-theme-preview-line adp-theme-preview-line--short"
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          {message ? (
            <p className="adp-theme-message" role="status">
              {message}
            </p>
          ) : null}
          <div className="adp-dialog-actions">
            <button type="button" className="adp-theme-choice" onClick={() => void importDraft()}>
              {t("themeEditor.import")}
            </button>
            <button
              type="button"
              className="adp-theme-choice"
              disabled={busy || !persisted || !isThemeUuid(theme.id)}
              onClick={() => void exportDraft()}
            >
              {t("themeEditor.export")}
            </button>
            <button type="button" className="adp-btn adp-btn--primary" disabled={busy} onClick={() => void save()}>
              {t("themeEditor.save")}
            </button>
            <button type="button" className="adp-btn" onClick={onCancel}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function StyleRows({ theme, onChange }: { theme: CustomTheme; onChange: (styles: ThemeStyleRule[]) => void }) {
  const { t } = useTranslation();
  const rows = theme.styles;
  const replace = (index: number, rule: ThemeStyleRule) =>
    onChange(rows.map((entry, position) => (position === index ? rule : entry)));
  const remove = (index: number) => onChange(rows.filter((_, position) => position !== index));
  return (
    <fieldset className="adp-theme-fieldset">
      <legend>{t("themeEditor.style")}</legend>
      <p className="adp-note">{t("themeEditor.styleLimit")}</p>
      {rows.map((rule, index) => (
        <div className="adp-theme-style-row" key={`style-${index}`}>
          <select
            className="adp-theme-select"
            value={rule.selector}
            aria-label={t("themeEditor.style")}
            onChange={(event) =>
              replace(index, { ...rule, selector: event.target.value as ThemeStyleSelector })
            }
          >
            {THEME_STYLE_SELECTORS.map((selector) => (
              <option key={selector} value={selector}>
                {selector}
              </option>
            ))}
          </select>
          <select
            className="adp-theme-select"
            value={rule.property}
            aria-label={t("themeEditor.style")}
            onChange={(event) => {
              const property = event.target.value as ThemeStyleProperty;
              replace(index, { ...rule, property, unit: unitFor(property), value: clampFor(property, rule.value) });
            }}
          >
            {THEME_STYLE_PROPERTIES.map((property) => (
              <option key={property} value={property}>
                {property}
              </option>
            ))}
          </select>
          <input
            className="adp-input adp-theme-style-value"
            type="number"
            value={rule.value}
            step={rule.unit === "ratio" ? 0.05 : 1}
            aria-label={t("themeEditor.style")}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) {
                const next = { ...rule, value: clampFor(rule.property, value) };
                if (isThemeStyleRule(next)) replace(index, next);
              }
            }}
          />
          <span className="adp-theme-style-unit">{rule.unit === "ratio" ? "" : "px"}</span>
          <button
            type="button"
            className="adp-icon-btn"
            aria-label={t("themeEditor.style")}
            onClick={() => remove(index)}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="adp-theme-choice"
        disabled={rows.length >= MAX_THEME_STYLES}
        aria-label={t("themeEditor.style")}
        onClick={() => onChange([...rows, { selector: ".adp-window", property: "border-radius", value: 8, unit: "px" }])}
      >
        <Plus size={16} aria-hidden="true" />
        {t("themeEditor.style")}
      </button>
    </fieldset>
  );
}

function materialSupportKnown(): boolean {
  if (typeof document !== "undefined" && document.documentElement.dataset.materialSupport !== undefined) {
    return true;
  }
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(forced-colors: active)").matches
  );
}

function unitFor(property: ThemeStyleProperty): ThemeStyleUnit {
  return property === "line-height" ? "ratio" : "px";
}

function clampFor(property: ThemeStyleProperty, value: number): number {
  if (property === "border-radius") return Math.min(16, Math.max(0, value));
  if (property === "padding-inline" || property === "padding-block") return Math.min(24, Math.max(0, value));
  if (property === "letter-spacing") return Math.min(2, Math.max(0, value));
  return Math.min(2, Math.max(1, value));
}
