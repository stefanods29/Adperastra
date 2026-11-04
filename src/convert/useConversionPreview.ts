import { useCallback, useEffect, useRef, useState } from "react";
import { errorCode } from "../services/errors";
import { releaseCacheLease } from "../services/cache";
import { previewConversion, type ConversionPreview } from "../services/convert";
import type { JobHandle } from "../services/jobs";
import type { ConversionInput, ConverterSpec, ConvertOptions } from "./types";

/** The latest preview request wins (Step 08a T5). Replacing any option
 * cancels the earlier generation; a stale completion can never replace a
 * newer image or its estimate. */

export type PreviewStatus = "idle" | "loading" | "ready" | "failed" | "unsupported";

export interface PreviewState {
  status: PreviewStatus;
  preview: ConversionPreview | null;
  /** Stable `convert.*` code when no preview could be made. */
  error: string;
  /** The option generation this state belongs to. */
  revision: number;
}

export interface UseConversionPreview {
  state: PreviewState;
  /** Ask again after a transient failure. */
  retry: () => void;
}

const IDLE: PreviewState = { status: "idle", preview: null, error: "", revision: 0 };

export function useConversionPreview(params: {
  inputs: readonly ConversionInput[];
  converter: ConverterSpec | null;
  options: ConvertOptions | null;
  enabled?: boolean;
}): UseConversionPreview {
  const { inputs, converter, options, enabled = true } = params;
  const [state, setState] = useState<PreviewState>(IDLE);
  const [nonce, setNonce] = useState(0);
  const revision = useRef(0);
  const job = useRef<JobHandle<ConversionPreview> | null>(null);
  const lease = useRef<string | null>(null);

  const releaseLease = useCallback(() => {
    const id = lease.current;
    lease.current = null;
    if (id) void releaseCacheLease(id).catch(() => undefined);
  }, []);

  const key = JSON.stringify({
    input: inputs[0] ?? null,
    converter: converter?.id ?? null,
    options,
    enabled,
    nonce,
  });

  useEffect(() => {
    let active = true;
    const generation = revision.current + 1;
    revision.current = generation;
    // Every option change starts a new generation; the old job and lease
    // are dropped before the new request begins.
    job.current?.cancel().catch(() => undefined);
    job.current = null;
    releaseLease();

    const first = inputs[0];
    if (!enabled || !converter || !options || !first) {
      setState({ status: "idle", preview: null, error: "", revision: generation });
      return () => {
        active = false;
      };
    }

    // The native combine route (`images/pdf`) has no single-source preview:
    // it refuses one before starting a helper. State that explicitly instead
    // of showing a failed request; the dialog still allows the conversion.
    if (converter.input_mode === "combine") {
      setState({ status: "unsupported", preview: null, error: "", revision: generation });
      return () => {
        active = false;
      };
    }

    setState({ status: "loading", preview: null, error: "", revision: generation });
    void (async () => {
      try {
        const started = await previewConversion({
          inputs: [first],
          converter_id: converter.id,
          options,
          request_revision: generation,
        });
        if (!active || revision.current !== generation) {
          // Observe completion before awaiting cancellation; a ready result
          // racing the close still owns a native lease that must be released.
          void started.completion.then((preview) => releaseCacheLease(preview.image.lease_id))
            .catch(() => undefined);
          await started.cancel().catch(() => undefined);
          return;
        }
        job.current = started;
        const preview = await started.completion;
        if (!active || revision.current !== generation || preview.input_revision !== generation) {
          await releaseCacheLease(preview.image.lease_id).catch(() => undefined);
          return;
        }
        lease.current = preview.image.lease_id;
        setState({ status: "ready", preview, error: "", revision: generation });
      } catch (error) {
        if (active && revision.current === generation) {
          setState({
            status: "failed",
            preview: null,
            error: errorCode(error) || "convert.io",
            revision: generation,
          });
        }
      }
    })();

    return () => {
      active = false;
      job.current?.cancel().catch(() => undefined);
      job.current = null;
      releaseLease();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const retry = useCallback(() => setNonce((value) => value + 1), []);

  return { state, retry };
}
