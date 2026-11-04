import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  OfficeColor, OfficeFormatting, OfficeValue, ParagraphFormatPatch, TextFormatPatch,
} from "../types";

/** Text and paragraph controls (Step 22a T4, D5).
 *
 * A mixed selection is blank/indeterminate. It is never coerced to false or
 * to the first selected value, so opening the editor cannot silently rewrite
 * the deck's formatting. The controls send typed patches only. */

type TextField = "font" | "size_pt" | "bold" | "italic" | "underline" | "foreground";
type ParagraphField = "align" | "list";
type Mapping = Record<string, OfficeValue<unknown> | undefined>;

function group(formatting: OfficeFormatting | null, name: "text" | "paragraph"): Mapping {
  if (!formatting) return {};
  const mapped = (formatting as unknown as Record<string, unknown>)[name];
  return typeof mapped === "object" && mapped !== null ? (mapped as Mapping) : {};
}

/** `undefined` means mixed or unavailable; a checkbox/select must stay blank. */
export function textFormatControlValue(formatting: OfficeFormatting | null, field: TextField): unknown {
  const value = group(formatting, "text")[field];
  return value && value.kind === "value" ? value.value : undefined;
}

export function paragraphFormatControlValue(
  formatting: OfficeFormatting | null,
  field: ParagraphField,
): unknown {
  const value = group(formatting, "paragraph")[field];
  return value && value.kind === "value" ? value.value : undefined;
}

function familyValue(font: unknown): string {
  return typeof font === "object" && font !== null && "family" in font
    ? String((font as { family: unknown }).family)
    : "";
}

export interface DeckTextControlsProps {
  formatting: OfficeFormatting | null;
  disabled: boolean;
  onText: (patch: TextFormatPatch) => void;
  onParagraph: (patch: ParagraphFormatPatch) => void;
  onTextColor: (color: OfficeColor) => void;
  onFont: (family: string) => void;
  onSize: (sizePt: number) => void;
  onOpenHelp: (slug: string) => void;
}

export default function DeckTextControls({
  formatting,
  disabled,
  onText,
  onParagraph,
  onTextColor,
  onFont,
  onSize,
  onOpenHelp,
}: DeckTextControlsProps) {
  const { t } = useTranslation();
  const bold = textFormatControlValue(formatting, "bold");
  const italic = textFormatControlValue(formatting, "italic");
  const underline = textFormatControlValue(formatting, "underline");
  const size = textFormatControlValue(formatting, "size_pt");
  const font = textFormatControlValue(formatting, "font");
  const align = paragraphFormatControlValue(formatting, "align");
  const list = paragraphFormatControlValue(formatting, "list");
  const [sizeText, setSizeText] = useState(size === undefined ? "" : String(size));
  const [fontText, setFontText] = useState(familyValue(font));

  useEffect(() => {
    setSizeText(size === undefined ? "" : String(size));
  }, [size]);

  useEffect(() => {
    setFontText(familyValue(font));
  }, [font]);

  return (
    <div className="adp-deck-text-controls" role="toolbar" aria-label={t("officeDeck.group.font")}>
      <label className="adp-deck-field">
        <span>{t("officeDeck.font")}</span>
        <input
          type="text"
          value={fontText}
          disabled={disabled}
          aria-label={t("officeDeck.font")}
          onChange={(event) => setFontText(event.target.value)}
          onBlur={() => { if (fontText.trim() && fontText !== familyValue(font)) onFont(fontText.trim()); }}
          placeholder={font === undefined ? t("officeDeck.mixed") : undefined}
        />
      </label>
      <label className="adp-deck-field adp-deck-field--size">
        <span>{t("officeDeck.size")}</span>
        <input
          type="number"
          min={1}
          max={400}
          value={sizeText}
          disabled={disabled}
          aria-label={t("officeDeck.size")}
          placeholder={size === undefined ? t("officeDeck.mixed") : undefined}
          onChange={(event) => setSizeText(event.target.value)}
          onBlur={() => {
            const parsed = Number(sizeText);
            if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 400) onSize(parsed);
          }}
        />
      </label>
      <button
        type="button"
        className={"adp-ribbon-btn" + (bold === true ? " adp-ribbon-btn--pressed" : "")}
        aria-label={t("officeDeck.bold")}
        aria-pressed={bold === true ? true : bold === false ? false : "mixed"}
        disabled={disabled}
        onClick={() => onText({ bold: bold !== true })}
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        className={"adp-ribbon-btn" + (italic === true ? " adp-ribbon-btn--pressed" : "")}
        aria-label={t("officeDeck.italic")}
        aria-pressed={italic === true ? true : italic === false ? false : "mixed"}
        disabled={disabled}
        onClick={() => onText({ italic: italic !== true })}
      >
        <em>I</em>
      </button>
      <button
        type="button"
        className={"adp-ribbon-btn" + (underline !== "none" ? " adp-ribbon-btn--pressed" : "")}
        aria-label={t("officeDeck.underline")}
        aria-pressed={underline === undefined ? "mixed" : underline !== "none"}
        disabled={disabled}
        onClick={() => onText({ underline: underline === "none" ? "single" : "none" })}
      >
        <u>U</u>
      </button>
      <label className="adp-deck-field">
        <span>{t("officeDeck.textColor")}</span>
        <input
          type="color"
          aria-label={t("officeDeck.textColor")}
          disabled={disabled}
          value={colorHex(textFormatControlValue(formatting, "foreground"))}
          onChange={(event) => onTextColor(colorFromHex(event.target.value))}
        />
      </label>
      <span className="adp-deck-sep" aria-hidden="true" />
      <button
        type="button"
        className={"adp-ribbon-btn" + (align === "left" ? " adp-ribbon-btn--pressed" : "")}
        aria-label={t("officeDeck.alignLeft")}
        aria-pressed={align === undefined ? "mixed" : align === "left"}
        disabled={disabled}
        onClick={() => onParagraph({ align: "left" })}
      >
        L
      </button>
      <button
        type="button"
        className={"adp-ribbon-btn" + (align === "center" ? " adp-ribbon-btn--pressed" : "")}
        aria-label={t("officeDeck.alignCenter")}
        aria-pressed={align === undefined ? "mixed" : align === "center"}
        disabled={disabled}
        onClick={() => onParagraph({ align: "center" })}
      >
        C
      </button>
      <button
        type="button"
        className={"adp-ribbon-btn" + (align === "right" ? " adp-ribbon-btn--pressed" : "")}
        aria-label={t("officeDeck.alignRight")}
        aria-pressed={align === undefined ? "mixed" : align === "right"}
        disabled={disabled}
        onClick={() => onParagraph({ align: "right" })}
      >
        R
      </button>
      <button
        type="button"
        className={"adp-ribbon-btn" + (list === "disc" ? " adp-ribbon-btn--pressed" : "")}
        aria-label={t("officeDeck.bullets")}
        aria-pressed={list === undefined ? "mixed" : list === "disc"}
        disabled={disabled}
        onClick={() => onParagraph({ list: list === "disc" ? "none" : "disc" })}
      >
        •
      </button>
      <button
        type="button"
        className={"adp-ribbon-btn" + (list === "decimal" ? " adp-ribbon-btn--pressed" : "")}
        aria-label={t("officeDeck.numbering")}
        aria-pressed={list === undefined ? "mixed" : list === "decimal"}
        disabled={disabled}
        onClick={() => onParagraph({ list: list === "decimal" ? "none" : "decimal" })}
      >
        1.
      </button>
      <button
        type="button"
        className="adp-icon-btn"
        aria-label={t("help.title")}
        onClick={() => onOpenHelp("editing-presentations")}
      >
        ?
      </button>
    </div>
  );
}

export function colorHex(value: unknown): string {
  if (typeof value !== "object" || value === null) return "#000000";
  const color = value as Partial<OfficeColor>;
  const channel = (input: unknown) =>
    typeof input === "number" && Number.isFinite(input) ? Math.max(0, Math.min(255, Math.round(input))) : 0;
  return `#${[channel(color.r), channel(color.g), channel(color.b)]
    .map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

export function colorFromHex(value: string): OfficeColor {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  const number = match ? Number.parseInt(match[1], 16) : 0;
  return { r: (number >> 16) & 0xff, g: (number >> 8) & 0xff, b: number & 0xff, a: 255 };
}
