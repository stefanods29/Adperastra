import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import TextInput from "../components/TextInput";
import { fail, isUuid, MAX_TEXT_SCALARS, type Rect, type TextLayer } from "./types";

/** Editable text layers (Step 18b D5/T4).
 *
 * Text is a plain string in the document; it is never parsed as HTML and the
 * panel uses text boxes, not contenteditable markup. The licensed font list
 * is supplied by the caller (Inter 4.1 by default) and no system font is
 * uploaded. */

export interface FontOption {
  id: string;
  labelKey: string;
}

export const DEFAULT_FONT_OPTIONS: readonly FontOption[] = [
  { id: "inter-regular", labelKey: "textLayer.interRegular" },
  { id: "inter-bold", labelKey: "textLayer.interBold" },
  { id: "inter-italic", labelKey: "textLayer.interItalic" },
  { id: "inter-bold-italic", labelKey: "textLayer.interBoldItalic" },
];

export interface TextLayerEditorProps {
  layer: TextLayer;
  fontOptions?: readonly FontOption[];
  onChange: (layer: TextLayer) => void;
  onApply: () => void;
  onClose: () => void;
}

function scalarLength(value: string): number {
  return Array.from(value).length;
}

export function validateTextLayerDraft(layer: TextLayer): void {
  if (!layer || layer.kind !== "text") fail("image_edit.bad_request");
  if (!isUuid(layer.id)) fail("image_edit.bad_request");
  if (typeof layer.name !== "string" || Array.from(layer.name).length < 1 || Array.from(layer.name).length > 128) {
    fail("image_edit.bad_request");
  }
  if (typeof layer.text !== "string" || scalarLength(layer.text) > MAX_TEXT_SCALARS) fail("image_edit.bad_request");
  if (typeof layer.font_asset_id !== "string" || layer.font_asset_id.length < 1 || layer.font_asset_id.length > 128) {
    fail("image_edit.bad_request");
  }
  if (!Number.isFinite(layer.font_size) || layer.font_size < 1 || layer.font_size > 512) fail("image_edit.bad_request");
  if (!Array.isArray(layer.color) || layer.color.length !== 4) fail("image_edit.bad_request");
  for (const channel of layer.color) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) fail("image_edit.bad_request");
  }
  if (
    !layer.bounds ||
    ![layer.bounds.x, layer.bounds.y, layer.bounds.width, layer.bounds.height].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) ||
    layer.bounds.width < 1 ||
    layer.bounds.height < 1
  ) {
    fail("image_edit.bad_request");
  }
  if (layer.align !== "left" && layer.align !== "center" && layer.align !== "right") fail("image_edit.bad_request");
}

/** Unicode-safe document form. Tests compare the parsed layer with the
 * original, never a lossy display string. */
export function serializeTextLayer(layer: TextLayer): string {
  validateTextLayerDraft(layer);
  return JSON.stringify(layer);
}

export function parseTextLayer(serialized: string): TextLayer {
  if (typeof serialized !== "string") fail("image_edit.bad_request");
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    fail("image_edit.bad_request");
  }
  if (!value || typeof value !== "object") fail("image_edit.bad_request");
  const layer = value as TextLayer;
  validateTextLayerDraft(layer);
  return layer;
}

function colorToHex(color: readonly [number, number, number, number]): string {
  return `#${[color[0], color[1], color[2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function hexToColor(hex: string, alpha: number): [number, number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return null;
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16), alpha];
}

function numberOr(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function withBounds(layer: TextLayer, patch: Partial<Rect>): TextLayer {
  return { ...layer, bounds: { ...layer.bounds, ...patch } };
}

export default function TextLayerEditor({
  layer,
  fontOptions = DEFAULT_FONT_OPTIONS,
  onChange,
  onApply,
  onClose,
}: TextLayerEditorProps) {
  const { t } = useTranslation();
  const options = fontOptions.some((option) => option.id === layer.font_asset_id)
    ? fontOptions
    : [...fontOptions, { id: layer.font_asset_id, labelKey: "textLayer.currentFont" }];
  return (
    <div className="adp-paint-popover adp-paint-text-editor" role="dialog" aria-label={t("textLayer.title")}>
      <label className="adp-paint-field">
        <span>{t("textLayer.content")}</span>
        <TextInput
          value={layer.text}
          ariaLabel={t("textLayer.content")}
          maxLength={20000}
          onChange={(text) => {
            if (scalarLength(text) > MAX_TEXT_SCALARS) return;
            onChange({ ...layer, text });
          }}
        />
      </label>
      <label className="adp-paint-field">
        <span>{t("textLayer.font")}</span>
        <select
          className="adp-input"
          value={layer.font_asset_id}
          aria-label={t("textLayer.font")}
          onChange={(event) => onChange({ ...layer, font_asset_id: event.target.value })}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </label>
      <div className="adp-paint-row">
        <label className="adp-paint-field">
          <span>{t("textLayer.size")}</span>
          <TextInput
            type="number"
            value={String(layer.font_size)}
            ariaLabel={t("textLayer.size")}
            onChange={(text) => {
              const size = numberOr(text, layer.font_size);
              if (size < 1 || size > 512) return;
              onChange({ ...layer, font_size: size });
            }}
            maxLength={6}
          />
        </label>
        <label className="adp-paint-field">
          <span>{t("imageEdit.color")}</span>
          <TextInput
            type="color"
            value={colorToHex(layer.color)}
            ariaLabel={t("imageEdit.color")}
            onChange={(text) => {
              const color = hexToColor(text, layer.color[3]);
              if (color) onChange({ ...layer, color });
            }}
          />
        </label>
        <label className="adp-paint-field">
          <span>{t("imageEdit.opacity")}</span>
          <TextInput
            type="number"
            value={String(layer.color[3])}
            ariaLabel={t("imageEdit.opacity")}
            onChange={(text) => {
              const alpha = Math.round(numberOr(text, layer.color[3]));
              if (alpha < 0 || alpha > 255) return;
              onChange({ ...layer, color: [layer.color[0], layer.color[1], layer.color[2], alpha] });
            }}
            maxLength={3}
          />
        </label>
      </div>
      <fieldset className="adp-paint-field adp-paint-align">
        <legend>{t("textLayer.align")}</legend>
        {(["left", "center", "right"] as const).map((align) => (
          <Button
            key={align}
            variant={layer.align === align ? "primary" : "subtle"}
            aria-pressed={layer.align === align}
            onClick={() => onChange({ ...layer, align })}
          >
            {t(`textLayer.${align}`)}
          </Button>
        ))}
      </fieldset>
      <div className="adp-paint-row">
        <label className="adp-paint-field">
          <span>{t("textLayer.x")}</span>
          <TextInput
            type="number"
            value={String(layer.bounds.x)}
            ariaLabel={t("textLayer.x")}
            onChange={(text) => onChange(withBounds(layer, { x: numberOr(text, layer.bounds.x) }))}
            maxLength={8}
          />
        </label>
        <label className="adp-paint-field">
          <span>{t("textLayer.y")}</span>
          <TextInput
            type="number"
            value={String(layer.bounds.y)}
            ariaLabel={t("textLayer.y")}
            onChange={(text) => onChange(withBounds(layer, { y: numberOr(text, layer.bounds.y) }))}
            maxLength={8}
          />
        </label>
        <label className="adp-paint-field">
          <span>{t("textLayer.boxWidth")}</span>
          <TextInput
            type="number"
            value={String(layer.bounds.width)}
            ariaLabel={t("textLayer.boxWidth")}
            onChange={(text) => {
              const width = numberOr(text, layer.bounds.width);
              if (width >= 1) onChange(withBounds(layer, { width }));
            }}
            maxLength={8}
          />
        </label>
        <label className="adp-paint-field">
          <span>{t("textLayer.boxHeight")}</span>
          <TextInput
            type="number"
            value={String(layer.bounds.height)}
            ariaLabel={t("textLayer.boxHeight")}
            onChange={(text) => {
              const height = numberOr(text, layer.bounds.height);
              if (height >= 1) onChange(withBounds(layer, { height }));
            }}
            maxLength={8}
          />
        </label>
      </div>
      <div className="adp-paint-popover-actions">
        <Button variant="primary" onClick={onApply}>
          {t("common.apply")}
        </Button>
        <Button variant="subtle" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}
