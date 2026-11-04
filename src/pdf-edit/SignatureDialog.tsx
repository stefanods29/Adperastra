import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import TextInput from "../components/TextInput";
import {
  signatureDraftError,
  validateSignatureImage,
  type PdfSignatureDraft,
  type PdfSignatureImage,
} from "./signature";
import type { PdfPoint } from "./types";

/** Visual signature dialog (Step 14a D5, T3): Draw, Type or Image.
 *
 * The dialog only builds a draft. It never uploads or writes: the editor
 * uploads an image through the 08a snapshot route and creates a Stamp
 * annotation. The warning makes clear this is not a certified signature. */

export type SignatureTab = "draw" | "type" | "image";

export interface SignatureDialogProps {
  onCancel: () => void;
  onApply: (draft: PdfSignatureDraft) => void | Promise<void>;
  /** Test hook: skip canvas drawing and provide a draft directly. */
  initialTab?: SignatureTab;
}

export const SIGNATURE_CANVAS_WIDTH = 560;
export const SIGNATURE_CANVAS_HEIGHT = 220;

function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>): PdfPoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  const scaleX = SIGNATURE_CANVAS_WIDTH / Math.max(1, bounds.width);
  const scaleY = SIGNATURE_CANVAS_HEIGHT / Math.max(1, bounds.height);
  return {
    x: (event.clientX - bounds.left) * scaleX,
    y: (event.clientY - bounds.top) * scaleY,
  };
}

function drawStrokes(canvas: HTMLCanvasElement | null, strokes: readonly PdfPoint[][], color: string): void {
  if (!canvas) return;
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext("2d");
  } catch {
    // A headless test environment may not implement a canvas; the draft is
    // still valid and the editor draws the signature when applied.
    return;
  }
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    context.beginPath();
    context.moveTo(stroke[0].x, stroke[0].y);
    for (let index = 1; index < stroke.length; index += 1) context.lineTo(stroke[index].x, stroke[index].y);
    context.stroke();
  }
}

async function readImage(file: File): Promise<PdfSignatureImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  if (file.type !== "image/png" && file.type !== "image/jpeg") throw new Error("pdf_edit.unsupported");
  const dimensions = await imageDimensions(file);
  return { bytes, mime, width: dimensions.width, height: dimensions.height };
}

async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  return await new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("pdf_edit.bad_request"));
    };
    image.src = url;
  });
}

export default function SignatureDialog({ onCancel, onApply, initialTab = "draw" }: SignatureDialogProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SignatureTab>(initialTab);
  const [strokes, setStrokes] = useState<PdfPoint[][]>([]);
  const [active, setActive] = useState<PdfPoint[] | null>(null);
  const [text, setText] = useState("");
  const [image, setImage] = useState<PdfSignatureImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    drawStrokes(canvasRef.current, active ? [...strokes, active] : strokes, getComputedStyle(document.documentElement).getPropertyValue("--adp-color-text-primary") || "#111");
  }, [strokes, active]);

  const draft: PdfSignatureDraft = {
    kind: tab,
    strokes,
    text,
    image: image ?? undefined,
    canvas_width: SIGNATURE_CANVAS_WIDTH,
    canvas_height: SIGNATURE_CANVAS_HEIGHT,
  };
  const draftError = signatureDraftError(draft);

  const pickImage = async (file: File | null) => {
    setError(null);
    if (!file) {
      setImage(null);
      return;
    }
    try {
      const next = await readImage(file);
      validateSignatureImage(next);
      setImage(next);
    } catch (cause) {
      setImage(null);
      setError(cause instanceof Error && cause.message === "pdf_edit.too_large" ? t("errors.pdf_edit.failed") : t("pdfTools.unsupportedForm"));
    }
  };

  return (
    <Dialog title={t("pdfTools.sign")} onClose={onCancel} className="adp-pdf-signature-dialog">
      <p className="adp-pdf-edit-warning" role="note">
        {t("pdfTools.visualWarning")}
      </p>
      <div className="adp-pdf-edit-tabs" role="tablist" aria-label={t("pdfTools.sign")}>
        {(["draw", "type", "image"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            id={`pdf-sign-tab-${entry}`}
            aria-selected={tab === entry}
            aria-controls={`pdf-sign-panel-${entry}`}
            className={tab === entry ? "adp-pdf-edit-tab adp-pdf-edit-tab--active" : "adp-pdf-edit-tab"}
            onClick={() => setTab(entry)}
          >
            {entry === "draw" ? t("pdfTools.draw") : entry === "type" ? t("pdfTools.signType") : t("pdfTools.signImage")}
          </button>
        ))}
      </div>
      {tab === "draw" ? (
        <div role="tabpanel" id="pdf-sign-panel-draw" aria-labelledby="pdf-sign-tab-draw" className="adp-pdf-edit-signature-panel">
          <canvas
            ref={canvasRef}
            className="adp-pdf-edit-signature-canvas"
            width={SIGNATURE_CANVAS_WIDTH}
            height={SIGNATURE_CANVAS_HEIGHT}
            aria-label={t("pdfTools.draw")}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setActive([canvasPoint(event)]);
            }}
            onPointerMove={(event) => {
              if (!active) return;
              setActive([...active, canvasPoint(event)]);
            }}
            onPointerUp={() => {
              if (active && active.length >= 2) setStrokes([...strokes, active]);
              setActive(null);
            }}
            onPointerCancel={() => setActive(null)}
          />
          <Button variant="subtle" onClick={() => setStrokes(strokes.slice(0, -1))} disabled={strokes.length === 0}>
            {t("common.undo")}
          </Button>
        </div>
      ) : null}
      {tab === "type" ? (
        <div role="tabpanel" id="pdf-sign-panel-type" aria-labelledby="pdf-sign-tab-type" className="adp-pdf-edit-signature-panel">
          <TextInput value={text} onChange={setText} maxLength={8_192} ariaLabel={t("pdfTools.signType")} />
          <p className="adp-pdf-edit-signature-preview" aria-live="polite">
            {text}
          </p>
        </div>
      ) : null}
      {tab === "image" ? (
        <div role="tabpanel" id="pdf-sign-panel-image" aria-labelledby="pdf-sign-tab-image" className="adp-pdf-edit-signature-panel">
          <input
            className="adp-pdf-edit-file"
            type="file"
            accept="image/png,image/jpeg"
            aria-label={t("pdfTools.signImage")}
            onChange={(event) => void pickImage(event.currentTarget.files?.[0] ?? null)}
          />
          {image ? (
            <p className="adp-pdf-edit-note">
              {image.width} × {image.height}
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="adp-pdf-edit-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="adp-dialog-actions">
        <Button variant="primary" disabled={draftError !== null} onClick={() => void onApply(draft)}>
          {t("common.save")}
        </Button>
        <Button variant="subtle" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </Dialog>
  );
}
