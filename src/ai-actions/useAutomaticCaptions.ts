import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AiInputRef } from "../services/localAiTypes";
import type { TimeUs } from "../services/engineTypes";
import type { JobHandle } from "../services/jobs";
import type { SpeechLanguage, TranscriptInfo } from "../services/speechTypes";
import {
  applyTranscriptToMedia,
  getAutomaticCaptionWindow,
  releaseTranscript,
  transcriptPage,
} from "../services/speech";
import { deterministicMediaId, type MediaSubtitleCue } from "../media-edit/types";

/**
 * Automatic captions for the active media player (Step 17b D8, `speech-1` E4).
 *
 * Off by default. Only the active player prepares captions; every seek starts
 * a new generation and a late answer from an older one is dropped. A chosen
 * subtitle file overrides the automatic cues until the user chooses Automatic
 * again. Nothing writes an SRT file automatically.
 */

export type CaptionStatus = "off" | "preparing" | "ready" | "failed";

export interface CaptionCue {
  start_us: TimeUs;
  end_us: TimeUs;
  text: string;
}

export interface CaptionState {
  enabled: boolean;
  status: CaptionStatus;
  generation: number;
  cues: readonly CaptionCue[];
  subtitleFileChosen: boolean;
  /** A user-facing error code; never a raw provider string. */
  errorCode: string | null;
}

export const CAPTION_WINDOW_US = 30_000_000;
/** This step never creates a subtitle file on its own. */
export const CAPTIONS_WRITE_SRT_AUTOMATICALLY = false;

export const initialCaptionState: CaptionState = {
  enabled: false,
  status: "off",
  generation: 0,
  cues: [],
  subtitleFileChosen: false,
  errorCode: null,
};

/** Captions never need the assistant pack; only the speech pack matters. */
export function captionsNeedAssistant(): boolean {
  return false;
}

export function cueFromSegment(segment: { start_us: TimeUs; end_us: TimeUs; text: string }): CaptionCue {
  if (!Number.isSafeInteger(segment.start_us) || !Number.isSafeInteger(segment.end_us)) {
    throw new Error("speech.invalid");
  }
  if (segment.end_us <= segment.start_us) throw new Error("speech.invalid");
  return { start_us: segment.start_us, end_us: segment.end_us, text: segment.text };
}

export interface CaptionSource {
  startWindow: (
    input: AiInputRef,
    language: SpeechLanguage,
    startUs: TimeUs,
    generation: number,
  ) => Promise<JobHandle<TranscriptInfo>>;
  page: (id: string, first: number) => Promise<{ segments: Array<{ start_us: number; end_us: number; text: string }>; next_index: number | null }>;
  release: (id: string) => Promise<void>;
  apply: (documentId: string, expectedContentId: string, transcriptId: string, mode: "select" | "burn") => Promise<void>;
}

const defaultSource: CaptionSource = {
  startWindow: getAutomaticCaptionWindow,
  page: transcriptPage,
  release: releaseTranscript,
  apply: applyTranscriptToMedia,
};

/**
 * The pure state machine behind the hook; tests drive this directly.
 * `apply` is the only action that touches the media document, exactly once.
 */
export class AutomaticCaptionController {
  private state: CaptionState = { ...initialCaptionState };
  private job: JobHandle<TranscriptInfo> | null = null;
  private transcriptId: string | null = null;
  private listener: (state: CaptionState) => void = () => undefined;
  private readonly source: CaptionSource;
  /** Bumped by every cancel; a window started before it must cancel on arrival. */
  private loadToken = 0;

  constructor(source: CaptionSource = defaultSource) {
    this.source = source;
  }

  getState(): CaptionState {
    return this.state;
  }

  subscribe(listener: (state: CaptionState) => void): () => void {
    this.listener = listener;
    listener(this.state);
    return () => {
      this.listener = () => undefined;
    };
  }

  private publish(patch: Partial<CaptionState>): void {
    this.state = { ...this.state, ...patch };
    this.listener(this.state);
  }

  /** Explicit user switch; the hearing preference never enables it alone. */
  setEnabled(enabled: boolean): void {
    if (!enabled) {
      this.cancelJob();
      this.publish({ enabled: false, status: "off", cues: [], errorCode: null });
      return;
    }
    this.publish({ enabled: true, status: "preparing", errorCode: null });
  }

  /** A seek always begins the next generation and cancels the old one. */
  seek(input: AiInputRef, language: SpeechLanguage, startUs: TimeUs): number {
    this.cancelJob();
    const generation = this.state.generation + 1;
    this.publish({ generation, status: this.state.enabled ? "preparing" : "off", cues: [] });
    if (!this.state.enabled || this.state.subtitleFileChosen) return generation;
    void this.load(input, language, startUs, generation);
    return generation;
  }

  /** Inactive tabs cancel; they never keep preparing captions. */
  setActive(active: boolean): void {
    if (!active) {
      this.cancelJob();
      this.publish({ status: this.state.enabled ? "preparing" : "off", cues: [] });
    }
  }

  chooseSubtitleFile(): void {
    this.cancelJob();
    this.publish({ subtitleFileChosen: true, cues: [], status: "off" });
  }

  chooseAutomatic(): void {
    this.publish({ subtitleFileChosen: false, status: this.state.enabled ? "preparing" : "off" });
  }

  /** One explicit Apply; never automatic, never more than one transaction. */
  async apply(documentId: string, expectedContentId: string, mode: "select" | "burn"): Promise<void> {
    if (!this.transcriptId) throw new Error("speech.invalid");
    await this.source.apply(documentId, expectedContentId, this.transcriptId, mode);
  }

  dispose(): void {
    this.cancelJob();
    this.listener = () => undefined;
  }

  private cancelJob(): void {
    this.loadToken += 1;
    if (this.job) {
      this.job.cancel().catch(() => undefined);
      this.job = null;
    }
    if (this.transcriptId) {
      this.source.release(this.transcriptId).catch(() => undefined);
      this.transcriptId = null;
    }
  }

  private async load(input: AiInputRef, language: SpeechLanguage, startUs: TimeUs, generation: number): Promise<void> {
    const token = this.loadToken;
    let job: JobHandle<TranscriptInfo> | null = null;
    try {
      job = await this.source.startWindow(input, language, startUs, generation);
      // A cancel (inactive tab, substring file, dispose) that arrived while
      // the window was starting still cancels the job on arrival.
      if (token !== this.loadToken || this.state.generation !== generation) {
        void job.cancel();
        return;
      }
      this.job = job;
      const info = await job.completion;
      if (token !== this.loadToken || this.state.generation !== generation || this.state.subtitleFileChosen) {
        await this.source.release(info.id).catch(() => undefined);
        return;
      }
      this.transcriptId = info.id;
      const cues: CaptionCue[] = [];
      let first = 0;
      for (let page = 0; page < 100; page += 1) {
        const answer = await this.source.page(info.id, first);
        cues.push(...answer.segments.map(cueFromSegment));
        if (answer.next_index === null) break;
        first = answer.next_index;
      }
      if (token !== this.loadToken || this.state.generation !== generation) return;
      this.publish({ cues, status: "ready", errorCode: null });
    } catch (error) {
      if (token !== this.loadToken || this.state.generation !== generation) return;
      const code = error instanceof Error ? error.message : "speech.failed";
      this.publish({ status: "failed", errorCode: code });
    } finally {
      if (job !== null && this.job === job) this.job = null;
    }
  }
}

export interface UseAutomaticCaptionsOptions {
  documentId: string;
  input: AiInputRef;
  active: boolean;
  language: SpeechLanguage;
  source?: CaptionSource;
}

export interface UseAutomaticCaptionsResult {
  state: CaptionState;
  setEnabled: (enabled: boolean) => void;
  seek: (startUs: TimeUs) => number;
  chooseSubtitleFile: () => void;
  chooseAutomatic: () => void;
  apply: (expectedContentId: string, mode: "select" | "burn") => Promise<void>;
}

export function useAutomaticCaptions({
  documentId,
  input,
  active,
  language,
  source,
}: UseAutomaticCaptionsOptions): UseAutomaticCaptionsResult {
  const controller = useMemo(
    () => new AutomaticCaptionController(source ?? defaultSource),
    [source],
  );
  const [state, setState] = useState<CaptionState>(() => controller.getState());
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => {
    controller.setActive(active);
  }, [controller, active]);
  useEffect(() => () => controller.dispose(), [controller]);

  const seek = useCallback(
    (startUs: TimeUs) => {
      if (!activeRef.current) return controller.getState().generation;
      return controller.seek(input, language, startUs);
    },
    [controller, input, language],
  );

  return {
    state,
    setEnabled: (enabled) => controller.setEnabled(enabled),
    seek,
    chooseSubtitleFile: () => controller.chooseSubtitleFile(),
    chooseAutomatic: () => controller.chooseAutomatic(),
    apply: (expectedContentId, mode) => controller.apply(documentId, expectedContentId, mode),
  };
}

/** Cues that contain the playhead; used by the 15 subtitle overlay. */
export function currentCaption(cues: readonly CaptionCue[], positionUs: TimeUs): CaptionCue | null {
  for (const cue of cues) {
    if (positionUs >= cue.start_us && positionUs < cue.end_us) return cue;
  }
  return null;
}

/** Display cues through the normal 15 cue shape without changing times. */
export function toMediaCues(cues: readonly CaptionCue[]): MediaSubtitleCue[] {
  return cues.map((cue, index) => ({
    id: deterministicMediaId("automatic-caption", index),
    start_us: cue.start_us,
    end_us: cue.end_us,
    text: cue.text,
  }));
}
