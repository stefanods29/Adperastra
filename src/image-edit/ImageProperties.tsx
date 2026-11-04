import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Slider from "../components/Slider";
import { filterDefinitions } from "./filters";
import type { DrawTool } from "./DrawTools";
import { normalizeAdjustments, presetAdjustments } from "./adjustments";
import { rotateGeometry, setCrop, setOutputSize, resizeDimensions } from "./geometry";
import {
  type AdjustmentPreset,
  type ImageAdjustments,
  type ImageGeometry,
  type ImageModel,
  type ImageSize,
  type Rect,
} from "./types";

/** Right-hand properties panel (300 px; flyout below 900 px). The panel only
 * edits pending values; Apply commits one transaction. */

export type EditSection = "crop" | "size" | "adjust" | "filters" | "markup" | "erase" | "draw";

export interface BrushSettings {
  color: [number, number, number, number];
  width: number;
  hardness: number;
  opacity: number;
  text?: string;
}

export interface ImagePropertiesProps {
  model: Readonly<ImageModel>;
  /** Original oriented source size; crop values are in these pixels. */
  source: ImageSize;
  overlayText: string;
  onOverlayText: (text: string) => void;
  mode: "edit" | "draw";
  section: EditSection;
  tool: DrawTool;
  brush: BrushSettings;
  background: [number, number, number, number];
  transparent: boolean;
  opaqueFormat: boolean;
  onBrush: (brush: BrushSettings) => void;
  onBackground: (color: [number, number, number, number]) => void;
  onTransparent: (value: boolean) => void;
  onAdjustments: (adjustments: ImageAdjustments) => void;
  onGeometry: (geometry: ImageGeometry) => void;
}

function toHex([r, g, b]: [number, number, number, number]): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function fromHex(value: string, alpha: number): [number, number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) return [255, 255, 255, alpha];
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16), alpha];
}

export default function ImageProperties(props: ImagePropertiesProps) {
  const { t } = useTranslation();
  const { model, section, tool, brush } = props;
  const [adjustments, setAdjustments] = useState<ImageAdjustments>(() => normalizeAdjustments(model.adjustments));
  const [crop, setCropFields] = useState({
    x: String(model.geometry.crop.x),
    y: String(model.geometry.crop.y),
    width: String(model.geometry.crop.width),
    height: String(model.geometry.crop.height),
  });
  const [size, setSize] = useState({
    width: String(model.geometry.output_size.width),
    height: String(model.geometry.output_size.height),
    percent: "100",
    keep: true,
    upscale: false,
  });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setAdjustments(normalizeAdjustments(model.adjustments));
  }, [model.adjustments]);
  useEffect(() => {
    const next = model.geometry.crop;
    setCropFields({ x: String(next.x), y: String(next.y), width: String(next.width), height: String(next.height) });
  }, [model.geometry.crop]);
  useEffect(() => {
    setSize((current) => ({
      ...current,
      width: String(model.geometry.output_size.width),
      height: String(model.geometry.output_size.height),
    }));
  }, [model.geometry.output_size]);

  const commitCrop = (values: Rect) => {
    if (![values.x, values.y, values.width, values.height].every(Number.isFinite) || values.width < 1 || values.height < 1) {
      setNotice(t("errors.image_edit.failed"));
      return;
    }
    try {
      const geometry = setCrop(model.geometry, props.source, values);
      setCropFields({ x: String(geometry.crop.x), y: String(geometry.crop.y), width: String(geometry.crop.width), height: String(geometry.crop.height) });
      props.onGeometry(geometry);
      setNotice(null);
    } catch {
      setNotice(t("errors.image_edit.failed"));
    }
  };

  const applyCrop = () =>
    commitCrop({
      x: Number(crop.x),
      y: Number(crop.y),
      width: Number(crop.width),
      height: Number(crop.height),
    });

  const applyRatio = (ratio: number | null) => {
    const base = props.source;
    let width = base.width;
    let height = base.height;
    if (ratio !== null) {
      if (width / height > ratio) width = Math.max(1, Math.round(height * ratio));
      else height = Math.max(1, Math.round(width / ratio));
    }
    commitCrop({
      x: Math.floor((base.width - width) / 2),
      y: Math.floor((base.height - height) / 2),
      width,
      height,
    });
  };

  const setSizeWidth = (value: string) => {
    const next = { ...size, width: value };
    if (size.keep) {
      const width = Number(value);
      const base = model.geometry.output_size;
      if (Number.isFinite(width) && width >= 1 && base.width >= 1) {
        next.height = String(Math.max(1, Math.round((base.height * width) / base.width)));
      }
    }
    setSize(next);
  };

  const setSizeHeight = (value: string) => {
    const next = { ...size, height: value };
    if (size.keep) {
      const height = Number(value);
      const base = model.geometry.output_size;
      if (Number.isFinite(height) && height >= 1 && base.height >= 1) {
        next.width = String(Math.max(1, Math.round((base.width * height) / base.height)));
      }
    }
    setSize(next);
  };

  const applySize = () => {
    try {
      const base = { width: model.geometry.output_size.width, height: model.geometry.output_size.height };
      const percent = Number(size.percent);
      const next = resizeDimensions(base, {
        ...(percent !== 100 && Number.isFinite(percent) ? { percent } : {}),
        ...(percent === 100 ? { width: Number(size.width), height: Number(size.height) } : {}),
        keepAspect: size.keep,
        allowUpscale: size.upscale,
      });
      props.onGeometry(setOutputSize(model.geometry, props.source, next));
      setNotice(null);
    } catch {
      setNotice(t("errors.image_edit.failed"));
    }
  };

  const setAdjustment = (patch: Partial<ImageAdjustments>) => {
    const next = { ...adjustments, ...patch, preset: "custom" as AdjustmentPreset };
    setAdjustments(next);
  };

  const rotate = (clockwise: boolean) => {
    try {
      props.onGeometry(rotateGeometry(model.geometry, props.source, clockwise));
    } catch {
      setNotice(t("errors.image_edit.failed"));
    }
  };

  const numberField = (
    labelKey: string,
    value: string,
    onChange: (value: string) => void,
    options: { min?: number; max?: number; testId: string; onEnter?: () => void },
  ) => (
    <label className="adp-image-field">
      <span>{t(labelKey)}</span>
      <input
        className="adp-image-input"
        type="number"
        inputMode="numeric"
        min={options.min}
        max={options.max}
        value={value}
        data-adp-image-field={options.testId}
        aria-label={t(labelKey)}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            options.onEnter?.();
          }
        }}
      />
    </label>
  );

  const brushFields = (
    <>
      <label className="adp-image-field">
        <span>{t("imageEdit.width")}</span>
        <Slider value={brush.width} min={1} max={512} label={t("imageEdit.width")} onChange={(value) => props.onBrush({ ...brush, width: value })} />
      </label>
      <label className="adp-image-field">
        <span>{t("imageEdit.hardness")}</span>
        <Slider value={Math.round(brush.hardness * 100)} min={0} max={100} label={t("imageEdit.hardness")} onChange={(value) => props.onBrush({ ...brush, hardness: value / 100 })} />
      </label>
      <label className="adp-image-field">
        <span>{t("imageEdit.opacity")}</span>
        <Slider value={Math.round(brush.opacity * 100)} min={0} max={100} label={t("imageEdit.opacity")} onChange={(value) => props.onBrush({ ...brush, opacity: value / 100 })} />
      </label>
      <label className="adp-image-field">
        <span>{t("imageEdit.color")}</span>
        <input
          type="color"
          className="adp-image-color"
          aria-label={t("imageEdit.color")}
          value={toHex(brush.color)}
          onChange={(event) => props.onBrush({ ...brush, color: fromHex(event.target.value, brush.color[3]) })}
        />
      </label>
    </>
  );

  return (
    <aside className="adp-image-properties" aria-label={t("imageEdit.properties")}>
      {section === "adjust" ? (
        <section className="adp-image-props-section">
          <h3>{t("imageEdit.adjust")}</h3>
          {(
            [
              ["brightness", -1, 1],
              ["contrast", -1, 1],
              ["saturation", -1, 1],
              ["warmth", -1, 1],
              ["sharpness", 0, 1],
              ["blur", 0, 64],
            ] as const
          ).map(([key, min, max]) => (
            <label key={key} className="adp-image-field">
              <span>{t(`imageEdit.${key}`)}</span>
              <Slider
                value={key === "blur" ? adjustments.blur : Math.round((adjustments[key] as number) * 100)}
                min={key === "blur" ? min : min * 100}
                max={key === "blur" ? max : max * 100}
                label={t(`imageEdit.${key}`)}
                onChange={(value) =>
                  setAdjustment(key === "blur" ? { blur: value } : ({ [key]: value / 100 } as Partial<ImageAdjustments>))
                }
              />
            </label>
          ))}
          <div className="adp-image-actions">
            <Button variant="primary" onClick={() => props.onAdjustments(adjustments)}>
              {t("common.apply")}
            </Button>
            <Button
              onClick={() => {
                setAdjustments(presetAdjustments("original"));
                props.onAdjustments(presetAdjustments("original"));
              }}
            >
              {t("imageEdit.original")}
            </Button>
          </div>
        </section>
      ) : null}

      {section === "filters" ? (
        <section className="adp-image-props-section">
          <h3>{t("imageEdit.filters")}</h3>
          <div className="adp-image-filter-grid">
            {filterDefinitions().map((filter) => (
              <button
                key={filter.id}
                type="button"
                className="adp-image-filter"
                data-adp-filter={filter.id}
                onClick={() => {
                  setAdjustments(filter.adjustments);
                  props.onAdjustments(filter.adjustments);
                }}
              >
                {t(filter.labelKey)}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {section === "crop" ? (
        <section className="adp-image-props-section">
          <h3>{t("imageEdit.crop")}</h3>
          <div className="adp-image-actions">
            <Button onClick={() => applyRatio(null)}>{t("imageEdit.free")}</Button>
            <Button onClick={() => applyRatio(1)}>1:1</Button>
            <Button onClick={() => applyRatio(16 / 9)}>16:9</Button>
            <Button onClick={() => applyRatio(4 / 3)}>4:3</Button>
            <Button onClick={() => applyRatio(3 / 2)}>3:2</Button>
          </div>
          <div className="adp-image-grid2">
            {numberField("imageEdit.cropX", crop.x, (value) => setCropFields({ ...crop, x: value }), { min: 0, testId: "crop-x", onEnter: applyCrop })}
            {numberField("imageEdit.cropY", crop.y, (value) => setCropFields({ ...crop, y: value }), { min: 0, testId: "crop-y", onEnter: applyCrop })}
            {numberField("imageEdit.cropWidth", crop.width, (value) => setCropFields({ ...crop, width: value }), { min: 1, testId: "crop-width", onEnter: applyCrop })}
            {numberField("imageEdit.cropHeight", crop.height, (value) => setCropFields({ ...crop, height: value }), { min: 1, testId: "crop-height", onEnter: applyCrop })}
          </div>
          <div className="adp-image-actions">
            <Button variant="primary" onClick={applyCrop}>{t("common.apply")}</Button>
            <Button onClick={() => rotate(false)}>{t("imageEdit.rotateLeft")}</Button>
            <Button onClick={() => rotate(true)}>{t("imageEdit.rotateRight")}</Button>
            <Button onClick={() => props.onGeometry({ ...model.geometry, flip_x: !model.geometry.flip_x })}>{t("imageEdit.flipHorizontal")}</Button>
            <Button onClick={() => props.onGeometry({ ...model.geometry, flip_y: !model.geometry.flip_y })}>{t("imageEdit.flipVertical")}</Button>
          </div>
        </section>
      ) : null}

      {section === "size" ? (
        <section className="adp-image-props-section">
          <h3>{t("imageEdit.size")}</h3>
          <div className="adp-image-grid2">
            {numberField("imageEdit.width", size.width, setSizeWidth, { min: 1, max: 32768, testId: "size-width", onEnter: applySize })}
            {numberField("imageEdit.height", size.height, setSizeHeight, { min: 1, max: 32768, testId: "size-height", onEnter: applySize })}
            {numberField("imageEdit.percent", size.percent, (value) => setSize({ ...size, percent: value }), { min: 1, max: 1000, testId: "size-percent", onEnter: applySize })}
          </div>
          <label className="adp-image-check">
            <input type="checkbox" checked={size.keep} onChange={(event) => setSize({ ...size, keep: event.target.checked })} />
            {t("imageEdit.keepProportions")}
          </label>
          <label className="adp-image-check">
            <input type="checkbox" checked={size.upscale} onChange={(event) => setSize({ ...size, upscale: event.target.checked })} />
            {t("imageEdit.allowUpscale")}
          </label>
          <div className="adp-image-actions">
            <Button variant="primary" onClick={applySize}>{t("common.apply")}</Button>
          </div>
        </section>
      ) : null}

      {section === "markup" || section === "draw" ? (
        <section className="adp-image-props-section">
          <h3>{section === "markup" ? t("imageEdit.markup") : t("imageEdit.draw")}</h3>
          {brushFields}
          {tool === "text" ? (
            <label className="adp-image-field">
              <span>{t("imageEdit.textLabel")}</span>
              <input
                className="adp-image-input"
                type="text"
                maxLength={10000}
                data-adp-image-field="overlay-text"
                aria-label={t("imageEdit.textLabel")}
                value={props.overlayText}
                onChange={(event) => props.onOverlayText(event.target.value)}
              />
            </label>
          ) : null}
        </section>
      ) : null}

      {section === "erase" || tool === "eraser" ? (
        <section className="adp-image-props-section">
          <h3>{t("imageEdit.erase")}</h3>
          {brushFields}
        </section>
      ) : null}

      <section className="adp-image-props-section">
        <h3>{t("imageEdit.background")}</h3>
        <label className="adp-image-check">
          <input type="checkbox" checked={props.transparent} onChange={(event) => props.onTransparent(event.target.checked)} />
          {t("imageEdit.transparent")}
        </label>
        <input
          type="color"
          className="adp-image-color"
          aria-label={t("imageEdit.background")}
          value={toHex(props.background)}
          disabled={props.transparent}
          onChange={(event) => props.onBackground(fromHex(event.target.value, 255))}
        />
        {props.opaqueFormat ? <p className="adp-image-warning" role="note">{t("imageEdit.opaqueWarning")}</p> : null}
      </section>

      {notice ? <p className="adp-image-warning" role="alert">{notice}</p> : null}
    </aside>
  );
}
