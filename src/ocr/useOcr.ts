import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorCode } from "../services/errors";
import type { JobHandle } from "../services/jobs";
import {
  ocrPage,
  recognizeText,
  releaseOcr,
  type OcrInput,
  type OcrPage,
  type OcrRotation,
} from "../services/ocr";
import {
  findMatches,
  nextMatchIndex,
  pageText,
  type OcrMatch,
} from "./ocrSelection";

/** The OCR state machine for one image or PDF page (Step 07e T5).
 *
 * Recognition completion never touches the clipboard. "Copy all text" is a
 * separate explicit action that writes exactly the reading-order text once.
 * A user's Ctrl+C inside the overlay writes through the browser's plain-text
 * copy path and reports the selected text here.
 *
 * `previewOnly` suppresses mutations; OCR is read-only, so an ordinary
 * source keeps its explicit copy action in a preview. A sensitive PDF sets
 * `clipboardAllowed` false and copy stays disabled.
 */
export interface UseOcrOptions {
  input: OcrInput | null;
  /** The `ocr.language` setting: `auto` or an installed tag. */
  language: string;
  rotation: OcrRotation;
  /** False while the tab is hidden; cancels the recognition. */
  active: boolean;
  /** False for a sensitive PDF session (permissions.can_copy false). */
  clipboardAllowed?: boolean;
  /** Read-only preview: no mutation exists here, copy stays available. */
  previewOnly?: boolean;
  /** The "Text recognition" toolbar toggle. */
  enabled?: boolean;
}

export type OcrStatus = "idle" | "recognizing" | "ready" | "error";

export interface OcrController {
  status: OcrStatus;
  page: OcrPage | null;
  error: string;
  selectedText: string;
  matches: OcrMatch[];
  matchIndex: number;
  /** True from 100 ms into a recognition (plan R-UI-2 skeleton). */
  skeleton: boolean;
  /** True after 1 s: words saying what is happening. */
  showWords: boolean;
  showLanguageHelp: boolean;
  noText: boolean;
  partial: boolean;
  recognize: () => Promise<OcrPage | null>;
  cancel: () => void;
  copyAll: () => Promise<boolean>;
  setSelectedText: (text: string) => void;
  find: (query: string, caseSensitive?: boolean) => OcrMatch[];
  nextMatch: (backwards?: boolean) => void;
  clearFind: () => void;
}

function newConsumerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function inputKey(input: OcrInput | null, language: string, rotation: number): string {
  if (!input) return "";
  if (input.kind === "image") return `image:${input.path}:${language}:${rotation}`;
  return `pdf:${input.session_id}:${input.page}:${language}:${rotation}`;
}

function releaseQuietly(consumerId: string): void {
  void releaseOcr(consumerId).catch(() => undefined);
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("clipboard.unavailable");
}

export function useOcr(options: UseOcrOptions): OcrController {
  const { input, language, rotation, active, clipboardAllowed = true, enabled = true } = options;
  const [status, setStatus] = useState<OcrStatus>("idle");
  const [page, setPage] = useState<OcrPage | null>(null);
  const [error, setError] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [matches, setMatches] = useState<OcrMatch[]>([]);
  const [matchIndex, setMatchIndex] = useState(-1);
  const [skeleton, setSkeleton] = useState(false);
  const [showWords, setShowWords] = useState(false);

  const generation = useRef(0);
  const job = useRef<JobHandle<OcrPage> | null>(null);
  const consumer = useRef<string | null>(null);
  const pageRef = useRef<OcrPage | null>(null);
  const queryRef = useRef("");
  const caseSensitiveRef = useRef(false);
  // 07d rejects a zero render revision; one is a valid first request.
  const revision = useRef(1);
  const keyRef = useRef("");

  pageRef.current = page;

  const releaseCurrent = useCallback((reset: boolean) => {
    generation.current += 1;
    const running = job.current;
    job.current = null;
    if (running) void running.cancel().catch(() => undefined);
    const retained = consumer.current;
    consumer.current = null;
    if (retained) void releaseOcr(retained).catch(() => undefined);
    if (reset) {
      pageRef.current = null;
      setPage(null);
      setStatus("idle");
      setError("");
      setSelectedText("");
      setMatches([]);
      setMatchIndex(-1);
    }
  }, []);

  // A new file/page/language/rotation, a hidden tab or unmount cancels the
  // old generation and releases its retained page.
  const currentKey = inputKey(input, language, rotation);
  useEffect(() => {
    if (keyRef.current !== currentKey || !active) {
      keyRef.current = currentKey;
      releaseCurrent(true);
    }
  }, [currentKey, active, releaseCurrent]);
  useEffect(() => () => releaseCurrent(true), [releaseCurrent]);

  // 100 ms skeleton, 1 s words (plan R-UI-2).
  useEffect(() => {
    if (status !== "recognizing") {
      setSkeleton(false);
      setShowWords(false);
      return;
    }
    setSkeleton(false);
    setShowWords(false);
    const skeletonTimer = window.setTimeout(() => setSkeleton(true), 100);
    const wordsTimer = window.setTimeout(() => setShowWords(true), 1_000);
    return () => {
      window.clearTimeout(skeletonTimer);
      window.clearTimeout(wordsTimer);
    };
  }, [status]);

  const recognize = useCallback(async (): Promise<OcrPage | null> => {
    if (!input || !active || !enabled) return null;
    releaseCurrent(true);
    const generationNow = generation.current;
    const startedKey = inputKey(input, language, rotation);
    setStatus("recognizing");
    setError("");
    const consumerId = newConsumerId();
    try {
      const running = await recognizeText({
        input,
        language,
        consumer_id: consumerId,
        rotation,
        request_revision: revision.current,
      });
      revision.current += 1;
      job.current = running;
      if (generationNow !== generation.current) {
        void running.cancel().catch(() => undefined);
        return null;
      }
      let current = await running.completion;
      if (generationNow !== generation.current || startedKey !== keyRef.current) {
        releaseQuietly(consumerId);
        return null;
      }
      const words = [...current.words];
      const texts = [current.text];
      let partial = current.partial;
      let next = current.next_word ?? null;
      let rounds = 0;
      while (next !== null && rounds < 512) {
        const chunk = await ocrPage(consumerId, next);
        if (generationNow !== generation.current) {
          releaseQuietly(consumerId);
          return null;
        }
        words.push(...chunk.words);
        texts.push(chunk.text);
        partial = partial || chunk.partial;
        next = chunk.next_word ?? null;
        rounds += 1;
      }
      if (next !== null) partial = true;
      current = {
        ...current,
        words,
        text: texts.join(""),
        partial,
        next_word: null,
      };
      consumer.current = consumerId;
      pageRef.current = current;
      setPage(current);
      setStatus("ready");
      return current;
    } catch (cause) {
      if (generationNow !== generation.current) {
        releaseQuietly(consumerId);
        return null;
      }
      const code = errorCode(cause);
      if (code === "ocr.cancelled") {
        releaseQuietly(consumerId);
        return null;
      }
      setError(code || "ocr.failed");
      setStatus("error");
      releaseQuietly(consumerId);
      return null;
    }
  }, [input, language, rotation, active, enabled, releaseCurrent]);

  const cancel = useCallback(() => releaseCurrent(true), [releaseCurrent]);

  const copyAll = useCallback(async (): Promise<boolean> => {
    if (!clipboardAllowed) return false;
    let current = pageRef.current;
    if (!current) current = await recognize();
    if (!current || current.words.length === 0) return false;
    const text = pageText(current.words);
    if (!text) return false;
    await writeClipboard(text);
    return true;
  }, [clipboardAllowed, recognize]);

  const find = useCallback(
    (query: string, caseSensitive = false): OcrMatch[] => {
      queryRef.current = query;
      caseSensitiveRef.current = caseSensitive;
      const found = pageRef.current
        ? findMatches(pageRef.current.words, query, caseSensitive)
        : [];
      setMatches(found);
      setMatchIndex(found.length > 0 ? 0 : -1);
      return found;
    },
    [],
  );

  const nextMatch = useCallback(
    (backwards = false) => {
      setMatchIndex((index) => nextMatchIndex(index, matches.length, backwards));
    },
    [matches.length],
  );

  const clearFind = useCallback(() => {
    queryRef.current = "";
    setMatches([]);
    setMatchIndex(-1);
  }, []);

  // A finished page re-runs the current find query.
  useEffect(() => {
    if (!page || !queryRef.current) return;
    const found = findMatches(page.words, queryRef.current, caseSensitiveRef.current);
    setMatches(found);
    setMatchIndex(found.length > 0 ? 0 : -1);
  }, [page]);

  return useMemo(
    () => ({
      status,
      page,
      error,
      selectedText,
      matches,
      matchIndex,
      skeleton,
      showWords,
      showLanguageHelp: error === "ocr.language_missing",
      noText: status === "ready" && (page?.words.length ?? 0) === 0,
      partial: page?.partial ?? false,
      recognize,
      cancel,
      copyAll,
      setSelectedText,
      find,
      nextMatch,
      clearFind,
    }),
    [
      status,
      page,
      error,
      selectedText,
      matches,
      matchIndex,
      skeleton,
      showWords,
      recognize,
      cancel,
      copyAll,
      find,
      nextMatch,
      clearFind,
    ],
  );
}
