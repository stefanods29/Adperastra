import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import Button from "../components/Button";
import Switch from "../components/Switch";
import TextInput from "../components/TextInput";
import { getImageEditorModel } from "./ImageDocument";
import { MAX_LAYERS } from "./layerTypes";
import { commitImageTransaction } from "./transactions";
import {
  fail,
  isUuid,
  newUuid,
  validateOverlay,
  type ImageLayer,
  type ImageModel,
  type ImageOverlay,
  type ImageSize,
  type Point,
  type ShapeLayer,
  type TextLayer,
} from "./types";

/** Editable shape layers (Step 18b D5/T4).
 *
 * A shape layer stores the 14b typed `ImageOverlay`; it is never converted to
 * SVG text, never injected as markup and never executed. Basic 14b overlays
 * convert to layers in one undoable transaction. */

export interface ShapeLayerEditorProps {
  layer: ShapeLayer;
  canvas: ImageSize;
  onChange: (layer: ShapeLayer) => void;
  onApply: () => void;
  onClose: () => void;
}

export function validateShapeLayerDraft(layer: ShapeLayer, canvas: ImageSize): void {
  if (!layer || layer.kind !== "shape") fail("image_edit.bad_request");
  if (!isUuid(layer.id)) fail("image_edit.bad_request");
  if (typeof layer.name !== "string" || Array.from(layer.name).length < 1 || Array.from(layer.name).length > 128) {
    fail("image_edit.bad_request");
  }
  validateOverlay(layer.overlay, canvas);
}

export function serializeShapeLayer(layer: ShapeLayer, canvas: ImageSize): string {
  validateShapeLayerDraft(layer, canvas);
  return JSON.stringify(layer);
}

export function parseShapeLayer(serialized: string, canvas: ImageSize): ShapeLayer {
  if (typeof serialized !== "string") fail("image_edit.bad_request");
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    fail("image_edit.bad_request");
  }
  if (!value || typeof value !== "object") fail("image_edit.bad_request");
  const layer = value as ShapeLayer;
  validateShapeLayerDraft(layer, canvas);
  return layer;
}

function withOverlay(layer: ShapeLayer, patch: Partial<ImageOverlay>): ShapeLayer {
  return { ...layer, overlay: { ...layer.overlay, ...patch } };
}

function numberOr(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function colorToHex(color: readonly [number, number, number, number]): string {
  return `#${[color[0], color[1], color[2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function hexToColor(hex: string, alpha: number): [number, number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return null;
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16), alpha];
}

export default function ShapeLayerEditor({ layer, canvas, onChange, onApply, onClose }: ShapeLayerEditorProps) {
  const { t } = useTranslation();
  const overlay = layer.overlay;
  const endpoint: Point = overlay.points[1] ?? { x: overlay.bounds.x, y: overlay.bounds.y };
  return (
    <div className="adp-paint-popover adp-paint-shape-editor" role="dialog" aria-label={t("shapeLayer.title")}>
      <label className="adp-paint-field">
        <span>{t("shapeLayer.kind")}</span>
        <select
          className="adp-input"
          value={overlay.kind}
          aria-label={t("shapeLayer.kind")}
          onChange={(event) => {
            const kind = event.target.value as ImageOverlay["kind"];
            onChange(withOverlay(layer, { kind }));
          }}
        >
          {(["rectangle", "ellipse", "arrow", "highlight", "stroke", "text"] as const).map((kind) => (
            <option key={kind} value={kind}>
              {t(`shapeLayer.${kind}`)}
            </option>
          ))}
        </select>
      </label>
      {overlay.kind === "text" ? (
        <label className="adp-paint-field">
          <span>{t("imageEdit.textLabel")}</span>
          <textarea
            className="adp-input adp-paint-textarea"
            value={overlay.text ?? ""}
            aria-label={t("imageEdit.textLabel")}
            rows={2}
            maxLength={20000}
            onChange={(event) => onChange(withOverlay(layer, { text: event.target.value }))}
          />
        </label>
      ) : null}
      <div className="adp-paint-row">
        <label className="adp-paint-field">
          <span>{t("imageEdit.width")}</span>
          <TextInput
            type="number"
            value={String(overlay.width)}
            ariaLabel={t("imageEdit.width")}
            onChange={(text) => {
              const width = numberOr(text, overlay.width);
              if (width < 1 || width > 512) return;
              onChange(withOverlay(layer, { width }));
            }}
            maxLength={6}
          />
        </label>
        <label className="adp-paint-field">
          <span>{t("imageEdit.opacity")}</span>
          <TextInput
            type="number"
            value={String(Math.round(overlay.opacity * 100))}
            ariaLabel={t("imageEdit.opacity")}
            onChange={(text) => {
              const percent = numberOr(text, Math.round(overlay.opacity * 100));
              if (percent < 0 || percent > 100) return;
              onChange(withOverlay(layer, { opacity: percent / 100 }));
            }}
            maxLength={4}
          />
        </label>
        <label className="adp-paint-field">
          <span>{t("imageEdit.color")}</span>
          <TextInput
            type="color"
            value={colorToHex(overlay.color)}
            ariaLabel={t("imageEdit.color")}
            onChange={(text) => {
              const color = hexToColor(text, overlay.color[3]);
              if (color) onChange(withOverlay(layer, { color }));
            }}
          />
        </label>
      </div>
      <label className="adp-paint-field">
        <span>{t("shapeLayer.fillColor")}</span>
        <Switch
          checked={Boolean(overlay.fill)}
          label={t("shapeLayer.fillColor")}
          onChange={(checked) =>
            onChange(withOverlay(layer, { fill: checked ? [overlay.color[0], overlay.color[1], overlay.color[2], 255] : undefined }))
          }
        />
      </label>
      {overlay.fill ? (
        <label className="adp-paint-field">
          <span>{t("shapeLayer.fillColor")}</span>
          <TextInput
            type="color"
            value={colorToHex(overlay.fill)}
            ariaLabel={t("shapeLayer.fillColor")}
            onChange={(text) => {
              const fill = hexToColor(text, overlay.fill?.[3] ?? 255);
              if (fill) onChange(withOverlay(layer, { fill }));
            }}
          />
        </label>
      ) : null}
      <div className="adp-paint-row">
        <label className="adp-paint-field">
          <span>{t("shapeLayer.x")}</span>
          <TextInput
            type="number"
            value={String(overlay.bounds.x)}
            ariaLabel={t("shapeLayer.x")}
            onChange={(text) => onChange(withOverlay(layer, { bounds: { ...overlay.bounds, x: numberOr(text, overlay.bounds.x) } }))}
            maxLength={8}
          />
        </label>
        <label className="adp-paint-field">
          <span>{t("shapeLayer.y")}</span>
          <TextInput
            type="number"
            value={String(overlay.bounds.y)}
            ariaLabel={t("shapeLayer.y")}
            onChange={(text) => onChange(withOverlay(layer, { bounds: { ...overlay.bounds, y: numberOr(text, overlay.bounds.y) } }))}
            maxLength={8}
          />
        </label>
        <label className="adp-paint-field">
          <span>{t("textLayer.boxWidth")}</span>
          <TextInput
            type="number"
            value={String(overlay.bounds.width)}
            ariaLabel={t("textLayer.boxWidth")}
            onChange={(text) => {
              const width = numberOr(text, overlay.bounds.width);
              if (width >= 1) onChange(withOverlay(layer, { bounds: { ...overlay.bounds, width } }));
            }}
            maxLength={8}
          />
        </label>
        <label className="adp-paint-field">
          <span>{t("textLayer.boxHeight")}</span>
          <TextInput
            type="number"
            value={String(overlay.bounds.height)}
            ariaLabel={t("textLayer.boxHeight")}
            onChange={(text) => {
              const height = numberOr(text, overlay.bounds.height);
              if (height >= 1) onChange(withOverlay(layer, { bounds: { ...overlay.bounds, height } }));
            }}
            maxLength={8}
          />
        </label>
      </div>
      {overlay.kind === "arrow" || overlay.kind === "stroke" ? (
        <div className="adp-paint-row">
          <label className="adp-paint-field">
            <span>{t("shapeLayer.endX")}</span>
            <TextInput
              type="number"
              value={String(endpoint.x)}
              ariaLabel={t("shapeLayer.endX")}
              onChange={(text) => {
                const point = { ...endpoint, x: numberOr(text, endpoint.x) };
                const points = [...overlay.points];
                points[1] = point;
                onChange(withOverlay(layer, { points }));
              }}
              maxLength={8}
            />
          </label>
          <label className="adp-paint-field">
            <span>{t("shapeLayer.endY")}</span>
            <TextInput
              type="number"
              value={String(endpoint.y)}
              ariaLabel={t("shapeLayer.endY")}
              onChange={(text) => {
                const point = { ...endpoint, y: numberOr(text, endpoint.y) };
                const points = [...overlay.points];
                points[1] = point;
                onChange(withOverlay(layer, { points }));
              }}
              maxLength={8}
            />
          </label>
        </div>
      ) : null}
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

function textLayerFromOverlay(overlay: ImageOverlay, name: string): TextLayer {
  return {
    kind: "text",
    id: newUuid(),
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: "normal",
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    mask_id: null,
    text: overlay.text ?? "",
    font_asset_id: "inter-regular",
    font_size: overlay.font_size ?? 24,
    color: overlay.color,
    bounds: overlay.bounds,
    align: "left",
  };
}

function shapeLayerFromOverlay(overlay: ImageOverlay, name: string): ShapeLayer {
  return {
    kind: "shape",
    id: newUuid(),
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: "normal",
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    mask_id: null,
    overlay: { ...overlay, points: overlay.points.map((point) => ({ ...point })) },
  };
}

/** Converts every basic 14b overlay into one editable layer in a single
 * undoable transaction. Without overlays nothing is committed. */
export async function convertBasicOverlays(documentId: string, expectedContentId: string): Promise<void> {
  if (typeof documentId !== "string" || documentId.length === 0) fail("image_edit.bad_request");
  const model = getImageEditorModel(documentId);
  if (!model || model.content_id !== expectedContentId) fail("image_edit.changed");
  if (model.overlays.length === 0) return;
  const shapeName = i18n.t("shapeLayer.title");
  const textName = i18n.t("imageEdit.text");
  const created: ImageLayer[] = model.overlays.map((overlay) =>
    overlay.kind === "text" ? textLayerFromOverlay(overlay, textName) : shapeLayerFromOverlay(overlay, shapeName),
  );
  if (model.layers.length + created.length > MAX_LAYERS) fail("image_layers.too_large");
  await commitImageTransaction(documentId, expectedContentId, (current: Readonly<ImageModel>) => {
    if (current.layers.length + created.length > MAX_LAYERS) fail("image_layers.too_large");
    return {
      ...current,
      layers: [...current.layers, ...created],
      overlays: [],
    };
  });
}
