import { useMemo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import Button from "../components/Button";
import IconButton from "../components/IconButton";
import TextInput from "../components/TextInput";
import { curveValue } from "./adjustmentWorker";
import { fail, type ImageAdjustment, type Point } from "./types";

/** Curves and levels editor (Step 18b T3).
 *
 * A 320 px popover with a 256x160 curve graph and a keyboard-editable point
 * table. The graph is decorative: every value can be typed or nudged with the
 * arrow keys. Nothing here writes the document; the caller applies the
 * adjustment as one transaction. */

export interface CurvesPanelProps {
  adjustment: ImageAdjustment;
  onChange: (adjustment: ImageAdjustment) => void;
  onApply: () => void;
  onClose: () => void;
}

export const CURVE_WIDTH = 256;
export const CURVE_HEIGHT = 160;
const MIN_GAP = 0.001;

type LevelsAdjustment = Extract<ImageAdjustment, { kind: "levels" }>;

function LevelsFields({
  adjustment,
  onChange,
}: {
  adjustment: LevelsAdjustment;
  onChange: (adjustment: ImageAdjustment) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="adp-paint-levels">
      {(["black", "white", "gamma"] as const).map((field) => (
        <label key={field} className="adp-paint-field">
          <span>{t(`adjust.${field}`)}</span>
          <TextInput
            type="number"
            value={String(adjustment[field])}
            onChange={(text) => {
              const value = Number(text);
              if (!Number.isFinite(value)) return;
              if (field === "gamma") {
                onChange({ ...adjustment, gamma: clamp(value, 0.1, 10) });
                return;
              }
              const next = clamp(value, 0, 1);
              const black = field === "black" ? next : adjustment.black;
              const white = field === "white" ? next : adjustment.white;
              if (white <= black) return;
              onChange({ ...adjustment, black, white });
            }}
            ariaLabel={t(`adjust.${field}`)}
            invalid={
              (field === "black" && adjustment.black >= adjustment.white) ||
              (field === "white" && adjustment.white <= adjustment.black) ||
              (field === "gamma" && (adjustment.gamma < 0.1 || adjustment.gamma > 10))
            }
            maxLength={8}
          />
        </label>
      ))}
    </div>
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function withPoint(points: readonly Point[], index: number, next: Point): Point[] {
  if (!Number.isInteger(index) || index < 0 || index >= points.length) fail("image_edit.bad_request");
  const lower = index === 0 ? 0 : points[index - 1].x + MIN_GAP;
  const upper = index === points.length - 1 ? 1 : points[index + 1].x - MIN_GAP;
  if (index === 0) {
    if (Math.abs(points[0].x) > 1e-9) fail("image_edit.bad_request");
    return points.map((point, position) => (position === 0 ? { x: 0, y: clamp(next.y, 0, 1) } : point));
  }
  if (index === points.length - 1) {
    return points.map((point, position) => (position === points.length - 1 ? { x: 1, y: clamp(next.y, 0, 1) } : point));
  }
  const x = clamp(next.x, lower, upper);
  return points.map((point, position) => (position === index ? { x, y: clamp(next.y, 0, 1) } : point));
}

function pointsPath(points: readonly Point[]): string {
  return points
    .map((point, index) => {
      const x = 4 + point.x * (CURVE_WIDTH - 8);
      const y = CURVE_HEIGHT - 4 - point.y * (CURVE_HEIGHT - 8);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export default function CurvesPanel({ adjustment, onChange, onApply, onClose }: CurvesPanelProps) {
  const { t } = useTranslation();
  const points = useMemo(() => (adjustment.kind === "curves" ? adjustment.points : []), [adjustment]);

  if (adjustment.kind !== "curves" && adjustment.kind !== "levels") {
    return null;
  }

  const updatePoint = (index: number, axis: "x" | "y", value: number) => {
    if (adjustment.kind !== "curves") return;
    const current = adjustment.points[index];
    if (!current) return;
    const next = withPoint(adjustment.points, index, axis === "x" ? { x: value, y: current.y } : { x: current.x, y: value });
    onChange({ kind: "curves", points: next });
  };

  const changeText = (index: number, axis: "x" | "y", text: string) => {
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    updatePoint(index, axis, clamp(value, 0, 1));
  };

  const nudge = (event: ReactKeyboardEvent<HTMLElement>, index: number, axis: "x" | "y") => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (adjustment.kind !== "curves") return;
    event.preventDefault();
    const current = adjustment.points[index];
    if (!current) return;
    const step = event.shiftKey ? 0.1 : 0.01;
    const delta = event.key === "ArrowUp" ? step : -step;
    updatePoint(index, axis, clamp((axis === "x" ? current.x : current.y) + delta, 0, 1));
  };

  const addPoint = () => {
    if (adjustment.kind !== "curves" || adjustment.points.length >= 32) return;
    let gapIndex = 0;
    let gap = -1;
    for (let index = 1; index < adjustment.points.length; index += 1) {
      const size = adjustment.points[index].x - adjustment.points[index - 1].x;
      if (size > gap) {
        gap = size;
        gapIndex = index;
      }
    }
    if (gap <= 2 * MIN_GAP) return;
    const left = adjustment.points[gapIndex - 1];
    const right = adjustment.points[gapIndex];
    const x = (left.x + right.x) / 2;
    const y = curveValue(adjustment.points, x);
    const points = [...adjustment.points];
    points.splice(gapIndex, 0, { x, y });
    onChange({ kind: "curves", points });
  };

  const removePoint = (index: number) => {
    if (adjustment.kind !== "curves") return;
    if (index <= 0 || index >= adjustment.points.length - 1) return;
    onChange({ kind: "curves", points: adjustment.points.filter((_, position) => position !== index) });
  };

  return (
    <div className="adp-paint-popover adp-paint-curves" role="dialog" aria-label={t("adjust.curves")}>
      {adjustment.kind === "curves" ? (
        <>
          <svg
            className="adp-paint-curve-graph"
            width={CURVE_WIDTH}
            height={CURVE_HEIGHT}
            viewBox={`0 0 ${CURVE_WIDTH} ${CURVE_HEIGHT}`}
            role="img"
            aria-label={t("adjust.curveEditor")}
          >
            <rect x="4" y="4" width={CURVE_WIDTH - 8} height={CURVE_HEIGHT - 8} className="adp-paint-curve-frame" />
            <path d={pointsPath(points)} className="adp-paint-curve-line" fill="none" />
            {points.map((point, index) => (
              <circle
                key={`${point.x}-${index}`}
                cx={4 + point.x * (CURVE_WIDTH - 8)}
                cy={CURVE_HEIGHT - 4 - point.y * (CURVE_HEIGHT - 8)}
                r={index === 0 || index === points.length - 1 ? 3 : 4}
                className="adp-paint-curve-point"
              />
            ))}
          </svg>
          <table className="adp-paint-curve-table">
            <thead>
              <tr>
                <th scope="col">{t("adjust.pointX")}</th>
                <th scope="col">{t("adjust.pointY")}</th>
                <th scope="col">
                  <span className="adp-visually-hidden">{t("adjust.points")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point, index) => {
                const fixed = index === 0 || index === points.length - 1;
                return (
                  <tr key={`${index}-${point.x}`}>
                    <td>
                      <span
                        className="adp-paint-nudge"
                        data-adp-curve-point={index}
                        data-adp-curve-axis="x"
                        onKeyDown={(event) => nudge(event, index, "x")}
                      >
                        <TextInput
                          type="number"
                          value={String(Math.round(point.x * 1000) / 1000)}
                          onChange={(text) => changeText(index, "x", text)}
                          ariaLabel={`${t("adjust.pointX")} ${index + 1}`}
                          disabled={fixed}
                          maxLength={8}
                        />
                      </span>
                    </td>
                    <td>
                      <span
                        className="adp-paint-nudge"
                        data-adp-curve-point={index}
                        data-adp-curve-axis="y"
                        onKeyDown={(event) => nudge(event, index, "y")}
                      >
                        <TextInput
                          type="number"
                          value={String(Math.round(point.y * 1000) / 1000)}
                          onChange={(text) => changeText(index, "y", text)}
                          ariaLabel={`${t("adjust.pointY")} ${index + 1}`}
                          maxLength={8}
                        />
                      </span>
                    </td>
                    <td>
                      <IconButton
                        icon={Trash2}
                        labelKey="adjust.removePoint"
                        onClick={() => removePoint(index)}
                        disabled={fixed}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="adp-paint-curve-actions">
            <Button variant="subtle" onClick={addPoint} disabled={points.length >= 32}>
              <Plus size={16} aria-hidden="true" />
              {t("adjust.addPoint")}
            </Button>
          </div>
        </>
      ) : (
        <LevelsFields adjustment={adjustment} onChange={onChange} />
      )}
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

/** Exported for the keyboard test: the same clamp the inputs use. */
export function curvePointClamp(value: number): number {
  if (!Number.isFinite(value)) fail("image_edit.bad_request");
  return clamp(value, 0, 1);
}
