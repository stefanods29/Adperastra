/** Preview lifecycle for one crop (Step 14c, D9). Never marks a document dirty. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConversionInput } from "../convert/types";
import { acquireAiInput, releaseAiArtifact, releaseAiInput } from "../services/localAiArtifacts";
import { startAiTask } from "../services/localAiRuntime";
import type { AiInputRef, AiTaskResult, ImageRect, UpscaleOptions } from "../services/localAiTypes";
import type { JobHandle } from "../services/jobs";
import { errorCode } from "../services/errors";
import { canDisplayPreview, readWholeArtifact, type PreviewEnvelope } from "./upscale";

export interface PreviewState {
  preview: PreviewEnvelope | null;
  afterUrl: string | null;
  loading: boolean;
  errorCode: string;
  revision: number;
  startedAt: number | null;
}

export interface UseUpscalePreview {
  state: PreviewState;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  /** Run the full image with the same options for Apply (no crop preview). */
  runFull: () => Promise<AiTaskResult>;
}

export function useUpscalePreview(
  input: ConversionInput | null,
  options: UpscaleOptions,
  revision: number,
  expectedContentId: string | null,
): UseUpscalePreview {
  const { i18n } = useTranslation();
  const [state, setState] = useState<PreviewState>({
    preview: null,
    afterUrl: null,
    loading: false,
    errorCode: "",
    revision,
    startedAt: null,
  });
  const inputRef = useRef<AiInputRef | null>(null);
  const jobRef = useRef<JobHandle<AiTaskResult> | null>(null);
  const artifactIdRef = useRef<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  const revoke = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const release = useCallback(async () => {
    revoke();
    if (artifactIdRef.current) {
      const artifact = artifactIdRef.current;
      artifactIdRef.current = null;
      await releaseAiArtifact(artifact).catch(() => undefined);
    }
    if (inputRef.current) {
      const id = inputRef.current.id;
      inputRef.current = null;
      await releaseAiInput(id).catch(() => undefined);
    }
  }, [revoke]);

  const cancel = useCallback(async () => {
    generation.current += 1;
    const job = jobRef.current;
    jobRef.current = null;
    if (job) await job.cancel().catch(() => undefined);
    await release();
    if (mounted.current) {
      setState((current) => ({
        ...current,
        loading: false,
        preview: null,
        afterUrl: null,
        startedAt: null,
      }));
    }
  }, [release]);

  const start = useCallback(async () => {
    if (!input) {
      setState((current) => ({ ...current, errorCode: "ai.bad_request" }));
      return;
    }
    const ticket = generation.current + 1;
    generation.current = ticket;
    const previous = jobRef.current;
    jobRef.current = null;
    if (previous) await previous.cancel().catch(() => undefined);
    revoke();
    if (artifactIdRef.current) {
      const stale = artifactIdRef.current;
      artifactIdRef.current = null;
      await releaseAiArtifact(stale).catch(() => undefined);
    }
    setState((current) => ({
      ...current,
      loading: true,
      errorCode: "",
      preview: null,
      afterUrl: null,
      revision,
      startedAt: Date.now(),
    }));
    try {
      const existing = inputRef.current;
      const acquired = existing ?? (await acquireAiInput(input));
      if (!existing) {
        if (generation.current !== ticket || !mounted.current) {
          await releaseAiInput(acquired.id).catch(() => undefined);
          return;
        }
        inputRef.current = acquired;
      }
      const job = await startAiTask({
        request_id: "",
        task: "upscale",
        locale: i18n.language === "es" ? "es" : "en",
        inputs: [acquired],
        prompt: null,
        options: { ...options, kind: "upscale" },
      });
      if (generation.current !== ticket || !mounted.current) {
        void job.completion.catch(() => undefined);
        await job.cancel().catch(() => undefined);
        return;
      }
      jobRef.current = job;
      const result = await job.completion;
      if (generation.current !== ticket || !mounted.current) {
        return;
      }
      if (result.task !== "upscale" || result.result.kind !== "image") {
        throw new Error("ai.model_output");
      }
      artifactIdRef.current = result.result.artifact_id;
      const bytes = await readWholeArtifact(result.result.artifact_id);
      if (generation.current !== ticket || !mounted.current) return;
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "image/png" }));
      revoke();
      urlRef.current = url;
      setState({
        preview: { revision, contentId: expectedContentId, result },
        afterUrl: url,
        loading: false,
        errorCode: "",
        revision,
        startedAt: null,
      });
    } catch (error) {
      if (generation.current !== ticket || !mounted.current) return;
      setState((current) => ({
        ...current,
        loading: false,
        errorCode: errorCode(error) || "ai.failed",
        startedAt: null,
      }));
    }
  }, [expectedContentId, i18n.language, input, options, revoke, revision]);

  const runFull = useCallback(async (): Promise<AiTaskResult> => {
    if (!input) throw new Error("ai.bad_request");
    const ticket = generation.current;
    const existing = inputRef.current;
    let owned: AiInputRef | null = null;
    const acquired = existing ?? (await acquireAiInput(input));
    if (!existing) owned = acquired;
    let job: JobHandle<AiTaskResult> | null = null;
    try {
      job = await startAiTask({
        request_id: "",
        task: "upscale",
        locale: i18n.language === "es" ? "es" : "en",
        inputs: [acquired],
        prompt: null,
        // Apply is always the whole image; the crop is only the preview.
        options: { ...options, preview_region: null },
      });
      if (generation.current !== ticket || !mounted.current) {
        void job.completion.catch(() => undefined);
        await job.cancel().catch(() => undefined);
        throw new Error("ai.cancelled");
      }
      jobRef.current = job;
      return await job.completion;
    } finally {
      if (job && jobRef.current === job) jobRef.current = null;
      if (owned) await releaseAiInput(owned.id).catch(() => undefined);
    }
  }, [i18n.language, input, options]);

  useEffect(() => {
    generation.current += 1;
    const job = jobRef.current;
    jobRef.current = null;
    if (job) void job.cancel().catch(() => undefined);
    void release();
    if (mounted.current) {
      setState((current) => ({
        ...current,
        preview: null,
        afterUrl: null,
        loading: false,
        errorCode: "",
        startedAt: null,
      }));
    }
  }, [input, release]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      const job = jobRef.current;
      jobRef.current = null;
      if (job) void job.cancel().catch(() => undefined);
      void release();
      revoke();
    };
  }, [release, revoke]);

  const visible = canDisplayPreview(state.preview, revision, expectedContentId);
  return {
    state: visible ? state : { ...state, preview: null, afterUrl: null },
    start,
    cancel,
    runFull,
  };
}

/** A default region only when the caller knows the oriented source size. */
export function knownRegion(region: ImageRect | null): boolean {
  return Boolean(region && region.width > 0 && region.height > 0);
}
