import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import Skeleton from "../components/Skeleton";
import type { AiActionOptions, AiActionResult } from "../services/aiActionTypes";
import type { AiInputRef } from "../services/localAiTypes";
import { createMaskArtifact, startAiAction, releaseAiActionResult } from "../services/aiActions";
import type { JobHandle } from "../services/jobs";
import { ImageMaskEditor, maskIsEmpty, maskPercent, type MaskChange } from "./ImageMaskEditor";
import { imageActionOptions, type ImageActionId } from "./imageActions";

/**
 * Local image preview dialog (Step 17b D1/D3/D5, `ai-actions-1` E5).
 *
 * Nothing is applied here: the result goes to the typed result view, which
 * offers the single Apply/Save copy. Cancel, close, a new option and a new
 * input all cancel the running job and release the previous suggestion.
 * The source stays unchanged until the caller commits it.
 */

export const PREVIEW_SKELETON_MS = 100;
export const PREVIEW_WORDS_MS = 1_000;

export interface ImageEffectPreviewProps {
  input: AiInputRef;
  action: ImageActionId;
  /** Caller-provided source grant for the before pane. */
  sourceUrl?: string;
  /** Source dimensions when the result does not carry them yet (mask UI). */
  sourceSize?: { width: number; height: number } | null;
  /** Caller resolves the result artifact grant (14c adpfile) for the after pane. */
  resultUrlFor?: (result: AiActionResult) => string | null;
  expectedContentId?: string | null;
  onResult: (result: AiActionResult) => void;
  onCancel: () => void;
  onOpenHelp: (slug: string) => void;
}

export function ImageEffectPreview({
  input,
  action,
  sourceUrl,
  sourceSize = null,
  resultUrlFor,
  expectedContentId = null,
  onResult,
  onCancel,
  onOpenHelp,
}: ImageEffectPreviewProps) {
  const { t } = useTranslation();
  const [radius, setRadius] = useState(16);
  const [mask, setMask] = useState<MaskChange | null>(null);
  const [revision, setRevision] = useState(1);
  const [handle, setHandle] = useState<JobHandle<AiActionResult> | null>(null);
  const [result, setResult] = useState<AiActionResult | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "words" | "done" | "failed">("idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const active = useRef({ revision: 0, job: null as JobHandle<AiActionResult> | null, released: null as string | null });

  const cancelCurrent = useCallback(async () => {
    const current = active.current;
    current.revision += 1;
    if (current.job) {
      current.job.cancel().catch(() => undefined);
      current.job = null;
    }
    if (current.released) {
      releaseAiActionResult(current.released).catch(() => undefined);
      current.released = null;
    }
    setHandle(null);
    setPhase("idle");
  }, []);

  useEffect(() => {
    return () => {
      const current = active.current;
      current.revision += 1;
      current.job?.cancel().catch(() => undefined);
      if (current.released) releaseAiActionResult(current.released).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    setResult(null);
    setPhase("idle");
    setErrorCode(null);
    void cancelCurrent();
  }, [action, input.id, input.expected_revision, cancelCurrent]);

  const ready = action !== "erase_object" || (mask !== null && !maskIsEmpty(mask.selection));

  const generate = async () => {
    if (!ready) return;
    if (action === "erase_object" && mask === null) return;
    const current = active.current;
    await cancelCurrent();
    const generation = current.revision + 1;
    current.revision = generation;
    setPhase("loading");
    setErrorCode(null);
    const skeleton = window.setTimeout(() => {
      if (active.current.revision === generation) setPhase("loading");
    }, PREVIEW_SKELETON_MS);
    const words = window.setTimeout(() => {
      if (active.current.revision === generation) setPhase("words");
    }, PREVIEW_WORDS_MS);
    try {
      const options: AiActionOptions =
        action === "erase_object"
          ? {
              kind: "erase_object",
              mask_artifact_id: await createMaskArtifact(
                mask!.spec,
                mask!.selection.width,
                mask!.selection.height,
                expectedContentId,
              ),
            }
          : imageActionOptions(action, radius);
      const job = await startAiAction({
        action,
        inputs: [input],
        options,
        request_revision: generation,
        expected_content_id: expectedContentId,
        scope_id: null,
        outbound_consent_id: null,
      });
      current.job = job;
      setHandle(job);
      const produced = await job.completion;
      if (active.current.revision !== generation) return;
      current.job = null;
      current.released = produced.id;
      setResult(produced);
      setPhase("done");
      onResult(produced);
    } catch (error) {
      if (active.current.revision !== generation) return;
      setErrorCode(error instanceof Error ? error.message : String(error));
      setPhase("failed");
    } finally {
      window.clearTimeout(skeleton);
      window.clearTimeout(words);
    }
  };

  const close = () => {
    void cancelCurrent();
    onCancel();
  };

  const afterUrl = result && resultUrlFor ? resultUrlFor(result) : null;
  const dimensions =
    result && result.payload.kind === "image"
      ? { width: result.payload.image.width, height: result.payload.image.height }
      : null;

  return (
    <Dialog title={t(`aiActions.${action}`)} onClose={close} className="adp-ai-image-effect">
      <div className="adp-ai-image-effect-body">
        <div className="adp-ai-image-effect-panes">
          <section className="adp-ai-image-effect-pane" aria-label={t("aiActions.preview")}>
            {sourceUrl ? <img src={sourceUrl} alt="" className="adp-ai-image-effect-image" /> : <Skeleton variant="tiles" count={1} />}
          </section>
          <section className="adp-ai-image-effect-pane" aria-label={t("aiActions.preview")}>
            {phase === "loading" ? <Skeleton variant="tiles" count={1} /> : null}
            {phase === "words" ? <p role="status">{t("aiActions.preview")}</p> : null}
            {afterUrl ? <img src={afterUrl} alt="" className="adp-ai-image-effect-image" /> : null}
            {phase === "done" && dimensions ? (
              <p role="status">{`${dimensions.width} × ${dimensions.height}`}</p>
            ) : null}
            {phase === "failed" ? <p role="alert">{t("errors.ai_actions.failed")}</p> : null}
          </section>
        </div>

        <aside className="adp-ai-image-effect-properties" aria-label={t("aiActions.title")}>
          {action === "blur_background" ? (
            <label className="adp-ai-image-effect-radius">
              <span>{t("aiActions.blurRadius")}</span>
              <input
                type="range"
                min={1}
                max={64}
                value={radius}
                onChange={(event) => {
                  setRadius(Number(event.target.value));
                  setRevision((value) => value + 1);
                }}
                aria-label={t("aiActions.blurRadius")}
              />
              <span>{radius}</span>
            </label>
          ) : null}
          {action === "erase_object" ? (
            <ImageMaskEditor
              width={dimensions?.width ?? sourceSize?.width ?? 1}
              height={dimensions?.height ?? sourceSize?.height ?? 1}
              imageUrl={sourceUrl}
              disabled={phase === "loading" || phase === "words"}
              onChange={setMask}
              onOpenHelp={onOpenHelp}
            />
          ) : null}
          <p className="adp-ai-image-effect-note">{t("aiActions.keepOriginal")}</p>
          {errorCode ? <code className="adp-ai-image-effect-error">{errorCode}</code> : null}
        </aside>
      </div>

      <footer className="adp-ai-image-effect-footer">
        <button type="button" onClick={generate} disabled={!ready || phase === "loading" || phase === "words"}>
          {t("aiActions.preview")}
        </button>
        {phase === "loading" || phase === "words" ? (
          <button type="button" onClick={() => void cancelCurrent()}>
            {t("common.cancel", { defaultValue: t("speech.cancel") })}
          </button>
        ) : null}
        <button type="button" onClick={close}>
          {t("speech.cancel")}
        </button>
        <HelpButton onOpenHelp={() => onOpenHelp("ai-actions-images")} />
        <span className="adp-ai-image-effect-status" role="status">
          {mask && action === "erase_object" ? `${maskPercent(mask.selection)}%` : ""}
        </span>
        <span hidden data-revision={revision} data-job={handle?.id ?? ""} />
      </footer>
    </Dialog>
  );
}
