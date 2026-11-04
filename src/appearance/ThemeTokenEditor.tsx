/** Allowlisted colour rows for a custom theme (Step 10a).
 *
 * No raw token path is shown and no CSS text is accepted: a row edits one
 * validated `#RRGGBB` or `#RRGGBBAA` value. Rows stay mounted, so focus is
 * never lost when another row changes.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ThemeValue } from "../services/customThemes";
import { isThemeColor, normalizeThemeColor, themeTokenAllowsAlpha, themeTokenSpec } from "./themeTokens";

export interface ThemeTokenEditorProps {
  tokens: Record<string, ThemeValue>;
  paths: readonly string[];
  onChange: (path: string, value: ThemeValue) => void;
  idPrefix: string;
  /** Translation key for the row group; defaults to the editor palette. */
  labelKey?: string;
}

export default function ThemeTokenEditor({
  tokens,
  paths,
  onChange,
  idPrefix,
  labelKey = "themeEditor.editorColors",
}: ThemeTokenEditorProps) {
  const { t } = useTranslation();
  const colorPaths = paths.filter((path) => themeTokenSpec(path)?.kind === "color");
  return (
    <div className="adp-theme-token-list">
      {colorPaths.map((path, index) => (
        <ThemeTokenRow
          key={path}
          id={`${idPrefix}-${index}`}
          path={path}
          value={tokens[path]}
          label={`${t(labelKey)} ${index + 1}`}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

interface ThemeTokenRowProps {
  id: string;
  path: string;
  value: ThemeValue | undefined;
  label: string;
  onChange: (path: string, value: ThemeValue) => void;
}

function ThemeTokenRow({ id, path, value, label, onChange }: ThemeTokenRowProps) {
  // Alpha is a data rule, not a UI preference: text colours and most accents
  // must stay opaque, so a pasted 8-digit value is trimmed to its RGB part.
  const allowsAlpha = themeTokenAllowsAlpha(path);
  const fit = (candidate: string) => (allowsAlpha ? candidate : candidate.slice(0, 7));
  const initial = typeof value === "string" && isThemeColor(value) ? fit(normalizeThemeColor(value)!) : "#000000";
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (typeof value === "string" && isThemeColor(value)) {
      const normalized = normalizeThemeColor(value)!;
      setText(allowsAlpha ? normalized : normalized.slice(0, 7));
    }
  }, [value, allowsAlpha]);
  const opaque = text.length === 7 ? text : `#${text.slice(1, 7)}`;
  return (
    <div className="adp-theme-token-row">
      <input
        id={`${id}-picker`}
        className="adp-theme-token-swatch"
        type="color"
        value={opaque}
        aria-label={label}
        onChange={(event) => {
          const alpha = allowsAlpha && text.length === 9 ? text.slice(7) : "";
          const next = `${event.target.value.toUpperCase()}${alpha}`;
          setText(next);
          onChange(path, next);
        }}
      />
      <input
        id={`${id}-text`}
        className="adp-input adp-theme-token-hex"
        type="text"
        value={text}
        maxLength={allowsAlpha ? 9 : 7}
        spellCheck={false}
        aria-label={label}
        onChange={(event) => {
          const next = fit(event.target.value.toUpperCase());
          setText(next);
          if (isThemeColor(next)) onChange(path, normalizeThemeColor(next)!);
        }}
        onBlur={() => {
          if (!isThemeColor(text)) setText(initial);
        }}
      />
    </div>
  );
}
