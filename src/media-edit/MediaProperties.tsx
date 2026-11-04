import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Slider from "../components/Slider";
import Switch from "../components/Switch";
import TextInput from "../components/TextInput";
import type {
  MediaCrop,
  MediaEditOperation,
  MediaRecipe,
  MediaRotation,
  TimeUs,
} from "./types";
import {
  MAX_MEDIA_VOLUME,
  isMediaSafeInteger,
  mediaEditFail,
} from "./types";
import {
  formatTimeUs,
  mediaRecipeDurationUs,
  nudgeTimeUs,
  parseTimeUs,
} from "./timing";
import { rotateWithin, setCropWithin, setGain, trimToRange } from "./operations";

/**
 * The 300 px properties panel (`T2`).
 *
 * Every Start/End and crop value has a text or number input, so the editor
 * is fully usable without the pointer. A refused crop or range shows one
 * translated error and changes nothing.
 */

export interface MediaPropertiesProps {
  recipe: MediaRecipe;
  active: boolean;
  /** True only when a verified pack can burn subtitles and encode media. */
  canExport: boolean;
  sourceSize: { width: number; height: number } | null;
  onApply: (operation: MediaEditOperation) => Promise<void>;
  /** The source range currently selected for Trim/Cut. */
  onRangeChange: (range: { start: number; end: number } | null) => void;
  onError: (code: string) => void;
}

const SPEEDS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const ROTATIONS: readonly MediaRotation[] = [0, 90, 180, 270];

function cropOf(recipe: MediaRecipe, sourceSize: { width: number; height: number } | null): MediaCrop | null {
  if (recipe.crop) return recipe.crop;
  if (!sourceSize) return null;
  const rotated = recipe.rotation === 90 || recipe.rotation === 270;
  return {
    x: 0,
    y: 0,
    width: rotated ? sourceSize.height : sourceSize.width,
    height: rotated ? sourceSize.width : sourceSize.height,
  };
}

export default function MediaProperties({
  recipe,
  active,
  canExport,
  sourceSize,
  onApply,
  onRangeChange,
  onError,
}: MediaPropertiesProps) {
  const { t } = useTranslation();
  const durationUs = mediaRecipeDurationUs(recipe);
  const sourceDurationUs = recipe.sources[0]?.duration_us ?? durationUs;
  const firstSegment = recipe.segments[0];
  const [startText, setStartText] = useState(formatTimeUs(firstSegment?.start_us ?? 0));
  const [endText, setEndText] = useState(formatTimeUs(durationUs));
  const defaultCrop = useMemo(
    () => cropOf(recipe, sourceSize),
    [recipe.crop, recipe.rotation, sourceSize],
  );
  const [crop, setCrop] = useState<MediaCrop | null>(defaultCrop);

  useEffect(() => {
    setStartText(formatTimeUs(firstSegment?.start_us ?? 0));
    setEndText(formatTimeUs(recipe.segments[recipe.segments.length - 1]?.end_us ?? 0));
  }, [firstSegment?.start_us, recipe.segments]);

  useEffect(() => {
    setCrop(defaultCrop);
  }, [defaultCrop]);

  const apply = async (operation: MediaEditOperation) => {
    try {
      await onApply(operation);
    } catch (error) {
      onError(error instanceof Error ? error.message : "media_edit.failed");
    }
  };

  const commitRange = async (startUs: TimeUs, endUs: TimeUs) => {
    try {
      if (!isMediaSafeInteger(startUs) || !isMediaSafeInteger(endUs) || endUs <= startUs) {
        mediaEditFail("media_edit.bad_request");
      }
      onRangeChange({ start: startUs, end: endUs });
      await onApply({ kind: "set_segments", segments: trimToRange(recipe, startUs, endUs).segments });
    } catch (error) {
      onError(error instanceof Error ? error.message : "media_edit.bad_request");
    }
  };

  const nudge = (which: "start" | "end", direction: -1 | 1) => {
    try {
      if (which === "start") {
        const next = nudgeTimeUs(parseTimeUs(startText), direction * 1_000_000, sourceDurationUs);
        setStartText(formatTimeUs(next));
        void commitRange(next, parseTimeUs(endText));
      } else {
        const next = nudgeTimeUs(parseTimeUs(endText), direction * 1_000_000, sourceDurationUs);
        setEndText(formatTimeUs(next));
        void commitRange(parseTimeUs(startText), next);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "media_edit.bad_request");
    }
  };

  const changeRotation = (rotation: MediaRotation) => {
    try {
      // A crop is expressed in oriented source pixels: refuse a rotation
      // that would leave it outside the picture.
      if (recipe.crop !== null) {
        if (!sourceSize) {
          onError("media_edit.unsupported");
          return;
        }
        rotateWithin(recipe, rotation, sourceSize.width, sourceSize.height);
      }
      void apply({ kind: "set_rotation", rotation });
    } catch (error) {
      onError(error instanceof Error ? error.message : "media_edit.bad_request");
    }
  };

  const applyCrop = () => {
    if (!crop || !sourceSize) {
      onError("media_edit.unsupported");
      return;
    }
    try {
      const next = setCropWithin(recipe, crop, sourceSize.width, sourceSize.height);
      void onApply({ kind: "set_crop", crop: next.crop }).catch((error: unknown) =>
        onError(error instanceof Error ? error.message : "media_edit.failed"),
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "media_edit.bad_request");
    }
  };

  return (
    <aside className="adp-media-properties" aria-label={t("mediaEdit.edit")}>
      <section className="adp-media-section">
        <h3>{t("mediaEdit.trim")}</h3>
        <label
          className="adp-media-field"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") nudge("start", -1);
            if (event.key === "ArrowRight") nudge("start", 1);
            if (event.key === "Enter") void commitRange(parseTimeUs(startText), parseTimeUs(endText));
          }}
        >
          {t("mediaEdit.start")}
          <TextInput
            value={startText}
            onChange={setStartText}
            ariaLabel={t("mediaEdit.start")}
            disabled={!active}
          />
        </label>
        <label
          className="adp-media-field"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") nudge("end", -1);
            if (event.key === "ArrowRight") nudge("end", 1);
            if (event.key === "Enter") void commitRange(parseTimeUs(startText), parseTimeUs(endText));
          }}
        >
          {t("mediaEdit.end")}
          <TextInput
            value={endText}
            onChange={setEndText}
            ariaLabel={t("mediaEdit.end")}
            disabled={!active}
          />
        </label>
      </section>

      <section className="adp-media-section">
        <h3>{t("mediaEdit.speed")}</h3>
        <label className="adp-media-field">
          {t("mediaEdit.speed")}
          <select
            className="adp-input"
            value={String(firstSegment?.speed ?? 1)}
            disabled={!active || !firstSegment}
            aria-label={t("mediaEdit.speed")}
            onChange={(event) => {
              if (!firstSegment) return;
              void apply({ kind: "set_speed", segment_id: firstSegment.id, speed: Number(event.target.value) });
            }}
          >
            {SPEEDS.map((speed) => (
              <option key={speed} value={String(speed)}>
                {String(speed)}×
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="adp-media-section">
        <h3>{t("mediaEdit.crop")}</h3>
        <div className="adp-media-crop-grid">
          {crop
            ? (["x", "y", "width", "height"] as const).map((field) => (
                <label key={field} className="adp-media-field">
                  {field === "width" ? t("convert.width") : field === "height" ? t("convert.height") : field.toUpperCase()}
                  <TextInput
                    type="number"
                    value={String(crop[field])}
                    ariaLabel={field}
                    disabled={!active}
                    onChange={(value) =>
                      setCrop({ ...crop, [field]: Number.isFinite(Number(value)) ? Number(value) : 0 })
                    }
                  />
                </label>
              ))
            : null}
        </div>
        <div className="adp-media-actions">
          <Button onClick={applyCrop} disabled={!active || !sourceSize}>
            {t("mediaEdit.crop")}
          </Button>
          <Button
            variant="subtle"
            disabled={!active}
            onClick={() => {
              setCrop(null);
              void apply({ kind: "set_crop", crop: null });
            }}
          >
            {t("mediaEdit.off")}
          </Button>
        </div>
      </section>

      <section className="adp-media-section">
        <h3>{t("mediaEdit.rotate")}</h3>
        <label className="adp-media-field">
          {t("mediaEdit.rotate")}
          <select
            className="adp-input"
            value={String(recipe.rotation)}
            disabled={!active}
            aria-label={t("mediaEdit.rotate")}
            onChange={(event) => changeRotation(Number(event.target.value) as MediaRotation)}
          >
            {ROTATIONS.map((rotation) => (
              <option key={rotation} value={String(rotation)}>
                {rotation}°
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="adp-media-section">
        <h3>{t("mediaEdit.volume")}</h3>
        <Slider
          value={Math.round(recipe.volume * 100)}
          min={0}
          max={MAX_MEDIA_VOLUME * 100}
          label={t("mediaEdit.volume")}
          disabled={!active}
          onChange={(value) => {
            const volume = value / 100;
            void apply({ kind: "set_gain", volume, mute: recipe.mute });
          }}
        />
        <Switch
          checked={recipe.mute}
          label={t("mediaEdit.mute")}
          disabled={!active}
          onChange={(mute) => {
            const next = setGain(recipe, recipe.volume, mute);
            void apply({ kind: "set_gain", volume: next.volume, mute: next.mute });
          }}
        />
        <Switch
          checked={recipe.keep_pitch}
          label={t("mediaEdit.keepPitch")}
          disabled={!active}
          onChange={(checked) => void apply({ kind: "set_keep_pitch", keep_pitch: checked })}
        />
      </section>

      <section className="adp-media-section">
        <h3>{t("mediaEdit.subtitles")}</h3>
        <label className="adp-media-field">
          {t("mediaEdit.subtitles")}
          <select
            className="adp-input"
            value={recipe.subtitle_mode}
            disabled={!active}
            aria-label={t("mediaEdit.subtitles")}
            onChange={(event) =>
              void apply({
                kind: "set_subtitles",
                cues: recipe.subtitles,
                mode: event.target.value as MediaRecipe["subtitle_mode"],
              })
            }
          >
            <option value="off">{t("mediaEdit.off")}</option>
            <option value="select" disabled={recipe.subtitles.length === 0}>
              {t("mediaEdit.display")}
            </option>
            <option value="burn" disabled={!canExport || recipe.subtitles.length === 0}>
              {t("mediaEdit.burn")}
            </option>
          </select>
        </label>
        <p className="adp-media-note">{t("mediaEdit.recipeNotice")}</p>
      </section>
    </aside>
  );
}
