import { invoke } from "@tauri-apps/api/core";
import type { AiInputRef } from "./localAiTypes";
import type { TimeUs } from "./engineTypes";
import { runJob, type JobHandle } from "./jobs";
import { DocumentRegistry } from "../documents/DocumentRegistry";
import { acquireMediaEditor } from "../media-edit/MediaDocument";
import { transcriptToMediaCues } from "../ai-actions/transcriptSubtitles";
import {
  CAPTION_WINDOW_SECONDS,
  dictationFrameCap,
  parseTranscriptInfo,
  parseTranscriptPage,
  validateDictationRequest,
  validateTranscriptionRequest,
  type DictationRequest,
  type DictationSession,
  type SpeechLanguage,
  type TranscriptInfo,
  type TranscriptPage,
} from "./speechTypes";

/**
 * The only module that calls the speech commands (`speech-1` E3/E4).
 *
 * Speech is local and needs the optional `ai_speech` pack, independently of
 * the assistant. A dictation session is explicit: the native microphone
 * dialog owns the Allow/Cancel decision and no model may start it.
 */

const TRANSCRIBE_PREFIX = "speech";
const CAPTION_PREFIX = "caption";

/** One cancellable local transcription. */
export async function startTranscription(request: Parameters<typeof validateTranscriptionRequest>[0]): Promise<JobHandle<TranscriptInfo>> {
  const checked = validateTranscriptionRequest(request);
  return runJob<TranscriptInfo>(TRANSCRIBE_PREFIX, async (requestId) => {
    await invoke("speech_transcribe_start", { requestId, request: checked });
  }).then((handle) => ({
    ...handle,
    completion: handle.completion.then((info) => parseTranscriptInfo(info)),
  }));
}

/** The next bounded page after `first` (never parses a private format). */
export async function transcriptPage(id: string, first: number): Promise<TranscriptPage> {
  if (!Number.isSafeInteger(first) || first < 0) throw new Error("speech.invalid");
  const page = (await invoke("speech_transcript_page", { id, first })) as unknown;
  return parseTranscriptPage(page);
}

/** Reads every bounded page; never parses the private native format. */
export async function loadTranscriptSegments(transcriptId: string): Promise<TranscriptPage["segments"]> {
  if (typeof transcriptId !== "string" || transcriptId.length === 0) throw new Error("speech.invalid");
  const segments: TranscriptPage["segments"] = [];
  let first = 0;
  for (let page = 0; page < 10_000; page += 1) {
    const answer = await transcriptPage(transcriptId, first);
    if (answer.transcript_id !== transcriptId) throw new Error("speech.changed");
    segments.push(...answer.segments);
    if (answer.next_index === null) return segments;
    if (answer.next_index <= first) throw new Error("speech.invalid");
    first = answer.next_index;
  }
  throw new Error("speech.too_long");
}

/** Releases the transcript; existing page readers finish, new ones fail. */
export async function releaseTranscript(id: string): Promise<void> {
  await invoke("speech_transcript_release", { id });
}

/** Opens the native microphone dialog; nothing records before Allow. */
export async function startDictation(request: DictationRequest): Promise<DictationSession> {
  const checked = validateDictationRequest(request);
  dictationFrameCap(checked.max_seconds);
  return (await invoke("speech_dictation_start", { request: checked })) as DictationSession;
}

/** Stop transcribes locally; the text is a preview for a later review. */
export async function stopDictation(sessionId: string): Promise<TranscriptInfo> {
  const info = (await invoke("speech_dictation_stop", { sessionId })) as unknown;
  return parseTranscriptInfo(info);
}

/** Cancel releases the device and never inserts text. */
export async function cancelDictation(sessionId: string): Promise<void> {
  await invoke("speech_dictation_cancel", { sessionId });
}

/** First automatic-caption window: playhead 0, generation 1. */
export async function getAutomaticCaptions(
  input: AiInputRef,
  language: SpeechLanguage,
): Promise<JobHandle<TranscriptInfo>> {
  return getAutomaticCaptionWindow(input, language, 0, 1);
}

/**
 * One 30 s window after `startUs`. The player increments `generation` on
 * every seek, so a late answer from an old position is discarded.
 */
export async function getAutomaticCaptionWindow(
  input: AiInputRef,
  language: SpeechLanguage,
  startUs: TimeUs,
  generation: number,
): Promise<JobHandle<TranscriptInfo>> {
  if (!Number.isSafeInteger(startUs) || startUs < 0) throw new Error("speech.invalid");
  if (!Number.isSafeInteger(generation) || generation < 1 || generation > 0xffffffff) {
    throw new Error("speech.invalid");
  }
  if (CAPTION_WINDOW_SECONDS !== 30) throw new Error("speech.invalid");
  return runJob<TranscriptInfo>(CAPTION_PREFIX, async (requestId) => {
    await invoke("speech_captions_start", {
      requestId,
      input,
      language,
      startUs,
      generation,
    });
  }).then((handle) => ({
    ...handle,
    completion: handle.completion.then((info) => parseTranscriptInfo(info)),
  }));
}

/**
 * Applies a reviewed transcript as subtitle cues through the normal 15
 * controller (`set_subtitles`). It never burns or replaces the media here;
 * Apply/Save remain ordinary media-editor commands.
 */
export async function applyTranscriptToMedia(
  documentId: string,
  expectedContentId: string,
  transcriptId: string,
  mode: "select" | "burn",
): Promise<void> {
  if (!documentId || !expectedContentId || !transcriptId) throw new Error("speech.invalid");
  if (mode !== "select" && mode !== "burn") throw new Error("speech.invalid");
  const handle = DocumentRegistry.get(documentId);
  if (!handle) throw new Error("speech.changed");
  const state = handle.getState();
  if (state.content_id !== expectedContentId) throw new Error("speech.changed");
  const segments = await loadTranscriptSegments(transcriptId);
  const cues = transcriptToMediaCues(segments);
  if (cues.length === 0) throw new Error("speech.invalid");
  const controller = await acquireMediaEditor(handle);
  try {
    await controller.apply({ kind: "set_subtitles", cues, mode });
  } finally {
    controller.release();
  }
}
