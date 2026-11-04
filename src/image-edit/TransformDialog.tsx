import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import { defaultPivot, makeTransformMatrix } from "./layerTransform";
import type { Affine2D, ImageModel } from "./types";

/** 520 px numeric transform dialog. Preview stays local; only Apply calls the
 * E1 layer operation once. Escape/Cancel never commits a revision. */

export interface TransformDialogProps {
  model: Readonly<ImageModel>;
  layerIds: readonly string[];
  onApply: (matrix: Affine2D, linkedMask: boolean) => Promise<void>;
  onCancel: () => void;
  onPreview?: (matrix: Affine2D | null) => void;
}

function numberText(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

export default function TransformDialog(props: TransformDialogProps) {
  const { t } = useTranslation();
  const layerKey = props.layerIds.join("|");
  const pivot = useMemo(() => defaultPivot(props.model, props.layerIds), [props.model, layerKey]);
  const [translateX, setTranslateX] = useState("0");
  const [translateY, setTranslateY] = useState("0");
  const [scale, setScale] = useState("100");
  const [rotation, setRotation] = useState("0");
  const [linkedMask, setLinkedMask] = useState(() =>
    props.model.layers.some((layer) => props.layerIds.includes(layer.id) && layer.mask_id !== null),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef(props.onPreview);
  preview.current = props.onPreview;

  const matrix = useMemo(() => {
    try {
      return makeTransformMatrix({
        translate_x: Number(translateX),
        translate_y: Number(translateY),
        scale: Number(scale) / 100,
        rotation_degrees: Number(rotation),
        pivot,
      });
    } catch {
      return null;
    }
  }, [translateX, translateY, scale, rotation, pivot]);

  useEffect(() => {
    preview.current?.(matrix);
  }, [matrix]);

  useEffect(() => {
    return () => preview.current?.(null);
  }, []);

  const cancel = () => {
    preview.current?.(null);
    props.onCancel();
  };

  const apply = async () => {
    if (!matrix || busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onApply(matrix, linkedMask);
      setError(null);
    } catch {
      setError(t("errors.image_layers.failed"));
    } finally {
      setBusy(false);
    }
  };

  const field = (id: string, label: string, value: string, onChange: (value: string) => void, step = "1") => (
    <label className="adp-transform-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        data-adp-transform-field={id}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void apply();
          }
        }}
      />
    </label>
  );

  return (
    <Dialog title={t("layers.transform")} onClose={cancel} className="adp-transform-dialog">
      <div className="adp-transform-body">
        <div className="adp-transform-grid">
          {field("x", t("layers.positionX"), translateX, setTranslateX)}
          {field("y", t("layers.positionY"), translateY, setTranslateY)}
          {field("scale", t("layers.scale"), scale, setScale, "0.1")}
          {field("rotation", t("layers.rotation"), rotation, setRotation, "0.1")}
        </div>
        <p className="adp-transform-pivot">
          {t("layers.pivot")}: {numberText(Math.round(pivot.x * 10) / 10)}, {numberText(Math.round(pivot.y * 10) / 10)}
        </p>
        <label className="adp-transform-check">
          <input type="checkbox" checked={linkedMask} onChange={(event) => setLinkedMask(event.target.checked)} />
          {t("layers.linkedMask")}
        </label>
        {!matrix ? <p className="adp-transform-error" role="alert">{t("errors.image_layers.failed")}</p> : null}
        {busy ? <p className="adp-layer-working" role="status">{t("layers.working")}</p> : null}
        {error ? <p className="adp-transform-error" role="alert">{error}</p> : null}
        <div className="adp-transform-actions">
          <Button onClick={cancel}>{t("common.cancel")}</Button>
          <Button variant="primary" data-adp-transform-apply="true" disabled={!matrix || busy} onClick={() => void apply()}>
            {t("common.apply")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
